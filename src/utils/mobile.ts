/**
 * 移动端外壳 —— PWA 注册、横屏锁定、页面生命周期
 *
 * 这里只放「在浏览器里跑游戏」这一层的事:离线缓存、屏幕方向、切后台。
 * 游戏内的触屏摇杆在 `InputManager` 里,那是输入,不属于外壳。
 */

/** 装到主屏幕后(fullscreen/standalone)才算真 PWA,浏览器标签页里不算 */
export function isStandalone(): boolean {
  const nav = navigator as Navigator & { standalone?: boolean };
  return (
    window.matchMedia?.('(display-mode: fullscreen)').matches === true ||
    window.matchMedia?.('(display-mode: standalone)').matches === true ||
    nav.standalone === true
  );
}

/**
 * 注册 Service Worker,让「装到主屏幕」的图标在飞行模式下也能打开。
 *
 * 开发环境不注册:dev server 的模块是带时间戳的临时路径,被缓存下来之后
 * 改一行代码看到的还是旧版本,那是比没有离线功能更难查的问题。
 */
export function registerOffline(): void {
  if (!import.meta.env.PROD) return;
  if (!('serviceWorker' in navigator)) return;

  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js').catch((err) => {
      // 注册失败只影响离线能力,游戏本身照常跑,所以只警告不中断
      console.warn('[pwa] Service Worker 注册失败', err);
    });
  });
}

/**
 * 锁定横屏。
 *
 * 浏览器只在**全屏**下才允许方向锁定,标签页里调用必然被拒(而且是异步拒),
 * 所以第一次尝试失败是正常的 —— 记下来,等玩家第一次碰到屏幕(有了用户手势)再试。
 * 真正兜底的是 index.html 里的竖屏遮罩:锁不上也只是少了个自动旋转,
 * 不会变成一块挡住画面的弹窗。
 */
let orientationRetryArmed = false;

export function lockLandscape(): void {
  const orientation = screen.orientation as ScreenOrientation & {
    lock?: (o: string) => Promise<void>;
  };
  if (typeof orientation?.lock !== 'function') return;

  const attempt = () => {
    orientation.lock?.('landscape').then(
      () => {
        if (orientationRetryArmed) {
          window.removeEventListener('touchend', attempt);
          window.removeEventListener('pointerdown', attempt);
          orientationRetryArmed = false;
        }
      },
      () => {
        /* 浏览器还没给手势权限,下个手势再说 */
      }
    );
  };

  attempt();
  if (!orientationRetryArmed) {
    orientationRetryArmed = true;
    window.addEventListener('touchend', attempt, { passive: true });
    window.addEventListener('pointerdown', attempt, { passive: true });
  }
}

/**
 * 切后台时自动暂停。
 *
 * 手机上「切出去看一眼消息」和「alt-tab」是同一个动作,而两者都会冻结 rAF ——
 * 回来时 Phaser 的 delta 会是一段巨大的空白,不暂停的话玩家会在原地被秒。
 * WebAudio 也在这之后需要一次用户手势才能恢复,不过本作没有音频,暂不处理。
 */
export function autoPauseOnHide(onHidden: () => void): void {
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) onHidden();
  });
}