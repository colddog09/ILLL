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
window.authResolved = false;

// ──────────────────────────────────────────────
// 동기화 상태 표시
// ──────────────────────────────────────────────
let _mobileToastTimer = null;

function setSyncStatus(message) {
  // 데스크탑: 헤더 인라인 표시
  const el = document.getElementById('syncStatus');
  if (el) el.textContent = message;

  // 모바일(768px 이하): 중요한 상태만 하단 토스트로 표시
  if (window.innerWidth > 768) return;
  const isIdle = message.includes('저장됨'); // 저장됨은 토스트 불필요

  // 저장 성공 시 에러 토스트가 남아있으면 제거
  if (isIdle) {
    clearTimeout(_mobileToastTimer);
    const oldToast = document.getElementById('syncToast');
    if (oldToast) {
      oldToast.style.opacity = '0';
      setTimeout(() => oldToast.remove(), 260);
    }
    return;
  }

  clearTimeout(_mobileToastTimer);
  let toast = document.getElementById('syncToast');
  if (!toast) {
    toast = document.createElement('div');
    toast.id = 'syncToast';
    toast.style.cssText = [
      'position:fixed','bottom:72px','left:50%','transform:translateX(-50%)',
      'background:rgba(30,27,75,0.92)','color:#fff',
      'font-size:0.78rem','font-weight:600',
      'padding:8px 16px','border-radius:20px','z-index:9998',
      'white-space:nowrap','pointer-events:none',
      'transition:opacity 0.25s ease','opacity:0'
    ].join(';');
    document.body.appendChild(toast);
    requestAnimationFrame(() => { toast.style.opacity = '1'; });
  }
  toast.textContent = message;
  toast.style.opacity = '1';

  // 오류가 아닌 일시 상태(동기화 중 등)는 3초 후 자동 제거
  if (!message.includes('실패') && !message.includes('오프라인')) {
    _mobileToastTimer = setTimeout(() => {
      toast.style.opacity = '0';
      setTimeout(() => toast.remove(), 260);
    }, 3000);
  }
}

let _lastSavedLabel = '';

function setSyncSaved() {
  const now = new Date();
  _lastSavedLabel = `${String(now.getHours()).padStart(2,'0')}:${String(now.getMinutes()).padStart(2,'0')}`;
  setSyncStatus(`☁️ ${_lastSavedLabel} 저장됨`);
}

function showLastSavedTime() {
  if (_lastSavedLabel) setSyncStatus(`☁️ ${_lastSavedLabel} 저장됨`);
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
      redirectTo: window.location.origin,
      queryParams: { prompt: 'select_account' }   // 항상 계정 선택 화면 표시
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
      if (event === 'TOKEN_REFRESHED' || event === 'USER_UPDATED') {
        const prev = currentUser;
        currentUser = session?.user || null;
        // SIGNED_OUT 후 토큰 갱신으로 유저가 복구된 경우 → 데이터/UI 재복구
        if (!prev && currentUser) updateAuthUi(currentUser);
        return;
      }
      updateAuthUi(session?.user || null);
    });

    const { data: { session } } = await supabaseClient.auth.getSession();
    if (!session) updateAuthUi(null);

  } catch (err) {
    console.error('Supabase 초기화 실패:', err);
    window.authResolved = true;
    showLoginScreen();
    showNetworkHint(); // 네트워크 오류 → 즉시 안내
    renderPool();
    renderWeek();
  }
}

bootstrapSupabase();

// 5초 안에 로그인 안 되면 로그인 화면 표시
setTimeout(() => { if (!currentUser) showLoginScreen(); }, 5000);

// 12초 후에도 로그인 안 되면 재시도 안내
setTimeout(() => { if (!currentUser) showNetworkHint(); }, 12000);

function showNetworkHint() {
  if (document.getElementById('networkHint')) return; // 중복 방지

  // 상호작용 차단 오버레이
  const backdrop = document.createElement('div');
  backdrop.id = 'networkBackdrop';
  backdrop.style.cssText = [
    'position:fixed', 'inset:0', 'z-index:99998',
    'background:rgba(0,0,0,0.45)', 'backdrop-filter:blur(3px)',
    '-webkit-backdrop-filter:blur(3px)',
    'opacity:0', 'transition:opacity 0.3s ease'
  ].join(';');
  document.body.appendChild(backdrop);

  const el = document.createElement('div');
  el.id = 'networkHint';
  el.style.cssText = [
    'position:fixed', 'bottom:50%', 'left:50%',
    'transform:translate(-50%,50%)',
    'background:#1e1b4b', 'color:#fff', 'font-size:0.88rem', 'font-weight:600',
    'padding:18px 24px', 'border-radius:16px', 'z-index:99999',
    'box-shadow:0 8px 32px rgba(0,0,0,0.4)', 'text-align:center',
    'max-width:88vw', 'line-height:1.6', 'opacity:0',
    'transition:opacity 0.3s ease'
  ].join(';');
  el.innerHTML = '📶 앱이 로딩되지 않으면<br>앱을 껐다 켜거나 새로고침 해보세요.';
  document.body.appendChild(el);

  requestAnimationFrame(() => {
    backdrop.style.opacity = '1';
    el.style.opacity = '1';
  });

  // 8초 후 자동 제거
  setTimeout(() => {
    backdrop.style.opacity = '0';
    el.style.opacity = '0';
    setTimeout(() => { backdrop.remove(); el.remove(); }, 350);
  }, 8000);
}

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
  if (!localStorage.getItem('seenDemo')) {
    localStorage.setItem('seenDemo', '1');
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
  if (userPhoto) {
    userPhoto.style.display = '';
    userPhoto.src = user?.user_metadata?.avatar_url || user?.user_metadata?.picture || '';
  }
  if (userName)  userName.textContent = user?.user_metadata?.full_name || user?.user_metadata?.name || user?.email || '사용자';

  setTaskInputEnabled(!!user);
  updateStandaloneAuthHint(user);

  // 로그인 시 푸시 구독 자동 처리
  if (user) {
    if (typeof requestPushPermission === 'function') {
      requestPushPermission();
    }
    // ?join=CODE 링크로 접속 시 자동 그룹 참여
    if (typeof gmAutoJoinFromUrl === 'function') {
      setTimeout(gmAutoJoinFromUrl, 500); // 그룹 모듈 초기화 대기
    }
  }
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

