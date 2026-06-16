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

// ──────────────────────────────────────────────
// 커스텀 드롭다운 (네이티브 select 대체 — 가독성 개선)
//   컨테이너.value 로 현재 선택값 보관/읽기, change 콜백 지원
// ──────────────────────────────────────────────
function _makeDlSelect(container, { onChange } = {}) {
  const trigger = document.createElement('button');
  trigger.type = 'button';
  trigger.className = 'dl-select__trigger';
  trigger.innerHTML = '<span class="dl-select__label"></span><span class="dl-select__chev">▾</span>';

  const list = document.createElement('ul');
  list.className = 'dl-select__list';
  list.hidden = true;

  container.appendChild(trigger);
  container.appendChild(list);

  const api = {
    options: [],            // [{value, label}]
    value: null,
    setOptions(opts) {
      this.options = opts;
      list.innerHTML = '';
      opts.forEach(o => {
        const li = document.createElement('li');
        li.className = 'dl-select__opt';
        li.dataset.value = o.value;
        li.textContent = o.label;
        li.addEventListener('click', () => { this.select(o.value); api.close(); });
        list.appendChild(li);
      });
      // 현재값이 옵션에 없으면 첫 값으로 보정
      if (!opts.some(o => String(o.value) === String(this.value))) {
        this.select(opts.length ? opts[0].value : null, true);
      } else {
        this._paint();
      }
    },
    select(value, silent) {
      this.value = value == null ? null : String(value);
      this._paint();
      if (!silent && typeof onChange === 'function') onChange(this.value);
    },
    _paint() {
      const opt = this.options.find(o => String(o.value) === String(this.value));
      trigger.querySelector('.dl-select__label').textContent = opt ? opt.label : '';
      list.querySelectorAll('.dl-select__opt').forEach(li => {
        const sel = li.dataset.value === String(this.value);
        li.classList.toggle('selected', sel);
        if (sel) li.setAttribute('aria-selected', 'true'); else li.removeAttribute('aria-selected');
      });
    },
    open() {
      // 다른 드롭다운 닫기
      document.querySelectorAll('.dl-select__list').forEach(l => { if (l !== list) l.hidden = true; });
      list.hidden = false;
      container.classList.add('dl-select--open');
      const sel = list.querySelector('.dl-select__opt.selected');
      if (sel) sel.scrollIntoView({ block: 'center' });
    },
    close() {
      list.hidden = true;
      container.classList.remove('dl-select--open');
    },
    toggle() { list.hidden ? this.open() : this.close(); },
  };

  trigger.addEventListener('click', e => { e.stopPropagation(); api.toggle(); });
  return api;
}

let _dlMonth, _dlDay;

// 월/일 커스텀 드롭다운 채우기
(function initDeadlineSelects() {
  const now = new Date();

  function dayOptions(month) {
    const days = new Date(now.getFullYear(), month, 0).getDate();
    return Array.from({ length: days }, (_, i) => ({ value: i + 1, label: (i + 1) + '일' }));
  }

  _dlMonth = _makeDlSelect(deadlineMonth, {
    onChange: m => {
      // 월 변경 시 일 옵션 재생성 (선택일 보존, 없으면 보정)
      const prevDay = _dlDay.value;
      _dlDay.setOptions(dayOptions(parseInt(m)));
      if (dayOptions(parseInt(m)).some(o => String(o.value) === String(prevDay))) {
        _dlDay.select(prevDay, true);
      }
    }
  });
  _dlDay = _makeDlSelect(deadlineDay);

  _dlMonth.setOptions(Array.from({ length: 12 }, (_, i) => ({ value: i + 1, label: (i + 1) + '월' })));
  _dlMonth.select(now.getMonth() + 1, true);
  _dlDay.setOptions(dayOptions(now.getMonth() + 1));
  _dlDay.select(now.getDate(), true);
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
  const month = parseInt(_dlMonth.value);
  const day   = parseInt(_dlDay.value);
  const time  = deadlineTime.value || '23:59';
  // 연도 추론: 선택한 월/일이 오늘보다 과거면 내년으로 (연말 경계 대응)
  const now = new Date();
  const [hh, mm] = time.split(':').map(Number);
  let year = now.getFullYear();
  const candidate = new Date(year, month - 1, day, hh || 0, mm || 0);
  if (candidate < now) year += 1;
  pendingDeadline = { year, month: String(month), day: String(day), time };
  updateDeadlineBtn();
  deadlinePopup.hidden = true;
});

deadlineClearBtn.addEventListener('click', () => {
  pendingDeadline = null;
  updateDeadlineBtn();
  deadlinePopup.hidden = true;
});

document.addEventListener('click', e => {
  // 열린 커스텀 드롭다운 목록 닫기 (자기 컨테이너 밖 클릭 시)
  document.querySelectorAll('.dl-select.dl-select--open').forEach(c => {
    if (!c.contains(e.target)) {
      c.classList.remove('dl-select--open');
      const l = c.querySelector('.dl-select__list');
      if (l) l.hidden = true;
    }
  });
  if (!deadlinePopup.hidden && !deadlinePopup.contains(e.target) && e.target !== deadlineToggleBtn) {
    deadlinePopup.hidden = true;
  }
});
