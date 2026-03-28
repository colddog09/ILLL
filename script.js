/* ============================================================
   script.js — 상태, Firebase, 이벤트 핸들러
   (렌더링: render.js / 드래그: drag.js)
   ============================================================ */

'use strict';

// ──────────────────────────────────────────────
// 상수 및 상태
// ──────────────────────────────────────────────
const DAYS_KO   = ['일','월','화','수','목','금','토'];
const DAYS_FULL = ['일요일','월요일','화요일','수요일','목요일','금요일','토요일'];
const STORAGE_KEYS = {
  pool: 'taskPool_v2',
  schedule: 'taskSchedule_v2',
  dayMemo: 'dayMemo_v1',
  grade: 'grade_v1',
  classNum: 'classNum_v1'
};
const DEFAULT_STATE = {
  pool: [],
  schedule: {},
  dayMemo: {},
  dayOffset: 0,
  grade: '2',
  classNum: '2'
};

let state = { ...DEFAULT_STATE };
let dragInfo = null;

// ──────────────────────────────────────────────
// Firebase
// ──────────────────────────────────────────────
let currentUser = null;
let db = null;
let unsubscribeSnapshot = null;
let firebaseReady = false;
let memoSaveTimer = null;
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
  if (dom.syncStatus) dom.syncStatus.textContent = message;
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
// 유틸리티
// ──────────────────────────────────────────────
function uid() { return '_' + Math.random().toString(36).slice(2, 9); }
function currentDay() {
  const d = new Date();
  d.setDate(d.getDate() + state.dayOffset);
  return d;
}
function dateKey(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}
function todayKey() { return dateKey(new Date()); }
function getNextDateKey(key) {
  const [y, m, d] = key.split('-');
  const nextDate = new Date(y, m - 1, d);
  nextDate.setDate(nextDate.getDate() + 1);
  return dateKey(nextDate);
}
function formatFullDateLabel(date, dayNames = DAYS_KO) {
  return `${date.getFullYear()}년 ${date.getMonth() + 1}월 ${date.getDate()}일 (${dayNames[date.getDay()]})`;
}
function formatHistoryDateLabel(date) {
  return `${date.getFullYear()}년 ${date.getMonth() + 1}월 ${date.getDate()}일 ${DAYS_FULL[date.getDay()]}`;
}
function escHtml(str) {
  return str.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}
function renderApp() { renderPool(); renderWeek(); }
function requireLogin(message = '로그인 후 이용 가능합니다.') {
  if (currentUser) return true;
  alert(message);
  return false;
}
function clearSelectedScheduleItems() {
  document.querySelectorAll('.sched-item.selected').forEach(item => item.classList.remove('selected'));
}
function setTaskInputEnabled(enabled) {
  if (taskInput) {
    taskInput.disabled = !enabled;
    taskInput.placeholder = enabled
      ? "할일을 추가하세요 (엔터)"
      : "👉 로그인 후 일정을 추가할 수 있습니다.";
  }
}

// ──────────────────────────────────────────────
// 상태 관리
// ──────────────────────────────────────────────
function resetScheduleState() {
  state.pool = [];
  state.schedule = {};
  state.dayMemo = {};
  state.grade = DEFAULT_STATE.grade;
  state.classNum = DEFAULT_STATE.classNum;
}
function applyPersistedState(data = {}) {
  state.pool = data.pool || [];
  state.schedule = data.schedule || {};
  state.dayMemo = data.dayMemo || {};
  state.grade = data.grade || DEFAULT_STATE.grade;
  state.classNum = data.classNum || DEFAULT_STATE.classNum;
}
function readLocalState() {
  return {
    pool: JSON.parse(localStorage.getItem(STORAGE_KEYS.pool)),
    schedule: JSON.parse(localStorage.getItem(STORAGE_KEYS.schedule)),
    dayMemo: JSON.parse(localStorage.getItem(STORAGE_KEYS.dayMemo)),
    grade: localStorage.getItem(STORAGE_KEYS.grade),
    classNum: localStorage.getItem(STORAGE_KEYS.classNum)
  };
}
function hasLocalState(data) {
  return !!(data.pool || data.schedule || data.dayMemo || data.grade || data.classNum);
}
function persistLocalState() {
  localStorage.setItem(STORAGE_KEYS.pool, JSON.stringify(state.pool));
  localStorage.setItem(STORAGE_KEYS.schedule, JSON.stringify(state.schedule));
  localStorage.setItem(STORAGE_KEYS.dayMemo, JSON.stringify(state.dayMemo));
  localStorage.setItem(STORAGE_KEYS.grade, state.grade);
  localStorage.setItem(STORAGE_KEYS.classNum, state.classNum);
}
function queueMemoSave() {
  if (memoSaveTimer) clearTimeout(memoSaveTimer);
  memoSaveTimer = setTimeout(() => { memoSaveTimer = null; saveState(); }, 250);
}

function loadState() {
  if (unsubscribeSnapshot) { unsubscribeSnapshot(); unsubscribeSnapshot = null; }

  if (currentUser && db) {
    unsubscribeSnapshot = db.collection('users').doc(currentUser.uid).onSnapshot(doc => {
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
      updateSurveyVisibility();
    }, err => {
      console.error("Firestore 실시간 수신 에러:", err);
      alert("데이터를 불러오지 못했습니다 [" + err.code + "]\n" + err.message + "\n\nFirebase Console에서 Firestore 보안 규칙을 확인해주세요.");
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
      pool: state.pool,
      schedule: state.schedule,
      dayMemo: state.dayMemo,
      grade: state.grade,
      classNum: state.classNum,
      lastUpdated: firebase.firestore.FieldValue.serverTimestamp()
    }).then(() => setSyncStatus('✅ 저장 완료'))
      .catch(err => { console.error("Firestore 저장 에러:", err); setSyncStatus('❌ 저장 실패'); });
  } else {
    persistLocalState();
    setSyncStatus('💾 로컬 저장됨');
  }
}

// ──────────────────────────────────────────────
// DOM 레퍼런스
// ──────────────────────────────────────────────
const dom = {
  poolEl: document.getElementById('taskPool'),
  dayGrid: document.getElementById('dayGrid'),
  weekLabel: document.getElementById('weekLabel'),
  ghost: document.getElementById('dragGhost'),
  trashZone: document.getElementById('trashZone'),
  taskInput: document.getElementById('taskInput'),
  syncStatus: document.getElementById('syncStatus'),
  helpBtn: document.getElementById('helpBtn'),
  helpModal: document.getElementById('helpModal'),
  helpCloseBtn: document.getElementById('helpCloseBtn'),
  historyModal: document.getElementById('historyModal'),
  historyList: document.getElementById('historyList'),
  historyCloseBtn: document.getElementById('historyCloseBtn'),
  infoModal: document.getElementById('infoModal'),
  infoBtn: document.getElementById('infoBtn'),
  infoCloseBtn: document.getElementById('infoCloseBtn'),
  infoHistoryBtn: document.getElementById('infoHistoryBtn'),
  fbLoginBtn: document.getElementById('loginBtn'),
  fbLogoutBtn: document.getElementById('logoutBtn'),
  authHint: document.getElementById('authHint'),
  userInfo: document.getElementById('userInfo'),
  userPhoto: document.getElementById('userPhoto'),
  userName: document.getElementById('userName'),
  settingsBtn: document.getElementById('settingsBtn'),
  settingsModal: document.getElementById('settingsModal'),
  settingsCloseBtn: document.getElementById('settingsCloseBtn'),
  settingsSaveBtn: document.getElementById('settingsSaveBtn'),
  classSelect: document.getElementById('classSelect'),
  gradeSelect: document.getElementById('gradeSelect'),
  surveyVisibilityBadge: document.getElementById('surveyVisibilityBadge'),
  surveyLinksMobile: document.getElementById('surveyLinksMobile'),
  prevWeekBtn: document.getElementById('prevWeekBtn'),
  nextWeekBtn: document.getElementById('nextWeekBtn')
};

const {
  poolEl, dayGrid, weekLabel, ghost, trashZone, taskInput,
  helpBtn, helpModal, helpCloseBtn,
  historyModal, historyList, historyCloseBtn,
  infoModal, infoBtn, infoCloseBtn, infoHistoryBtn,
  fbLoginBtn, fbLogoutBtn,
  settingsBtn, settingsModal, settingsCloseBtn, settingsSaveBtn,
  classSelect, gradeSelect,
  prevWeekBtn, nextWeekBtn
} = dom;

// ──────────────────────────────────────────────
// 인증 UI
// ──────────────────────────────────────────────
function updateStandaloneAuthHint(user = currentUser) {
  if (!dom.authHint) return;
  dom.authHint.hidden = !!user || !isStandaloneApp();
}
function updateAuthUi(user) {
  currentUser = user || null;
  if (dom.fbLoginBtn) dom.fbLoginBtn.hidden = !!user;
  if (dom.userInfo) dom.userInfo.hidden = !user;
  if (dom.userPhoto) dom.userPhoto.src = user?.photoURL || '';
  if (dom.userName) dom.userName.textContent = user?.displayName || '사용자';
  setTaskInputEnabled(!!user);
  updateStandaloneAuthHint(user);
  loadState();
}

// ──────────────────────────────────────────────
// 모달 바인딩
// ──────────────────────────────────────────────
function setModalOpen(modal, open) {
  if (modal) modal.hidden = !open;
}
function bindModal(openBtn, modal, closeBtn, beforeOpen) {
  if (openBtn) openBtn.addEventListener('click', () => { if (beforeOpen) beforeOpen(); setModalOpen(modal, true); });
  if (closeBtn) closeBtn.addEventListener('click', () => setModalOpen(modal, false));
  if (modal) modal.addEventListener('click', e => { if (e.target === modal) setModalOpen(modal, false); });
}

bindModal(helpBtn, helpModal, helpCloseBtn);
bindModal(infoBtn, infoModal, infoCloseBtn);
bindModal(settingsBtn, settingsModal, settingsCloseBtn, () => {
  if (gradeSelect) gradeSelect.value = state.grade;
  if (classSelect) classSelect.value = state.classNum;
  updateSettingsPreview();
});
if (settingsSaveBtn) {
  settingsSaveBtn.addEventListener('click', () => {
    if (gradeSelect) state.grade = gradeSelect.value;
    if (classSelect) state.classNum = classSelect.value;
    saveState();
    updateSurveyVisibility();
    setModalOpen(settingsModal, false);
  });
}
if (gradeSelect) gradeSelect.addEventListener('change', updateSettingsPreview);

function updateSurveyVisibility() {
  const isGrade2 = state.grade === '2';
  if (dom.surveyLinksMobile) dom.surveyLinksMobile.hidden = !isGrade2;
}
function updateSettingsPreview() {
  if (!dom.surveyVisibilityBadge) return;
  const visible = (gradeSelect ? gradeSelect.value : state.grade) === '2';
  dom.surveyVisibilityBadge.dataset.active = visible ? 'true' : 'false';
  dom.surveyVisibilityBadge.textContent = visible ? '질문노트 링크 표시' : '질문노트 링크 숨김';
}

// ──────────────────────────────────────────────
// 로그인/로그아웃
// ──────────────────────────────────────────────
if (fbLoginBtn) fbLoginBtn.addEventListener('click', () => startGoogleLogin().catch(handleGoogleAuthError));
if (fbLogoutBtn) {
  fbLogoutBtn.addEventListener('click', () => {
    if (typeof firebase !== 'undefined' && firebase.auth) {
      firebase.auth().signOut().then(() => { resetScheduleState(); renderApp(); })
        .catch(err => { console.error(err); alert("로그아웃 중 오류가 발생했습니다: " + err.message); });
    }
  });
}

// ──────────────────────────────────────────────
// 풀 카드 더블클릭/더블탭 → 오늘 날짜에 추가
// ──────────────────────────────────────────────
const poolTapState = { taskId: null, lastTapTime: 0 };

poolEl.addEventListener('dblclick', e => {
  handlePoolCardActivate(e.target.closest('.pool-card'));
});
poolEl.addEventListener('touchend', e => {
  const card = e.target.closest('.pool-card');
  if (!currentUser || !card) return;
  const now = Date.now();
  if (poolTapState.taskId === card.dataset.taskId && now - poolTapState.lastTapTime < 350) {
    e.preventDefault();
    poolTapState.taskId = null;
    poolTapState.lastTapTime = 0;
    handlePoolCardActivate(card);
    return;
  }
  poolTapState.taskId = card.dataset.taskId;
  poolTapState.lastTapTime = now;
}, { passive: false });

// ──────────────────────────────────────────────
// 이벤트 위임 – O 토글, 미루기, 메모
// ──────────────────────────────────────────────
dayGrid.addEventListener('click', e => {
  const btnO = e.target.closest('.btn-o');
  if (btnO) { toggleStatus(btnO.dataset.date, btnO.dataset.id); return; }
  const deferBtn = e.target.closest('.defer-btn');
  if (deferBtn) { deferTasks(deferBtn.dataset.date); }
});

// 더블클릭 → 풀로 반환, 세번클릭 → 완전 삭제
let _clickCountEl = null, _clickCount = 0, _clickTimer = null;
dayGrid.addEventListener('click', e => {
  const item = e.target.closest('.sched-item');
  if (!item || e.target.closest('.sched-item__ox')) return;
  if (_clickCountEl !== item) { _clickCountEl = item; _clickCount = 0; }
  _clickCount++;
  clearTimeout(_clickTimer);
  _clickTimer = setTimeout(() => {
    const cnt = _clickCount;
    _clickCount = 0; _clickCountEl = null;
    if (cnt === 2) {
      returnSchedItemToPool(item.dataset.dateKey, item.dataset.itemId, item.dataset.taskId, item.dataset.text);
    } else if (cnt >= 3) {
      deleteSchedItemCompletely(item.dataset.dateKey, item.dataset.itemId);
    }
  }, 300);
});

dayGrid.addEventListener('input', e => {
  if (!currentUser) return;
  if (e.target.classList.contains('day-card__memo')) {
    const key = e.target.dataset.date;
    state.dayMemo[key] = e.target.value;
    queueMemoSave();
  }
});

function toggleStatus(date, id) {
  if (!requireLogin()) return;
  const items = state.schedule[date] || [];
  const item  = items.find(it => it.id === id);
  if (!item) return;
  item.status = item.status === 'O' ? null : 'O';
  saveState();
  renderDayTasks(date);
}

function deferTasks(targetDateKey) {
  if (!requireLogin()) return;
  const items = state.schedule[targetDateKey] || [];
  const unfinished = items.filter(it => it.status !== 'O');
  if (unfinished.length === 0) return;
  const nextDateKey = getNextDateKey(targetDateKey);
  state.schedule[targetDateKey] = items.filter(it => it.status === 'O');
  if (!state.schedule[nextDateKey]) state.schedule[nextDateKey] = [];
  unfinished.forEach(it => {
    state.schedule[nextDateKey].push({ id: uid(), taskId: it.taskId, text: it.text, status: null });
  });
  saveState();
  renderWeek();
}

// ──────────────────────────────────────────────
// 할일 추가 (인풋)
// ──────────────────────────────────────────────
taskInput.addEventListener('keydown', e => {
  if (e.isComposing || e.keyCode === 229) return;
  if (e.key === 'Enter') {
    if (!requireLogin('로그인이 필요합니다.')) return;
    const text = taskInput.value.trim();
    if (!text) return;
    state.pool.push({ id: uid(), text });
    saveState();
    renderPool();
    taskInput.value = '';
  }
});

// ──────────────────────────────────────────────
// 날짜 네비게이션
// ──────────────────────────────────────────────
prevWeekBtn.addEventListener('click', () => { state.dayOffset--; renderWeek(); });
nextWeekBtn.addEventListener('click', () => { state.dayOffset++; renderWeek(); });

// ──────────────────────────────────────────────
// 과거 내역 모달
// ──────────────────────────────────────────────
function openHistory() {
  historyList.innerHTML = '';
  const allKeys = Object.keys(state.schedule)
    .filter(k => state.schedule[k]?.length > 0)
    .sort((a, b) => b.localeCompare(a));

  if (allKeys.length === 0) {
    historyList.innerHTML = '<p class="history-empty">아직 기록된 일정이 없어요.</p>';
    setModalOpen(historyModal, true);
    return;
  }

  const fragment = document.createDocumentFragment();
  allKeys.forEach((key, idx) => {
    const items = state.schedule[key];
    const d     = new Date(key);
    const dow   = d.getDay();
    const done  = items.filter(it => it.status === 'O').length;
    const dayEl = document.createElement('div');
    dayEl.className = 'history-day' + (idx === 0 ? ' open' : '');
    let titleColor = '';
    if (dow === 0) titleColor = 'style="color:#dc2626"';
    if (dow === 6) titleColor = 'style="color:#2563eb"';
    dayEl.innerHTML = `
      <div class="history-day__header">
        <span class="history-day__title" ${titleColor}>${formatHistoryDateLabel(d)}</span>
        <span class="history-day__summary">${done}/${items.length} 완료</span>
        <span class="history-day__chevron">▼</span>
      </div>
      <div class="history-day__tasks">
        ${items.map(it => `
          <div class="history-task status-${it.status||'none'}">
            <span class="history-task__text">${escHtml(it.text)}</span>
            <span class="history-badge ${it.status||'none'}">${
              it.status === 'O' ? '✓ 완료' : it.status === 'X' ? '✕ 미완료' : '— 미기록'
            }</span>
          </div>`).join('')}
      </div>`;
    fragment.appendChild(dayEl);
  });
  historyList.appendChild(fragment);
  setModalOpen(historyModal, true);
}

historyList.addEventListener('click', e => {
  const header = e.target.closest('.history-day__header');
  if (!header) return;
  header.parentElement.classList.toggle('open');
});

bindModal(null, historyModal, historyCloseBtn);
document.addEventListener('keydown', e => {
  if (e.key !== 'Escape') return;
  setModalOpen(historyModal, false);
  setModalOpen(infoModal, false);
  setModalOpen(helpModal, false);
  setModalOpen(settingsModal, false);
});

if (infoHistoryBtn) infoHistoryBtn.addEventListener('click', () => {
  setModalOpen(infoModal, false);
  openHistory();
});

// ── 빈 곳 탭 → 선택 해제 ──
document.addEventListener('touchend', e => {
  if (touchReorder) return;
  if (!e.target.closest('.sched-item')) clearSelectedScheduleItems();
}, { passive: true });

// ──────────────────────────────────────────────
// 하루 지난 미완료 일정 자동 풀 반환
// ──────────────────────────────────────────────
function autoReturnExpiredTasks() {
  if (!currentUser) return;
  const now = new Date();
  const effectiveToday = new Date(now);
  if (now.getHours() < 5) effectiveToday.setDate(effectiveToday.getDate() - 1);
  const today = dateKey(effectiveToday);
  let changed = false;
  Object.keys(state.schedule).forEach(key => {
    if (key >= today) return;
    const items = state.schedule[key] || [];
    const pending = items.filter(it => it.status !== 'O');
    if (pending.length === 0) return;
    pending.forEach(it => {
      if (!state.pool.find(t => t.id === it.taskId)) state.pool.push({ id: it.taskId, text: it.text });
    });
    changed = true;
  });
  if (changed) { saveState(); renderPool(); }
}

// ──────────────────────────────────────────────
// 시험 D-day 표시
// ──────────────────────────────────────────────
function updateDday() {
  const exam = new Date('2026-04-20T00:00:00');
  const now = new Date();
  const todayMidnight = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const diff = Math.round((exam - todayMidnight) / (1000 * 60 * 60 * 24));
  const textSchedule = diff > 0 ? `🔥 시험 D-${diff}` : diff === 0 ? `🔥 시험 D-Day!` : `🔥 시험 D+${Math.abs(diff)}`;
  const badgeSchedule = document.getElementById('ddayBadge');
  if (badgeSchedule) badgeSchedule.textContent = textSchedule;
}

updateStandaloneAuthHint();
updateSettingsPreview();
