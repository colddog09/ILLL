/* ============================================================
   events.js — 핵심 이벤트 핸들러
   (모달/테마 등은 modals.js 참조)
   ============================================================ */

'use strict';

// ──────────────────────────────────────────────
// 로그인 / 로그아웃
// ──────────────────────────────────────────────
document.getElementById('loginBtn')?.addEventListener('click', () =>
  startGoogleLogin().catch(handleGoogleAuthError)
);
document.getElementById('loginScreenBtn')?.addEventListener('click', () =>
  startGoogleLogin().catch(handleGoogleAuthError)
);
document.getElementById('logoutBtn')?.addEventListener('click', () =>
  signOut().catch(err => { console.error(err); alert('로그아웃 중 오류: ' + err.message); })
);

// ──────────────────────────────────────────────
// 풀 카드 더블클릭 / 더블탭 → 오늘 날짜에 추가
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
    poolTapState.taskId = poolTapState.lastTapTime = 0;
    handlePoolCardActivate(card);
    return;
  }
  poolTapState.taskId     = card.dataset.taskId;
  poolTapState.lastTapTime = now;
}, { passive: false });

// ──────────────────────────────────────────────
// dayGrid 이벤트 위임 — 완료 토글, 미루기
// ──────────────────────────────────────────────
dayGrid.addEventListener('click', e => {
  const gcalBtn = e.target.closest('.btn-gcal-done');
  if (gcalBtn) { toggleGcalStatus(gcalBtn.dataset.gcalId, gcalBtn.dataset.date); return; }

  const btnO = e.target.closest('.btn-o');
  if (btnO) { toggleStatus(btnO.dataset.date, btnO.dataset.id); return; }

  const deferBtn = e.target.closest('.defer-btn');
  if (deferBtn) deferTasks(deferBtn.dataset.date);
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
  const item = (state.schedule[date] || []).find(it => it.id === id);
  if (!item) return;
  item.status = item.status === 'O' ? null : 'O';
  saveState();
  renderDayTasks(date);

  if (item.gcalEventId && typeof gcalTokenValid === 'function' && gcalTokenValid()) {
    const fn = item.status === 'O' ? gcalMarkEventDone : gcalMarkEventUndone;
    fn(item.gcalEventId, item.text).catch(err => console.warn('캘린더 동기화 실패:', err.message));
  }
}

function toggleGcalStatus(gcalId, dateKey) {
  if (!gcalId || !gcalTokenValid()) return;
  const ev = (gcalEvents[dateKey] || []).find(e => e.id === gcalId);
  if (!ev) return;

  ev.done = !ev.done;
  renderDayTasks(dateKey);

  const fn = ev.done ? gcalMarkEventDone : gcalMarkEventUndone;
  fn(gcalId, ev.summary).catch(err => {
    ev.done = !ev.done;
    renderDayTasks(dateKey);
    console.warn('캘린더 동기화 실패:', err.message);
  });
}

function deferTasks(targetDateKey) {
  if (!requireLogin()) return;
  const items      = state.schedule[targetDateKey] || [];
  const unfinished = items.filter(it => it.status !== 'O');
  if (!unfinished.length) return;

  const nextKey = getNextDateKey(targetDateKey);
  state.schedule[targetDateKey] = items.filter(it => it.status === 'O');
  if (!state.schedule[nextKey]) state.schedule[nextKey] = [];
  unfinished.forEach(it => {
    const moved = { id: uid(), taskId: it.taskId, text: it.text, status: null };
    if (it.deadline)    moved.deadline    = { ...it.deadline };
    if (it.fromGcal)    moved.fromGcal    = true;
    if (it.gcalEventId) moved.gcalEventId = it.gcalEventId;
    if (it.gcalDate)    moved.gcalDate    = it.gcalDate;
    if (it.timeLabel)   moved.timeLabel   = it.timeLabel;
    state.schedule[nextKey].push(moved);
  });
  saveState();
  renderWeek();
}

// ──────────────────────────────────────────────
// 할일 추가 (인풋)
// ──────────────────────────────────────────────
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
document.getElementById('addTaskBtn').addEventListener('click', addTaskFromInput);

// ──────────────────────────────────────────────
// 날짜 네비게이션 + 뷰 모드
// ──────────────────────────────────────────────
document.getElementById('prevWeekBtn').addEventListener('click', () => { state.dayOffset--; renderWeek(); });
document.getElementById('nextWeekBtn').addEventListener('click', () => { state.dayOffset++; renderWeek(); });

// ──────────────────────────────────────────────
// 구글 캘린더 버튼
// ──────────────────────────────────────────────
const gcalSyncResult    = document.getElementById('gcalSyncResult');
const gcalConnectBtn    = document.getElementById('gcalConnectBtn');
const gcalSyncBtn       = document.getElementById('gcalSyncBtn');
const gcalReconnectBtn  = document.getElementById('gcalReconnectBtn');
const gcalDisconnectBtn = document.getElementById('gcalDisconnectBtn');

function showGcalResult(msg, isError = false) {
  if (!gcalSyncResult) return;
  gcalSyncResult.textContent = msg;
  gcalSyncResult.className   = 'gcal-sync-result' + (isError ? ' gcal-sync-result--error' : '');
  gcalSyncResult.hidden      = false;
  setTimeout(() => { gcalSyncResult.hidden = true; }, 4000);
}

gcalConnectBtn?.addEventListener('click', async () => {
  gcalConnectBtn.disabled    = true;
  gcalConnectBtn.textContent = '연결 중...';
  try {
    await gcalConnect();
    updateGcalUI();
    showGcalResult('✅ 구글 캘린더가 연결되었습니다.');
    gcalImportCurrentDate();
    gcalStartPolling();
  } catch (err) {
    showGcalResult('❌ 연결 실패: ' + (err.message || '다시 시도해주세요.'), true);
    gcalConnectBtn.disabled    = false;
    gcalConnectBtn.textContent = '🗓️ 캘린더 연결';
  }
});

gcalSyncBtn?.addEventListener('click', async () => {
  gcalSyncBtn.disabled    = true;
  gcalSyncBtn.textContent = '동기화 중...';
  try {
    const { created, failed } = await gcalSyncAll();
    const msg = created > 0
      ? `✅ ${created}개 일정 추가${failed > 0 ? ` (${failed}개 실패)` : ''}`
      : failed > 0 ? `❌ 동기화 실패 (${failed}개)` : '이미 동기화되어 있습니다.';
    showGcalResult(msg, failed > 0 && created === 0);
  } catch (err) {
    showGcalResult('❌ ' + (err.message || '동기화 오류'), true);
    updateGcalUI();
  } finally {
    gcalSyncBtn.disabled    = false;
    gcalSyncBtn.textContent = '☁️ 전체 동기화';
  }
});

gcalReconnectBtn?.addEventListener('click', async () => {
  gcalReconnectBtn.disabled    = true;
  gcalReconnectBtn.textContent = '연결 중...';
  try {
    await gcalConnect();
    gcalReconnectBtn.hidden    = true;
    gcalReconnectBtn.disabled  = false;
    gcalReconnectBtn.textContent = '🗓️ 재연결';
    updateGcalUI();
    gcalImportCurrentDate();
    gcalStartPolling();
  } catch (err) {
    gcalReconnectBtn.disabled    = false;
    gcalReconnectBtn.textContent = '🗓️ 재연결';
    alert('재연결 실패: ' + (err.message || '다시 시도해주세요.'));
  }
});

gcalDisconnectBtn?.addEventListener('click', () => {
  gcalClearToken();
  gcalStopPolling();
  gcalEvents = {};
  updateGcalUI();
  renderWeek();
  showGcalResult('캘린더 연결이 해제되었습니다.');
});

// 달력 뷰 모달
const gcalViewBtn      = document.getElementById('gcalViewBtn');
const gcalViewModal    = document.getElementById('gcalViewModal');
const gcalViewCloseBtn = document.getElementById('gcalViewCloseBtn');
const gcalCalGrid      = document.getElementById('gcalCalGrid');

gcalViewBtn?.addEventListener('click', () => {
  if (gcalViewModal) gcalViewModal.hidden = false;
  renderGcalCalendar();
});
gcalViewCloseBtn?.addEventListener('click', () => { if (gcalViewModal) gcalViewModal.hidden = true; });
gcalViewModal?.addEventListener('click', e => { if (e.target === gcalViewModal) gcalViewModal.hidden = true; });

gcalCalGrid?.addEventListener('click', e => {
  const chip = e.target.closest('.gcal-cal-event');
  if (!chip || !gcalTokenValid()) return;
  const gcalId = chip.dataset.gcalId;
  const dk     = chip.dataset.dateKey;
  const ev     = (gcalEvents[dk] || []).find(ev => ev.id === gcalId);
  if (!ev) return;

  ev.done    = !ev.done;
  chip.className = 'gcal-cal-event' + (ev.done ? ' done' : '');
  const fn   = ev.done ? gcalMarkEventDone : gcalMarkEventUndone;
  fn(gcalId, ev.summary).catch(err => {
    ev.done    = !ev.done;
    chip.className = 'gcal-cal-event' + (ev.done ? ' done' : '');
    console.warn('캘린더 동기화 실패:', err.message);
  });
  renderDayTasks?.(dk);
});

// ──────────────────────────────────────────────
// 키보드 단축키
// ──────────────────────────────────────────────
document.addEventListener('keydown', e => {
  if (e.key !== 'Escape') return;
  [
    document.getElementById('historyModal'),
    document.getElementById('infoModal'),
    document.getElementById('helpModal'),
    document.getElementById('settingsModal')
  ].forEach(m => setModalOpen(m, false));
});

// 빈 곳 탭 → 일정 아이템 선택 해제
document.addEventListener('touchend', e => {
  if (touchReorder) return;
  if (!e.target.closest('.sched-item')) clearSelectedScheduleItems();
}, { passive: true });

// ──────────────────────────────────────────────
// 앱 초기화
// ──────────────────────────────────────────────
resetScheduleState();
renderApp();
initDrag();
updateDday();
