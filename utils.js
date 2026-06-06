/* ============================================================
   utils.js — 유틸리티 함수 및 만료 일정 자동 반환
   ============================================================ */

'use strict';

const DAYS_KO   = ['일','월','화','수','목','금','토'];
const DAYS_FULL = ['일요일','월요일','화요일','수요일','목요일','금요일','토요일'];

// ── 기한 유틸 (render.js, deadline.js보다 먼저 로드되어야 함) ──
// 마감일 → Date 변환. dl.year 있으면 사용, 없으면(레거시) 올해 기준.
// 레거시 데이터가 6개월 이상 과거면 연말 경계로 보고 내년으로 보정.
function deadlineToDate(dl) {
  if (!dl) return null;
  const [hh, mm] = (dl.time || '23:59').split(':').map(Number);
  const year = dl.year ? parseInt(dl.year) : new Date().getFullYear();
  const d = new Date(year, parseInt(dl.month) - 1, parseInt(dl.day), hh || 0, mm || 0);
  if (!dl.year) {
    const now = new Date();
    if (d < now && (now - d) > 183 * 24 * 60 * 60 * 1000) d.setFullYear(year + 1);
  }
  return d;
}

function formatDeadlineText(dl) {
  if (!dl) return '';
  const base = `${dl.month}월 ${dl.day}일 ${dl.time}까지`;
  return isDeadlinePast(dl) ? `${base} (지남)` : base;
}

function isDeadlineUrgent(dl) {
  const target = deadlineToDate(dl);
  if (!target) return false;
  const diffMs = target - new Date();
  return diffMs >= 0 && diffMs <= 24 * 60 * 60 * 1000;
}

// 마감 지남 여부
function isDeadlinePast(dl) {
  const target = deadlineToDate(dl);
  return !!target && target < new Date();
}

// 고유 ID — 충돌 거의 없는 UUID (구형 브라우저 폴백 포함)
function uid() {
  try {
    if (window.crypto && typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  } catch (_) {}
  return '_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 10);
}

// 안전한 URL만 허용 (javascript:, data: 등 차단)
function safeUrl(url) {
  if (typeof url !== 'string') return '#';
  const u = url.trim();
  return /^https?:\/\//i.test(u) ? u : '#';
}

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
  if (str === null || str === undefined) return '';
  str = String(str);
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// renderApp() 은 render.js 에 정의됨

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
      if (it.fromGcal) {
        // 날짜 지난 gcal 항목은 그냥 제거
      } else {
        const restoredTaskId = it.taskId || it.id;
        if (!state.pool.find(t => t.id === restoredTaskId)) {
          const task = { id: restoredTaskId, text: it.text };
          if (it.deadline) task.deadline = it.deadline;
          state.pool.push(task);
        }
      }
    });

    state.schedule[key] = items.filter(it => it.status === 'O');
    changed = true;
  });

  if (changed) {
    saveState();
    renderPool();
    renderWeek();
    renderGcalSidePanel();
  }
}

// ──────────────────────────────────────────────
// 모달 헬퍼 (events.js / modals.js 공용)
// ──────────────────────────────────────────────
function setModalOpen(modal, open) {
  if (modal) modal.hidden = !open;
}

function bindModal(openBtn, modal, closeBtn, beforeOpen) {
  if (openBtn)  openBtn.addEventListener('click', () => { beforeOpen?.(); setModalOpen(modal, true); });
  if (closeBtn) closeBtn.addEventListener('click', () => setModalOpen(modal, false));
  if (modal)    modal.addEventListener('click', e => { if (e.target === modal) setModalOpen(modal, false); });
}
