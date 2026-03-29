/* ============================================================
   script.js — 상태(state) 및 Firebase 코어
   (유틸: utils.js / 렌더링: render.js / 드래그: drag.js
    기한UI: deadline.js / 푸시: push.js / 이벤트: events.js)
   ============================================================ */

'use strict';

// ──────────────────────────────────────────────
// 상수 및 상태
// ──────────────────────────────────────────────
const STORAGE_KEYS = {
  pool:     'taskPool_v2',
  schedule: 'taskSchedule_v2',
  dayMemo:  'dayMemo_v1',
  grade:    'grade_v1',
  classNum: 'classNum_v1'
};
const DEFAULT_STATE = {
  pool:     [],
  schedule: {},
  dayMemo:  {},
  dayOffset: 0,
  grade:    '2',
  classNum: '2'
};

let state    = { ...DEFAULT_STATE };
let dragInfo = null;

// ──────────────────────────────────────────────
// Firebase
// ──────────────────────────────────────────────
let currentUser          = null;
let db                   = null;
let unsubscribeSnapshot  = null;
let firebaseReady        = false;
let memoSaveTimer        = null;

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
async function bootstrapFirebase() {
  try {
    const response = await fetch('/api/config');
    if (!response.ok) throw new Error('config fetch failed: ' + response.status);
    const cfg = await response.json();
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
  state.dayMemo  = {};
  state.grade    = DEFAULT_STATE.grade;
  state.classNum = DEFAULT_STATE.classNum;
}
function applyPersistedState(data = {}) {
  state.pool     = data.pool     || [];
  state.schedule = data.schedule || {};
  state.dayMemo  = data.dayMemo  || {};
  state.grade    = data.grade    || DEFAULT_STATE.grade;
  state.classNum = data.classNum || DEFAULT_STATE.classNum;
}
function readLocalState() {
  return {
    pool:     JSON.parse(localStorage.getItem(STORAGE_KEYS.pool)),
    schedule: JSON.parse(localStorage.getItem(STORAGE_KEYS.schedule)),
    dayMemo:  JSON.parse(localStorage.getItem(STORAGE_KEYS.dayMemo)),
    grade:    localStorage.getItem(STORAGE_KEYS.grade),
    classNum: localStorage.getItem(STORAGE_KEYS.classNum)
  };
}
function hasLocalState(data) {
  return !!(data.pool || data.schedule || data.dayMemo || data.grade || data.classNum);
}
function persistLocalState() {
  localStorage.setItem(STORAGE_KEYS.pool,     JSON.stringify(state.pool));
  localStorage.setItem(STORAGE_KEYS.schedule, JSON.stringify(state.schedule));
  localStorage.setItem(STORAGE_KEYS.dayMemo,  JSON.stringify(state.dayMemo));
  localStorage.setItem(STORAGE_KEYS.grade,    state.grade);
  localStorage.setItem(STORAGE_KEYS.classNum, state.classNum);
}
function queueMemoSave() {
  if (memoSaveTimer) clearTimeout(memoSaveTimer);
  memoSaveTimer = setTimeout(() => { memoSaveTimer = null; saveState(); }, 250);
}

function loadState() {
  if (unsubscribeSnapshot) { unsubscribeSnapshot(); unsubscribeSnapshot = null; }

  if (currentUser && db) {
    unsubscribeSnapshot = db.collection('users').doc(currentUser.uid)
      .onSnapshot(doc => {
        // 로컬 write로 인한 재실행은 무시 (불필요한 리렌더 방지)
        if (doc.metadata.hasPendingWrites) return;

        if (doc.exists) {
          applyPersistedState(doc.data());
        } else {
          const localState = readLocalState();
          if (hasLocalState(localState)) { applyPersistedState(localState); saveState(); }
          else resetScheduleState();
        }
        autoReturnExpiredTasks();
        const activeElement = document.activeElement;
        if (!activeElement || !activeElement.classList.contains('day-card__memo')) renderApp();
        if (typeof updateSurveyVisibility === 'function') updateSurveyVisibility();
      }, err => {
        // alert 대신 상태바 표시 + 콘솔 로그
        console.error('Firestore 실시간 수신 에러:', err);
        setSyncStatus('❌ 동기화 오류 — 새로고침 해주세요');
      });
  } else {
    resetScheduleState();
    renderApp();
  }
}

function saveState() {
  if (memoSaveTimer) { clearTimeout(memoSaveTimer); memoSaveTimer = null; }
  setSyncStatus('☁️ 저장 중...');
  if (currentUser && db) {
    db.collection('users').doc(currentUser.uid).set({
      pool:        state.pool,
      schedule:    state.schedule,
      dayMemo:     state.dayMemo,
      grade:       state.grade,
      classNum:    state.classNum,
      lastUpdated: firebase.firestore.FieldValue.serverTimestamp()
    }).then(() => setSyncStatus('✅ 저장 완료'))
      .catch(err => { console.error('Firestore 저장 에러:', err); setSyncStatus('❌ 저장 실패'); });
  } else {
    persistLocalState();
    setSyncStatus('💾 로컬 저장됨');
  }
}

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

  // 로그인 시 push 구독 요청 (push.js가 로드된 후 사용 가능)
  if (user && typeof requestPushPermission === 'function') {
    requestPushPermission(user.uid);
  }
}
