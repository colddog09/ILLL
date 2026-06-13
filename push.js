/* ============================================================
   push.js — Web Push 알림 구독
   ============================================================ */

'use strict';

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

    // 서버에서 VAPID 공개키를 받아와 항상 일치 보장
    const vapidRes = await fetch('/api/push-vapid');
    if (!vapidRes.ok) return;
    const { publicKey } = await vapidRes.json();

    const reg = await navigator.serviceWorker.ready;

    // 기존 구독 삭제 후 새로 구독 (키 불일치 방지)
    const existing = await reg.pushManager.getSubscription();
    if (existing) await existing.unsubscribe();

    const sub = await reg.pushManager.subscribe({
      userVisibleOnly:      true,
      applicationServerKey: urlBase64ToUint8Array(publicKey),
    });

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

const notifyTestBtn = document.getElementById('notifyTestBtn');

function updateNotifyStatus() {
  if (!notifyStatus) return;
  const perm = Notification?.permission;
  if (perm === 'granted')  {
    notifyStatus.textContent = '✅ 알림 허용됨';
    if (notifyPermBtn) notifyPermBtn.disabled = true;
    if (notifyTestBtn) notifyTestBtn.hidden = false;
  } else if (perm === 'denied') {
    notifyStatus.textContent = '❌ 알림 차단됨 — 브라우저 설정에서 직접 허용해주세요';
    if (notifyTestBtn) notifyTestBtn.hidden = true;
  } else {
    notifyStatus.textContent = '';
    if (notifyTestBtn) notifyTestBtn.hidden = true;
  }
}

async function _sendPushTest() {
  const { data: { session } } = await supabaseClient.auth.getSession();
  return fetch('/api/push-test', {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${session?.access_token}` },
  });
}

if (notifyTestBtn) {
  notifyTestBtn.addEventListener('click', async () => {
    if (!currentUser) return;
    notifyTestBtn.disabled = true;
    notifyStatus.textContent = '전송 중...';
    try {
      let res = await _sendPushTest();

      // 구독 만료/없음(보통 이전 VAPID 키) → 새 키로 자동 재구독 후 1회 재시도
      if (res.status === 410 || res.status === 404) {
        notifyStatus.textContent = '🔄 구독 갱신 중...';
        await subscribePush();          // 기존 구독 해제 + 새 키로 재구독
        res = await _sendPushTest();    // 자동 재시도
      }

      if (res.ok) {
        notifyStatus.textContent = '✅ 테스트 알림 전송됨!';
      } else if (res.status === 410 || res.status === 404) {
        notifyStatus.textContent = '⚠️ 재구독 실패 — 알림 권한을 확인해주세요';
        if (notifyPermBtn) notifyPermBtn.disabled = false;
      } else {
        notifyStatus.textContent = '❌ 전송 실패 — 잠시 후 다시 시도해주세요';
      }
    } catch {
      notifyStatus.textContent = '❌ 네트워크 오류';
    } finally {
      notifyTestBtn.disabled = false;
      setTimeout(() => { if (notifyStatus) updateNotifyStatus(); }, 4000);
    }
  });
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
