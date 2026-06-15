import { createClient } from '@supabase/supabase-js';
import { deriveKey, encryptJson, decryptJson } from './_crypto.js';

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
  if (req.method !== 'GET' && req.method !== 'POST') return res.status(405).end();

  // 개인 일정 데이터는 절대 캐시 금지 (브라우저 HTTP 캐시가 옛 데이터 재사용 방지)
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, max-age=0');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');

  const user = await authedUser(req);
  if (!user) return res.status(401).json({ error: 'Unauthorized' });

  const admin = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
  const key   = await deriveKey(user.id);

  if (req.method === 'GET') {
    const { data, error } = await admin
      .from('user_states')
      .select('data_enc, pool, schedule, links, updated_at')
      .eq('user_id', user.id)
      .maybeSingle();

    if (error) return res.status(500).json({ error: error.message });
    if (!data)  return res.status(200).json({ pool: [], schedule: {}, links: [], updated_at: null });

    if (data.data_enc) {
      try {
        const obj = await decryptJson(key, data.data_enc);
        const _days = Object.keys(obj.schedule || {});
        const _items = _days.reduce((n, k) => n + (obj.schedule[k]?.length || 0), 0);
        console.log(`[state/GET][diag] uid=${user.id.slice(0,8)} src=ENC pool=${(obj.pool||[]).length} days=${_days.length} items=${_items} updated=${data.updated_at}`);
        return res.status(200).json({ ...obj, updated_at: data.updated_at });
      } catch {
        console.error('[state/GET] decrypt failed — falling back to plaintext');
      }
    }
    // Migration fallback: plaintext columns
    const _pdays = Object.keys(data.schedule || {});
    const _pitems = _pdays.reduce((n, k) => n + (data.schedule[k]?.length || 0), 0);
    console.log(`[state/GET][diag] uid=${user.id.slice(0,8)} src=PLAIN pool=${(data.pool||[]).length} days=${_pdays.length} items=${_pitems} updated=${data.updated_at}`);
    return res.status(200).json({
      pool:       data.pool     || [],
      schedule:   data.schedule || {},
      links:      data.links    || [],
      updated_at: data.updated_at,
    });
  }

  // POST — encrypt and save
  const { pool, schedule, links, updated_at } = req.body || {};
  const ts       = updated_at || new Date().toISOString();
  const data_enc = await encryptJson(key, {
    pool:     pool     || [],
    schedule: schedule || {},
    links:    links    || [],
  });

  const { error } = await admin.from('user_states').upsert(
    { user_id: user.id, data_enc, updated_at: ts },
    { onConflict: 'user_id' }
  );
  if (error) return res.status(500).json({ error: error.message });
  return res.status(200).json({ ok: true, updated_at: ts });
}
