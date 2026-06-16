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

function scheduleGcalEventToDay(ev, gcalDateKey, targetKey) {
  if ((state.schedule[targetKey] || []).some(it => it.gcalEventId === ev.id)) return false;
  if (!state.schedule[targetKey]) state.schedule[targetKey] = [];
  state.schedule[targetKey].push({
    id: uid(),
    taskId: uid(),
    text: ev.summary,
    status: null,
    gcalEventId: ev.id,
    fromGcal: true,
    gcalDate: gcalDateKey,
    timeLabel: ev.timeLabel || null,
  });
  // 사이드 패널에서 제거
  if (gcalDateKey && gcalEvents[gcalDateKey]) {
    gcalEvents[gcalDateKey] = gcalEvents[gcalDateKey].filter(e => e.id !== ev.id);
  }
  saveState();
  renderDayTasks(targetKey);
  renderGcalSidePanel();
  return true;
}

function schedulePoolTask(key, taskId, text) {
  if ((state.schedule[key] || []).some(it => it.taskId === taskId)) return false;
  const poolTask = state.pool.find(t => t.id === taskId);
  state.pool = state.pool.filter(t => t.id !== taskId);
  if (!state.schedule[key]) state.schedule[key] = [];
  const item = { id: uid(), taskId, text, status: null };
  if (poolTask?.deadline)    item.deadline    = poolTask.deadline;
  if (poolTask?.gcalEventId) item.gcalEventId = poolTask.gcalEventId;
  if (poolTask?.fromGcal)    item.fromGcal    = true;
  state.schedule[key].push(item);
  return true;
}

function restoreTaskToPool(taskId, text, deadline, gcalEventId, fromGcal) {
  if (fromGcal) return; // gcal 항목은 사이드 패널(gcalEvents)에 이미 있음
  if (!state.pool.find(t => t.id === taskId)) {
    const task = { id: taskId, text };
    if (deadline) task.deadline = deadline;
    state.pool.push(task);
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
  card.className = 'pool-card' + (task.fromGcal ? ' pool-card--gcal' : '');
  card.dataset.taskId = task.id;
  card.dataset.text = task.text;
  card.draggable = !!currentUser;

  if (task.fromGcal) {
    const icon = document.createElement('span');
    icon.className = 'pool-card__gcal-icon';
    icon.textContent = '📅';
    card.appendChild(icon);
  }

  const textSpan = document.createElement('span');
  textSpan.textContent = task.text;
  card.appendChild(textSpan);

  if (task.deadline) {
    const urgent = isDeadlineUrgent(task.deadline);
    const past   = isDeadlinePast(task.deadline);
    const clock = document.createElement('button');
    clock.className = 'pool-card__clock'
      + (past ? ' pool-card__clock--past' : (urgent ? ' pool-card__clock--urgent' : ''));
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
  return card.dataset.text || card.querySelector('span')?.textContent?.trim() || '';
}

function handlePoolCardActivate(card) {
  if (!currentUser || !card) return;
  addPoolItemToCurrentDay(card.dataset.taskId, getPoolCardText(card));
}

function returnSchedItemToPool(key, itemId, taskId, text) {
  const item = (state.schedule[key] || []).find(it => it.id === itemId);
  removeScheduleItem(key, itemId);

  if (item?.fromGcal) {
    // 날짜 지난 gcal 항목은 그냥 제거, 오늘 이후만 사이드 패널로 복원
    const gcalDate = item.gcalDate || key;
    if (gcalDate >= todayKey()) {
      if (!gcalEvents[gcalDate]) gcalEvents[gcalDate] = [];
      if (!gcalEvents[gcalDate].find(e => e.id === item.gcalEventId)) {
        gcalEvents[gcalDate].push({ id: item.gcalEventId, summary: item.text, timeLabel: item.timeLabel || null, done: false });
      }
    }
    saveState();
    renderDayTasks(key);
    renderGcalSidePanel();
    return;
  }

  restoreTaskToPool(taskId, text, item?.deadline, item?.gcalEventId, item?.fromGcal);
  saveState();
  refreshPoolAndDay(key);
}


const POOL_THRESHOLD = 5;
let poolExpanded = false;

// 정렬 설정 (localStorage에 영구 저장)
let _poolSort = localStorage.getItem('o1chu_pool_sort') || 'added'; // 'added' | 'alpha'

function renderPool() {
  poolEl.innerHTML = '';

  let tasks = (state.pool || []).filter(t => !t.fromGcal && t.text && t.text !== 'undefined');

  if (tasks.length === 0) {
    poolExpanded = false;
    renderEmptyPool();
    return;
  }

  if (_poolSort === 'alpha') {
    tasks = [...tasks].sort((a, b) => a.text.localeCompare(b.text, 'ko'));
  }

  const showAll     = poolExpanded || tasks.length <= POOL_THRESHOLD;
  const visible     = showAll ? tasks : tasks.slice(0, POOL_THRESHOLD);
  const hiddenCount = tasks.length - POOL_THRESHOLD;

  const fragment = document.createDocumentFragment();

  // 풀 헤더: "할일 N개" + 정렬 토글 (풀 맨 위 전체 너비)
  const sortRow = document.createElement('div');
  sortRow.className = 'pool-sort-row';

  const countLabel = document.createElement('span');
  countLabel.className = 'pool-sort-count';
  countLabel.textContent = `할일 ${tasks.length}개`;

  const sortBtn = document.createElement('button');
  sortBtn.className = 'pool-sort-btn';
  sortBtn.innerHTML = (_poolSort === 'alpha' ? 'ㄱㄴㄷ순' : '추가순') + ' <span class="pool-sort-ico">⇅</span>';
  sortBtn.title = '정렬 방식 변경';
  sortBtn.addEventListener('click', () => {
    _poolSort = _poolSort === 'added' ? 'alpha' : 'added';
    localStorage.setItem('o1chu_pool_sort', _poolSort);
    renderPool();
  });

  sortRow.appendChild(countLabel);
  sortRow.appendChild(sortBtn);
  fragment.appendChild(sortRow);

  visible.forEach(task => fragment.appendChild(createPoolCard(task)));

  if (!showAll && hiddenCount > 0) {
    const btn = document.createElement('button');
    btn.className = 'pool-expand-btn';
    btn.textContent = `+ ${hiddenCount}개 더 보기`;
    btn.addEventListener('click', () => { poolExpanded = true; renderPool(); });
    fragment.appendChild(btn);
  } else if (poolExpanded && tasks.length > POOL_THRESHOLD) {
    const btn = document.createElement('button');
    btn.className = 'pool-expand-btn pool-expand-btn--collapse';
    btn.textContent = '접기';
    btn.addEventListener('click', () => { poolExpanded = false; renderPool(); });
    fragment.appendChild(btn);
  }

  poolEl.appendChild(fragment);
}

function renderGcalSidePanel() {
  const panel = document.getElementById('gcalSidePanel');
  if (!panel) return;

  const today = dateKey(new Date());

  // 이미 일정 보드에 배치된 gcalEventId 목록
  const scheduledGcalIds = new Set(
    Object.values(state.schedule || {}).flat().filter(it => it.gcalEventId).map(it => it.gcalEventId)
  );

  const allDates = Object.keys(gcalEvents || {})
    .filter(dk => dk >= today && (gcalEvents[dk] || []).some(ev => !scheduledGcalIds.has(ev.id)))
    .sort();

  panel.hidden = false;
  const resizeHandle = document.getElementById('gcalResizeHandle');
  if (resizeHandle) resizeHandle.hidden = false;

  // 패널 높이를 day-grid에 맞춤
  const grid = document.getElementById('dayGrid');
  function syncPanelHeight() {
    if (!grid || panel.hidden) return;
    const h = grid.getBoundingClientRect().height;
    if (h > 0) panel.style.maxHeight = h + 'px';
  }
  syncPanelHeight();
  // day-grid 높이 변화 감지
  if (panel._resizeObserver) panel._resizeObserver.disconnect();
  panel._resizeObserver = new ResizeObserver(syncPanelHeight);
  if (grid) panel._resizeObserver.observe(grid);
  panel.innerHTML = '';

  const header = document.createElement('div');
  header.className = 'gcal-side-header';

  const headerTitle = document.createElement('span');
  headerTitle.textContent = '📅 캘린더';
  header.appendChild(headerTitle);

  const toggleLabel = document.createElement('label');
  toggleLabel.className = 'gcal-done-toggle';
  const toggleCb = document.createElement('input');
  toggleCb.type = 'checkbox';
  const _gcalShowDone = localStorage.getItem('gcal_show_done') !== 'false';
  toggleCb.checked = _gcalShowDone;
  toggleCb.addEventListener('change', () => {
    localStorage.setItem('gcal_show_done', toggleCb.checked ? 'true' : 'false');
    renderGcalSidePanel();
  });
  toggleLabel.appendChild(toggleCb);
  toggleLabel.appendChild(document.createTextNode('완료 표시'));
  header.appendChild(toggleLabel);

  panel.appendChild(header);

  // 캘린더 미연결 상태
  if (typeof gcalTokenValid === 'function' && !gcalTokenValid()) {
    const notConn = document.createElement('div');
    notConn.className = 'gcal-side-empty gcal-side-empty--disconnected';
    notConn.textContent = '연결 안됨';
    panel.appendChild(notConn);
    return;
  }

  const list = document.createElement('div');
  list.className = 'gcal-side-list';
  panel.appendChild(list);

  if (allDates.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'gcal-side-empty';
    empty.textContent = '예정된 일정이 없어요';
    list.appendChild(empty);
    return;
  }

  const showDone = localStorage.getItem('gcal_show_done') !== 'false';
  let _renderedCount = 0;
  allDates.forEach(dk => {
    // 보이는 이벤트를 먼저 계산 → 비어 있으면 날짜 헤더도 건너뜀
    const visible = (gcalEvents[dk] || []).filter(ev => !scheduledGcalIds.has(ev.id) && (showDone || !ev.done));
    if (!visible.length) return;
    _renderedCount += visible.length;

    const [y, m, d] = dk.split('-').map(Number);
    const date = new Date(y, m - 1, d);
    const dow  = date.getDay();
    const dowKo = ['일', '월', '화', '수', '목', '금', '토'][dow];
    const dateLabel = `${m}/${d} (${dowKo})`;

    const dateEl = document.createElement('div');
    dateEl.className = 'gcal-side-date' + (dk === today ? ' gcal-side-date--today' : '');
    dateEl.textContent = dateLabel;
    list.appendChild(dateEl);

    visible.forEach(ev => {
      const el = document.createElement('div');
      el.className = 'gcal-side-event' + (ev.done ? ' done' : '');
      el.draggable = !!currentUser;
      el.dataset.gcalId = ev.id;
      el.dataset.gcalDate = dk;
      el.dataset.gcalText = ev.summary;
      const timeLabel = ev.timeLabel ? `<span class="gcal-side-event__time">${escHtml(ev.timeLabel)}</span>` : '';
      el.innerHTML = `
        ${timeLabel}
        <span class="gcal-side-event__text">${escHtml(ev.summary)}</span>
        <button class="btn-gcal-done btn-o${ev.done ? ' active' : ''}" data-gcal-id="${ev.id}" data-date="${dk}" title="완료"><img class="btn-o__img" src="${ev.done?'/image/pompomyes.webp':'/image/pompomno.webp'}" alt=""><span class="btn-o__text">O</span></button>`;

      // 데스크톱 더블클릭 → 현재 날짜에 추가
      if (currentUser) {
        let clickTimer = null;
        el.addEventListener('click', e => {
          if (e.target.closest('.btn-gcal-done')) return;
          if (clickTimer) {
            clearTimeout(clickTimer);
            clickTimer = null;
            e.preventDefault();
            const key = dateKey(currentDay());
            scheduleGcalEventToDay(ev, dk, key);
          } else {
            clickTimer = setTimeout(() => { clickTimer = null; }, 350);
          }
        });
      }

      // 데스크톱 드래그
      if (currentUser) {
        el.addEventListener('dragstart', e => {
          dragInfo = { type: 'gcal-side', gcalId: ev.id, text: ev.summary, dateKey: dk };
          e.dataTransfer.setData('text/plain', ev.id);
          e.dataTransfer.effectAllowed = 'move';
          setTimeout(() => el.classList.add('dragging'), 0);
          showGhost(ev.summary);
          hideDefaultImage(e);
        });
        el.addEventListener('dragend', () => {
          el.classList.remove('dragging');
          endDrag();
        });
      }

      // 모바일: 롱프레스 → 휴지통 드래그 삭제 / 더블탭 → 오늘 날짜에 추가
      if (currentUser) {
        let lastTap = 0;
        let longPressTimer = null;

        el.addEventListener('touchstart', e => {
          if (e.target.closest('.btn-gcal-done')) return;
          const t = e.touches[0];
          longPressTimer = setTimeout(() => {
            longPressTimer = null;
            lastTap = 0; // 더블탭 방지
            if (typeof startGcalSideTouchDrag === 'function') {
              startGcalSideTouchDrag(el, ev.id, ev.summary, dk, t);
            }
          }, 400);
        }, { passive: true });

        el.addEventListener('touchmove', () => {
          clearTimeout(longPressTimer);
          longPressTimer = null;
        }, { passive: true });

        el.addEventListener('touchend', e => {
          clearTimeout(longPressTimer);
          longPressTimer = null;
          if (e.target.closest('.btn-gcal-done')) return;
          const now = Date.now();
          if (now - lastTap < 400) {
            e.preventDefault();
            const key = dateKey(currentDay());
            scheduleGcalEventToDay(ev, dk, key);
          }
          lastTap = now;
        }, { passive: false });
      }

      list.appendChild(el);
    });
  });

  // 보이는 일정이 하나도 없으면 안내
  if (!_renderedCount) {
    const empty = document.createElement('div');
    empty.className = 'gcal-side-empty';
    empty.textContent = showDone ? '예정된 일정이 없어요' : '표시할 미완료 일정이 없어요';
    list.appendChild(empty);
  }

  // 사이드 패널 O 버튼 클릭 위임 (한 번만 등록)
  if (!panel._gcalBtnBound) {
    panel._gcalBtnBound = true;
    panel.addEventListener('click', e => {
      const btn = e.target.closest('.btn-gcal-done');
      if (!btn) return;
      e.stopPropagation();
      toggleGcalStatus(btn.dataset.gcalId, btn.dataset.date);
      if (typeof triggerStarRailTrain === 'function') triggerStarRailTrain();
    });
  }
}

// ──────────────────────────────────────────────
// 모바일 캘린더 바텀시트 렌더
// ──────────────────────────────────────────────
function renderGcalSheet() {
  const body = document.getElementById('gcalSheetBody');
  if (!body) return;

  const today = dateKey(new Date());
  const scheduledGcalIds = new Set(
    Object.values(state.schedule || {}).flat().filter(it => it.gcalEventId).map(it => it.gcalEventId)
  );
  const allDates = Object.keys(gcalEvents || {})
    .filter(dk => dk >= today && (gcalEvents[dk] || []).some(ev => !scheduledGcalIds.has(ev.id)))
    .sort();

  body.innerHTML = '';

  if (typeof gcalTokenValid === 'function' && !gcalTokenValid()) {
    body.innerHTML = '<div class="gcal-sheet__empty">캘린더가 연결되지 않았습니다.<br>설정에서 연결해주세요.</div>';
    return;
  }
  if (allDates.length === 0) {
    body.innerHTML = '<div class="gcal-sheet__empty">추가할 예정 일정이 없어요 ✅</div>';
    return;
  }

  allDates.forEach(dk => {
    const [y, m, d] = dk.split('-').map(Number);
    const dow    = new Date(y, m - 1, d).getDay();
    const dowKo  = ['일','월','화','수','목','금','토'][dow];
    const dateEl = document.createElement('div');
    dateEl.className = 'gcal-sheet__date' + (dk === today ? ' gcal-sheet__date--today' : '');
    dateEl.textContent = `${m}/${d} (${dowKo})`;
    body.appendChild(dateEl);

    (gcalEvents[dk] || []).filter(ev => !scheduledGcalIds.has(ev.id)).forEach(ev => {
      const row = document.createElement('div');
      row.className = 'gcal-sheet__event' + (ev.done ? ' done' : '');
      row.innerHTML = `
        ${ev.done ? '<span style="font-size:0.75rem;color:var(--text-sub);flex-shrink:0">✅</span>' : ''}
        ${ev.timeLabel ? `<span class="gcal-sheet__event__time">${escHtml(ev.timeLabel)}</span>` : ''}
        <span class="gcal-sheet__event__text">${escHtml(ev.summary)}</span>
        <button class="gcal-sheet__event__add" data-gcal-id="${ev.id}" data-gcal-date="${dk}" data-gcal-text="${escHtml(ev.summary)}">+ 오늘</button>
      `;
      body.appendChild(row);
    });
  });

  // + 오늘 버튼 이벤트
  body.querySelectorAll('.gcal-sheet__event__add').forEach(btn => {
    btn.addEventListener('click', () => {
      if (!currentUser) return;
      const gcalId   = btn.dataset.gcalId;
      const gcalDate = btn.dataset.gcalDate;
      const text     = btn.dataset.gcalText;
      const ev       = (gcalEvents[gcalDate] || []).find(e => e.id === gcalId);
      if (!ev) return;
      const targetKey = dateKey(currentDay());
      scheduleGcalEventToDay(ev, gcalDate, targetKey);
      // 버튼 비활성화 (추가됨 표시)
      btn.textContent = '✓';
      btn.disabled = true;
      btn.style.opacity = '0.5';
    });
  });
}

// ──────────────────────────────────────────────
// 날짜 카드 렌더링
// ──────────────────────────────────────────────
function renderWeek() {
  // 스크롤 위치 보존 (일정 추가/수정 후 초기화 방지)
  const schedArea = document.querySelector('.schedule-area');
  const savedScroll = schedArea ? schedArea.scrollTop : 0;

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
    <div class="day-card__tasks" id="tasks_${key}"></div>
    <div class="day-card__progress">
      <div class="day-card__progress-bar" style="width:${pct}%"></div>
    </div>`;

  dayGrid.appendChild(card);
  renderDayTasks(key);
  setupDayDropZone(card, key);

  // 스크롤 위치 복원 (DOM 페인트 후)
  if (savedScroll > 0 && schedArea) {
    requestAnimationFrame(() => { schedArea.scrollTop = savedScroll; });
  }
}

function renderDayTasks(key) {
  const container = document.getElementById(`tasks_${key}`);
  if (!container) return;
  container.innerHTML = '';
  const items = (state.schedule[key] || []).filter(it => it.text && it.text !== 'undefined');

  if (items.length === 0) {
    const isMobile = window.matchMedia('(max-width:600px)').matches;
    container.innerHTML = `<div class="drop-hint">${isMobile ? '📌 할일을 두 번 탭해서 추가' : '📌 여기에 할일을 드래그해서 추가'}</div>`;
    if (document.documentElement.getAttribute('data-theme') === 'starrail') {
      const daily = document.createElement('div');
      daily.className = 'sched-item starrail-daily';
      daily.innerHTML = `
        <span class="starrail-daily__icon">✦</span>
        <span class="sched-item__text">붕괴: 스타레일 일쾌</span>
        <span class="starrail-daily__badge">DAILY</span>`;
      container.appendChild(daily);
    }
    updateProgress(key);
    return;
  }

  const fragment = document.createDocumentFragment();

  items.forEach(item => {
    const el = document.createElement('div');
    el.className = 'sched-item' + (item.status === 'O' ? ' done' : '') + (item.fromGcal ? ' sched-item--from-gcal' : '');
    el.dataset.itemId = item.id;
    el.dataset.dateKey = key;
    el.dataset.taskId = item.taskId;
    el.dataset.text = item.text;
    el.draggable = !!currentUser;
    const deadlineBadge = item.deadline
      ? `<span class="sched-item__deadline${isDeadlinePast(item.deadline) ? ' sched-item__deadline--past' : (isDeadlineUrgent(item.deadline) ? ' sched-item__deadline--urgent' : '')}" title="${escHtml(formatDeadlineText(item.deadline))}">⏰ ${escHtml(formatDeadlineText(item.deadline))}</span>`
      : '';
    const gcalBadge = item.fromGcal ? '<span class="sched-item__gcal-badge" title="구글 캘린더 일정">📅</span>' : '';
    el.innerHTML = `
      <span class="sched-item__handle" title="드래그로 순서 변경">⠿</span>
      ${gcalBadge}
      <span class="sched-item__text" title="${escHtml(item.text)}">${escHtml(item.text)}</span>
      ${deadlineBadge}
      <div class="sched-item__ox">
        <button class="btn-o${item.status==='O'?' active':''}" data-date="${key}" data-id="${item.id}" title="완료(O)"><img class="btn-o__img" src="${item.status==='O'?'/image/pompomyes.webp':'/image/pompomno.webp'}" alt=""><span class="btn-o__text">O</span></button>
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
              tapCount = 0; lastTapTime = 0;
              returnSchedItemToPool(key, item.id, item.taskId, item.text);
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

  // 스타레일 테마: 매일 일쾌 고정 아이템
  if (document.documentElement.getAttribute('data-theme') === 'starrail') {
    const daily = document.createElement('div');
    daily.className = 'sched-item starrail-daily';
    daily.innerHTML = `
      <span class="starrail-daily__icon">✦</span>
      <span class="sched-item__text">붕괴: 스타레일 일쾌</span>
      <span class="starrail-daily__badge">DAILY</span>`;
    container.appendChild(daily);
  }

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
// 뷰 모드 (day = 기본, list = 전체 리스트)
// ──────────────────────────────────────────────
let scheduleViewMode = localStorage.getItem('scheduleViewMode') || 'day';

function setViewMode(mode) {
  scheduleViewMode = mode;
  localStorage.setItem('scheduleViewMode', mode);
  const btn = document.getElementById('viewModeBtn');
  const prevBtn = document.getElementById('prevWeekBtn');
  const nextBtn = document.getElementById('nextWeekBtn');
  const weekLabelEl = document.getElementById('weekLabel');

  if (mode === 'list') {
    if (btn) btn.textContent = '📅';
    if (btn) btn.title = '날짜 뷰로 전환';
    if (prevBtn) prevBtn.hidden = true;
    if (nextBtn) nextBtn.hidden = true;
    if (weekLabelEl) weekLabelEl.textContent = '전체 일정';
    renderListView();
  } else {
    if (btn) btn.textContent = '☰';
    if (btn) btn.title = '리스트 뷰로 전환';
    if (prevBtn) prevBtn.hidden = false;
    if (nextBtn) nextBtn.hidden = false;
    renderWeek();
  }
}

function renderListView() {
  dayGrid.innerHTML = '';
  const today = todayKey();

  const dates = Object.keys(state.schedule)
    .filter(k => (state.schedule[k] || []).some(it => it.text && it.text !== 'undefined'))
    .sort();

  if (dates.length === 0) {
    dayGrid.innerHTML = '<div class="list-view-empty">📭 배치된 일정이 없어요</div>';
    return;
  }

  const DAYS_KO = ['일', '월', '화', '수', '목', '금', '토'];
  const fragment = document.createDocumentFragment();

  dates.forEach(k => {
    const items = (state.schedule[k] || []).filter(it => it.text && it.text !== 'undefined');
    if (!items.length) return;

    const isPast = k < today;
    const isToday = k === today;

    const [y, m, d] = k.split('-').map(Number);
    const dateObj = new Date(y, m - 1, d);
    const dow = dateObj.getDay();
    const dowLabel = DAYS_KO[dow];
    const dowClass = dow === 0 ? ' list-view__date-dow--sun' : dow === 6 ? ' list-view__date-dow--sat' : '';

    const doneCount = items.filter(it => it.status === 'O').length;
    const pct = items.length ? Math.round(doneCount / items.length * 100) : 0;

    // 날짜 그룹 카드
    const group = document.createElement('div');
    group.className = 'list-view__group'
      + (isToday ? ' list-view__group--today' : '')
      + (isPast ? ' list-view__group--past' : '');

    // 날짜 헤더
    const header = document.createElement('div');
    header.className = 'list-view__date-header';
    header.innerHTML = `
      <span class="list-view__date-num">${m}/${d}</span>
      <span class="list-view__date-dow${dowClass}">${dowLabel}</span>
      ${isToday ? '<span class="today-badge">오늘</span>' : ''}
      <span class="list-view__progress">${doneCount}/${items.length}</span>
    `;
    group.appendChild(header);

    // 진행 바
    const bar = document.createElement('div');
    bar.className = 'list-view__progress-track';
    bar.innerHTML = `<div class="list-view__progress-bar" style="width:${pct}%"></div>`;
    group.appendChild(bar);

    // 일정 목록
    const list = document.createElement('div');
    list.className = 'list-view__items';

    items.forEach(item => {
      const row = document.createElement('div');
      row.className = 'list-view__item'
        + (item.status === 'O' ? ' done' : '')
        + (isPast && item.status !== 'O' ? ' list-view__item--overdue' : '');
      row.dataset.itemId = item.id;
      row.dataset.dateKey = k;

      row.innerHTML = `
        <button class="list-view__check" data-item-id="${item.id}" data-date-key="${k}" title="완료 토글">
          ${item.status === 'O' ? '✅' : '⬜'}
        </button>
        <span class="list-view__item-text">${escHtml(item.text)}</span>
        ${item.deadline ? `<span class="list-view__deadline${isDeadlinePast(item.deadline) ? ' list-view__deadline--past' : (isDeadlineUrgent(item.deadline) ? ' list-view__deadline--urgent' : '')}">⏰ ${escHtml(formatDeadlineText(item.deadline))}</span>` : ''}
      `;
      list.appendChild(row);
    });

    group.appendChild(list);
    fragment.appendChild(group);
  });

  dayGrid.appendChild(fragment);

  // 완료 토글 이벤트
  dayGrid.querySelectorAll('.list-view__check').forEach(btn => {
    btn.addEventListener('click', () => {
      const itemId = btn.dataset.itemId;
      const dateKey = btn.dataset.dateKey;
      const item = (state.schedule[dateKey] || []).find(it => it.id === itemId);
      if (!item) return;
      item.status = item.status === 'O' ? null : 'O';
      saveState();
      renderListView();
    });
  });
}

function renderApp() {
  if (scheduleViewMode === 'list') {
    renderListView();
  } else {
    renderWeek();
  }
  renderPool();
  if (typeof renderGcalSidePanel === 'function') renderGcalSidePanel();
  if (typeof renderLinks === 'function') renderLinks();
}
