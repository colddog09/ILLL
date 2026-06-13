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
    console.error('[push-test] VAPID init error:', err.message);
    return res.status(500).json({ error: 'vapid_init_failed' });
  }

  const token = (req.headers.authorization || '').replace('Bearer ', '').trim();
  if (!token) return res.status(401).json({ error: 'Unauthorized' });

  const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_ANON_KEY,
    { global: { headers: { Authorization: `Bearer ${token}` } } }
  );
  const { data: { user }, error: authErr } = await supabase.auth.getUser(token);
  if (authErr || !user) return res.status(401).json({ error: 'Unauthorized' });

  const admin = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
  const { data: row, error: dbErr } = await admin
    .from('push_subscriptions')
    .select('subscription')
    .eq('user_id', user.id)
    .maybeSingle();

  if (dbErr) {
    console.error('[push-test] DB error:', dbErr.message);
    return res.status(500).json({ error: dbErr.message });
  }
  if (!row?.subscription) {
    return res.status(404).json({ error: 'NO_SUBSCRIPTION' });
  }

  try {
    await webpush.sendNotification(
      row.subscription,
      JSON.stringify({ title: '📋 알림 테스트', body: '✅ 알림이 정상적으로 작동하고 있어요!' })
    );
    return res.status(200).json({ ok: true });
  } catch (err) {
    console.error('[push-test] sendNotification error:', err.statusCode, err.message);
    if (err.statusCode === 410 || err.statusCode === 403) {
      await admin.from('push_subscriptions').delete().eq('user_id', user.id);
      return res.status(410).json({ error: 'SUBSCRIPTION_EXPIRED' });
    }
    return res.status(500).json({ error: err.message });
  }
}
