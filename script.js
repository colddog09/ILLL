/* ============================================================
   일정 관리 – script.js  (v3 – bi-directional drag)
   ============================================================ */

'use strict';

// ──────────────────────────────────────────────
// 상수 및 상태
// ──────────────────────────────────────────────
const DAYS_KO   = ['일','월','화','수','목','금','토'];
const DAYS_FULL = ['일요일','월요일','화요일','수요일','목요일','금요일','토요일'];
const STORAGE_KEY_POOL  = 'taskPool_v2';
const STORAGE_KEY_SCHED = 'taskSchedule_v2';

let state = {
  pool: [],           // [{ id, text }]
  schedule: {},       // { 'YYYY-MM-DD': [{ id, taskId, text, status }] }
  dayMemo: {},        // { 'YYYY-MM-DD': 'memo text' }
  dayOffset: 0,
  classNum: '2',
  showTimetable: false // 시간표 표시 여부 (기본값: 꺼져있음)
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
// 시간표 데이터 (GBS 2학년 전체 교실)
// ──────────────────────────────────────────────
const SCHOOL_TIMETABLE_ALL = {
  1: { // 1반
    1: [{p:'1교시',s:'지구 (유병)'}, {p:'2교시',s:'지구 (유병)'}, {p:'3교시',s:'한국사 (홍준)'}, {p:'4교시',s:'물리 (이용)'}, {p:'5교시',s:'수학 (백승)'}, {p:'6교시',s:'수학 (오승)'}],
    2: [{p:'1교시',s:'지구 (오상)'}, {p:'2교시',s:'A문학 (김수)'}, {p:'3교시',s:'A문학 (김수)'}, {p:'4교시',s:'생명 (백민)'}, {p:'5교시',s:'생명 (이다)'}, {p:'6교시',s:'생명 (이다)'}, {p:'7교시',s:'연구 (오승)'}],
    3: [{p:'1교시',s:'한국사 (홍준)'}, {p:'2교시',s:'체육 (이종)'}, {p:'3교시',s:'B문학 (김수)'}, {p:'4교시',s:'B문학 (김수)'}, {p:'5교시',s:'정보 (김유)'}, {p:'6교시',s:'정보 (김유)'}, {p:'7교시',s:'동아리 (오승)'}],
    4: [{p:'1교시',s:'수학 (백승)'}, {p:'2교시',s:'물리 (채규)'}, {p:'3교시',s:'물리 (이용)'}, {p:'4교시',s:'A문학 (김수)'}, {p:'5교시',s:'수학 (오승)'}, {p:'6교시',s:'B문학 (김수)'}, {p:'7교시',s:'자율 (오승)'}],
    5: [{p:'1교시',s:'수학 (박연)'}, {p:'2교시',s:'수학 (박연)'}, {p:'3교시',s:'화학 (이화)'}, {p:'4교시',s:'화학 (이화)'}, {p:'5교시',s:'체육 (이종)'}, {p:'6교시',s:'한국사 (홍준)'}]
  },
  2: { // 2반 (기존 2-2)
    1: [{p:'1교시',s:'역사 (홍준호)'}, {p:'2교시',s:'체육 (이종현)'}, {p:'3교시',s:'지구 (오상림)'}, {p:'4교시',s:'생물 (백민준)'}, {p:'5교시',s:'수학 (박은미)'}, {p:'6교시',s:'수학 (박은미)'}, {p:'7교시',s:'공강'}, {p:'방과후',s:'청소'}],
    2: [{p:'1교시',s:'수학 (오승은)'}, {p:'2교시',s:'A (국/영/중)'}, {p:'3교시',s:'A (국/영/중)'}, {p:'4교시',s:'체육 (이종현)'}, {p:'5교시',s:'수학 (백승범)'}, {p:'6교시',s:'물리 (이용호)'}, {p:'7교시',s:'연구'}, {p:'방과후',s:''}],
    3: [{p:'1교시',s:'정보 (김유정)'}, {p:'2교시',s:'정보 (김유정)'}, {p:'3교시',s:'B (국/영/중)'}, {p:'4교시',s:'B (국/영/중)'}, {p:'5교시',s:'지구 (유병윤)'}, {p:'6교시',s:'지구 (유병윤)'}, {p:'7교시',s:'동아리'}, {p:'방과후',s:''}],
    4: [{p:'1교시',s:'화학 (이화수)'}, {p:'2교시',s:'화학 (이화수)'}, {p:'3교시',s:'수학 (백승범)'}, {p:'4교시',s:'A (국/영/중)'}, {p:'5교시',s:'역사 (홍준호)'}, {p:'6교시',s:'B (국/영/중)'}, {p:'7교시',s:'창체'}, {p:'방과후',s:'청소'}],
    5: [{p:'1교시',s:'수학 (오승은)'}, {p:'2교시',s:'역사 (홍준호)'}, {p:'3교시',s:'생명 (이다현)'}, {p:'4교시',s:'생명 (이다현)'}, {p:'5교시',s:'물리 (이용호)'}, {p:'6교시',s:'물리 (재규선)'}, {p:'7교시',s:''}, {p:'방과후',s:''}]
  },
  3: { // 3반
    1: [{p:'1교시',s:'수학 (박연)'}, {p:'2교시',s:'수학 (박연)'}, {p:'3교시',s:'수학 (백승)'}, {p:'4교시',s:'지구 (오상)'}, {p:'5교시',s:'지구 (유병)'}, {p:'6교시',s:'지구 (유병)'}],
    2: [{p:'1교시',s:'생명 (백민)'}, {p:'2교시',s:'A중국어 (오정)'}, {p:'3교시',s:'A중국어 (오정)'}, {p:'4교시',s:'물리 (이용)'}, {p:'5교시',s:'물리 (채규)'}, {p:'6교시',s:'한국사 (홍준)'}, {p:'7교시',s:'연구 (유병)'}],
    3: [{p:'1교시',s:'화학 (이화)'}, {p:'2교시',s:'화학 (이화)'}, {p:'3교시',s:'B중국어 (오정)'}, {p:'4교시',s:'B중국어 (오정)'}, {p:'5교시',s:'수학 (오승)'}, {p:'6교시',s:'한국사 (홍준)'}, {p:'7교시',s:'동아리 (유병)'}],
    4: [{p:'1교시',s:'생명 (이다)'}, {p:'2교시',s:'생명 (이다)'}, {p:'3교시',s:'한국사 (홍준)'}, {p:'4교시',s:'A중국어 (오정)'}, {p:'5교시',s:'체육 (이종)'}, {p:'6교시',s:'B중국어 (오정)'}, {p:'7교시',s:'자율 (유병)'}],
    5: [{p:'1교시',s:'수학 (백승)'}, {p:'2교시',s:'체육 (이종)'}, {p:'3교시',s:'수학 (오승)'}, {p:'4교시',s:'물리 (이용)'}, {p:'5교시',s:'정보 (김유)'}, {p:'6교시',s:'정보 (김유)'}]
  },
  4: { // 4반
    1: [{p:'1교시',s:'수학 (백승)'}, {p:'2교시',s:'중국어 (오정)'}, {p:'3교시',s:'물리 (이용)'}, {p:'4교시',s:'한국사 (홍준)'}, {p:'5교시',s:'수학 (오승)'}, {p:'6교시',s:'체육 (이종)'}],
    2: [{p:'1교시',s:'화학 (이화)'}, {p:'2교시',s:'화학 (이화)'}, {p:'3교시',s:'수학 (박연)'}, {p:'4교시',s:'수학 (박연)'}, {p:'5교시',s:'영어 (유환)'}, {p:'6교시',s:'지구 (오상)'}, {p:'7교시',s:'연구 (유환)'}],
    3: [{p:'1교시',s:'생명 (이다)'}, {p:'2교시',s:'생명 (이다)'}, {p:'3교시',s:'체육 (이종)'}, {p:'4교시',s:'한국사 (홍준)'}, {p:'5교시',s:'생명 (백민)'}, {p:'6교시',s:'중국어 (오정)'}, {p:'7교시',s:'동아리 (유환)'}],
    4: [{p:'1교시',s:'영어 (김세)'}, {p:'2교시',s:'한국사 (홍준)'}, {p:'3교시',s:'수학 (오승)'}, {p:'4교시',s:'수학 (백승)'}, {p:'5교시',s:'물리 (이용)'}, {p:'6교시',s:'물리 (채규)'}, {p:'7교시',s:'봉사 (김수)'}],
    5: [{p:'1교시',s:'정보 (김유)'}, {p:'2교시',s:'정보 (김유)'}, {p:'3교시',s:'지구 (유병)'}, {p:'4교시',s:'지구 (유병)'}, {p:'5교시',s:'중국어 (오정)'}, {p:'6교시',s:'영어 (유환)'}]
  },
  5: { // 5반
    1: [{p:'1교시',s:'화학 (이화)'}, {p:'2교시',s:'화학 (이화)'}, {p:'3교시',s:'중국어 (오정)'}, {p:'4교시',s:'체육 (이종)'}, {p:'5교시',s:'생명 (이다)'}, {p:'6교시',s:'생명 (이다)'}],
    2: [{p:'1교시',s:'수학 (백승)'}, {p:'2교시',s:'한국사 (홍준)'}, {p:'3교시',s:'생명 (백민)'}, {p:'4교시',s:'수학 (오승)'}, {p:'5교시',s:'지구 (오상)'}, {p:'6교시',s:'영어 (유환)'}, {p:'7교시',s:'연구 (이화)'}],
    3: [{p:'1교시',s:'중국어 (오정)'}, {p:'2교시',s:'한국사 (홍준)'}, {p:'3교시',s:'물리 (이용)'}, {p:'4교시',s:'물리 (채규)'}, {p:'5교시',s:'수학 (백승)'}, {p:'6교시',s:'물리 (이용)'}, {p:'7교시',s:'동아리 (이화)'}],
    4: [{p:'1교시',s:'중국어 (오정)'}, {p:'2교시',s:'영어 (김세)'}, {p:'3교시',s:'정보 (김유)'}, {p:'4교시',s:'정보 (김유)'}, {p:'5교시',s:'지구 (유병)'}, {p:'6교시',s:'지구 (유병)'}, {p:'7교시',s:'자율 (이화)'}],
    5: [{p:'1교시',s:'한국사 (홍준)'}, {p:'2교시',s:'영어 (유환)'}, {p:'3교시',s:'체육 (이종)'}, {p:'4교시',s:'수학 (오승)'}, {p:'5교시',s:'수학 (박연)'}, {p:'6교시',s:'수학 (박연)'}]
  }
};

// ──────────────────────────────────────────────
// 유틸
// ──────────────────────────────────────────────
// ──────────────────────────────────────────────
// Firebase 연동 (설정 키 입력 준비)
// ──────────────────────────────────────────────
const firebaseConfig = {
  apiKey: "AIzaSyAyTMaUoBSruJmtRdBpr3ZfU5TsVomG-Y4",
  authDomain: "gbshs-351f8.firebaseapp.com",
  projectId: "gbshs-351f8",
  storageBucket: "gbshs-351f8.firebasestorage.app",
  messagingSenderId: "423897285124",
  appId: "1:423897285124:web:8db3306d579d4769cfeb51",
  measurementId: "G-XGKD6QB591"
};

let currentUser = null;
let db = null;
let unsubscribeSnapshot = null;

if (typeof firebase !== 'undefined' && firebaseConfig.apiKey !== "YOUR_API_KEY") {
  firebase.initializeApp(firebaseConfig);
  db = firebase.firestore();

  firebase.auth().onAuthStateChanged(user => {
    const loginBtn  = document.getElementById('loginBtn');
    const userInfo  = document.getElementById('userInfo');
    const userPhoto = document.getElementById('userPhoto');
    const userName  = document.getElementById('userName');

    if (user) {
      currentUser = user;
      if (loginBtn) loginBtn.hidden = true;
      if (userInfo) userInfo.hidden = false;
      if (userPhoto) userPhoto.src = user.photoURL || '';
      if (userName) userName.textContent = user.displayName || '사용자';

      // 로그인 시 입력창 활성화
      const tInput = document.getElementById('taskInput');
      const tBtn   = document.getElementById('addTaskBtn');
      if (tInput) {
        tInput.disabled = false;
        tInput.placeholder = "할일을 추가하세요 (엔터)";
      }
      if (tBtn) tBtn.disabled = false;

      loadState(); // 로그인 시 Firestore 데이터 로드
    } else {
      currentUser = null;
      if (loginBtn) loginBtn.hidden = false;
      if (userInfo) userInfo.hidden = true;

      // 비로그인 시 입력창 비활성화
      const tInput = document.getElementById('taskInput');
      const tBtn   = document.getElementById('addTaskBtn');
      if (tInput) {
        tInput.disabled = true;
        tInput.placeholder = "👉 로그인 후 일정을 추가할 수 있습니다.";
      }
      if (tBtn) tBtn.disabled = true;

      loadState(); // 비로그인 시 로컬 로드
    }
  });

  console.log("Firebase initialized successfully");
} else {
  console.warn("Firebase script not loaded or API key not set");
  if (typeof firebase === 'undefined') {
    // 1초 뒤에 다시 확인 (CDN 로딩 지연 대비)
    setTimeout(() => {
      if (typeof firebase === 'undefined') {
        alert("Firebase 라이브러리를 불러오지 못했습니다. 인터넷 연결을 확인해주세요.");
      }
    }, 1000);
  }
}

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

function escHtml(str) {
  return str.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
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
        const data = doc.data();
        state.pool          = data.pool || [];
        state.schedule      = data.schedule || {};
        state.dayMemo       = data.dayMemo || {};
        state.classNum      = data.classNum || '2';
        state.showTimetable = data.showTimetable === true; // 명시적으로 true일 때만 표시
      } else {
        const localPool = JSON.parse(localStorage.getItem(STORAGE_KEY_POOL));
        const localSched = JSON.parse(localStorage.getItem(STORAGE_KEY_SCHED));
        const localMemo = JSON.parse(localStorage.getItem('dayMemo_v1'));
        const localClass = localStorage.getItem('classNum_v1');

        if (localPool || localSched || localMemo || localClass) {
          state.pool = localPool || [];
          state.schedule = localSched || {};
          state.dayMemo = localMemo || {};
          state.classNum = localClass || '2';
          saveState();
        } else {
          state.pool = []; state.schedule = {}; state.dayMemo = {}; state.classNum = '2';
        }
      }
      
      // 하루 지난 미완료 일정 자동 반환 (렌더링 전에 처리)
      autoReturnExpiredTasks();

      // 메모장 포커스가 없을 때만 리렌더링 (타이핑 끊김 방지)
      const activeElement = document.activeElement;
      if (!activeElement || !activeElement.classList.contains('day-card__memo')) {
        renderPool();
        renderWeek();
      }
      
      const cSel = document.getElementById('classSelect');
      if (cSel) cSel.value = state.classNum;
    }, err => {
      console.error("Firestore 실시간 수신 에러:", err);
      alert("데이터를 불러오지 못했습니다 [" + err.code + "]\n" + err.message + "\n\nFirebase Console에서 Firestore 보안 규칙을 확인해주세요.");
    });
  } else {
    // 로그인하지 않은 상태 (게스트) - 빈 상태
    state.pool = [];
    state.schedule = {};
    state.dayMemo = {};
    state.classNum = '2';
    renderPool();
    renderWeek();
  }
}

function loadLocalState() {
  // 사용하지 않음 (게스트는 무조건 빈 상태)
  state.pool = [];
  state.schedule = {};
  state.dayMemo = {};
  renderPool();
  renderWeek();
}

function saveState() {
  const statusEl = document.getElementById('syncStatus');
  if (statusEl) statusEl.textContent = '☁️ 저장 중...';

  if (currentUser && db) {
    db.collection('users').doc(currentUser.uid).set({
      pool: state.pool,
      schedule: state.schedule,
      dayMemo: state.dayMemo,
      classNum: state.classNum,
      showTimetable: state.showTimetable,
      lastUpdated: firebase.firestore.FieldValue.serverTimestamp()
    }).then(() => {
      if (statusEl) statusEl.textContent = '✅ 저장 완료';
    }).catch(err => {
      console.error("Firestore 저장 에러:", err);
      if (statusEl) statusEl.textContent = '❌ 저장 실패';
    });
  } else {
    localStorage.setItem(STORAGE_KEY_POOL,  JSON.stringify(state.pool));
    localStorage.setItem(STORAGE_KEY_SCHED, JSON.stringify(state.schedule));
    localStorage.setItem('dayMemo_v1',      JSON.stringify(state.dayMemo));
    localStorage.setItem('classNum_v1',     state.classNum);
    if (statusEl) statusEl.textContent = '💾 로컬 저장됨';
  }
}

// ──────────────────────────────────────────────
// DOM 레퍼런스
// ──────────────────────────────────────────────
const poolEl      = document.getElementById('taskPool');
const dayGrid     = document.getElementById('dayGrid');
const weekLabel   = document.getElementById('weekLabel');
const ghost       = document.getElementById('dragGhost');
const trashZone   = document.getElementById('trashZone');
const addTaskBtn  = document.getElementById('addTaskBtn');
const helpBtn      = document.getElementById('helpBtn');
const helpModal    = document.getElementById('helpModal');
const helpCloseBtn = document.getElementById('helpCloseBtn');

const historyModal    = document.getElementById('historyModal');
const historyList     = document.getElementById('historyList');
const historyBtn      = document.getElementById('historyBtn');
const historyCloseBtn = document.getElementById('historyCloseBtn');

const infoModal    = document.getElementById('infoModal');
const infoBtn      = document.getElementById('infoBtn');
const infoCloseBtn = document.getElementById('infoCloseBtn');
const infoHistoryBtn = document.getElementById('infoHistoryBtn');

const fbLoginBtn  = document.getElementById('loginBtn');
const fbLogoutBtn = document.getElementById('logoutBtn');
const settingsBtn = document.getElementById('settingsBtn');
const settingsModal = document.getElementById('settingsModal');
const settingsCloseBtn = document.getElementById('settingsCloseBtn');
const settingsSaveBtn = document.getElementById('settingsSaveBtn');
const classSelect = document.getElementById('classSelect');

if (helpBtn) {
  helpBtn.addEventListener('click', () => { helpModal.hidden = false; });
}
if (helpCloseBtn) {
  helpCloseBtn.addEventListener('click', () => { helpModal.hidden = true; });
  helpModal.addEventListener('click', e => { if (e.target === helpModal) helpModal.hidden = true; });
}

if (settingsBtn) {
  settingsBtn.addEventListener('click', () => {
    classSelect.value = state.classNum;
    const timetableToggle = document.getElementById('timetableToggle');
    if (timetableToggle) timetableToggle.checked = state.showTimetable !== false;
    settingsModal.hidden = false;
  });
}
if (settingsCloseBtn) {
  settingsCloseBtn.addEventListener('click', () => settingsModal.hidden = true);
  settingsModal.addEventListener('click', e => { if (e.target === settingsModal) settingsModal.hidden = true; });
}
if (settingsSaveBtn) {
  settingsSaveBtn.addEventListener('click', () => {
    state.classNum = classSelect.value;
    const timetableToggle = document.getElementById('timetableToggle');
    state.showTimetable = timetableToggle ? timetableToggle.checked : true;
    saveState();
    renderWeek();
    settingsModal.hidden = true;
  });
}

if (fbLoginBtn) {
  console.log("Login button found in DOM");
  fbLoginBtn.addEventListener('click', () => {
    console.log("Login button clicked");
    if (typeof firebase !== 'undefined' && firebase.auth) {
      if (firebaseConfig.apiKey === "YOUR_API_KEY") {
        alert("Firebase 설정 키가 아직 입력되지 않았습니다!\nscript.js 상단의 firebaseConfig를 수정해주세요.");
        return;
      }
      const provider = new firebase.auth.GoogleAuthProvider();

      // 팝업 방식만 사용 (redirect는 Dynamic Links 의존성 및 iOS PWA 버그로 제거)
      firebase.auth().signInWithPopup(provider).catch(err => {
        console.error(err);
        // 사용자가 직접 닫은 경우는 무시
        if (
          err.code === 'auth/popup-closed-by-user' ||
          err.code === 'auth/cancelled-popup-request'
        ) return;
        // 팝업이 차단된 경우 안내
        if (err.code === 'auth/popup-blocked') {
          alert("팝업이 차단되었습니다.\n브라우저 설정에서 팝업을 허용하거나,\nSafari로 접속 후 로그인해주세요.");
          return;
        }
        alert("로그인 중 오류가 발생했습니다: " + err.message);
      });
    } else {
      alert("Firebase 서비스에 연결할 수 없습니다. 잠시 후 다시 시도해주세요.");
    }
  });
}
if (fbLogoutBtn) {
  fbLogoutBtn.addEventListener('click', () => {
    if (typeof firebase !== 'undefined' && firebase.auth) {
      firebase.auth().signOut().then(() => {
        // 로그아웃 시 로컬 데이터 무시하고 화면 초기화
        state.pool = []; state.schedule = {}; state.dayMemo = {};
        renderPool(); renderWeek();
      }).catch(err => {
        console.error(err);
        alert("로그아웃 중 오류가 발생했습니다: " + err.message);
      });
    }
  });
}

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
  if ((state.schedule[key] || []).some(it => it.taskId === taskId)) return; // 이미 있으면 skip
  state.pool = state.pool.filter(t => t.id !== taskId);
  if (!state.schedule[key]) state.schedule[key] = [];
  state.schedule[key].push({ id: uid(), taskId, text, status: null });
  saveState();
  renderPool();
  renderDayTasks(key);
}

// 일정 → 풀로 반환
function returnSchedItemToPool(key, itemId, taskId, text) {
  state.schedule[key] = (state.schedule[key] || []).filter(it => it.id !== itemId);
  if (!state.pool.find(t => t.id === taskId)) {
    state.pool.push({ id: taskId, text });
  }
  saveState();
  renderPool();
  renderDayTasks(key);
}

function renderPool() {
  poolEl.innerHTML = '';
  if (state.pool.length === 0) {
    poolEl.innerHTML = '<span style="color:var(--text-sub);font-size:0.82rem;padding:4px 2px;">할일을 추가해보세요!</span>';
    return;
  }
  state.pool.forEach(task => {
    const card = document.createElement('div');
    card.className = 'pool-card';
    card.dataset.taskId = task.id;
    card.draggable = !!currentUser; // 비로그인 시 드래그 불가
    card.textContent = task.text;

    // ── 더블클릭 / 더블탭 → 현재 날짜에 추가 ──
    if (currentUser) {
      card.addEventListener('dblclick', () => {
        addPoolItemToCurrentDay(task.id, task.text);
      });

      let poolLastTap = 0;
      card.addEventListener('touchend', e => {
        const now = Date.now();
        if (now - poolLastTap < 350) {
          e.preventDefault();
          addPoolItemToCurrentDay(task.id, task.text);
          poolLastTap = 0;
        } else {
          poolLastTap = now;
        }
      }, { passive: false });
    }

    poolEl.appendChild(card);
  });
}

// ──────────────────────────────────────────────
// 날짜 카드 렌더링
// ──────────────────────────────────────────────
function renderWeek() {
  dayGrid.innerHTML = '';
  const d     = currentDay();
  const key   = dateKey(d);
  const today = todayKey();
  const isToday = key === today;
  const items = state.schedule[key] || [];

  const dow = d.getDay();
  let wdColor = '';
  if (dow === 0) wdColor = 'style="color:#dc2626"';
  if (dow === 6) wdColor = 'style="color:#2563eb"';

  weekLabel.textContent =
    `${d.getFullYear()}년 ${d.getMonth()+1}월 ${d.getDate()}일 (${DAYS_KO[dow]})`;

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
  renderTimetable(d);
  renderDayTasks(key);
  setupDayDropZone(card, key);
}

function renderTimetable(currentD) {
  const widget = document.getElementById('timetableWidget');
  if (!widget) return;
  
  // 로그인하지 않은 상태 또는 시간표 끈 경우 숨김
  if (!currentUser || !state.showTimetable) {
    widget.hidden = true;
    return;
  }

  const cNum = state.classNum || '2';
  const myTimetable = SCHOOL_TIMETABLE_ALL[cNum] || {};

  // 오늘 표시할 날짜의 요일
  const tzTodayDow = currentD.getDay();
  // 내일 날짜와 요일 계산
  const nextD = new Date(currentD);
  nextD.setDate(nextD.getDate() + 1);
  const tzNextDow = nextD.getDay();

  // 토(6), 일(0) 은 빈 배열 처리
  const todayTb = myTimetable[tzTodayDow] || [];
  const nextTb = myTimetable[tzNextDow] || [];

  if (todayTb.length === 0 && nextTb.length === 0) {
    widget.hidden = true;
    return;
  }
  
  widget.hidden = false;

  const buildHtml = (tb, title) => {
    if (tb.length === 0) return `<div class="timetable-col"><div class="timetable-title">${title} <span style="font-size:0.8rem;color:var(--text-sub)">(수업 없음)</span></div></div>`;
    let rows = tb.map(item => `
      <div class="timetable-row">
        <span class="tt-period">${item.p}</span>
        <span class="tt-subject">${item.s}</span>
      </div>
    `).join('');
    return `<div class="timetable-col"><div class="timetable-title">${title}</div>${rows}</div>`;
  };

  widget.innerHTML = buildHtml(todayTb, '오늘 시간표') + buildHtml(nextTb, '내일 시간표');
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

  items.forEach(item => {
    const el = document.createElement('div');
    el.className = 'sched-item' + (item.status === 'O' ? ' done' : '');
    el.dataset.itemId = item.id;
    el.dataset.dateKey = key;
    el.dataset.taskId  = item.taskId;
    el.draggable = !!currentUser;
    el.innerHTML = `
      <span class="sched-item__handle" title="드래그로 순서 변경">⠿</span>
      <span class="sched-item__text" title="${escHtml(item.text)}">${escHtml(item.text)}</span>
      <div class="sched-item__ox">
        <button class="btn-o${item.status==='O'?' active':''}" data-date="${key}" data-id="${item.id}" title="완료(O)">O</button>
      </div>`;
    container.appendChild(el);

    // ── 더블클릭 → 풀로 반환 ──
    el.addEventListener('dblclick', e => {
      if (e.target.closest('.sched-item__ox')) return;
      returnSchedItemToPool(key, item.id, item.taskId, item.text);
    });

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
            document.querySelectorAll('.sched-item.selected').forEach(s => s.classList.remove('selected'));
            if (!wasSelected) el.classList.add('selected');
          }
        }
      }, { passive: false });

      el.addEventListener('touchcancel', () => {
        el.classList.remove('selected');
      });
    }
  });

  updateProgress(key);
}

function updateProgress(key) {
  const items = state.schedule[key] || [];
  const done  = items.filter(it => it.status === 'O').length;
  const pct   = items.length ? Math.round((done / items.length) * 100) : 0;
  const bar   = document.querySelector(`[data-date="${key}"] .day-card__progress-bar`);
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

// 이벤트 객체를 받는 래퍼 (핸들용)
function startTouchReorder(e, el, key, itemId) {
  if (!currentUser) return;
  e.preventDefault();
  const t = e.touches[0];
  startTouchReorderAt(t.clientX, t.clientY, el, key, itemId);
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
    dragInfo = { type: 'pool', taskId: card.dataset.taskId, text: card.textContent.trim() };
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
      text:    item.querySelector('.sched-item__text').textContent.trim(),
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
    state.schedule[key] = (state.schedule[key] || []).filter(it => it.id !== itemId);
    if (!state.pool.find(t => t.id === taskId)) {
      state.pool.push({ id: taskId, text });
    }
    saveState();
    endDrag();          // 스케줄 아이템 DOM 제거 전 정리
    renderPool();
    renderDayTasks(key);
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
      state.pool = state.pool.filter(t => t.id !== dragInfo.taskId);
      saveState();
      endDrag();        // DOM에서 제거 전 정리 (dragend 발화 안 됨)
      renderPool();
    } else if (dragInfo.type === 'day') {
      const key = dragInfo.dateKey;
      state.schedule[key] = (state.schedule[key] || []).filter(it => it.id !== dragInfo.itemId);
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
    // 같은 날에 이미 있으면 skip
    if ((state.schedule[key] || []).some(it => it.taskId === taskId)) return;

    // pool에서 제거 + day에 추가
    state.pool = state.pool.filter(t => t.id !== taskId);
    if (!state.schedule[key]) state.schedule[key] = [];
    state.schedule[key].push({ id: uid(), taskId, text, status: null });
    saveState();
    endDrag();    // DOM에서 제거되기 전 정리 (dragend 대체)
    renderPool();
    renderDayTasks(key);
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
  if (btnO) { toggleStatus(btnO.dataset.date, btnO.dataset.id, 'O'); return; }

  const deferBtn = e.target.closest('.defer-btn');
  if (deferBtn) { deferTasks(deferBtn.dataset.date); }
});

dayGrid.addEventListener('input', e => {
  if (!currentUser) return;
  if (e.target.classList.contains('day-card__memo')) {
    const key = e.target.dataset.date;
    state.dayMemo[key] = e.target.value;
    saveState();
  }
});

function toggleStatus(date, id, status) {
  if (!currentUser) { alert('로그인 후 이용 가능합니다.'); return; }
  const items = state.schedule[date] || [];
  const item  = items.find(it => it.id === id);
  if (!item) return;
  // O를 누르면 O, 다시 누르면 null(미완료/X 처리)
  item.status = item.status === 'O' ? null : 'O';
  saveState();
  renderDayTasks(date);
}

function deferTasks(targetDateKey) {
  if (!currentUser) { alert('로그인 후 이용 가능합니다.'); return; }
  const items = state.schedule[targetDateKey] || [];
  // 완료되지 않은 항목들 (null 이나 X)
  const unfinished = items.filter(it => it.status !== 'O');
  if (unfinished.length === 0) return;

  // targetDateKey 파싱 (로컬 시간 기준)
  const [y, m, d] = targetDateKey.split('-');
  const currentD = new Date(y, m - 1, d);
  currentD.setDate(currentD.getDate() + 1);
  const nextDateKey = dateKey(currentD); // 전역 dateKey() 함수 호출 안전

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
const taskInput  = document.getElementById('taskInput');

function addTask() {
  if (!currentUser) { alert("로그인이 필요합니다."); return; }
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
document.getElementById('prevWeekBtn').addEventListener('click', () => { state.dayOffset--; renderWeek(); });
document.getElementById('nextWeekBtn').addEventListener('click', () => { state.dayOffset++; renderWeek(); });

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
    historyModal.hidden = false;
    return;
  }

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
          ${d.getFullYear()}년 ${d.getMonth()+1}월 ${d.getDate()}일 ${DAYS_FULL[dow]}
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

    dayEl.querySelector('.history-day__header').addEventListener('click', () => {
      dayEl.classList.toggle('open');
    });
    historyList.appendChild(dayEl);
  });

  historyModal.hidden = false;
}

historyBtn.addEventListener('click', openHistory);
historyCloseBtn.addEventListener('click', () => { historyModal.hidden = true; });
historyModal.addEventListener('click', e => { if (e.target === historyModal) historyModal.hidden = true; });
document.addEventListener('keydown', e => { if (e.key === 'Escape') { historyModal.hidden = true; infoModal.hidden = true; } });

if (infoBtn) infoBtn.addEventListener('click', () => { infoModal.hidden = false; });
if (infoCloseBtn) infoCloseBtn.addEventListener('click', () => { infoModal.hidden = true; });
if (infoModal) infoModal.addEventListener('click', e => { if (e.target === infoModal) infoModal.hidden = true; });
if (infoHistoryBtn) infoHistoryBtn.addEventListener('click', () => { infoModal.hidden = true; openHistory(); });

// ── 빈 곳 탭 → 선택 해제 ──
document.addEventListener('touchend', e => {
  if (touchReorder) return; // 드래그 중엔 무시
  if (!e.target.closest('.sched-item')) {
    document.querySelectorAll('.sched-item.selected').forEach(s => s.classList.remove('selected'));
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
loadLocalState();
initDrag();
