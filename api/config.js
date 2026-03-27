export default function handler(req, res) {
  // 캐시 완전 금지
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Surrogate-Control', 'no-store');

  // 정확한 Origin 검사 (substring 매칭 금지 → 우회 방지)
  const origin = req.headers.origin || '';
  const ALLOWED_ORIGINS = [
    'https://planmanager-six.vercel.app',
    'http://localhost',
    'http://127.0.0.1',
  ];

  // 로컬 개발: origin이 없거나 localhost 포트 포함
  const isLocalhost = origin.startsWith('http://localhost:') ||
                      origin.startsWith('http://127.0.0.1:') ||
                      origin === '';

  const isAllowed = ALLOWED_ORIGINS.includes(origin) || isLocalhost;

  if (!isAllowed) {
    return res.status(403).json({ error: 'Forbidden' });
  }

  // 허용된 Origin에만 CORS 응답
  if (origin) res.setHeader('Access-Control-Allow-Origin', origin);
  res.setHeader('Access-Control-Allow-Methods', 'GET');
  res.setHeader('Vary', 'Origin');

  // 환경변수 누락 확인
  const required = [
    'FIREBASE_API_KEY', 'FIREBASE_AUTH_DOMAIN', 'FIREBASE_PROJECT_ID',
    'FIREBASE_STORAGE_BUCKET', 'FIREBASE_MESSAGING_SENDER_ID', 'FIREBASE_APP_ID'
  ];
  const missing = required.filter(k => !process.env[k]);
  if (missing.length > 0) {
    console.error('Missing env vars:', missing);
    return res.status(500).json({ error: 'Server configuration error' });
  }

  res.status(200).json({
    apiKey:            process.env.FIREBASE_API_KEY,
    authDomain:        process.env.FIREBASE_AUTH_DOMAIN,
    projectId:         process.env.FIREBASE_PROJECT_ID,
    storageBucket:     process.env.FIREBASE_STORAGE_BUCKET,
    messagingSenderId: process.env.FIREBASE_MESSAGING_SENDER_ID,
    appId:             process.env.FIREBASE_APP_ID,
    measurementId:     process.env.FIREBASE_MEASUREMENT_ID || '',
  });
}
