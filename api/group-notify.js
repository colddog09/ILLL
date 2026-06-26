import { createClient } from '@supabase/supabase-js';
import webpush from 'web-push';
import nodemailer from 'nodemailer';

webpush.setVapidDetails(
  'mailto:admin@o1chu.my',
  process.env.VAPID_PUBLIC_KEY,
  process.env.VAPID_PRIVATE_KEY
);

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  const token = (req.headers.authorization || '').replace('Bearer ', '').trim();
  if (!token) return res.status(401).json({ error: 'Unauthorized' });

  const { group_id, text, date } = req.body || {};
  if (!group_id || !text) return res.status(400).json({ error: 'group_id and text required' });

  try {
    // ── 발신자 JWT 검증 ──
    const userClient = createClient(
      process.env.SUPABASE_URL,
      process.env.SUPABASE_ANON_KEY,
      { global: { headers: { Authorization: `Bearer ${token}` } } }
    );
    const { data: { user }, error: authErr } = await userClient.auth.getUser(token);
    if (authErr || !user) return res.status(401).json({ error: 'Invalid token' });

    // ── 서비스 롤 (RLS 우회) ──
    const admin = createClient(
      process.env.SUPABASE_URL,
      process.env.SUPABASE_SERVICE_ROLE_KEY
    );

    // ── 발신자 권한 확인 ──
    const { data: membership } = await admin
      .from('group_members')
      .select('role, display_name')
      .eq('group_id', group_id)
      .eq('user_id', user.id)
      .single();

    if (!membership || !['owner', 'announcer', 'coowner'].includes(membership.role)) {
      return res.status(403).json({ error: 'Forbidden' });
    }
    const authorName = membership.display_name || '그룹 멤버';

    // ── 그룹 이름 + 수신 멤버 + 구독 병렬 조회 ──
    const [{ data: group }, { data: members }] = await Promise.all([
      admin.from('groups').select('name').eq('id', group_id).single(),
      admin.from('group_members').select('user_id').eq('group_id', group_id).neq('user_id', user.id).neq('notifications_enabled', false),
    ]);

    if (!members?.length) return res.status(200).json({ ok: true, sent: 0 });

    const memberIds = members.map(m => m.user_id);
    const groupName  = group?.name || '그룹';
    const notifBody  = date ? `📅 ${date}  ${text}` : text;

    // ── 1) 웹 푸시 발송 ──
    const { data: subs } = await admin
      .from('push_subscriptions')
      .select('user_id, subscription')
      .in('user_id', memberIds);

    const pushTasks = (subs || []).map(({ user_id: uid, subscription: sub }) => {
      if (!sub) return Promise.resolve();
      return webpush.sendNotification(
        sub,
        JSON.stringify({
          title: `👥 ${groupName}`,
          body:  notifBody,
          data:  { url: '/#group' },
        })
      ).catch(async err => {
        if (err.statusCode === 410) {
          await admin.from('push_subscriptions').delete().eq('user_id', uid);
        }
        console.warn(`push failed uid=${uid}:`, err.statusCode);
      });
    });

    // ── 2) 이메일 발송 (오일추 계정에서, 작성자 이름 포함) ──
    const emailPromise = sendGroupEmail(admin, memberIds, { groupName, authorName, text, date })
      .catch(err => { console.warn('email send failed:', err?.message); return 0; });

    const [, emailSent] = await Promise.all([Promise.all(pushTasks), emailPromise]);

    return res.status(200).json({ ok: true, push: pushTasks.length, email: emailSent || 0 });

  } catch (err) {
    console.error('group-notify error:', err);
    return res.status(500).json({ error: err.message });
  }
}

// ── 그룹 멤버에게 이메일 발송 (Gmail SMTP, BCC로 프라이버시 보호) ──
async function sendGroupEmail(admin, memberIds, { groupName, authorName, text, date }) {
  const gmailUser = process.env.GMAIL_USER;
  const gmailPass = process.env.GMAIL_APP_PASSWORD;
  // 자격증명 미설정 시 조용히 건너뜀 (푸시는 정상 동작)
  if (!gmailUser || !gmailPass) return 0;
  if (!memberIds?.length) return 0;

  // 멤버 이메일 조회 (Supabase Auth)
  const emails = (await Promise.all(
    memberIds.map(async uid => {
      try {
        const { data } = await admin.auth.admin.getUserById(uid);
        return data?.user?.email || null;
      } catch { return null; }
    })
  )).filter(Boolean);
  if (!emails.length) return 0;

  const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: { user: gmailUser, pass: gmailPass },
  });

  const dateLine = date ? `📅 날짜: ${date}` : '📅 날짜: 미정';
  const appUrl = 'https://o1chu.my/#group';
  const safe = s => String(s || '').replace(/[<>&]/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;' }[c]));

  const html = `
    <div style="font-family:-apple-system,'Apple SD Gothic Neo',sans-serif;max-width:480px;margin:0 auto;padding:24px;color:#1e1b4b">
      <div style="font-size:13px;color:#6c63ff;font-weight:700;margin-bottom:6px">👥 ${safe(groupName)} 그룹 새 일정</div>
      <h2 style="font-size:20px;margin:0 0 14px">${safe(text)}</h2>
      <div style="background:#f7f8fc;border-radius:12px;padding:14px 16px;font-size:14px;line-height:1.7">
        <div>${dateLine}</div>
        <div>✍️ 작성자: ${safe(authorName)}</div>
      </div>
      <a href="${appUrl}" style="display:inline-block;margin-top:18px;background:#6c63ff;color:#fff;text-decoration:none;padding:11px 20px;border-radius:10px;font-weight:700;font-size:14px">오일추에서 보기 →</a>
      <p style="font-size:12px;color:#9ca3af;margin-top:20px">이 메일은 '${safe(groupName)}' 그룹의 새 일정 공지입니다. 알림을 끄려면 오일추 그룹 화면에서 🔔를 꺼주세요.</p>
    </div>`;

  await transporter.sendMail({
    from: `"오일추 일정 알림" <${gmailUser}>`,
    to: gmailUser,            // 대표 수신자(자기 자신), 실제 수신자는 BCC
    bcc: emails,              // 멤버 이메일 노출 방지
    subject: `[오일추] ${groupName} 새 일정: ${text}`.slice(0, 120),
    html,
  });
  return emails.length;
}
