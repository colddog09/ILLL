/* ============================================================
   api/gcal-callback.js
   구글 캘린더 OAuth 콜백 엔드포인트
   구글에서 code를 받아 refresh_token을 DB에 저장
   ============================================================ */

import { createClient } from '@supabase/supabase-js';

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'GET') return res.status(405).end();

  const { code, state, error: googleError } = req.query;

  if (googleError) {
    // 사용자가 권한 거부한 경우
    return res.redirect(`/?gcal=error&reason=${encodeURIComponent(googleError)}`);
  }
  if (!code || !state) {
    return res.redirect('/?gcal=error&reason=missing_params');
  }

  const SUPABASE_URL    = process.env.SUPABASE_URL;
  const SUPABASE_ANON   = process.env.SUPABASE_ANON_KEY;
  const CLIENT_ID       = process.env.GOOGLE_OAUTH_CLIENT_ID;
  const CLIENT_SECRET   = process.env.GOOGLE_OAUTH_CLIENT_SECRET;

  const host        = req.headers.host || 'o1chu.my';
  const proto       = host.startsWith('localhost') ? 'http' : 'https';
  const redirectUri = `${proto}://${host}/api/gcal-callback`;

  // state에서 JWT 복원
  let jwt;
  try {
    jwt = Buffer.from(state, 'base64url').toString();
  } catch {
    return res.redirect('/?gcal=error&reason=invalid_state');
  }

  // JWT로 사용자 검증
  const supabase = createClient(SUPABASE_URL, SUPABASE_ANON, {
    global: { headers: { Authorization: `Bearer ${jwt}` } }
  });
  const { data: { user }, error: authErr } = await supabase.auth.getUser(jwt);
  if (authErr || !user) {
    return res.redirect('/?gcal=error&reason=auth_expired');
  }

  // Google 인가 코드 → access_token + refresh_token 교환
  let tokens;
  try {
    const tokenResp = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code,
        client_id:     CLIENT_ID,
        client_secret: CLIENT_SECRET,
        redirect_uri:  redirectUri,
        grant_type:    'authorization_code'
      })
    });
    tokens = await tokenResp.json();
  } catch {
    return res.redirect('/?gcal=error&reason=token_exchange_failed');
  }

  if (!tokens.refresh_token) {
    console.warn('gcal-callback: refresh_token 없음 (이미 연결된 계정?)', tokens.error);
    // access_token만 있어도 일단 연결된 것으로 처리
    // (이전에 consent를 줬고 refresh_token이 이미 DB에 있는 경우)
    return res.redirect('/?gcal=connected&fresh=0');
  }

  // DB에 refresh_token 저장
  // UPDATE 우선 (기존 데이터 보존) → 영향받은 행 없으면 신규 유저 → INSERT
  const { data: updated, error: updateErr } = await supabase
    .from('user_states')
    .update({ gcal_refresh_token: tokens.refresh_token })
    .eq('user_id', user.id)
    .select('user_id');

  if (updateErr) {
    console.error('gcal-callback: UPDATE 실패', updateErr.message);
    return res.redirect('/?gcal=error&reason=db_error');
  }

  // 업데이트된 행이 없으면 (신규 유저) 기본값으로 INSERT
  if (!updated || updated.length === 0) {
    const { error: insertErr } = await supabase
      .from('user_states')
      .insert({
        user_id:            user.id,
        gcal_refresh_token: tokens.refresh_token,
        pool:               [],
        schedule:           {},
        links:              []
      });
    if (insertErr) {
      console.error('gcal-callback: INSERT 실패', insertErr.message);
      return res.redirect('/?gcal=error&reason=db_error');
    }
  }

  return res.redirect('/?gcal=connected&fresh=1');
}
