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
    const linkChip = a.link ? `<a class="gm-ann__link" href="${escHtml(a.link)}" target="_blank" rel="noopener noreferrer" title="링크 열기">🔗 링크</a>` : '';
    return `
      <div class="gm-ann${a.pinned ? ' gm-ann--pinned' : ''}" data-ann="${a.id}">
        <div class="gm-ann__main">
          <div class="gm-ann__head">${pinChip}${catChip}<span class="gm-ann__text">${escHtml(a.text)}</span></div>
          <div class="gm-ann__meta">${dateLabel}<span class="gm-ann__author">${escHtml(a.author_name || '익명')}</span>${linkChip}</div>
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
      <div class="gm-post__tabs">
        <button class="gm-post__tab gm-post__tab--on" data-postmode="single">📢 하나씩</button>
        <button class="gm-post__tab" data-postmode="bulk">📋 여러 개 한 번에</button>
      </div>

      <div id="gmPostSingle" class="gm-post__panel">
        <input id="gmPostText" class="gm-input" type="text" maxlength="200" placeholder="일정 내용 (예: 수학 수행평가)" />
        <div class="gm-post__date-row">
          <input id="gmPostDate" class="gm-input gm-input--date" type="date" />
          <span class="gm-post__tilde">~</span>
          <input id="gmPostDateEnd" class="gm-input gm-input--date" type="date" placeholder="종료일 (선택)" />
        </div>
        <input id="gmPostLink" class="gm-input" type="url" maxlength="500" placeholder="🔗 클래스룸/링크 (선택)" />
        <div class="gm-post__row">
          <select id="gmPostCat" class="gm-input gm-cat-select">
            <option value="none">분류 없음</option>
            <option value="exam">🔴 시험</option>
            <option value="hw">🟡 과제</option>
            <option value="event">🟢 행사</option>
          </select>
          <button id="gmPostBtn" class="gm-btn gm-btn--primary">공지</button>
        </div>
      </div>

      <div id="gmPostBulk" class="gm-post__panel" hidden>
        <p class="gm-bulk__hint">정리한 내용을 줄마다 한 개씩 붙여넣으세요. 날짜(6/20, 6월 20일 등)와 분류(시험·과제·행사)는 자동으로 인식돼요.</p>
        <textarea id="gmBulkText" class="gm-input gm-bulk__text" rows="5" placeholder="6/20 수학 수행평가&#10;6/22 영어 과제 제출&#10;7/1 체육대회"></textarea>
        <div class="gm-post__row">
          <button id="gmBulkPreviewBtn" class="gm-btn gm-btn--ghost">미리보기</button>
        </div>
        <div id="gmBulkPreview" class="gm-bulk__preview" hidden></div>
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
  // 공지 입력 모드 전환 (하나씩 / 여러 개)
  body.querySelectorAll('[data-postmode]').forEach(tab =>
    tab.addEventListener('click', () => {
      const mode = tab.dataset.postmode;
      body.querySelectorAll('[data-postmode]').forEach(t => t.classList.toggle('gm-post__tab--on', t === tab));
      const single = document.getElementById('gmPostSingle');
      const bulk   = document.getElementById('gmPostBulk');
      if (single) single.hidden = mode !== 'single';
      if (bulk)   bulk.hidden   = mode !== 'bulk';
    }));
  document.getElementById('gmBulkPreviewBtn')?.addEventListener('click', gmBulkPreview);
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
