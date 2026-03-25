self.addEventListener('install', (e) => {
  console.log('[Service Worker] Install');
});

self.addEventListener('fetch', (e) => {
  // 최소한의 응답 처리 (오프라인 캐싱은 추후 확장 가능)
  e.respondWith(
    fetch(e.request).catch(() => {
      return new Response('오프라인 상태입니다. 나중에 다시 시도해주세요.');
    })
  );
});
