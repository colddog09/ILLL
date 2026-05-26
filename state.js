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
let dataLoaded        = false;
let loadInProgress    = false;
let lastSavedSnapshot = null;

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
// localStorage 백업 (새로고침 중 비동기 저장 실패 방지)
// ──────────────────────────────────────────────
const LS_BACKUP_KEY  = 'state_backup_v1';
const LS_BACKUP_TS   = 'state_backup_ts_v1';
const LS_BACKUP_UID  = 'state_backup_uid_v1';

function _saveLocalBackup() {
  if (!dataLoaded || !currentUser) return;
  try {
    const snap = stateSnapshot();
    if (!lastSavedSnapshot && !hasAnyTaskData()) return; // 빈 초기 state 저장 금지
    const ts = Date.now();
    localStorage.setItem(LS_BACKUP_KEY, snap);
    localStorage.setItem(LS_BACKUP_TS,  ts.toString());
    localStorage.setItem(LS_BACKUP_UID, currentUser.id);
  } catch (_) {}
}

function _loadLocalBackup() {
  try {
    const uid  = localStorage.getItem(LS_BACKUP_UID);
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

// 즉시 저장 (loadState 내부에서 직접 호출)
function _doSave() {
  localStorage.setItem('lastSavedTime', Date.now().toString());
  if (!currentUser || !supabaseClient) { setSyncStatus('⚠️ 로그인 필요'); return; }

  const snap = stateSnapshot();
  if (snap === lastSavedSnapshot) return;
  // lastSavedSnapshot이 없으면 아직 로드 전 — 빈 state로 덮어쓰기 방지
  if (!lastSavedSnapshot && !hasAnyTaskData()) {
    console.warn('⚠️ 초기 빈 state 감지 — Supabase 저장 건너뜀');
    return;
  }

  _saveLocalBackup(); // 동기 백업 먼저
  supabaseClient
    .from('user_states')
    .upsert(_supabaseSavePayload(), { onConflict: 'user_id' })
    .then(({ error }) => {
      if (error) { console.error('Supabase 저장 에러:', error); return; }
      lastSavedSnapshot = snap;
      setSyncSaved();
    });
}

// debounce 저장 (UI 변경 직후 호출)
let _saveTimer = null;
function saveState() {
  localStorage.setItem('lastSavedTime', Date.now().toString());
  setSyncStatus('📝 저장 중...');

  clearTimeout(_saveTimer);
  _saveTimer = setTimeout(() => {
    if (!currentUser || !supabaseClient || !dataLoaded) return;
    const snap = stateSnapshot();
    if (snap === lastSavedSnapshot) { showLastSavedTime(); return; }
    if (!lastSavedSnapshot && !hasAnyTaskData()) return;

    _saveLocalBackup(); // 동기 백업 먼저
    supabaseClient
      .from('user_states')
      .upsert(_supabaseSavePayload(), { onConflict: 'user_id' })
      .then(({ error }) => {
        if (error) { setSyncStatus('❌ 저장 실패'); return; }
        lastSavedSnapshot = snap;
        setSyncSaved();
      });
  }, 1500);
}

// 앱 종료/백그라운드 전환 시 즉시 동기화
function flushToSupabase() {
  if (!currentUser || !supabaseClient || !dataLoaded) return;
  const snap = stateSnapshot();
  if (snap === lastSavedSnapshot) return;
  if (!lastSavedSnapshot && !hasAnyTaskData()) return;

  _saveLocalBackup(); // 동기이므로 페이지 언로드 전에 확실히 저장됨
  supabaseClient
    .from('user_states')
    .upsert(_supabaseSavePayload(), { onConflict: 'user_id' })
    .then(({ error }) => {
      if (error) { setSyncStatus('❌ 저장 실패'); return; }
      lastSavedSnapshot = snap;
      localStorage.setItem('lastSavedTime', Date.now().toString());
      setSyncSaved();
    });
}

window.addEventListener('beforeunload', flushToSupabase);
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden') flushToSupabase();
});
setInterval(flushToSupabase, 10 * 60 * 1000);

// ──────────────────────────────────────────────
// 데이터 불러오기 (Supabase 단독)
// ──────────────────────────────────────────────
function loadState() {
  if (!currentUser || !supabaseClient) {
    resetScheduleState();
    dataLoaded = false;
    renderApp();
    return;
  }
  if (loadInProgress) return;
  loadInProgress = true;
  dataLoaded = false;

  setSyncStatus('☁️ 불러오는 중...');

  supabaseClient
    .from('user_states')
    .select('pool, schedule, links, updated_at')
    .eq('user_id', currentUser.id)
    .maybeSingle()
    .then(({ data: remote, error }) => {
      loadInProgress = false;

      if (error) {
        console.error('Supabase 읽기 에러:', error);
        dataLoaded = true;
        setSyncStatus('❌ 불러오기 실패');
        renderApp();
        return;
      }

      const remoteTs = remote?.updated_at ? new Date(remote.updated_at).getTime() : 0;
      const backup   = _loadLocalBackup();
      const backupTs = backup?.ts || 0;

      if (backup && backupTs > remoteTs + 3000) {
        // localStorage 백업이 Supabase보다 3초 이상 최신 → 백업 우선 사용
        console.log(`🔄 로컬 백업 복원 (backup: ${new Date(backupTs).toLocaleTimeString()}, remote: ${new Date(remoteTs).toLocaleTimeString()})`);
        applyPersistedState(backup.data);
        lastSavedSnapshot = stateSnapshot();
        // 바로 Supabase에 반영
        supabaseClient
          .from('user_states')
          .upsert(_supabaseSavePayload(), { onConflict: 'user_id' })
          .then(({ error }) => { if (!error) setSyncSaved(); });
      } else if (remote) {
        applyPersistedState(remote);
        localStorage.setItem('lastSavedTime', remote.updated_at
          ? new Date(remote.updated_at).getTime().toString()
          : Date.now().toString());
        lastSavedSnapshot = stateSnapshot();
        _saveLocalBackup(); // Supabase 데이터로 백업 동기화
      }
      // remote도 없고 backup도 없으면 빈 state 유지 (신규 사용자)

      dataLoaded = true;
      autoReturnExpiredTasks();
      renderApp();
      showLastSavedTime();
      checkFirstVisit();
    });
}
