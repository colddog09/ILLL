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
// 스타레일 — 은하열차 대각선 통과 애니메이션
// ──────────────────────────────────────────────
function triggerStarRailTrain() {
  if (document.documentElement.dataset.theme !== 'starrail') return;
  if (document.querySelector('.sr-train-overlay')) return; // 중복 방지

  const overlay = document.createElement('div');
  overlay.className = 'sr-train-overlay';
  overlay.innerHTML = `
    <div class="sr-train-img-wrap">
      <img class="sr-train-img" src="/starrail_train.png" alt="">
    </div>
    <canvas class="sr-stars-canvas"></canvas>
  `;
  document.body.appendChild(overlay);

  // 별 파티클 (꼬리 효과)
  const canvas = overlay.querySelector('.sr-stars-canvas');
  canvas.width  = window.innerWidth;
  canvas.height = window.innerHeight;
  const ctx = canvas.getContext('2d');
  const particles = [];
  let animFrame;

  function spawnParticle(x, y) {
    particles.push({
      x, y,
      vx: (Math.random() - 0.8) * 6,
      vy: (Math.random() + 0.3) * 4,
      life: 1,
      size: Math.random() * 3 + 1,
      color: ['#c8a8ff','#e8d0ff','#a0c8ff','#ffffff'][Math.floor(Math.random()*4)]
    });
  }

  let trainX = -600, trainY = window.innerHeight + 100;
  const targetX = window.innerWidth + 400;
  const targetY = -200;
  const duration = 2200; // ms
  const startTime = performance.now();

  function animate(now) {
    const t = Math.min((now - startTime) / duration, 1);
    const ease = t < 0.5 ? 2*t*t : -1+(4-2*t)*t;
    trainX = -600 + (targetX + 600) * ease;
    trainY = (window.innerHeight + 100) + (targetY - window.innerHeight - 100) * ease;

    // 꼬리 파티클 생성
    if (t < 0.95) {
      for (let i = 0; i < 3; i++) {
        spawnParticle(trainX + 200 + Math.random()*80, trainY + 120 + Math.random()*40);
      }
    }

    // 캔버스 클리어
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    // 파티클 업데이트
    for (let i = particles.length - 1; i >= 0; i--) {
      const p = particles[i];
      p.x += p.vx; p.y += p.vy; p.life -= 0.035;
      if (p.life <= 0) { particles.splice(i, 1); continue; }
      ctx.globalAlpha = p.life * 0.8;
      ctx.fillStyle = p.color;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.size * p.life, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;

    // 열차 위치 반영
    const wrap = overlay.querySelector('.sr-train-img-wrap');
    if (wrap) wrap.style.transform = `translate(${trainX}px, ${trainY}px)`;

    if (t < 1 || particles.length > 0) {
      animFrame = requestAnimationFrame(animate);
    } else {
      overlay.remove();
    }
  }

  animFrame = requestAnimationFrame(animate);

  // 최대 3초 후 강제 제거
  setTimeout(() => {
    cancelAnimationFrame(animFrame);
    overlay.remove();
  }, 3500);
}

// ──────────────────────────────────────────────
// dayGrid 이벤트 위임 — 완료 토글, 미루기
// ──────────────────────────────────────────────
dayGrid.addEventListener('click', e => {
  const gcalBtn = e.target.closest('.btn-gcal-done');
  if (gcalBtn) { toggleGcalStatus(gcalBtn.dataset.gcalId, gcalBtn.dataset.date); return; }

  const btnO = e.target.closest('.btn-o');
  if (btnO) {
    // 완료 → X 방향 전환(완료 처리)일 때만 열차 등장
    const schedItem = btnO.closest('.sched-item');
    const isCompleting = schedItem && !schedItem.classList.contains('sched-item--done');
    toggleStatus(btnO.dataset.date, btnO.dataset.id);
    if (isCompleting) triggerStarRailTrain();
    return;
  }

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
    // gcalConnect()가 리다이렉트하면 이 아래는 실행 안 됨
    // 서버 refresh로 즉시 성공한 경우에만 실행됨
    gcalReconnectBtn.hidden      = true;
    gcalReconnectBtn.disabled    = false;
    gcalReconnectBtn.textContent = '🗓️ 재연결';
    updateGcalUI();
    gcalImportCurrentDate();
    gcalStartPolling();
  } catch (err) {
    gcalReconnectBtn.disabled    = false;
    gcalReconnectBtn.textContent = '🗓️ 재연결';
    showGcalResult('❌ 재연결 실패: ' + (err.message || '다시 시도해주세요.'), true);
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

// 달력 뷰 모달 (데스크톱)
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

// ──────────────────────────────────────────────
// 모바일 캘린더 바텀시트
// ──────────────────────────────────────────────
const gcalSheetBtn      = document.getElementById('gcalSheetBtn');
const gcalSheet         = document.getElementById('gcalSheet');
const gcalSheetOverlay  = document.getElementById('gcalSheetOverlay');
const gcalSheetCloseBtn = document.getElementById('gcalSheetCloseBtn');

function openGcalSheet() {
  if (!gcalSheet || !gcalSheetOverlay) return;
  renderGcalSheet();
  gcalSheet.hidden = false;
  gcalSheetOverlay.hidden = false;
  requestAnimationFrame(() => {
    gcalSheet.classList.add('open');
    gcalSheetOverlay.classList.add('open');
  });
}

function closeGcalSheet() {
  if (!gcalSheet || !gcalSheetOverlay) return;
  gcalSheet.classList.remove('open');
  gcalSheetOverlay.classList.remove('open');
  setTimeout(() => {
    gcalSheet.hidden = true;
    gcalSheetOverlay.hidden = true;
  }, 300);
}

gcalSheetBtn?.addEventListener('click', openGcalSheet);
gcalSheetCloseBtn?.addEventListener('click', closeGcalSheet);
gcalSheetOverlay?.addEventListener('click', closeGcalSheet);

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

// ──────────────────────────────────────────────
// Google Calendar OAuth 콜백 처리
// /api/gcal-callback 이후 /?gcal=connected 로 돌아옴
// ──────────────────────────────────────────────
(function handleGcalOAuthReturn() {
  const params   = new URLSearchParams(window.location.search);
  const gcalParam = params.get('gcal');
  if (!gcalParam) return;

  // URL 파라미터 즉시 제거 (새로고침해도 중복 실행 방지)
  const clean = new URL(window.location.href);
  clean.searchParams.delete('gcal');
  clean.searchParams.delete('fresh');
  clean.searchParams.delete('reason');
  window.history.replaceState({}, '', clean.toString());

  if (gcalParam === 'connected') {
    localStorage.setItem('gcal_connected', '1');
    // auth + gcal.js 로드 완료 후 토큰 발급 시도
    const tryInit = (attempts = 0) => {
      if (!currentUser || typeof gcalRefreshFromServer !== 'function') {
        if (attempts < 30) setTimeout(() => tryInit(attempts + 1), 300);
        return;
      }
      gcalRefreshFromServer()
        .then(() => {
          updateGcalUI?.();
          gcalImportCurrentDate?.();
          gcalStartPolling?.();
          setTimeout(() => showGcalResult?.('✅ 구글 캘린더가 연결되었습니다.'), 500);
        })
        .catch(() => {
          // 토큰 발급 실패해도 gcal_connected 플래그는 유지 (재시도 가능)
          setTimeout(() => showGcalResult?.('⚠️ 캘린더 권한 저장됨. 잠시 후 자동 연결됩니다.'), 500);
        });
    };
    tryInit();

  } else if (gcalParam === 'error') {
    const reason = params.get('reason') || 'unknown';
    const msgMap = {
      access_denied:       '권한이 거부되었습니다.',
      auth_expired:        '로그인 세션이 만료되었습니다. 다시 시도해주세요.',
      no_refresh_token:    '권한 재동의가 필요합니다. 다시 시도해주세요.',
      db_error:            '서버 오류가 발생했습니다.',
      invalid_auth:        '인증 정보가 올바르지 않습니다.',
    };
    const msg = msgMap[reason] || `연결 실패 (${reason})`;
    setTimeout(() => showGcalResult?.('❌ 캘린더 ' + msg, true), 800);
  }
})();

// ── 캘린더 사이드 패널 리사이즈 ──
(function initGcalResize() {
  const STORAGE_KEY = 'gcalPanelWidth';
  const MIN_WIDTH = 160;
  const MAX_WIDTH = 420;

  const panel  = document.getElementById('gcalSidePanel');
  const handle = document.getElementById('gcalResizeHandle');
  if (!panel || !handle) return;

  // 저장된 너비 복원
  const saved = parseInt(localStorage.getItem(STORAGE_KEY));
  if (saved && saved >= MIN_WIDTH && saved <= MAX_WIDTH) {
    panel.style.width = saved + 'px';
  }

  // 핸들은 render.js에서 패널과 함께 직접 표시

  let dragging = false;
  let startX = 0;
  let startWidth = 0;

  handle.addEventListener('mousedown', e => {
    dragging = true;
    startX = e.clientX;
    startWidth = panel.offsetWidth;
    handle.classList.add('dragging');
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
    e.preventDefault();
  });

  document.addEventListener('mousemove', e => {
    if (!dragging) return;
    const dx = e.clientX - startX;
    const newWidth = Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, startWidth + dx));
    panel.style.width = newWidth + 'px';
  });

  document.addEventListener('mouseup', () => {
    if (!dragging) return;
    dragging = false;
    handle.classList.remove('dragging');
    document.body.style.cursor = '';
    document.body.style.userSelect = '';
    localStorage.setItem(STORAGE_KEY, parseInt(panel.style.width));
  });
})();
