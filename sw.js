self.addEventListener('install', (e) => {
  console.log('[Service Worker] Install');
});

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  // Firebase나 Google Auth 관련 요청은 가로채지 않고 통과시킵니다.
  if (url.hostname.includes('googleapis.com') || 
      url.hostname.includes('firebaseapp.com') ||
      url.hostname.includes('google.com')) {
    return;
  }

  e.respondWith(
    fetch(e.request).catch(() => {
      // 오프라인 상태일 때만 대체 응답 (필요한 경우에만)
      if (e.request.mode === 'navigate') {
        return new Response('오프라인 상태입니다. 나중에 다시 시도해주세요.');
      }
    })
  );
});
