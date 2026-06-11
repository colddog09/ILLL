/* ============================================================
   gcal/gcal.js — Google Calendar API 연동
   ============================================================ */

'use strict';

// ──────────────────────────────────────────────
// 구글 캘린더 뷰 모달 DOM 동적 주입
// ──────────────────────────────────────────────
(function injectGcalModal() {
  if (document.getElementById('gcalViewModal')) return;
  const modal = document.createElement('div');
  modal.id = 'gcalViewModal';
  modal.className = 'modal-overlay';
  modal.hidden = true;
  modal.innerHTML =
    '<div class="modal-box modal-box--wide">' +
      '<div class="modal-header">' +
        '<h2>📅 구글 캘린더 — 일정</h2>' +
        '<button id="gcalViewCloseBtn" class="modal-close">&times;</button>' +
      '</div>' +
      '<div class="modal-body" style="padding:0 16px 20px;">' +
        '<div id="gcalCalGrid" class="gcal-cal-grid"></div>' +
      '</div>' +
    '</div>';
  document.body.appendChild(modal);
})();

const GCAL_BASE = 'https://www.googleapis.com/calendar/v3';
const GCAL_SCOPE = 'https://www.googleapis.com/auth/calendar';
const GCAL_FLAG_KEY = 'gcal_connected';
const GCAL_SS_KEY = 'gcal_token_v1';        // sessionStorage 키
const GCAL_TARGET = '일정';                  // 쓰기 전용 캘린더 이름
const GCAL_SELECTED_KEY = 'gcal_selected_cals'; // localStorage: 선택된 캘린더 ID 배열

let _gcalToken = null;
let _gcalTokenExpiry = 0;
let _gcalCalendarId = null;   // 쓰기 전용 ('일정' 캘린더)
let _gcalAllCalendars = null; // 전체 캘린더 목록 캐시
let _gcalRefreshTimer = null;

// ──────────────────────────────────────────────
// 토큰 관리
// ──────────────────────────────────────────────
function gcalTokenValid() {
  return !!_gcalToken && Date.now() < _gcalTokenExpiry - 60000;
}

function _gcalSetToken(token, expiry) {
  _gcalToken = token;
  _gcalTokenExpiry = expiry || (Date.now() + 3500 * 1000);
  try {
    const stored = JSON.stringify({ token: _gcalToken, expiry: _gcalTokenExpiry });
    sessionStorage.setItem(GCAL_SS_KEY, stored);
    localStorage.setItem('gcal_token_shared', stored); // 수행평가 사이트 공유용
  } catch (e) { /* private mode 등 */ }
  _scheduleTokenRefresh(); // 토큰 갱신 자동 예약
}

function gcalClearToken() {
  _gcalToken = null;
  _gcalTokenExpiry = 0;
  _gcalCalendarId = null;
  _gcalAllCalendars = null;
  localStorage.removeItem(GCAL_FLAG_KEY);
  localStorage.removeItem('gcal_token_shared');
  localStorage.removeItem(GCAL_SELECTED_KEY);
  try { sessionStorage.removeItem(GCAL_SS_KEY); } catch (e) { }
}

function isGcalConnected() {
  return localStorage.getItem(GCAL_FLAG_KEY) === '1';
}

// 페이지 로드 시 sessionStorage에서 토큰 복원 (동기, 팝업 없음)
function gcalLoadStoredToken() {
  if (!isGcalConnected()) return false;
  try {
    const stored = JSON.parse(sessionStorage.getItem(GCAL_SS_KEY));
    if (stored?.token && stored.expiry > Date.now() + 60000) {
      _gcalToken = stored.token;
      _gcalTokenExpiry = stored.expiry;
      return true;
    }
  } catch (e) { }
  return false;
}

// ──────────────────────────────────────────────
// 연결 (리다이렉트 기반 OAuth — 모바일/PC 모두 호환)
// ──────────────────────────────────────────────
async function gcalConnect() {
  if (!currentUser) throw new Error('로그인이 필요합니다.');

  // 1순위: 서버 refresh token으로 무팝업 즉시 연동
  const serverOk = await gcalRefreshFromServer().catch(() => false);
  if (serverOk) return;

  // 2순위: 리다이렉트 기반 OAuth (팝업 없음 — 모바일/Safari 호환)
  if (!supabaseClient) throw new Error('서비스 준비 중입니다.');
  const { data: { session } } = await supabaseClient.auth.getSession();
  if (!session?.access_token) throw new Error('로그인이 필요합니다.');

  // 현재 페이지를 떠나 Google OAuth 진행
  window.location.href = `/api/gcal-auth?jwt=${encodeURIComponent(session.access_token)}`;
  // (이 아래는 실행되지 않음 — 페이지 이동)
}

// 서버에서 Google access token 갱신 (popup 없음, refresh token 기반)
async function gcalRefreshFromServer() {
  if (!supabaseClient) throw new Error('supabase not ready');
  const { data: { session } } = await supabaseClient.auth.getSession();
  if (!session?.access_token) throw new Error('not logged in');

  const resp = await fetch('/api/gcal-token', {
    headers: { Authorization: `Bearer ${session.access_token}` }
  });

  if (resp.status === 404) throw new Error('no_refresh_token');
  if (resp.status === 401) { // refresh token 만료 → 재로그인 필요
    localStorage.removeItem(GCAL_FLAG_KEY);
    throw new Error('refresh_token_expired');
  }
  if (!resp.ok) throw new Error('server_error');

  const { access_token, expires_in } = await resp.json();
  _gcalSetToken(access_token, Date.now() + expires_in * 1000);
  localStorage.setItem(GCAL_FLAG_KEY, '1');
  return true;
}

// 팝업 없이 조용한 자동 재연결 (서버 refresh token 기반)
async function gcalSilentConnect() {
  try {
    await gcalRefreshFromServer();
    return true;
  } catch (e) {
    return false; // refresh_token 없거나 만료 — 수동 재연결 필요
  }
}

// ──────────────────────────────────────────────
// API 요청
// ──────────────────────────────────────────────
async function _gcalFetch(method, path, body) {
  if (!gcalTokenValid()) throw new Error('캘린더 재연결이 필요합니다.');

  const options = {
    method,
    headers: { Authorization: `Bearer ${_gcalToken}` }
  };
  if (body !== undefined) {
    options.headers['Content-Type'] = 'application/json';
    options.body = JSON.stringify(body);
  }

  const res = await fetch(`${GCAL_BASE}${path}`, options);

  if (res.status === 401) {
    // 1회 자동 재갱신 시도 후 재요청
    const refreshed = await gcalRefreshFromServer().catch(() => false);
    if (refreshed) {
      const retry = await fetch(`${GCAL_BASE}${path}`, {
        ...options,
        headers: { ...options.headers, Authorization: `Bearer ${_gcalToken}` }
      });
      if (retry.ok) return retry.status === 204 ? null : retry.json();
    }
    gcalClearToken();
    if (typeof updateGcalUI === 'function') updateGcalUI();
    throw new Error('캘린더 인증이 만료되었습니다. 재연결 버튼을 눌러주세요.');
  }
  if (res.status === 204 || (res.status === 404 && method === 'DELETE')) return null;
  if (!res.ok) {
    const errText = await res.text().catch(() => '');
    throw new Error(`Calendar API 오류 (${res.status}): ${errText.slice(0, 120)}`);
  }
  return res.json();
}

// ──────────────────────────────────────────────
// "일정" 캘린더 ID 조회 (세션 내 캐시)
// ──────────────────────────────────────────────
async function _getCalendarId() {
  if (_gcalCalendarId) return _gcalCalendarId;

  const resp = await _gcalFetch('GET', '/users/me/calendarList?maxResults=250');
  const match = (resp.items || []).find(c => c.summary === GCAL_TARGET);

  if (match) {
    _gcalCalendarId = match.id;
    return _gcalCalendarId;
  }

  // '일정' 캘린더가 없으면 자동 생성
  const created = await _gcalFetch('POST', '/calendars', { summary: GCAL_TARGET });
  _gcalCalendarId = created.id;
  return _gcalCalendarId;
}

// ──────────────────────────────────────────────
// 전체 캘린더 목록 관리
// ──────────────────────────────────────────────

// 모든 캘린더 목록 fetch (세션 내 캐시)
async function _fetchAllCalendars() {
  if (_gcalAllCalendars) return _gcalAllCalendars;
  const resp = await _gcalFetch('GET', '/users/me/calendarList?maxResults=250');
  _gcalAllCalendars = (resp.items || [])
    .filter(c => c.accessRole !== 'freeBusyReader')
    .map(c => ({
      id:              c.id,
      summary:         c.summary || c.id,
      backgroundColor: c.backgroundColor || '#4285f4',
      foregroundColor: c.foregroundColor || '#ffffff',
      primary:         c.primary || false
    }));
  return _gcalAllCalendars;
}

// 선택된 캘린더 ID 목록 (null = 전체 선택)
function _getSelectedCalendarIds() {
  try {
    const saved = localStorage.getItem(GCAL_SELECTED_KEY);
    return saved ? JSON.parse(saved) : null;
  } catch { return null; }
}

function _isCalendarSelected(id) {
  const ids = _getSelectedCalendarIds();
  return ids ? ids.includes(id) : true;
}

// 캘린더 선택/해제 저장
function gcalSetCalendarSelected(id, selected) {
  if (!_gcalAllCalendars) return;
  const allIds = _gcalAllCalendars.map(c => c.id);
  let ids = _getSelectedCalendarIds() || [...allIds];
  if (selected) {
    if (!ids.includes(id)) ids.push(id);
  } else {
    ids = ids.filter(sid => sid !== id);
  }
  if (ids.length === allIds.length) {
    localStorage.removeItem(GCAL_SELECTED_KEY); // 전체 선택 = 저장 안 함
  } else {
    localStorage.setItem(GCAL_SELECTED_KEY, JSON.stringify(ids));
  }
}

// 설정 모달의 캘린더 필터 UI 렌더
async function renderGcalCalendarSettings() {
  const container = document.getElementById('gcalCalendarFilter');
  if (!container) return;

  if (!gcalTokenValid()) {
    container.innerHTML = '<p class="gcal-filter__hint">캘린더 연결 후 설정 가능합니다.</p>';
    return;
  }

  container.innerHTML = '<p class="gcal-filter__hint">캘린더 목록 불러오는 중...</p>';

  try {
    const calendars = await _fetchAllCalendars();
    container.innerHTML = '';

    // 전체 선택 / 전체 해제 버튼
    const allRow = document.createElement('div');
    allRow.className = 'gcal-filter__all-row';
    allRow.innerHTML = `
      <button class="gcal-filter__all-btn" id="gcalSelectAll">전체 선택</button>
      <button class="gcal-filter__all-btn" id="gcalDeselectAll">전체 해제</button>
    `;
    container.appendChild(allRow);

    calendars.forEach(cal => {
      const isSelected = _isCalendarSelected(cal.id);
      const row = document.createElement('label');
      row.className = 'gcal-filter__row';
      row.innerHTML = `
        <input type="checkbox" class="gcal-filter__check" data-cal-id="${cal.id}" ${isSelected ? 'checked' : ''}>
        <span class="gcal-filter__color" style="background:${escHtml(cal.backgroundColor)}"></span>
        <span class="gcal-filter__name">${escHtml(cal.summary)}${cal.primary ? ' <span class="gcal-filter__primary">기본</span>' : ''}</span>
      `;
      container.appendChild(row);
    });

    // 체크박스 변경 → 즉시 저장 + 새로고침
    container.querySelectorAll('.gcal-filter__check').forEach(cb => {
      cb.addEventListener('change', () => {
        gcalSetCalendarSelected(cb.dataset.calId, cb.checked);
        gcalImportCurrentDate();
      });
    });

    // 전체 선택
    container.querySelector('#gcalSelectAll')?.addEventListener('click', () => {
      localStorage.removeItem(GCAL_SELECTED_KEY);
      container.querySelectorAll('.gcal-filter__check').forEach(cb => { cb.checked = true; });
      gcalImportCurrentDate();
    });

    // 전체 해제
    container.querySelector('#gcalDeselectAll')?.addEventListener('click', () => {
      localStorage.setItem(GCAL_SELECTED_KEY, '[]');
      container.querySelectorAll('.gcal-filter__check').forEach(cb => { cb.checked = false; });
      gcalEvents = {};
      if (typeof renderGcalSidePanel === 'function') renderGcalSidePanel();
      if (typeof renderGcalSheet === 'function') renderGcalSheet();
    });

  } catch (err) {
    container.innerHTML = `<p class="gcal-filter__hint" style="color:var(--danger)">불러오기 실패: ${escHtml(err.message)}</p>`;
  }
}

// ──────────────────────────────────────────────
// 날짜 유틸
// ──────────────────────────────────────────────
function _nextDay(key) {
  const [y, m, d] = key.split('-').map(Number);
  const nd = new Date(y, m - 1, d + 1);
  return `${nd.getFullYear()}-${String(nd.getMonth() + 1).padStart(2, '0')}-${String(nd.getDate()).padStart(2, '0')}`;
}

// ──────────────────────────────────────────────
// 이벤트 생성 / 삭제
// ──────────────────────────────────────────────
async function gcalCreateEvent(text, dateKey) {
  const calId = await _getCalendarId();
  return _gcalFetch('POST', `/calendars/${encodeURIComponent(calId)}/events`, {
    summary: text,
    start: { date: dateKey },
    end: { date: _nextDay(dateKey) }
  });
}

async function gcalDeleteEvent(eventId) {
  const calId = await _getCalendarId();
  return _gcalFetch('DELETE', `/calendars/${encodeURIComponent(calId)}/events/${eventId}`);
}

// ──────────────────────────────────────────────
// 전체 동기화 (미동기화 항목만)
// ──────────────────────────────────────────────
async function gcalSyncAll() {
  if (!gcalTokenValid()) throw new Error('캘린더 재연결이 필요합니다.');

  let created = 0, failed = 0;

  for (const [dk, items] of Object.entries(state.schedule)) {
    for (const item of items) {
      if (item.gcalEventId) continue;
      try {
        const event = await gcalCreateEvent(item.text, dk);
        item.gcalEventId = event.id;
        created++;
      } catch (err) {
        const fatal = ['재연결', '만료', '찾을 수', 'API 오류'].some(s => err.message?.includes(s));
        if (fatal) throw err;
        console.error('gcal sync item error:', item.text, err.message);
        failed++;
      }
    }
  }

  if (created > 0) saveState();
  return { created, failed };
}

// ──────────────────────────────────────────────
// 캘린더 → 앱 가져오기
// ──────────────────────────────────────────────
let _gcalImportTimer = null;
let _gcalPollInterval = null;

// 단일 날짜 이벤트 fetch — 전체 선택 캘린더에서 병렬
async function _gcalFetchEventsForDate(dk) {
  const [y, m, d] = dk.split('-').map(Number);
  const params = new URLSearchParams({
    timeMin:      new Date(y, m - 1, d, 0, 0, 0, 0).toISOString(),
    timeMax:      new Date(y, m - 1, d, 23, 59, 59, 999).toISOString(),
    singleEvents: 'true',
    orderBy:      'startTime',
    maxResults:   '50'
  });
  const calendars = await _fetchAllCalendars();
  const evs = [];
  await Promise.all(
    calendars.filter(cal => _isCalendarSelected(cal.id)).map(async cal => {
      try {
        const resp = await _gcalFetch('GET', `/calendars/${encodeURIComponent(cal.id)}/events?${params}`);
        for (const ev of (resp.items || [])) {
          if (ev.status === 'cancelled') continue;
          evs.push({ ...ev, _calColor: cal.backgroundColor });
        }
      } catch (_) {}
    })
  );
  return { items: evs };
}

// pool + schedule 에 있는 모든 gcal 이벤트 ID
function _allGcalIds() {
  const ids = new Set();
  (state.pool || []).forEach(t => { if (t.gcalEventId) ids.add(t.gcalEventId); });
  Object.values(state.schedule || {}).flat().forEach(it => { if (it.gcalEventId) ids.add(it.gcalEventId); });
  return ids;
}

function _syncedGcalIds() {
  return new Set(
    Object.values(state.schedule).flat().map(it => it.gcalEventId).filter(Boolean)
  );
}

async function gcalImportEvents(dk) {
  if (!gcalTokenValid()) return;
  try {
    const resp = await _gcalFetchEventsForDate(dk);
    const evs  = [];

    for (const ev of (resp.items || [])) {
      if (ev.status === 'cancelled') continue;
      const done = /^✅/.test(ev.summary || '');
      const allDay = !!ev.start?.date && !ev.start?.dateTime;
      let timeLabel = '';
      if (!allDay && ev.start?.dateTime) {
        const t = new Date(ev.start.dateTime);
        timeLabel = `${String(t.getHours()).padStart(2, '0')}:${String(t.getMinutes()).padStart(2, '0')}`;
      }
      evs.push({ id: ev.id, summary: (ev.summary || '(제목 없음)').replace(/^✅\s*/, ''), done, allDay, timeLabel, calendarColor: ev._calColor || null });
    }

    gcalEvents[dk] = evs;
    if (typeof renderGcalSidePanel === 'function') renderGcalSidePanel();
  } catch (err) {
    if (err.message?.includes('재연결') || err.message?.includes('만료')) {
      updateGcalUI();
    } else if (!err.message?.includes('찾을 수')) {
      console.warn('gcal import error:', err.message);
    }
  }
}

function gcalImportCurrentDate() {
  if (!gcalTokenValid()) return;
  clearTimeout(_gcalImportTimer);
  _gcalImportTimer = setTimeout(() => {
    const today = new Date();
    const endDate = new Date();
    endDate.setDate(today.getDate() + 100);
    gcalFetchRangeEvents(dateKey(today), dateKey(endDate));
  }, 300);
}

// 토큰 만료 5분 전 자동 재발급 예약
// 서버 refresh 우선 → GIS silent 폴백
function _scheduleTokenRefresh() {
  clearTimeout(_gcalRefreshTimer);
  if (!isGcalConnected()) return;
  const remaining = _gcalTokenExpiry - Date.now() - 5 * 60 * 1000; // 만료 5분 전
  if (remaining <= 0) {
    // 이미 만료됐거나 곧 만료 → 즉시 재갱신 시도
    gcalRefreshFromServer().catch(() => false).then(ok => {
      if (typeof updateGcalUI === 'function') updateGcalUI();
      if (ok) _scheduleTokenRefresh();
    });
    return;
  }
  _gcalRefreshTimer = setTimeout(async () => {
    if (!isGcalConnected()) return;
    const ok = await gcalRefreshFromServer().catch(() => false);
    if (ok) {
      _scheduleTokenRefresh();
    }
    if (typeof updateGcalUI === 'function') updateGcalUI();
  }, Math.min(remaining, 2147483647)); // setTimeout 최대값 초과 방지
}

// 페이지 foreground 복귀 / 네트워크 복구 시 토큰 재확인
function _gcalCheckOnResume() {
  if (!isGcalConnected()) return;
  if (!gcalTokenValid()) {
    gcalRefreshFromServer().catch(() => false).then(ok => {
      if (typeof updateGcalUI === 'function') updateGcalUI();
      if (ok) {
        _scheduleTokenRefresh();
        if (typeof gcalImportCurrentDate === 'function') gcalImportCurrentDate();
      }
    });
  }
}

document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') _gcalCheckOnResume();
});
window.addEventListener('online', _gcalCheckOnResume);

function gcalStartPolling() {
  if (_gcalPollInterval) return;
  _scheduleTokenRefresh(); // 토큰 자동 갱신 예약
  _gcalPollInterval = setInterval(async () => {
    if (!gcalTokenValid()) {
      const ok = await gcalRefreshFromServer().catch(() => false);
      if (!ok) { gcalStopPolling(); if (typeof updateGcalUI === 'function') updateGcalUI(); return; }
    }
    const today = new Date();
    const endDate = new Date();
    endDate.setDate(today.getDate() + 100);
    gcalFetchRangeEvents(dateKey(today), dateKey(endDate));
  }, 60 * 1000);
}

function gcalStopPolling() {
  if (_gcalPollInterval) { clearInterval(_gcalPollInterval); _gcalPollInterval = null; }
}

// ──────────────────────────────────────────────
// 완료 상태 캘린더에 반영
// ──────────────────────────────────────────────
async function gcalMarkEventDone(eventId, text) {
  const calId = await _getCalendarId();
  return _gcalFetch('PATCH', `/calendars/${encodeURIComponent(calId)}/events/${eventId}`, {
    summary: '✅ ' + text.replace(/^✅\s*/, '')
  });
}

async function gcalMarkEventUndone(eventId, text) {
  const calId = await _getCalendarId();
  return _gcalFetch('PATCH', `/calendars/${encodeURIComponent(calId)}/events/${eventId}`, {
    summary: text.replace(/^✅\s*/, '')
  });
}

// ──────────────────────────────────────────────
// UI 업데이트
// ──────────────────────────────────────────────
function updateGcalUI() {
  const connected = gcalTokenValid();
  const everConnected = isGcalConnected();
  const reconnectBtn = document.getElementById('gcalReconnectBtn');
  if (reconnectBtn) reconnectBtn.hidden = !(everConnected && !connected);

  const viewBtn = document.getElementById('gcalViewBtn');
  if (viewBtn) viewBtn.hidden = !connected;

  const sheetBtn = document.getElementById('gcalSheetBtn');
  if (sheetBtn) sheetBtn.hidden = !connected;

  const dot = document.getElementById('gcalStatusDot');
  const txt = document.getElementById('gcalStatusText');
  const connectBtn = document.getElementById('gcalConnectBtn');
  const disconnectBtn = document.getElementById('gcalDisconnectBtn');
  if (!dot) return;

  if (connected) {
    dot.className = 'gcal-dot gcal-dot--on';
    txt.textContent = '연결됨';
    connectBtn.hidden = true;
    disconnectBtn.hidden = false;
    // 캘린더 필터 UI 갱신
    renderGcalCalendarSettings();
  } else {
    dot.className = 'gcal-dot gcal-dot--off';
    txt.textContent = everConnected ? '재연결 필요' : '연결되지 않음';
    connectBtn.hidden = false;
    disconnectBtn.hidden = !everConnected;
  }
}

// ──────────────────────────────────────────────
// 범위 이벤트 fetch (달력 뷰용)
// ──────────────────────────────────────────────
async function gcalFetchRangeEvents(startKey, endKey) {
  if (!gcalTokenValid()) return {};
  try {
    const [sy, sm, sd] = startKey.split('-').map(Number);
    const [ey, em, ed] = endKey.split('-').map(Number);
    const timeMin = new Date(sy, sm - 1, sd, 0, 0, 0, 0).toISOString();
    const timeMax = new Date(ey, em - 1, ed, 23, 59, 59, 999).toISOString();
    const params = new URLSearchParams({
      timeMin, timeMax, singleEvents: 'true', orderBy: 'startTime', maxResults: '250'
    });
    // 전체 캘린더에서 선택된 것만 병렬 fetch
    const calendars = await _fetchAllCalendars();
    const byDate = {};

    await Promise.all(
      calendars.filter(cal => _isCalendarSelected(cal.id)).map(async cal => {
        try {
          const resp = await _gcalFetch('GET', `/calendars/${encodeURIComponent(cal.id)}/events?${params}`);
          for (const ev of (resp.items || [])) {
            if (ev.status === 'cancelled') continue;
            const dk = ev.start?.date || ev.start?.dateTime?.slice(0, 10);
            if (!dk) continue;
            if (!byDate[dk]) byDate[dk] = [];
            const allDay = !!ev.start?.date && !ev.start?.dateTime;
            let timeLabel = '';
            if (!allDay && ev.start?.dateTime) {
              const t = new Date(ev.start.dateTime);
              timeLabel = `${String(t.getHours()).padStart(2, '0')}:${String(t.getMinutes()).padStart(2, '0')}`;
            }
            const done = /^✅/.test(ev.summary || '');
            byDate[dk].push({
              id:            ev.id,
              summary:       (ev.summary || '(제목 없음)').replace(/^✅\s*/, ''),
              done, allDay, timeLabel,
              calendarColor: cal.backgroundColor
            });
          }
        } catch (err) {
          console.warn(`gcal fetch error (${cal.summary}):`, err.message);
        }
      })
    );

    // 날짜별 시간 순 정렬
    for (const dk of Object.keys(byDate)) {
      byDate[dk].sort((a, b) => {
        if (!a.timeLabel && !b.timeLabel) return 0;
        if (!a.timeLabel) return 1;
        if (!b.timeLabel) return -1;
        return a.timeLabel.localeCompare(b.timeLabel);
      });
    }

    Object.assign(gcalEvents, byDate);
    if (typeof renderGcalSidePanel === 'function') renderGcalSidePanel();
    if (typeof renderGcalSheet === 'function') renderGcalSheet();
    return byDate;
  } catch (err) {
    console.warn('gcal range fetch error:', err.message);
    return {};
  }
}

// ──────────────────────────────────────────────
// 달력 뷰 렌더
// ──────────────────────────────────────────────
function renderGcalCalendar() {
  const grid = document.getElementById('gcalCalGrid');
  if (!grid) return;

  if (!gcalTokenValid()) {
    grid.innerHTML = '<p style="text-align:center;color:var(--text-sub);padding:24px;">캘린더 연결이 필요합니다.</p>';
    return;
  }

  grid.innerHTML = '<p style="text-align:center;color:var(--text-sub);padding:24px;">불러오는 중...</p>';

  const now = new Date();
  now.setHours(0, 0, 0, 0);
  const todayStr = dateKey(now);

  // 시작: (오늘 - 7일)이 포함된 주의 월요일
  const start = new Date(now);
  start.setDate(now.getDate() - 7);
  const sdow = start.getDay();
  start.setDate(start.getDate() - (sdow === 0 ? 6 : sdow - 1));

  // 끝: (오늘 + 14일)이 포함된 주의 일요일
  const end = new Date(now);
  end.setDate(now.getDate() + 14);
  const edow = end.getDay();
  end.setDate(end.getDate() + (edow === 0 ? 0 : 7 - edow));

  const startKey = dateKey(start);
  const endKey = dateKey(end);

  gcalFetchRangeEvents(startKey, endKey).then(() => {
    grid.innerHTML = '';

    const DAYS_HEADER = ['월', '화', '수', '목', '금', '토', '일'];
    const headerRow = document.createElement('div');
    headerRow.className = 'gcal-cal-header';
    DAYS_HEADER.forEach((d, i) => {
      const cell = document.createElement('div');
      cell.className = 'gcal-cal-header-cell';
      if (i === 5) cell.style.color = '#2563eb';
      if (i === 6) cell.style.color = '#dc2626';
      cell.textContent = d;
      headerRow.appendChild(cell);
    });
    grid.appendChild(headerRow);

    const cur = new Date(start);
    while (cur <= end) {
      const weekEl = document.createElement('div');
      weekEl.className = 'gcal-cal-week';

      for (let i = 0; i < 7; i++) {
        const dk = dateKey(cur);
        const dow = cur.getDay(); // 0=일, 6=토
        const cell = document.createElement('div');
        cell.className = 'gcal-cal-cell'
          + (dk === todayStr ? ' gcal-cal-cell--today' : '')
          + (cur < now ? ' gcal-cal-cell--past' : '');

        const dateEl = document.createElement('span');
        dateEl.className = 'gcal-cal-date';
        if (dow === 0) dateEl.style.color = '#dc2626';
        if (dow === 6) dateEl.style.color = '#2563eb';
        dateEl.textContent = cur.getDate();
        cell.appendChild(dateEl);

        const evs = gcalEvents[dk] || [];
        evs.forEach(ev => {
          const chip = document.createElement('div');
          chip.className = 'gcal-cal-event' + (ev.done ? ' done' : '');
          chip.title = ev.summary;
          chip.dataset.gcalId = ev.id;
          chip.dataset.dateKey = dk;
          chip.textContent = (ev.timeLabel ? ev.timeLabel + ' ' : '') + ev.summary;
          cell.appendChild(chip);
        });

        weekEl.appendChild(cell);
        cur.setDate(cur.getDate() + 1);
      }

      grid.appendChild(weekEl);
    }
  }).catch(() => {
    grid.innerHTML = '<p style="text-align:center;color:var(--danger);padding:24px;">불러오기 실패</p>';
  });
}
