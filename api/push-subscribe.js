import admin from 'firebase-admin';

if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.cert({
      projectId:   process.env.FIREBASE_PROJECT_ID,
      clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
      privateKey:  (process.env.FIREBASE_PRIVATE_KEY || '').replace(/\\n/g, '\n'),
    }),
  });
}
const db = admin.firestore();

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  const { uid, subscription } = req.body || {};
  if (!uid || !subscription?.endpoint) return res.status(400).json({ error: 'uid and subscription required' });

  try {
    await db.collection('push_subscriptions').doc(uid).set({
      subscription,
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    }, { merge: true });
    return res.status(200).json({ ok: true });
  } catch (err) {
    console.error('push-subscribe error:', err);
    return res.status(500).json({ error: err.message });
  }
}
