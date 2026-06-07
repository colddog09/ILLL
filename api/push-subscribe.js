import { createClient } from '@supabase/supabase-js';

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  const token = (req.headers.authorization || '').replace('Bearer ', '').trim();
  if (!token) return res.status(401).json({ error: 'Unauthorized' });

  const { subscription } = req.body || {};
  if (!subscription?.endpoint) return res.status(400).json({ error: 'subscription required' });

  try {
    // JWT 검증 (anon key + user token)
    const supabase = createClient(
      process.env.SUPABASE_URL,
      process.env.SUPABASE_ANON_KEY,
      { global: { headers: { Authorization: `Bearer ${token}` } } }
    );
    const { data: { user }, error: authErr } = await supabase.auth.getUser(token);
    if (authErr || !user) return res.status(401).json({ error: 'Invalid token' });

    // 서비스 롤로 upsert (RLS 우회)
    const admin = createClient(
      process.env.SUPABASE_URL,
      process.env.SUPABASE_SERVICE_ROLE_KEY
    );
    const { error } = await admin
      .from('push_subscriptions')
      .upsert(
        { user_id: user.id, subscription, updated_at: new Date().toISOString() },
        { onConflict: 'user_id' }
      );
    if (error) throw error;

    return res.status(200).json({ ok: true });
  } catch (err) {
    console.error('push-subscribe error:', err);
    return res.status(500).json({ error: 'Internal error' });
  }
}
