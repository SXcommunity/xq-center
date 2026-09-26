// 贤圈中心 · Service Worker
// 说明：为避免「CDN 10 分钟 + SW 缓存 + 时间戳 URL 内容不变」三层叠加
// 导致老访客一直拿到旧版本，本站不再缓存任何资源：
// 该 Worker 只负责清空旧缓存并自我注销，控制权交回浏览器。
const CACHE = 'xq-center-none'

self.addEventListener('install', () => self.skipWaiting())

self.addEventListener('activate', (e) => {
  e.waitUntil((async () => {
    const keys = await caches.keys()
    await Promise.all(keys.map((k) => caches.delete(k)))
    await self.registration.unregister().catch(() => false)
    await self.clients.claim().catch(() => null)
  })())
})

// 兜底：正常应无请求再被拦截
self.addEventListener('fetch', () => {})
self.addEventListener('message', () => self.registration.unregister().catch(() => null))
