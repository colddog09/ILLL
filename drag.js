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

// ── 날짜 카드를 드롭존으로 ── (pool → day, day → day)
function setupDayDropZone(card, key) {
  card.addEventListener('dragover', e => {
    if (!dragInfo) return;
    if (dragInfo.type === 'pool' || dragInfo.type === 'gcal-side' || (dragInfo.type === 'day' && dragInfo.dateKey !== key)) {
      e.preventDefault();
      card.classList.add('drag-over');
    }
  });
  card.addEventListener('dragleave', e => {
    if (!card.contains(e.relatedTarget)) card.classList.remove('drag-over');
  });
  card.addEventListener('drop', e => {
    card.classList.remove('drag-over');
    if (!dragInfo) return;
    e.preventDefault();

    if (dragInfo.type === 'pool') {
      const { taskId, text } = dragInfo;
      if (!schedulePoolTask(key, taskId, text)) return;
      saveState();
      endDrag();
      refreshPoolAndDay(key);
    } else if (dragInfo.type === 'gcal-side') {
      const ev = { id: dragInfo.gcalId, summary: dragInfo.text };
      scheduleGcalEventToDay(ev, dragInfo.dateKey, key);
      endDrag();
    } else if (dragInfo.type === 'day' && dragInfo.dateKey !== key) {
      moveSchedItemToDay(dragInfo.dateKey, dragInfo.itemId, key);
      endDrag();
    }
  });
}

// 스케줄 아이템을 다른 날짜로 이동
function moveSchedItemToDay(fromKey, itemId, toKey) {
  const fromArr = state.schedule[fromKey] || [];
  const idx = fromArr.findIndex(it => it.id === itemId);
  if (idx === -1) return;
  const [moved] = fromArr.splice(idx, 1);
  state.schedule[fromKey] = fromArr;
  if (!state.schedule[toKey]) state.schedule[toKey] = [];
  state.schedule[toKey].push(moved);
  saveState();
  renderDayTasks(fromKey);
  renderDayTasks(toKey);
}

// 좌표에서 가장 가까운 날짜 카드의 key 반환
function findNearestDayKey(x, y) {
  let nearest = null;
  let minDist = Infinity;
  document.querySelectorAll('.day-card[data-date]').forEach(card => {
    const r = card.getBoundingClientRect();
    const cx = r.left + r.width / 2;
    const cy = r.top + r.height / 2;
    const dist = Math.hypot(x - cx, y - cy);
    if (dist < minDist) { minDist = dist; nearest = card.dataset.date; }
  });
  return nearest;
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
  const targetCard = below?.closest('.day-card[data-date]');

  if (targetItem && targetItem !== touchReorder.el) {
    const tRect = targetItem.getBoundingClientRect();
    touchReorder.insertBefore = touch.clientY < (tRect.top + tRect.height / 2);
    targetItem.classList.add('reorder-over');
    touchReorder.targetId  = targetItem.dataset.itemId;
    touchReorder.targetKey = targetItem.dataset.dateKey;
  } else if (targetCard) {
    touchReorder.targetId  = null;
    touchReorder.targetKey = targetCard.dataset.date;
  } else {
    touchReorder.targetId  = null;
    touchReorder.targetKey = null;
  }
  touchReorder.lastX = touch.clientX;
  touchReorder.lastY = touch.clientY;
}

function onTouchReorderEnd() {
  if (!touchReorder) return;
  document.removeEventListener('touchmove',   onTouchReorderMove);
  document.removeEventListener('touchend',    onTouchReorderEnd);
  document.removeEventListener('touchcancel', onTouchReorderEnd);

  const { el, key, itemId, clone, targetId, targetKey, insertBefore, lastX, lastY } = touchReorder;
  clone.remove();
  el.style.opacity = '';
  document.querySelectorAll('.sched-item.reorder-over').forEach(el => el.classList.remove('reorder-over'));
  touchReorder = null;

  const resolvedKey = targetKey || findNearestDayKey(lastX ?? 0, lastY ?? 0);

  if (resolvedKey && resolvedKey !== key) {
    // 다른 날짜로 이동 (cross-day 또는 snap-to-nearest)
    moveSchedItemToDay(key, itemId, resolvedKey);
  } else if (targetId && targetId !== itemId) {
    // 같은 날짜 내 순서 변경
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
}

// ──────────────────────────────────────────────
// 드래그 시스템 초기화
// ──────────────────────────────────────────────
function initDrag() {

  // ── 풀 카드 dragstart (from pool) ──
  poolEl.addEventListener('dragstart', e => {
    const card = e.target.closest('.pool-card');
    if (!card) return;
    // 드래그 시작 시 열려 있는 기한 툴팁 닫기
    card.querySelectorAll('.pool-card__clock-tooltip.visible').forEach(t => t.classList.remove('visible'));
    const poolTask = (state.pool || []).find(t => t.id === card.dataset.taskId);
    dragInfo = { type: 'pool', taskId: card.dataset.taskId, text: getPoolCardText(card), fromGcal: !!poolTask?.fromGcal };
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

  // 모바일 터치 드래그 시작 시에도 툴팁 닫기
  poolEl.addEventListener('touchstart', e => {
    const card = e.target.closest('.pool-card');
    if (!card) return;
    card.querySelectorAll('.pool-card__clock-tooltip.visible').forEach(t => t.classList.remove('visible'));
  }, { passive: true });

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
    // drop이 유효한 드롭존에서 처리되지 않은 경우 → 가장 가까운 날짜로 스냅
    if (dragInfo?.type === 'day') {
      const nearestKey = findNearestDayKey(e.clientX, e.clientY);
      if (nearestKey && nearestKey !== dragInfo.dateKey) {
        moveSchedItemToDay(dragInfo.dateKey, dragInfo.itemId, nearestKey);
      }
    }
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
    const item = (state.schedule[key] || []).find(it => it.id === itemId);
    removeScheduleItem(key, itemId);
    restoreTaskToPool(taskId, text, item?.deadline, item?.gcalEventId, item?.fromGcal, item?.link);
    saveState();
    endDrag();
    refreshPoolAndDay(key);
  });

  // ── 휴지통 드롭존 ──
  const trashLabel = trashZone.querySelector('.trash-zone__label');

  trashZone.addEventListener('dragover', e => {
    if (!dragInfo) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    trashZone.classList.add('danger');
    const isGcalItem = dragInfo.fromGcal || dragInfo.type === 'gcal-side';
    if (trashLabel) trashLabel.textContent = isGcalItem ? '캘린더에서도 삭제됨' : '여기에 놓으면 삭제';
  });
  trashZone.addEventListener('dragleave', e => {
    if (!trashZone.contains(e.relatedTarget)) {
      trashZone.classList.remove('danger', 'gcal-warn');
      if (trashLabel) trashLabel.textContent = '여기에 놓으면 삭제';
    }
  });
  trashZone.addEventListener('drop', e => {
    e.preventDefault();
    trashZone.classList.remove('danger', 'gcal-warn');
    if (trashLabel) trashLabel.textContent = '여기에 놓으면 삭제';
    if (!dragInfo) return;

    if (dragInfo.type === 'gcal-side') {
      // 캘린더 사이드패널 항목 → 구글 캘린더에서 삭제
      if (typeof gcalDeleteEvent === 'function') {
        gcalDeleteEvent(dragInfo.gcalId).then(() => {
          if (typeof gcalImportCurrentDate === 'function') gcalImportCurrentDate();
        }).catch(() => {});
      }
      endDrag();
      return;
    } else if (dragInfo.type === 'pool') {
      const idx = state.pool.findIndex(t => t.id === dragInfo.taskId);
      const removed = idx !== -1 ? state.pool[idx] : null;
      // 캘린더 항목이면 구글 캘린더에서도 삭제
      if (dragInfo.fromGcal && removed?.gcalEventId) {
        if (typeof gcalDeleteEvent === 'function') {
          gcalDeleteEvent(removed.gcalEventId).catch(() => {});
        }
      }
      removeTaskFromPool(dragInfo.taskId);
      saveState();
      endDrag();
      renderPool();
      if (removed) _showUndoToast(`'${removed.text}' 삭제됨`, () => {
        const at = Math.min(idx, state.pool.length);
        if (!state.pool.find(t => t.id === removed.id)) state.pool.splice(at, 0, removed);
        saveState(); renderPool();
      });
    } else if (dragInfo.type === 'day') {
      const key = dragInfo.dateKey;
      const arr = state.schedule[key] || [];
      const idx = arr.findIndex(it => it.id === dragInfo.itemId);
      const removed = idx !== -1 ? arr[idx] : null;
      // 캘린더 항목이면 구글 캘린더에서도 삭제
      if (removed?.gcalEventId && typeof gcalDeleteEvent === 'function') {
        gcalDeleteEvent(removed.gcalEventId).catch(() => {});
      }
      removeScheduleItem(key, dragInfo.itemId);
      saveState();
      endDrag();
      renderDayTasks(key);
      if (removed) _showUndoToast(`'${removed.text}' 삭제됨`, () => {
        if (!state.schedule[key]) state.schedule[key] = [];
        const at = Math.min(idx, state.schedule[key].length);
        if (!state.schedule[key].find(it => it.id === removed.id)) state.schedule[key].splice(at, 0, removed);
        saveState(); renderDayTasks(key);
      });
    }
  });
}

// 삭제 후 되돌리기 토스트
let _undoTimer = null;
function _showUndoToast(label, onUndo) {
  let toast = document.getElementById('undoToast');
  if (toast) toast.remove();
  toast = document.createElement('div');
  toast.id = 'undoToast';
  toast.style.cssText = [
    'position:fixed','bottom:24px','left:50%','transform:translateX(-50%)',
    'background:#1e1b4b','color:#fff','font-size:0.85rem','font-weight:600',
    'padding:10px 14px 10px 18px','border-radius:14px','z-index:99999',
    'display:flex','align-items:center','gap:12px','max-width:90vw',
    'box-shadow:0 8px 24px rgba(0,0,0,0.3)','opacity:0','transition:opacity 0.2s ease'
  ].join(';');
  const text = document.createElement('span');
  text.textContent = '🗑️ ' + label;
  text.style.cssText = 'overflow:hidden;text-overflow:ellipsis;white-space:nowrap;';
  const btn = document.createElement('button');
  btn.textContent = '되돌리기';
  btn.style.cssText = [
    'background:rgba(255,255,255,0.18)','color:#fff','border:none',
    'padding:6px 12px','border-radius:10px','font-weight:700','cursor:pointer',
    'font-family:inherit','flex-shrink:0','font-size:0.82rem'
  ].join(';');
  btn.addEventListener('click', () => {
    clearTimeout(_undoTimer);
    onUndo();
    toast.style.opacity = '0';
    setTimeout(() => toast.remove(), 220);
  });
  toast.appendChild(text);
  toast.appendChild(btn);
  document.body.appendChild(toast);
  requestAnimationFrame(() => { toast.style.opacity = '1'; });
  clearTimeout(_undoTimer);
  _undoTimer = setTimeout(() => {
    toast.style.opacity = '0';
    setTimeout(() => toast.remove(), 220);
  }, 5000);
}

// ── gcal-side 터치 드래그 → 휴지통 삭제 ──
let _gcalTouchDrag = null;

function startGcalSideTouchDrag(el, gcalId, text, dk, startTouch) {
  if (_gcalTouchDrag) return;
  const rect = el.getBoundingClientRect();

  const clone = el.cloneNode(true);
  clone.style.cssText = `position:fixed;width:${rect.width}px;top:${rect.top}px;left:${rect.left}px;margin:0;z-index:9999;opacity:0.92;pointer-events:none;border-radius:10px;`;
  document.body.appendChild(clone);

  el.style.opacity = '0.25';
  trashZone.hidden = false;
  const lbl = trashZone.querySelector('.trash-zone__label');
  if (lbl) lbl.textContent = '캘린더에서도 삭제됨';

  _gcalTouchDrag = { el, clone, gcalId, text, dk, overTrash: false };

  function onMove(e) {
    if (!_gcalTouchDrag) return;
    e.preventDefault();
    const t = e.touches[0];
    clone.style.top  = (t.clientY - rect.height / 2) + 'px';
    clone.style.left = (t.clientX - rect.width  / 2) + 'px';
    const tz = trashZone.getBoundingClientRect();
    _gcalTouchDrag.overTrash = t.clientX >= tz.left && t.clientX <= tz.right
                             && t.clientY >= tz.top  && t.clientY <= tz.bottom;
    trashZone.classList.toggle('danger', _gcalTouchDrag.overTrash);
  }

  function onEnd() {
    document.removeEventListener('touchmove',   onMove);
    document.removeEventListener('touchend',    onEnd);
    document.removeEventListener('touchcancel', onEnd);
    if (!_gcalTouchDrag) return;
    const { el, clone, gcalId, overTrash } = _gcalTouchDrag;
    _gcalTouchDrag = null;
    clone.remove();
    el.style.opacity = '';
    trashZone.classList.remove('danger');
    trashZone.hidden = true;

    if (overTrash && typeof gcalDeleteEvent === 'function') {
      gcalDeleteEvent(gcalId)
        .then(() => { if (typeof gcalImportCurrentDate === 'function') gcalImportCurrentDate(); })
        .catch(() => {});
    }
  }

  document.addEventListener('touchmove',   onMove,  { passive: false });
  document.addEventListener('touchend',    onEnd);
  document.addEventListener('touchcancel', onEnd);
}

// ──────────────────────────────────────────────
// 드래그 상태 복구 가드
//   일정이 "갈 곳을 잃고" 드롭이 중간에 실패하면 dragInfo / 고스트 /
//   터치 클론이 화면에 남아 앱이 멈춘 것처럼 보이는 문제 방지.
//   예외가 나도 UI 잔여물을 정리해 항상 정상 상태로 되돌린다.
// ──────────────────────────────────────────────
function recoverDragState() {
  try {
    dragInfo = null;
    if (typeof touchReorder !== 'undefined' && touchReorder) {
      try { touchReorder.clone?.remove(); touchReorder.el && (touchReorder.el.style.opacity = ''); } catch (_) {}
      touchReorder = null;
    }
    // 화면에 남은 드래그 클론/고스트/하이라이트 제거
    document.querySelectorAll('.touch-drag-clone').forEach(el => el.remove());
    document.querySelectorAll('.dragging, .reorder-over, .drag-over, .drag-over-pool')
      .forEach(el => el.classList.remove('dragging', 'reorder-over', 'drag-over', 'drag-over-pool'));
    if (typeof ghost !== 'undefined' && ghost) {
      ghost.classList.remove('visible');
      ghost.style.top = '-999px'; ghost.style.left = '-999px';
    }
    if (typeof trashZone !== 'undefined' && trashZone) {
      trashZone.hidden = true;
      trashZone.classList.remove('danger', 'gcal-warn');
    }
  } catch (_) { /* 복구 자체는 절대 throw 하지 않음 */ }
}

// 드래그가 어디서든 끝나면(드롭 성공/실패 무관) 잔여물 정리
document.addEventListener('dragend', () => { setTimeout(recoverDragState, 0); }, true);
document.addEventListener('drop',    () => { setTimeout(recoverDragState, 0); }, true);

// 예외/거부가 발생해도 드래그 상태를 정상으로 되돌림 (오류는 콘솔에 그대로 남김)
window.addEventListener('error', recoverDragState);
window.addEventListener('unhandledrejection', recoverDragState);

// ──────────────────────────────────────────────
// 풀 마키(영역) 다중 선택 — 데스크톱
//   할일 풀 빈 곳에서 마우스로 드래그하면 그 사각형에 닿는 카드들이
//   한꺼번에 선택되고, 선택된 항목을 한 번에 "날짜에 추가 / 삭제" 가능.
// ──────────────────────────────────────────────
function initPoolMarquee() {
  if (!poolEl) return;
  // 마우스(정밀 포인터) 환경에서만 — 모바일 터치는 기존 두 번 탭/드래그 사용
  const fine = window.matchMedia('(hover: hover) and (pointer: fine)').matches;
  if (!fine) return;

  let marquee = null, startX = 0, startY = 0, active = false;

  function selectedCards() {
    return [...poolEl.querySelectorAll('.pool-card.marquee-selected')];
  }
  function clearSelection() {
    poolEl.querySelectorAll('.pool-card.marquee-selected').forEach(c => c.classList.remove('marquee-selected'));
    document.getElementById('poolSelectBar')?.remove();
  }
  window.clearPoolSelection = clearSelection;

  function intersects(a, b) {
    return !(a.right < b.left || a.left > b.right || a.bottom < b.top || a.top > b.bottom);
  }

  function showBar() {
    const cards = selectedCards();
    document.getElementById('poolSelectBar')?.remove();
    if (!cards.length) return;
    const bar = document.createElement('div');
    bar.id = 'poolSelectBar';
    bar.className = 'pool-select-bar';
    const dayLabel = (typeof currentDay === 'function') ? formatBarDate(currentDay()) : '선택 날짜';
    bar.innerHTML = `
      <span class="pool-select-bar__count">${cards.length}개 선택</span>
      <button class="pool-select-bar__btn pool-select-bar__btn--primary" data-act="add">📅 ${dayLabel}에 추가</button>
      <button class="pool-select-bar__btn pool-select-bar__btn--danger" data-act="del">🗑️ 삭제</button>
      <button class="pool-select-bar__btn" data-act="clear">✕</button>`;
    document.body.appendChild(bar);
    bar.querySelector('[data-act="add"]').addEventListener('click', () => { addSelectedToDay(); });
    bar.querySelector('[data-act="del"]').addEventListener('click', () => { deleteSelected(); });
    bar.querySelector('[data-act="clear"]').addEventListener('click', () => { clearSelection(); });
  }

  function formatBarDate(d) {
    return `${d.getMonth() + 1}/${d.getDate()}`;
  }

  function addSelectedToDay() {
    const cards = selectedCards();
    if (!cards.length) return;
    const key = dateKey(currentDay());
    let added = 0;
    cards.forEach(card => {
      if (schedulePoolTask(key, card.dataset.taskId, getPoolCardText(card))) added++;
    });
    if (added) { saveState(); refreshPoolAndDay(key); }
    clearSelection();
  }

  function deleteSelected() {
    const cards = selectedCards();
    if (!cards.length) return;
    if (!confirm(`선택한 ${cards.length}개 할일을 삭제할까요?`)) return;
    cards.forEach(card => removeTaskFromPool(card.dataset.taskId));
    saveState();
    renderPool();
    clearSelection();
  }

  poolEl.addEventListener('mousedown', e => {
    if (e.button !== 0 || !currentUser) return;
    // 카드/버튼/링크 위에서 시작하면 마키 아님(기존 드래그·클릭 유지)
    if (e.target.closest('.pool-card, .pool-expand-btn, a, button')) return;
    active = true;
    startX = e.clientX; startY = e.clientY;
    clearSelection();
    marquee = document.createElement('div');
    marquee.className = 'pool-marquee';
    document.body.appendChild(marquee);
    e.preventDefault();
  });

  document.addEventListener('mousemove', e => {
    if (!active || !marquee) return;
    const x = Math.min(startX, e.clientX), y = Math.min(startY, e.clientY);
    const w = Math.abs(e.clientX - startX), h = Math.abs(e.clientY - startY);
    Object.assign(marquee.style, { left: x + 'px', top: y + 'px', width: w + 'px', height: h + 'px' });
    const box = { left: x, top: y, right: x + w, bottom: y + h };
    poolEl.querySelectorAll('.pool-card').forEach(card => {
      card.classList.toggle('marquee-selected', intersects(card.getBoundingClientRect(), box));
    });
  });

  document.addEventListener('mouseup', () => {
    if (!active) return;
    active = false;
    marquee?.remove(); marquee = null;
    showBar();
  });

  // 바깥(풀·선택바 밖) 클릭 시 선택 해제
  document.addEventListener('mousedown', e => {
    if (e.target.closest('#poolSelectBar') || e.target.closest('#taskPool')) return;
    clearSelection();
  });
}

// 초기화는 events.js 하단에서 실행 (모든 스크립트 로드 완료 후)
