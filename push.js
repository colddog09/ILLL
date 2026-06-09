/* ============================================================
   push.js — Web Push 알림 구독
   ============================================================ */

'use strict';

const VAPID_PUBLIC_KEY = 'BLNNKocRm0zVNeOc-yJE7ldi3oLvQrsKrGNGRc_Mvo4n5F0t5Jp8djLBq-JxzoXGBD4G1zs8DFjS4FOsy9q2sGw';

function urlBase64ToUint8Array(base64String) {
  const padding = '='.repeat((4 - base64String.length % 4) % 4);
  const base64  = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw     = atob(base64);
  return Uint8Array.from([...raw].map(c => c.charCodeAt(0)));
}

async function subscribePush() {
  if (!('serviceWorker' in navigator) || !('PushManager' in window)) return;
  if (!supabaseClient) return;
  try {
    const { data: { session } } = await supabaseClient.auth.getSession();
    if (!session?.access_token) return;

    const reg = await navigator.serviceWorker.ready;
    let sub   = await reg.pushManager.getSubscription();
    if (!sub) {
      sub = await reg.pushManager.subscribe({
        userVisibleOnly:      true,
        applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY),
      });
    }
    await fetch('/api/push-subscribe', {
      method:  'POST',
      headers: {
        'Content-Type':  'application/json',
        'Authorization': `Bearer ${session.access_token}`
      },
      body: JSON.stringify({ subscription: sub.toJSON() }),
    });
  } catch (err) {
    console.warn('Push 구독 실패:', err);
  }
}

async function requestPushPermission() {
  if (!('Notification' in window)) return;
  if (Notification.permission === 'granted') { subscribePush(); return; }
  if (Notification.permission === 'denied')  return;
  const perm = await Notification.requestPermission();
  if (perm === 'granted') subscribePush();
}

// ── 알림 권한 버튼 ──
const notifyPermBtn = document.getElementById('notifyPermBtn');
const notifyStatus  = document.getElementById('notifyStatus');

function updateNotifyStatus() {
  if (!notifyStatus) return;
  const perm = Notification?.permission;
  if (perm === 'granted')  {
    notifyStatus.textContent = '✅ 알림 허용됨';
    if (notifyPermBtn) notifyPermBtn.disabled = true;
  } else if (perm === 'denied') {
    notifyStatus.textContent = '❌ 알림 차단됨 — 브라우저 설정에서 직접 허용해주세요';
  } else {
    notifyStatus.textContent = '';
  }
}

if (notifyPermBtn) {
  updateNotifyStatus();
  notifyPermBtn.addEventListener('click', async () => {
    if (!currentUser) { alert('로그인 후 이용해주세요.'); return; }
    notifyStatus.textContent = '요청 중...';
    const perm = await Notification.requestPermission();
    if (perm === 'granted') {
      await subscribePush();
      notifyStatus.textContent   = '✅ 알림이 활성화됐습니다!';
      notifyPermBtn.disabled     = true;
    } else {
      notifyStatus.textContent = '❌ 알림이 차단됐습니다. 브라우저 설정에서 허용해주세요.';
    }
  });
}
