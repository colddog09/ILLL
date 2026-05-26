/* ============================================================
   auth.js — Supabase 초기화 + 인증 UI
   (state.js 뒤, render.js 앞에 로드)
   ============================================================ */

'use strict';

// ──────────────────────────────────────────────
// Supabase 클라이언트 & 인증 상태
// ──────────────────────────────────────────────
let supabaseClient = null;
let currentUser    = null;
let supabaseReady  = false;

// ──────────────────────────────────────────────
// 동기화 상태 표시
// ──────────────────────────────────────────────
function setSyncStatus(message) {
  const el = document.getElementById('syncStatus');
  if (el) el.textContent = message;
}

function setSyncSaved() {
  const now   = new Date();
  const label = `${String(now.getHours()).padStart(2,'0')}:${String(now.getMinutes()).padStart(2,'0')}`;
  localStorage.setItem('lastSavedLabel', label);
  setSyncStatus(`☁️ ${label} 저장됨`);
}

function showLastSavedTime() {
  const label = localStorage.getItem('lastSavedLabel');
  if (label) setSyncStatus(`☁️ ${label} 저장됨`);
}

// ──────────────────────────────────────────────
// 유틸
// ──────────────────────────────────────────────
function isStandaloneApp() {
  return window.matchMedia('(display-mode: standalone)').matches
      || window.navigator.standalone === true;
}

// ──────────────────────────────────────────────
// 로그인 / 로그아웃
// ──────────────────────────────────────────────
async function startGoogleLogin() {
  if (!supabaseClient || !supabaseReady) {
    alert('서비스에 연결하는 중입니다. 잠시 후 다시 시도해주세요.');
    return;
  }
  // 캘린더 scope는 로그인과 분리 — 설정에서 별도 연결
  const { error } = await supabaseClient.auth.signInWithOAuth({
    provider: 'google',
    options: {
      redirectTo: window.location.origin
    }
  });
  if (error) {
    console.error('로그인 오류:', error);
    alert('로그인 중 오류가 발생했습니다: ' + error.message);
  }
}

async function _storeGcalRefreshToken(refreshToken) {
  if (!refreshToken || !currentUser || !supabaseClient) return;
  try {
    await supabaseClient
      .from('user_states')
      .upsert({ user_id: currentUser.id, gcal_refresh_token: refreshToken }, { onConflict: 'user_id' });
    localStorage.setItem('gcal_connected', '1');
  } catch (e) {
    console.warn('refresh token 저장 실패:', e);
  }
}

function handleGoogleAuthError(err) {
  if (!err) return;
  console.error('Google 로그인 오류:', err);
  if (err.message) alert('로그인 중 오류가 발생했습니다: ' + err.message);
}

async function signOut() {
  if (!supabaseClient) return;
  resetScheduleState();
  await supabaseClient.auth.signOut();
  renderApp();
}

// ──────────────────────────────────────────────
// Config 캐시 (24시간)
// ──────────────────────────────────────────────
const _CFG_CACHE_KEY = 'app_config_cache_v1';
const _CFG_CACHE_TTL = 24 * 60 * 60 * 1000;

function _loadCachedConfig() {
  try {
    const { cfg, ts } = JSON.parse(localStorage.getItem(_CFG_CACHE_KEY) || '{}');
    return (cfg && Date.now() - ts < _CFG_CACHE_TTL) ? cfg : null;
  } catch (_) { return null; }
}

function _saveCachedConfig(cfg) {
  try { localStorage.setItem(_CFG_CACHE_KEY, JSON.stringify({ cfg, ts: Date.now() })); } catch (_) {}
}

// ──────────────────────────────────────────────
// Supabase 초기화
// ──────────────────────────────────────────────
async function bootstrapSupabase() {
  try {
    const cached = _loadCachedConfig();
    let cfg;

    if (cached?.supabaseUrl) {
      cfg = cached;
      // 백그라운드에서 최신 config 갱신
      fetch('/api/config').then(r => r.json()).then(fresh => {
        _saveCachedConfig(fresh);
        if (fresh.googleClientId) window.__GCAL_CLIENT_ID__ = fresh.googleClientId;
      }).catch(() => {});
    } else {
      const response = await fetch('/api/config');
      if (!response.ok) throw new Error('config fetch failed: ' + response.status);
      cfg = await response.json();
      _saveCachedConfig(cfg);
    }

    if (cfg.googleClientId) window.__GCAL_CLIENT_ID__ = cfg.googleClientId;

    supabaseClient = window.supabase.createClient(cfg.supabaseUrl, cfg.supabaseAnonKey);
    supabaseReady  = true;

    supabaseClient.auth.onAuthStateChange((event, session) => {
      updateAuthUi(session?.user || null);
    });

    const { data: { session } } = await supabaseClient.auth.getSession();
    if (!session) updateAuthUi(null);

  } catch (err) {
    console.error('Supabase 초기화 실패:', err);
    showLoginScreen();
    renderPool();
    renderWeek();
  }
}

bootstrapSupabase();

// 5초 안에 로그인 안 되면 로그인 화면 표시
setTimeout(() => { if (!currentUser) showLoginScreen(); }, 5000);

// ──────────────────────────────────────────────
// 인증 UI
// ──────────────────────────────────────────────
function updateStandaloneAuthHint(user = currentUser) {
  const el = document.getElementById('authHint');
  if (el) el.hidden = !!user || !isStandaloneApp();
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

function checkFirstVisit() {
  if (!localStorage.getItem('dontShowDemo')) {
    setTimeout(() => document.getElementById('demoBtn')?.click(), 800);
  }
}

function updateAuthUi(user) {
  currentUser = user || null;

  if (user) { hideLoginScreen(); } else { showLoginScreen(); }

  const loginBtn  = document.getElementById('loginBtn');
  const userInfo  = document.getElementById('userInfo');
  const userPhoto = document.getElementById('userPhoto');
  const userName  = document.getElementById('userName');

  if (loginBtn)  loginBtn.hidden  = !!user;
  if (userInfo)  userInfo.hidden  = !user;
  if (userPhoto) userPhoto.src    = user?.user_metadata?.avatar_url || user?.user_metadata?.picture || '';
  if (userName)  userName.textContent = user?.user_metadata?.full_name || user?.user_metadata?.name || user?.email || '사용자';

  setTaskInputEnabled(!!user);
  updateStandaloneAuthHint(user);
  loadState();

  // 캘린더 토큰 복원
  if (user && typeof gcalLoadStoredToken === 'function') {
    const restored = gcalLoadStoredToken();
    if (typeof updateGcalUI === 'function') updateGcalUI();
    if (restored) {
      gcalImportCurrentDate?.();
      gcalStartPolling?.();
    } else if (typeof isGcalConnected === 'function' && isGcalConnected()) {
      gcalSilentConnect().then(ok => {
        if (typeof updateGcalUI === 'function') updateGcalUI();
        if (ok) { gcalImportCurrentDate?.(); gcalStartPolling?.(); }
      });
    }
  }
}

