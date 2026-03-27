export default function handler(req, res) {
  // 허용된 도메인에서만 응답
  const origin = req.headers.origin || req.headers.referer || '';
  const allowed = [
    'planmanager-six.vercel.app',
    'localhost',
    '127.0.0.1'
  ];
  const isAllowed = allowed.some(d => origin.includes(d));

  if (!isAllowed && process.env.NODE_ENV !== 'development') {
    return res.status(403).json({ error: 'Forbidden' });
  }

  // 캐시 금지 (키 노출 방지)
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
  res.setHeader('Pragma', 'no-cache');

  res.status(200).json({
    apiKey:            process.env.FIREBASE_API_KEY,
    authDomain:        process.env.FIREBASE_AUTH_DOMAIN,
    projectId:         process.env.FIREBASE_PROJECT_ID,
    storageBucket:     process.env.FIREBASE_STORAGE_BUCKET,
    messagingSenderId: process.env.FIREBASE_MESSAGING_SENDER_ID,
    appId:             process.env.FIREBASE_APP_ID,
    measurementId:     process.env.FIREBASE_MEASUREMENT_ID,
  });
}
