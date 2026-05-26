/* ============================================================
   api/gcal-auth.js
   구글 캘린더 OAuth 리다이렉트 시작 엔드포인트
   GET /api/gcal-auth?jwt=<supabase_access_token>
   ============================================================ */

import { createClient } from '@supabase/supabase-js';

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'GET') return res.status(405).end();

  const { jwt } = req.query;
  if (!jwt) return res.redirect('/?gcal=error&reason=no_auth');

  const SUPABASE_URL     = process.env.SUPABASE_URL;
  const SUPABASE_ANON    = process.env.SUPABASE_ANON_KEY;
  const CLIENT_ID        = process.env.GOOGLE_OAUTH_CLIENT_ID;

  if (!CLIENT_ID) return res.redirect('/?gcal=error&reason=server_config');

  // JWT 검증
  try {
    const supabase = createClient(SUPABASE_URL, SUPABASE_ANON, {
      global: { headers: { Authorization: `Bearer ${jwt}` } }
    });
    const { data: { user }, error } = await supabase.auth.getUser(jwt);
    if (error || !user) return res.redirect('/?gcal=error&reason=invalid_auth');
  } catch {
    return res.redirect('/?gcal=error&reason=auth_check_failed');
  }

  // redirect_uri는 Google Console에 등록된 값과 정확히 일치해야 함
  const host = req.headers.host || '';
  const isLocal = host.startsWith('localhost') || host.startsWith('127.');
  const redirectUri = isLocal
    ? `http://${host}/api/gcal-callback`
    : 'https://o1chu.my/api/gcal-callback';

  // state = base64url(jwt) — callback에서 사용자 인증에 재사용
  const state = Buffer.from(jwt).toString('base64url');

  const url = new URL('https://accounts.google.com/o/oauth2/v2/auth');
  url.searchParams.set('client_id',     CLIENT_ID);
  url.searchParams.set('redirect_uri',  redirectUri);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('scope',         'https://www.googleapis.com/auth/calendar');
  url.searchParams.set('access_type',   'offline');
  url.searchParams.set('prompt',        'consent');
  url.searchParams.set('state',         state);

  return res.redirect(302, url.toString());
}
