/* ============================================================
   api/gcal-token.js
   구글 캘린더 access token 자동 갱신 엔드포인트
   - Supabase JWT로 사용자 인증
   - DB의 gcal_refresh_token으로 Google access token 발급
   ============================================================ */

import { createClient } from '@supabase/supabase-js';

const ALLOWED_ORIGINS = [
  'https://o1chu.my',
  'https://www.o1chu.my',
  'https://planmanager-six.vercel.app',
];

function _isAllowedOrigin(origin) {
  if (!origin) return true;
  try {
    const { hostname } = new URL(origin);
    return ALLOWED_ORIGINS.some(a => new URL(a).hostname === hostname)
      || hostname === 'localhost' || hostname === '127.0.0.1';
  } catch { return false; }
}

export default async function handler(req, res) {
  const origin = req.headers.origin || '';
  if (_isAllowedOrigin(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin || '*');
  }
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type');
  res.setHeader('Cache-Control', 'no-store');

  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const token = (req.headers.authorization || '').replace('Bearer ', '').trim();
  if (!token) return res.status(401).json({ error: 'No token' });

  try {
    // 사용자 토큰으로 supabase 클라이언트 생성 (RLS 적용됨)
    const supabase = createClient(
      process.env.SUPABASE_URL,
      process.env.SUPABASE_ANON_KEY,
      { global: { headers: { Authorization: `Bearer ${token}` } } }
    );

    // JWT 검증
    const { data: { user }, error: authErr } = await supabase.auth.getUser(token);
    if (authErr || !user) return res.status(401).json({ error: 'Invalid token' });

    // DB에서 refresh token 조회
    const { data, error: dbErr } = await supabase
      .from('user_states')
      .select('gcal_refresh_token')
      .eq('user_id', user.id)
      .maybeSingle();

    if (dbErr) return res.status(500).json({ error: 'DB error', details: dbErr.message });
    if (!data?.gcal_refresh_token) return res.status(404).json({ error: 'no_refresh_token' });

    // Google token endpoint 호출
    const gRes = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id:     process.env.GOOGLE_OAUTH_CLIENT_ID,
        client_secret: process.env.GOOGLE_OAUTH_CLIENT_SECRET,
        refresh_token: data.gcal_refresh_token,
        grant_type:    'refresh_token'
      })
    });

    const gData = await gRes.json();
    if (!gData.access_token) {
      // refresh token 만료 → DB에서 삭제 (재로그인 유도)
      if (gData.error === 'invalid_grant') {
        await supabase
          .from('user_states')
          .update({ gcal_refresh_token: null })
          .eq('user_id', user.id);
        return res.status(401).json({ error: 'refresh_token_expired' });
      }
      return res.status(400).json({ error: 'google_error', details: gData.error });
    }

    return res.status(200).json({
      access_token: gData.access_token,
      expires_in:   gData.expires_in || 3600
    });

  } catch (err) {
    return res.status(500).json({ error: 'Internal error', details: err.message });
  }
}
