import admin from 'firebase-admin';
import webpush from 'web-push';

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

webpush.setVapidDetails(
  'mailto:admin@planmanager-six.vercel.app',
  process.env.VAPID_PUBLIC_KEY,
  process.env.VAPID_PRIVATE_KEY
);

export default async function handler(req, res) {
  // cron 인증: Vercel Cron은 Authorization 헤더를 자동으로 붙임
  const auth = req.headers.authorization;
  if (auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const now = new Date();
  const in24h = new Date(now.getTime() + 24 * 60 * 60 * 1000);

  try {
    // 모든 사용자 데이터 조회
    const usersSnap = await db.collection('users').get();
    const subSnap    = await db.collection('push_subscriptions').get();

    const subMap = {};
    subSnap.forEach(doc => { subMap[doc.id] = doc.data().subscription; });

    let sent = 0;
    const tasks = [];

    for (const userDoc of usersSnap.docs) {
      const uid = userDoc.id;
      const sub = subMap[uid];
      if (!sub) continue;

      const pool = userDoc.data().pool || [];
      const urgentTasks = pool.filter(task => {
        if (!task.deadline) return false;
        const { month, day, time } = task.deadline;
        const yr = now.getFullYear();
        const deadlineDate = new Date(yr, parseInt(month) - 1, parseInt(day), ...time.split(':').map(Number));
        // 내년 기한인 경우 처리 (현재보다 과거면 내년으로)
        if (deadlineDate < now) deadlineDate.setFullYear(yr + 1);
        return deadlineDate > now && deadlineDate <= in24h;
      });

      if (urgentTasks.length === 0) continue;

      const body = urgentTasks.length === 1
        ? `⏰ "${urgentTasks[0].text}" 기한이 24시간 이내입니다!`
        : `⏰ 기한이 24시간 이내인 할일이 ${urgentTasks.length}개 있어요!`;

      tasks.push(
        webpush.sendNotification(sub, JSON.stringify({
          title: '📋 일정 기한 알림',
          body,
        })).then(() => { sent++; }).catch(err => {
          console.warn(`push failed for ${uid}:`, err.statusCode);
          // 구독 만료(410) 시 삭제
          if (err.statusCode === 410) {
            return db.collection('push_subscriptions').doc(uid).delete();
          }
        })
      );
    }

    await Promise.all(tasks);
    return res.status(200).json({ ok: true, sent });
  } catch (err) {
    console.error('push-notify error:', err);
    return res.status(500).json({ error: err.message });
  }
}
