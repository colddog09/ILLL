/* ============================================================
   modals.js — 모달 UI, 테마, D-Day, 오프라인 배너
   (events.js보다 먼저 로드)
   ============================================================ */

'use strict';

// ──────────────────────────────────────────────
// 기한 목록 렌더 (정보 모달 내부)
// ──────────────────────────────────────────────
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
const DEFAULT_LINKS = [
  { id: '__classcord__', icon: '💬', name: '클래스코드', url: 'https://classcord-ten.vercel.app/' }
];

function renderInfoLinks() {
  const listEl = document.getElementById('userLinksList');
  if (!listEl) return;

  listEl.innerHTML = '';

  DEFAULT_LINKS.forEach(link => {
    const item = document.createElement('div');
    item.className = 'user-link-item user-link-item--default';
    item.innerHTML = `
      <a href="${escHtml(safeUrl(link.url))}" target="_blank" rel="noopener noreferrer" class="info-link user-link-a">
        <span class="user-link-icon">${escHtml(link.icon || '🔗')}</span>
        <span>${escHtml(link.name)}</span>
      </a>
    `;
    listEl.appendChild(item);
  });

  (state.links || []).forEach(link => {
    const item = document.createElement('div');
    item.className = 'user-link-item';
    item.innerHTML = `
      <a href="${escHtml(safeUrl(link.url))}" target="_blank" rel="noopener noreferrer" class="info-link user-link-a">
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

  addLinkToggleBtn?.addEventListener('click', () => {
    if (addLinkForm) addLinkForm.hidden = false;
    if (addLinkToggleBtn) addLinkToggleBtn.hidden = true;
    linkNameInput?.focus();
  });
  linkCancelBtn?.addEventListener('click', closeLinkForm);
  linkConfirmBtn?.addEventListener('click', () => {
    const name = linkNameInput?.value.trim();
    const url  = linkUrlInput?.value.trim();
    if (!name || !url) return;
    // http / https 프로토콜만 허용 (javascript: 등 차단)
    if (!/^https?:\/\//i.test(url)) {
      alert('링크 주소는 http:// 또는 https://로 시작해야 합니다.');
      linkUrlInput?.focus();
      return;
    }
    const icon = linkIconInput?.value.trim() || '🔗';
    if (!state.links) state.links = [];
    state.links.push({ id: uid(), name, icon, url });
    saveState();
    renderInfoLinks();
    closeLinkForm();
  });
  userLinksList?.addEventListener('click', e => {
    const btn = e.target.closest('.user-link-delete');
    if (!btn) return;
    state.links = (state.links || []).filter(l => l.id !== btn.dataset.linkId);
    saveState();
    renderInfoLinks();
  });
})();

// ──────────────────────────────────────────────
// 정보 모달
// ──────────────────────────────────────────────
const infoBtn     = document.getElementById('infoBtn');
const infoModal   = document.getElementById('infoModal');
const infoCloseBtn = document.getElementById('infoCloseBtn');
const infoHistoryBtn = document.getElementById('infoHistoryBtn');

bindModal(infoBtn, infoModal, infoCloseBtn, () => { renderDeadlineList(); renderInfoLinks(); });

// ──────────────────────────────────────────────
// 수행평가 오버레이
// ──────────────────────────────────────────────
const suhaengBtn     = document.getElementById('suhaengBtn');
const suhaengOverlay = document.getElementById('suhaengOverlay');
const suhaengFrame   = document.getElementById('suhaengFrame');

suhaengBtn?.addEventListener('click', () => {
  if (suhaengFrame && !suhaengFrame.src.includes('suhaeng')) {
    suhaengFrame.src = './suhaeng/index.html';
  }
  if (suhaengOverlay) suhaengOverlay.hidden = false;
});

// ──────────────────────────────────────────────
// 설정 모달
// ──────────────────────────────────────────────
const settingsBtn      = document.getElementById('settingsBtn');
const settingsModal    = document.getElementById('settingsModal');
const settingsCloseBtn = document.getElementById('settingsCloseBtn');

bindModal(settingsBtn, settingsModal, settingsCloseBtn, () => {
  if (typeof updateGcalUI === 'function') updateGcalUI();
  if (typeof renderGcalCalendarSettings === 'function') renderGcalCalendarSettings();
  // Reset to general tab on open
  document.querySelectorAll('.settings-tab').forEach(btn => btn.classList.toggle('settings-tab--active', btn.dataset.tab === 'general'));
  const genTab  = document.getElementById('settingsTabGeneral');
  const shopTab = document.getElementById('settingsTabThemeshop');
  if (genTab)  genTab.hidden  = false;
  if (shopTab) shopTab.hidden = true;
  const cfg    = getDdayConfig();
  const labelEl = document.getElementById('ddayLabelInput');
  const dateEl  = document.getElementById('ddayDateInput');
  if (labelEl) labelEl.value = cfg.label || '';
  if (dateEl)  dateEl.value  = cfg.date  || '';
});

// ── Settings tab switching ─────────────────────
document.addEventListener('click', function(e) {
  const tab = e.target.closest('.settings-tab');
  if (!tab) return;
  const targetTab = tab.dataset.tab;
  document.querySelectorAll('.settings-tab').forEach(btn =>
    btn.classList.toggle('settings-tab--active', btn.dataset.tab === targetTab)
  );
  const genTab  = document.getElementById('settingsTabGeneral');
  const shopTab = document.getElementById('settingsTabThemeshop');
  if (genTab)  genTab.hidden  = targetTab !== 'general';
  if (shopTab) shopTab.hidden = targetTab !== 'themeshop';
});

// ──────────────────────────────────────────────
// D-Day
// ──────────────────────────────────────────────
const DDAY_KEY = 'ddayConfig_v1';

function getDdayConfig() {
  try {
    const raw = localStorage.getItem(DDAY_KEY);
    if (raw) return JSON.parse(raw);
  } catch (_) {}
  return { label: '시험', date: '2026-06-22' };
}

function saveDdayConfig(label, date) {
  localStorage.setItem(DDAY_KEY, JSON.stringify({ label, date }));
}

function updateDday() {
  const cfg  = getDdayConfig();
  const exam = new Date(cfg.date + 'T00:00:00');
  if (isNaN(exam.getTime())) return;
  const now          = new Date();
  const todayMidnight = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const diff          = Math.round((exam - todayMidnight) / (1000 * 60 * 60 * 24));
  const label         = cfg.label || 'D-Day';
  const text = diff > 0 ? `🔥 ${label} D-${diff}` : diff === 0 ? `🔥 ${label} D-Day!` : `🔥 ${label} D+${Math.abs(diff)}`;
  const badge = document.getElementById('ddayBadge');
  if (badge) badge.textContent = text;
}

document.getElementById('ddaySaveBtn')?.addEventListener('click', () => {
  const label = document.getElementById('ddayLabelInput')?.value.trim();
  const date  = document.getElementById('ddayDateInput')?.value;
  if (!date) { alert('날짜를 선택해주세요.'); return; }
  saveDdayConfig(label || 'D-Day', date);
  updateDday();
  const btn = document.getElementById('ddaySaveBtn');
  btn.textContent = '✅ 저장됨';
  setTimeout(() => { btn.textContent = '저장'; }, 1500);
});

// ──────────────────────────────────────────────
// 과거 내역 모달
// ──────────────────────────────────────────────
const historyModal   = document.getElementById('historyModal');
const historyList    = document.getElementById('historyList');
const historyCloseBtn = document.getElementById('historyCloseBtn');

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

    const frag = document.createDocumentFragment();
    let firstMonth = true;

    Object.keys(months).sort((a, b) => b.localeCompare(a)).forEach(mk => {
      const days = q
        ? months[mk].filter(k => state.schedule[k].some(it => it.text.toLowerCase().includes(q)))
        : months[mk];
      if (!days.length) return;

      const [y, m]    = mk.split('-');
      const totalTasks = days.reduce((s, k) => s + state.schedule[k].length, 0);

      const monthEl   = document.createElement('div');
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
        const items    = q ? rawItems.filter(it => it.text.toLowerCase().includes(q)) : rawItems;
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
            ${items.map(it => `<div class="history-task"><span class="history-task__text">${escHtml(it.text)}</span></div>`).join('')}
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
  searchWrap.querySelector('#historySearch').addEventListener('input', e => renderHistoryBody(e.target.value));
  setModalOpen(historyModal, true);
  setTimeout(() => searchWrap.querySelector('#historySearch')?.focus(), 150);
}

historyList?.addEventListener('click', e => {
  const dayHeader   = e.target.closest('.history-day__header');
  if (dayHeader) { dayHeader.parentElement.classList.toggle('open'); return; }
  const monthHeader = e.target.closest('.history-month__header');
  if (monthHeader)  monthHeader.parentElement.classList.toggle('open');
});

bindModal(null, historyModal, historyCloseBtn);

infoHistoryBtn?.addEventListener('click', () => {
  setModalOpen(infoModal, false);
  openHistory();
});

// ──────────────────────────────────────────────
// 데모 모달
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
        if (ci === word.length) deleting = true;
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
    if (prev >= 0 && slides[prev]) {
      slides[prev].classList.remove('active');
      slides[prev].classList.add('exit-left');
      setTimeout(() => slides[prev]?.classList.remove('exit-left'), 300);
    }
    current = idx;
    slides[current].classList.add('active');
    dots.forEach((d, i) => d.classList.toggle('demo-dot--active', i === current));
    prevBtn.disabled    = current === 0;
    nextBtn.disabled    = false;
    nextBtn.textContent = current === total - 1 ? '✓' : '▶';
    stopTyping();
    if (current === 0) setTimeout(startTyping, 400);
  }

  function openDemo()  { demoModal.hidden = false; current = -1; goTo(0); }
  function closeDemo() { demoModal.hidden = true; stopTyping(); }

  demoBtn.addEventListener('click', openDemo);

  // 일정 복구 버튼 (❗) — 로컬 백업에서 복구
  document.getElementById('recoverBtn')?.addEventListener('click', () => {
    if (typeof restoreFromLocalBackup === 'function') restoreFromLocalBackup();
  });
  closeBtn.addEventListener('click', closeDemo);
  demoModal.addEventListener('click', e => { if (e.target === demoModal) closeDemo(); });
  prevBtn.addEventListener('click', () => { if (current > 0) goTo(current - 1); });
  nextBtn.addEventListener('click', () => { current < total - 1 ? goTo(current + 1) : closeDemo(); });
  document.addEventListener('keydown', e => {
    if (demoModal.hidden) return;
    if (e.key === 'ArrowRight' && current < total - 1) goTo(current + 1);
    if (e.key === 'ArrowLeft'  && current > 0)         goTo(current - 1);
    if (e.key === 'Escape') closeDemo();
  });
})();

// ──────────────────────────────────────────────
// 앱 업데이트 버튼
// ──────────────────────────────────────────────
(function initUpdateCheck() {
  const btn = document.getElementById('updateCheckBtn');
  if (!btn) return;

  btn.addEventListener('click', async () => {
    if (!('serviceWorker' in navigator)) {
      btn.textContent = '⚠️ 지원 안 됨';
      setTimeout(() => { btn.textContent = '🔄 업데이트 확인'; }, 2000);
      return;
    }
    btn.textContent = '확인 중...';
    btn.disabled = true;
    try {
      const reg = await navigator.serviceWorker.getRegistration();
      if (!reg) {
        btn.textContent = '✅ 최신 버전';
        setTimeout(() => { btn.textContent = '🔄 업데이트 확인'; btn.disabled = false; }, 2000);
        return;
      }
      await reg.update();
      if (reg.waiting) {
        btn.textContent = '🔄 업데이트 중...';
        reg.waiting.postMessage({ type: 'SKIP_WAITING' });
        // controllerchange 이벤트로 페이지 새로고침됨
      } else if (reg.installing) {
        btn.textContent = '⏳ 설치 중...';
        setTimeout(() => { btn.textContent = '🔄 업데이트 확인'; btn.disabled = false; }, 4000);
      } else {
        btn.textContent = '✅ 최신 버전';
        setTimeout(() => { btn.textContent = '🔄 업데이트 확인'; btn.disabled = false; }, 2000);
      }
    } catch (e) {
      console.error('업데이트 확인 실패:', e);
      btn.textContent = '🔄 업데이트 확인';
      btn.disabled = false;
    }
  });
})();

// ──────────────────────────────────────────────
// 오프라인 배너
// ──────────────────────────────────────────────
(function initOfflineBanner() {
  const banner = document.getElementById('offlineBanner');
  if (!banner) return;
  function update() {
    banner.classList.toggle('offline-banner--show', !navigator.onLine);
  }
  window.addEventListener('online',  update);
  window.addEventListener('offline', update);
  update();
})();

// ──────────────────────────────────────────────
// 테마
// ──────────────────────────────────────────────
(function initTheme() {
  const THEME_KEY      = 'appTheme_v1';
  const SR_UNLOCK_KEY  = 'srUnlocked_v1';
  const SR_PW          = '33550336';
  const HGD_UNLOCK_KEY = 'hgdUnlocked_v1';
  const HGD_PW         = 'ilovehangyodon';

  // 모든 테마 정의 (shop.html과 동기화)
  const ALL_THEMES = [
    { id: 'purple',   label: '보라',          unlockKey: null },
    { id: 'blue',     label: '블루',          unlockKey: null },
    { id: 'green',    label: '그린',          unlockKey: null },
    { id: 'dark',     label: '다크',          unlockKey: null },
    { id: 'jelly',    label: '젤리',          unlockKey: null },
    { id: 'glass',    label: '리퀴드 글라스', unlockKey: null },
    { id: 'winter',   label: '겨울',          unlockKey: null },
    { id: 'hgd',      label: '한교동',        unlockKey: HGD_UNLOCK_KEY },
    { id: 'starrail', label: '붕괴 스타레일', unlockKey: SR_UNLOCK_KEY  },
    { id: 'custom',   label: '🎨 내 테마',     unlockKey: null },
  ];

  function isUnlocked(t) {
    if (!t.unlockKey) return true;
    return localStorage.getItem(t.unlockKey) === '1';
  }

  // ── 겨울 얼음 깨기 파편 효과 ─────────────────
  function spawnIceBreakEffect(el) {
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const cx   = rect.left + rect.width  / 2;
    const cy   = rect.top  + rect.height / 2;
    // 아이템 모든 모서리에 닿을 수 있는 대각선 반경 (clip으로 아이템 외부는 잘림)
    const maxR = Math.sqrt(Math.pow(rect.width / 2, 2) + Math.pow(rect.height / 2, 2)) * 1.15;

    // ── 크랙 경로 사전 계산 (매 프레임 변하지 않도록) ──
    const NUM_CRACKS = 14;
    const cracks = Array.from({ length: NUM_CRACKS }, (_, i) => {
      let angle = (Math.PI * 2 / NUM_CRACKS) * i + (Math.random() - 0.5) * 0.22;
      const pts = [{ x: cx, y: cy }];
      for (let s = 1; s <= 5; s++) {
        angle += (Math.random() - 0.5) * 0.38;
        pts.push({
          x: cx + Math.cos(angle) * maxR * (s / 5),
          y: cy + Math.sin(angle) * maxR * (s / 5),
        });
      }
      return { pts, w: 1 + Math.random() * 1.5 };
    });

    // ── 플래시 오버레이 (항목 전체를 강하게 덮음) ──
    const flash = document.createElement('div');
    flash.style.cssText = `position:fixed;left:${rect.left-5}px;top:${rect.top-5}px;`
      + `width:${rect.width+10}px;height:${rect.height+10}px;`
      + `background:rgba(255,255,255,0.97);border-radius:10px;`
      + `pointer-events:none;z-index:9998;`;
    document.body.appendChild(flash);
    requestAnimationFrame(() => {
      flash.style.transition = 'opacity 0.35s ease-out';
      flash.style.opacity    = '0';
    });
    setTimeout(() => flash.remove(), 420);

    // ── 전체화면 캔버스 ──
    const canvas = document.createElement('canvas');
    canvas.style.cssText = 'position:fixed;top:0;left:0;width:100vw;height:100vh;pointer-events:none;z-index:9999;';
    canvas.width  = window.innerWidth;
    canvas.height = window.innerHeight;
    document.body.appendChild(canvas);
    const ctx = canvas.getContext('2d');

    // ── 진동 (Web Animations API) ──
    el.animate([
      { transform: 'translateX(0)' },
      { transform: 'translateX(-3px)' },
      { transform: 'translateX(3px)' },
      { transform: 'translateX(-2px)' },
      { transform: 'translateX(2px)' },
      { transform: 'translateX(-1px)' },
      { transform: 'translateX(0)' },
    ], { duration: 200, easing: 'ease-out' });

    function drawCracksAt(progress, alpha) {
      ctx.save();
      ctx.beginPath();
      ctx.rect(rect.left - 1, rect.top - 1, rect.width + 2, rect.height + 2);
      ctx.clip();
      cracks.forEach(cr => {
        const { pts } = cr;
        const end  = progress * (pts.length - 1);
        const full = Math.floor(end);
        ctx.beginPath();
        ctx.moveTo(pts[0].x, pts[0].y);
        for (let i = 1; i < pts.length; i++) {
          if (i <= full) {
            ctx.lineTo(pts[i].x, pts[i].y);
          } else if (i === full + 1) {
            const frac = end - full;
            ctx.lineTo(
              pts[i-1].x + (pts[i].x - pts[i-1].x) * frac,
              pts[i-1].y + (pts[i].y - pts[i-1].y) * frac,
            );
            break;
          }
        }
        ctx.strokeStyle = `rgba(150,220,255,${0.38 * alpha})`;
        ctx.lineWidth   = cr.w * 4.5;
        ctx.stroke();
        ctx.strokeStyle = `rgba(255,255,255,${0.95 * alpha})`;
        ctx.lineWidth   = cr.w;
        ctx.stroke();
      });
      ctx.restore();
    }

    // ── 애니메이션: 크랙 150ms 퍼짐 → 250ms 소멸 ──
    const CRACK_DUR = 150;
    const FADE_DUR  = 250;
    const t0 = performance.now();

    (function tick(now) {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      const elapsed = now - t0;
      if (elapsed < CRACK_DUR) {
        const ease = 1 - Math.pow(1 - elapsed / CRACK_DUR, 3);
        drawCracksAt(ease, 1);
        requestAnimationFrame(tick);
      } else {
        const fadeAlpha = Math.max(0, 1 - (elapsed - CRACK_DUR) / FADE_DUR);
        if (fadeAlpha > 0) {
          drawCracksAt(1, fadeAlpha);
          requestAnimationFrame(tick);
        } else {
          canvas.remove();
        }
      }
    })(t0);
  }
  // expose for events.js
  window._spawnIceBreakEffect = spawnIceBreakEffect;

  // ── 겨울 눈 효과 ──────────────────────────────
  function removeWinterEffects() {
    document.getElementById('winterSnow')?.remove();
    document.getElementById('winterDeco')?.remove();
  }

  function spawnWinterEffects() {
    removeWinterEffects();

    // 눈 컨테이너
    const snow = document.createElement('div');
    snow.className = 'winter-snow';
    snow.id = 'winterSnow';

    const FLAKES = ['❄', '❅', '❆', '✦', '·'];
    const COUNT  = 28;
    for (let i = 0; i < COUNT; i++) {
      const f = document.createElement('span');
      f.className = 'snowflake';
      f.textContent = FLAKES[Math.floor(Math.random() * FLAKES.length)];
      const size  = 0.55 + Math.random() * 1.1;
      const drift = (Math.random() * 100 - 50).toFixed(1);
      f.style.cssText = [
        `left:${(Math.random() * 102 - 1).toFixed(1)}vw`,
        `font-size:${size.toFixed(2)}rem`,
        `animation-duration:${(5 + Math.random() * 9).toFixed(1)}s`,
        `animation-delay:${(-(Math.random() * 12)).toFixed(1)}s`,
        `--drift:${drift}px`,
      ].join(';');
      snow.appendChild(f);
    }
    document.body.appendChild(snow);

    // 데코 — 트리·눈사람 이미지 (크게), 나머지 이모지
    const DECOS = [
      { img: '/image/tree.png',    w: '4.8rem', style: 'top:8px;left:10px;animation-delay:0s' },
      { img: '/image/snowman.png', w: '4.2rem', style: 'top:6px;right:10px;animation-delay:0.6s' },
      { emoji: '🎁',               style: 'bottom:20px;left:12px;font-size:2.8rem;animation-delay:1.1s' },
      { emoji: '❄️',               style: 'top:48%;left:6px;font-size:1.6rem;animation-delay:1.8s;opacity:0.7' },
      { img: '/image/tree.png',    w: '3.8rem', style: 'bottom:14px;right:10px;animation-delay:2.2s' },
      { img: '/image/snowman.png', w: '3.5rem', style: 'top:50%;right:6px;animation-delay:0.4s;opacity:0.9' },
    ];
    const decoWrap = document.createElement('div');
    decoWrap.id = 'winterDeco';
    decoWrap.style.cssText = 'position:fixed;inset:0;pointer-events:none;z-index:10;';
    DECOS.forEach(({ emoji, img, w, style }) => {
      const span = document.createElement('span');
      span.style.cssText = `position:absolute;display:block;${style};filter:drop-shadow(0 2px 6px rgba(58,155,213,0.35));animation:decoFloat 4s ease-in-out infinite;`;
      if (img) {
        const imgEl = document.createElement('img');
        imgEl.src = img;
        // mix-blend-mode:multiply 로 흰 배경 제거
        imgEl.style.cssText = `width:${w};height:auto;display:block;`;
        imgEl.alt = '';
        span.appendChild(imgEl);
      } else {
        span.textContent = emoji;
      }
      decoWrap.appendChild(span);
    });
    document.body.appendChild(decoWrap);
  }
  // ─────────────────────────────────────────────

  // ─── 커스텀 테마 CSS 주입 ─────────────────────
  function _applyCustomThemeCss(cfg) {
    if (!cfg) { document.getElementById('custom-theme-css')?.remove(); return; }
    let bgValue;
    if (cfg.bgType === 'image' && cfg.bgImage) {
      bgValue = `url("${cfg.bgImage}") center / cover no-repeat fixed`;
    } else if (cfg.bgType === 'gradient') {
      bgValue = `linear-gradient(${cfg.bgGradAngle || 135}deg, ${cfg.bgGrad1 || '#e0e7ff'}, ${cfg.bgGrad2 || '#fdf4ff'})`;
    } else {
      bgValue = cfg.bgSolid || '#f4f5fb';
    }
    const acc  = cfg.accent  || '#6c63ff';
    const acc2 = cfg.accent2 || '#a78bfa';
    const oUrl = cfg.oBtnPreset === 'upload' ? (cfg.oBtnData || null)
               : cfg.oBtnPreset === 'custom'  ? (cfg.oBtnUrl  || null) : null;
    const xUrl = cfg.xBtnPreset === 'upload' ? (cfg.xBtnData || null)
               : cfg.xBtnPreset === 'custom'  ? (cfg.xBtnUrl  || null) : null;
    const oBtnRule = oUrl ? `\n[data-theme="custom"] .btn-o__img:not(.btn-o__img--no){content:url("${oUrl}")}` : '';
    const xBtnRule = xUrl ? `\n[data-theme="custom"] .btn-o__img--no{content:url("${xUrl}")}` : '';
    const css = `[data-theme="custom"]{` +
      `--bg:${cfg.bgSolid||'#f4f5fb'};` +
      `--surface:${cfg.surface||'#fff'};` +
      `--surface-hover:${acc}1a;` +
      `--accent:${acc};` +
      `--accent2:${acc2};` +
      `--text:${cfg.text||'#1e1b4b'};` +
      `--text-sub:${cfg.textSub||'#6b7280'};` +
      `--border:${acc}26;` +
      `--border-strong:${acc}59;` +
      `--bg-grad1:${acc}14;` +
      `--bg-grad2:${acc2}11;` +
      `--shadow:0 4px 20px ${acc}1a;` +
      `--shadow-lg:0 12px 40px ${acc}2e;` +
    `}\n[data-theme="custom"] body{background:${bgValue};min-height:100vh}${oBtnRule}${xBtnRule}`;
    let el = document.getElementById('custom-theme-css');
    if (!el) { el = document.createElement('style'); el.id = 'custom-theme-css'; document.head.appendChild(el); }
    el.textContent = css;
  }
  window._applyCustomThemeCss = _applyCustomThemeCss;

  function applyTheme(theme) {
    if (theme === 'purple' || !theme) {
      document.documentElement.removeAttribute('data-theme');
    } else {
      document.documentElement.setAttribute('data-theme', theme);
    }
    document.querySelectorAll('.theme-swatch').forEach(sw => {
      sw.classList.toggle('theme-swatch--active', sw.dataset.theme === (theme || 'purple'));
    });

    // 겨울 효과 on/off
    if (theme === 'winter') {
      spawnWinterEffects();
    } else {
      removeWinterEffects();
    }

    // 커스텀 테마 CSS 주입/제거
    if (theme === 'custom') {
      try { _applyCustomThemeCss(JSON.parse(localStorage.getItem('customTheme_v1') || '{}')); }
      catch (_) { _applyCustomThemeCss({}); }
    } else {
      document.getElementById('custom-theme-css')?.remove();
    }

    if (typeof renderWeek === 'function') renderWeek();
  }

  // 스와치 행 동적 렌더링
  function renderSwatchRow() {
    const row = document.getElementById('themeSwatchRow');
    if (!row) return;
    const current = localStorage.getItem(THEME_KEY) || 'purple';
    row.innerHTML = '';
    ALL_THEMES.forEach(t => {
      const unlocked = isUnlocked(t);
      const btn = document.createElement('button');
      btn.className = 'theme-swatch' +
        (t.id === current ? ' theme-swatch--active' : '') +
        (!unlocked ? ' theme-swatch--locked' : '');
      btn.dataset.theme = t.id;
      btn.dataset.label = t.label + (!unlocked ? ' 🔒' : '');
      btn.setAttribute('aria-label', t.label);
      btn.title = t.label;
      row.appendChild(btn);
    });
  }

  // 초기 적용
  applyTheme(localStorage.getItem(THEME_KEY) || 'purple');
  renderSwatchRow();

  // 설정 모달 열릴 때마다 갱신 (테마샵에서 잠금 해제 후 돌아왔을 때 반영)
  const settingsBtn = document.getElementById('settingsBtn');
  if (settingsBtn) {
    settingsBtn.addEventListener('click', () => {
      setTimeout(renderSwatchRow, 50);
    });
  }
  // storage 이벤트로 다른 탭/창에서 해금된 경우에도 반영
  window.addEventListener('storage', e => {
    if (e.key === HGD_UNLOCK_KEY || e.key === SR_UNLOCK_KEY || e.key === THEME_KEY) {
      renderSwatchRow();
      if (e.key === THEME_KEY) applyTheme(e.newValue || 'purple');
    }
    if (e.key === 'customTheme_v1' && (localStorage.getItem(THEME_KEY) || 'purple') === 'custom') {
      try { _applyCustomThemeCss(JSON.parse(e.newValue || '{}')); } catch (_) {}
    }
  });

  function promptPassword(pw, unlockKey, themeId, logo) {
    const overlay = document.createElement('div');
    overlay.className = 'sr-pw-overlay';
    overlay.innerHTML = `
      <div class="sr-pw-box">
        <div class="sr-pw-logo">${logo}</div>
        <p class="sr-pw-title">잠긴 테마</p>
        <p class="sr-pw-desc">암호를 입력하세요</p>
        <input class="sr-pw-input" type="password" maxlength="30" placeholder="••••••••" autocomplete="off" />
        <div class="sr-pw-btns">
          <button class="sr-pw-cancel">취소</button>
          <button class="sr-pw-confirm">확인</button>
        </div>
        <p class="sr-pw-error" hidden>암호가 틀렸어요</p>
      </div>`;
    document.body.appendChild(overlay);
    const input   = overlay.querySelector('.sr-pw-input');
    const confirm = overlay.querySelector('.sr-pw-confirm');
    const cancel  = overlay.querySelector('.sr-pw-cancel');
    const errMsg  = overlay.querySelector('.sr-pw-error');
    setTimeout(() => input.focus(), 50);
    function close() { overlay.remove(); }
    function tryUnlock() {
      if (input.value === pw) {
        localStorage.setItem(unlockKey, '1');
        close();
        localStorage.setItem(THEME_KEY, themeId);
        applyTheme(themeId);
        renderSwatchRow();
      } else {
        errMsg.hidden = false;
        input.value = '';
        input.focus();
        input.classList.add('sr-pw-shake');
        setTimeout(() => input.classList.remove('sr-pw-shake'), 500);
      }
    }
    confirm.addEventListener('click', tryUnlock);
    input.addEventListener('keydown', e => { if (e.key === 'Enter') tryUnlock(); });
    cancel.addEventListener('click', close);
    overlay.addEventListener('click', e => { if (e.target === overlay) close(); });
  }

  document.addEventListener('click', e => {
    const sw = e.target.closest('.theme-swatch');
    if (!sw) return;
    const theme = sw.dataset.theme;
    const t = ALL_THEMES.find(x => x.id === theme);
    if (!t) return;
    if (!isUnlocked(t)) {
      if (theme === 'starrail') { promptPassword(SR_PW,  SR_UNLOCK_KEY,  'starrail', '✦'); return; }
      if (theme === 'hgd')      { promptPassword(HGD_PW, HGD_UNLOCK_KEY, 'hgd', '🐟'); return; }
    }
    localStorage.setItem(THEME_KEY, theme);
    applyTheme(theme);
    renderSwatchRow();
  });
})();
