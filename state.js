/* ============================================================
   state.js — 앱 상태 관리 + Supabase 저장/불러오기
   (auth.js, utils.js보다 뒤, render.js보다 앞에 로드)
   ============================================================ */

'use strict';

// ──────────────────────────────────────────────
// 상수 & 초기 상태
// ──────────────────────────────────────────────
const STORAGE_KEYS = {
  pool:     'taskPool_v2',
  schedule: 'taskSchedule_v2',
  links:    'userLinks_v1'
};

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
// 저장 관련 플래그 (auth.js도 참조)
// ──────────────────────────────────────────────
let dataLoaded        = false;  // DB에서 최소 한 번 읽은 뒤 true
let loadInProgress    = false;  // 중복 loadState() 방지
let lastSavedSnapshot = null;   // 변경 감지용

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

function readLocalState() {
  return {
    pool:     JSON.parse(localStorage.getItem(STORAGE_KEYS.pool)),
    schedule: JSON.parse(localStorage.getItem(STORAGE_KEYS.schedule)),
    links:    JSON.parse(localStorage.getItem(STORAGE_KEYS.links))
  };
}

function hasLocalState(data) {
  return !!(data.pool || data.schedule || data.links);
}

function persistLocalState() {
  localStorage.setItem(STORAGE_KEYS.pool,     JSON.stringify(state.pool));
  localStorage.setItem(STORAGE_KEYS.schedule, JSON.stringify(state.schedule));
  localStorage.setItem(STORAGE_KEYS.links,    JSON.stringify(state.links));
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
// 데이터 유효성 + 백업
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

const BACKUP_KEY = 'taskBackup_v1';

function saveBackup() {
  if (!hasAnyTaskData()) return;
  try {
    localStorage.setItem(BACKUP_KEY, JSON.stringify({
      pool: state.pool, schedule: state.schedule, links: state.links, ts: Date.now()
    }));
  } catch (_) {}
}

function loadBackup() {
  try {
    const raw = localStorage.getItem(BACKUP_KEY);
    return raw ? JSON.parse(raw) : null;
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

// 즉시 저장 (loadState 내부 + flushToSupabase 등에서 직접 호출)
function _doSave() {
  persistLocalState();
  localStorage.setItem('lastSavedTime', Date.now().toString());
  if (hasAnyTaskData()) saveBackup();

  if (!currentUser || !supabaseClient) { setSyncStatus('💾 로컬 저장됨'); return; }

  const snap = stateSnapshot();
  if (snap === lastSavedSnapshot) return;
  if (!hasAnyTaskData() && !hasLocalState(readLocalState())) {
    console.warn('⚠️ 빈 state 감지 — Supabase 저장 건너뜀');
    return;
  }

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
  persistLocalState();
  localStorage.setItem('lastSavedTime', Date.now().toString());
  if (hasAnyTaskData()) saveBackup();
  setSyncStatus('📝 저장 중...');

  clearTimeout(_saveTimer);
  _saveTimer = setTimeout(() => {
    if (!currentUser || !supabaseClient || !dataLoaded) return;
    const snap = stateSnapshot();
    if (snap === lastSavedSnapshot) { showLastSavedTime(); return; }
    if (!hasAnyTaskData()) return;

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
  if (!hasAnyTaskData() && !hasLocalState(readLocalState())) return;

  supabaseClient
    .from('user_states')
    .upsert(_supabaseSavePayload(), { onConflict: 'user_id' })
    .then(({ error }) => {
      if (error) { setSyncStatus('❌ 저장 실패'); return; }
      lastSavedSnapshot = snap;
      persistLocalState();
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
// 데이터 불러오기
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

  // 1) 로컬 데이터 즉시 표시
  const localState = readLocalState();
  if (hasLocalState(localState)) {
    applyPersistedState(localState);
    autoReturnExpiredTasks();
    renderApp();
  }

  // 2) Supabase에서 최신 데이터로 갱신
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
        setSyncStatus('❌ 불러오기 실패 — 로컬 데이터 사용 중');
        renderApp();
        return;
      }

      if (remote) {
        // 서버 데이터가 있으면 항상 서버 우선 (기기간 동기화)
        applyPersistedState(remote);
        persistLocalState();
        localStorage.setItem('lastSavedTime', remote.updated_at
          ? new Date(remote.updated_at).getTime().toString()
          : Date.now().toString());
        lastSavedSnapshot = stateSnapshot();
        if (hasAnyTaskData()) saveBackup();
      } else {
        // 서버에 없으면 로컬 → 서버 업로드
        const local = readLocalState();
        if (hasLocalState(local)) {
          _doSave();
        } else {
          const backup = loadBackup();
          if (backup?.pool?.length > 0 || Object.keys(backup?.schedule || {}).length > 0) {
            console.warn('⚠️ 백업 데이터로 복구:', backup.ts);
            applyPersistedState(backup);
            persistLocalState();
            _doSave();
          }
        }
      }

      dataLoaded = true;
      autoReturnExpiredTasks();
      renderApp();
      showLastSavedTime();
      checkFirstVisit();
    });
}
