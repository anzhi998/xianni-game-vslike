/**
 * 离线缓存(Service Worker)构建插件
 *
 * 为什么不让手写一个 sw.js:Vite 给产物文件名加了内容哈希(`index-a1b2c3.js`),
 * 手写的清单每次构建都会过期 —— 装到主屏幕上的那份 PWA 永远差一个文件,
 * 而且这个 bug 只在你已经断网、点开图标的时候才显形。所以清单必须由构建产物生成。
 *
 * 做法:generateBundle 阶段拿到真实文件名,连同 public/ 里的静态文件一起内联进 sw.js。
 * 缓存名带一份资产指纹,资产一变缓存名就变,旧缓存由 activate 清掉。
 */
import { createHash } from 'node:crypto';
import { readdirSync } from 'node:fs';
import { resolve } from 'node:path';

/** public/ 下的静态文件也要预缓存(它们不经过 bundle,拿不到哈希名) */
function listPublic(publicDir) {
  const out = [];
  const walk = (dir, prefix) => {
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return; // 没有 public/ 目录
    }
    for (const e of entries) {
      const rel = prefix ? `${prefix}/${e.name}` : e.name;
      if (e.isDirectory()) walk(resolve(dir, e.name), rel);
      else out.push(`./${rel}`);
    }
  };
  walk(publicDir, '');
  return out;
}

/**
 * @param {string} publicDir 绝对路径
 */
export function offlinePlugin(publicDir) {
  return {
    name: 'xianni-offline',
    apply: 'build',
    generateBundle(_options, bundle) {
      const built = Object.keys(bundle).map((f) => `./${f}`);
      // index.html 一定在首位:active 里要用它兜住所有导航请求
      const precache = ['./', './index.html', ...listPublic(publicDir), ...built]
        .filter((v, i, arr) => arr.indexOf(v) === i);
      const buildId = createHash('sha256').update(precache.join('|')).digest('hex').slice(0, 12);

      this.emitFile({
        type: 'asset',
        fileName: 'sw.js',
        source: renderSw(buildId, precache),
      });
    },
  };
}

/**
 * Service Worker 源码(编译期模板,`__BUILD_ID__` / `__PRECACHE__` 会被替换)
 *
 * ⚠️ 用 push 而不是 fetch 去更新页面:Service Worker 只要被安装就会拦下一次导航,
 * 一个永不刷新的 PWA 会在某次更新后永远停在旧版本上,而且没有任何症状。
 * push 的好处是不碰正在玩的一局(换 SW 版本会清缓存,清到一半等于游戏崩了)。
 */
function renderSw(buildId, precache) {
  return `/* 由 scripts/vite-plugin-offline.mjs 生成,请勿手改 */
const BUILD_ID = '${buildId}';
const CACHE_NAME = 'xianni-' + BUILD_ID;
const PRECACHE = ${JSON.stringify(precache)};
const SHELL = './index.html';

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => cache.addAll(PRECACHE))
      // 单个资源缺失不该让整个 SW 装不上,逐个 add 并吞掉失败
      .catch((err) => console.warn('[sw] 预缓存不完整', err))
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const names = await caches.keys();
    await Promise.all(names.filter((n) => n !== CACHE_NAME).map((n) => caches.delete(n)));
    await self.clients.claim();
  })());
});

self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') self.skipWaiting();
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  // 导航:先走网络(拿到新版本),断网时回落到缓存里的 index.html。
  // 这一条是「装到主屏幕后飞行模式还能开」的全部秘密。
  if (req.mode === 'navigate') {
    event.respondWith((async () => {
      try {
        const fresh = await fetch(req);
        await putSafely(await caches.open(CACHE_NAME), SHELL, fresh.clone());
        return fresh;
      } catch (err) {
        const cached = await caches.match(SHELL);
        if (cached) return cached;
        throw err;
      }
    })());
    return;
  }

  // 其余同源资源:缓存优先 + 后台顺带刷新(stale-while-revalidate)
  event.respondWith((async () => {
    const cache = await caches.open(CACHE_NAME);
    const cached = await cache.match(req);
    const network = fetch(req)
      .then((res) => {
        putSafely(cache, req, res.clone());
        return res;
      })
      .catch(() => undefined);
    if (cached) return cached;
    const fresh = await network;
    if (fresh) return fresh;
    return new Response('', { status: 504, statusText: 'offline' });
  })());
});

/**
 * 写缓存,而且**永不抛出**。
 *
 * \`cache.put\` 对重定向响应(opaque / status 0)与配额超限都会 reject。
 * 这里是网络回填路径:一个没有 .catch 的 reject 会顺着 respondWith 的 promise
 * 冒上去,把**整个导航请求**变成网络错误 —— 症状是「网站突然打不开了」,
 * 而真正的原因只是这次刷新没写进缓存。缓存写不进去只该慢一点,不该出事。
 */
async function putSafely(cache, request, response) {
  try {
    if (!response || !response.ok || response.type !== 'basic') return;
    await cache.put(request, response);
  } catch (err) {
    // 配额满 / 不支持缓存的响应。忽略:老缓存还能用。
  }
}
`;
}