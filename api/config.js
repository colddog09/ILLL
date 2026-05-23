const ALLOWED_ORIGINS = [
  'https://o1chu.my',
  'https://www.o1chu.my',
  'https://planmanager-six.vercel.app',
  'http://localhost',
  'http://127.0.0.1',
];

function isAllowedOrigin(origin) {
  if (!origin) return true; // 서버-to-서버 요청 허용
  try {
    const url = new URL(origin);
    return ALLOWED_ORIGINS.some(a => {
      const allowed = new URL(a);
      return url.hostname === allowed.hostname;
    }) || url.hostname === 'localhost' || url.hostname === '127.0.0.1';
  } catch { return false; }
}

export default function handler(req, res) {
  const origin = req.headers.origin || '';

  if (!isAllowedOrigin(origin) && process.env.NODE_ENV !== 'development') {
    return res.status(403).json({ error: 'Forbidden' });
  }

  if (origin) res.setHeader('Access-Control-Allow-Origin', origin);
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
  res.setHeader('Pragma', 'no-cache');

  if (req.method === 'OPTIONS') return res.status(204).end();

  res.status(200).json({
    supabaseUrl:     process.env.SUPABASE_URL,
    supabaseAnonKey: process.env.SUPABASE_ANON_KEY,
    googleClientId:  process.env.GOOGLE_OAUTH_CLIENT_ID,
  });
}
