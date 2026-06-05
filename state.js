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
    // 온라인 복귀 시 자동 재로드 (데이터 최신화)
    if (typeof loadState === 'function' && !loadInProgress) {
      loadInProgress = false;
      loadState();
    }
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
// Supabase 저장 공통 페이로드
// ──────────────────────────────────────────────
function _supabaseSavePayload() {
  return {
    user_id:    currentUser.id,
    pool:       state.pool,
    schedule:   pruneScheduleForSave(state.schedule),
    links:      state.links || [],
    updated_at: new Date().toISOString()
  };
}

// ──────────────────────────────────────────────
// 저장: Supabase 디바운스 2초
// ──────────────────────────────────────────────
let _saveTimer = null;
let _pendingSave = false; // 로컬에서 변경됐지만 아직 Supabase에 안 올라간 상태

function saveState() {
  if (!dataLoaded) return;
  if (!navigator.onLine) { setSyncStatus('📶 오프라인 — 연결 후 자동 저장'); return; }

  const snap = stateSnapshot();
  if (!lastSavedSnapshot && !hasAnyTaskData()) return; // 빈 state 저장 방지
  if (snap === lastSavedSnapshot) { showLastSavedTime(); return; } // 변경 없음

  lastSavedSnapshot = snap;
  _pendingSave = true; // 로컬 변경 발생
  showLastSavedTime();

  if (!currentUser || !supabaseClient) return;
  clearTimeout(_saveTimer);
  setSyncStatus('📝 동기화 중...');
  _saveTimer = setTimeout(() => {
    if (!currentUser || !supabaseClient) return;
    supabaseClient
      .from('user_states')
      .upsert(_supabaseSavePayload(), { onConflict: 'user_id' })
      .then(({ error }) => {
        if (error) { setSyncStatus('⚠️ 클라우드 저장 실패'); return; }
        _pendingSave = false; // 저장 완료
        setSyncSaved();
      });
  }, 2000);
}

// ──────────────────────────────────────────────
// 즉시 플러시 (페이지 종료 / 백그라운드 전환)
// _pendingSave 가 true일 때만 업로드 — 다른 기기 데이터 덮어쓰기 방지
// ──────────────────────────────────────────────
function flushToSupabase() {
  if (!currentUser || !supabaseClient || !dataLoaded) return;
  if (!_pendingSave) return; // 변경사항 없으면 업로드 생략
  clearTimeout(_saveTimer);
  supabaseClient
    .from('user_states')
    .upsert(_supabaseSavePayload(), { onConflict: 'user_id' })
    .then(({ error }) => {
      if (!error) { _pendingSave = false; setSyncSaved(); }
    });
}

// ──────────────────────────────────────────────
// foreground 복귀 시 re-sync (다른 기기 변경 반영)
// ──────────────────────────────────────────────
let _lastVisibleAt = 0;
const RE_SYNC_COOLDOWN = 30 * 1000;

function _reSyncFromCloud() {
  if (!currentUser || !supabaseClient || !dataLoaded) return;
  const now = Date.now();
  if (now - _lastVisibleAt < RE_SYNC_COOLDOWN) return;
  _lastVisibleAt = now;

  setSyncStatus('☁️ 동기화 확인 중...');
  supabaseClient
    .from('user_states')
    .select('pool, schedule, links, updated_at')
    .eq('user_id', currentUser.id)
    .maybeSingle()
    .then(({ data: remote, error }) => {
      if (error || !_remoteHasData(remote)) { setSyncSaved(); return; }
      applyPersistedState(remote);
      lastSavedSnapshot = stateSnapshot();
      autoReturnExpiredTasks();
      renderApp();
      setSyncSaved();
    })
    .catch(() => setSyncStatus('⚠️ 클라우드 동기화 실패'));
}

window.addEventListener('beforeunload', flushToSupabase);
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden') {
    flushToSupabase();
  } else {
    _reSyncFromCloud();
  }
});
setInterval(flushToSupabase, 10 * 60 * 1000);

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
    resetScheduleState();
    dataLoaded = false;
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

  _supabaseWithTimeout(
    supabaseClient
      .from('user_states')
      .select('pool, schedule, links, updated_at')
      .eq('user_id', currentUser.id)
      .maybeSingle()
  )
  .then(({ data: remote, error }) => {
    loadInProgress = false;
    clearTimeout(_loadGuard);

    if (error) {
      console.error('Supabase 읽기 에러:', error);
      dataLoaded = true;
      renderApp();
      _showRetryButton();
      setSyncStatus('⚠️ 클라우드 동기화 실패');
      return;
    }

    if (_remoteHasData(remote)) {
      applyPersistedState(remote);
    } else if (!hasAnyTaskData()) {
      // 신규 유저 — 빈 상태로 시작
      applyPersistedState({});
    }
    // 클라우드 비어있고 현재 state에 데이터 있으면 업로드
    if (!_remoteHasData(remote) && hasAnyTaskData()) {
      supabaseClient.from('user_states')
        .upsert(_supabaseSavePayload(), { onConflict: 'user_id' })
        .then(({ error }) => { if (!error) setSyncSaved(); });
    }

    lastSavedSnapshot = stateSnapshot();
    dataLoaded = true;
    autoReturnExpiredTasks();
    renderApp();
    showLastSavedTime();
    checkFirstVisit();
    setSyncSaved();
  })
  .catch(err => {
    loadInProgress = false;
    clearTimeout(_loadGuard);
    console.error('Supabase 로드 실패:', err.message);
    dataLoaded = true;
    renderApp();
    _showRetryButton();
    setSyncStatus('⚠️ 불러오기 실패 — 재시도하세요');
  });
}
