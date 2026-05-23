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
      <a href="${escHtml(link.url)}" target="_blank" rel="noopener noreferrer" class="info-link user-link-a">
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
const suhaengClose   = document.getElementById('suhaengCloseBtn');

suhaengBtn?.addEventListener('click', () => {
  if (suhaengFrame && !suhaengFrame.src.includes('suhaeng')) {
    suhaengFrame.src = './suhaeng/index.html';
  }
  if (suhaengOverlay) suhaengOverlay.hidden = false;
});
suhaengClose?.addEventListener('click', () => {
  if (suhaengOverlay) suhaengOverlay.hidden = true;
});

// ──────────────────────────────────────────────
// 설정 모달
// ──────────────────────────────────────────────
const settingsBtn      = document.getElementById('settingsBtn');
const settingsModal    = document.getElementById('settingsModal');
const settingsCloseBtn = document.getElementById('settingsCloseBtn');

bindModal(settingsBtn, settingsModal, settingsCloseBtn, () => {
  if (typeof updateGcalUI === 'function') updateGcalUI();
  const cfg    = getDdayConfig();
  const labelEl = document.getElementById('ddayLabelInput');
  const dateEl  = document.getElementById('ddayDateInput');
  if (labelEl) labelEl.value = cfg.label || '';
  if (dateEl)  dateEl.value  = cfg.date  || '';
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
  const THEME_KEY     = 'appTheme_v1';
  const SR_UNLOCK_KEY = 'srUnlocked_v1';
  const SR_PW         = '33550336';

  function applyTheme(theme) {
    if (theme === 'purple' || !theme) {
      document.documentElement.removeAttribute('data-theme');
    } else {
      document.documentElement.setAttribute('data-theme', theme);
    }
    document.querySelectorAll('.theme-swatch').forEach(sw => {
      sw.classList.toggle('theme-swatch--active', sw.dataset.theme === (theme || 'purple'));
    });
    if (typeof renderWeek === 'function') renderWeek();
  }

  function isStarRailUnlocked() {
    return localStorage.getItem(SR_UNLOCK_KEY) === '1';
  }

  function updateSwatchLock() {
    const sw = document.querySelector('.theme-swatch[data-theme="starrail"]');
    if (!sw) return;
    if (isStarRailUnlocked()) {
      sw.textContent = '';
      sw.classList.remove('theme-swatch--locked');
    }
  }

  applyTheme(localStorage.getItem(THEME_KEY) || 'purple');
  updateSwatchLock();

  function promptStarRailPassword() {
    const overlay = document.createElement('div');
    overlay.className = 'sr-pw-overlay';
    overlay.innerHTML = `
      <div class="sr-pw-box">
        <div class="sr-pw-logo">✦</div>
        <p class="sr-pw-title">잠긴 테마</p>
        <p class="sr-pw-desc">암호를 입력하세요</p>
        <input class="sr-pw-input" type="password" maxlength="16" placeholder="••••••••" autocomplete="off" />
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
      if (input.value === SR_PW) {
        localStorage.setItem(SR_UNLOCK_KEY, '1');
        updateSwatchLock();
        close();
        localStorage.setItem(THEME_KEY, 'starrail');
        applyTheme('starrail');
      } else {
        errMsg.hidden = false;
        input.value   = '';
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
    if (theme === 'starrail' && !isStarRailUnlocked()) { promptStarRailPassword(); return; }
    localStorage.setItem(THEME_KEY, theme);
    applyTheme(theme);
  });
})();
