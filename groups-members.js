
function gmNudge(groupId, ann, members) {
  if (!ann) return;
  const others = (members || []).filter(m => m.user_id !== currentUser.id);
  if (!others.length) { _gmToast('독촉할 다른 멤버가 없어요.'); return; }

  const selected = new Set(others.map(m => m.user_id)); // 기본 전체 선택

  const overlay = document.createElement('div');
  overlay.className = 'gm-nudge-overlay';
  overlay.innerHTML = `
    <div class="gm-nudge-sheet" role="dialog" aria-modal="true">
      <div class="gm-nudge-head">
        <span class="gm-nudge-emoji">👉</span>
        <div class="gm-nudge-titles">
          <p class="gm-nudge-title">독촉 보내기</p>
          <p class="gm-nudge-sub">${escHtml(ann.text)}</p>
        </div>
      </div>
      <button class="gm-nudge-all" id="gmNudgeAll">전체 선택 해제</button>
      <div class="gm-nudge-list">
        ${others.map(m => `
          <button class="gm-nudge-item is-on" data-uid="${m.user_id}">
            <span class="gm-nudge-avatar">${escHtml((m.display_name || '멤').slice(0,1))}</span>
            <span class="gm-nudge-name">${escHtml(m.display_name || '멤버')}</span>
            <span class="gm-nudge-check">✓</span>
          </button>`).join('')}
      </div>
      <div class="gm-nudge-actions">
        <button class="gm-btn gm-nudge-cancel" id="gmNudgeCancel">취소</button>
        <button class="gm-btn gm-btn--primary gm-nudge-send" id="gmNudgeSend">👉 보내기 (${selected.size})</button>
      </div>
    </div>`;
  document.body.appendChild(overlay);
  requestAnimationFrame(() => overlay.classList.add('is-open'));

  const sendBtn = overlay.querySelector('#gmNudgeSend');
  const allBtn  = overlay.querySelector('#gmNudgeAll');
  const close = () => {
    overlay.classList.remove('is-open');
    setTimeout(() => overlay.remove(), 200);
  };
  const refresh = () => {
    sendBtn.textContent = `👉 보내기 (${selected.size})`;
    sendBtn.disabled = selected.size === 0;
    const allOn = selected.size === others.length;
    allBtn.textContent = allOn ? '전체 선택 해제' : '전체 선택';
  };

  overlay.querySelectorAll('.gm-nudge-item').forEach(btn => {
    btn.addEventListener('click', () => {
      const uid = btn.dataset.uid;
      if (selected.has(uid)) { selected.delete(uid); btn.classList.remove('is-on'); }
      else { selected.add(uid); btn.classList.add('is-on'); }
      refresh();
    });
  });
  allBtn.addEventListener('click', () => {
    const allOn = selected.size === others.length;
    selected.clear();
    overlay.querySelectorAll('.gm-nudge-item').forEach(btn => {
      if (!allOn) { selected.add(btn.dataset.uid); btn.classList.add('is-on'); }
      else btn.classList.remove('is-on');
    });
    refresh();
  });
  overlay.querySelector('#gmNudgeCancel').addEventListener('click', close);
  overlay.addEventListener('click', e => { if (e.target === overlay) close(); });

  sendBtn.addEventListener('click', async () => {
    if (!selected.size) return;
    const targets = others.filter(m => selected.has(m.user_id));
    sendBtn.disabled = true;
    sendBtn.textContent = '보내는 중…';
    const ok = await _gmSendNudge(groupId, ann, targets);
    close();
    _gmToast(ok ? `👉 ${targets.length}명에게 독촉을 보냈어요!` : '독촉 전송에 실패했어요.');
  });
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
