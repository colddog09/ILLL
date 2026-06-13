import { createClient } from '@supabase/supabase-js';
import webpush from 'web-push';
import { deriveKey, decryptJson } from './_crypto.js';

webpush.setVapidDetails(
  'mailto:admin@o1chu.my',
  process.env.VAPID_PUBLIC_KEY,
  process.env.VAPID_PRIVATE_KEY
);

export default async function handler(req, res) {
  // Vercel Cron 인증
  const auth = req.headers.authorization;
  if (auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  // 서비스 롤 클라이언트 (전체 데이터 읽기)
  const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY
  );

  const now   = new Date();
  const in24h = new Date(now.getTime() + 24 * 60 * 60 * 1000);

  try {
    // 모든 구독 + 사용자 상태 병렬 조회
    const [{ data: subs }, { data: states }] = await Promise.all([
      supabase.from('push_subscriptions').select('user_id, subscription'),
      supabase.from('user_states').select('user_id, data_enc, pool'),
    ]);

    if (!subs?.length) return res.status(200).json({ ok: true, sent: 0 });

    // user_id → subscription 맵
    const subMap = Object.fromEntries(subs.map(s => [s.user_id, s.subscription]));

    // user_id → pool 맵 (암호화 → 복호화, 폴백: plaintext pool)
    const poolMap = {};
    await Promise.all((states || []).map(async s => {
      if (s.data_enc) {
        try {
          const key = await deriveKey(s.user_id);
          const obj = await decryptJson(key, s.data_enc);
          poolMap[s.user_id] = obj.pool || [];
          return;
        } catch { /* fall through to plaintext */ }
      }
      poolMap[s.user_id] = s.pool || [];
    }));

    let sent = 0;
    const tasks = [];

    for (const [uid, sub] of Object.entries(subMap)) {
      if (!sub) continue;

      const pool = poolMap[uid] || [];
      const urgentTasks = pool.filter(task => {
        if (!task.deadline) return false;
        const { month, day, time } = task.deadline;
        const yr = now.getFullYear();
        const dl = new Date(yr, parseInt(month) - 1, parseInt(day), ...time.split(':').map(Number));
        if (dl < now) dl.setFullYear(yr + 1);
        return dl > now && dl <= in24h;
      });

      if (!urgentTasks.length) continue;

      const body = urgentTasks.length === 1
        ? `⏰ "${urgentTasks[0].text}" 기한이 24시간 이내입니다!`
        : `⏰ 기한이 24시간 이내인 할일이 ${urgentTasks.length}개 있어요!`;

      tasks.push(
        webpush.sendNotification(sub, JSON.stringify({
          title: '📋 일정 기한 알림',
          body,
        }))
          .then(() => { sent++; })
          .catch(async err => {
            console.warn(`push failed uid=${uid}:`, err.statusCode, err.body);
            // 4xx → 구독 무효(만료·키 불일치 등) → 삭제
            if (err.statusCode >= 400 && err.statusCode < 500) {
              await supabase.from('push_subscriptions').delete().eq('user_id', uid);
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
