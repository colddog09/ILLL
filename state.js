/* ============================================================
   state.js — 앱 상태 관리 + Supabase 저장/불러오기
   localStorage 미사용 — Supabase가 유일한 저장소
   ============================================================ */

'use strict';

// ──────────────────────────────────────────────
// 오프라인 감지 + 배너
// ──────────────────────────────────────────────
(function _initOfflineGuard() {
  function showOfflineBanner() {
    if (document.getElementById('offlineBanner')) return;
    const el = document.createElement('div');
    el.id = 'offlineBanner';
    el.style.cssText = [
      'position:fixed','top:0','left:0','right:0','z-index:999999',
      'background:#1e1b4b','color:#fff','text-align:center',
      'padding:10px 16px','font-size:0.85rem','font-weight:600',
      'display:flex','align-items:center','justify-content:center','gap:8px',
      'box-shadow:0 2px 12px rgba(0,0,0,0.3)',
      'animation:offlineSlideIn 0.25s ease'
    ].join(';');
    el.innerHTML = '📶 인터넷 연결이 없어요. Wi-Fi나 데이터를 연결해 주세요.';

    // 슬라이드인 키프레임 주입 (1회)
    if (!document.getElementById('offlineStyle')) {
      const s = document.createElement('style');
      s.id = 'offlineStyle';
      s.textContent = '@keyframes offlineSlideIn{from{transform:translateY(-100%)}to{transform:translateY(0)}}';
      document.head.appendChild(s);
    }
    document.body.prepend(el);
  }

  function hideOfflineBanner() {
    const el = document.getElementById('offlineBanner');
    if (!el) return;
    el.style.animation = 'offlineSlideIn 0.2s ease reverse';
    setTimeout(() => el.remove(), 200);
  }

  // 초기 상태 체크
  if (!navigator.onLine) showOfflineBanner();

  window.addEventListener('offline', showOfflineBanner);
  window.addEventListener('online',  () => {
    hideOfflineBanner();
    // 온라인 복귀:
    //  - 아직 로드 전이면 정식 로드
    //  - 미저장 변경 있으면 업로드 우선 (덮어쓰기 방지)
    //  - 그 외엔 최신 데이터만 가볍게 가져오기
    if (typeof loadState !== 'function') return;
    if (!dataLoaded) { loadState(); return; }
    if (_pendingSave) { flushToSupabase(); }
    else { _pullRemote(); }
  });
})();

// ──────────────────────────────────────────────
// 초기 상태
// ──────────────────────────────────────────────
const DEFAULT_STATE = {
  pool:      [],
  schedule:  {},
  dayOffset: 0,
  links:     []
};

let state      = { ...DEFAULT_STATE };
let dragInfo   = null;
let gcalEvents = {};

// ──────────────────────────────────────────────
// 공유 DOM 레퍼런스 (render.js / drag.js가 참조)
// ──────────────────────────────────────────────
const poolEl    = document.getElementById('taskPool');
const dayGrid   = document.getElementById('dayGrid');
const weekLabel = document.getElementById('weekLabel');
const ghost     = document.getElementById('dragGhost');
const trashZone = document.getElementById('trashZone');
const taskInput = document.getElementById('taskInput');

// ──────────────────────────────────────────────
// 저장 관련 플래그
// ──────────────────────────────────────────────
let dataLoaded        = false;
let loadInProgress    = false;
let lastSavedSnapshot = null;

// 구 버전 localStorage 잔여물 정리 (1회)
(function _cleanOldLocalStorage() {
  ['state_backup_v1','state_backup_ts_v1','state_backup_uid_v1','lastSavedTime'].forEach(k => {
    try { localStorage.removeItem(k); } catch (_) {}
  });
})();

// ──────────────────────────────────────────────
// 상태 관리 헬퍼
// ──────────────────────────────────────────────
function resetScheduleState() {
  state.pool     = [];
  state.schedule = {};
  state.links    = [];
}

function applyPersistedState(data = {}) {
  state.pool     = data.pool     || [];
  state.schedule = data.schedule || {};
  state.links    = data.links    || [];
}

function stateSnapshot() {
  return JSON.stringify({ pool: state.pool, schedule: state.schedule, links: state.links });
}

// ──────────────────────────────────────────────
// 오래된 일정 압축 (최근 60일 유지, 이전은 미완료만)
// ──────────────────────────────────────────────
const SCHEDULE_KEEP_DAYS = 60;

function pruneScheduleForSave(schedule) {
  if (!schedule) return schedule;
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - SCHEDULE_KEEP_DAYS);
  const cutoffStr = cutoff.toISOString().slice(0, 10);
  const pruned = {};
  for (const [date, tasks] of Object.entries(schedule)) {
    if (date >= cutoffStr) {
      pruned[date] = tasks;
    } else {
      const incomplete = (tasks || []).filter(t => t.status !== 'O');
      if (incomplete.length > 0) pruned[date] = incomplete;
    }
  }
  return pruned;
}

// ──────────────────────────────────────────────
// 데이터 유효성
// ──────────────────────────────────────────────
function hasAnyTaskData() {
  if (state.pool?.length > 0) return true;
  if (state.schedule) {
    for (const k of Object.keys(state.schedule)) {
      if (Array.isArray(state.schedule[k]) && state.schedule[k].length > 0) return true;
    }
  }
  return false;
}

function _remoteHasData(remote) {
  if (!remote) return false;
  if (remote.pool?.length > 0) return true;
  if (remote.schedule) {
    for (const k of Object.keys(remote.schedule)) {
      if (Array.isArray(remote.schedule[k]) && remote.schedule[k].length > 0) return true;
    }
  }
  return false;
}


// ──────────────────────────────────────────────
// 동기화 상태 추적
//   _pendingSave   : 로컬 변경이 아직 클라우드에 안 올라감
//   _lastRemoteTs  : 우리가 마지막으로 적용/기록한 remote updated_at (ms)
//   _lastWrittenTs : 우리가 마지막으로 업로드한 updated_at 문자열 (에코 무시용)
// ──────────────────────────────────────────────
let _saveTimer    = null;
let _pendingSave  = false;
let _lastRemoteTs = 0;
let _lastWrittenTs = '';
let _uploading    = false;
let _pulling      = false;

const SAVE_DEBOUNCE_MS = 1500;

// pruning 적용된 로컬 스냅샷 (remote 와 동일 형태로 비교하기 위함)
function prunedSnapshot() {
  return JSON.stringify({
    pool: state.pool,
    schedule: pruneScheduleForSave(state.schedule),
    links: state.links || []
  });
}
// remote 행을 동일 형태 스냅샷으로 정규화
function _remoteSnapshot(remote) {
  return JSON.stringify({
    pool: remote.pool || [],
    schedule: remote.schedule || {},
    links: remote.links || []
  });
}

// updated_at 을 명시적으로 받아 페이로드 생성
function _supabaseSavePayloadAt(ts) {
  return {
    user_id:    currentUser.id,
    pool:       state.pool,
    schedule:   pruneScheduleForSave(state.schedule),
    links:      state.links || [],
    updated_at: ts
  };
}

// 단일 업로드 경로 (디바운스 저장 / 플러시 공용)
async function _getToken() {
  const { data: { session } } = await supabaseClient.auth.getSession();
  return session?.access_token || null;
}

async function _uploadNow() {
  if (!currentUser || !supabaseClient) return false;
  if (!navigator.onLine) { setSyncStatus('📶 오프라인 — 연결 후 자동 저장'); return false; }
  clearTimeout(_saveTimer);
  const ts = new Date().toISOString();
  const snapAtUpload = stateSnapshot();
  _lastWrittenTs = ts;
  _uploading = true;
  try {
    const token = await _getToken();
    if (!token) { _uploading = false; return false; }
    const res = await fetch('/api/state', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
      body: JSON.stringify({
        pool:       state.pool,
        schedule:   pruneScheduleForSave(state.schedule),
        links:      state.links || [],
        updated_at: ts,
      }),
      keepalive: true,
    });
    _uploading = false;
    if (!res.ok) { console.warn('[sync] 저장 실패:', res.status); setSyncStatus('⚠️ 클라우드 저장 실패'); return false; }
    if (stateSnapshot() === snapAtUpload) _pendingSave = false;
    lastSavedSnapshot = snapAtUpload;
    _lastRemoteTs = Date.parse(ts) || Date.now();
    setSyncSaved();
    return true;
  } catch (err) {
    _uploading = false;
    console.warn('[sync] 저장 예외:', err?.message);
    setSyncStatus('⚠️ 클라우드 저장 실패');
    return false;
  }
}

function saveState() {
  if (!dataLoaded) return;

  const snap = stateSnapshot();
  if (!lastSavedSnapshot && !hasAnyTaskData()) return; // 빈 state 저장 방지
  if (snap === lastSavedSnapshot && !_pendingSave) { showLastSavedTime(); return; }

  _pendingSave = true;
  showLastSavedTime();

  if (!navigator.onLine) { setSyncStatus('📶 오프라인 — 연결 후 자동 저장'); return; }
  if (!currentUser || !supabaseClient) return;

  clearTimeout(_saveTimer);
  setSyncStatus('📝 동기화 중...');
  _saveTimer = setTimeout(_uploadNow, SAVE_DEBOUNCE_MS);
}

// 즉시 플러시 (페이지 종료 / 백그라운드 전환) — pending 있을 때만
function flushToSupabase() {
  if (!currentUser || !supabaseClient || !dataLoaded) return;
  if (!_pendingSave || _uploading) return;
  _uploadNow();
}

// ──────────────────────────────────────────────
// remote 적용 (충돌 안전)
// ──────────────────────────────────────────────
function _applyRemote(remote, remoteTsMs) {
  applyPersistedState(remote);
  lastSavedSnapshot = stateSnapshot();
  _lastRemoteTs = remoteTsMs;
  _pendingSave = false;
  autoReturnExpiredTasks();
  renderApp();
  setSyncSaved();
}

// 클라우드에서 최신 데이터 가져오기 (타임스탬프 비교 후 더 최신일 때만 반영)
async function _pullRemote() {
  if (!currentUser || !supabaseClient || !dataLoaded) return;
  if (!navigator.onLine || _pulling) return;
  if (_pendingSave) { flushToSupabase(); return; }
  _pulling = true;
  try {
    const token = await _getToken();
    if (!token) { _pulling = false; return; }
    const res = await fetch('/api/state', { headers: { 'Authorization': `Bearer ${token}` } });
    _pulling = false;
    if (!res.ok) return;
    const remote = await res.json();
    if (!_remoteHasData(remote)) return;
    if (_remoteSnapshot(remote) !== prunedSnapshot()) {
      console.log('[sync] 다른 기기 변경 감지 → 적용');
      _applyRemote(remote, Date.parse(remote.updated_at) || Date.now());
    }
  } catch { _pulling = false; }
}

// ──────────────────────────────────────────────
// Supabase Realtime — 다른 기기 변경 즉시 수신
// (Realtime 미활성 시 조용히 무시됨 → 폴링이 폴백)
// ──────────────────────────────────────────────
let _realtimeChannel = null;

function _subscribeRealtime() {
  if (!currentUser || !supabaseClient || _realtimeChannel) return;
  try {
    _realtimeChannel = supabaseClient
      .channel('user_states_rt_' + currentUser.id)
      .on('postgres_changes',
        { event: '*', schema: 'public', table: 'user_states', filter: 'user_id=eq.' + currentUser.id },
        payload => {
          const newRow = payload.new;
          if (!newRow || !newRow.updated_at) return;
          if (newRow.updated_at === _lastWrittenTs) return; // 내 변경 에코 무시
          if (_pendingSave || _uploading) return;           // 내 미저장 변경 우선
          // data_enc 저장 후 payload.new에 pool/schedule이 없으므로 직접 pull
          console.log('[sync] 다른 기기 변경 감지 → pull');
          setSyncStatus('🔄 다른 기기에서 업데이트됨');
          _pullRemote();
          _showRemoteUpdateToast();
        })
      .subscribe();
  } catch (e) {
    console.warn('[sync] realtime 구독 실패:', e?.message);
  }
}

function _teardownSync() {
  clearTimeout(_saveTimer);
  _stopPolling();
  if (_realtimeChannel) {
    try { supabaseClient.removeChannel(_realtimeChannel); } catch (_) {}
    _realtimeChannel = null;
  }
}

// 다른 기기 업데이트 감지 토스트
let _remoteToastTimer = null;
function _showRemoteUpdateToast() {
  let toast = document.getElementById('remoteUpdateToast');
  if (toast) { clearTimeout(_remoteToastTimer); toast.remove(); }

  toast = document.createElement('div');
  toast.id = 'remoteUpdateToast';
  toast.style.cssText = [
    'position:fixed','bottom:calc(80px + env(safe-area-inset-bottom,0px))','left:50%',
    'transform:translateX(-50%) translateY(10px)',
    'background:#1e3a5f','color:#89c4ff',
    'font-size:0.85rem','font-weight:600',
    'padding:10px 14px 10px 18px','border-radius:14px','z-index:99999',
    'display:flex','align-items:center','gap:12px','max-width:90vw',
    'box-shadow:0 8px 24px rgba(0,0,0,0.35)',
    'border:1px solid rgba(137,196,255,0.2)',
    'opacity:0','transition:opacity 0.2s ease, transform 0.2s ease',
    'white-space:nowrap'
  ].join(';');

  const text = document.createElement('span');
  text.textContent = '🔄 다른 기기에서 업데이트됨';

  const btn = document.createElement('button');
  btn.textContent = '새로고침';
  btn.style.cssText = [
    'background:rgba(137,196,255,0.18)','color:#89c4ff','border:1px solid rgba(137,196,255,0.3)',
    'padding:5px 12px','border-radius:10px','font-weight:700','cursor:pointer',
    'font-family:inherit','flex-shrink:0','font-size:0.82rem'
  ].join(';');
  btn.addEventListener('click', () => window.location.reload());

  toast.appendChild(text);
  toast.appendChild(btn);
  document.body.appendChild(toast);

  requestAnimationFrame(() => {
    toast.style.opacity = '1';
    toast.style.transform = 'translateX(-50%) translateY(0)';
  });

  _remoteToastTimer = setTimeout(() => {
    toast.style.opacity = '0';
    toast.style.transform = 'translateX(-50%) translateY(10px)';
    setTimeout(() => toast.remove(), 220);
  }, 6000);
}

// ──────────────────────────────────────────────
// 폴링 폴백 — visible 상태에서 45초마다 최신 확인
// ──────────────────────────────────────────────
let _pollTimer = null;
function _startPolling() {
  _stopPolling();
  _pollTimer = setInterval(() => {
    if (document.visibilityState === 'visible') _pullRemote();
  }, 45 * 1000);
}
function _stopPolling() {
  if (_pollTimer) { clearInterval(_pollTimer); _pollTimer = null; }
}

// ──────────────────────────────────────────────
// 페이지 종료 / 가시성 전환 / 네트워크 이벤트
// ──────────────────────────────────────────────
window.addEventListener('beforeunload', flushToSupabase);
window.addEventListener('pagehide', flushToSupabase);
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden') {
    flushToSupabase();
  } else {
    // foreground 복귀: pending 있으면 업로드, 없으면 최신 확인
    if (_pendingSave) flushToSupabase();
    else _pullRemote();
  }
});
// 5분마다 안전 플러시
setInterval(flushToSupabase, 5 * 60 * 1000);

// ──────────────────────────────────────────────
// 데이터 불러오기 — Supabase에서 항상 최신 데이터
// ──────────────────────────────────────────────
function _supabaseWithTimeout(promise, ms = 8000) {
  return Promise.race([
    promise,
    new Promise((_, reject) => setTimeout(() => reject(new Error('TIMEOUT')), ms))
  ]);
}

function _showRetryButton() {
  if (document.getElementById('sr-retry-btn')) return;
  const btn = document.createElement('button');
  btn.id = 'sr-retry-btn';
  btn.textContent = '🔄 다시 불러오기';
  btn.style.cssText = [
    'position:fixed','bottom:80px','left:50%','transform:translateX(-50%)',
    'z-index:9999','padding:10px 22px','border-radius:20px',
    'background:#1e3a5f','color:#89c4ff','border:1.5px solid rgba(137,196,255,0.4)',
    'font-size:0.9rem','cursor:pointer','box-shadow:0 4px 20px rgba(0,0,0,0.5)'
  ].join(';');
  btn.addEventListener('click', () => { btn.remove(); loadInProgress = false; loadState(); });
  document.body.appendChild(btn);
}

function loadState() {
  if (!currentUser || !supabaseClient) {
    _teardownSync();
    resetScheduleState();
    dataLoaded = false;
    _pendingSave = false;
    _lastRemoteTs = 0;
    _lastWrittenTs = '';
    renderApp();
    return;
  }
  if (loadInProgress) return;
  if (!navigator.onLine) {
    setSyncStatus('📶 오프라인 — 연결 후 자동 로드');
    return;
  }
  loadInProgress = true;
  const _loadGuard = setTimeout(() => { loadInProgress = false; }, 15000);

  setSyncStatus('☁️ 불러오는 중...');

  _getToken().then(token => {
    if (!token) throw new Error('NO_TOKEN');
    return _supabaseWithTimeout(
      fetch('/api/state', { headers: { 'Authorization': `Bearer ${token}` } })
        .then(r => r.ok ? r.json() : Promise.reject(new Error('HTTP ' + r.status)))
    );
  })
  .then(remote => {
    loadInProgress = false;
    clearTimeout(_loadGuard);

    const remoteTs = remote?.updated_at ? Date.parse(remote.updated_at) : 0;

    if (dataLoaded && _pendingSave) {
      console.warn('[sync] 로드 중 미저장 변경 감지 → 로컬 보호, 업로드');
      flushToSupabase();
      _subscribeRealtime();
      _startPolling();
      return;
    }

    if (_remoteHasData(remote)) {
      applyPersistedState(remote);
      _lastRemoteTs = remoteTs;
    } else if (hasAnyTaskData()) {
      _pendingSave = true;
      _uploadNow();
    } else {
      applyPersistedState({});
    }

    lastSavedSnapshot = stateSnapshot();
    _pendingSave = false;
    dataLoaded = true;
    autoReturnExpiredTasks();
    renderApp();
    showLastSavedTime();
    checkFirstVisit();
    setSyncSaved();

    _subscribeRealtime();
    _startPolling();
  })
  .catch(err => {
    loadInProgress = false;
    clearTimeout(_loadGuard);
    console.error('state 로드 실패:', err.message);
    dataLoaded = true;
    renderApp();
    _showRetryButton();
    setSyncStatus('⚠️ 불러오기 실패 — 재시도하세요');
  });
}
