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
// 스타레일 — 일정 칸 열차 출발 파티클 효과
// ──────────────────────────────────────────────
function triggerStarRailTrain() {
  // (레거시 호환용 빈 함수)
}

function spawnTrainDepartureEffects(el) {
  const rect = el.getBoundingClientRect();

  // ── 1. 점화 플래시 오버레이 ──
  const flash = document.createElement('div');
  const cx = rect.left + rect.width * 0.5;
  const cy = rect.top  + rect.height * 0.6;
  flash.style.cssText = [
    'position:fixed','inset:0','pointer-events:none','z-index:9998',
    `background:radial-gradient(ellipse 320px 80px at ${cx}px ${cy}px,` +
      'rgba(255,215,60,0.38),rgba(255,130,30,0.12) 55%,transparent 80%)',
    'animation:sr-engine-flash 0.38s ease-out forwards'
  ].join(';');
  document.body.appendChild(flash);
  setTimeout(() => flash.remove(), 420);

  // ── 2. 스파크 파티클 캔버스 ──
  const canvas = document.createElement('canvas');
  canvas.style.cssText = 'position:fixed;top:0;left:0;width:100vw;height:100vh;pointer-events:none;z-index:9999;';
  canvas.width  = window.innerWidth;
  canvas.height = window.innerHeight;
  document.body.appendChild(canvas);
  const ctx = canvas.getContext('2d');

  const GOLD  = ['#ffd040','#ffb820','#ffe880','#ff9800','#fff0a0'];
  const CYAN  = ['#3dc8e8','#20b8d8','#60d8f0','#a0eeff','#ffffff'];
  const particles = [];

  function mkParticle(x, y, isInit) {
    const isGold = Math.random() > 0.45;
    const speed  = isInit ? (3 + Math.random() * 6) : (1.5 + Math.random() * 4);
    // 초기 버스트: 왼쪽+위 방향, 이후: 뒤쪽으로 흘러감
    const baseAngle = isInit
      ? (Math.PI * 0.75 + (Math.random() - 0.5) * Math.PI * 0.9)
      : (Math.PI + (Math.random() - 0.5) * Math.PI * 0.5);
    return {
      x, y,
      vx: Math.cos(baseAngle) * speed,
      vy: Math.sin(baseAngle) * speed - (isInit ? 1.5 : 0.5),
      life: 1,
      decay: 0.022 + Math.random() * 0.028,
      size: isInit ? (2 + Math.random() * 3.5) : (1.2 + Math.random() * 2.5),
      color: (isGold ? GOLD : CYAN)[Math.floor(Math.random() * 5)]
    };
  }

  // 점화 순간 버스트
  const burstX = rect.left + 30;
  const burstY = rect.top  + rect.height * 0.62;
  for (let i = 0; i < 55; i++) particles.push(mkParticle(burstX + Math.random()*rect.width*0.25, burstY + (Math.random()-0.5)*rect.height*0.5, true));

  const spawnEnd = performance.now() + 480;

  function animate(now) {
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    // 열차가 지나가는 동안 꼬리 파티클 지속 생성
    if (now < spawnEnd) {
      const cr = el.getBoundingClientRect();
      const tailX = cr.left + 10;
      const tailY = cr.top  + cr.height * 0.62;
      for (let i = 0; i < 5; i++) {
        particles.push(mkParticle(
          tailX + Math.random() * 50,
          tailY + (Math.random() - 0.5) * cr.height * 0.55,
          false
        ));
      }
    }

    for (let i = particles.length - 1; i >= 0; i--) {
      const p = particles[i];
      p.x  += p.vx;
      p.y  += p.vy;
      p.vx *= 0.93;
      p.vy += 0.10; // 중력
      p.life -= p.decay;
      if (p.life <= 0) { particles.splice(i, 1); continue; }

      ctx.globalAlpha = Math.min(p.life * 1.1, 1);
      ctx.fillStyle   = p.color;
      // 빠른 입자는 선으로, 느린 입자는 원으로
      const speed = Math.sqrt(p.vx*p.vx + p.vy*p.vy);
      if (speed > 3) {
        ctx.save();
        ctx.strokeStyle = p.color;
        ctx.lineWidth   = p.size * p.life * 0.8;
        ctx.lineCap     = 'round';
        ctx.beginPath();
        ctx.moveTo(p.x, p.y);
        ctx.lineTo(p.x - p.vx * 2.5, p.y - p.vy * 2.5);
        ctx.stroke();
        ctx.restore();
      } else {
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.size * p.life * 0.9, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    ctx.globalAlpha = 1;

    if (particles.length > 0 || now < spawnEnd) {
      requestAnimationFrame(animate);
    } else {
      canvas.remove();
    }
  }

  requestAnimationFrame(animate);
}
function srTrainDepart_UNUSED() {
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

  const W = window.innerWidth;
  const H = window.innerHeight;

  // 이미지 실제 크기 계산 (CSS와 동일)
  const imgW = Math.min(W * 1.2, 1600);
  const imgH = imgW * (704 / 1526); // 원본 비율

  // 이동 방향: 열차 회전각 -28도와 정확히 일치
  const ANGLE_RAD = 28 * Math.PI / 180;
  const cosA = Math.cos(ANGLE_RAD);
  const sinA = Math.sin(ANGLE_RAD);
  const dist  = Math.sqrt(W * W + H * H) * 0.95;

  // 이미지 중심이 화면 중앙을 지나도록 wrap 좌표 보정
  const pathCX = W * 0.5 - imgW * 0.5;
  const pathCY = H * 0.5 - imgH * 0.4;

  const startX = pathCX - dist * cosA;
  const startY = pathCY + dist * sinA;
  const endX   = pathCX + dist * cosA;
  const endY   = pathCY - dist * sinA;

  // 속도감 있는 ease: 빠르게 치고 나가다 끝에 살짝 감속
  // easeInQuart — 처음엔 느렸다 순식간에 가속
  function easeInOutExpo(t) {
    if (t === 0) return 0;
    if (t === 1) return 1;
    return t < 0.5 ? Math.pow(2, 20*t - 10) / 2 : (2 - Math.pow(2, -20*t + 10)) / 2;
  }

  // 꼬리 파티클 — 빠른 속도감에 맞게 길고 얇게
  function spawnParticle(x, y, vBase) {
    const isGold = Math.random() > 0.4;
    particles.push({
      x, y,
      vx: vBase.vx * (0.3 + Math.random() * 0.4) + (Math.random() - 0.5) * 3,
      vy: vBase.vy * (0.3 + Math.random() * 0.4) + (Math.random() - 0.5) * 3,
      life: 1,
      size: Math.random() * 3 + 1,
      color: isGold
        ? ['#ffd060','#ffb020','#ffe090','#ff8c00'][Math.floor(Math.random()*4)]
        : ['#b080ff','#d0a0ff','#c8a0ff','#ffffff'][Math.floor(Math.random()*4)]
    });
  }

  const duration = 3200; // 자연스럽게 슝 — 3.2초
  const startTime = performance.now();
  let prevX = startX, prevY = startY;

  // 진입 전 짧은 딜레이 — 0.1초 후 등장 (더 갑작스럽게)
  let trainX = startX, trainY = startY;
  const wrap = overlay.querySelector('.sr-train-img-wrap');
  if (wrap) wrap.style.transform = `translate(${trainX}px, ${trainY}px)`;

  function animate(now) {
    const elapsed = now - startTime;
    const t = Math.min(elapsed / duration, 1);
    const ease = easeInOutExpo(t);

    trainX = startX + (endX - startX) * ease;
    trainY = startY + (endY - startY) * ease;

    // 프레임 속도 기반 꼬리 파티클
    const vx = trainX - prevX;
    const vy = trainY - prevY;
    if (t > 0.05 && t < 0.95) {
      const tailX = trainX + 80;
      const tailY = trainY + 200;
      const count = Math.min(8, Math.floor(Math.sqrt(vx*vx + vy*vy) * 0.4));
      for (let i = 0; i < count; i++) {
        spawnParticle(
          tailX + Math.random() * 80,
          tailY + Math.random() * 40,
          { vx: -vx * 0.6, vy: -vy * 0.3 }
        );
      }
    }
    prevX = trainX;
    prevY = trainY;

    ctx.clearRect(0, 0, canvas.width, canvas.height);

    // 파티클 — 빠른 속도감에 맞게 빠르게 사라짐
    for (let i = particles.length - 1; i >= 0; i--) {
      const p = particles[i];
      p.x += p.vx; p.y += p.vy;
      p.vx *= 0.92; p.vy *= 0.92;
      p.life -= 0.032; // 파티클도 좀 더 오래 유지
      if (p.life <= 0) { particles.splice(i, 1); continue; }
      ctx.globalAlpha = p.life * 0.9;
      ctx.fillStyle = p.color;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.size * p.life, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;

    if (wrap) wrap.style.transform = `translate(${trainX}px, ${trainY}px)`;

    if (t < 1 || particles.length > 0) {
      animFrame = requestAnimationFrame(animate);
    } else {
      overlay.remove();
    }
  }

  // (unused)
}

// ──────────────────────────────────────────────
// dayGrid 이벤트 위임 — 완료 토글, 미루기
// ──────────────────────────────────────────────
dayGrid.addEventListener('click', e => {
  const gcalBtn = e.target.closest('.btn-gcal-done');
  if (gcalBtn) { toggleGcalStatus(gcalBtn.dataset.gcalId, gcalBtn.dataset.date); return; }

  const btnO = e.target.closest('.btn-o');
  if (btnO) {
    const schedItem = btnO.closest('.sched-item');
    const isCompleting = schedItem && !schedItem.classList.contains('sched-item--done');

    // 스타레일 테마 + 완료 처리 → 열차 출발 애니메이션
    if (isCompleting && document.documentElement.dataset.theme === 'starrail') {
      schedItem.classList.add('sr-departing');
      schedItem.style.pointerEvents = 'none';
      spawnTrainDepartureEffects(schedItem); // 스파크 + 플래시 효과
      setTimeout(() => {
        toggleStatus(btnO.dataset.date, btnO.dataset.id);
      }, 720);
    } else {
      toggleStatus(btnO.dataset.date, btnO.dataset.id);
    }
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
