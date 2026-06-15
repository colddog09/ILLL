const CACHE_NAME = 'illl-v127';
const CORE_FILES = [
  '/',
  '/index.html',
  '/supabase.js?v=1',
  '/style.css?v=70',
  '/utils.js?v=3',
  '/state.js?v=13',
  '/auth.js?v=7',
  '/render.js?v=21',
  '/drag.js?v=8',
  '/deadline.js?v=2',
  '/push.js?v=3',
  '/gcal/gcal.js?v=14',
  '/groups.js?v=15',
  '/modals.js?v=16',
  '/events.js?v=19',
  '/manifest.json',
  '/image/icon-192.png',
  '/image/icon-512.png',
  '/image/apple-touch-icon.png',
  '/image/pompomno.webp',
  '/image/pompomyes.webp',
  '/image/tree.avif',
  '/image/tree.png',
  '/image/snowman.png'
];

/* ── 설치: 핵심 파일 캐시 ── */
self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => cache.addAll(CORE_FILES))
      .then(() => self.skipWaiting())
  );
});

/* ── 활성화: 구버전 캐시 정리 ── */
self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(
        keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k))
      )
    ).then(() => self.clients.claim())
  );
});

/* ── SKIP_WAITING 메시지 처리 ── */
self.addEventListener('message', e => {
  if (e.data?.type === 'SKIP_WAITING') self.skipWaiting();
});

/* ── 푸시 알림 수신 ── */
self.addEventListener('push', e => {
  let data = { title: '일정 알림', body: '기한이 다가온 할일이 있어요!' };
  try { if (e.data) data = e.data.json(); } catch {}
  // 그룹 알림과 기한 알림 태그 분리
  const tag = data.data?.url?.includes('group') ? 'group-alert' : 'deadline-alert';
  e.waitUntil(
    self.registration.showNotification(data.title, {
      body:      data.body,
      icon:      '/image/icon-192.png',
      badge:     '/image/icon-192.png',
      tag,
      renotify:  true,
      data:      data.data || {},
    })
  );
});

self.addEventListener('notificationclick', e => {
  e.notification.close();
  const url = e.notification.data?.url || '/';
  e.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(list => {
      // 이미 열린 창이 있으면 포커스 후 URL 이동
      for (const client of list) {
        if (client.url.includes(self.location.origin) && 'focus' in client) {
          return client.focus().then(c => c.navigate(url));
        }
      }
      return clients.openWindow(url);
    })
  );
});

/* ── 요청 처리 ── */
self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET') return;

  const url = new URL(e.request.url);

  // Firebase / Google 요청은 항상 네트워크 통과 (캐시 X)
  if (
    url.pathname.startsWith('/__/') ||
    url.pathname.startsWith('/api/') ||
    url.hostname.includes('googleapis.com') ||
    url.hostname.includes('firebaseapp.com') ||
    url.hostname.includes('firebasestorage') ||
    url.hostname.includes('google.com') ||
    url.hostname.includes('gstatic.com') ||
    url.hostname.includes('fonts.gstatic.com') ||
    url.hostname.includes('fonts.googleapis.com')
  ) {
    return;
  }

  // 앱 자체 파일: 캐시 우선, 없으면 네트워크
  e.respondWith(
    caches.match(e.request).then(cached => {
      if (cached) return cached;

      return fetch(e.request)
        .then(response => {
          // 정상 응답만 캐시에 저장
          if (response && response.status === 200 && response.type === 'basic') {
            const clone = response.clone();
            caches.open(CACHE_NAME).then(cache => cache.put(e.request, clone));
          }
          return response;
        })
        .catch(() => {
          // 오프라인 + 캐시 없음: 앱 셸로 폴백
          if (e.request.mode === 'navigate') {
            return caches.match('/index.html');
          }
        });
    })
  );
});
