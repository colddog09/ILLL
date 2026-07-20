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
  const link     = _gmNormalizeLink(document.getElementById('gmPostLink')?.value || '');
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
    text, date: date || null, date_end: dateEnd || null, category, link: link || null
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

// URL 정규화: 비어있으면 '', http(s) 없으면 https:// 보정
function _gmNormalizeLink(raw) {
  const v = (raw || '').trim();
  if (!v) return '';
  if (/^https?:\/\//i.test(v)) return v.slice(0, 500);
  return ('https://' + v).slice(0, 500);
}

// ──────────────────────────────────────────────
// 텍스트 일괄 파싱 → 여러 공지
//   줄마다 한 개. 날짜(6/20, 6.20, 6월 20일, 2026-06-20)와
//   분류(시험·수행·평가 / 과제·숙제·제출 / 행사·대회·축제…) 자동 인식.
// ──────────────────────────────────────────────
function _gmCategoryOf(text) {
  if (/시험|수행|평가|중간고사|기말/.test(text)) return 'exam';
  if (/과제|숙제|제출|레포트|보고서|리포트/.test(text)) return 'hw';
  if (/행사|대회|축제|체험|소풍|발표회|MT|봉사/.test(text)) return 'event';
  return 'none';
}

function _gmInferYear(month, day) {
  const now = new Date();
  let year = now.getFullYear();
  const cand = new Date(year, month - 1, day);
  // 오늘보다 한참 과거(어제 이전)면 내년으로
  const todayMid = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  if (cand < todayMid) year += 1;
  return year;
}

function _gmParseBulkLine(line) {
  let s = line.trim();
  if (!s) return null;
  let date = null;

  // 2026-06-20 / 2026.6.20 / 2026/6/20
  let m = s.match(/(20\d{2})[.\-/]\s*(\d{1,2})[.\-/]\s*(\d{1,2})/);
  if (m) {
    const [mo, d] = [parseInt(m[2]), parseInt(m[3])];
    date = `${m[1]}-${String(mo).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
    s = s.replace(m[0], ' ');
  }
  // 6월 20일 / 6월20일
  if (!date && (m = s.match(/(\d{1,2})\s*월\s*(\d{1,2})\s*일?/))) {
    const mo = parseInt(m[1]), d = parseInt(m[2]);
    if (mo >= 1 && mo <= 12 && d >= 1 && d <= 31) {
      date = `${_gmInferYear(mo, d)}-${String(mo).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
      s = s.replace(m[0], ' ');
    }
  }
  // 6/20 · 6.20 · 6-20 (월/일)
  if (!date && (m = s.match(/(?:^|\s)(\d{1,2})[./\-](\d{1,2})(?=\s|$)/))) {
    const mo = parseInt(m[1]), d = parseInt(m[2]);
    if (mo >= 1 && mo <= 12 && d >= 1 && d <= 31) {
      date = `${_gmInferYear(mo, d)}-${String(mo).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
      s = s.replace(m[0], ' ');
    }
  }

  // 앞쪽의 불릿/번호 기호 제거
  let text = s.replace(/^[\s\-–•▪◦*·.\d)\].]+/, '').replace(/\s+/g, ' ').trim();
  if (!text) text = line.trim();
  text = text.slice(0, 200);
  return { text, date, category: _gmCategoryOf(line) };
}

function _gmParseBulk(raw) {
  return (raw || '').split(/\r?\n/).map(_gmParseBulkLine).filter(Boolean);
}

let _gmBulkParsed = [];

function gmBulkPreview() {
  const raw = document.getElementById('gmBulkText')?.value || '';
  const box = document.getElementById('gmBulkPreview');
  if (!box) return;
  _gmBulkParsed = _gmParseBulk(raw);
  if (!_gmBulkParsed.length) {
    box.hidden = false;
    box.innerHTML = '<div class="gm-empty">인식된 일정이 없어요. 줄마다 한 개씩 입력해주세요.</div>';
    return;
  }
  const CATL = { exam: '🔴 시험', hw: '🟡 과제', event: '🟢 행사', none: '분류 없음' };
  const rows = _gmBulkParsed.map((p, i) => `
    <div class="gm-bulk__item">
      <span class="gm-bulk__num">${i + 1}</span>
      <span class="gm-bulk__itext">${escHtml(p.text)}</span>
      <span class="gm-bulk__idate">${p.date ? '📅 ' + escHtml(p.date) : '날짜 없음'}</span>
      <span class="gm-bulk__icat">${CATL[p.category]}</span>
    </div>`).join('');
  box.hidden = false;
  box.innerHTML = `
    <p class="gm-bulk__count">${_gmBulkParsed.length}개 일정 인식됨</p>
    ${rows}
    <button id="gmBulkPostBtn" class="gm-btn gm-btn--primary gm-bulk__post">전체 공지하기</button>`;
  box.querySelector('#gmBulkPostBtn')?.addEventListener('click', () => gmBulkPost(gmCurrent?.id));
}

async function gmBulkPost(groupId) {
  if (gmBusy || !groupId) return;
  if (!_gmBulkParsed.length) { alert('먼저 미리보기로 확인해주세요.'); return; }
  const items = _gmBulkParsed.filter(p => p.text);
  if (!items.length) return;
  gmBusy = true;
  const { count: announceCount } = await supabaseClient
    .from('group_announcements').select('*', { count: 'exact', head: true }).eq('group_id', groupId);
  if ((announceCount || 0) + items.length > ANNOUNCE_MAX) {
    gmBusy = false;
    alert(`공지는 최대 ${ANNOUNCE_MAX}개까지예요. 현재 ${announceCount}개 + ${items.length}개는 초과돼요. 일부만 입력하거나 오래된 공지를 삭제해주세요.`);
    return;
  }
  const rows = items.map(p => ({
    group_id: groupId, author_id: currentUser.id, author_name: _gmDisplayName(),
    text: p.text, date: p.date || null, date_end: null, category: p.category, link: null
  }));
  const { error } = await supabaseClient.from('group_announcements').insert(rows);
  gmBusy = false;
  if (error) { alert('일괄 등록 실패: ' + error.message); return; }

  // 일괄은 요약 1건으로 알림/이메일 (스팸 방지)
  const summary = items.length === 1
    ? items[0].text
    : `새 일정 ${items.length}개: ${items[0].text} 외 ${items.length - 1}개`;
  supabaseClient.auth.getSession().then(({ data: { session } }) => {
    if (!session?.access_token) return;
    fetch('/api/group-notify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${session.access_token}` },
      body: JSON.stringify({ group_id: groupId, text: summary, date: null }),
    }).catch(() => {});
  });

  _gmBulkParsed = [];
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
async function _gmSendNudge(groupId, ann, targets) {
  const { data: { session } } = await supabaseClient.auth.getSession();
  if (!session?.access_token) return false;
  const res = await fetch('/api/group-nudge', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${session.access_token}` },
    body: JSON.stringify({ group_id: groupId, target_ids: targets.map(t => t.user_id), text: ann.text }),
  }).catch(() => null);
  return !!(res && res.ok);
}
