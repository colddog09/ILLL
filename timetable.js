/* ============================================================
   timetable.js — 오일추 모바일 시간표
   schedular iOS 원본의 학기/수업/세션 구조를 웹에 맞게 이식
   ============================================================ */

'use strict';

const TT_WEEKDAYS = { 1: '월', 2: '화', 3: '수', 4: '목', 5: '금', 6: '토', 7: '일' };
const TT_ALL_DAYS = [1, 2, 3, 4, 5, 6, 7];
const TT_COLORS = ['#8b93ff', '#56c8a5', '#ff9c73', '#f2c94c', '#e889b5', '#58a6e7', '#a982e7', '#76b66b'];
const TT_HOUR_HEIGHT = 58;

function ttId() {
  return globalThis.crypto?.randomUUID?.() || `tt_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
}

function ttEsc(value) {
  return String(value ?? '').replace(/[&<>'"]/g, ch => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;'
  }[ch]));
}

function ttMinutesToTime(minutes) {
  const n = Math.max(0, Math.min(1439, Number(minutes) || 0));
  return `${String(Math.floor(n / 60)).padStart(2, '0')}:${String(n % 60).padStart(2, '0')}`;
}

function ttTimeToMinutes(value) {
  const [hour, minute] = String(value || '00:00').split(':').map(Number);
  return (hour || 0) * 60 + (minute || 0);
}

function ttNormalizeModel(model) {
  if (!model || typeof model !== 'object') return null;
  const hourStart = Math.max(0, Math.min(22, Number(model.hourStart) || 8));
  const hourEnd = Math.max(hourStart + 1, Math.min(24, Number(model.hourEnd) || 18));
  const courses = (Array.isArray(model.courses) ? model.courses : []).map(course => ({
    id: course.id || ttId(),
    name: String(course.name || '수업'),
    note: String(course.note || ''),
    color: course.color || course.colorHex || TT_COLORS[0],
    sessions: (Array.isArray(course.sessions) ? course.sessions : []).map(session => ({
      id: session.id || ttId(),
      weekday: Math.max(1, Math.min(7, Number(session.weekday) || 1)),
      startMinutes: Math.max(0, Math.min(1439, Number(session.startMinutes) || 540)),
      endMinutes: Math.max(1, Math.min(1440, Number(session.endMinutes) || 600)),
      location: String(session.location || '')
    })).filter(session => session.endMinutes > session.startMinutes)
  }));
  return {
    id: model.id || ttId(),
    name: String(model.name || '내 시간표'),
    // 모바일에서는 월~일을 항상 한 화면에 보여준다.
    weekdays: [...TT_ALL_DAYS],
    hourStart,
    hourEnd,
    courses
  };
}

function ttModel() {
  const normalized = ttNormalizeModel(state.timetable);
  if (normalized && JSON.stringify(normalized) !== JSON.stringify(state.timetable)) {
    state.timetable = normalized;
  }
  return normalized;
}

function ttSave(model) {
  state.timetable = ttNormalizeModel(model);
  saveState();
  renderTimetable();
}

function ttTodayWeekday() {
  const day = new Date().getDay();
  return day === 0 ? 7 : day;
}

function ttDatesThisWeek() {
  const now = new Date();
  const mondayOffset = ttTodayWeekday() - 1;
  const monday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - mondayOffset, 12);
  return TT_ALL_DAYS.map((_, index) => {
    const date = new Date(monday);
    date.setDate(monday.getDate() + index);
    return date;
  });
}

function ttLayoutSessions(sessions) {
  const sorted = [...sessions].sort((a, b) => a.startMinutes - b.startMinutes || a.endMinutes - b.endMinutes);
  const columns = [];
  const laid = sorted.map(session => {
    let columnIndex = columns.findIndex(end => end <= session.startMinutes);
    if (columnIndex < 0) columnIndex = columns.length;
    columns[columnIndex] = session.endMinutes;
    return { session, columnIndex, columnCount: 1 };
  });
  const count = Math.max(1, columns.length);
  laid.forEach(item => { item.columnCount = count; });
  return laid;
}

function renderTimetable() {
  const content = document.getElementById('ttContent');
  const title = document.getElementById('ttTitle');
  if (!content) return;
  const model = ttModel();

  if (!model) {
    if (title) title.textContent = '내 시간표';
    content.innerHTML = `
      <div class="tt-empty">
        <div class="tt-empty__art" aria-hidden="true"><span></span><span></span><span></span></div>
        <p class="tt-empty__eyebrow">A FRESH WEEK</p>
        <h3>시간표를 만들어보세요</h3>
        <p>요일과 시간을 정한 뒤 수업을 추가하면<br>이번 주 흐름이 한눈에 보여요.</p>
        <button id="ttCreateBtn" class="tt-primary-btn" type="button">첫 시간표 만들기</button>
      </div>`;
    document.getElementById('ttCreateBtn')?.addEventListener('click', () => ttOpenSetup(false));
    return;
  }

  if (title) title.textContent = model.name;
  const days = TT_ALL_DAYS;
  const weekDates = ttDatesThisWeek();
  const bodyHeight = (model.hourEnd - model.hourStart) * TT_HOUR_HEIGHT;
  const today = ttTodayWeekday();
  const now = new Date();
  const nowMinutes = now.getHours() * 60 + now.getMinutes();
  const showNow = days.includes(today) && nowMinutes >= model.hourStart * 60 && nowMinutes <= model.hourEnd * 60;

  let columnsHtml = '';
  for (const day of days) {
    const rangeStart = model.hourStart * 60;
    const rangeEnd = model.hourEnd * 60;
    const sessions = model.courses.flatMap(course =>
      course.sessions
        .filter(session => session.weekday === day && session.endMinutes > rangeStart && session.startMinutes < rangeEnd)
        .map(session => ({ ...session, course }))
    );
    const blocks = ttLayoutSessions(sessions).map(({ session, columnIndex, columnCount }) => {
      const visibleStart = Math.max(session.startMinutes, rangeStart);
      const visibleEnd = Math.min(session.endMinutes, rangeEnd);
      const top = ((visibleStart - rangeStart) / 60) * TT_HOUR_HEIGHT;
      const height = Math.max(28, ((visibleEnd - visibleStart) / 60) * TT_HOUR_HEIGHT);
      const left = columnIndex * (100 / columnCount);
      const width = 100 / columnCount;
      return `
        <button class="tt-course" type="button" data-course-id="${ttEsc(session.course.id)}"
          style="--course:${ttEsc(session.course.color)};top:${top + 2}px;height:${height - 4}px;left:calc(${left}% + 2px);width:calc(${width}% - 4px)">
          <strong>${ttEsc(session.course.name)}</strong>
          ${session.location ? `<span>${ttEsc(session.location)}</span>` : ''}
          <small>${ttEsc(ttMinutesToTime(session.startMinutes))}</small>
        </button>`;
    }).join('');
    columnsHtml += `<div class="tt-day-column${day === today ? ' is-today' : ''}">${blocks}</div>`;
  }

  let hoursHtml = '';
  for (let hour = model.hourStart; hour <= model.hourEnd; hour++) {
    const top = (hour - model.hourStart) * TT_HOUR_HEIGHT;
    if (hour < model.hourEnd) hoursHtml += `<span class="tt-hour-label" style="top:${top - 6}px">${hour}</span>`;
    hoursHtml += `<i class="tt-hour-line" style="top:${top}px"></i>`;
    if (hour < model.hourEnd) hoursHtml += `<i class="tt-half-line" style="top:${top + TT_HOUR_HEIGHT / 2}px"></i>`;
  }

  const nowTop = ((nowMinutes - model.hourStart * 60) / 60) * TT_HOUR_HEIGHT;
  content.innerHTML = `
    <div class="tt-scroll" aria-label="${ttEsc(model.name)} 시간표">
      <div class="tt-grid" style="--tt-days:${days.length};--tt-grid-height:${bodyHeight}px">
        <div class="tt-days-head">
          <span class="tt-corner"></span>
          ${days.map((day, index) => `<span class="tt-day-label${day === today ? ' is-today' : ''}"><b>${TT_WEEKDAYS[day]}</b><em>${weekDates[index].getDate()}</em></span>`).join('')}
        </div>
        <div class="tt-grid-body" style="height:${bodyHeight}px">
          ${hoursHtml}
          <div class="tt-days-layer">${columnsHtml}</div>
          ${showNow ? `<div class="tt-now-line" style="top:${nowTop}px"><span></span></div>` : ''}
        </div>
      </div>
    </div>
    <button id="ttMobileAddBtn" class="tt-fab" type="button"><span>＋</span> 수업 추가</button>`;

  content.querySelectorAll('.tt-course').forEach(button => {
    button.addEventListener('click', () => ttOpenCourse(button.dataset.courseId));
  });
  document.getElementById('ttMobileAddBtn')?.addEventListener('click', () => ttOpenCourse());
}

function ttOpenSetup(editing) {
  const current = ttModel();
  const model = current || {
    id: ttId(), name: '내 시간표', weekdays: [...TT_ALL_DAYS], hourStart: 8, hourEnd: 18, courses: []
  };
  const modal = ttSheet(`
    <form id="ttSetupForm" class="tt-form">
      <div class="tt-sheet__head">
        <button class="tt-text-btn" data-tt-close type="button">취소</button>
        <h3>${editing ? '시간표 설정' : '새 시간표'}</h3>
        <button class="tt-text-btn tt-text-btn--strong" type="submit">저장</button>
      </div>
      <div class="tt-sheet__body">
        <label class="tt-field"><span>이름</span><input name="name" maxlength="30" value="${ttEsc(model.name)}" required></label>
        <div class="tt-field"><span>표시 시간</span><div class="tt-range-row">
          <select name="hourStart">${Array.from({ length: 23 }, (_, i) => `<option value="${i}" ${i === model.hourStart ? 'selected' : ''}>${String(i).padStart(2, '0')}:00</option>`).join('')}</select>
          <b>부터</b>
          <select name="hourEnd">${Array.from({ length: 23 }, (_, i) => i + 1).map(i => `<option value="${i}" ${i === model.hourEnd ? 'selected' : ''}>${String(i).padStart(2, '0')}:00</option>`).join('')}</select>
        </div></div>
        ${editing ? '<button id="ttDeleteTimetable" class="tt-danger-btn" type="button">시간표 삭제</button>' : ''}
      </div>
    </form>`);

  modal.querySelector('#ttSetupForm')?.addEventListener('submit', event => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const hourStart = Number(form.get('hourStart'));
    const hourEnd = Number(form.get('hourEnd'));
    if (hourEnd <= hourStart) return ttFormError(event.currentTarget, '종료 시간은 시작 시간보다 늦어야 해요.');
    ttSave({ ...model, name: String(form.get('name')).trim(), weekdays: [...TT_ALL_DAYS], hourStart, hourEnd });
    ttCloseSheet(modal);
  });

  modal.querySelector('#ttDeleteTimetable')?.addEventListener('click', () => {
    if (!confirm('시간표와 모든 수업을 삭제할까요?')) return;
    state.timetable = null;
    saveState();
    renderTimetable();
    ttCloseSheet(modal);
  });
}

function ttSessionRow(model, session = {}) {
  const weekdays = TT_ALL_DAYS;
  const start = session.startMinutes ?? Math.max(9, model.hourStart) * 60;
  const end = session.endMinutes ?? Math.min(24, Math.max(10, model.hourStart + 1)) * 60;
  const row = document.createElement('div');
  row.className = 'tt-session-editor';
  row.dataset.sessionId = session.id || ttId();
  row.innerHTML = `
    <div class="tt-session-editor__top">
      <select class="tt-session-day" aria-label="요일">${weekdays.map(day => `<option value="${day}" ${day === (session.weekday || weekdays[0]) ? 'selected' : ''}>${TT_WEEKDAYS[day]}요일</option>`).join('')}</select>
      <button class="tt-session-remove" type="button" aria-label="시간 삭제">×</button>
    </div>
    <div class="tt-session-times">
      <label><span>시작</span><input class="tt-session-start" type="time" value="${ttMinutesToTime(start)}" required></label>
      <i>→</i>
      <label><span>종료</span><input class="tt-session-end" type="time" value="${ttMinutesToTime(end)}" required></label>
    </div>
    <label class="tt-location"><span>장소</span><input class="tt-session-location" maxlength="40" value="${ttEsc(session.location || '')}" placeholder="선택 사항"></label>`;
  row.querySelector('.tt-session-remove').addEventListener('click', () => row.remove());
  return row;
}

function ttOpenCourse(courseId) {
  const model = ttModel();
  if (!model) { ttOpenSetup(false); return; }
  const editing = model.courses.find(course => course.id === courseId);
  const modal = ttSheet(`
    <form id="ttCourseForm" class="tt-form">
      <div class="tt-sheet__head">
        <button class="tt-text-btn" data-tt-close type="button">취소</button>
        <h3>${editing ? '수업 편집' : '수업 추가'}</h3>
        <button class="tt-text-btn tt-text-btn--strong" type="submit">저장</button>
      </div>
      <div class="tt-sheet__body">
        <label class="tt-field"><span>수업 이름</span><input name="name" maxlength="40" value="${ttEsc(editing?.name || '')}" placeholder="예: 물리학" required autofocus></label>
        <label class="tt-field"><span>메모</span><input name="note" maxlength="80" value="${ttEsc(editing?.note || '')}" placeholder="선택 사항"></label>
        <fieldset class="tt-field"><legend>색상</legend><div class="tt-color-picker">
          ${TT_COLORS.map((color, index) => `<label><input type="radio" name="color" value="${color}" ${(editing?.color || TT_COLORS[0]) === color ? 'checked' : ''}><span style="--swatch:${color}">${index + 1}</span></label>`).join('')}
        </div></fieldset>
        <div class="tt-field"><span>요일 및 시간</span><div id="ttSessions" class="tt-sessions"></div>
          <button id="ttAddSession" class="tt-add-session" type="button">＋ 시간 추가</button>
        </div>
        ${editing ? '<button id="ttDeleteCourse" class="tt-danger-btn" type="button">수업 삭제</button>' : ''}
      </div>
    </form>`);
  const sessionBox = modal.querySelector('#ttSessions');
  (editing?.sessions?.length ? editing.sessions : [{}]).forEach(session => sessionBox.appendChild(ttSessionRow(model, session)));
  modal.querySelector('#ttAddSession')?.addEventListener('click', () => sessionBox.appendChild(ttSessionRow(model)));

  modal.querySelector('#ttCourseForm')?.addEventListener('submit', event => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const sessions = [...sessionBox.querySelectorAll('.tt-session-editor')].map(row => ({
      id: row.dataset.sessionId,
      weekday: Number(row.querySelector('.tt-session-day').value),
      startMinutes: ttTimeToMinutes(row.querySelector('.tt-session-start').value),
      endMinutes: ttTimeToMinutes(row.querySelector('.tt-session-end').value),
      location: row.querySelector('.tt-session-location').value.trim()
    }));
    if (!sessions.length) return ttFormError(event.currentTarget, '수업 시간을 하나 이상 추가해주세요.');
    if (sessions.some(session => session.endMinutes <= session.startMinutes)) {
      return ttFormError(event.currentTarget, '종료 시간은 시작 시간보다 늦어야 해요.');
    }
    const next = {
      id: editing?.id || ttId(),
      name: String(form.get('name')).trim(),
      note: String(form.get('note') || '').trim(),
      color: String(form.get('color') || TT_COLORS[0]),
      sessions
    };
    const courses = editing
      ? model.courses.map(course => course.id === editing.id ? next : course)
      : [...model.courses, next];
    ttSave({ ...model, courses });
    ttCloseSheet(modal);
  });

  modal.querySelector('#ttDeleteCourse')?.addEventListener('click', () => {
    if (!confirm(`‘${editing.name}’ 수업을 삭제할까요?`)) return;
    ttSave({ ...model, courses: model.courses.filter(course => course.id !== editing.id) });
    ttCloseSheet(modal);
  });
}

function ttFormError(form, message) {
  let error = form.querySelector('.tt-form-error');
  if (!error) {
    error = document.createElement('p');
    error.className = 'tt-form-error';
    form.querySelector('.tt-sheet__body')?.prepend(error);
  }
  error.textContent = message;
}

function ttSheet(html) {
  const overlay = document.createElement('div');
  overlay.className = 'tt-sheet-overlay';
  overlay.innerHTML = `<div class="tt-sheet" role="dialog" aria-modal="true"><div class="tt-sheet__handle"></div>${html}</div>`;
  document.body.appendChild(overlay);
  overlay.querySelectorAll('[data-tt-close]').forEach(button => button.addEventListener('click', () => ttCloseSheet(overlay)));
  overlay.addEventListener('click', event => { if (event.target === overlay) ttCloseSheet(overlay); });
  requestAnimationFrame(() => overlay.classList.add('is-open'));
  return overlay;
}

function ttCloseSheet(overlay) {
  if (!overlay?.isConnected) return;
  overlay.classList.remove('is-open');
  setTimeout(() => overlay.remove(), 240);
}

function openTimetableTab() {
  const view = document.getElementById('timetableView');
  if (!view) return;
  document.body.classList.add('app-timetable-open');
  view.hidden = false;
  renderTimetable();
  requestAnimationFrame(() => view.classList.add('is-visible'));
}

function closeTimetableTab() {
  const view = document.getElementById('timetableView');
  document.body.classList.remove('app-timetable-open');
  if (!view) return;
  view.classList.remove('is-visible');
  view.hidden = true;
}

document.getElementById('ttBackBtn')?.addEventListener('click', () => document.getElementById('tabHome')?.click());
document.getElementById('ttSettingsBtn')?.addEventListener('click', () => ttOpenSetup(!!ttModel()));
document.getElementById('ttAddBtn')?.addEventListener('click', () => ttOpenCourse());
