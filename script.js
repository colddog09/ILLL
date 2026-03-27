/* ============================================================
   일정 관리 – script.js  (v3 – bi-directional drag)
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

let state = {
  ...DEFAULT_STATE
};

/*
 * dragInfo: 현재 드래그 중인 아이템 정보
 * {
 *   type: 'pool' | 'day',
 *   taskId: string,   // pool의 task id
 *   text: string,
 *   itemId?: string,  // day 안의 sched-item id (type==='day' 일 때)
 *   dateKey?: string, // 어느 날에서 드래그 중인지 (type==='day' 일 때)
 * }
 */
let dragInfo = null; // { type: 'pool'|'day', taskId, itemId, dateKey, text }

// ──────────────────────────────────────────────
// Firebase 초기화 (환경변수에서 설정 fetch)
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

function updateStandaloneAuthHint(user = currentUser) {
  if (!dom.authHint) return;
  dom.authHint.hidden = !!user || !isStandaloneApp();
}

function getAuth() {
  if (typeof firebase === 'undefined' || !firebase.auth) return null;
  return firebase.auth();
}

function setSyncStatus(message) {
  if (dom.syncStatus) dom.syncStatus.textContent = message;
}

function setModalOpen(modal, open) {
  if (modal) modal.hidden = !open;
}

function bindModal(openBtn, modal, closeBtn, beforeOpen) {
  if (openBtn) {
    openBtn.addEventListener('click', () => {
      if (beforeOpen) beforeOpen();
      setModalOpen(modal, true);
    });
  }
  if (closeBtn) {
    closeBtn.addEventListener('click', () => setModalOpen(modal, false));
  }
  if (modal) {
    modal.addEventListener('click', e => {
      if (e.target === modal) setModalOpen(modal, false);
    });
  }
}

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
  if (addTaskBtn) addTaskBtn.disabled = !enabled;
}

function updateAuthUi(user) {
  const loginBtn = dom.fbLoginBtn;
  const userInfo = dom.userInfo;
  const userPhoto = dom.userPhoto;
  const userName = dom.userName;

  currentUser = user || null;
  if (loginBtn) loginBtn.hidden = !!user;
  if (userInfo) userInfo.hidden = !user;
  if (userPhoto) userPhoto.src = user?.photoURL || '';
  if (userName) userName.textContent = user?.displayName || '사용자';

  setTaskInputEnabled(!!user);
  updateStandaloneAuthHint(user);
  loadState();
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
    .then(result => {
      if (result?.user) setSyncStatus('✅ 로그인 완료');
    })
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
    .catch(err => {
      console.warn('Auth persistence 설정 실패:', err);
    })
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
      renderPool();
      renderWeek();
      return;
    }

    try {
      await initializeFirebase(localCfg);
    } catch (localErr) {
      console.error('Firebase 로컬 초기화 실패:', localErr);
      alert('앱 초기화에 실패했습니다. 잠시 후 다시 시도해주세요.');
      renderPool();
      renderWeek();
    }
  }
}

bootstrapFirebase();

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

function renderApp() {
  renderPool();
  renderWeek();
}

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
  memoSaveTimer = setTimeout(() => {
    memoSaveTimer = null;
    saveState();
  }, 250);
}

// ──────────────────────────────────────────────
// 영속성
// ──────────────────────────────────────────────
function loadState() {
  // 기존 리스너 해제 (중복 리스너 누수 방지)
  if (unsubscribeSnapshot) {
    unsubscribeSnapshot();
    unsubscribeSnapshot = null;
  }

  if (currentUser && db) {
    // onSnapshot을 사용하여 실시간으로 데이터 변화를 감지합니다
    unsubscribeSnapshot = db.collection('users').doc(currentUser.uid).onSnapshot(doc => {
      if (doc.exists) {
        applyPersistedState(doc.data());
      } else {
        const localState = readLocalState();
        if (hasLocalState(localState)) {
          applyPersistedState(localState);
          saveState();
        } else {
          resetScheduleState();
        }
      }
      
      // 하루 지난 미완료 일정 자동 반환 (렌더링 전에 처리)
      autoReturnExpiredTasks();

      // 메모장 포커스가 없을 때만 리렌더링 (타이핑 끊김 방지)
      const activeElement = document.activeElement;
      if (!activeElement || !activeElement.classList.contains('day-card__memo')) {
        renderApp();
      }

      updateSurveyVisibility();
    }, err => {
      console.error("Firestore 실시간 수신 에러:", err);
      alert("데이터를 불러오지 못했습니다 [" + err.code + "]\n" + err.message + "\n\nFirebase Console에서 Firestore 보안 규칙을 확인해주세요.");
    });
  } else {
    // 로그인하지 않은 상태 (게스트) - 빈 상태
    resetScheduleState();
    renderApp();
  }
}

function saveState() {
  if (memoSaveTimer) {
    clearTimeout(memoSaveTimer);
    memoSaveTimer = null;
  }
  setSyncStatus('☁️ 저장 중...');

  if (currentUser && db) {
    db.collection('users').doc(currentUser.uid).set({
      pool: state.pool,
      schedule: state.schedule,
      dayMemo: state.dayMemo,
      grade: state.grade,
      classNum: state.classNum,
      lastUpdated: firebase.firestore.FieldValue.serverTimestamp()
    }).then(() => {
      setSyncStatus('✅ 저장 완료');
    }).catch(err => {
      console.error("Firestore 저장 에러:", err);
      setSyncStatus('❌ 저장 실패');
    });
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
  addTaskBtn: document.getElementById('addTaskBtn'),
  taskInput: document.getElementById('taskInput'),
  syncStatus: document.getElementById('syncStatus'),
  helpBtn: document.getElementById('helpBtn'),
  helpModal: document.getElementById('helpModal'),
  helpCloseBtn: document.getElementById('helpCloseBtn'),
  historyModal: document.getElementById('historyModal'),
  historyList: document.getElementById('historyList'),
  historyBtn: document.getElementById('historyBtn'),
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
  surveyLinksDesktop: document.getElementById('surveyLinksDesktop'),
  surveyLinksMobile: document.getElementById('surveyLinksMobile'),
  prevWeekBtn: document.getElementById('prevWeekBtn'),
  nextWeekBtn: document.getElementById('nextWeekBtn')
};

const {
  poolEl,
  dayGrid,
  weekLabel,
  ghost,
  trashZone,
  addTaskBtn,
  taskInput,
  helpBtn,
  helpModal,
  helpCloseBtn,
  historyModal,
  historyList,
  historyBtn,
  historyCloseBtn,
  infoModal,
  infoBtn,
  infoCloseBtn,
  infoHistoryBtn,
  fbLoginBtn,
  fbLogoutBtn,
  settingsBtn,
  settingsModal,
  settingsCloseBtn,
  settingsSaveBtn,
  classSelect,
  gradeSelect,
  prevWeekBtn,
  nextWeekBtn
} = dom;

bindModal(helpBtn, helpModal, helpCloseBtn);
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

if (gradeSelect) {
  gradeSelect.addEventListener('change', updateSettingsPreview);
}

// 설문 링크 가시성: 2학년일 때만 표시
function updateSurveyVisibility() {
  const isGrade2 = state.grade === '2';
  if (dom.surveyLinksDesktop) dom.surveyLinksDesktop.hidden = !isGrade2;
  if (dom.surveyLinksMobile) dom.surveyLinksMobile.hidden = !isGrade2;
}

function updateSettingsPreview() {
  if (!dom.surveyVisibilityBadge) return;
  const selectedGrade = gradeSelect ? gradeSelect.value : state.grade;
  const visible = selectedGrade === '2';
  dom.surveyVisibilityBadge.dataset.active = visible ? 'true' : 'false';
  dom.surveyVisibilityBadge.textContent = visible ? '질문노트 링크 표시' : '질문노트 링크 숨김';
}

if (fbLoginBtn) {
  console.log("Login button found in DOM");
  fbLoginBtn.addEventListener('click', () => {
    console.log("Login button clicked");
    startGoogleLogin().catch(handleGoogleAuthError);
  });
}
if (fbLogoutBtn) {
  fbLogoutBtn.addEventListener('click', () => {
    if (typeof firebase !== 'undefined' && firebase.auth) {
      firebase.auth().signOut().then(() => {
        // 로그아웃 시 로컬 데이터 무시하고 화면 초기화
        resetScheduleState();
        renderApp();
      }).catch(err => {
        console.error(err);
        alert("로그아웃 중 오류가 발생했습니다: " + err.message);
      });
    }
  });
}

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
// 풀(Pool) 렌더링 — X 버튼 없음, 드래그 가능
// ──────────────────────────────────────────────

// 풀 → 현재 날짜로 더블클릭/더블탭 추가 (연속 중복 추가 방지 락)
let addFromPoolLocked = false;
function addPoolItemToCurrentDay(taskId, text) {
  if (addFromPoolLocked) return;
  addFromPoolLocked = true;
  setTimeout(() => { addFromPoolLocked = false; }, 600);

  const key = dateKey(currentDay());
  if (schedulePoolTask(key, taskId, text)) {
    saveState();
    refreshPoolAndDay(key);
  }
}

function schedulePoolTask(key, taskId, text) {
  if ((state.schedule[key] || []).some(it => it.taskId === taskId)) return false;
  state.pool = state.pool.filter(t => t.id !== taskId);
  if (!state.schedule[key]) state.schedule[key] = [];
  state.schedule[key].push({ id: uid(), taskId, text, status: null });
  return true;
}

function restoreTaskToPool(taskId, text) {
  if (!state.pool.find(t => t.id === taskId)) {
    state.pool.push({ id: taskId, text });
  }
}

function removeScheduleItem(key, itemId) {
  state.schedule[key] = (state.schedule[key] || []).filter(it => it.id !== itemId);
}

function removeTaskFromPool(taskId) {
  state.pool = state.pool.filter(t => t.id !== taskId);
}

function refreshPoolAndDay(key) {
  renderPool();
  renderDayTasks(key);
}

function renderEmptyPool() {
  poolEl.innerHTML = '<span style="color:var(--text-sub);font-size:0.82rem;padding:4px 2px;">할일을 추가해보세요!</span>';
}

function createPoolCard(task) {
  const card = document.createElement('div');
  card.className = 'pool-card';
  card.dataset.taskId = task.id;
  card.draggable = !!currentUser;
  card.textContent = task.text;
  return card;
}

function getPoolCardText(card) {
  return card ? card.textContent.trim() : '';
}

function handlePoolCardActivate(card) {
  if (!currentUser || !card) return;
  addPoolItemToCurrentDay(card.dataset.taskId, getPoolCardText(card));
}

function returnSchedItemToPool(key, itemId, taskId, text) {
  removeScheduleItem(key, itemId);
  restoreTaskToPool(taskId, text);
  saveState();
  refreshPoolAndDay(key);
}

function renderPool() {
  poolEl.innerHTML = '';
  if (state.pool.length === 0) {
    renderEmptyPool();
    return;
  }
  const fragment = document.createDocumentFragment();
  state.pool.forEach(task => fragment.appendChild(createPoolCard(task)));
  poolEl.appendChild(fragment);
}

// ──────────────────────────────────────────────
// 날짜 카드 렌더링
// ──────────────────────────────────────────────
function renderWeek() {
  dayGrid.innerHTML = '';
  const d     = currentDay();
  const key   = dateKey(d);
  const today = todayKey();
  const items = state.schedule[key] || [];
  const isToday = key === today;

  const dow = d.getDay();
  let wdColor = '';
  if (dow === 0) wdColor = 'style="color:#dc2626"';
  if (dow === 6) wdColor = 'style="color:#2563eb"';

  weekLabel.textContent = formatFullDateLabel(d);

  const done = items.filter(it => it.status === 'O').length;
  const pct  = items.length ? Math.round((done / items.length) * 100) : 0;

  // 미완료 항목이 있을 때 항상 뒤로 미루기 버튼 표시 (오늘 + 이전 날짜만)
  const hasPendingItems = items.some(it => it.status !== 'O');
  const isPastOrToday = key <= today;
  const deferBtnHtml = (isPastOrToday && hasPendingItems)
    ? `<button class="defer-btn" data-date="${key}" title="미완료 할일을 내일로 미룹니다">⏳ 뒤로 미루기</button>`
    : '';

  const memoText = state.dayMemo[key] || '';

  const card = document.createElement('div');
  card.className = 'day-card day-card--single' + (isToday ? ' today' : '');
  card.dataset.date = key;
  card.innerHTML = `
    <div class="day-card__header">
      <span class="day-card__date">${d.getDate()}</span>
      <span class="day-card__weekday" ${wdColor}>${DAYS_KO[dow]}</span>
      ${isToday ? '<span class="today-badge">오늘</span>' : ''}
      ${deferBtnHtml}
    </div>
    <div class="day-card__memo-wrap">
      <textarea class="day-card__memo" data-date="${key}" ${!currentUser ? 'disabled' : ''} placeholder="오늘의 메모나 자유로운 글을 남겨보세요...">${escHtml(memoText)}</textarea>
    </div>
    <div class="day-card__tasks" id="tasks_${key}"></div>
    <div class="day-card__progress">
      <div class="day-card__progress-bar" style="width:${pct}%"></div>
    </div>`;

  dayGrid.appendChild(card);
  renderDayTasks(key);
  setupDayDropZone(card, key);
}


function renderDayTasks(key) {
  const container = document.getElementById(`tasks_${key}`);
  if (!container) return;
  container.innerHTML = '';
  const items = state.schedule[key] || [];

  if (items.length === 0) {
    container.innerHTML = '<div class="drop-hint">📌 여기에 할일을<br>드래그해서 추가</div>';
    updateProgress(key);
    return;
  }

  const fragment = document.createDocumentFragment();

  items.forEach(item => {
    const el = document.createElement('div');
    el.className = 'sched-item' + (item.status === 'O' ? ' done' : '');
    el.dataset.itemId = item.id;
    el.dataset.dateKey = key;
    el.dataset.taskId = item.taskId;
    el.dataset.text = item.text;
    el.draggable = !!currentUser;
    el.innerHTML = `
      <span class="sched-item__handle" title="드래그로 순서 변경">⠿</span>
      <span class="sched-item__text" title="${escHtml(item.text)}">${escHtml(item.text)}</span>
      <div class="sched-item__ox">
        <button class="btn-o${item.status==='O'?' active':''}" data-date="${key}" data-id="${item.id}" title="완료(O)">O</button>
      </div>`;
    fragment.appendChild(el);

    // ── 데스크톱 드래그로 같은 날 순서 바꾸기 ──
    el.addEventListener('dragover', e => {
      if (dragInfo?.type !== 'day' || dragInfo.dateKey !== key || dragInfo.itemId === item.id) return;
      e.preventDefault();
      e.stopPropagation();
      el.classList.add('reorder-over');
    });
    el.addEventListener('dragleave', () => el.classList.remove('reorder-over'));
    el.addEventListener('drop', e => {
      el.classList.remove('reorder-over');
      if (dragInfo?.type !== 'day' || dragInfo.dateKey !== key || dragInfo.itemId === item.id) return;
      e.preventDefault();
      e.stopPropagation();
      const arr = state.schedule[key] || [];
      const fromIdx = arr.findIndex(it => it.id === dragInfo.itemId);
      const toIdx   = arr.findIndex(it => it.id === item.id);
      if (fromIdx !== -1 && toIdx !== -1 && fromIdx !== toIdx) {
        const [moved] = arr.splice(fromIdx, 1);
        arr.splice(toIdx, 0, moved);
        state.schedule[key] = arr;
        saveState();
        endDrag();
        renderDayTasks(key);
      }
    });

    // ── 핸들 터치 → 즉시 드래그 시작 (선택 여부 무관) ──
    const handle = el.querySelector('.sched-item__handle');
    if (handle && currentUser) {
      handle.addEventListener('touchstart', e => {
        e.preventDefault();
        e.stopPropagation();
        const t = e.touches[0];
        startTouchReorderAt(t.clientX, t.clientY, el, key, item.id);
      }, { passive: false });
    }

    // ── 탭 → 선택, 선택 상태에서 드래그 → 이동, 더블탭 → 풀로 반환 ──
    if (currentUser) {
      let tapX = 0, tapY = 0, tapTime = 0, lastTapTime = 0;

      el.addEventListener('touchstart', e => {
        if (e.target.closest('.sched-item__ox'))     return; // O 버튼 제외
        if (e.target.closest('.sched-item__handle')) return; // 핸들은 위에서 처리
        const t = e.touches[0];
        tapX = t.clientX;
        tapY = t.clientY;
        tapTime = Date.now();
        // 이미 선택된 상태면 스크롤 방지 (드래그 준비)
        if (el.classList.contains('selected')) e.preventDefault();
      }, { passive: false });

      el.addEventListener('touchmove', e => {
        if (e.target.closest('.sched-item__ox'))    return;
        if (!el.classList.contains('selected'))     return; // 비선택 상태면 무시
        if (touchReorder)                           return; // 이미 드래그 중이면 무시
        const t = e.touches[0];
        const dx = Math.abs(t.clientX - tapX);
        const dy = Math.abs(t.clientY - tapY);
        if (dx > 5 || dy > 5) {
          // 선택된 상태에서 손가락을 움직이면 드래그 시작
          startTouchReorderAt(tapX, tapY, el, key, item.id);
        }
      }, { passive: true });

      el.addEventListener('touchend', e => {
        if (touchReorder) return; // 드래그 완료 후엔 탭 이벤트 무시
        if (e.target.closest('.sched-item__ox')) return;
        const t = e.changedTouches[0];
        const dx = Math.abs(t.clientX - tapX);
        const dy = Math.abs(t.clientY - tapY);
        const dt = Date.now() - tapTime;
        if (dx < 10 && dy < 10 && dt < 400) {
          const now = Date.now();
          if (now - lastTapTime < 350) {
            // 더블탭 감지 → 풀로 반환
            e.preventDefault();
            lastTapTime = 0;
            returnSchedItemToPool(key, item.id, item.taskId, item.text);
          } else {
            lastTapTime = now;
            // 단일 탭 감지 → 선택 토글
            const wasSelected = el.classList.contains('selected');
            clearSelectedScheduleItems();
            if (!wasSelected) el.classList.add('selected');
          }
        }
      }, { passive: false });

      el.addEventListener('touchcancel', () => {
        el.classList.remove('selected');
      });
    }
  });

  container.appendChild(fragment);

  updateProgress(key);
}

function updateProgress(key) {
  const items = state.schedule[key] || [];
  const done  = items.filter(it => it.status === 'O').length;
  const pct   = items.length ? Math.round((done / items.length) * 100) : 0;
  const bar = dayGrid.querySelector(`.day-card[data-date="${key}"] .day-card__progress-bar`);
  if (bar) bar.style.width = pct + '%';
}

// ──────────────────────────────────────────────
// 터치 드래그 순서 바꾸기 (모바일)
// ──────────────────────────────────────────────
let touchReorder = null;

// 공통 진입점 — 좌표를 직접 받아서 드래그 시작
function startTouchReorderAt(clientX, clientY, el, key, itemId) {
  if (!currentUser || touchReorder) return; // 이미 드래그 중이면 무시

  const rect = el.getBoundingClientRect();
  const offsetY = clientY - rect.top;
  const offsetX = clientX - rect.left;

  el.style.opacity = '0.25';

  const clone = el.cloneNode(true);
  clone.className = 'sched-item touch-drag-clone';
  clone.style.cssText = `
    position:fixed;
    width:${rect.width}px;
    top:${clientY - offsetY}px;
    left:${clientX - offsetX}px;
    margin:0; z-index:9999;
    opacity:0.95;
    pointer-events:none;
  `;
  document.body.appendChild(clone);

  touchReorder = { el, key, itemId, clone, offsetY, offsetX, targetId: null, insertBefore: true };

  document.addEventListener('touchmove',   onTouchReorderMove,   { passive: false });
  document.addEventListener('touchend',    onTouchReorderEnd);
  document.addEventListener('touchcancel', onTouchReorderEnd);
}

function onTouchReorderMove(e) {
  if (!touchReorder) return;
  e.preventDefault();

  const touch = e.touches[0];
  const { clone, offsetY, offsetX } = touchReorder;

  // 클론을 손가락 위치에 따라 이동 (X, Y 모두)
  clone.style.top  = (touch.clientY - offsetY) + 'px';
  clone.style.left = (touch.clientX - offsetX) + 'px';

  // 클론 숨기고 아래 요소 탐색
  clone.style.visibility = 'hidden';
  const below = document.elementFromPoint(touch.clientX, touch.clientY);
  clone.style.visibility = '';

  document.querySelectorAll('.sched-item.reorder-over').forEach(el => el.classList.remove('reorder-over'));

  const targetItem = below?.closest('.sched-item');
  if (targetItem && targetItem !== touchReorder.el && targetItem.dataset.dateKey === touchReorder.key) {
    // 타겟 아이템 내 위/아래 절반 기준으로 삽입 위치 결정
    const tRect = targetItem.getBoundingClientRect();
    touchReorder.insertBefore = touch.clientY < (tRect.top + tRect.height / 2);
    targetItem.classList.add('reorder-over');
    touchReorder.targetId = targetItem.dataset.itemId;
  } else {
    touchReorder.targetId = null;
  }
}

function onTouchReorderEnd() {
  if (!touchReorder) return;
  document.removeEventListener('touchmove',   onTouchReorderMove);
  document.removeEventListener('touchend',    onTouchReorderEnd);
  document.removeEventListener('touchcancel', onTouchReorderEnd);

  const { el, key, itemId, clone, targetId, insertBefore } = touchReorder;
  clone.remove();
  el.style.opacity = '';
  document.querySelectorAll('.sched-item.reorder-over').forEach(el => el.classList.remove('reorder-over'));

  if (targetId && targetId !== itemId) {
    const arr = state.schedule[key] || [];
    const fromIdx = arr.findIndex(it => it.id === itemId);
    if (fromIdx !== -1) {
      const [moved] = arr.splice(fromIdx, 1); // 원본 제거
      const newToIdx = arr.findIndex(it => it.id === targetId); // 제거 후 재탐색
      if (newToIdx !== -1) {
        arr.splice(insertBefore ? newToIdx : newToIdx + 1, 0, moved);
        state.schedule[key] = arr;
        saveState();
        renderDayTasks(key);
      } else {
        arr.splice(fromIdx, 0, moved); // 실패 시 원위치
      }
    }
  }
  touchReorder = null;
}

// ──────────────────────────────────────────────
// 드래그 시스템 초기화
// ──────────────────────────────────────────────
function initDrag() {

  // ── 풀 카드 dragstart (from pool) ──
  poolEl.addEventListener('dragstart', e => {
    const card = e.target.closest('.pool-card');
    if (!card) return;
    dragInfo = { type: 'pool', taskId: card.dataset.taskId, text: getPoolCardText(card) };
    e.dataTransfer.setData('text/plain', dragInfo.taskId); // drop 허용에 필요
    e.dataTransfer.effectAllowed = 'move';
    setTimeout(() => card.classList.add('dragging'), 0);
    showGhost(dragInfo.text);
    hideDefaultImage(e);
    trashZone.hidden = false;   // + 버튼 자리에 휴지통 표시
    addTaskBtn.hidden = true;
  });

  poolEl.addEventListener('dragend', e => {
    const card = e.target.closest('.pool-card');
    if (card) card.classList.remove('dragging');
    endDrag();
  });

  // ── 스케줄 아이템 dragstart (from day card) ──
  dayGrid.addEventListener('dragstart', e => {
    const item = e.target.closest('.sched-item');
    if (!item) return;
    dragInfo = {
      type: 'day',
      taskId:  item.dataset.taskId,
      itemId:  item.dataset.itemId,
      dateKey: item.dataset.dateKey,
      text:    item.dataset.text,
    };
    e.dataTransfer.setData('text/plain', dragInfo.itemId);
    e.dataTransfer.effectAllowed = 'move';
    setTimeout(() => item.classList.add('dragging'), 0);
    showGhost(dragInfo.text);
    hideDefaultImage(e);
    trashZone.hidden = false; // day 드래그 시에도 휴지통 표시
    addTaskBtn.hidden = true;
  });

  dayGrid.addEventListener('dragend', e => {
    const item = e.target.closest('.sched-item');
    if (item) item.classList.remove('dragging');
    endDrag();
  });

  // ── 마우스 이동 → 고스트 따라다니기 ──
  document.addEventListener('dragover', e => {
    ghost.style.top  = (e.clientY + 14) + 'px';
    ghost.style.left = (e.clientX + 14) + 'px';
  });

  // ── 풀 영역을 드롭존으로 ── (day → pool: 일정 반환)
  poolEl.addEventListener('dragover', e => {
    if (dragInfo?.type !== 'day') return;
    e.preventDefault();
    poolEl.classList.add('drag-over-pool');
  });
  poolEl.addEventListener('dragleave', e => {
    if (!poolEl.contains(e.relatedTarget)) poolEl.classList.remove('drag-over-pool');
  });
  poolEl.addEventListener('drop', e => {
    poolEl.classList.remove('drag-over-pool');
    if (dragInfo?.type !== 'day') return;
    e.preventDefault();

    const { taskId, itemId, dateKey: key, text } = dragInfo;
    removeScheduleItem(key, itemId);
    restoreTaskToPool(taskId, text);
    saveState();
    endDrag();          // 스케줄 아이템 DOM 제거 전 정리
    refreshPoolAndDay(key);
  });

  // ── 휴지통 드롭존 (pool 또는 day → trash: 완전 삭제) ──
  trashZone.addEventListener('dragover', e => {
    if (!dragInfo) return;       // 드래그 중일 때만
    e.preventDefault();          // 항상 preventDefault → drop 이벤트 허용
    e.dataTransfer.dropEffect = 'move';
    trashZone.classList.add('danger');
  });
  trashZone.addEventListener('dragleave', e => {
    // 휴지통 내부 자식으로 이동 시 flicker 방지
    if (!trashZone.contains(e.relatedTarget)) trashZone.classList.remove('danger');
  });
  trashZone.addEventListener('drop', e => {
    e.preventDefault();
    trashZone.classList.remove('danger');
    if (!dragInfo) return;

    if (dragInfo.type === 'pool') {
      removeTaskFromPool(dragInfo.taskId);
      saveState();
      endDrag();        // DOM에서 제거 전 정리 (dragend 발화 안 됨)
      renderPool();
    } else if (dragInfo.type === 'day') {
      const key = dragInfo.dateKey;
      removeScheduleItem(key, dragInfo.itemId);
      saveState();
      endDrag();
      renderDayTasks(key);
    }
  });
}

// ── 날짜 카드를 드롭존으로 ── (pool → day: 일정 추가)
function setupDayDropZone(card, key) {
  card.addEventListener('dragover', e => {
    if (dragInfo?.type !== 'pool') return;
    e.preventDefault();
    card.classList.add('drag-over');
  });
  card.addEventListener('dragleave', e => {
    if (!card.contains(e.relatedTarget)) card.classList.remove('drag-over');
  });
  card.addEventListener('drop', e => {
    card.classList.remove('drag-over');
    if (dragInfo?.type !== 'pool') return;
    e.preventDefault();

    const { taskId, text } = dragInfo;
    if (!schedulePoolTask(key, taskId, text)) return;
    saveState();
    endDrag();    // DOM에서 제거되기 전 정리 (dragend 대체)
    refreshPoolAndDay(key);
  });
}

// ── 공통 헬퍼 ──
function showGhost(text) {
  ghost.textContent = text;
  ghost.classList.add('visible');
}
function hideDefaultImage(e) {
  const blank = document.createElement('div');
  blank.style.cssText = 'width:1px;height:1px;position:fixed;top:-9999px';
  document.body.appendChild(blank);
  e.dataTransfer.setDragImage(blank, 0, 0);
  setTimeout(() => document.body.removeChild(blank), 0);
}
function endDrag() {
  dragInfo = null;
  ghost.classList.remove('visible');
  ghost.style.top = '-999px'; ghost.style.left = '-999px';
  trashZone.hidden = true;
  trashZone.classList.remove('danger');
  addTaskBtn.hidden = false;   // + 버튼 복원
}

// ──────────────────────────────────────────────
// 이벤트 위임 – O/X 토글, 미루기, 메모
// ──────────────────────────────────────────────
dayGrid.addEventListener('click', e => {
  const btnO = e.target.closest('.btn-o');
  if (btnO) { toggleStatus(btnO.dataset.date, btnO.dataset.id); return; }

  const deferBtn = e.target.closest('.defer-btn');
  if (deferBtn) { deferTasks(deferBtn.dataset.date); }
});

dayGrid.addEventListener('dblclick', e => {
  const item = e.target.closest('.sched-item');
  if (!item || e.target.closest('.sched-item__ox')) return;
  returnSchedItemToPool(item.dataset.dateKey, item.dataset.itemId, item.dataset.taskId, item.dataset.text);
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
  // O를 누르면 O, 다시 누르면 null(미완료/X 처리)
  item.status = item.status === 'O' ? null : 'O';
  saveState();
  renderDayTasks(date);
}

function deferTasks(targetDateKey) {
  if (!requireLogin()) return;
  const items = state.schedule[targetDateKey] || [];
  // 완료되지 않은 항목들 (null 이나 X)
  const unfinished = items.filter(it => it.status !== 'O');
  if (unfinished.length === 0) return;

  const nextDateKey = getNextDateKey(targetDateKey);

  // 현재 날짜에서는 제거
  state.schedule[targetDateKey] = items.filter(it => it.status === 'O');

  // 다음날로 추가
  if (!state.schedule[nextDateKey]) state.schedule[nextDateKey] = [];
  unfinished.forEach(it => {
    // id 재발급하여 다음날에 추가 (status 리셋)
    state.schedule[nextDateKey].push({ id: uid(), taskId: it.taskId, text: it.text, status: null });
  });

  saveState();
  renderWeek(); // 현재 화면 갱신 (보통 오늘이므로 제거된 것만 보임)
}

// ──────────────────────────────────────────────
// 할일 추가 (인풋)
// ──────────────────────────────────────────────
function addTask() {
  if (!requireLogin('로그인이 필요합니다.')) return;
  const text = taskInput.value.trim();
  if (!text) { taskInput.focus(); return; }
  state.pool.push({ id: uid(), text });
  saveState();
  renderPool();
  taskInput.value = '';
  taskInput.focus();
}

addTaskBtn.addEventListener('click', addTask);
taskInput.addEventListener('keydown', e => { 
  if (e.isComposing || e.keyCode === 229) return;
  if (e.key === 'Enter') addTask(); 
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
        <span class="history-day__title" ${titleColor}>
          ${formatHistoryDateLabel(d)}
        </span>
        <span class="history-day__summary">${done}/${items.length} 완료</span>
        <span class="history-day__chevron">▼</span>
      </div>
      <div class="history-day__tasks">
        ${items.map(it => `
          <div class="history-task status-${it.status||'none'}">
            <span class="history-task__text">${escHtml(it.text)}</span>
            <span class="history-badge ${it.status||'none'}">${
              it.status === 'O' ? '✓ 완료'
              : it.status === 'X' ? '✕ 미완료'
              : '— 미기록'
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

historyBtn.addEventListener('click', openHistory);
bindModal(null, historyModal, historyCloseBtn);
bindModal(infoBtn, infoModal, infoCloseBtn);
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
updateStandaloneAuthHint();
updateSettingsPreview();

// ── 빈 곳 탭 → 선택 해제 ──
document.addEventListener('touchend', e => {
  if (touchReorder) return; // 드래그 중엔 무시
  if (!e.target.closest('.sched-item')) {
    clearSelectedScheduleItems();
  }
}, { passive: true });

// ──────────────────────────────────────────────
// 하루 지난 미완료 일정 자동 풀 반환
// ──────────────────────────────────────────────
function autoReturnExpiredTasks() {
  if (!currentUser) return;
  const today = todayKey();
  let changed = false;

  Object.keys(state.schedule).forEach(key => {
    if (key >= today) return; // 오늘 이후는 건드리지 않음
    const items = state.schedule[key] || [];
    const pending = items.filter(it => it.status !== 'O');
    if (pending.length === 0) return;

    // 미완료 항목을 풀로 반환 (이미 풀에 없는 경우만)
    pending.forEach(it => {
      if (!state.pool.find(t => t.id === it.taskId)) {
        state.pool.push({ id: it.taskId, text: it.text });
      }
    });
    // 해당 날짜에서 미완료 항목 제거
    state.schedule[key] = items.filter(it => it.status === 'O');
    changed = true;
  });

  if (changed) {
    saveState();
    renderPool();
    renderWeek();
  }
}

// ──────────────────────────────────────────────
// 초기화
// ──────────────────────────────────────────────
resetScheduleState();
renderApp();
initDrag();
