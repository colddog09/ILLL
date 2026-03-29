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
const KST_OFFSET_MS = 9 * 60 * 60 * 1000;

webpush.setVapidDetails(
  'mailto:admin@planmanager-six.vercel.app',
  process.env.VAPID_PUBLIC_KEY,
  process.env.VAPID_PRIVATE_KEY
);

function getKstDateKey(date = new Date()) {
  const kst = new Date(date.getTime() + KST_OFFSET_MS);
  return kst.toISOString().slice(0, 10);
}

function getNextKstDateKey(date = new Date()) {
  const kst = new Date(date.getTime() + KST_OFFSET_MS);
  kst.setUTCDate(kst.getUTCDate() + 1);
  return kst.toISOString().slice(0, 10);
}

function normalizeDeadlinePart(value) {
  return String(value).padStart(2, '0');
}

function getDeadlineDateKey(deadline, baseYear) {
  if (!deadline?.month || !deadline?.day) return null;
  const month = normalizeDeadlinePart(deadline.month);
  const day = normalizeDeadlinePart(deadline.day);
  const thisYearKey = `${baseYear}-${month}-${day}`;
  return thisYearKey;
}

function getTaskKey(task) {
  return task.taskId || task.id || `${task.text}:${JSON.stringify(task.deadline || {})}`;
}

function collectDueTasks(userData, targetDateKey, baseYear) {
  const seen = new Set();
  const dueTasks = [];
  const pushTask = task => {
    if (!task?.deadline || !task?.text) return;
    if (getDeadlineDateKey(task.deadline, baseYear) !== targetDateKey) return;
    const taskKey = getTaskKey(task);
    if (seen.has(taskKey)) return;
    seen.add(taskKey);
    dueTasks.push(task);
  };

  (userData.pool || []).forEach(pushTask);
  Object.values(userData.schedule || {}).forEach(items => {
    (items || []).forEach(pushTask);
  });

  return dueTasks;
}

export default async function handler(req, res) {
  // cron 인증: Vercel Cron은 Authorization 헤더를 자동으로 붙임
  const auth = req.headers.authorization;
  if (auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const now = new Date();
  const todayKstKey = getKstDateKey(now);
  const tomorrowKstKey = getNextKstDateKey(now);
  const baseYear = Number(todayKstKey.slice(0, 4));

  try {
    // 모든 사용자 데이터 조회
    const usersSnap = await db.collection('users').get();
    const subSnap    = await db.collection('push_subscriptions').get();

    const subMap = {};
    subSnap.forEach(doc => { subMap[doc.id] = { id: doc.id, ...doc.data() }; });

    let sent = 0;
    const tasks = [];

    for (const userDoc of usersSnap.docs) {
      const uid = userDoc.id;
      const subDoc = subMap[uid];
      const subscription = subDoc?.subscription;
      if (!subscription) continue;
      if (subDoc.lastNotifiedKstDate === todayKstKey) continue;

      const urgentTasks = collectDueTasks(userDoc.data(), tomorrowKstKey, baseYear);
      if (urgentTasks.length === 0) continue;

      const firstTask = urgentTasks[0];
      const deadlineText = firstTask.deadline?.time
        ? `${Number(firstTask.deadline.month)}월 ${Number(firstTask.deadline.day)}일 ${firstTask.deadline.time}`
        : `${Number(firstTask.deadline.month)}월 ${Number(firstTask.deadline.day)}일`;
      const body = urgentTasks.length === 1
        ? `내일 마감인 "${firstTask.text}" 일정을 확인해보세요. (${deadlineText})`
        : `내일 마감인 일정이 ${urgentTasks.length}개 있어요. 놓치지 않게 확인해보세요.`;

      tasks.push(
        webpush.sendNotification(subscription, JSON.stringify({
          title: '📋 일정 기한 알림',
          body,
        })).then(async () => {
          sent++;
          await db.collection('push_subscriptions').doc(uid).set({
            lastNotifiedKstDate: todayKstKey,
            updatedAt: admin.firestore.FieldValue.serverTimestamp(),
          }, { merge: true });
        }).catch(err => {
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
