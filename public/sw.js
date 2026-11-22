// Service Worker tối giản giúp Đặng Wedding cài đặt dạng App (PWA) trên iPhone & Android
// Luôn ưu tiên mạng (Network-First) để dữ liệu kho luôn mới nhất

const CACHE_NAME = 'dang-wedding-pwa-v1'

self.addEventListener('install', () => {
  self.skipWaiting()
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
      )
      .then(() => self.clients.claim())
  )
})

self.addEventListener('fetch', (event) => {
  // Chỉ xử lý request GET cùng origin, không can thiệp API Supabase
  if (event.request.method !== 'GET') return
  const url = new URL(event.request.url)
  if (url.origin !== self.location.origin) return

  event.respondWith(
    fetch(event.request).catch(() => caches.match(event.request))
  )
})
