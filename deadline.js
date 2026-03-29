/* ============================================================
   deadline.js — 기한(deadline) 설정 UI
   ============================================================ */

'use strict';

// formatDeadlineText, isDeadlineUrgent → utils.js에 정의됨

let pendingDeadline = null; // { month, day, time } or null

const deadlineToggleBtn  = document.getElementById('deadlineToggleBtn');
const deadlinePopup      = document.getElementById('deadlinePopup');
const deadlineMonth      = document.getElementById('deadlineMonth');
const deadlineDay        = document.getElementById('deadlineDay');
const deadlineTime       = document.getElementById('deadlineTime');
const deadlineConfirmBtn = document.getElementById('deadlineConfirmBtn');
const deadlineClearBtn   = document.getElementById('deadlineClearBtn');

// 월/일 select 옵션 채우기
(function initDeadlineSelects() {
  const now = new Date();
  for (let m = 1; m <= 12; m++) {
    const opt = document.createElement('option');
    opt.value = m;
    opt.textContent = m + '월';
    if (m === now.getMonth() + 1) opt.selected = true;
    deadlineMonth.appendChild(opt);
  }
  function fillDays(month) {
    deadlineDay.innerHTML = '';
    const days = new Date(new Date().getFullYear(), month, 0).getDate();
    for (let d = 1; d <= days; d++) {
      const opt = document.createElement('option');
      opt.value = d;
      opt.textContent = d + '일';
      if (d === now.getDate() && month === now.getMonth() + 1) opt.selected = true;
      deadlineDay.appendChild(opt);
    }
  }
  fillDays(now.getMonth() + 1);
  deadlineMonth.addEventListener('change', () => fillDays(parseInt(deadlineMonth.value)));
})();

function updateDeadlineBtn() {
  if (pendingDeadline) {
    deadlineToggleBtn.textContent = `${pendingDeadline.month}/${pendingDeadline.day} ${pendingDeadline.time}`;
    deadlineToggleBtn.classList.add('deadline-toggle-btn--set');
  } else {
    deadlineToggleBtn.textContent = '기한';
    deadlineToggleBtn.classList.remove('deadline-toggle-btn--set');
  }
}

deadlineToggleBtn.addEventListener('click', e => {
  e.stopPropagation();
  deadlinePopup.hidden = !deadlinePopup.hidden;
});

deadlineConfirmBtn.addEventListener('click', () => {
  pendingDeadline = {
    month: deadlineMonth.value,
    day:   deadlineDay.value,
    time:  deadlineTime.value || '23:59'
  };
  updateDeadlineBtn();
  deadlinePopup.hidden = true;
});

deadlineClearBtn.addEventListener('click', () => {
  pendingDeadline = null;
  updateDeadlineBtn();
  deadlinePopup.hidden = true;
});

document.addEventListener('click', e => {
  if (!deadlinePopup.hidden && !deadlinePopup.contains(e.target) && e.target !== deadlineToggleBtn) {
    deadlinePopup.hidden = true;
  }
});
