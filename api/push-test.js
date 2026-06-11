import { createClient } from '@supabase/supabase-js';
import webpush from 'web-push';

webpush.setVapidDetails(
  'mailto:admin@o1chu.my',
  process.env.VAPID_PUBLIC_KEY,
  process.env.VAPID_PRIVATE_KEY
);

async function authedUser(req) {
  const token = (req.headers.authorization || '').replace('Bearer ', '').trim();
  if (!token) return null;
  const { data: { user }, error } = await createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_ANON_KEY,
    { global: { headers: { Authorization: `Bearer ${token}` } } }
  ).auth.getUser(token);
  return (error || !user) ? null : user;
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  const user = await authedUser(req);
  if (!user) return res.status(401).json({ error: 'Unauthorized' });

  const admin = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
  const { data: row } = await admin
    .from('push_subscriptions')
    .select('subscription')
    .eq('user_id', user.id)
    .maybeSingle();

  if (!row?.subscription) {
    return res.status(404).json({ error: 'NO_SUBSCRIPTION' });
  }

  try {
    await webpush.sendNotification(
      row.subscription,
      JSON.stringify({
        title: '📋 알림 테스트',
        body:  '✅ 알림이 정상적으로 작동하고 있어요!',
      })
    );
    return res.status(200).json({ ok: true });
  } catch (err) {
    if (err.statusCode === 410) {
      await admin.from('push_subscriptions').delete().eq('user_id', user.id);
      return res.status(410).json({ error: 'SUBSCRIPTION_EXPIRED' });
    }
    return res.status(500).json({ error: err.message });
  }
}
