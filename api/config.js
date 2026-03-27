export default function handler(req, res) {
  const origin = req.headers.origin || req.headers.referer || '';
  const host = req.headers.host || '';
  const allowed = [
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
    apiKey:            process.env.FIREBASE_API_KEY,
    authDomain:        process.env.FIREBASE_AUTH_DOMAIN,
    projectId:         process.env.FIREBASE_PROJECT_ID,
    storageBucket:     process.env.FIREBASE_STORAGE_BUCKET,
    messagingSenderId: process.env.FIREBASE_MESSAGING_SENDER_ID,
    appId:             process.env.FIREBASE_APP_ID,
    measurementId:     process.env.FIREBASE_MEASUREMENT_ID,
  });
}
