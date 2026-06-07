import { createClient } from '@supabase/supabase-js';
import webpush from 'web-push';

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
      .select('role')
      .eq('group_id', group_id)
      .eq('user_id', user.id)
      .single();

    if (!membership || !['owner', 'announcer'].includes(membership.role)) {
      return res.status(403).json({ error: 'Forbidden' });
    }

    // ── 그룹 이름 + 수신 멤버 + 구독 병렬 조회 ──
    const [{ data: group }, { data: members }] = await Promise.all([
      admin.from('groups').select('name').eq('id', group_id).single(),
      admin.from('group_members').select('user_id').eq('group_id', group_id).neq('user_id', user.id),
    ]);

    if (!members?.length) return res.status(200).json({ ok: true, sent: 0 });

    const memberIds = members.map(m => m.user_id);
    const { data: subs } = await admin
      .from('push_subscriptions')
      .select('user_id, subscription')
      .in('user_id', memberIds);

    if (!subs?.length) return res.status(200).json({ ok: true, sent: 0 });

    // ── 알림 발송 ──
    const groupName  = group?.name || '그룹';
    const notifBody  = date ? `📅 ${date}  ${text}` : text;

    const tasks = subs.map(({ user_id: uid, subscription: sub }) => {
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

    await Promise.all(tasks);
    return res.status(200).json({ ok: true, sent: tasks.length });

  } catch (err) {
    console.error('group-notify error:', err);
    return res.status(500).json({ error: err.message });
  }
}
