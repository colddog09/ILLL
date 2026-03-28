/* ============================================================
   drag.js — 드래그 & 터치 순서 변경
   ============================================================ */

'use strict';

// ──────────────────────────────────────────────
// 공통 드래그 헬퍼
// ──────────────────────────────────────────────
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
    endDrag();
    refreshPoolAndDay(key);
  });
}

// ──────────────────────────────────────────────
// 터치 드래그 순서 바꾸기 (모바일)
// ──────────────────────────────────────────────
let touchReorder = null;

function startTouchReorderAt(clientX, clientY, el, key, itemId) {
  if (!currentUser || touchReorder) return;

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

  clone.style.top  = (touch.clientY - offsetY) + 'px';
  clone.style.left = (touch.clientX - offsetX) + 'px';

  clone.style.visibility = 'hidden';
  const below = document.elementFromPoint(touch.clientX, touch.clientY);
  clone.style.visibility = '';

  document.querySelectorAll('.sched-item.reorder-over').forEach(el => el.classList.remove('reorder-over'));

  const targetItem = below?.closest('.sched-item');
  if (targetItem && targetItem !== touchReorder.el && targetItem.dataset.dateKey === touchReorder.key) {
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
      const [moved] = arr.splice(fromIdx, 1);
      const newToIdx = arr.findIndex(it => it.id === targetId);
      if (newToIdx !== -1) {
        arr.splice(insertBefore ? newToIdx : newToIdx + 1, 0, moved);
        state.schedule[key] = arr;
        saveState();
        renderDayTasks(key);
      } else {
        arr.splice(fromIdx, 0, moved);
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
    e.dataTransfer.setData('text/plain', dragInfo.taskId);
    e.dataTransfer.effectAllowed = 'move';
    setTimeout(() => card.classList.add('dragging'), 0);
    showGhost(dragInfo.text);
    hideDefaultImage(e);
    trashZone.hidden = false;
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
    trashZone.hidden = false;
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
    endDrag();
    refreshPoolAndDay(key);
  });

  // ── 휴지통 드롭존 ──
  trashZone.addEventListener('dragover', e => {
    if (!dragInfo) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    trashZone.classList.add('danger');
  });
  trashZone.addEventListener('dragleave', e => {
    if (!trashZone.contains(e.relatedTarget)) trashZone.classList.remove('danger');
  });
  trashZone.addEventListener('drop', e => {
    e.preventDefault();
    trashZone.classList.remove('danger');
    if (!dragInfo) return;

    if (dragInfo.type === 'pool') {
      removeTaskFromPool(dragInfo.taskId);
      saveState();
      endDrag();
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

// ──────────────────────────────────────────────
// 초기화 (모든 스크립트 로드 후 실행)
// ──────────────────────────────────────────────
resetScheduleState();
renderApp();
initDrag();
updateDday();
