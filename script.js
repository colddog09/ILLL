/* ============================================================
   script.js — 상태(state) 및 Firebase 코어
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
let gcalEvents = {}; // 캘린더에서 가져온 이벤트 (Firestore 저장 안 함)

// ──────────────────────────────────────────────
// Firebase
// ──────────────────────────────────────────────
let currentUser          = null;
let db                   = null;
let firebaseReady        = false;
let lastSavedSnapshot    = null; // 마지막 Firestore 저장 상태 (변경 감지용)

const REDIRECT_AUTH_CODES = new Set([
  'auth/popup-blocked',
  'auth/operation-not-supported-in-this-environment'
]);
const IGNORED_AUTH_CODES = new Set([
  'auth/popup-closed-by-user',
  'auth/cancelled-popup-request'
]);
const POPUP_FIRST_AUTH_CODES = new Set([
  'auth/popup-blocked',
  'auth/operation-not-supported-in-this-environment',
  'auth/web-storage-unsupported'
]);
const AUTH_ERROR_MESSAGES = {
  'auth/popup-blocked': "팝업이 차단되었습니다.\n앱 또는 모바일 환경에서는 브라우저 이동 방식으로 다시 시도해주세요.",
  'auth/operation-not-supported-in-this-environment': "현재 앱 환경에서는 팝업 로그인이 지원되지 않아 브라우저 이동 방식으로 로그인해야 합니다.",
  'auth/unauthorized-domain': "이 도메인은 Firebase 로그인 허용 목록에 없습니다.\nFirebase Console > Authentication > Settings > Authorized domains에 현재 앱 주소를 추가해주세요.",
  'auth/web-storage-unsupported': "브라우저 저장소를 사용할 수 없어 로그인을 진행할 수 없습니다.\n시크릿 모드 또는 저장소 차단 설정을 확인해주세요."
};

function isStandaloneApp() {
  return window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true;
}
function getAuth() {
  if (typeof firebase === 'undefined' || !firebase.auth) return null;
  return firebase.auth();
}
function setSyncStatus(message) {
  const el = document.getElementById('syncStatus');
  if (el) el.textContent = message;
}
function handleGoogleAuthError(err) {
  if (!err) return;
  console.error('Google 로그인 오류:', err);
  if (IGNORED_AUTH_CODES.has(err.code)) return;
  alert(AUTH_ERROR_MESSAGES[err.code] || ("로그인 중 오류가 발생했습니다: " + (err.message || err.code || '알 수 없는 오류')));
}
function startRedirectLogin(auth, provider, statusMessage) {
  setSyncStatus(statusMessage);
  return auth.signInWithRedirect(provider);
}
function handleRedirectLoginResult(auth) {
  return auth.getRedirectResult()
    .then(result => { if (result?.user) setSyncStatus('✅ 로그인 완료'); })
    .catch(handleGoogleAuthError);
}
function startGoogleLogin() {
  const auth = getAuth();
  if (!auth || !firebaseReady) {
    alert("Firebase 서비스에 연결하는 중입니다. 잠시 후 다시 시도해주세요.");
    return Promise.resolve();
  }
  const provider = new firebase.auth.GoogleAuthProvider();
  provider.setCustomParameters({ prompt: 'select_account' });
  const redirectStatus = isStandaloneApp()
    ? '🔐 브라우저 로그인으로 전환 중...'
    : '🔐 로그인 페이지로 이동 중...';
  return auth.signInWithPopup(provider).catch(err => {
    if (POPUP_FIRST_AUTH_CODES.has(err.code) || (isStandaloneApp() && REDIRECT_AUTH_CODES.has(err.code))) {
      return startRedirectLogin(auth, provider, redirectStatus);
    }
    throw err;
  });
}
function finishFirebaseSetup() {
  const auth = getAuth();
  db = firebase.firestore();
  return auth.setPersistence(firebase.auth.Auth.Persistence.LOCAL)
    .catch(err => { console.warn('Auth persistence 설정 실패:', err); })
    .then(() => {
      firebaseReady = true;
      auth.onAuthStateChanged(updateAuthUi);
      return handleRedirectLoginResult(auth);
    });
}
function initializeFirebase(cfg) {
  if (typeof firebase === 'undefined') throw new Error('Firebase SDK not loaded');
  firebase.initializeApp(cfg);
  return finishFirebaseSetup();
}

// Firebase auth 페이지에서 Google OAuth client ID를 브라우저 측에서 직접 추출
async function _detectOAuthClientId(authDomain) {
  const urls = [
    `https://${authDomain}/__/auth/iframe`,
    `https://${authDomain}/__/auth/handler`
  ];
  const patterns = [
    /"([^"]{20,}\.apps\.googleusercontent\.com)"/,
    /'([^']{20,}\.apps\.googleusercontent\.com)'/,
    /([\w-]{20,}\.apps\.googleusercontent\.com)/
  ];
  for (const url of urls) {
    try {
      const r = await fetch(url, { signal: AbortSignal.timeout(5000) });
      const text = await r.text();
      for (const pat of patterns) {
        const m = text.match(pat);
        if (m) return m[1];
      }
    } catch (_) { /* continue */ }
  }
  return null;
}

async function bootstrapFirebase() {
  try {
    const response = await fetch('/api/config');
    if (!response.ok) throw new Error('config fetch failed: ' + response.status);
    const cfg = await response.json();
    if (cfg.googleClientId) {
      window.__GCAL_CLIENT_ID__ = cfg.googleClientId;
    } else if (cfg.authDomain) {
      // Firebase auth 페이지에서 OAuth client ID 자동 감지 (브라우저 직접 fetch)
      _detectOAuthClientId(cfg.authDomain).then(id => {
        if (id) window.__GCAL_CLIENT_ID__ = id;
      });
    }
    await initializeFirebase(cfg);
  } catch (err) {
    console.error('Firebase 초기화 실패:', err);
    const localCfg = window.__FIREBASE_CONFIG__;
    if (!localCfg || typeof firebase === 'undefined') {
      alert('앱 초기화에 실패했습니다. 잠시 후 다시 시도해주세요.');
      renderPool(); renderWeek();
      return;
    }
    try {
      await initializeFirebase(localCfg);
    } catch (localErr) {
      console.error('Firebase 로컬 초기화 실패:', localErr);
      alert('앱 초기화에 실패했습니다. 잠시 후 다시 시도해주세요.');
      renderPool(); renderWeek();
    }
  }
}

bootstrapFirebase();

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

function loadState() {
  if (!currentUser || !db) {
    resetScheduleState();
    renderApp();
    return;
  }

  // 1) 로컬 데이터 먼저 즉시 표시
  const localState = readLocalState();
  if (hasLocalState(localState)) {
    applyPersistedState(localState);
    autoReturnExpiredTasks();
    renderApp();
  }

  // 2) Firestore에서 한 번만 읽어 최신 데이터로 덮어씀
  setSyncStatus('☁️ 불러오는 중...');
  db.collection('users').doc(currentUser.uid).get()
    .then(doc => {
      if (doc.exists) {
        const remote = doc.data();
        // 로컬이 더 최신이면 유지, 아니면 서버 데이터 사용
        const remoteTime = remote.lastUpdated?.toMillis?.() || 0;
        const localTime  = parseInt(localStorage.getItem('lastSavedTime') || '0');
        if (remoteTime > localTime) {
          applyPersistedState(remote);
          persistLocalState();
          lastSavedSnapshot = stateSnapshot();
        } else {
          lastSavedSnapshot = stateSnapshot();
        }
      } else {
        // 서버에 없으면 로컬 데이터를 서버에 저장
        _doSave();
      }
      autoReturnExpiredTasks();
      renderApp();
      setSyncStatus('');
    })
    .catch(err => {
      console.error('Firestore 읽기 에러:', err);
      setSyncStatus('❌ 불러오기 실패 — 로컬 데이터 사용 중');
      renderApp();
    });
}

function _doSave() {
  persistLocalState();
  localStorage.setItem('lastSavedTime', Date.now().toString());

  if (!currentUser || !db) { setSyncStatus('💾 로컬 저장됨'); return; }

  const snap = stateSnapshot();
  if (snap === lastSavedSnapshot) return;

  db.collection('users').doc(currentUser.uid).set({
    pool:        state.pool,
    schedule:    state.schedule,
    links:       state.links || [],
    lastUpdated: firebase.firestore.FieldValue.serverTimestamp()
  }).then(() => {
    lastSavedSnapshot = snap;
  }).catch(err => {
    console.error('Firestore 저장 에러:', err);
  });
}

// saveState = 즉시 로컬 저장만, Firestore는 앱 종료 시 처리
function saveState() {
  persistLocalState();
  localStorage.setItem('lastSavedTime', Date.now().toString());
}

// 앱 종료/백그라운드 전환 시 Firestore에 저장
function flushToFirestore() {
  if (!currentUser || !db) return;
  const snap = stateSnapshot();
  if (snap === lastSavedSnapshot) return;
  const data = {
    pool:        state.pool,
    schedule:    state.schedule,
    links:       state.links || [],
    lastUpdated: firebase.firestore.FieldValue.serverTimestamp()
  };
  // sendBeacon 방식으로 페이지 언로드에도 전송 시도
  try {
    db.collection('users').doc(currentUser.uid).set(data);
    lastSavedSnapshot = snap;
  } catch (e) {
    console.error('flushToFirestore 실패:', e);
  }
}

window.addEventListener('beforeunload', flushToFirestore);
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden') flushToFirestore();
});

// 10분마다 자동 Firestore 업로드
setInterval(flushToFirestore, 10 * 60 * 1000);

// ──────────────────────────────────────────────
// 인증 UI
// ──────────────────────────────────────────────
function updateStandaloneAuthHint(user = currentUser) {
  const authHint = document.getElementById('authHint');
  if (!authHint) return;
  authHint.hidden = !!user || !isStandaloneApp();
}

function updateAuthUi(user) {
  currentUser = user || null;

  const fbLoginBtn = document.getElementById('loginBtn');
  const userInfo   = document.getElementById('userInfo');
  const userPhoto  = document.getElementById('userPhoto');
  const userName   = document.getElementById('userName');

  if (fbLoginBtn) fbLoginBtn.hidden = !!user;
  if (userInfo)   userInfo.hidden   = !user;
  if (userPhoto)  userPhoto.src     = user?.photoURL || '';
  if (userName)   userName.textContent = user?.displayName || '사용자';

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
      // 세션 만료됐지만 이전에 연결했음 → 조용히 자동 재연결
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
