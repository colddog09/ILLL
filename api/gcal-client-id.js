export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');

  // 1. 환경변수에 직접 설정된 경우
  if (process.env.GOOGLE_OAUTH_CLIENT_ID) {
    return res.json({ clientId: process.env.GOOGLE_OAUTH_CLIENT_ID, source: 'env' });
  }

  // 2. Firebase auth 페이지에서 자동 감지 시도
  const authDomain = process.env.FIREBASE_AUTH_DOMAIN;
  if (authDomain) {
    const urls = [
      `https://${authDomain}/__/auth/handler`,
      `https://${authDomain}/__/auth/iframe`,
    ];
    const pattern = /([\w.-]+\.apps\.googleusercontent\.com)/;

    for (const url of urls) {
      try {
        const r = await fetch(url, {
          headers: { 'User-Agent': 'Mozilla/5.0' },
          signal: AbortSignal.timeout(4000)
        });
        const text = await r.text();
        const m = text.match(pattern);
        if (m) return res.json({ clientId: m[1], source: 'auto' });
      } catch (_) { /* continue */ }
    }
  }

  res.status(404).json({ error: 'not_found' });
}
