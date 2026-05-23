export default function handler(req, res) {
  const origin = req.headers.origin || req.headers.referer || '';
  const host = req.headers.host || '';
  const allowed = [
    'o1chu.my',
    'planmanager-six.vercel.app',
    'localhost',
    '127.0.0.1'
  ];
  const isAllowedOrigin = !origin || allowed.some(d => origin.includes(d));
  const isAllowedHost = allowed.some(d => host.includes(d));

  if (!isAllowedOrigin && !isAllowedHost && process.env.NODE_ENV !== 'development') {
    return res.status(403).json({ error: 'Forbidden' });
  }

  // Firebase 웹 설정은 공개 값이므로 캐시는 막고 그대로 전달합니다.
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
  res.setHeader('Pragma', 'no-cache');

  res.status(200).json({
    supabaseUrl:      process.env.SUPABASE_URL,
    supabaseAnonKey:  process.env.SUPABASE_ANON_KEY,
    googleClientId:   process.env.GOOGLE_OAUTH_CLIENT_ID,
  });
}
