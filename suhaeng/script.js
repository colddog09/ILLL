'use strict';

// ── Google Calendar 연동 ──
const GCAL_BASE      = 'https://www.googleapis.com/calendar/v3';
const GCAL_SCOPE     = 'https://www.googleapis.com/auth/calendar.readonly';
const GCAL_TARGET    = '일정';  // 연동할 캘린더 이름 (main app과 동일)
const TOKEN_LS_KEY   = 'gcal_token_shared';   // main app이 저장한 토큰
const CLIENT_ID_KEY  = 'gcal_client_id_cached';

let _token       = null;
let _tokenExpiry = 0;
let _calendarId  = null;

function tokenValid() {
  return !!_token && Date.now() < _tokenExpiry - 60000;
}

function loadStoredToken() {
  try {
    const stored = JSON.parse(localStorage.getItem(TOKEN_LS_KEY));
    if (stored?.token && stored.expiry > Date.now() + 60000) {
      _token = stored.token;
      _tokenExpiry = stored.expiry;
      return true;
    }
  } catch (e) {}
  return false;
}

async function getClientId() {
  const cached = localStorage.getItem(CLIENT_ID_KEY);
  if (cached) return cached;
  try {
    const res = await fetch('/api/gcal-client-id');
    const data = await res.json();
    if (data.clientId) {
      localStorage.setItem(CLIENT_ID_KEY, data.clientId);
      return data.clientId;
    }
  } catch (e) {}
  return null;
}

function requestToken(clientId) {
  return new Promise((resolve, reject) => {
    if (!window.google?.accounts?.oauth2) { reject(new Error('GIS not loaded')); return; }
    const client = google.accounts.oauth2.initTokenClient({
      client_id: clientId,
      scope: GCAL_SCOPE,
      callback: (resp) => {
        if (resp.error || !resp.access_token) { reject(new Error(resp.error || 'token error')); return; }
        _token = resp.access_token;
        _tokenExpiry = Date.now() + ((resp.expires_in || 3500) * 1000);
        const stored = JSON.stringify({ token: _token, expiry: _tokenExpiry });
        localStorage.setItem(TOKEN_LS_KEY, stored);
        resolve(_token);
      }
    });
    client.requestAccessToken({ prompt: '' });
  });
}

async function ensureToken() {
  if (tokenValid()) return true;
  if (loadStoredToken()) return true;
  const clientId = await getClientId();
  if (!clientId) return false;
  try {
    await requestToken(clientId);
    return true;
  } catch (e) {
    console.error('Token request failed:', e);
    return false;
  }
}

async function findCalendarId() {
  if (_calendarId) return _calendarId;
  const res = await fetch(`${GCAL_BASE}/users/me/calendarList`, {
    headers: { Authorization: `Bearer ${_token}` }
  });
  const data = await res.json();
  const cal = (data.items || []).find(c => c.summary === GCAL_TARGET);
  _calendarId = cal ? cal.id : 'primary';
  return _calendarId;
}

async function fetchCalendarEvents() {
  const calId = await findCalendarId();
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const future = new Date(today); future.setDate(future.getDate() + 100);

  const params = new URLSearchParams({
    timeMin: today.toISOString(),
    timeMax: future.toISOString(),
    singleEvents: 'true',
    orderBy: 'startTime',
    maxResults: '100'
  });

  const res = await fetch(
    `${GCAL_BASE}/calendars/${encodeURIComponent(calId)}/events?${params}`,
    { headers: { Authorization: `Bearer ${_token}` } }
  );
  if (!res.ok) throw new Error(`Calendar API ${res.status}`);
  const data = await res.json();
  return data.items || [];
}

// ── 날짜 유틸 ──
function formatEventDate(event) {
  const raw = event.start?.date || event.start?.dateTime;
  if (!raw) return '';
  const d = new Date(raw);
  const m = d.getMonth() + 1;
  const day = d.getDate();
  const dow = ['일','월','화','수','목','금','토'][d.getDay()];
  return `${m}/${day} (${dow})`;
}

function getEventUrgency(event) {
  const raw = event.start?.date || event.start?.dateTime;
  if (!raw) return { urgent: false, overdue: false };
  const d = new Date(raw); d.setHours(0, 0, 0, 0);
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const diff = Math.round((d - today) / 86400000);
  return { urgent: diff >= 0 && diff <= 1, overdue: diff < 0 };
}

// ── URL 추출 유틸 ──
function extractLink(rawDesc) {
  if (!rawDesc) return null;
  // 1) HTML href 속성에서 추출 (Google Calendar 링크 등)
  const hrefMatch = rawDesc.match(/href=["']([^"']+)["']/i);
  if (hrefMatch) return hrefMatch[1];
  // 2) HTML 제거 후 평문 URL 추출
  const plain = rawDesc.replace(/<[^>]*>/g, '');
  const urlMatch = plain.match(/https?:\/\/\S+/);
  if (urlMatch) return urlMatch[0].replace(/[.,;!?]$/, ''); // 말미 구두점 제거
  return null;
}

function stripLink(text) {
  // 설명에서 URL만 제거해 순수 텍스트 반환
  return text.replace(/https?:\/\/\S+/g, '').replace(/\s{2,}/g, ' ').trim();
}

// ── 카드 렌더링 ──
function escapeHtml(text) {
  if (!text) return '';
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

function getSubjectEmoji(subject) {
  if (!subject) return '📝';
  const s = subject.toLowerCase();
  if (s.includes('수학') || s.includes('math'))   return '📐';
  if (s.includes('영어') || s.includes('english')) return 'A';
  if (s.includes('국어') || s.includes('문학') || s.includes('독서')) return '가';
  if (s.includes('생명')) return '🧬';
  if (s.includes('과학') || s.includes('물리') || s.includes('화학') || s.includes('지학')) return '🧪';
  if (s.includes('사회') || s.includes('역사') || s.includes('윤리') || s.includes('지리')) return '🌍';
  if (s.includes('음악')) return '🎵';
  if (s.includes('미술')) return '🎨';
  if (s.includes('체육')) return '⚽️';
  if (s.includes('정보') || s.includes('코딩') || s.includes('컴퓨터')) return '💻';
  return '📝';
}

function createEventCardHTML(event, index) {
  const rawTitle = event.summary || '제목 없음';
  const done     = /^✅/.test(rawTitle);
  const title    = rawTitle.replace(/^✅\s*/, '');
  const dateStr  = formatEventDate(event);
  const rawDesc  = event.description || '';
  const link     = extractLink(rawDesc);
  const descFull = rawDesc.replace(/<[^>]*>/g, '').trim();
  const desc     = stripLink(descFull);   // URL 제거한 순수 텍스트
  const location = event.location || '';
  const { urgent, overdue } = getEventUrgency(event);
  const emoji    = getSubjectEmoji(title);

  let cardClass = '';
  if (done)            cardClass = ' highlight-done';
  else if (overdue)    cardClass = ' highlight-overdue';
  else if (urgent)     cardClass = ' highlight-urgent';

  const urgencyBadge = done
    ? '<div style="margin-top:8px;font-size:14px;color:#34C759;font-weight:700;">✅ 완료</div>'
    : overdue
    ? '<div style="margin-top:8px;font-size:14px;color:#888;font-weight:700;">💀 기한 지남</div>'
    : urgent
    ? '<div style="margin-top:8px;font-size:14px;color:#FF3B30;font-weight:700;">⚠️ 마감 임박</div>'
    : '';

  const descRow    = desc     ? `<div class="info-row"><div class="info-label">내용</div><div class="info-value">${escapeHtml(desc)}</div></div>` : '';
  const locationRow = location ? `<div class="info-row"><div class="info-label">장소</div><div class="info-value">${escapeHtml(location)}</div></div>` : '';
  const linkRow = link
    ? `<a class="card-link-btn card-link-btn--on" href="${escapeHtml(link)}" target="_blank" rel="noopener">바로가기 →</a>`
    : `<span class="card-link-btn card-link-btn--off">바로가기 X</span>`;

  return `
    <div class="info-card${cardClass}" id="card-${index}">
      <div class="card-inner">
        <div class="card-front">
          <div class="card-bg-title">${escapeHtml(title.length > 2 ? '과제' : title)}</div>
          <div class="card-bg-emoji">${done ? '✅' : overdue ? '💀' : emoji}</div>
          <div class="card-content" style="justify-content:center;align-items:center;text-align:center;">
            <div style="font-size:32px;font-weight:800;margin-bottom:10px;">${escapeHtml(title)}</div>
            <div style="font-size:18px;color:#666;font-weight:600;">${dateStr}</div>
            ${urgencyBadge}
            <div style="margin-top:20px;font-size:14px;color:#999;">터치하여 상세 정보 보기</div>
          </div>
        </div>
        <div class="card-back">
          <div class="card-header-small">${escapeHtml(title)}</div>
          <div class="card-body">
            <div class="info-row">
              <div class="info-label">날짜</div>
              <div class="info-value">${dateStr}</div>
            </div>
            ${descRow}
            ${locationRow}
            ${linkRow}
          </div>
        </div>
      </div>
    </div>`;
}

function renderCards(events) {
  if (events.length === 0) return '<div class="state-container"><div class="no-data-msg">등록된 수행평가가 없습니다 🎉</div></div>';
  const single = events.map((ev, i) => createEventCardHTML(ev, i)).join('');
  const divider = '<div class="set-divider"><div class="set-divider-marker">▼</div></div>';
  return Array.from({ length: 5 }, () => single).join(divider);
}

// ── 무한 스크롤 & 포커스 ──
let _itemWidth = 0;
let _setWidth  = 0;

function scrollToCard(index) {
  const container = document.getElementById('scroll-container');
  if (!container || !_itemWidth) return;
  container.scrollTo({ left: _setWidth * 2 + _itemWidth * index, behavior: 'smooth' });
}

function setupInfiniteScroll(container, singleSetCount) {
  window.singleSetCount = singleSetCount;
  requestAnimationFrame(() => {
    const firstCard = container.querySelector('.info-card');
    if (!firstCard) return;
    const gap = parseFloat(window.getComputedStyle(container).gap) || 0;
    _itemWidth = firstCard.offsetWidth + gap;
    _setWidth  = _itemWidth * singleSetCount;
    const itemWidth = _itemWidth;
    const setWidth  = _setWidth;

    container.scrollLeft = setWidth * 2;

    if (container._scrollHandler) container.removeEventListener('scroll', container._scrollHandler);

    let resetting = false;
    const handler = () => {
      if (resetting) return;
      const sl = container.scrollLeft;
      if (sl < setWidth) {
        resetting = true;
        container.style.scrollSnapType = 'none';
        container.style.scrollBehavior = 'auto';
        container.scrollLeft += setWidth * 2;
        void container.offsetWidth;
        container.style.scrollBehavior = 'smooth';
        container.style.scrollSnapType = 'x mandatory';
        resetting = false;
      } else if (sl > setWidth * 4) {
        resetting = true;
        container.style.scrollSnapType = 'none';
        container.style.scrollBehavior = 'auto';
        container.scrollLeft -= setWidth * 2;
        void container.offsetWidth;
        container.style.scrollBehavior = 'smooth';
        container.style.scrollSnapType = 'x mandatory';
        resetting = false;
      }
      updateScrollFocus(container);
    };
    container.addEventListener('scroll', handler);
    container._scrollHandler = handler;
    updateScrollFocus(container);
  });
}

function updateScrollFocus(container) {
  const center = container.scrollLeft + container.offsetWidth / 2;
  container.querySelectorAll('.info-card').forEach(card => {
    const cardCenter = card.offsetLeft + card.offsetWidth / 2;
    card.classList.toggle('active-center', Math.abs(center - cardCenter) < 150);
  });
}

// ── 마감 임박 목록 ──
function renderUrgentList(events) {
  const listEl = document.getElementById('urgentList');
  if (!listEl) return;

  const urgentItems = events
    .map((ev, i) => ({ ev, i }))
    .filter(({ ev }) => {
      const { urgent, overdue } = getEventUrgency(ev);
      const isDone = /^✅/.test(ev.summary || '');
      return urgent && !overdue && !isDone;
    });

  if (urgentItems.length === 0) {
    listEl.hidden = true;
    return;
  }

  listEl.hidden = false;
  listEl.innerHTML = `
    <div class="urgent-list__header">⚠️ 마감 임박</div>
    <div class="urgent-chips">
      ${urgentItems.map(({ ev, i }) => {
        const rawDesc = ev.description || '';
        const link = extractLink(rawDesc);
        const descClean = stripLink(rawDesc.replace(/<[^>]*>/g, '').trim());
        const linkBtn = link
          ? `<a class="urgent-chip__link urgent-chip__link--on" href="${escapeHtml(link)}" target="_blank" rel="noopener" data-stop>바로가기 →</a>`
          : `<span class="urgent-chip__link urgent-chip__link--off">바로가기 X</span>`;
        return `
          <div class="urgent-chip" data-index="${i}">
            <div class="urgent-chip__top">
              <span class="urgent-chip__name">${escapeHtml(ev.summary || '제목 없음')}</span>
              <span class="urgent-chip__date">${formatEventDate(ev)}</span>
            </div>
            <div class="urgent-chip__footer">
              ${linkBtn}
            </div>
          </div>
        `;
      }).join('')}
    </div>
  `;

  listEl.querySelectorAll('.urgent-chip').forEach(chip => {
    chip.addEventListener('click', e => {
      // 바로가기 링크 클릭은 카드 이동 안 함
      if (e.target.closest('[data-stop]')) return;
      scrollToCard(parseInt(chip.dataset.index, 10));
    });
  });
}

// ── 카드 인터랙션 (틸트 & 플립) ──
function setupCardInteractions(container) {
  if (container.dataset.interactionsSetup === 'true') return;
  container.dataset.interactionsSetup = 'true';

  container.addEventListener('mousemove', e => {
    const card = e.target.closest('.info-card');
    if (!card || card.classList.contains('flipped')) return;
    const r = card.getBoundingClientRect();
    const rx = ((e.clientY - r.top  - r.height / 2) / (r.height / 2)) * -10;
    const ry = ((e.clientX - r.left - r.width  / 2) / (r.width  / 2)) *  10;
    const inner = card.querySelector('.card-inner');
    if (inner) { inner.style.transition = 'transform 0.1s ease-out'; inner.style.transform = `rotateX(${rx}deg) rotateY(${ry}deg)`; }
  });

  container.addEventListener('mouseout', e => {
    const card = e.target.closest('.info-card');
    if (!card) return;
    const inner = card.querySelector('.card-inner');
    if (inner) { inner.style.transition = 'transform 0.5s ease'; inner.style.transform = ''; }
  });

  container.addEventListener('click', e => {
    const card = e.target.closest('.info-card');
    if (!card || e.target.closest('button') || e.target.isContentEditable) return;
    card.classList.toggle('flipped');
    if (!card.classList.contains('flipped')) {
      const inner = card.querySelector('.card-inner');
      if (inner) { inner.style.transition = 'transform 0.5s ease'; inner.style.transform = ''; }
    } else {
      const inner = card.querySelector('.card-inner');
      if (inner) inner.style.transform = '';
    }
  });
}

// ── 메인 데이터 로드 ──
async function loadData() {
  const container  = document.getElementById('scroll-container');
  const refreshBtn = document.getElementById('refreshBtn');

  container.classList.add('is-empty');
  container.innerHTML = '<div class="state-container"><div class="spinner"></div></div>';
  if (refreshBtn) refreshBtn.disabled = true;

  try {
    const ok = await ensureToken();
    if (!ok) {
      container.innerHTML = `
        <div class="state-container">
          <div class="error-msg">
            캘린더 연결 필요<br>
            <span style="font-size:0.85em;opacity:0.8;">일정 관리 앱에서 캘린더를 먼저 연결해주세요.</span>
          </div>
        </div>`;
      return;
    }

    const events = await fetchCalendarEvents();

    if (events.length === 0) {
      _cachedEvents = [];
      container.innerHTML = '<div class="state-container"><div class="no-data-msg">등록된 수행평가가 없습니다 🎉</div></div>';
      return;
    }

    _cachedEvents = events;
    container.classList.remove('is-empty');
    applyViewMode(events);

  } catch (err) {
    console.error(err);
    container.innerHTML = `<div class="state-container"><div class="error-msg">오류 발생<br><span style="font-size:0.85em;opacity:0.8;">${escapeHtml(err.message)}</span></div></div>`;
  } finally {
    if (refreshBtn) refreshBtn.disabled = false;
  }
}

// ── 목록 뷰 렌더링 ──
function renderListView(events) {
  if (events.length === 0) {
    return '<div class="list-empty">등록된 수행평가가 없습니다 🎉</div>';
  }

  // 날짜별로 그룹핑
  const groups = {};
  events.forEach((ev, i) => {
    const raw = ev.start?.date || ev.start?.dateTime;
    const key = raw ? raw.slice(0, 10) : '날짜 없음';
    (groups[key] = groups[key] || []).push({ ev, i });
  });

  const DAYS_KO = ['일', '월', '화', '수', '목', '금', '토'];
  let html = '<div class="list-view-container">';

  Object.keys(groups).sort().forEach(dateKey => {
    const [y, m, d] = dateKey.split('-').map(Number);
    const dateObj = new Date(y, m - 1, d);
    const dow     = DAYS_KO[dateObj.getDay()];
    const dowClass = dateObj.getDay() === 0 ? ' dow-sun' : dateObj.getDay() === 6 ? ' dow-sat' : '';

    const today   = new Date(); today.setHours(0, 0, 0, 0);
    const diff    = Math.round((dateObj - today) / 86400000);
    let groupClass = '';
    if (diff < 0) groupClass = ' list-group--past';
    else if (diff <= 1) groupClass = ' list-group--urgent';

    html += `<div class="list-group${groupClass}">`;
    html += `<div class="list-date-header">
      <span class="list-date-num">${m}/${d}</span>
      <span class="list-date-dow${dowClass}">${dow}</span>
      ${diff === 0 ? '<span class="list-today-badge">오늘</span>' : diff === 1 ? '<span class="list-tmr-badge">내일</span>' : ''}
      <span class="list-count">${groups[dateKey].length}건</span>
    </div>`;

    groups[dateKey].forEach(({ ev, i }) => {
      const rawTitle    = ev.summary || '제목 없음';
      const done        = /^✅/.test(rawTitle);
      const title       = rawTitle.replace(/^✅\s*/, '');
      const { urgent, overdue } = getEventUrgency(ev);
      const rawDesc     = ev.description || '';
      const link        = extractLink(rawDesc);
      const desc        = stripLink(rawDesc.replace(/<[^>]*>/g, '').trim());
      const emoji       = getSubjectEmoji(title);

      let itemClass = 'list-item';
      if (done)         itemClass += ' list-item--done';
      else if (overdue) itemClass += ' list-item--overdue';
      else if (urgent)  itemClass += ' list-item--urgent';

      const badge = done   ? '<span class="list-badge list-badge--done">✅ 완료</span>'
                  : overdue ? '<span class="list-badge list-badge--overdue">💀 기한 지남</span>'
                  : urgent  ? '<span class="list-badge list-badge--urgent">⚠️ 임박</span>'
                  : '';

      const linkBtn = link
        ? `<a class="list-link-btn" href="${escapeHtml(link)}" target="_blank" rel="noopener">바로가기 →</a>`
        : '';

      html += `
        <div class="${itemClass}">
          <div class="list-item__emoji">${done ? '✅' : overdue ? '💀' : emoji}</div>
          <div class="list-item__body">
            <div class="list-item__title">${escapeHtml(title)}</div>
            ${desc ? `<div class="list-item__desc">${escapeHtml(desc)}</div>` : ''}
          </div>
          <div class="list-item__right">
            ${badge}
            ${linkBtn}
          </div>
        </div>`;
    });

    html += '</div>';
  });

  html += '</div>';
  return html;
}

// ── 뷰 모드 ──
const VIEW_MODE_KEY = 'suhaeng_view_mode';
let viewMode = localStorage.getItem(VIEW_MODE_KEY) || 'list';
let _cachedEvents = null;

const CARD_ICON_SVG = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="3" width="20" height="14" rx="2"/><path d="M8 21h8M12 17v4"/></svg>`;
const LIST_ICON_SVG = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="8" y1="18" x2="21" y2="18"/><circle cx="3" cy="6" r="1.5" fill="currentColor" stroke="none"/><circle cx="3" cy="12" r="1.5" fill="currentColor" stroke="none"/><circle cx="3" cy="18" r="1.5" fill="currentColor" stroke="none"/></svg>`;

function applyViewMode(events) {
  const container = document.getElementById('scroll-container');
  const wrapper   = container?.parentElement;
  const viewBtn   = document.getElementById('viewToggleBtn');
  if (!container || !events?.length) return;

  if (viewMode === 'list') {
    container.classList.add('list-mode');
    if (wrapper) wrapper.classList.add('list-mode');
    container.innerHTML = renderListView(events);
    if (viewBtn) { viewBtn.innerHTML = CARD_ICON_SVG; viewBtn.title = '카드 뷰로 전환'; }
  } else {
    container.classList.remove('list-mode');
    if (wrapper) wrapper.classList.remove('list-mode');
    container.innerHTML = renderCards(events);
    setupInfiniteScroll(container, events.length);
    setupCardInteractions(container);
    if (viewBtn) { viewBtn.innerHTML = LIST_ICON_SVG; viewBtn.title = '목록 뷰로 전환'; }
  }
  renderUrgentList(events);
}

function toggleViewMode() {
  if (!_cachedEvents) return;
  viewMode = viewMode === 'card' ? 'list' : 'card';
  localStorage.setItem(VIEW_MODE_KEY, viewMode);
  applyViewMode(_cachedEvents);
}

// ── 메인 앱 테마 동기화 ──
(function applyMainTheme() {
  const theme = localStorage.getItem('appTheme_v1') || 'purple';
  if (theme && theme !== 'purple') {
    document.documentElement.setAttribute('data-theme', theme);
  }
})();

// ── 초기화 ──
window.addEventListener('DOMContentLoaded', () => {
  const viewBtn = document.getElementById('viewToggleBtn');
  if (viewBtn) {
    viewBtn.innerHTML = viewMode === 'list' ? CARD_ICON_SVG : LIST_ICON_SVG;
    viewBtn.addEventListener('click', toggleViewMode);
  }
  loadData();
});

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}
