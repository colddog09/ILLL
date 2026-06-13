export default function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).end();
  const key = process.env.VAPID_PUBLIC_KEY;
  if (!key) return res.status(500).json({ error: 'VAPID_PUBLIC_KEY not set' });
  res.status(200).json({ publicKey: key });
}
