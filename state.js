/* ============================================================
   state.js — 앱 상태 관리 + Supabase 저장/불러오기
   (auth.js, utils.js보다 뒤, render.js보다 앞에 로드)
   ============================================================ */

'use strict';

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
let dataLoaded          = false;
let loadInProgress      = false;
let lastSavedSnapshot   = null;
let _localChangePending = false; // 로컬 변경이 Supabase에 아직 업로드 안 됐을 때 true

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
// 오래된 일정 압축 (DB 저장 시에만 적용)
// 최근 60일: 전부 유지 / 그 이전: 미완료만 유지
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

// ──────────────────────────────────────────────
// localStorage = 주 저장소 (항상 즉시 저장, 새로고침에도 안전)
// Supabase     = 클라우드 백업 (멀티디바이스 동기화, 백그라운드)
// ──────────────────────────────────────────────
const LS_BACKUP_KEY  = 'state_backup_v1';
const LS_BACKUP_TS   = 'state_backup_ts_v1';
const LS_BACKUP_UID  = 'state_backup_uid_v1';

function _saveLocal() {
  if (!currentUser) return;
  try {
    const ts = Date.now();
    localStorage.setItem(LS_BACKUP_KEY, stateSnapshot());
    localStorage.setItem(LS_BACKUP_TS,  ts.toString());
    localStorage.setItem(LS_BACKUP_UID, currentUser.id);
    localStorage.setItem('lastSavedTime', ts.toString());
  } catch (_) {}
}

function _loadLocal() {
  try {
    const uid = localStorage.getItem(LS_BACKUP_UID);
    if (!uid || uid !== currentUser?.id) return null;
    const snap = localStorage.getItem(LS_BACKUP_KEY);
    const ts   = parseInt(localStorage.getItem(LS_BACKUP_TS) || '0', 10);
    if (!snap || !ts) return null;
    return { data: JSON.parse(snap), ts };
  } catch (_) { return null; }
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
// 저장: localStorage 즉시 → Supabase 디바운스 2초
// ──────────────────────────────────────────────
let _saveTimer = null;
function saveState() {
  if (!dataLoaded) return;

  const snap = stateSnapshot();

  // 빈 state 저장 방지 (로드 전 빈 state로 덮어쓰는 버그 차단)
  if (!lastSavedSnapshot && !hasAnyTaskData()) return;

  // 변경이 없으면 localStorage 저장 생략
  if (snap === lastSavedSnapshot) {
    showLastSavedTime();
    return;
  }

  // 1. localStorage 즉시 저장 (주 저장소)
  lastSavedSnapshot = snap;
  _saveLocal();
  _localChangePending = true; // 로컬 변경 발생 — Supabase 아직 미업로드
  showLastSavedTime();

  // 2. Supabase 백그라운드 동기화 (디바운스 2초)
  if (!currentUser || !supabaseClient) return;
  clearTimeout(_saveTimer);
  setSyncStatus('📝 동기화 중...');
  _saveTimer = setTimeout(() => {
    if (!currentUser || !supabaseClient) return; // 로그아웃 후 타이머 방어
    supabaseClient
      .from('user_states')
      .upsert(_supabaseSavePayload(), { onConflict: 'user_id' })
      .then(({ error }) => {
        if (error) { setSyncStatus('⚠️ 클라우드 저장 실패'); return; }
        _localChangePending = false; // 업로드 성공 시 플래그 해제
        setSyncSaved();
      });
  }, 2000);
}

// remote 데이터에 실제 내용이 있는지 확인 (빈 remote로 덮어쓰기 방지)
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

// 페이지 종료/백그라운드 전환 시 Supabase에 즉시 플러시
// (localStorage는 saveState에서 이미 최신 상태)
function flushToSupabase() {
  if (!currentUser || !supabaseClient || !dataLoaded) return;
  if (!lastSavedSnapshot && !hasAnyTaskData()) return;
  supabaseClient
    .from('user_states')
    .upsert(_supabaseSavePayload(), { onConflict: 'user_id' })
    .then(({ error }) => {
      if (!error) { _localChangePending = false; setSyncSaved(); }
    });
}

// 다른 기기 변경사항 체크 (앱 foreground 복귀 시)
let _lastVisibleAt = 0;
const RE_SYNC_COOLDOWN = 30 * 1000; // 30초 이내 재진입 무시

function _reSyncFromCloud() {
  if (!currentUser || !supabaseClient || !dataLoaded) return;
  if (_localChangePending) { flushToSupabase(); return; } // 로컬 변경 있으면 업로드 우선
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
      if (error || !remote) { setSyncStatus('⚠️ 클라우드 동기화 실패'); return; }
      const remoteTs = remote.updated_at ? new Date(remote.updated_at).getTime() : 0;
      const localTs  = parseInt(localStorage.getItem(LS_BACKUP_TS) || '0', 10);
      if (remoteTs > localTs + 1000 && _remoteHasData(remote)) {
        // 다른 기기에서 변경된 최신 데이터 적용
        console.log('[sync] foreground re-sync: 클라우드 최신 적용');
        applyPersistedState(remote);
        lastSavedSnapshot = stateSnapshot();
        _saveLocal();
        autoReturnExpiredTasks();
        renderApp();
        setSyncSaved();
      } else {
        setSyncSaved();
      }
    })
    .catch(() => setSyncStatus('⚠️ 클라우드 동기화 실패'));
}

window.addEventListener('beforeunload', flushToSupabase);
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden') {
    flushToSupabase();
  } else {
    // foreground 복귀 — 다른 기기 변경사항 체크
    _reSyncFromCloud();
  }
});
// 10분마다 백그라운드 sync (탭을 오래 열어둔 경우)
setInterval(flushToSupabase, 10 * 60 * 1000);

// ──────────────────────────────────────────────
// 데이터 불러오기
// Phase 1: localStorage 즉시 복원 → 바로 렌더
// Phase 2: Supabase 백그라운드 체크 (타임아웃 8초)
// ──────────────────────────────────────────────

// Supabase 요청에 타임아웃을 붙이는 래퍼
function _supabaseWithTimeout(promise, ms = 8000) {
  return Promise.race([
    promise,
    new Promise((_, reject) =>
      setTimeout(() => reject(new Error('TIMEOUT')), ms)
    )
  ]);
}

// 재시도 버튼 표시 (로컬 데이터도 없고 클라우드도 실패한 경우)
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
  loadInProgress = true;
  // 안전 타임아웃: 15초 후에도 끝나지 않으면 잠금 해제
  const _loadGuard = setTimeout(() => { loadInProgress = false; }, 15000);

  // ── Phase 1: localStorage 즉시 복원 ──
  const local = _loadLocal();
  if (local) {
    applyPersistedState(local.data);
    lastSavedSnapshot = stateSnapshot();
    dataLoaded = true;
    autoReturnExpiredTasks();
    renderApp();
    showLastSavedTime();
    checkFirstVisit();
    setSyncStatus('☁️ 동기화 확인 중...');
  } else {
    setSyncStatus('☁️ 불러오는 중...');
  }

  // ── Phase 2: Supabase에서 항상 최신 데이터 가져오기 ──
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
      if (!local) { dataLoaded = true; renderApp(); _showRetryButton(); }
      setSyncStatus('⚠️ 클라우드 동기화 실패');
      return;
    }

    if (_remoteHasData(remote)) {
      // 클라우드에 데이터 있음 → 항상 클라우드 우선 적용
      applyPersistedState(remote);
      lastSavedSnapshot = stateSnapshot();
      _localChangePending = false;
      _saveLocal();
    } else if (hasAnyTaskData()) {
      // 클라우드 비어있고 로컬에 데이터 있음 → 로컬 보호 후 업로드
      console.warn('[sync] 클라우드 비어있음 — 로컬 데이터 업로드');
      supabaseClient.from('user_states')
        .upsert(_supabaseSavePayload(), { onConflict: 'user_id' })
        .then(({ error }) => { if (!error) { _localChangePending = false; setSyncSaved(); } });
    }

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
    if (!local) {
      // 로컬 데이터도 없고 타임아웃/에러 → 재시도 버튼
      dataLoaded = true;
      renderApp();
      _showRetryButton();
      setSyncStatus('⚠️ 불러오기 실패 — 재시도하세요');
    } else {
      // 로컬 데이터는 있으므로 이미 렌더됨 — 그냥 경고만
      setSyncStatus('⚠️ 클라우드 동기화 실패');
    }
  });
}
