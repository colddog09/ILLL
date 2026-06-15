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
  _gmStopChatPoll();
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
    .select('role, status, notifications_enabled, groups(id, name, invite_code, owner_id, is_private)')
    .eq('user_id', currentUser.id);

  if (error) { body.innerHTML = `<div class="gm-empty">목록을 불러오지 못했어요. 잠시 후 다시 시도해주세요.</div>`; return; }

  const allRows = (data || [])
    .filter(r => r.groups)
    .map(r => ({ ...r.groups, role: r.role, status: r.status || 'active', notifications_enabled: r.notifications_enabled !== false }));
  gmGroups = allRows.filter(g => g.status !== 'pending');
  const pendingGroups = allRows.filter(g => g.status === 'pending');

  const roleBadge = r => r === 'owner' ? '👑 그룹장' : r === 'coowner' ? '🤝 공동그룹장' : r === 'announcer' ? '📢 공지' : '멤버';
  const pendingHtml = pendingGroups.map(g => `
        <div class="gm-group-row gm-group-row--pending">
          <span class="gm-group-row__name">${escHtml(g.name)}</span>
          <span class="gm-group-row__role">⏳ 승인 대기 중</span>
        </div>`).join('');
  const listHtml = (gmGroups.length || pendingGroups.length)
    ? gmGroups.map(g => `
        <button class="gm-group-row" data-open="${g.id}">
          <span class="gm-group-row__name">${escHtml(g.name)}</span>
          <span class="gm-group-row__role">${roleBadge(g.role)}</span>
        </button>`).join('') + pendingHtml
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

const GROUP_MAX        = 10;   // 유저당 최대 그룹 수
const GROUP_MEMBER_MAX = 50;   // 그룹당 최대 멤버 수
const ANNOUNCE_MAX     = 100;  // 그룹당 최대 공지 수

async function gmCreateGroup() {
  if (gmBusy) return;
  const name = (document.getElementById('gmCreateName')?.value || '').trim();
  if (!name) { alert('그룹 이름을 입력하세요.'); return; }
  if (gmGroups.length >= GROUP_MAX) {
    alert(`그룹은 최대 ${GROUP_MAX}개까지 참여할 수 있어요.`);
    return;
  }
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
  if (gmGroups.length >= GROUP_MAX) {
    alert(`그룹은 최대 ${GROUP_MAX}개까지 참여할 수 있어요.`);
    return;
  }
  gmBusy = true;
  // 멤버 수 사전 확인
  const { data: targetGroup } = await supabaseClient
    .from('groups').select('id').eq('invite_code', code.toUpperCase()).single();
  if (targetGroup?.id) {
    const { count } = await supabaseClient
      .from('group_members').select('*', { count: 'exact', head: true })
      .eq('group_id', targetGroup.id);
    if (count >= GROUP_MEMBER_MAX) {
      gmBusy = false;
      alert(`이 그룹은 멤버가 가득 찼어요. (최대 ${GROUP_MEMBER_MAX}명)`);
      return;
    }
  }
  const { data, error } = await supabaseClient.rpc('join_group_by_code', { p_code: code, p_display: _gmDisplayName() });
  gmBusy = false;
  if (error) {
    alert(error.message === 'invalid_code' || /invalid_code/.test(error.message)
      ? '존재하지 않는 초대 코드예요.' : '참여 실패: ' + error.message);
    return;
  }
  await gmShowList();
  if (data?.status === 'pending') {
    alert(`'${data.name || '비공개'}' 그룹은 가입 승인이 필요해요.\n그룹장이 승인하면 참여됩니다. ⏳`);
    return;
  }
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
  const isAdmin    = gmCurrent.role === 'owner' || gmCurrent.role === 'coowner';
  const canAnnounce = isAdmin || gmCurrent.role === 'announcer';

  const [annRes, memRes, linkRes] = await Promise.all([
    supabaseClient.from('group_announcements').select('*').eq('group_id', groupId)
      .order('pinned', { ascending: false }).order('created_at', { ascending: false }),
    supabaseClient.from('group_members').select('user_id, role, display_name, status').eq('group_id', groupId),
    supabaseClient.from('group_links').select('*').eq('group_id', groupId).order('created_at', { ascending: false }),
  ]);

  const allAnns    = annRes.data  || [];
  const allMembers = memRes.data  || [];
  const members    = allMembers.filter(m => m.status !== 'pending');
  const pending    = allMembers.filter(m => m.status === 'pending');
  const links      = linkRes.data || [];
  const added   = _gmAddedSet();

  // 날짜 지난 공지 자동 삭제 (종료일/날짜 기준, 오늘 이전이면 만료)
  const _todayStr = (() => {
    const d = new Date(), p = n => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
  })();
  const expiredIds = allAnns
    .filter(a => { const end = a.date_end || a.date; return end && end < _todayStr; })
    .map(a => a.id);
  // 만료된 공지는 화면에서 제외 + DB에서 삭제(권한 있는 경우 실제 삭제됨)
  const anns = allAnns.filter(a => !expiredIds.includes(a.id));
  if (expiredIds.length) {
    supabaseClient.from('group_announcements').delete().in('id', expiredIds)
      .then(() => {}, () => {});
  }

  const GM_CAT = {
    exam:  { label: '🔴 시험', cls: 'gm-cat--exam' },
    hw:    { label: '🟡 과제', cls: 'gm-cat--hw' },
    event: { label: '🟢 행사', cls: 'gm-cat--event' },
  };

  const annHtml = anns.length ? anns.map(a => {
    const dateLabel = a.date
      ? `<span class="gm-ann__date">📅 ${escHtml(a.date)}${a.date_end && a.date_end !== a.date ? ` ~ ${escHtml(a.date_end)}` : ''}</span>`
      : (a.deadline ? `<span class="gm-ann__date">⏰ ${escHtml(formatDeadlineText(a.deadline))}</span>` : `<span class="gm-ann__date gm-ann__date--none">날짜 없음</span>`);
    const isAdded = added.has(a.id);
    const canEdit = isAdmin || a.author_id === currentUser.id;
    const cat = GM_CAT[a.category];
    const catChip = cat ? `<span class="gm-cat ${cat.cls}">${cat.label}</span>` : '';
    const pinChip = a.pinned ? `<span class="gm-pin-chip">📌</span>` : '';
    return `
      <div class="gm-ann${a.pinned ? ' gm-ann--pinned' : ''}" data-ann="${a.id}">
        <div class="gm-ann__main">
          <div class="gm-ann__head">${pinChip}${catChip}<span class="gm-ann__text">${escHtml(a.text)}</span></div>
          <div class="gm-ann__meta">${dateLabel}<span class="gm-ann__author">${escHtml(a.author_name || '익명')}</span></div>
        </div>
        <div class="gm-ann__actions">
          <button class="gm-add-btn ${isAdded ? 'gm-add-btn--done' : ''}" data-add="${a.id}" ${isAdded ? 'disabled' : ''}>${isAdded ? '추가됨' : '+ 내 리스트'}</button>
          ${canAnnounce ? `<button class="gm-ann__icon" data-nudge="${a.id}" title="멤버에게 독촉">👉</button>` : ''}
          ${isAdmin ? `<button class="gm-ann__icon${a.pinned ? ' gm-ann__icon--on' : ''}" data-pin="${a.id}" title="${a.pinned ? '고정 해제' : '상단 고정'}">📌</button>` : ''}
          ${canEdit ? `<button class="gm-ann__icon" data-edit="${a.id}" title="수정">✏️</button>` : ''}
          ${canEdit ? `<button class="gm-ann__del" data-del="${a.id}" title="공지 삭제">🗑️</button>` : ''}
        </div>
      </div>`;
  }).join('') : `<div class="gm-empty">아직 공지된 일정이 없어요.</div>`;

  const postForm = canAnnounce ? `
    <div class="gm-post">
      <p class="gm-section-title">📢 일정 공지하기</p>
      <input id="gmPostText" class="gm-input" type="text" maxlength="200" placeholder="일정 내용 (예: 수학 수행평가)" />
      <div class="gm-post__date-row">
        <input id="gmPostDate" class="gm-input gm-input--date" type="date" />
        <span class="gm-post__tilde">~</span>
        <input id="gmPostDateEnd" class="gm-input gm-input--date" type="date" placeholder="종료일 (선택)" />
      </div>
      <div class="gm-post__row">
        <select id="gmPostCat" class="gm-input gm-cat-select">
          <option value="none">분류 없음</option>
          <option value="exam">🔴 시험</option>
          <option value="hw">🟡 과제</option>
          <option value="event">🟢 행사</option>
        </select>
        <button id="gmPostBtn" class="gm-btn gm-btn--primary">공지</button>
      </div>
    </div>` : '';


  const pendingPanel = (isAdmin && pending.length) ? `
    <div class="gm-pending-wrap">
      <p class="gm-section-title">🙋 가입 승인 대기 (${pending.length}명)</p>
      <div class="gm-members">
        ${pending.map(m => `
          <div class="gm-member">
            <span class="gm-member__name">${escHtml(m.display_name || '멤버')}</span>
            <div class="gm-member__btns">
              <button class="gm-role-btn gm-role-btn--grant" data-approve="${m.user_id}">승인</button>
              <button class="gm-role-btn gm-role-btn--danger" data-reject="${m.user_id}">거절</button>
            </div>
          </div>`).join('')}
      </div>
    </div>` : '';

  body.innerHTML = `
    <div class="gm-hero">
      <div class="gm-hero__toprow">
        <button class="gm-back-btn" id="gmBackBtn">← 목록</button>
        <div class="gm-hero__toprow-right">
          <button class="gm-settings-btn" id="gmChatBtn" title="그룹 채팅">💬</button>
          <button class="gm-settings-btn" id="gmLinksBtn" title="그룹 링크">🔗</button>
          ${isAdmin ? `<button class="gm-settings-btn" id="gmSettingsBtn" title="그룹 설정">⚙️</button>` : ''}
        </div>
      </div>
      <div class="gm-hero__content">
        <h2 class="gm-hero__name">${escHtml(gmCurrent.name)}</h2>
        <div class="gm-hero__badge">${isOwner ? '👑 그룹장' : gmCurrent.role === 'coowner' ? '🤝 공동그룹장' : canAnnounce ? '📢 공지자' : '멤버'}</div>
      </div>
      ${isAdmin ? `
      <div class="gm-hero__code-row">
        <div class="gm-hero__code-wrap">
          <span class="gm-hero__code-label">초대 링크</span>
          <span class="gm-hero__code">${escHtml(gmCurrent.invite_code)}</span>
        </div>
        <button class="gm-copy-btn" id="gmCopyCode">링크 복사</button>
      </div>` : ''}
      <div class="gm-hero__notif-row">
        <span class="gm-hero__notif-label">🔔 공지 알림</span>
        <button class="gm-notif-toggle ${gmCurrent.notifications_enabled ? 'gm-notif-toggle--on' : 'gm-notif-toggle--off'}"
                id="gmNotifToggle">
          ${gmCurrent.notifications_enabled ? 'ON' : 'OFF'}
        </button>
      </div>
    </div>

    ${pendingPanel}

    ${postForm}

    <div class="gm-anns-wrap">
      <p class="gm-section-title">🗓️ 공지된 일정</p>
      <div class="gm-anns">${annHtml}</div>
    </div>

    ${!isOwner ? `<button class="gm-leave-btn" id="gmLeaveBtn">그룹 나가기</button>` : ''}`;

  // 이벤트 바인딩
  document.getElementById('gmBackBtn')?.addEventListener('click', gmShowList);
  document.getElementById('gmChatBtn')?.addEventListener('click', () => gmShowChat(groupId));
  document.getElementById('gmSettingsBtn')?.addEventListener('click', () => gmShowSettings(groupId));
  document.getElementById('gmLinksBtn')?.addEventListener('click', () => {
    history.pushState(null, '', '#group-links');
    gmShowLinks(groupId);
  });
  // 시작일 변경 시 종료일 자동 동기화
  document.getElementById('gmPostDate')?.addEventListener('change', e => {
    const endEl = document.getElementById('gmPostDateEnd');
    if (endEl && (!endEl.value || endEl.value < e.target.value)) {
      endEl.value = e.target.value;
    }
  });
  document.getElementById('gmNotifToggle')?.addEventListener('click', () => gmToggleNotifications(groupId));
  document.getElementById('gmCopyCode')?.addEventListener('click', () => {
    const link = `${location.origin}/?join=${gmCurrent.invite_code}`;
    const msg = `👥 '${gmCurrent.name}' 그룹에 초대합니다!\n\n아래 링크를 눌러 바로 참여하세요 👇\n${link}\n\n📋 o1chu.my — 일정 관리, 그룹 공지, 기한 알림까지 한 번에!`;
    navigator.clipboard?.writeText(msg).then(() => {
      const b = document.getElementById('gmCopyCode'); if (b) { b.textContent = '복사됨!'; setTimeout(() => b.textContent = '링크 복사', 1500); }
    });
  });
  document.getElementById('gmPostBtn')?.addEventListener('click', () => gmPostAnnouncement(groupId));
  document.getElementById('gmLeaveBtn')?.addEventListener('click', () => gmLeaveOrDelete(groupId, false));
  body.querySelectorAll('[data-add]').forEach(b =>
    b.addEventListener('click', () => gmAddToMyList(anns.find(a => a.id === b.dataset.add), b, groupId)));
  body.querySelectorAll('[data-del]').forEach(b =>
    b.addEventListener('click', () => gmDeleteAnnouncement(b.dataset.del, groupId)));


  // 공지 수정 / 고정 / 독촉
  body.querySelectorAll('[data-edit]').forEach(b =>
    b.addEventListener('click', () => gmEditAnnouncement(groupId, anns.find(a => a.id === b.dataset.edit))));
  body.querySelectorAll('[data-pin]').forEach(b =>
    b.addEventListener('click', () => gmTogglePin(groupId, anns.find(a => a.id === b.dataset.pin))));
  body.querySelectorAll('[data-nudge]').forEach(b =>
    b.addEventListener('click', () => gmNudge(groupId, anns.find(a => a.id === b.dataset.nudge), members)));

  // 가입 승인 / 거절
  body.querySelectorAll('[data-approve]').forEach(b =>
    b.addEventListener('click', () => gmApproveMember(groupId, b.dataset.approve)));
  body.querySelectorAll('[data-reject]').forEach(b =>
    b.addEventListener('click', () => gmRejectMember(groupId, b.dataset.reject)));
}

// ──────────────────────────────────────────────
// ──────────────────────────────────────────────
// 그룹 링크 화면
// ──────────────────────────────────────────────
async function gmShowLinks(groupId) {
  const body = document.getElementById('groupModalBody');
  if (!body) return;
  body.innerHTML = `<div class="gm-loading">불러오는 중…</div>`;

  const isMember = !!gmGroups.find(g => g.id === groupId);
  if (!isMember) { gmShowList(); return; }

  const { data: links } = await supabaseClient
    .from('group_links').select('*').eq('group_id', groupId).order('created_at', { ascending: false });

  const isOwner = gmCurrent?.role === 'owner';
  const linksHtml = (links || []).length
    ? (links || []).map(l => {
        const canDel = isOwner || l.author_id === currentUser.id;
        return `
          <a class="gm-link-card" href="${escHtml(l.url)}" target="_blank" rel="noopener">
            <span class="gm-link-card__icon">🔗</span>
            <span class="gm-link-card__title">${escHtml(l.title)}</span>
            ${canDel ? `<button class="gm-link-card__del" data-link-del="${l.id}" title="링크 삭제">✕</button>` : ''}
          </a>`;
      }).join('')
    : `<div class="gm-empty">등록된 링크가 없어요.</div>`;

  body.innerHTML = `
    <div class="gm-settings-header">
      <button class="gm-back-btn gm-back-btn--dark" id="gmLinksBackBtn">← 돌아가기</button>
      <span class="gm-settings-title">그룹 링크</span>
    </div>

    <div class="gm-settings-section">
      <p class="gm-section-title">🔗 링크 추가</p>
      <input id="gmLinkTitle" class="gm-input" type="text" maxlength="80" placeholder="링크 제목 (예: 과제 안내 문서)" />
      <div class="gm-post__row" style="margin-top:8px">
        <input id="gmLinkUrl" class="gm-input" type="url" placeholder="https://..." />
        <button id="gmLinkAddBtn" class="gm-btn gm-btn--primary">추가</button>
      </div>
    </div>

    <div class="gm-settings-section">
      <p class="gm-section-title">등록된 링크</p>
      <div class="gm-links" id="gmLinksList">${linksHtml}</div>
    </div>`;

  document.getElementById('gmLinksBackBtn')?.addEventListener('click', () => {
    history.back();
    gmOpenGroup(groupId);
  });
  document.getElementById('gmLinkAddBtn')?.addEventListener('click', async () => {
    await gmAddLink(groupId);
    gmShowLinks(groupId);
  });
  document.getElementById('gmLinkUrl')?.addEventListener('keydown', async e => {
    if (e.key === 'Enter') { await gmAddLink(groupId); gmShowLinks(groupId); }
  });
  body.querySelectorAll('[data-link-del]').forEach(b =>
    b.addEventListener('click', async e => {
      e.preventDefault();
      await gmDeleteLink(b.dataset.linkDel, groupId);
      gmShowLinks(groupId);
    }));
}

// 그룹 설정 화면 (그룹장 / 공동그룹장)
// ──────────────────────────────────────────────
async function gmShowSettings(groupId) {
  const body = document.getElementById('groupModalBody');
  if (!body) return;
  body.innerHTML = `<div class="gm-loading">불러오는 중…</div>`;

  const group = gmGroups.find(g => g.id === groupId) || gmCurrent;
  if (!group) { gmShowList(); return; }
  const myRole = (gmCurrent?.id === groupId ? gmCurrent.role : group.role);
  const isOwner = myRole === 'owner';

  const { data: allM, error } = await supabaseClient
    .from('group_members')
    .select('user_id, role, display_name, status')
    .eq('group_id', groupId);
  if (error) { body.innerHTML = `<div class="gm-empty">불러오지 못했어요.</div>`; return; }

  const members = (allM || []).filter(m => m.status !== 'pending');
  const pending = (allM || []).filter(m => m.status === 'pending');

  const memberRows = members.map(m => {
    const meTag = m.user_id === currentUser.id ? ' <span class="gm-me-tag">나</span>' : '';
    const nm = escHtml(m.display_name || '멤버');
    if (m.role === 'owner') return `
      <div class="gm-member">
        <span class="gm-member__name">${nm}${meTag} <span class="gm-member__role">👑 그룹장</span></span>
      </div>`;
    const roleTag = m.role === 'coowner' ? '<span class="gm-member__role">🤝 공동</span>'
      : m.role === 'announcer' ? '<span class="gm-member__role">📢 공지</span>' : '';
    let btns = '';
    if (isOwner) {
      if (m.role !== 'coowner') {
        btns += m.role === 'announcer'
          ? `<button class="gm-role-btn" data-revoke="${m.user_id}">공지 해제</button>`
          : `<button class="gm-role-btn gm-role-btn--grant" data-grant="${m.user_id}">공지 권한</button>`;
      }
      btns += m.role === 'coowner'
        ? `<button class="gm-role-btn" data-uncoown="${m.user_id}">공동 해제</button>`
        : `<button class="gm-role-btn gm-role-btn--grant" data-coown="${m.user_id}">공동그룹장</button>`;
    }
    if (m.user_id !== currentUser.id && (isOwner || m.role !== 'coowner')) {
      btns += `<button class="gm-role-btn gm-role-btn--danger" data-kick="${m.user_id}">강퇴</button>`;
    }
    return `
      <div class="gm-member">
        <span class="gm-member__name">${nm}${meTag} ${roleTag}</span>
        <div class="gm-member__btns">${btns}</div>
      </div>`;
  }).join('');

  const pendingSection = pending.length ? `
    <div class="gm-settings-section">
      <p class="gm-section-title">🙋 가입 승인 대기 (${pending.length})</p>
      <div class="gm-members">
        ${pending.map(m => `
          <div class="gm-member">
            <span class="gm-member__name">${escHtml(m.display_name || '멤버')}</span>
            <div class="gm-member__btns">
              <button class="gm-role-btn gm-role-btn--grant" data-approve="${m.user_id}">승인</button>
              <button class="gm-role-btn gm-role-btn--danger" data-reject="${m.user_id}">거절</button>
            </div>
          </div>`).join('')}
      </div>
    </div>` : '';

  const privateSection = isOwner ? `
    <div class="gm-settings-section">
      <div class="gm-hero__notif-row" style="padding:0">
        <span class="gm-hero__notif-label">🔒 가입 승인제</span>
        <button class="gm-notif-toggle ${group.is_private ? 'gm-notif-toggle--on' : 'gm-notif-toggle--off'}" id="gmPrivateToggle">
          ${group.is_private ? 'ON' : 'OFF'}
        </button>
      </div>
      <p class="gm-hint">ON이면 초대 링크로 들어와도 그룹장·공동그룹장 승인 후 참여돼요.</p>
    </div>` : '';

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

    ${privateSection}
    ${pendingSection}

    <div class="gm-settings-section">
      <div class="gm-members-header">
        <p class="gm-section-title">멤버 관리 (${members.length}명)</p>
        <button class="gm-members-toggle" id="gmMembersToggle">${members.length}명 더보기 ›</button>
      </div>
      <div class="gm-members gm-members--collapsed" id="gmMembersList">${memberRows}</div>
    </div>

    ${isOwner ? `
    <div class="gm-settings-section gm-settings-section--danger">
      <p class="gm-section-title">위험 구역</p>
      <button class="gm-danger-btn" id="gmDeleteBtn">🗑️ 그룹 삭제</button>
    </div>` : `
    <div class="gm-settings-section">
      <button class="gm-leave-btn" id="gmLeaveBtn2">그룹 나가기</button>
    </div>`}`;

  document.getElementById('gmSettingsBackBtn')?.addEventListener('click', () => gmOpenGroup(groupId));
  document.getElementById('gmMembersToggle')?.addEventListener('click', function() {
    const list = document.getElementById('gmMembersList');
    const isOpen = !list.classList.contains('gm-members--collapsed');
    if (isOpen) { list.classList.add('gm-members--collapsed'); this.textContent = `${members.length}명 더보기 ›`; }
    else {
      list.classList.remove('gm-members--collapsed');
      list.querySelectorAll('.gm-member').forEach((el, i) => { el.style.animationDelay = `${i * 0.05}s`; el.classList.add('gm-member--appear'); });
      this.textContent = '접기 ‹';
    }
  });
  document.getElementById('gmRenameBtn')?.addEventListener('click', () => gmRenameGroup(groupId));
  document.getElementById('gmRenameInput')?.addEventListener('keydown', e => { if (e.key === 'Enter') gmRenameGroup(groupId); });
  document.getElementById('gmDeleteBtn')?.addEventListener('click', () => gmLeaveOrDelete(groupId, true));
  document.getElementById('gmLeaveBtn2')?.addEventListener('click', () => gmLeaveOrDelete(groupId, false));
  document.getElementById('gmPrivateToggle')?.addEventListener('click', async () => {
    await gmSetPrivate(groupId, !group.is_private);
    gmShowSettings(groupId);
  });
  body.querySelectorAll('[data-grant]').forEach(b => b.addEventListener('click', () => gmSetRole(groupId, b.dataset.grant, 'announcer')));
  body.querySelectorAll('[data-revoke]').forEach(b => b.addEventListener('click', () => gmSetRole(groupId, b.dataset.revoke, 'member')));
  body.querySelectorAll('[data-coown]').forEach(b => b.addEventListener('click', () => gmSetRole(groupId, b.dataset.coown, 'coowner')));
  body.querySelectorAll('[data-uncoown]').forEach(b => b.addEventListener('click', () => gmSetRole(groupId, b.dataset.uncoown, 'member')));
  body.querySelectorAll('[data-kick]').forEach(b => b.addEventListener('click', () => gmKickMember(groupId, b.dataset.kick)));
  body.querySelectorAll('[data-approve]').forEach(b => b.addEventListener('click', async () => {
    const { error } = await supabaseClient.rpc('approve_member', { gid: groupId, uid: b.dataset.approve });
    if (error) { alert('승인 실패: ' + error.message); return; }
    gmShowSettings(groupId);
  }));
  body.querySelectorAll('[data-reject]').forEach(b => b.addEventListener('click', async () => {
    if (!confirm('이 가입 신청을 거절할까요?')) return;
    const { error } = await supabaseClient.from('group_members').delete().eq('group_id', groupId).eq('user_id', b.dataset.reject);
    if (error) { alert('거절 실패: ' + error.message); return; }
    gmShowSettings(groupId);
  }));
}

async function gmToggleNotifications(groupId) {
  if (gmBusy) return;
  const current = gmCurrent?.notifications_enabled !== false;
  const next = !current;

  // 즉시 UI 업데이트
  const btn = document.getElementById('gmNotifToggle');
  if (btn) {
    btn.textContent = next ? 'ON' : 'OFF';
    btn.className = `gm-notif-toggle ${next ? 'gm-notif-toggle--on' : 'gm-notif-toggle--off'}`;
  }

  gmBusy = true;
  const { error } = await supabaseClient
    .from('group_members')
    .update({ notifications_enabled: next })
    .eq('group_id', groupId)
    .eq('user_id', currentUser.id);
  gmBusy = false;

  if (error) {
    // 실패 시 롤백
    if (btn) {
      btn.textContent = current ? 'ON' : 'OFF';
      btn.className = `gm-notif-toggle ${current ? 'gm-notif-toggle--on' : 'gm-notif-toggle--off'}`;
    }
    console.error('알림 설정 실패:', error.message);
    return;
  }

  // 로컬 캐시 갱신
  if (gmCurrent) gmCurrent.notifications_enabled = next;
  const g = gmGroups.find(g => g.id === groupId);
  if (g) g.notifications_enabled = next;
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
  const text     = (document.getElementById('gmPostText')?.value    || '').trim().slice(0, 200);
  const date     = document.getElementById('gmPostDate')?.value    || null;
  const dateEnd  = document.getElementById('gmPostDateEnd')?.value || null;
  const category = document.getElementById('gmPostCat')?.value || 'none';
  if (!text) { alert('일정 내용을 입력하세요.'); return; }
  if (!date) { alert('날짜를 선택해주세요.'); document.getElementById('gmPostDate')?.focus(); return; }
  if (dateEnd && date && dateEnd < date) { alert('종료일이 시작일보다 앞에 있어요.'); return; }
  gmBusy = true;
  // 공지 수 확인
  const { count: announceCount } = await supabaseClient
    .from('group_announcements').select('*', { count: 'exact', head: true })
    .eq('group_id', groupId);
  if (announceCount >= ANNOUNCE_MAX) {
    gmBusy = false;
    alert(`공지는 최대 ${ANNOUNCE_MAX}개까지 등록할 수 있어요. 오래된 공지를 삭제해 주세요.`);
    return;
  }
  const { error } = await supabaseClient.from('group_announcements').insert({
    group_id: groupId, author_id: currentUser.id, author_name: _gmDisplayName(),
    text, date: date || null, date_end: dateEnd || null, category
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

// ── 공지 수정 / 고정 ──────────────────────────────────────────
async function gmEditAnnouncement(groupId, a) {
  if (!a) return;
  const newText = prompt('공지 내용 수정', a.text);
  if (newText === null) return;
  const t = newText.trim().slice(0, 200);
  if (!t) { alert('내용을 입력하세요.'); return; }
  const newDate = prompt('날짜 수정 (YYYY-MM-DD, 비우면 날짜 없음)', a.date || '');
  if (newDate === null) return;
  const d = newDate.trim() || null;
  if (d && !/^\d{4}-\d{2}-\d{2}$/.test(d)) { alert('날짜 형식이 올바르지 않아요 (예: 2026-06-20).'); return; }
  const { error } = await supabaseClient.from('group_announcements')
    .update({ text: t, date: d, date_end: d ? a.date_end : null }).eq('id', a.id);
  if (error) { alert('수정 실패: ' + error.message); return; }
  gmOpenGroup(groupId);
}

async function gmTogglePin(groupId, a) {
  if (!a) return;
  const { error } = await supabaseClient.from('group_announcements')
    .update({ pinned: !a.pinned }).eq('id', a.id);
  if (error) { alert('고정 변경 실패: ' + error.message); return; }
  gmOpenGroup(groupId);
}

// ── 공지 댓글 ─────────────────────────────────────────────────
async function gmRefreshComments(groupId, annId) {
  const el = document.getElementById('gmComments-' + annId);
  if (!el) return;
  const { data } = await supabaseClient.from('group_comments')
    .select('*').eq('announcement_id', annId).order('created_at', { ascending: true });
  const isAdmin = gmCurrent && (gmCurrent.role === 'owner' || gmCurrent.role === 'coowner');
  const list = data || [];
  const rows = list.map(c => `
    <div class="gm-comment" data-comment="${c.id}">
      <span class="gm-comment__author">${escHtml(c.author_name || '익명')}</span>
      <span class="gm-comment__text">${escHtml(c.text)}</span>
      ${(c.author_id === currentUser.id || isAdmin) ? `<button class="gm-comment__del" data-delcomment="${c.id}" title="삭제">×</button>` : ''}
    </div>`).join('') || '<div class="gm-comment gm-comment--empty">첫 댓글/질문을 남겨보세요.</div>';
  el.innerHTML = rows + `
    <div class="gm-comment-form">
      <input class="gm-input gm-comment-input" data-cinput="${annId}" type="text" maxlength="300" placeholder="댓글 / 질문…" />
      <button class="gm-btn gm-btn--primary gm-comment-send" data-csend="${annId}">등록</button>
    </div>`;
  el.hidden = false;
  el.querySelector('[data-csend]')?.addEventListener('click', () => gmAddComment(groupId, annId));
  el.querySelector('[data-cinput]')?.addEventListener('keydown', e => { if (e.key === 'Enter') gmAddComment(groupId, annId); });
  el.querySelectorAll('[data-delcomment]').forEach(b =>
    b.addEventListener('click', () => gmDeleteComment(groupId, b.dataset.delcomment, annId)));
  const badge = document.querySelector(`[data-comments="${annId}"]`);
  if (badge) badge.innerHTML = `💬${list.length ? ' ' + list.length : ''}`;
}

async function gmAddComment(groupId, annId) {
  const inp = document.querySelector(`[data-cinput="${annId}"]`);
  const text = (inp?.value || '').trim().slice(0, 300);
  if (!text) return;
  const { error } = await supabaseClient.from('group_comments').insert({
    announcement_id: annId, group_id: groupId, author_id: currentUser.id,
    author_name: _gmDisplayName(), text
  });
  if (error) { alert('댓글 등록 실패: ' + error.message); return; }
  if (inp) inp.value = '';
  gmRefreshComments(groupId, annId);
}

async function gmDeleteComment(groupId, commentId, annId) {
  const { error } = await supabaseClient.from('group_comments').delete().eq('id', commentId);
  if (error) { alert('댓글 삭제 실패: ' + error.message); return; }
  gmRefreshComments(groupId, annId);
}

// ── 일정 독촉 (즉시 푸시) ─────────────────────────────────────
async function gmNudge(groupId, ann, members) {
  if (!ann) return;
  const others = (members || []).filter(m => m.user_id !== currentUser.id);
  if (!others.length) { alert('독촉할 다른 멤버가 없어요.'); return; }
  const listStr = others.map((m, i) => `${i + 1}. ${m.display_name || '멤버'}`).join('\n');
  const pick = prompt(`'${ann.text}' 독촉을 누구에게 보낼까요?\n번호 입력 (0 = 전체)\n\n0. 전체\n${listStr}`, '0');
  if (pick === null) return;
  const n = parseInt(pick.trim(), 10);
  let targets;
  if (n === 0) targets = others;
  else if (n >= 1 && n <= others.length) targets = [others[n - 1]];
  else { alert('올바른 번호를 입력하세요.'); return; }

  const { data: { session } } = await supabaseClient.auth.getSession();
  if (!session?.access_token) return;
  const res = await fetch('/api/group-nudge', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${session.access_token}` },
    body: JSON.stringify({ group_id: groupId, target_ids: targets.map(t => t.user_id), text: ann.text }),
  }).catch(() => null);
  _gmToast(res && res.ok ? `👉 ${targets.length}명에게 독촉을 보냈어요!` : '독촉 전송에 실패했어요.');
}

// ── 가입 승인 / 거절 / 강퇴 / 비공개 ──────────────────────────
async function gmApproveMember(groupId, userId) {
  const { error } = await supabaseClient.rpc('approve_member', { gid: groupId, uid: userId });
  if (error) { alert('승인 실패: ' + error.message); return; }
  gmOpenGroup(groupId);
}

async function gmRejectMember(groupId, userId) {
  if (!confirm('이 가입 신청을 거절할까요?')) return;
  const { error } = await supabaseClient.from('group_members').delete()
    .eq('group_id', groupId).eq('user_id', userId);
  if (error) { alert('거절 실패: ' + error.message); return; }
  gmOpenGroup(groupId);
}

async function gmKickMember(groupId, userId) {
  if (!confirm('이 멤버를 그룹에서 내보낼까요?')) return;
  const { error } = await supabaseClient.from('group_members').delete()
    .eq('group_id', groupId).eq('user_id', userId);
  if (error) { alert('강퇴 실패: ' + error.message); return; }
  gmShowSettings(groupId);
}

async function gmSetPrivate(groupId, isPrivate) {
  const { error } = await supabaseClient.from('groups').update({ is_private: isPrivate }).eq('id', groupId);
  if (error) { alert('변경 실패: ' + error.message); return; }
  const g = gmGroups.find(g => g.id === groupId); if (g) g.is_private = isPrivate;
  if (gmCurrent?.id === groupId) gmCurrent.is_private = isPrivate;
}

// ──────────────────────────────────────────────
// 권한 부여/해제 (owner)
// ──────────────────────────────────────────────
async function gmSetRole(groupId, userId, role) {
  const { error } = await supabaseClient.from('group_members')
    .update({ role }).eq('group_id', groupId).eq('user_id', userId);
  if (error) { alert('권한 변경 실패: ' + error.message); return; }
  gmShowSettings(groupId);
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
// ── 그룹 링크 추가 / 삭제 ─────────────────────────────────────
async function gmAddLink(groupId) {
  const title = (document.getElementById('gmLinkTitle')?.value || '').trim().slice(0, 80);
  let   url   = (document.getElementById('gmLinkUrl')?.value   || '').trim().slice(0, 500);
  if (!title) { alert('링크 제목을 입력하세요.'); return; }
  if (!url)   { alert('URL을 입력하세요.'); return; }
  if (!/^https?:\/\//i.test(url)) url = 'https://' + url;

  const { error } = await supabaseClient.from('group_links').insert({
    group_id: groupId, author_id: currentUser.id, title, url,
  });
  if (error) { alert('링크 추가 실패: ' + error.message); return; }
}

async function gmDeleteLink(id, groupId) {
  if (!confirm('이 링크를 삭제할까요?')) return;
  const { error } = await supabaseClient.from('group_links').delete().eq('id', id);
  if (error) { alert('삭제 실패: ' + error.message); }
}

// 공지 일정 → 내 리스트로 추가
//   날짜 없음 → 할일 풀
//   날짜 있음 → 구글 캘린더(연결 시) / 미연결 시 해당 날짜 스케줄
// ──────────────────────────────────────────────
async function gmAddToMyList(ann, btn, groupId) {
  if (!ann) return;
  if (btn) { btn.disabled = true; btn.textContent = '추가 중…'; }

  try {
    let destination = '';
    if (!ann.date) {
      const task = { id: uid(), text: ann.text };
      if (ann.deadline) task.deadline = ann.deadline;
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
  if (groupId) { item.groupId = groupId; item.annId = ann.id; }
  state.schedule[ann.date].push(item);
  saveState();
  renderApp();
}

// ──────────────────────────────────────────────
// 그룹 채팅
// ──────────────────────────────────────────────
let _chatPollTimer = null;
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
  const inp = document.getElementById('gmChatInput');
  const text = (inp?.value || '').trim().slice(0, 500);
  if (!text) return;

  const sendBtn = document.getElementById('gmChatSend');
  if (sendBtn) sendBtn.disabled = true;
  if (inp) inp.value = '';

  const { error } = await supabaseClient.from('group_comments').insert({
    group_id: groupId,
    announcement_id: null,
    author_id: currentUser.id,
    author_name: _gmDisplayName(),
    text,
  });

  if (sendBtn) sendBtn.disabled = false;
  if (error) {
    alert('전송 실패: ' + error.message);
    if (inp) inp.value = text;
    return;
  }
  await _gmLoadChat(groupId, false);
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

  const tabEls  = ['Home','Group','Settings'].map(id => document.getElementById('tab'+id));
  const N = 3;

  // ── 슬라이더 이동 ──────────────────────────────
  function moveSlider(index, animate = true) {
    if (!slider || !tabBar) return;
    const w = tabBar.offsetWidth / N;
    slider.style.transition = animate
      ? 'left 0.42s cubic-bezier(0.34,1.56,0.64,1), width 0.28s ease'
      : 'none';
    slider.style.left  = (w * index + 4) + 'px';
    slider.style.width = (w - 8) + 'px';
  }

  // ── 탭 활성화 ──────────────────────────────────
  let _activeIdx = 0;
  function activateTab(index) {
    tabEls.forEach((el, i) => {
      if (!el) return;
      const wasActive = el.classList.contains('is-active');
      el.classList.toggle('is-active', i === index);
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
    _activeIdx = index;
  }

  const nameToIdx = { home: 0, group: 1, settings: 2 };
  function setActiveTab(name) { activateTab(nameToIdx[name] ?? 0); }

  // 초기 슬라이더 위치
  requestAnimationFrame(() => moveSlider(0, false));
  window.addEventListener('resize', () => moveSlider(_activeIdx, false));

  // ── 모달 열기/닫기 ────────────────────────────
  function openGroupTab() {
    if (!currentUser) { alert('그룹 기능은 로그인 후 이용 가능합니다.'); return; }
    if (settingsModal) settingsModal.hidden = true;
    gmOpenModal();
    setActiveTab('group');
  }

  function closeAll() {
    gmCloseModal();
    if (settingsModal) settingsModal.hidden = true;
    setActiveTab('home');
  }

  // ── 탭 클릭 ──────────────────────────────────
  tabEls[0]?.addEventListener('click', closeAll);
  tabEls[1]?.addEventListener('click', openGroupTab);
  tabEls[2]?.addEventListener('click', () => {
    if (!currentUser) { alert('로그인 후 이용 가능합니다.'); return; }
    gmCloseModal();
    document.getElementById('settingsBtn')?.click();
    setActiveTab('settings');
  });

  // 헤더 버튼
  document.getElementById('groupBtn')?.addEventListener('click', e => { e.preventDefault(); openGroupTab(); });
  document.getElementById('settingsBtn')?.addEventListener('click', () => setActiveTab('settings'));

  // 닫기 버튼 → 홈
  document.getElementById('groupCloseBtn')?.addEventListener('click', closeAll);
  document.getElementById('settingsCloseBtn')?.addEventListener('click', closeAll);
  groupModal?.addEventListener('click', e => { if (e.target === groupModal) closeAll(); });
  settingsModal?.addEventListener('click', e => { if (e.target === settingsModal) closeAll(); });

  // 뒤로가기(#home) 지원
  window.addEventListener('hashchange', () => {
    if (!window.location.hash || window.location.hash === '#home') closeAll();
  });

  // ── 슬라이더 드래그 ──────────────────────────
  let dragActive = false, hasDragged = false, dragStartX = 0;

  tabBar?.addEventListener('pointerdown', e => {
    dragActive = true; hasDragged = false; dragStartX = e.clientX;
    tabBar.setPointerCapture(e.pointerId);
  });

  tabBar?.addEventListener('pointermove', e => {
    if (!dragActive) return;
    if (Math.abs(e.clientX - dragStartX) > 8) hasDragged = true;
    if (!hasDragged) return;
    const rect = tabBar.getBoundingClientRect();
    const relX = Math.max(0, Math.min(e.clientX - rect.left, rect.width - 1));
    moveSlider(Math.floor(relX / (rect.width / N)), false);
  });

  tabBar?.addEventListener('pointerup', e => {
    if (!dragActive) return;
    dragActive = false;
    if (!hasDragged) return;
    const rect = tabBar.getBoundingClientRect();
    const relX = Math.max(0, Math.min(e.clientX - rect.left, rect.width - 1));
    const index = Math.floor(relX / (rect.width / N));
    // 드래그 완료 → 해당 탭 활성화
    activateTab(index);
    if (index === 0) closeAll();
    else if (index === 1) openGroupTab();
    else if (index === 2) tabEls[2]?.click();
  });

  // ── 스와이프 다운 → 모달 닫기 ───────────────
  function addSwipeToDismiss(modal, onDismiss) {
    const box = modal?.querySelector('.modal-box');
    if (!box) return;
    let startY = 0, dy = 0, active = false;

    box.addEventListener('touchstart', e => {
      const body = box.querySelector('.modal-body');
      if (body && body.scrollTop > 5) return;
      startY = e.touches[0].clientY; dy = 0; active = true;
    }, { passive: true });

    box.addEventListener('touchmove', e => {
      if (!active) return;
      dy = e.touches[0].clientY - startY;
      if (dy > 0) {
        box.style.transition = 'none';
        box.style.transform  = `translateY(${Math.min(dy, 280)}px)`;
      } else {
        active = false; box.style.transform = '';
      }
    }, { passive: true });

    box.addEventListener('touchend', () => {
      if (!active) return;
      active = false;
      if (dy > 90) {
        box.style.transition = 'transform 0.22s ease-in';
        box.style.transform  = 'translateY(110%)';
        setTimeout(() => { box.style.transform = ''; box.style.transition = ''; onDismiss(); }, 220);
      } else {
        box.style.transition = 'transform 0.35s cubic-bezier(0.34,1.56,0.64,1)';
        box.style.transform  = '';
        setTimeout(() => { box.style.transition = ''; }, 350);
      }
    }, { passive: true });
  }

  addSwipeToDismiss(groupModal,    () => { gmCloseModal(); setActiveTab('home'); });
  addSwipeToDismiss(settingsModal, () => { if (settingsModal) settingsModal.hidden = true; setActiveTab('home'); });

  setTimeout(() => setActiveTab('home'), 350);
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
