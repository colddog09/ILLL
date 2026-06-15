import { createClient } from '@supabase/supabase-js';
import webpush from 'web-push';

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  try {
    webpush.setVapidDetails(
      'mailto:admin@o1chu.my',
      process.env.VAPID_PUBLIC_KEY,
      process.env.VAPID_PRIVATE_KEY
    );
  } catch (err) {
    console.error('[group-nudge] VAPID init error:', err.message);
    return res.status(500).json({ error: 'vapid_init_failed' });
  }

  const token = (req.headers.authorization || '').replace('Bearer ', '').trim();
  if (!token) return res.status(401).json({ error: 'Unauthorized' });

  const { group_id, target_ids, text } = req.body || {};
  if (!group_id || !Array.isArray(target_ids) || !target_ids.length || !text) {
    return res.status(400).json({ error: 'group_id, target_ids, text required' });
  }

  try {
    // 발신자 검증
    const userClient = createClient(
      process.env.SUPABASE_URL,
      process.env.SUPABASE_ANON_KEY,
      { global: { headers: { Authorization: `Bearer ${token}` } } }
    );
    const { data: { user }, error: authErr } = await userClient.auth.getUser(token);
    if (authErr || !user) return res.status(401).json({ error: 'Invalid token' });

    const admin = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

    // 발신자가 해당 그룹의 공지권한자(owner/announcer/coowner)인지 확인
    const { data: me } = await admin
      .from('group_members')
      .select('role, display_name, status')
      .eq('group_id', group_id).eq('user_id', user.id).single();
    if (!me || me.status === 'pending' || !['owner', 'announcer', 'coowner'].includes(me.role)) {
      return res.status(403).json({ error: 'Forbidden' });
    }

    // 대상이 같은 그룹의 active 멤버인지 필터
    const { data: validMembers } = await admin
      .from('group_members')
      .select('user_id')
      .eq('group_id', group_id).eq('status', 'active')
      .in('user_id', target_ids);
    const validIds = (validMembers || []).map(m => m.user_id).filter(id => id !== user.id);
    if (!validIds.length) return res.status(200).json({ ok: true, sent: 0 });

    const { data: group } = await admin.from('groups').select('name').eq('id', group_id).single();
    const { data: subs } = await admin
      .from('push_subscriptions').select('user_id, subscription').in('user_id', validIds);
    if (!subs?.length) return res.status(200).json({ ok: true, sent: 0 });

    const fromName  = me.display_name || '누군가';
    const groupName = group?.name || '그룹';

    const tasks = subs.map(({ user_id: uid, subscription: sub }) => {
      if (!sub) return Promise.resolve();
      return webpush.sendNotification(sub, JSON.stringify({
        title: `👉 ${groupName} 독촉`,
        body:  `${fromName}님이 "${text}" 하라고 독촉했어요!`,
        data:  { url: '/#group' },
      })).catch(async err => {
        if (err.statusCode === 410 || err.statusCode === 403) {
          await admin.from('push_subscriptions').delete().eq('user_id', uid);
        }
        console.warn(`[group-nudge] push failed uid=${uid}:`, err.statusCode);
      });
    });

    await Promise.all(tasks);
    return res.status(200).json({ ok: true, sent: tasks.length });
  } catch (err) {
    console.error('group-nudge error:', err);
    return res.status(500).json({ error: err.message });
  }
}
