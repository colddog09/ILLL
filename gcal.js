/* ============================================================
   gcal.js — Google Calendar API 연동
   ============================================================ */

'use strict';

const GCAL_BASE = 'https://www.googleapis.com/calendar/v3';
const GCAL_SCOPE = 'https://www.googleapis.com/auth/calendar';
const GCAL_FLAG_KEY = 'gcal_connected';

let _gcalToken = null;
let _gcalTokenExpiry = 0;

// ──────────────────────────────────────────────
// 토큰 관리
// ──────────────────────────────────────────────
function gcalTokenValid() {
  return !!_gcalToken && Date.now() < _gcalTokenExpiry - 60000;
}

function _gcalSetToken(token) {
  _gcalToken = token;
  _gcalTokenExpiry = Date.now() + 3500 * 1000; // ~58분
}

function gcalClearToken() {
  _gcalToken = null;
  _gcalTokenExpiry = 0;
  localStorage.removeItem(GCAL_FLAG_KEY);
}

function isGcalConnected() {
  return localStorage.getItem(GCAL_FLAG_KEY) === '1';
}

// ──────────────────────────────────────────────
// 연결 (OAuth 동의 팝업)
// ──────────────────────────────────────────────
async function gcalConnect() {
  if (!currentUser) throw new Error('로그인이 필요합니다.');

  const provider = new firebase.auth.GoogleAuthProvider();
  provider.addScope(GCAL_SCOPE);
  provider.setCustomParameters({
    prompt: 'consent',
    login_hint: currentUser.email
  });

  const result = await firebase.auth().signInWithPopup(provider);
  const credential = firebase.auth.GoogleAuthProvider.credentialFromResult(result);
  if (!credential?.accessToken) throw new Error('액세스 토큰을 받지 못했습니다.');

  _gcalSetToken(credential.accessToken);
  localStorage.setItem(GCAL_FLAG_KEY, '1');
}

// 페이지 로드 시 저장된 연결 자동 복원 (silent OAuth — 사용자 개입 없음)
async function gcalTryRestore() {
  if (!isGcalConnected() || !currentUser) return false;
  try {
    const provider = new firebase.auth.GoogleAuthProvider();
    provider.addScope(GCAL_SCOPE);
    // prompt:'none' → Google이 이미 로그인·동의된 경우 팝업을 즉시 닫음
    provider.setCustomParameters({ prompt: 'none', login_hint: currentUser.email });
    const result = await firebase.auth().signInWithPopup(provider);
    const credential = firebase.auth.GoogleAuthProvider.credentialFromResult(result);
    if (credential?.accessToken) {
      _gcalSetToken(credential.accessToken);
      return true;
    }
  } catch (err) {
    // 팝업 차단·취소·ITP 등 → 조용히 실패, UI에서 재연결 안내
    const ignored = new Set(['auth/cancelled-popup-request','auth/popup-closed-by-user',
      'auth/popup-blocked','auth/operation-not-supported-in-this-environment']);
    if (!ignored.has(err?.code)) console.warn('gcal restore:', err?.code, err?.message);
  }
  return false;
}

// ──────────────────────────────────────────────
// API 요청
// ──────────────────────────────────────────────
async function _gcalFetch(method, path, body) {
  if (!gcalTokenValid()) throw new Error('캘린더 재연결이 필요합니다.');

  const res = await fetch(`${GCAL_BASE}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${_gcalToken}`,
      'Content-Type': 'application/json'
    },
    body: body ? JSON.stringify(body) : undefined
  });

  if (res.status === 401) {
    gcalClearToken();
    throw new Error('캘린더 인증이 만료되었습니다. 다시 연결해주세요.');
  }
  if (res.status === 404 && method === 'DELETE') return null; // 이미 삭제됨
  if (!res.ok) {
    const errText = await res.text().catch(() => '');
    throw new Error(`Calendar API 오류 (${res.status}): ${errText.slice(0, 100)}`);
  }
  return method === 'DELETE' ? null : res.json();
}

// ──────────────────────────────────────────────
// "일정" 캘린더 ID 조회 (세션 내 캐시)
// ──────────────────────────────────────────────
const GCAL_TARGET_NAME = '일정';
let _gcalCalendarId = null; // 세션 내 캐시

async function _getCalendarId() {
  if (_gcalCalendarId) return _gcalCalendarId;

  const resp = await _gcalFetch('GET', '/users/me/calendarList?maxResults=250');
  const match = (resp.items || []).find(c => c.summary === GCAL_TARGET_NAME);
  if (!match) throw new Error(`'${GCAL_TARGET_NAME}' 캘린더를 찾을 수 없습니다.\n구글 캘린더에 '일정' 캘린더가 있는지 확인해주세요.`);

  _gcalCalendarId = match.id;
  return _gcalCalendarId;
}

// 토큰 초기화 시 캐시도 함께 지움
const _origGcalClearToken = gcalClearToken;
gcalClearToken = function() {
  _gcalCalendarId = null;
  _origGcalClearToken();
};

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
      if (item.gcalEventId) continue; // 이미 동기화됨
      try {
        const event = await gcalCreateEvent(item.text, dk);
        item.gcalEventId = event.id;
        created++;
      } catch (err) {
        console.error('gcal sync error:', item.text, err);
        if (err.message.includes('만료') || err.message.includes('재연결')) throw err;
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
  const dayEnd   = new Date(y, m - 1, d, 23, 59, 59, 999);
  const params = new URLSearchParams({
    timeMin:       dayStart.toISOString(),
    timeMax:       dayEnd.toISOString(),
    singleEvents:  'true',
    orderBy:       'startTime',
    maxResults:    '50'
  });
  const calId = await _getCalendarId();
  return _gcalFetch('GET', `/calendars/${encodeURIComponent(calId)}/events?${params}`);
}

// 앱에서 이미 동기화된 Calendar 이벤트 ID 목록
function _syncedGcalIds() {
  return new Set(
    Object.values(state.schedule).flat()
      .map(it => it.gcalEventId).filter(Boolean)
  );
}

// 특정 날짜의 캘린더 이벤트를 가져와 gcalEvents에 저장 후 재렌더
async function gcalImportEvents(dateKey) {
  if (!gcalTokenValid()) return;
  try {
    const resp = await _gcalFetchEventsForDate(dateKey);
    const synced = _syncedGcalIds();

    gcalEvents[dateKey] = (resp.items || [])
      .filter(ev => ev.status !== 'cancelled' && !synced.has(ev.id))
      .map(ev => {
        const allDay = !!ev.start?.date && !ev.start?.dateTime;
        let timeLabel = '';
        if (!allDay && ev.start?.dateTime) {
          const t = new Date(ev.start.dateTime);
          timeLabel = t.getHours().toString().padStart(2, '0') + ':' +
                      t.getMinutes().toString().padStart(2, '0');
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
    } else if (err.message?.includes('찾을 수 없습니다')) {
      console.warn('gcal:', err.message);
    } else {
      console.warn('gcal import error:', err.message);
    }
  }
}

// 현재 보이는 날짜 가져오기 (디바운스 300ms)
function gcalImportCurrentDate() {
  if (!gcalTokenValid()) return;
  clearTimeout(_gcalImportTimer);
  _gcalImportTimer = setTimeout(() => {
    gcalImportEvents(dateKey(currentDay()));
  }, 300);
}

// 주기적 자동 가져오기 (3분)
function gcalStartPolling() {
  if (_gcalPollInterval) return;
  _gcalPollInterval = setInterval(() => {
    if (gcalTokenValid()) {
      gcalImportEvents(dateKey(currentDay()));
    } else {
      gcalStopPolling();
    }
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
  const clean = text.replace(/^✅\s*/, '');
  return _gcalFetch('PATCH', `/calendars/${encodeURIComponent(calId)}/events/${eventId}`, {
    summary: '✅ ' + clean,
    colorId: '2'   // Sage (녹색 계열)
  });
}

async function gcalMarkEventUndone(eventId, text) {
  const calId = await _getCalendarId();
  return _gcalFetch('PATCH', `/calendars/${encodeURIComponent(calId)}/events/${eventId}`, {
    summary: text.replace(/^✅\s*/, ''),
    colorId: '0'   // 기본 색상으로 복원
  });
}

// ──────────────────────────────────────────────
// UI 업데이트 헬퍼
// ──────────────────────────────────────────────
function updateGcalUI() {
  const connected     = gcalTokenValid();
  const everConnected = isGcalConnected();
  const dot           = document.getElementById('gcalStatusDot');
  const txt           = document.getElementById('gcalStatusText');
  const connectBtn    = document.getElementById('gcalConnectBtn');
  const syncBtn       = document.getElementById('gcalSyncBtn');
  const disconnectBtn = document.getElementById('gcalDisconnectBtn');
  const reconnectBtn  = document.getElementById('gcalReconnectBtn'); // 헤더 버튼

  // 헤더 재연결 버튼: 한번 연동했는데 토큰이 없을 때만 표시
  if (reconnectBtn) reconnectBtn.hidden = !(everConnected && !connected);

  if (!dot) return; // 설정 모달이 아직 열리지 않은 경우

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
