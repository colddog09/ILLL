/* ============================================================
   script.js — 상태(state) 및 Supabase 코어
   (유틸: utils.js / 렌더링: render.js / 드래그: drag.js
    기한UI: deadline.js / 이벤트: events.js)
   ============================================================ */

'use strict';

// ──────────────────────────────────────────────
// 상수 및 상태
// ──────────────────────────────────────────────
const STORAGE_KEYS = {
  pool:     'taskPool_v2',
  schedule: 'taskSchedule_v2',
  links:    'userLinks_v1'
};
const DEFAULT_STATE = {
  pool:     [],
  schedule: {},
  dayOffset: 0,
  links:    []
};

let state      = { ...DEFAULT_STATE };
let dragInfo   = null;
let gcalEvents = {}; // 캘린더에서 가져온 이벤트 (DB 저장 안 함)

// ──────────────────────────────────────────────
// Supabase
// ──────────────────────────────────────────────
let supabaseClient       = null;
let currentUser          = null;
let supabaseReady        = false;
let lastSavedSnapshot    = null; // 마지막 저장 상태 (변경 감지용)
let dataLoaded           = false; // DB에서 최소 한 번 읽은 뒤 true (저장 잠금용)
let loadInProgress       = false; // 중복 loadState() 방지

function setSyncStatus(message) {
  const el = document.getElementById('syncStatus');
  if (el) el.textContent = message;
}
function setSyncSaved() {
  const now = new Date();
  const h = String(now.getHours()).padStart(2, '0');
  const m = String(now.getMinutes()).padStart(2, '0');
  const label = `${h}:${m}`;
  localStorage.setItem('lastSavedLabel', label);
  setSyncStatus(`☁️ ${label} 저장됨`);
}
function showLastSavedTime() {
  const label = localStorage.getItem('lastSavedLabel');
  if (label) setSyncStatus(`☁️ ${label} 저장됨`);
}

function isStandaloneApp() {
  return window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true;
}

// Google 로그인 (캘린더 scope 포함 — refresh token 발급을 위해)
async function startGoogleLogin() {
  if (!supabaseClient || !supabaseReady) {
    alert('서비스에 연결하는 중입니다. 잠시 후 다시 시도해주세요.');
    return;
  }
  const { error } = await supabaseClient.auth.signInWithOAuth({
    provider: 'google',
    options: {
      redirectTo: window.location.origin,
      scopes: 'https://www.googleapis.com/auth/calendar',
      queryParams: {
        access_type: 'offline',
        prompt: 'consent'   // 매번 동의화면 표시 → refresh token 재발급 보장
      }
    }
  });
  if (error) {
    console.error('로그인 오류:', error);
    alert('로그인 중 오류가 발생했습니다: ' + error.message);
  }
}

// Google Calendar refresh token DB 저장
async function _storeGcalRefreshToken(refreshToken) {
  if (!refreshToken || !currentUser || !supabaseClient) return;
  try {
    await supabaseClient
      .from('user_states')
      .upsert({ user_id: currentUser.id, gcal_refresh_token: refreshToken },
               { onConflict: 'user_id' });
    localStorage.setItem('gcal_connected', '1');
    console.log('✅ 캘린더 refresh token 저장됨 (영구 연동 활성화)');
  } catch (e) {
    console.warn('refresh token 저장 실패:', e);
  }
}

// Google 로그인 에러 핸들러 (events.js 호환용)
function handleGoogleAuthError(err) {
  if (!err) return;
  console.error('Google 로그인 오류:', err);
  if (err.message) alert('로그인 중 오류가 발생했습니다: ' + err.message);
}

// 로그아웃
async function signOut() {
  if (!supabaseClient) return;
  resetScheduleState();
  await supabaseClient.auth.signOut();
  renderApp();
}

const _CFG_CACHE_KEY = 'app_config_cache_v1';
const _CFG_CACHE_TTL = 24 * 60 * 60 * 1000; // 24시간

function _loadCachedConfig() {
  try {
    const raw = localStorage.getItem(_CFG_CACHE_KEY);
    if (!raw) return null;
    const { cfg, ts } = JSON.parse(raw);
    if (Date.now() - ts > _CFG_CACHE_TTL) return null;
    return cfg;
  } catch (_) { return null; }
}

function _saveCachedConfig(cfg) {
  try { localStorage.setItem(_CFG_CACHE_KEY, JSON.stringify({ cfg, ts: Date.now() })); } catch (_) {}
}

async function bootstrapSupabase() {
  try {
    // 1) 캐시된 config로 즉시 초기화
    const cached = _loadCachedConfig();
    let cfg;
    if (cached && cached.supabaseUrl) {
      cfg = cached;
      // 백그라운드에서 최신 config 갱신
      fetch('/api/config').then(r => r.json()).then(fresh => {
        _saveCachedConfig(fresh);
        if (fresh.googleClientId) window.__GCAL_CLIENT_ID__ = fresh.googleClientId;
      }).catch(() => {});
    } else {
      // 2) 캐시 없으면 네트워크 요청
      const response = await fetch('/api/config');
      if (!response.ok) throw new Error('config fetch failed: ' + response.status);
      cfg = await response.json();
      _saveCachedConfig(cfg);
    }

    if (cfg.googleClientId) window.__GCAL_CLIENT_ID__ = cfg.googleClientId;

    // Supabase 클라이언트 생성
    const { createClient } = window.supabase;
    supabaseClient = createClient(cfg.supabaseUrl, cfg.supabaseAnonKey);
    supabaseReady = true;

    // Auth 상태 변경 리스너
    supabaseClient.auth.onAuthStateChange((event, session) => {
      updateAuthUi(session?.user || null);
      // OAuth 로그인 직후에만 provider_refresh_token 포함됨 → 즉시 저장
      if (event === 'SIGNED_IN' && session?.provider_refresh_token) {
        _storeGcalRefreshToken(session.provider_refresh_token);
      }
    });

    // 현재 세션 확인 (리다이렉트 복귀 포함)
    const { data: { session } } = await supabaseClient.auth.getSession();
    if (!session) {
      // 세션 없으면 로그인 화면 표시
      updateAuthUi(null);
    }

  } catch (err) {
    console.error('Supabase 초기화 실패:', err);
    showLoginScreen();
    renderPool(); renderWeek();
  }
}

bootstrapSupabase();

// 5초 안에 로그인 안 되면 로그인 화면 표시 (네트워크 불량 대비)
setTimeout(() => {
  if (currentUser) return;
  showLoginScreen();
}, 5000);

// ──────────────────────────────────────────────
// 공유 DOM 레퍼런스 (render.js / drag.js가 로드 전 참조)
// ──────────────────────────────────────────────
const poolEl    = document.getElementById('taskPool');
const dayGrid   = document.getElementById('dayGrid');
const weekLabel = document.getElementById('weekLabel');
const ghost     = document.getElementById('dragGhost');
const trashZone = document.getElementById('trashZone');
const taskInput = document.getElementById('taskInput');

// ──────────────────────────────────────────────
// 상태 관리
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

// 현재 state를 문자열로 직렬화 (변경 감지용)
function stateSnapshot() {
  return JSON.stringify({ pool: state.pool, schedule: state.schedule, links: state.links });
}

// 실제 할일 데이터가 있는지 확인 (빈 state 저장 방지용)
function hasAnyTaskData() {
  if (state.pool && state.pool.length > 0) return true;
  if (state.schedule) {
    for (const k of Object.keys(state.schedule)) {
      if (Array.isArray(state.schedule[k]) && state.schedule[k].length > 0) return true;
    }
  }
  return false;
}

// localStorage 백업 저장 (데이터 유실 복구용)
const BACKUP_KEY = 'taskBackup_v1';
function saveBackup() {
  if (!hasAnyTaskData()) return;
  try {
    localStorage.setItem(BACKUP_KEY, JSON.stringify({
      pool: state.pool,
      schedule: state.schedule,
      links: state.links,
      ts: Date.now()
    }));
  } catch (_) {}
}
function loadBackup() {
  try {
    const raw = localStorage.getItem(BACKUP_KEY);
    if (!raw) return null;
    return JSON.parse(raw);
  } catch (_) { return null; }
}

function loadState() {
  if (!currentUser || !supabaseClient) {
    resetScheduleState();
    dataLoaded = false;
    renderApp();
    return;
  }

  // 중복 호출 방지
  if (loadInProgress) return;
  loadInProgress = true;
  dataLoaded = false;

  // 1) 로컬 데이터 먼저 즉시 표시
  const localState = readLocalState();
  if (hasLocalState(localState)) {
    applyPersistedState(localState);
    autoReturnExpiredTasks();
    renderApp();
  }

  // 2) Supabase에서 읽어 최신 데이터로 덮어씀
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
        const remoteTime = remote.updated_at ? new Date(remote.updated_at).getTime() : 0;
        const localTime  = parseInt(localStorage.getItem('lastSavedTime') || '0');
        const remoteHasData = (remote.pool?.length > 0) ||
          Object.values(remote.schedule || {}).some(v => Array.isArray(v) && v.length > 0);

        if (remoteTime > localTime || (!hasAnyTaskData() && remoteHasData)) {
          applyPersistedState(remote);
          persistLocalState();
          lastSavedSnapshot = stateSnapshot();
        } else {
          lastSavedSnapshot = stateSnapshot();
        }
        if (hasAnyTaskData()) saveBackup();
      } else {
        // 서버에 없으면 로컬 데이터를 서버에 저장
        const local = readLocalState();
        if (hasLocalState(local)) {
          _doSave();
        } else {
          const backup = loadBackup();
          if (backup && (backup.pool?.length > 0 || Object.keys(backup.schedule || {}).length > 0)) {
            console.warn('⚠️ 백업 데이터로 복구합니다', backup.ts);
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
    .upsert({
      user_id:    currentUser.id,
      pool:       state.pool,
      schedule:   state.schedule,
      links:      state.links || [],
      updated_at: new Date().toISOString()
    }, { onConflict: 'user_id' })
    .then(({ error }) => {
      if (error) { console.error('Supabase 저장 에러:', error); return; }
      lastSavedSnapshot = snap;
      setSyncSaved();
    });
}

// saveState = 로컬 즉시 저장 + Supabase debounce 자동 업로드 (1.5초)
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
      .upsert({
        user_id:    currentUser.id,
        pool:       state.pool,
        schedule:   state.schedule,
        links:      state.links || [],
        updated_at: new Date().toISOString()
      }, { onConflict: 'user_id' })
      .then(({ error }) => {
        if (error) { console.error('saveState Supabase 오류:', error); setSyncStatus('❌ 저장 실패'); return; }
        lastSavedSnapshot = snap;
        setSyncSaved();
      });
  }, 1500);
}

// 앱 종료/백그라운드 전환 시 Supabase에 저장
function flushToSupabase() {
  if (!currentUser || !supabaseClient) return;
  if (!dataLoaded) return;

  const snap = stateSnapshot();
  if (snap === lastSavedSnapshot) return;

  if (!hasAnyTaskData() && !hasLocalState(readLocalState())) {
    console.warn('⚠️ 빈 state 감지 — flushToSupabase 건너뜀');
    return;
  }

  supabaseClient
    .from('user_states')
    .upsert({
      user_id:    currentUser.id,
      pool:       state.pool,
      schedule:   state.schedule,
      links:      state.links || [],
      updated_at: new Date().toISOString()
    }, { onConflict: 'user_id' })
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

// 10분마다 자동 업로드
setInterval(flushToSupabase, 10 * 60 * 1000);


// ──────────────────────────────────────────────
// 인증 UI
// ──────────────────────────────────────────────
function updateStandaloneAuthHint(user = currentUser) {
  const authHint = document.getElementById('authHint');
  if (!authHint) return;
  authHint.hidden = !!user || !isStandaloneApp();
}

function hideLoginScreen() {
  const screen = document.getElementById('loginScreen');
  if (!screen) return;
  screen.classList.add('hidden');
  setTimeout(() => { screen.style.display = 'none'; }, 400);
}

function showLoginScreen() {
  const screen = document.getElementById('loginScreen');
  if (!screen) return;
  screen.style.display = 'flex';
  requestAnimationFrame(() => screen.classList.remove('hidden'));
}

// 모든 스크립트 로드 후 로컬 데이터 즉시 렌더
setTimeout(() => {
  if (currentUser) return;
  const localState = readLocalState();
  if (hasLocalState(localState)) {
    applyPersistedState(localState);
    if (typeof autoReturnExpiredTasks === 'function') autoReturnExpiredTasks();
    if (typeof renderApp === 'function') renderApp();
  }
}, 0);

// 첫 방문자 감지
function checkFirstVisit() {
  if (!localStorage.getItem('seenDemo')) {
    localStorage.setItem('seenDemo', '1');
    setTimeout(() => {
      const demoBtn = document.getElementById('demoBtn');
      if (demoBtn) demoBtn.click();
    }, 800);
  }
}

function updateAuthUi(user) {
  currentUser = user || null;

  const fbLoginBtn = document.getElementById('loginBtn');
  const userInfo   = document.getElementById('userInfo');
  const userPhoto  = document.getElementById('userPhoto');
  const userName   = document.getElementById('userName');

  if (user) {
    hideLoginScreen();
  } else {
    showLoginScreen();
  }

  if (fbLoginBtn) fbLoginBtn.hidden = !!user;
  if (userInfo)   userInfo.hidden   = !user;
  if (userPhoto)  userPhoto.src     = user?.user_metadata?.avatar_url || user?.user_metadata?.picture || '';
  if (userName)   userName.textContent = user?.user_metadata?.full_name || user?.user_metadata?.name || user?.email || '사용자';

  setTaskInputEnabled(!!user);
  updateStandaloneAuthHint(user);
  loadState();

  // 캘린더 토큰 복원
  if (user && typeof gcalLoadStoredToken === 'function') {
    const restored = gcalLoadStoredToken();
    if (typeof updateGcalUI === 'function') updateGcalUI();
    if (restored) {
      if (typeof gcalImportCurrentDate === 'function') gcalImportCurrentDate();
      if (typeof gcalStartPolling === 'function') gcalStartPolling();
    } else if (typeof isGcalConnected === 'function' && isGcalConnected()) {
      gcalSilentConnect().then(ok => {
        if (typeof updateGcalUI === 'function') updateGcalUI();
        if (ok) {
          if (typeof gcalImportCurrentDate === 'function') gcalImportCurrentDate();
          if (typeof gcalStartPolling === 'function') gcalStartPolling();
        }
      });
    }
  }
}
