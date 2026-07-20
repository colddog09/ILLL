// ──────────────────────────────────────────────
async function gmAddToMyList(ann, btn, groupId) {
  if (!ann) return;
  if (btn) { btn.disabled = true; btn.textContent = '추가 중…'; }

  try {
    let destination = '';
    if (!ann.date) {
      const task = { id: uid(), text: ann.text };
      if (ann.deadline) task.deadline = ann.deadline;
      if (ann.link) task.link = ann.link;
      if (groupId) { task.groupId = groupId; task.annId = ann.id; }
      state.pool.push(task);
      saveState();
      renderPool();
      destination = '📥 할일 풀에 추가됐어요!';
    } else if (typeof gcalTokenValid === 'function' && gcalTokenValid()) {
      try {
        await gcalCreateEvent(ann.text, ann.date, ann.date_end || undefined);
        if (typeof gcalImportCurrentDate === 'function') gcalImportCurrentDate();
        const range = ann.date_end ? `${ann.date} ~ ${ann.date_end}` : ann.date;
        destination = `📅 구글 캘린더 (${range})에 추가됐어요!`;
      } catch (e) {
        _gmAddToSchedule(ann, groupId);
        destination = `📅 앱 스케줄 (${ann.date})에 추가됐어요!`;
      }
    } else {
      _gmAddToSchedule(ann, groupId);
      const range = ann.date_end ? `${ann.date} ~ ${ann.date_end}` : ann.date;
      destination = `📅 앱 스케줄 (${range})에 추가됐어요!`;
    }

    _gmMarkAdded(ann.id);
    if (btn) { btn.textContent = '추가됨'; btn.classList.add('gm-add-btn--done'); }
    _gmToast(destination);
  } catch (e) {
    if (btn) { btn.disabled = false; btn.textContent = '+ 내 리스트'; }
    alert('추가 실패: ' + (e?.message || '오류'));
  }
}

function _gmToast(msg) {
  let t = document.getElementById('gmToast');
  if (t) t.remove();
  t = document.createElement('div');
  t.id = 'gmToast';
  t.textContent = msg;
  t.style.cssText = [
    'position:fixed','bottom:88px','left:50%','transform:translateX(-50%)',
    'background:rgba(30,27,75,0.92)','color:#fff','font-size:0.85rem',
    'font-weight:600','padding:10px 18px','border-radius:999px',
    'z-index:9999','pointer-events:none','white-space:nowrap',
    'box-shadow:0 4px 18px rgba(0,0,0,0.25)',
    'animation:fadeIn 0.2s ease',
  ].join(';');
  document.body.appendChild(t);
  setTimeout(() => t.remove(), 2800);
}

function _gmAddToSchedule(ann, groupId) {
  if (!state.schedule[ann.date]) state.schedule[ann.date] = [];
  const item = { id: uid(), taskId: uid(), text: ann.text, status: null };
  if (ann.deadline) item.deadline = ann.deadline;
  if (ann.link) item.link = ann.link;
  if (groupId) { item.groupId = groupId; item.annId = ann.id; }
  state.schedule[ann.date].push(item);
  saveState();
  renderApp();
}

// ──────────────────────────────────────────────
// 그룹 채팅
// ──────────────────────────────────────────────
let _chatPollTimer = null;
let _chatSending   = false;
function _gmStopChatPoll() {
  if (_chatPollTimer) { clearInterval(_chatPollTimer); _chatPollTimer = null; }
}

async function gmShowChat(groupId) {
  _gmStopChatPoll();
  const body = document.getElementById('groupModalBody');
  if (!body) return;
  const groupName = gmCurrent?.name || '그룹';

  body.innerHTML = `
    <div class="gm-chat-wrap">
      <div class="gm-hero">
        <div class="gm-hero__toprow">
          <button class="gm-back-btn" id="gmChatBack">← 뒤로</button>
          <span class="gm-chat-title">💬 ${escHtml(groupName)}</span>
        </div>
      </div>
      <div class="gm-chat-msgs" id="gmChatMsgs">
        <div class="gm-loading">불러오는 중…</div>
      </div>
      <div class="gm-chat-bar">
        <input id="gmChatInput" class="gm-input" type="text" maxlength="500"
               placeholder="메시지를 입력하세요…" autocomplete="off" />
        <button id="gmChatSend" class="gm-btn gm-btn--primary">전송</button>
      </div>
    </div>`;

  document.getElementById('gmChatBack')?.addEventListener('click', () => {
    _gmStopChatPoll();
    gmOpenGroup(groupId);
  });

  const sendFn = () => _gmSendChatMsg(groupId);
  document.getElementById('gmChatSend')?.addEventListener('click', sendFn);
  document.getElementById('gmChatInput')?.addEventListener('keydown', e => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendFn(); }
  });

  await _gmLoadChat(groupId, false);
  _chatPollTimer = setInterval(() => _gmLoadChat(groupId, true), 10000);
}

async function _gmLoadChat(groupId, silent = false) {
  const msgsEl = document.getElementById('gmChatMsgs');
  if (!msgsEl) { _gmStopChatPoll(); return; }

  const isAdmin = gmCurrent && (gmCurrent.role === 'owner' || gmCurrent.role === 'coowner');

  const { data, error } = await supabaseClient
    .from('group_comments')
    .select('*')
    .eq('group_id', groupId)
    .is('announcement_id', null)
    .order('created_at', { ascending: true })
    .limit(300);

  if (error) {
    if (!silent) msgsEl.innerHTML = '<div class="gm-empty">메시지를 불러오지 못했어요.</div>';
    return;
  }

  const msgs = data || [];
  const atBottom = !silent ||
    (msgsEl.scrollHeight - msgsEl.scrollTop - msgsEl.clientHeight < 80);

  if (!msgs.length) {
    msgsEl.innerHTML = '<div class="gm-empty gm-chat-empty">아직 메시지가 없어요.<br>첫 메시지를 보내보세요! 👋</div>';
    return;
  }

  // 날짜 구분선 삽입
  let lastDay = '';
  const html = msgs.map(m => {
    const isMine = m.author_id === currentUser.id;
    const dt = new Date(m.created_at);
    const dayKey = dt.toLocaleDateString('ko-KR', { month: 'long', day: 'numeric', weekday: 'short' });
    const time = dt.toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' });
    const canDel = isMine || isAdmin;
    const divider = dayKey !== lastDay
      ? `<div class="gm-chat-divider"><span>${escHtml(dayKey)}</span></div>` : '';
    lastDay = dayKey;
    return divider + `
      <div class="gm-bubble${isMine ? ' gm-bubble--mine' : ' gm-bubble--other'}" data-msgid="${m.id}">
        ${!isMine ? `<span class="gm-bubble__author">${escHtml(m.author_name || '익명')}</span>` : ''}
        <div class="gm-bubble__row">
          ${isMine && canDel ? `<button class="gm-bubble__del" data-delmsg="${m.id}">🗑</button>` : ''}
          <span class="gm-bubble__text">${escHtml(m.text)}</span>
          ${!isMine && canDel ? `<button class="gm-bubble__del" data-delmsg="${m.id}">🗑</button>` : ''}
        </div>
        <span class="gm-bubble__time">${time}</span>
      </div>`;
  }).join('');

  msgsEl.innerHTML = html;
  msgsEl.querySelectorAll('[data-delmsg]').forEach(b =>
    b.addEventListener('click', () => _gmDeleteChatMsg(groupId, b.dataset.delmsg)));

  if (atBottom) msgsEl.scrollTop = msgsEl.scrollHeight;
}

async function _gmSendChatMsg(groupId) {
  if (_chatSending) return;
  const inp = document.getElementById('gmChatInput');
  const text = (inp?.value || '').trim().slice(0, 500);
  if (!text) return;

  _chatSending = true;
  const sendBtn = document.getElementById('gmChatSend');
  if (sendBtn) sendBtn.disabled = true;
  if (inp) inp.value = '';

  try {
    const { error } = await supabaseClient.from('group_comments').insert({
      group_id: groupId,
      announcement_id: null,
      author_id: currentUser.id,
      author_name: _gmDisplayName(),
      text,
    });
    if (error) {
      alert('전송 실패: ' + error.message);
      if (inp) inp.value = text;
    } else {
      await _gmLoadChat(groupId, false);
    }
  } finally {
    _chatSending = false;
    if (sendBtn) sendBtn.disabled = false;
  }
}

async function _gmDeleteChatMsg(groupId, msgId) {
  if (!confirm('이 메시지를 삭제할까요?')) return;
  const { error } = await supabaseClient.from('group_comments').delete().eq('id', msgId);
  if (error) { alert('삭제 실패: ' + error.message); return; }
  _gmLoadChat(groupId, true);
}

// ──────────────────────────────────────────────
// 바인딩
// ──────────────────────────────────────────────
(function initGroups() {
  const tabBar        = document.getElementById('mobileTabBar');
  const slider        = document.getElementById('tabSlider');
  const settingsModal = document.getElementById('settingsModal');
  const groupModal    = document.getElementById('groupModal');

  const tabEls  = ['Home','Timetable','Group','Settings'].map(id => document.getElementById('tab'+id));
  const N = 4;

  // ── 슬라이더 이동 ──────────────────────────────
  function moveSlider(index, animate = true) {
    if (!slider || index < 0 || index >= N) return;
    slider.style.transition = animate
      ? 'transform 0.42s cubic-bezier(0.22,0.9,0.32,1)'
      : 'none';
    slider.style.width = `${100 / N}%`;
    slider.style.transform = `translate3d(${index * 100}%,0,0)`;
    slider.dataset.index = String(index);
  }

  // ── 탭 활성화 ──────────────────────────────────
  function activateTab(index) {
    tabEls.forEach((el, i) => {
      if (!el) return;
      const wasActive = el.classList.contains('is-active');
      el.classList.toggle('is-active', i === index);
      if (i === index) el.setAttribute('aria-current', 'page');
      else el.removeAttribute('aria-current');
      if (i === index && !wasActive) {
        const icon = el.querySelector('.tabbar-item__icon');
        if (icon) {
          icon.classList.remove('tabbar-bounce');
          void icon.offsetWidth;
          icon.classList.add('tabbar-bounce');
        }
      }
    });
    moveSlider(index);
  }

  const nameToIdx = { home: 0, timetable: 1, group: 2, settings: 3 };
  function setActiveTab(name) { activateTab(nameToIdx[name] ?? 0); }

  // 초기 슬라이더 위치
  requestAnimationFrame(() => moveSlider(0, false));

  function setTabHash(name, replace = false) {
    const next = `#${name}`;
    if (window.location.hash === next) return;
    window.history[replace ? 'replaceState' : 'pushState'](null, '', next);
  }

  // ── 탭 페이지 열기/닫기 ──────────────────────
  function openGroupTab(updateHash = true) {
    if (!currentUser) { alert('그룹 기능은 로그인 후 이용 가능합니다.'); return; }
    if (typeof closeTimetableTab === 'function') closeTimetableTab();
    if (settingsModal) settingsModal.hidden = true;
    gmOpenModal();
    setActiveTab('group');
    if (updateHash) setTabHash('group');
  }

  function openTimetable(updateHash = true) {
    if (!currentUser) { alert('시간표는 로그인 후 이용 가능합니다.'); return; }
    gmCloseModal();
    if (settingsModal) settingsModal.hidden = true;
    if (typeof openTimetableTab === 'function') openTimetableTab();
    setActiveTab('timetable');
    if (updateHash) setTabHash('timetable');
  }

  function openSettingsTab(updateHash = true) {
    if (!currentUser) { alert('로그인 후 이용 가능합니다.'); return; }
    if (typeof closeTimetableTab === 'function') closeTimetableTab();
    gmCloseModal();
    document.getElementById('settingsBtn')?.click();
    setActiveTab('settings');
    if (updateHash) setTabHash('settings');
  }

  function closeAll(updateHash = true) {
    gmCloseModal();
    if (settingsModal) settingsModal.hidden = true;
    if (typeof closeTimetableTab === 'function') closeTimetableTab();
    setActiveTab('home');
    if (updateHash) setTabHash('home');
  }

  // ── 탭 클릭 ──────────────────────────────────
  tabEls[0]?.addEventListener('click', () => closeAll(true));
  tabEls[1]?.addEventListener('click', () => openTimetable(true));
  tabEls[2]?.addEventListener('click', () => openGroupTab(true));
  tabEls[3]?.addEventListener('click', () => openSettingsTab(true));

  // 헤더 버튼
  document.getElementById('timetableDesktopBtn')?.addEventListener('click', e => { e.preventDefault(); openTimetable(true); });
  document.getElementById('groupBtn')?.addEventListener('click', e => { e.preventDefault(); openGroupTab(true); });
  document.getElementById('settingsBtn')?.addEventListener('click', () => {
    setActiveTab('settings');
    setTabHash('settings');
  });

  // 닫기 버튼 → 홈
  document.getElementById('groupCloseBtn')?.addEventListener('click', () => closeAll(true));
  document.getElementById('settingsCloseBtn')?.addEventListener('click', () => closeAll(true));
  groupModal?.addEventListener('click', e => { if (e.target === groupModal) closeAll(true); });
  settingsModal?.addEventListener('click', e => { if (e.target === settingsModal) closeAll(true); });

  function applyTabRoute() {
    const hash = window.location.hash || '#home';
    if (hash === '#timetable') {
      openTimetable(false);
    } else if (hash.startsWith('#group')) {
      if (groupModal?.hidden) openGroupTab(false);
      else setActiveTab('group');
    } else if (hash === '#settings') {
      if (settingsModal?.hidden) openSettingsTab(false);
      else setActiveTab('settings');
    } else {
      closeAll(false);
    }
  }

  window.addEventListener('hashchange', applyTabRoute);
  setTimeout(applyTabRoute, 350);
})();

// ── ?join=CODE URL 자동 참여 ──────────────────────────────────
async function gmAutoJoinFromUrl() {
  const code = new URLSearchParams(location.search).get('join');
  if (!code || !currentUser) return;

  // URL 파라미터 제거 (뒤로가기 시 재진입 방지)
  history.replaceState(null, '', location.pathname);

  // 이미 참여한 그룹인지 확인
  await gmShowList();
  const already = gmGroups.find(g => g.invite_code === code.toUpperCase());
  if (already) {
    // 이미 멤버면 그냥 그룹 열기
    const modal = document.getElementById('groupModal');
    if (modal) modal.hidden = false;
    gmOpenGroup(already.id);
    return;
  }

  // 자동 참여
  if (gmGroups.length >= GROUP_MAX) {
    alert(`그룹은 최대 ${GROUP_MAX}개까지 참여할 수 있어요.`);
    return;
  }
  const { data, error } = await supabaseClient.rpc('join_group_by_code', {
    p_code: code,
    p_display: _gmDisplayName(),
  });
  if (error) {
    alert(error.message.includes('invalid_code')
      ? '유효하지 않은 초대 링크예요.' : '참여 실패: ' + error.message);
    return;
  }
  await gmShowList();
  const modal = document.getElementById('groupModal');
  if (modal) modal.hidden = false;
  if (data?.status === 'pending') {
    alert(`'${data.name || '비공개'}' 그룹은 가입 승인이 필요해요.\n그룹장이 승인하면 참여됩니다. ⏳`);
    return;
  }
  if (data?.id) gmOpenGroup(data.id);
}
