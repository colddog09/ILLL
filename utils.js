/* ============================================================
   utils.js — 유틸리티 함수 및 만료 일정 자동 반환
   ============================================================ */

'use strict';

const DAYS_KO   = ['일','월','화','수','목','금','토'];
const DAYS_FULL = ['일요일','월요일','화요일','수요일','목요일','금요일','토요일'];

// ── 기한 유틸 (render.js, deadline.js보다 먼저 로드되어야 함) ──
function formatDeadlineText(dl) {
  if (!dl) return '';
  return `${dl.month}월 ${dl.day}일 ${dl.time}까지`;
}

function isDeadlineUrgent(dl) {
  if (!dl) return false;
  const now    = new Date();
  const year   = now.getFullYear();
  const target = new Date(year, parseInt(dl.month) - 1, parseInt(dl.day), ...dl.time.split(':').map(Number));
  if (target < now) target.setFullYear(year + 1);
  const diffMs = target - now;
  return diffMs >= 0 && diffMs <= 24 * 60 * 60 * 1000;
}

function uid() { return '_' + Math.random().toString(36).slice(2, 9); }

function currentDay() {
  const d = new Date();
  d.setDate(d.getDate() + state.dayOffset);
  return d;
}

function dateKey(d) {
  const y   = d.getFullYear();
  const m   = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function todayKey() { return dateKey(new Date()); }

function getNextDateKey(key) {
  const [y, m, d] = key.split('-');
  const nextDate  = new Date(y, m - 1, d);
  nextDate.setDate(nextDate.getDate() + 1);
  return dateKey(nextDate);
}

function formatFullDateLabel(date, dayNames = DAYS_KO) {
  return `${date.getFullYear()}년 ${date.getMonth() + 1}월 ${date.getDate()}일 (${dayNames[date.getDay()]})`;
}

function formatHistoryDateLabel(date) {
  return `${date.getFullYear()}년 ${date.getMonth() + 1}월 ${date.getDate()}일 ${DAYS_FULL[date.getDay()]}`;
}

function escHtml(str) {
  return str.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

function renderApp() { renderPool(); renderWeek(); }

function requireLogin(message = '로그인 후 이용 가능합니다.') {
  if (currentUser) return true;
  alert(message);
  return false;
}

function clearSelectedScheduleItems() {
  document.querySelectorAll('.sched-item.selected').forEach(item => item.classList.remove('selected'));
}

function setTaskInputEnabled(enabled) {
  const taskInput = document.getElementById('taskInput');
  if (taskInput) {
    taskInput.disabled = !enabled;
    taskInput.placeholder = enabled
      ? "할일을 추가하세요 (엔터)"
      : "👉 로그인 후 일정을 추가할 수 있습니다.";
  }
}

// ──────────────────────────────────────────────
// 하루 지난 미완료 일정 자동 풀 반환
// ──────────────────────────────────────────────
function autoReturnExpiredTasks() {
  if (!currentUser) return;
  const now = new Date();
  const effectiveToday = new Date(now);
  if (now.getHours() < 5) effectiveToday.setDate(effectiveToday.getDate() - 1);
  const today   = dateKey(effectiveToday);
  let changed   = false;

  Object.keys(state.schedule).forEach(key => {
    if (key >= today) return;
    const items   = state.schedule[key] || [];
    const pending = items.filter(it => it.status !== 'O');
    if (pending.length === 0) return;

    pending.forEach(it => {
      const restoredTaskId = it.taskId || it.id;
      if (!state.pool.find(t => t.id === restoredTaskId)) {
        const task = { id: restoredTaskId, text: it.text };
        if (it.deadline) task.deadline = it.deadline; // deadline 보존
        state.pool.push(task);
      }
    });

    state.schedule[key] = items.filter(it => it.status === 'O');
    changed = true;
  });

  if (changed) {
    saveState();
    renderPool();
    renderWeek();
  }
}
