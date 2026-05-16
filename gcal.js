/* ============================================================
   gcal.js — Google Calendar API 연동
   ============================================================ */

'use strict';

const GCAL_BASE     = 'https://www.googleapis.com/calendar/v3';
const GCAL_SCOPE    = 'https://www.googleapis.com/auth/calendar';
const GCAL_FLAG_KEY = 'gcal_connected';
const GCAL_SS_KEY   = 'gcal_token_v1';   // sessionStorage 키 (탭 내 새로고침 유지)
const GCAL_TARGET   = '일정';            // 연동할 캘린더 이름

let _gcalToken       = null;
let _gcalTokenExpiry = 0;
let _gcalCalendarId  = null;

// ──────────────────────────────────────────────
// 토큰 관리
// ──────────────────────────────────────────────
function gcalTokenValid() {
  return !!_gcalToken && Date.now() < _gcalTokenExpiry - 60000;
}

function _gcalSetToken(token, expiry) {
  _gcalToken       = token;
  _gcalTokenExpiry = expiry || (Date.now() + 3500 * 1000);
  try {
    sessionStorage.setItem(GCAL_SS_KEY, JSON.stringify({ token: _gcalToken, expiry: _gcalTokenExpiry }));
  } catch (e) { /* private mode 등 */ }
}

function gcalClearToken() {
  _gcalToken       = null;
  _gcalTokenExpiry = 0;
  _gcalCalendarId  = null;
  localStorage.removeItem(GCAL_FLAG_KEY);
  try { sessionStorage.removeItem(GCAL_SS_KEY); } catch (e) {}
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
      _gcalToken       = stored.token;
      _gcalTokenExpiry = stored.expiry;
      return true;
    }
  } catch (e) {}
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

  const provider = new firebase.auth.GoogleAuthProvider();
  provider.addScope(GCAL_SCOPE);
  provider.setCustomParameters({ prompt: 'consent', login_hint: currentUser.email });

  // reauthenticateWithPopup: 이미 로그인된 사용자에게도 반드시 새 OAuth 동의화면을 보임
  let result;
  try {
    result = await currentUser.reauthenticateWithPopup(provider);
  } catch (reAuthErr) {
    // reauthenticate 실패 시 signInWithPopup으로 fallback
    result = await firebase.auth().signInWithPopup(provider);
  }

  const credential  = firebase.auth.GoogleAuthProvider.credentialFromResult(result);
  const accessToken = credential?.accessToken
    || result?._tokenResponse?.oauthAccessToken
    || result?.credential?.accessToken;

  if (!accessToken) {
    // 마지막 수단: client ID가 뒤늦게 로드됐을 수 있으니 GIS 재시도
    const retryToken = await _gcalConnectViaGIS().catch(() => null);
    if (retryToken) {
      _gcalSetToken(retryToken);
      localStorage.setItem(GCAL_FLAG_KEY, '1');
      return;
    }
    throw new Error('액세스 토큰을 받지 못했습니다.\nVercel 환경변수에 GOOGLE_OAUTH_CLIENT_ID를 추가하면 해결됩니다.');
  }

  _gcalSetToken(accessToken);
  localStorage.setItem(GCAL_FLAG_KEY, '1');
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
      scope:     GCAL_SCOPE,
      prompt:    'consent',
      callback:  (resp) => {
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

  const resp  = await _gcalFetch('GET', '/users/me/calendarList?maxResults=250');
  const match = (resp.items || []).find(c => c.summary === GCAL_TARGET);
  if (!match) {
    throw new Error(`구글 캘린더에 '${GCAL_TARGET}' 캘린더가 없습니다.\n구글 캘린더에서 '일정' 캘린더를 만들어주세요.`);
  }

  _gcalCalendarId = match.id;
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
    start:   { date: dateKey },
    end:     { date: _nextDay(dateKey) }
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
let _gcalImportTimer  = null;
let _gcalPollInterval = null;

async function _gcalFetchEventsForDate(dateKey) {
  const [y, m, d] = dateKey.split('-').map(Number);
  const dayStart  = new Date(y, m - 1, d, 0, 0, 0, 0);
  const dayEnd    = new Date(y, m - 1, d, 23, 59, 59, 999);
  const params = new URLSearchParams({
    timeMin:      dayStart.toISOString(),
    timeMax:      dayEnd.toISOString(),
    singleEvents: 'true',
    orderBy:      'startTime',
    maxResults:   '50'
  });
  const calId = await _getCalendarId();
  return _gcalFetch('GET', `/calendars/${encodeURIComponent(calId)}/events?${params}`);
}

function _syncedGcalIds() {
  return new Set(
    Object.values(state.schedule).flat().map(it => it.gcalEventId).filter(Boolean)
  );
}

async function gcalImportEvents(dateKey) {
  if (!gcalTokenValid()) return;
  try {
    const resp   = await _gcalFetchEventsForDate(dateKey);
    const synced = _syncedGcalIds();

    gcalEvents[dateKey] = (resp.items || [])
      .filter(ev => ev.status !== 'cancelled' && !synced.has(ev.id))
      .map(ev => {
        const allDay = !!ev.start?.date && !ev.start?.dateTime;
        let timeLabel = '';
        if (!allDay && ev.start?.dateTime) {
          const t = new Date(ev.start.dateTime);
          timeLabel = `${t.getHours().toString().padStart(2, '0')}:${t.getMinutes().toString().padStart(2, '0')}`;
        }
        const done = /^✅/.test(ev.summary || '');
        return {
          id:        ev.id,
          summary:   (ev.summary || '(제목 없음)').replace(/^✅\s*/, ''),
          done,
          allDay,
          timeLabel
        };
      });

    if (typeof renderDayTasks === 'function') renderDayTasks(dateKey);
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
  _gcalImportTimer = setTimeout(() => gcalImportEvents(dateKey(currentDay())), 300);
}

function gcalStartPolling() {
  if (_gcalPollInterval) return;
  _gcalPollInterval = setInterval(() => {
    if (gcalTokenValid()) gcalImportEvents(dateKey(currentDay()));
    else gcalStopPolling();
  }, 3 * 60 * 1000);
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
    summary: '✅ ' + text.replace(/^✅\s*/, ''),
    colorId: '2'
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
  const connected     = gcalTokenValid();
  const everConnected = isGcalConnected();
  const reconnectBtn  = document.getElementById('gcalReconnectBtn');
  if (reconnectBtn) reconnectBtn.hidden = !(everConnected && !connected);

  const dot           = document.getElementById('gcalStatusDot');
  const txt           = document.getElementById('gcalStatusText');
  const connectBtn    = document.getElementById('gcalConnectBtn');
  const syncBtn       = document.getElementById('gcalSyncBtn');
  const disconnectBtn = document.getElementById('gcalDisconnectBtn');
  if (!dot) return;

  if (connected) {
    dot.className        = 'gcal-dot gcal-dot--on';
    txt.textContent      = '연결됨';
    connectBtn.hidden    = true;
    syncBtn.hidden       = false;
    disconnectBtn.hidden = false;
  } else {
    dot.className        = 'gcal-dot gcal-dot--off';
    txt.textContent      = everConnected ? '재연결 필요' : '연결되지 않음';
    connectBtn.hidden    = false;
    syncBtn.hidden       = true;
    disconnectBtn.hidden = !everConnected;
  }
}
