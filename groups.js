/* ============================================================
   groups.js — 그룹 기능 (초대코드 참여 / 일정 공지 / 내 리스트로 추가)
   gcal.js, state.js, utils.js 이후에 로드
   ============================================================ */
'use strict';

let gmGroups   = [];     // 내가 속한 그룹 [{id,name,invite_code,owner_id,role}]
let gmCurrent  = null;   // 현재 열람 중인 그룹 객체
let gmBusy     = false;

function _gmDisplayName() {
  const u = currentUser;
  return (u?.user_metadata?.full_name || u?.user_metadata?.name || u?.email || '사용자').slice(0, 40);
}

// 이미 내 리스트에 추가한 공지 id 기록 (기기별 UX용)
function _gmAddedKey() { return 'gm_added_' + (currentUser?.id || 'anon'); }
function _gmAddedSet() {
  try { return new Set(JSON.parse(localStorage.getItem(_gmAddedKey()) || '[]')); }
  catch { return new Set(); }
}
function _gmMarkAdded(id) {
  const s = _gmAddedSet(); s.add(id);
  try { localStorage.setItem(_gmAddedKey(), JSON.stringify([...s])); } catch (_) {}
}

// ──────────────────────────────────────────────
// 모달 열기/닫기
// ──────────────────────────────────────────────
function gmOpenModal() {
  if (!requireLogin('그룹 기능은 로그인 후 이용 가능합니다.')) return;
  const modal = document.getElementById('groupModal');
  if (!modal) return;
  modal.hidden = false;
  gmShowList();
}
function gmCloseModal() {
  const modal = document.getElementById('groupModal');
  if (modal) modal.hidden = true;
  gmCurrent = null;
}

// ──────────────────────────────────────────────
// 목록 화면
// ──────────────────────────────────────────────
async function gmShowList() {
  gmCurrent = null;
  const body = document.getElementById('groupModalBody');
  if (!body) return;
  body.innerHTML = `<div class="gm-loading">불러오는 중…</div>`;

  const { data, error } = await supabaseClient
    .from('group_members')
    .select('role, groups(id, name, invite_code, owner_id)')
    .eq('user_id', currentUser.id);

  if (error) { body.innerHTML = `<div class="gm-empty">목록을 불러오지 못했어요. 잠시 후 다시 시도해주세요.</div>`; return; }

  gmGroups = (data || [])
    .filter(r => r.groups)
    .map(r => ({ ...r.groups, role: r.role }));

  const listHtml = gmGroups.length
    ? gmGroups.map(g => `
        <button class="gm-group-row" data-open="${g.id}">
          <span class="gm-group-row__name">${escHtml(g.name)}</span>
          <span class="gm-group-row__role">${g.role === 'owner' ? '👑 그룹장' : g.role === 'announcer' ? '📢 공지' : '멤버'}</span>
        </button>`).join('')
    : `<div class="gm-empty">아직 속한 그룹이 없어요.<br>+ 버튼으로 만들거나 참여하세요.</div>`;

  body.innerHTML = `
    <div class="gm-list-header">
      <span class="gm-list-count">${gmGroups.length ? `그룹 ${gmGroups.length}개` : '내 그룹'}</span>
      <div class="gm-add-wrap">
        <button class="gm-add-trigger" id="gmAddTrigger" title="그룹 추가">+</button>
        <div class="gm-add-dropdown" id="gmAddDropdown" hidden>
          <button class="gm-add-option" id="gmOptCreate">➕ 새 그룹 만들기</button>
          <button class="gm-add-option" id="gmOptJoin">🔑 초대 코드로 참여</button>
        </div>
      </div>
    </div>

    <div class="gm-list">${listHtml}</div>

    <div class="gm-sheet" id="gmCreateSheet" hidden>
      <p class="gm-sheet__title">새 그룹 만들기</p>
      <div class="gm-form__row">
        <input id="gmCreateName" class="gm-input" type="text" maxlength="40" placeholder="그룹 이름 (예: 3학년 2반)" />
        <button id="gmCreateBtn" class="gm-btn gm-btn--primary">만들기</button>
      </div>
    </div>

    <div class="gm-sheet" id="gmJoinSheet" hidden>
      <p class="gm-sheet__title">초대 코드로 참여</p>
      <div class="gm-form__row">
        <input id="gmJoinCode" class="gm-input gm-input--code" type="text" maxlength="6" placeholder="코드 6자리" />
        <button id="gmJoinBtn" class="gm-btn gm-btn--primary">참여</button>
      </div>
    </div>`;

  // 그룹 열기
  body.querySelectorAll('[data-open]').forEach(b =>
    b.addEventListener('click', () => gmOpenGroup(b.dataset.open)));

  // + 드롭다운 토글
  const trigger  = document.getElementById('gmAddTrigger');
  const dropdown = document.getElementById('gmAddDropdown');
  const createSheet = document.getElementById('gmCreateSheet');
  const joinSheet   = document.getElementById('gmJoinSheet');

  trigger?.addEventListener('click', e => {
    e.stopPropagation();
    dropdown.hidden = !dropdown.hidden;
  });
  document.getElementById('gmOptCreate')?.addEventListener('click', () => {
    dropdown.hidden = true;
    joinSheet.hidden = true;
    createSheet.hidden = !createSheet.hidden;
    if (!createSheet.hidden) document.getElementById('gmCreateName')?.focus();
  });
  document.getElementById('gmOptJoin')?.addEventListener('click', () => {
    dropdown.hidden = true;
    createSheet.hidden = true;
    joinSheet.hidden = !joinSheet.hidden;
    if (!joinSheet.hidden) document.getElementById('gmJoinCode')?.focus();
  });
  // 바깥 클릭 시 드롭다운 닫기
  body.addEventListener('click', () => { dropdown.hidden = true; }, { once: false });

  document.getElementById('gmCreateBtn')?.addEventListener('click', gmCreateGroup);
  document.getElementById('gmJoinBtn')?.addEventListener('click', gmJoinGroup);
  document.getElementById('gmJoinCode')?.addEventListener('keydown', e => { if (e.key === 'Enter') gmJoinGroup(); });
  document.getElementById('gmCreateName')?.addEventListener('keydown', e => { if (e.key === 'Enter') gmCreateGroup(); });
}

async function gmCreateGroup() {
  if (gmBusy) return;
  const name = (document.getElementById('gmCreateName')?.value || '').trim();
  if (!name) { alert('그룹 이름을 입력하세요.'); return; }
  gmBusy = true;
  const { data, error } = await supabaseClient.rpc('create_group', { p_name: name, p_display: _gmDisplayName() });
  gmBusy = false;
  if (error) { alert('그룹 생성 실패: ' + error.message); return; }
  await gmShowList();
  if (data?.id) gmOpenGroup(data.id);
}

async function gmJoinGroup() {
  if (gmBusy) return;
  const code = (document.getElementById('gmJoinCode')?.value || '').trim();
  if (code.length < 4) { alert('초대 코드를 정확히 입력하세요.'); return; }
  gmBusy = true;
  const { data, error } = await supabaseClient.rpc('join_group_by_code', { p_code: code, p_display: _gmDisplayName() });
  gmBusy = false;
  if (error) {
    alert(error.message === 'invalid_code' || /invalid_code/.test(error.message)
      ? '존재하지 않는 초대 코드예요.' : '참여 실패: ' + error.message);
    return;
  }
  await gmShowList();
  if (data?.id) gmOpenGroup(data.id);
}

// ──────────────────────────────────────────────
// 그룹 상세 화면
// ──────────────────────────────────────────────
async function gmOpenGroup(groupId) {
  const body = document.getElementById('groupModalBody');
  if (!body) return;
  body.innerHTML = `<div class="gm-loading">불러오는 중…</div>`;

  gmCurrent = gmGroups.find(g => g.id === groupId) || null;
  if (!gmCurrent) {
    // 목록 갱신 후 재시도
    await gmShowList();
    gmCurrent = gmGroups.find(g => g.id === groupId) || null;
    if (!gmCurrent) return;
  }

  const isOwner    = gmCurrent.role === 'owner';
  const canAnnounce = gmCurrent.role === 'owner' || gmCurrent.role === 'announcer';

  const [annRes, memRes] = await Promise.all([
    supabaseClient.from('group_announcements').select('*').eq('group_id', groupId).order('created_at', { ascending: false }),
    supabaseClient.from('group_members').select('user_id, role, display_name').eq('group_id', groupId)
  ]);

  const anns    = annRes.data || [];
  const members = memRes.data || [];
  const added   = _gmAddedSet();

  const annHtml = anns.length ? anns.map(a => {
    const dateLabel = a.date
      ? `<span class="gm-ann__date">📅 ${escHtml(a.date)}</span>`
      : (a.deadline ? `<span class="gm-ann__date">⏰ ${escHtml(formatDeadlineText(a.deadline))}</span>` : `<span class="gm-ann__date gm-ann__date--none">날짜 없음</span>`);
    const isAdded = added.has(a.id);
    const canDelete = isOwner || a.author_id === currentUser.id;
    return `
      <div class="gm-ann" data-ann="${a.id}">
        <div class="gm-ann__main">
          <span class="gm-ann__text">${escHtml(a.text)}</span>
          <div class="gm-ann__meta">${dateLabel}<span class="gm-ann__author">${escHtml(a.author_name || '익명')}</span></div>
        </div>
        <div class="gm-ann__actions">
          <button class="gm-add-btn ${isAdded ? 'gm-add-btn--done' : ''}" data-add="${a.id}" ${isAdded ? 'disabled' : ''}>${isAdded ? '추가됨' : '+ 내 리스트'}</button>
          ${canDelete ? `<button class="gm-ann__del" data-del="${a.id}" title="공지 삭제">🗑️</button>` : ''}
        </div>
      </div>`;
  }).join('') : `<div class="gm-empty">아직 공지된 일정이 없어요.</div>`;

  const postForm = canAnnounce ? `
    <div class="gm-post">
      <p class="gm-section-title">📢 일정 공지하기</p>
      <input id="gmPostText" class="gm-input" type="text" maxlength="200" placeholder="일정 내용 (예: 수학 수행평가)" />
      <div class="gm-post__row">
        <input id="gmPostDate" class="gm-input gm-input--date" type="date" />
        <button id="gmPostBtn" class="gm-btn gm-btn--primary">공지</button>
      </div>
    </div>` : '';

  const ownerPanel = isOwner ? `
    <div class="gm-members-wrap">
      <p class="gm-section-title">👥 멤버 (${members.length}명)</p>
      <div class="gm-members">
        ${members.map(m => {
          const meTag = m.user_id === currentUser.id ? ' <span class="gm-me-tag">나</span>' : '';
          const nm = escHtml(m.display_name || '멤버');
          if (m.role === 'owner') return `
            <div class="gm-member">
              <span class="gm-member__name">${nm}${meTag}</span>
              <span class="gm-member__role">👑 그룹장</span>
            </div>`;
          const grant = m.role === 'announcer'
            ? `<button class="gm-role-btn" data-revoke="${m.user_id}">공지 해제</button>`
            : `<button class="gm-role-btn gm-role-btn--grant" data-grant="${m.user_id}">공지 권한</button>`;
          return `
            <div class="gm-member">
              <span class="gm-member__name">${nm}${meTag}</span>
              ${grant}
            </div>`;
        }).join('')}
      </div>
    </div>` : '';

  body.innerHTML = `
    <div class="gm-hero">
      <div class="gm-hero__toprow">
        <button class="gm-back-btn" id="gmBackBtn">← 목록</button>
        ${isOwner ? `<button class="gm-settings-btn" id="gmSettingsBtn" title="그룹 설정">⚙️</button>` : ''}
      </div>
      <div class="gm-hero__content">
        <h2 class="gm-hero__name">${escHtml(gmCurrent.name)}</h2>
        <div class="gm-hero__badge">${isOwner ? '👑 그룹장' : canAnnounce ? '📢 공지자' : '멤버'}</div>
      </div>
      <div class="gm-hero__code-row">
        <div class="gm-hero__code-wrap">
          <span class="gm-hero__code-label">초대 코드</span>
          <span class="gm-hero__code">${escHtml(gmCurrent.invite_code)}</span>
        </div>
        <button class="gm-copy-btn" id="gmCopyCode">복사</button>
      </div>
    </div>

    ${postForm}

    <div class="gm-anns-wrap">
      <p class="gm-section-title">🗓️ 공지된 일정</p>
      <div class="gm-anns">${annHtml}</div>
    </div>

    ${!isOwner ? `<button class="gm-leave-btn" id="gmLeaveBtn">그룹 나가기</button>` : ''}`;

  // 이벤트 바인딩
  document.getElementById('gmBackBtn')?.addEventListener('click', gmShowList);
  document.getElementById('gmSettingsBtn')?.addEventListener('click', () => gmShowSettings(groupId));
  document.getElementById('gmCopyCode')?.addEventListener('click', () => {
    navigator.clipboard?.writeText(gmCurrent.invite_code).then(() => {
      const b = document.getElementById('gmCopyCode'); if (b) { b.textContent = '복사됨'; setTimeout(() => b.textContent = '복사', 1500); }
    });
  });
  document.getElementById('gmPostBtn')?.addEventListener('click', () => gmPostAnnouncement(groupId));
  document.getElementById('gmLeaveBtn')?.addEventListener('click', () => gmLeaveOrDelete(groupId, false));

  body.querySelectorAll('[data-add]').forEach(b =>
    b.addEventListener('click', () => gmAddToMyList(anns.find(a => a.id === b.dataset.add), b)));
  body.querySelectorAll('[data-del]').forEach(b =>
    b.addEventListener('click', () => gmDeleteAnnouncement(b.dataset.del, groupId)));
  body.querySelectorAll('[data-grant]').forEach(b =>
    b.addEventListener('click', () => gmSetRole(groupId, b.dataset.grant, 'announcer')));
  body.querySelectorAll('[data-revoke]').forEach(b =>
    b.addEventListener('click', () => gmSetRole(groupId, b.dataset.revoke, 'member')));
}

// ──────────────────────────────────────────────
// 그룹 설정 화면 (그룹장 전용)
// ──────────────────────────────────────────────
async function gmShowSettings(groupId) {
  const body = document.getElementById('groupModalBody');
  if (!body) return;
  body.innerHTML = `<div class="gm-loading">불러오는 중…</div>`;

  const group = gmGroups.find(g => g.id === groupId) || gmCurrent;
  if (!group) { gmShowList(); return; }

  const { data: members, error } = await supabaseClient
    .from('group_members')
    .select('user_id, role, display_name')
    .eq('group_id', groupId);

  if (error) { body.innerHTML = `<div class="gm-empty">불러오지 못했어요.</div>`; return; }

  const memberRows = (members || []).map(m => {
    const meTag = m.user_id === currentUser.id ? ' <span class="gm-me-tag">나</span>' : '';
    const nm = escHtml(m.display_name || '멤버');
    if (m.role === 'owner') return `
      <div class="gm-member">
        <span class="gm-member__name">${nm}${meTag}</span>
        <span class="gm-member__role">👑 그룹장</span>
      </div>`;
    const grant = m.role === 'announcer'
      ? `<button class="gm-role-btn" data-revoke="${m.user_id}">공지 해제</button>`
      : `<button class="gm-role-btn gm-role-btn--grant" data-grant="${m.user_id}">공지 권한</button>`;
    return `
      <div class="gm-member">
        <span class="gm-member__name">${nm}${meTag}</span>
        ${grant}
      </div>`;
  }).join('');

  body.innerHTML = `
    <div class="gm-settings-header">
      <button class="gm-back-btn gm-back-btn--dark" id="gmSettingsBackBtn">← 돌아가기</button>
      <span class="gm-settings-title">그룹 설정</span>
    </div>

    <div class="gm-settings-section">
      <p class="gm-section-title">그룹 이름 변경</p>
      <div class="gm-form__row">
        <input id="gmRenameInput" class="gm-input" type="text" maxlength="40"
          placeholder="새 그룹 이름" value="${escHtml(group.name)}" />
        <button id="gmRenameBtn" class="gm-btn gm-btn--primary">저장</button>
      </div>
    </div>

    <div class="gm-settings-section">
      <p class="gm-section-title">멤버 권한 관리 (${(members||[]).length}명)</p>
      <div class="gm-members">${memberRows}</div>
    </div>

    <div class="gm-settings-section gm-settings-section--danger">
      <p class="gm-section-title">위험 구역</p>
      <button class="gm-danger-btn" id="gmDeleteBtn">🗑️ 그룹 삭제</button>
    </div>`;

  document.getElementById('gmSettingsBackBtn')?.addEventListener('click', () => gmOpenGroup(groupId));
  document.getElementById('gmRenameBtn')?.addEventListener('click', () => gmRenameGroup(groupId));
  document.getElementById('gmRenameInput')?.addEventListener('keydown', e => { if (e.key === 'Enter') gmRenameGroup(groupId); });
  document.getElementById('gmDeleteBtn')?.addEventListener('click', () => gmLeaveOrDelete(groupId, true));
  body.querySelectorAll('[data-grant]').forEach(b =>
    b.addEventListener('click', () => gmSetRole(groupId, b.dataset.grant, 'announcer')));
  body.querySelectorAll('[data-revoke]').forEach(b =>
    b.addEventListener('click', () => gmSetRole(groupId, b.dataset.revoke, 'member')));
}

async function gmRenameGroup(groupId) {
  if (gmBusy) return;
  const name = (document.getElementById('gmRenameInput')?.value || '').trim();
  if (!name) { alert('이름을 입력하세요.'); return; }
  gmBusy = true;
  const { error } = await supabaseClient.from('groups').update({ name }).eq('id', groupId);
  gmBusy = false;
  if (error) { alert('이름 변경 실패: ' + error.message); return; }
  // 로컬 캐시 갱신
  const g = gmGroups.find(g => g.id === groupId);
  if (g) g.name = name;
  if (gmCurrent?.id === groupId) gmCurrent.name = name;
  const btn = document.getElementById('gmRenameBtn');
  if (btn) { btn.textContent = '저장됨 ✓'; setTimeout(() => { btn.textContent = '저장'; }, 1500); }
}

// ──────────────────────────────────────────────
// 공지 작성 / 삭제
// ──────────────────────────────────────────────
async function gmPostAnnouncement(groupId) {
  if (gmBusy) return;
  const text = (document.getElementById('gmPostText')?.value || '').trim().slice(0, 200);
  const date = document.getElementById('gmPostDate')?.value || null;
  if (!text) { alert('일정 내용을 입력하세요.'); return; }
  gmBusy = true;
  const { error } = await supabaseClient.from('group_announcements').insert({
    group_id: groupId, author_id: currentUser.id, author_name: _gmDisplayName(),
    text, date: date || null
  });
  gmBusy = false;
  if (error) { alert('공지 등록 실패: ' + error.message); return; }

  // 그룹 멤버에게 푸시 알림 (fire-and-forget)
  supabaseClient.auth.getSession().then(({ data: { session } }) => {
    if (!session?.access_token) return;
    fetch('/api/group-notify', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${session.access_token}`,
      },
      body: JSON.stringify({ group_id: groupId, text, date: date || null }),
    }).catch(() => {});
  });

  gmOpenGroup(groupId);
}

async function gmDeleteAnnouncement(id, groupId) {
  if (!confirm('이 공지를 삭제할까요?')) return;
  const { error } = await supabaseClient.from('group_announcements').delete().eq('id', id);
  if (error) { alert('삭제 실패: ' + error.message); return; }
  gmOpenGroup(groupId);
}

// ──────────────────────────────────────────────
// 권한 부여/해제 (owner)
// ──────────────────────────────────────────────
async function gmSetRole(groupId, userId, role) {
  const { error } = await supabaseClient.from('group_members')
    .update({ role }).eq('group_id', groupId).eq('user_id', userId);
  if (error) { alert('권한 변경 실패: ' + error.message); return; }
  gmOpenGroup(groupId);
}

// ──────────────────────────────────────────────
// 그룹 나가기 / 삭제
// ──────────────────────────────────────────────
async function gmLeaveOrDelete(groupId, isOwner) {
  if (isOwner) {
    if (!confirm('그룹을 삭제하면 모든 공지와 멤버가 사라집니다. 삭제할까요?')) return;
    const { error } = await supabaseClient.from('groups').delete().eq('id', groupId);
    if (error) { alert('삭제 실패: ' + error.message); return; }
  } else {
    if (!confirm('이 그룹에서 나갈까요?')) return;
    const { error } = await supabaseClient.from('group_members')
      .delete().eq('group_id', groupId).eq('user_id', currentUser.id);
    if (error) { alert('나가기 실패: ' + error.message); return; }
  }
  gmShowList();
}

// ──────────────────────────────────────────────
// 공지 일정 → 내 리스트로 추가
//   날짜 없음 → 할일 풀
//   날짜 있음 → 구글 캘린더(연결 시) / 미연결 시 해당 날짜 스케줄
// ──────────────────────────────────────────────
async function gmAddToMyList(ann, btn) {
  if (!ann) return;
  if (btn) { btn.disabled = true; btn.textContent = '추가 중…'; }

  try {
    if (!ann.date) {
      // 할일 풀로
      const task = { id: uid(), text: ann.text };
      if (ann.deadline) task.deadline = ann.deadline;
      state.pool.push(task);
      saveState();
      renderPool();
    } else if (typeof gcalTokenValid === 'function' && gcalTokenValid()) {
      // 구글 캘린더로
      try {
        await gcalCreateEvent(ann.text, ann.date);
        if (typeof gcalImportCurrentDate === 'function') gcalImportCurrentDate();
      } catch (e) {
        // 캘린더 실패 시 앱 스케줄로 폴백
        _gmAddToSchedule(ann);
      }
    } else {
      // 캘린더 미연결 → 앱 스케줄
      _gmAddToSchedule(ann);
    }

    _gmMarkAdded(ann.id);
    if (btn) { btn.textContent = '추가됨'; btn.classList.add('gm-add-btn--done'); }
  } catch (e) {
    if (btn) { btn.disabled = false; btn.textContent = '+ 내 리스트'; }
    alert('추가 실패: ' + (e?.message || '오류'));
  }
}

function _gmAddToSchedule(ann) {
  if (!state.schedule[ann.date]) state.schedule[ann.date] = [];
  const item = { id: uid(), taskId: uid(), text: ann.text, status: null };
  if (ann.deadline) item.deadline = ann.deadline;
  state.schedule[ann.date].push(item);
  saveState();
  renderApp();
}

// ──────────────────────────────────────────────
// 바인딩
// ──────────────────────────────────────────────
(function initGroups() {
  // ── 모바일 하단 탭바 (홈 / 모임 / 설정) ──
  const tabHome     = document.getElementById('tabHome');
  const tabGroup    = document.getElementById('tabGroup');
  const tabSettings = document.getElementById('tabSettings');
  const settingsModal = document.getElementById('settingsModal');
  const groupModal    = document.getElementById('groupModal');

  function setActiveTab(name) {
    tabHome?.classList.toggle('is-active', name === 'home');
    tabGroup?.classList.toggle('is-active', name === 'group');
    tabSettings?.classList.toggle('is-active', name === 'settings');
  }

  // 탭 클릭 시 해시만 변경
  tabHome?.addEventListener('click', () => { window.location.hash = '#home'; });
  tabGroup?.addEventListener('click', () => { window.location.hash = '#group'; });
  tabSettings?.addEventListener('click', () => { window.location.hash = '#settings'; });

  // 헤더 버튼 클릭 시 해시 변경
  document.getElementById('groupBtn')?.addEventListener('click', e => {
    e.preventDefault();
    window.location.hash = '#group';
  });
  document.getElementById('settingsBtn')?.addEventListener('click', e => {
    e.preventDefault();
    window.location.hash = '#settings';
  });

  // 해시 변경 감지 핸들러
  function handleHashChange() {
    const hash = window.location.hash;

    if (hash === '#group') {
      if (!currentUser) {
        alert('그룹 기능은 로그인 후 이용 가능합니다.');
        window.location.hash = '#home';
        return;
      }
      if (settingsModal) settingsModal.hidden = true;
      const modal = document.getElementById('groupModal');
      if (modal) {
        modal.hidden = false;
        gmShowList();
      }
      setActiveTab('group');
    } else if (hash === '#settings') {
      if (!currentUser) {
        alert('로그인 후 이용 가능합니다.');
        window.location.hash = '#home';
        return;
      }
      gmCloseModal();
      if (settingsModal) {
        if (settingsModal.hidden) {
          document.getElementById('settingsBtn')?.click();
        } else {
          settingsModal.hidden = false;
        }
      }
      setActiveTab('settings');
    } else {
      // #home, # 혹은 해시 없음
      gmCloseModal();
      if (settingsModal) settingsModal.hidden = true;
      setActiveTab('home');
    }
  }

  // 닫기 버튼 → #home으로
  document.getElementById('groupCloseBtn')?.addEventListener('click', () => { window.location.hash = '#home'; });
  document.getElementById('settingsCloseBtn')?.addEventListener('click', () => { window.location.hash = '#home'; });

  [groupModal, settingsModal].forEach(m => {
    m?.addEventListener('click', e => {
      if (e.target === m) window.location.hash = '#home';
    });
  });

  window.addEventListener('hashchange', handleHashChange);
  setTimeout(handleHashChange, 350);
})();
