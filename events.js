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
  prevWeekBtn:          document.getElementById('prevWeekBtn'),
  nextWeekBtn:          document.getElementById('nextWeekBtn')
};

// poolEl, dayGrid, weekLabel, ghost, trashZone, taskInput 은 script.js 전역 변수 사용
const {
  helpModal, helpCloseBtn,
  historyModal, historyList, historyCloseBtn,
  infoModal, infoBtn, infoCloseBtn, infoHistoryBtn,
  fbLoginBtn, fbLogoutBtn,
  settingsBtn, settingsModal, settingsCloseBtn,
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

// ──────────────────────────────────────────────
// 사용자 링크 관리
// ──────────────────────────────────────────────

// 모든 사용자에게 공통으로 표시되는 기본 링크 (삭제 불가)
const DEFAULT_LINKS = [
  { id: '__classcord__', icon: '💬', name: '클래스코드', url: 'https://classcord-ten.vercel.app/' },
];

function renderInfoLinks() {
  const listEl = document.getElementById('userLinksList');
  if (!listEl) return;
  const userLinks = state.links || [];
  listEl.innerHTML = '';

  // 기본 링크 (항상 상단 표시, 삭제 버튼 없음)
  DEFAULT_LINKS.forEach(link => {
    const item = document.createElement('div');
    item.className = 'user-link-item user-link-item--default';
    item.innerHTML = `
      <a href="${escHtml(link.url)}" target="_blank" rel="noopener noreferrer" class="info-link user-link-a">
        <span class="user-link-icon">${escHtml(link.icon || '🔗')}</span>
        <span>${escHtml(link.name)}</span>
      </a>
    `;
    listEl.appendChild(item);
  });

  if (userLinks.length === 0) return;
  userLinks.forEach(link => {
    const item = document.createElement('div');
    item.className = 'user-link-item';
    item.innerHTML = `
      <a href="${escHtml(link.url)}" target="_blank" rel="noopener noreferrer" class="info-link user-link-a">
        <span class="user-link-icon">${escHtml(link.icon || '🔗')}</span>
        <span>${escHtml(link.name)}</span>
      </a>
      <button class="user-link-delete" data-link-id="${link.id}" aria-label="삭제">✕</button>
    `;
    listEl.appendChild(item);
  });
}

(function initLinkManagement() {
  const addLinkToggleBtn = document.getElementById('addLinkToggleBtn');
  const addLinkForm      = document.getElementById('addLinkForm');
  const linkIconInput    = document.getElementById('linkIconInput');
  const linkNameInput    = document.getElementById('linkNameInput');
  const linkUrlInput     = document.getElementById('linkUrlInput');
  const linkCancelBtn    = document.getElementById('linkCancelBtn');
  const linkConfirmBtn   = document.getElementById('linkConfirmBtn');
  const userLinksList    = document.getElementById('userLinksList');

  function clearLinkForm() {
    if (linkIconInput) linkIconInput.value = '';
    if (linkNameInput) linkNameInput.value = '';
    if (linkUrlInput)  linkUrlInput.value  = '';
  }
  function closeLinkForm() {
    if (addLinkForm)      addLinkForm.hidden      = true;
    if (addLinkToggleBtn) addLinkToggleBtn.hidden  = false;
    clearLinkForm();
  }

  if (addLinkToggleBtn) {
    addLinkToggleBtn.addEventListener('click', () => {
      addLinkForm.hidden      = false;
      addLinkToggleBtn.hidden = true;
      linkNameInput?.focus();
    });
  }
  if (linkCancelBtn) linkCancelBtn.addEventListener('click', closeLinkForm);
  if (linkConfirmBtn) {
    linkConfirmBtn.addEventListener('click', () => {
      const name = linkNameInput?.value.trim();
      const url  = linkUrlInput?.value.trim();
      if (!name || !url) return;
      const icon = linkIconInput?.value.trim() || '🔗';
      if (!state.links) state.links = [];
      state.links.push({ id: uid(), name, icon, url });
      saveState();
      renderInfoLinks();
      closeLinkForm();
    });
  }
  if (userLinksList) {
    userLinksList.addEventListener('click', e => {
      const btn = e.target.closest('.user-link-delete');
      if (!btn) return;
      state.links = (state.links || []).filter(l => l.id !== btn.dataset.linkId);
      saveState();
      renderInfoLinks();
    });
  }
})();

bindModal(infoBtn, infoModal, infoCloseBtn, () => { renderDeadlineList(); renderInfoLinks(); });

const suhaengBtn     = document.getElementById('suhaengBtn');
const suhaengOverlay = document.getElementById('suhaengOverlay');
const suhaengFrame   = document.getElementById('suhaengFrame');
const suhaengClose   = document.getElementById('suhaengCloseBtn');

if (suhaengBtn) suhaengBtn.addEventListener('click', () => {
  if (suhaengFrame && !suhaengFrame.src.includes('suhaeng')) {
    suhaengFrame.src = './suhaeng/index.html';
  }
  if (suhaengOverlay) suhaengOverlay.hidden = false;
});
if (suhaengClose) suhaengClose.addEventListener('click', () => {
  if (suhaengOverlay) suhaengOverlay.hidden = true;
});
bindModal(settingsBtn, settingsModal, settingsCloseBtn, () => {
  if (typeof updateGcalUI === 'function') updateGcalUI();
});

// ──────────────────────────────────────────────
// 로그인/로그아웃
// ──────────────────────────────────────────────
if (fbLoginBtn) fbLoginBtn.addEventListener('click', () => startGoogleLogin().catch(handleGoogleAuthError));
const loginScreenBtn = document.getElementById('loginScreenBtn');
if (loginScreenBtn) loginScreenBtn.addEventListener('click', () => startGoogleLogin().catch(handleGoogleAuthError));
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
// 이벤트 위임 – O 토글, 미루기
// ──────────────────────────────────────────────
dayGrid.addEventListener('click', e => {
  // 캘린더 이벤트 완료 버튼
  const gcalBtn = e.target.closest('.btn-gcal-done');
  if (gcalBtn) {
    toggleGcalStatus(gcalBtn.dataset.gcalId, gcalBtn.dataset.date);
    return;
  }
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

  // 캘린더 이벤트가 연결된 경우 완료 상태 동기화
  if (item.gcalEventId && typeof gcalTokenValid === 'function' && gcalTokenValid()) {
    const fn = item.status === 'O' ? gcalMarkEventDone : gcalMarkEventUndone;
    fn(item.gcalEventId, item.text).catch(err => {
      console.warn('캘린더 완료 동기화 실패:', err.message);
    });
  }
}

function toggleGcalStatus(gcalId, dateKey) {
  if (!gcalId || !gcalTokenValid()) return;
  const evs = (gcalEvents[dateKey] || []);
  const ev  = evs.find(e => e.id === gcalId);
  if (!ev) return;

  ev.done = !ev.done;
  renderDayTasks(dateKey);

  const fn = ev.done ? gcalMarkEventDone : gcalMarkEventUndone;
  fn(gcalId, ev.summary).catch(err => {
    // 실패 시 롤백
    ev.done = !ev.done;
    renderDayTasks(dateKey);
    console.warn('캘린더 완료 동기화 실패:', err.message);
  });
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
    if (it.deadline)    moved.deadline    = { ...it.deadline };
    if (it.fromGcal)    moved.fromGcal    = true;
    if (it.gcalEventId) moved.gcalEventId = it.gcalEventId;
    if (it.gcalDate)    moved.gcalDate    = it.gcalDate;
    if (it.timeLabel)   moved.timeLabel   = it.timeLabel;
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

  // 전체 통계
  const totalAll = allKeys.reduce((s, k) => s + state.schedule[k].length, 0);
  const doneAll  = allKeys.reduce((s, k) => s + state.schedule[k].filter(it => it.status === 'O').length, 0);
  const pctAll   = totalAll ? Math.round(doneAll / totalAll * 100) : 0;

  const statsEl = document.createElement('div');
  statsEl.className = 'history-stats';
  statsEl.innerHTML = `
    <div class="history-stats__row">
      <span class="history-stats__label">📅 ${allKeys.length}일 기록</span>
      <span class="history-stats__label">✅ ${doneAll}/${totalAll} 완료 (${pctAll}%)</span>
    </div>
    <div class="history-stats__bar-wrap">
      <div class="history-stats__bar" style="width:${pctAll}%"></div>
    </div>`;
  historyList.appendChild(statsEl);

  const searchWrap = document.createElement('div');
  searchWrap.className = 'history-search-wrap';
  searchWrap.innerHTML = '<input type="text" id="historySearch" class="history-search" placeholder="🔍 할일 검색…" autocomplete="off">';
  historyList.appendChild(searchWrap);

  const listBody = document.createElement('div');
  listBody.className = 'history-body';
  historyList.appendChild(listBody);

  function renderHistoryBody(query) {
    listBody.innerHTML = '';
    const q = (query || '').trim().toLowerCase();

    const months = {};
    allKeys.forEach(key => {
      const mk = key.slice(0, 7);
      (months[mk] = months[mk] || []).push(key);
    });

    const monthKeys = Object.keys(months).sort((a, b) => b.localeCompare(a));
    const frag = document.createDocumentFragment();
    let firstMonth = true;

    monthKeys.forEach(mk => {
      const days = q
        ? months[mk].filter(k => state.schedule[k].some(it => it.text.toLowerCase().includes(q)))
        : months[mk];
      if (!days.length) return;

      const [y, m] = mk.split('-');
      const totalTasks = days.reduce((s, k) => s + state.schedule[k].length, 0);

      const monthEl = document.createElement('div');
      monthEl.className = 'history-month' + (firstMonth ? ' open' : '');
      monthEl.innerHTML = `
        <div class="history-month__header">
          <div class="history-month__header-top">
            <span class="history-month__title">${y}년 ${parseInt(m)}월</span>
            <span class="history-month__summary">${totalTasks}개</span>
            <span class="history-month__chevron">▼</span>
          </div>
        </div>
        <div class="history-month__body"></div>`;

      const monthBody = monthEl.querySelector('.history-month__body');
      days.forEach((key, idx) => {
        const rawItems = state.schedule[key];
        const items = q ? rawItems.filter(it => it.text.toLowerCase().includes(q)) : rawItems;
        const d   = new Date(key);
        const dow = d.getDay();
        const dayEl = document.createElement('div');
        dayEl.className = 'history-day' + (firstMonth && idx === 0 ? ' open' : '');
        let titleColor = '';
        if (dow === 0) titleColor = 'style="color:#dc2626"';
        if (dow === 6) titleColor = 'style="color:#2563eb"';
        dayEl.innerHTML = `
          <div class="history-day__header">
            <span class="history-day__title" ${titleColor}>${formatHistoryDateLabel(d)}</span>
            <span class="history-day__summary">${items.length}개</span>
            <span class="history-day__chevron">▼</span>
          </div>
          <div class="history-day__tasks">
            ${items.map(it => `
              <div class="history-task">
                <span class="history-task__text">${escHtml(it.text)}</span>
              </div>`).join('')}
          </div>`;
        monthBody.appendChild(dayEl);
      });

      frag.appendChild(monthEl);
      firstMonth = false;
    });

    if (!frag.childNodes.length) {
      const empty = document.createElement('p');
      empty.className = 'history-empty';
      empty.textContent = '검색 결과가 없어요.';
      listBody.appendChild(empty);
    } else {
      listBody.appendChild(frag);
    }
  }

  renderHistoryBody('');

  searchWrap.querySelector('#historySearch').addEventListener('input', e => {
    renderHistoryBody(e.target.value);
  });

  setModalOpen(historyModal, true);
  setTimeout(() => searchWrap.querySelector('#historySearch')?.focus(), 150);
}

historyList.addEventListener('click', e => {
  const dayHeader = e.target.closest('.history-day__header');
  if (dayHeader) { dayHeader.parentElement.classList.toggle('open'); return; }
  const monthHeader = e.target.closest('.history-month__header');
  if (monthHeader) { monthHeader.parentElement.classList.toggle('open'); }
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

// ──────────────────────────────────────────────
// 구글 캘린더 연동
// ──────────────────────────────────────────────
const gcalReconnectBtn  = document.getElementById('gcalReconnectBtn');
const gcalConnectBtn    = document.getElementById('gcalConnectBtn');
const gcalSyncBtn       = document.getElementById('gcalSyncBtn');
const gcalDisconnectBtn = document.getElementById('gcalDisconnectBtn');
const gcalSyncResult    = document.getElementById('gcalSyncResult');

function showGcalResult(msg, isError = false) {
  if (!gcalSyncResult) return;
  gcalSyncResult.textContent = msg;
  gcalSyncResult.className = 'gcal-sync-result' + (isError ? ' gcal-sync-result--error' : '');
  gcalSyncResult.hidden = false;
  setTimeout(() => { gcalSyncResult.hidden = true; }, 4000);
}

if (gcalConnectBtn) {
  gcalConnectBtn.addEventListener('click', async () => {
    gcalConnectBtn.disabled = true;
    gcalConnectBtn.textContent = '연결 중...';
    try {
      await gcalConnect();
      updateGcalUI();
      showGcalResult('✅ 구글 캘린더가 연결되었습니다.');
      // 연결 즉시 현재 날짜 이벤트 가져오기 + 폴링 시작
      gcalImportCurrentDate();
      gcalStartPolling();
    } catch (err) {
      console.error('gcal connect error:', err);
      showGcalResult('❌ 연결 실패: ' + (err.message || '다시 시도해주세요.'), true);
      gcalConnectBtn.disabled = false;
      gcalConnectBtn.textContent = '🗓️ 캘린더 연결';
    }
  });
}

if (gcalSyncBtn) {
  gcalSyncBtn.addEventListener('click', async () => {
    gcalSyncBtn.disabled = true;
    gcalSyncBtn.textContent = '동기화 중...';
    try {
      const { created, failed } = await gcalSyncAll();
      const msg = created > 0
        ? `✅ ${created}개 일정이 캘린더에 추가되었습니다.${failed > 0 ? ` (${failed}개 실패)` : ''}`
        : failed > 0 ? `❌ 동기화 실패 (${failed}개)` : '이미 모든 일정이 동기화되어 있습니다.';
      showGcalResult(msg, failed > 0 && created === 0);
    } catch (err) {
      console.error('gcal sync error:', err);
      showGcalResult('❌ ' + (err.message || '동기화 중 오류가 발생했습니다.'), true);
      updateGcalUI();
    } finally {
      gcalSyncBtn.disabled = false;
      gcalSyncBtn.textContent = '☁️ 전체 동기화';
    }
  });
}

// 헤더 재연결 버튼 (silent 복원 실패 시 표시)
if (gcalReconnectBtn) {
  gcalReconnectBtn.addEventListener('click', async () => {
    gcalReconnectBtn.disabled = true;
    gcalReconnectBtn.textContent = '연결 중...';
    try {
      await gcalConnect();
      gcalReconnectBtn.hidden = true;
      gcalReconnectBtn.disabled = false;
      gcalReconnectBtn.textContent = '🗓️ 재연결';
      updateGcalUI();
      gcalImportCurrentDate();
      gcalStartPolling();
    } catch (err) {
      gcalReconnectBtn.disabled = false;
      gcalReconnectBtn.textContent = '🗓️ 재연결';
      alert('재연결 실패: ' + (err.message || '다시 시도해주세요.'));
    }
  });
}

if (gcalDisconnectBtn) {
  gcalDisconnectBtn.addEventListener('click', () => {
    gcalClearToken();
    gcalStopPolling();
    gcalEvents = {};
    updateGcalUI();
    renderWeek(); // 캘린더 이벤트 화면에서 제거
    showGcalResult('캘린더 연결이 해제되었습니다.');
  });
}

// ── 캘린더 뷰 모달 ──
const gcalViewBtn      = document.getElementById('gcalViewBtn');
const gcalViewModal    = document.getElementById('gcalViewModal');
const gcalViewCloseBtn = document.getElementById('gcalViewCloseBtn');
const gcalCalGrid      = document.getElementById('gcalCalGrid');

if (gcalViewBtn) {
  gcalViewBtn.addEventListener('click', () => {
    gcalViewModal.hidden = false;
    renderGcalCalendar();
  });
}
if (gcalViewCloseBtn) {
  gcalViewCloseBtn.addEventListener('click', () => { gcalViewModal.hidden = true; });
}
if (gcalViewModal) {
  gcalViewModal.addEventListener('click', e => {
    if (e.target === gcalViewModal) gcalViewModal.hidden = true;
  });
}

// 달력 뷰 내 이벤트 완료 토글
if (gcalCalGrid) {
  gcalCalGrid.addEventListener('click', e => {
    const chip = e.target.closest('.gcal-cal-event');
    if (!chip) return;
    const gcalId  = chip.dataset.gcalId;
    const dk      = chip.dataset.dateKey;
    const evs     = gcalEvents[dk] || [];
    const ev      = evs.find(ev => ev.id === gcalId);
    if (!ev || !gcalTokenValid()) return;
    ev.done = !ev.done;
    chip.className = 'gcal-cal-event' + (ev.done ? ' done' : '');
    const fn = ev.done ? gcalMarkEventDone : gcalMarkEventUndone;
    fn(gcalId, ev.summary).catch(err => {
      ev.done = !ev.done;
      chip.className = 'gcal-cal-event' + (ev.done ? ' done' : '');
      console.warn('캘린더 완료 동기화 실패:', err.message);
    });
    // 메인 화면도 업데이트
    if (typeof renderDayTasks === 'function') renderDayTasks(dk);
  });
}

// ── 빈 곳 탭 → 선택 해제 ──
document.addEventListener('touchend', e => {
  if (touchReorder) return;
  if (!e.target.closest('.sched-item')) clearSelectedScheduleItems();
}, { passive: true });

// ──────────────────────────────────────────────
// 시험 D-day 표시
// ──────────────────────────────────────────────
function updateDday() {
  const exam         = new Date('2026-06-22T00:00:00');
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

// ──────────────────────────────────────────────
// 🔍 데모 모달
// ──────────────────────────────────────────────
(function initDemo() {
  const demoBtn   = document.getElementById('demoBtn');
  const demoModal = document.getElementById('demoModal');
  const closeBtn  = document.getElementById('demoCloseBtn');
  const prevBtn   = document.getElementById('demoPrevBtn');
  const nextBtn   = document.getElementById('demoNextBtn');
  const slides    = document.querySelectorAll('.demo-slide');
  const dots      = document.querySelectorAll('.demo-dot');
  if (!demoBtn || !demoModal) return;

  let current = 0;
  const total = slides.length;

  // 타이핑 애니메이션 (슬라이드 1)
  let typingTimer = null;
  function startTyping() {
    const el = document.getElementById('demoTypingText');
    if (!el) return;
    const words = ['수학 숙제', ''];
    let wi = 0, ci = 0, deleting = false;
    clearInterval(typingTimer);
    typingTimer = setInterval(() => {
      const word = words[wi];
      if (!deleting) {
        el.textContent = word.slice(0, ++ci);
        if (ci === word.length) { deleting = true; setTimeout(() => {}, 800); }
      } else {
        el.textContent = word.slice(0, --ci);
        if (ci === 0) { deleting = false; wi = (wi + 1) % words.length; }
      }
    }, 120);
  }
  function stopTyping() {
    clearInterval(typingTimer);
    const el = document.getElementById('demoTypingText');
    if (el) el.textContent = '';
  }

  function goTo(idx) {
    const prev = current;
    // 이전 슬라이드 숨기기 (유효한 경우만)
    if (prev >= 0 && slides[prev]) {
      slides[prev].classList.remove('active');
      slides[prev].classList.add('exit-left');
      setTimeout(() => { if (slides[prev]) slides[prev].classList.remove('exit-left'); }, 300);
    }

    current = idx;
    slides[current].classList.add('active');

    dots.forEach((d, i) => d.classList.toggle('demo-dot--active', i === current));
    prevBtn.disabled = current === 0;
    nextBtn.disabled = false;
    nextBtn.textContent = current === total - 1 ? '✓' : '▶';

    stopTyping();
    if (current === 0) setTimeout(startTyping, 400);
  }

  function openDemo() {
    demoModal.hidden = false;
    current = -1;
    goTo(0);
  }
  function closeDemo() {
    demoModal.hidden = true;
    stopTyping();
  }

  demoBtn.addEventListener('click', openDemo);
  closeBtn.addEventListener('click', closeDemo);
  demoModal.addEventListener('click', e => { if (e.target === demoModal) closeDemo(); });
  prevBtn.addEventListener('click', () => { if (current > 0) goTo(current - 1); });
  nextBtn.addEventListener('click', () => {
    if (current < total - 1) goTo(current + 1);
    else closeDemo();
  });

  // 키보드 방향키
  document.addEventListener('keydown', e => {
    if (demoModal.hidden) return;
    if (e.key === 'ArrowRight' && current < total - 1) goTo(current + 1);
    if (e.key === 'ArrowLeft'  && current > 0)         goTo(current - 1);
    if (e.key === 'Escape') closeDemo();
  });
})();

// ──────────────────────────────────────────────
// 📶 오프라인 감지 배너
// ──────────────────────────────────────────────
(function initOfflineBanner() {
  const banner = document.getElementById('offlineBanner');
  if (!banner) return;

  function update() {
    if (navigator.onLine) {
      banner.classList.remove('offline-banner--show');
    } else {
      banner.classList.add('offline-banner--show');
    }
  }

  window.addEventListener('online',  update);
  window.addEventListener('offline', update);
  update(); // 초기 상태 확인
})();
