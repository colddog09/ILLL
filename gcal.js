/* ============================================================
   gcal.js — Google Calendar API 연동
   ============================================================ */

'use strict';

const GCAL_BASE = 'https://www.googleapis.com/calendar/v3';
const GCAL_SCOPE = 'https://www.googleapis.com/auth/calendar';
const GCAL_FLAG_KEY = 'gcal_connected';
const GCAL_SS_KEY = 'gcal_token_v1';   // sessionStorage 키 (탭 내 새로고침 유지)
const GCAL_TARGET = '일정';            // 연동할 캘린더 이름

let _gcalToken = null;
let _gcalTokenExpiry = 0;
let _gcalCalendarId = null;
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
  localStorage.removeItem(GCAL_FLAG_KEY);
  localStorage.removeItem('gcal_token_shared');
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
// 연결 (OAuth 동의 팝업 — 최초 1회 또는 만료 시)
// ──────────────────────────────────────────────
async function gcalConnect() {
  if (!currentUser) throw new Error('로그인이 필요합니다.');

  // GIS를 우선 시도 (client ID가 있는 경우 가장 안정적)
  const gisToken = await _gcalConnectViaGIS().catch(() => null);
  if (gisToken) {
    _gcalSetToken(gisToken);
    localStorage.setItem(GCAL_FLAG_KEY, '1');
    return;
  }

  // GIS 재시도 (Firebase 없이 GIS만 사용)
  const retryToken = await _gcalConnectViaGIS().catch(() => null);
  if (retryToken) {
    _gcalSetToken(retryToken);
    localStorage.setItem(GCAL_FLAG_KEY, '1');
    return;
  }
  throw new Error('캘린더 연동에 실패했습니다.\nVercel 환경변수에 GOOGLE_OAUTH_CLIENT_ID를 추가해주세요.');
}

// 리소스가 준비될 때까지 대기
function _waitForResource(getter, timeout = 6000) {
  return new Promise(resolve => {
    const val = getter();
    if (val) return resolve(val);
    const start = Date.now();
    const t = setInterval(() => {
      const v = getter();
      if (v) { clearInterval(t); resolve(v); }
      else if (Date.now() - start > timeout) { clearInterval(t); resolve(null); }
    }, 250);
  });
}

// 팝업 없이 조용한 자동 재연결 (이전에 권한 허락한 경우만 성공)
async function gcalSilentConnect() {
  const clientId = await _waitForResource(() => window.__GCAL_CLIENT_ID__);
  if (!clientId) return false;
  const oauth2 = await _waitForResource(() => window.google?.accounts?.oauth2);
  if (!oauth2) return false;

  return new Promise(resolve => {
    try {
      const client = google.accounts.oauth2.initTokenClient({
        client_id:      clientId,
        scope:          GCAL_SCOPE,
        hint:           currentUser?.email || '',
        callback:       resp => {
          if (resp.error || !resp.access_token) { resolve(false); return; }
          _gcalSetToken(resp.access_token);
          localStorage.setItem(GCAL_FLAG_KEY, '1');
          resolve(true);
        },
        error_callback: () => resolve(false)
      });
      client.requestAccessToken({ prompt: '' }); // 무UI 재발급
    } catch (_) { resolve(false); }
  });
}

// GIS Token Client (Firebase fallback)
// googleClientId가 window.__GCAL_CLIENT_ID__에 주입된 경우에만 동작
function _gcalConnectViaGIS() {
  return new Promise((resolve, reject) => {
    const clientId = window.__GCAL_CLIENT_ID__;
    if (!clientId || typeof google === 'undefined' || !google.accounts?.oauth2) {
      return reject(new Error('GIS not available'));
    }
    const client = google.accounts.oauth2.initTokenClient({
      client_id: clientId,
      scope: GCAL_SCOPE,
      prompt: 'consent',
      callback: (resp) => {
        if (resp.error) return reject(new Error(resp.error));
        resolve(resp.access_token);
      }
    });
    client.requestAccessToken({ prompt: 'consent' });
  });
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
    gcalClearToken();
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

async function _gcalFetchEventsForDate(dateKey) {
  const [y, m, d] = dateKey.split('-').map(Number);
  const dayStart = new Date(y, m - 1, d, 0, 0, 0, 0);
  const dayEnd = new Date(y, m - 1, d, 23, 59, 59, 999);
  const params = new URLSearchParams({
    timeMin: dayStart.toISOString(),
    timeMax: dayEnd.toISOString(),
    singleEvents: 'true',
    orderBy: 'startTime',
    maxResults: '50'
  });
  const calId = await _getCalendarId();
  return _gcalFetch('GET', `/calendars/${encodeURIComponent(calId)}/events?${params}`);
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
      evs.push({ id: ev.id, summary: (ev.summary || '(제목 없음)').replace(/^✅\s*/, ''), done, allDay, timeLabel });
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
function _scheduleTokenRefresh() {
  clearTimeout(_gcalRefreshTimer);
  const remaining = _gcalTokenExpiry - Date.now() - 5 * 60 * 1000; // 만료 5분 전
  if (remaining <= 0) return;
  _gcalRefreshTimer = setTimeout(async () => {
    if (!isGcalConnected()) return;
    const ok = await gcalSilentConnect().catch(() => false);
    if (ok) {
      _scheduleTokenRefresh(); // 갱신 성공 → 다음 갱신 예약
      if (typeof updateGcalUI === 'function') updateGcalUI();
    } else {
      if (typeof updateGcalUI === 'function') updateGcalUI(); // 재연결 필요 표시
    }
  }, remaining);
}

function gcalStartPolling() {
  if (_gcalPollInterval) return;
  _scheduleTokenRefresh(); // 토큰 자동 갱신 예약
  _gcalPollInterval = setInterval(() => {
    if (!gcalTokenValid()) { gcalStopPolling(); return; }
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

  const dot = document.getElementById('gcalStatusDot');
  const txt = document.getElementById('gcalStatusText');
  const connectBtn = document.getElementById('gcalConnectBtn');
  const syncBtn = document.getElementById('gcalSyncBtn');
  const disconnectBtn = document.getElementById('gcalDisconnectBtn');
  if (!dot) return;

  if (connected) {
    dot.className = 'gcal-dot gcal-dot--on';
    txt.textContent = '연결됨';
    connectBtn.hidden = true;
    syncBtn.hidden = false;
    disconnectBtn.hidden = false;
  } else {
    dot.className = 'gcal-dot gcal-dot--off';
    txt.textContent = everConnected ? '재연결 필요' : '연결되지 않음';
    connectBtn.hidden = false;
    syncBtn.hidden = true;
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
    const calId = await _getCalendarId();
    const resp = await _gcalFetch('GET', `/calendars/${encodeURIComponent(calId)}/events?${params}`);
    const byDate = {};

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
        id: ev.id,
        summary: (ev.summary || '(제목 없음)').replace(/^✅\s*/, ''),
        done, allDay, timeLabel
      });
    }

    Object.assign(gcalEvents, byDate);
    if (typeof renderGcalSidePanel === 'function') renderGcalSidePanel();
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
