/* ============================================================
   render.js — 풀/일정 렌더링 함수
   ============================================================ */

'use strict';

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

  const textSpan = document.createElement('span');
  textSpan.textContent = task.text;
  card.appendChild(textSpan);

  if (task.deadline) {
    const urgent = isDeadlineUrgent(task.deadline);
    const clock = document.createElement('button');
    clock.className = 'pool-card__clock' + (urgent ? ' pool-card__clock--urgent' : '');
    clock.textContent = '⏰';
    clock.title = formatDeadlineText(task.deadline);

    // 툴팁 토글
    const tooltip = document.createElement('span');
    tooltip.className = 'pool-card__clock-tooltip';
    tooltip.textContent = formatDeadlineText(task.deadline);

    clock.addEventListener('click', e => {
      e.stopPropagation();
      e.preventDefault();
      tooltip.classList.toggle('visible');
    });
    card.appendChild(clock);
    card.appendChild(tooltip);
  }

  return card;
}

function getPoolCardText(card) {
  if (!card) return '';
  const span = card.querySelector('span:first-child');
  return span ? span.textContent.trim() : card.firstChild?.textContent?.trim() || '';
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

function deleteSchedItemCompletely(key, itemId) {
  removeScheduleItem(key, itemId);
  saveState();
  renderDayTasks(key);
  updateProgress(key);
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

    // ── 핸들 터치 → 즉시 드래그 시작 ──
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
      let tapX = 0, tapY = 0, tapTime = 0, lastTapTime = 0, tapCount = 0, tapCountTimer = null;

      el.addEventListener('touchstart', e => {
        if (e.target.closest('.sched-item__ox'))     return;
        if (e.target.closest('.sched-item__handle')) return;
        const t = e.touches[0];
        tapX = t.clientX;
        tapY = t.clientY;
        tapTime = Date.now();
        if (el.classList.contains('selected')) e.preventDefault();
      }, { passive: false });

      el.addEventListener('touchmove', e => {
        if (e.target.closest('.sched-item__ox'))    return;
        if (!el.classList.contains('selected'))     return;
        if (touchReorder)                           return;
        const t = e.touches[0];
        const dx = Math.abs(t.clientX - tapX);
        const dy = Math.abs(t.clientY - tapY);
        if (dx > 5 || dy > 5) {
          startTouchReorderAt(tapX, tapY, el, key, item.id);
        }
      }, { passive: true });

      el.addEventListener('touchend', e => {
        if (touchReorder) return;
        if (e.target.closest('.sched-item__ox')) return;
        const t = e.changedTouches[0];
        const dx = Math.abs(t.clientX - tapX);
        const dy = Math.abs(t.clientY - tapY);
        const dt = Date.now() - tapTime;
        if (dx < 10 && dy < 10 && dt < 400) {
          const now = Date.now();
          if (now - lastTapTime < 400) {
            tapCount++;
            lastTapTime = now;
            clearTimeout(tapCountTimer);
            if (tapCount >= 2) {
              e.preventDefault();
              const cnt = tapCount;
              tapCount = 0; lastTapTime = 0;
              if (cnt === 2) {
                returnSchedItemToPool(key, item.id, item.taskId, item.text);
              } else {
                deleteSchedItemCompletely(key, item.id);
              }
            } else {
              tapCountTimer = setTimeout(() => { tapCount = 0; }, 400);
            }
          } else {
            lastTapTime = now;
            tapCount = 1;
            clearTimeout(tapCountTimer);
            tapCountTimer = setTimeout(() => {
              if (tapCount === 1) {
                const wasSelected = el.classList.contains('selected');
                clearSelectedScheduleItems();
                if (!wasSelected) el.classList.add('selected');
              }
              tapCount = 0;
            }, 400);
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
