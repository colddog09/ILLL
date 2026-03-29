/* ============================================================
   events.js — DOM 레퍼런스 및 이벤트 핸들러
   ============================================================ */

'use strict';

// ──────────────────────────────────────────────
// DOM 레퍼런스 (poolEl/dayGrid/weekLabel/ghost/trashZone/taskInput은 script.js에서 전역 정의됨)
// ──────────────────────────────────────────────
const dom = {
  poolEl,
  dayGrid,
  weekLabel,
  ghost,
  trashZone,
  taskInput,
  syncStatus:           document.getElementById('syncStatus'),
  helpBtn:              document.getElementById('helpBtn'),
  helpModal:            document.getElementById('helpModal'),
  helpCloseBtn:         document.getElementById('helpCloseBtn'),
  historyModal:         document.getElementById('historyModal'),
  historyList:          document.getElementById('historyList'),
  historyCloseBtn:      document.getElementById('historyCloseBtn'),
  infoModal:            document.getElementById('infoModal'),
  infoBtn:              document.getElementById('infoBtn'),
  infoCloseBtn:         document.getElementById('infoCloseBtn'),
  infoHistoryBtn:       document.getElementById('infoHistoryBtn'),
  fbLoginBtn:           document.getElementById('loginBtn'),
  fbLogoutBtn:          document.getElementById('logoutBtn'),
  authHint:             document.getElementById('authHint'),
  userInfo:             document.getElementById('userInfo'),
  userPhoto:            document.getElementById('userPhoto'),
  userName:             document.getElementById('userName'),
  settingsBtn:          document.getElementById('settingsBtn'),
  settingsModal:        document.getElementById('settingsModal'),
  settingsCloseBtn:     document.getElementById('settingsCloseBtn'),
  settingsSaveBtn:      document.getElementById('settingsSaveBtn'),
  classSelect:          document.getElementById('classSelect'),
  gradeSelect:          document.getElementById('gradeSelect'),
  surveyVisibilityBadge:document.getElementById('surveyVisibilityBadge'),
  surveyLinksMobile:    document.getElementById('surveyLinksMobile'),
  prevWeekBtn:          document.getElementById('prevWeekBtn'),
  nextWeekBtn:          document.getElementById('nextWeekBtn')
};

// poolEl, dayGrid, weekLabel, ghost, trashZone, taskInput 은 script.js 전역 변수 사용
const {
  helpBtn, helpModal, helpCloseBtn,
  historyModal, historyList, historyCloseBtn,
  infoModal, infoBtn, infoCloseBtn, infoHistoryBtn,
  fbLoginBtn, fbLogoutBtn,
  settingsBtn, settingsModal, settingsCloseBtn, settingsSaveBtn,
  classSelect, gradeSelect,
  prevWeekBtn, nextWeekBtn
} = dom;

// ──────────────────────────────────────────────
// 모달 바인딩 헬퍼
// ──────────────────────────────────────────────
function setModalOpen(modal, open) {
  if (modal) modal.hidden = !open;
}

function bindModal(openBtn, modal, closeBtn, beforeOpen) {
  if (openBtn) openBtn.addEventListener('click', () => { if (beforeOpen) beforeOpen(); setModalOpen(modal, true); });
  if (closeBtn) closeBtn.addEventListener('click', () => setModalOpen(modal, false));
  if (modal) modal.addEventListener('click', e => { if (e.target === modal) setModalOpen(modal, false); });
}

// ──────────────────────────────────────────────
// 설정 모달
// ──────────────────────────────────────────────
function updateSurveyVisibility() {
  const isGrade2 = state.grade === '2';
  if (dom.surveyLinksMobile) dom.surveyLinksMobile.hidden = !isGrade2;
}

function updateSettingsPreview() {
  if (!dom.surveyVisibilityBadge) return;
  const visible = (gradeSelect ? gradeSelect.value : state.grade) === '2';
  dom.surveyVisibilityBadge.dataset.active = visible ? 'true' : 'false';
  dom.surveyVisibilityBadge.textContent    = visible ? '질문노트 링크 표시' : '질문노트 링크 숨김';
}

bindModal(helpBtn, helpModal, helpCloseBtn);

function renderDeadlineList() {
  const listEl = document.getElementById('deadlineList');
  if (!listEl) return;
  const tasks = (state.pool || []).filter(t => t.deadline);
  if (tasks.length === 0) {
    listEl.innerHTML = '<p style="font-size:0.82rem;color:var(--text-sub);">기한이 설정된 할일이 없어요.</p>';
    return;
  }
  const now  = new Date();
  const year = now.getFullYear();
  tasks.sort((a, b) => {
    const toDate = dl => {
      const d = new Date(year, parseInt(dl.month) - 1, parseInt(dl.day), ...dl.time.split(':').map(Number));
      if (d < now) d.setFullYear(year + 1);
      return d;
    };
    return toDate(a.deadline) - toDate(b.deadline);
  });
  listEl.innerHTML = '';
  tasks.forEach(t => {
    const urgent = isDeadlineUrgent(t.deadline);
    const row    = document.createElement('div');
    row.className = 'deadline-list__item' + (urgent ? ' deadline-list__item--urgent' : '');
    row.innerHTML = `
      <span class="deadline-list__clock">${urgent ? '🔴' : '⏰'}</span>
      <span class="deadline-list__text">${escHtml(t.text)}</span>
      <span class="deadline-list__due">${formatDeadlineText(t.deadline)}</span>
    `;
    listEl.appendChild(row);
  });
}

bindModal(infoBtn, infoModal, infoCloseBtn, renderDeadlineList);
bindModal(settingsBtn, settingsModal, settingsCloseBtn, () => {
  if (gradeSelect) gradeSelect.value = state.grade;
  if (classSelect) classSelect.value = state.classNum;
  updateSettingsPreview();
});

if (settingsSaveBtn) {
  settingsSaveBtn.addEventListener('click', () => {
    if (gradeSelect) state.grade    = gradeSelect.value;
    if (classSelect) state.classNum = classSelect.value;
    saveState();
    updateSurveyVisibility();
    setModalOpen(settingsModal, false);
  });
}

if (gradeSelect) gradeSelect.addEventListener('change', updateSettingsPreview);

// ──────────────────────────────────────────────
// 로그인/로그아웃
// ──────────────────────────────────────────────
if (fbLoginBtn) fbLoginBtn.addEventListener('click', () => startGoogleLogin().catch(handleGoogleAuthError));
if (fbLogoutBtn) {
  fbLogoutBtn.addEventListener('click', () => {
    if (typeof firebase !== 'undefined' && firebase.auth) {
      firebase.auth().signOut()
        .then(() => { resetScheduleState(); renderApp(); })
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
    poolTapState.taskId     = null;
    poolTapState.lastTapTime = 0;
    handlePoolCardActivate(card);
    return;
  }
  poolTapState.taskId      = card.dataset.taskId;
  poolTapState.lastTapTime = now;
}, { passive: false });

// ──────────────────────────────────────────────
// 이벤트 위임 – O 토글, 미루기, 메모
// ──────────────────────────────────────────────
dayGrid.addEventListener('click', e => {
  const btnO    = e.target.closest('.btn-o');
  if (btnO) { toggleStatus(btnO.dataset.date, btnO.dataset.id); return; }
  const deferBtn = e.target.closest('.defer-btn');
  if (deferBtn)  { deferTasks(deferBtn.dataset.date); }
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

// ──────────────────────────────────────────────
// 상태 토글 / 미루기
// ──────────────────────────────────────────────
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
  const items      = state.schedule[targetDateKey] || [];
  const unfinished = items.filter(it => it.status !== 'O');
  if (unfinished.length === 0) return;
  const nextDateKey = getNextDateKey(targetDateKey);
  state.schedule[targetDateKey] = items.filter(it => it.status === 'O');
  if (!state.schedule[nextDateKey]) state.schedule[nextDateKey] = [];
  unfinished.forEach(it => {
    const moved = { id: uid(), taskId: it.taskId, text: it.text, status: null };
    if (it.deadline) moved.deadline = { ...it.deadline };
    state.schedule[nextDateKey].push(moved);
  });
  saveState();
  renderWeek();
}

// ──────────────────────────────────────────────
// 할일 추가 (인풋)
// ──────────────────────────────────────────────
const addTaskBtn = document.getElementById('addTaskBtn');

function addTaskFromInput() {
  if (!requireLogin('로그인이 필요합니다.')) return;
  const text = taskInput.value.trim();
  if (!text) return;
  const task = { id: uid(), text };
  if (pendingDeadline) task.deadline = { ...pendingDeadline };
  state.pool.push(task);
  saveState();
  renderPool();
  taskInput.value  = '';
  pendingDeadline  = null;
  updateDeadlineBtn();
  deadlinePopup.hidden = true;
}

taskInput.addEventListener('keydown', e => {
  if (e.isComposing || e.keyCode === 229) return;
  if (e.key === 'Enter') addTaskFromInput();
});

addTaskBtn.addEventListener('click', () => addTaskFromInput());

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
  setModalOpen(historyModal,  false);
  setModalOpen(infoModal,     false);
  setModalOpen(helpModal,     false);
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
// 시험 D-day 표시
// ──────────────────────────────────────────────
function updateDday() {
  const exam         = new Date('2026-04-20T00:00:00');
  const now          = new Date();
  const todayMidnight = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const diff         = Math.round((exam - todayMidnight) / (1000 * 60 * 60 * 24));
  const textSchedule = diff > 0 ? `🔥 시험 D-${diff}` : diff === 0 ? `🔥 시험 D-Day!` : `🔥 시험 D+${Math.abs(diff)}`;
  const badgeSchedule = document.getElementById('ddayBadge');
  if (badgeSchedule) badgeSchedule.textContent = textSchedule;
}

// ──────────────────────────────────────────────
// 앱 초기화 — 모든 스크립트 로드 완료 후 실행
// ──────────────────────────────────────────────
resetScheduleState();
renderApp();
initDrag();
updateDday();
updateSettingsPreview();
