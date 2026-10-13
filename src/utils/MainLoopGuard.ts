import type Phaser from 'phaser';

/**
 * 主循环保险丝 —— **不是调试代码,是常驻保护**。
 *
 * ## 它防的是什么
 *
 * Phaser 的渲染循环(`node_modules/phaser/src/dom/RequestAnimationFrame.js`):
 *
 *     this.step = function step (time) {
 *         _this.callback(time);                                        // ← 一帧全在这里
 *         if (_this.isRunning) {
 *             _this.timeOutID = window.requestAnimationFrame(step);   // ← 抛异常就到不了这行
 *         }
 *     };
 *
 * `callback` 就是 `Game.step.bind(game)` —— 一帧里的 **PRE_STEP → 输入分发 →
 * 各场景 update → POST_STEP → 渲染** 全在它里面。只要它抛一次,后面的
 * `requestAnimationFrame` 就再也不会执行,**整条渲染循环死掉**:
 * 标签页还活着、控制台还能打字、鼠标还能动,但画面永远停住、点什么都没反应,
 * 刷新之前不自愈。这个现象和「卡死」完全一样,极难定位。
 *
 * 本项目已经栽过两次,两次现象一模一样:
 *   1. UIScene 里跨局残留的僵尸 `Rectangle`,`setSize` 抛在 `Clock.update` 里;
 *   2. 调试按钮回调里一个未定义的标识符,异常一路冒到输入分发。
 *
 * ## 它做什么
 *
 * 接管一帧的总入口:异常照常打出**完整栈**,但**吞掉** —— 帧正常收尾,
 * 下一帧的 rAF 照常注册。症状于是从「整个游戏卡死」降级成
 * 「控制台一条红字,游戏继续跑」。
 *
 * 同一个异常每帧都会复现,所以只有前 3 次打全栈、之后每 60 帧报一次计数,
 * 免得把控制台刷爆。正常的帧只是多一层 try/catch,开销可忽略。
 */

/** 只取用到的字段,免得这段保护代码因为 Phaser 改了私有字段名就编译不过 */
type LoopLike = {
  callback?: (time: number, delta: number) => void;
  __mainLoopGuarded?: boolean;
};

export function guardMainLoop(game: Phaser.Game): void {
  const loop = (game as unknown as { loop?: LoopLike }).loop;
  if (!loop || loop.__mainLoopGuarded) return;
  loop.__mainLoopGuarded = true;

  let inner = loop.callback;
  let hits = 0;

  const wrapped = (time: number, delta: number): void => {
    try {
      inner?.(time, delta);
    } catch (err) {
      hits++;
      if (hits <= 3 || hits % 60 === 0) {
        // eslint-disable-next-line no-console
        console.error(
          `[主循环保险丝] 帧内异常第 ${hits} 次(已兜住,游戏继续跑):\n` +
            ((err as Error)?.stack ?? String(err)),
        );
      }
    }
  };

  // 用访问器接管,而不是直接 `loop.callback = wrapped`:
  // `TimeStep.start(cb)` 是在 `Game.boot` 里**异步**调用的(等 DOM ready),
  // 且有 `if (this.started) return` 早退 —— 那次赋值可能落在本函数之前或之后。
  // 访问器的 get 永远返回包装版、set 记下真正的内层实现,两种顺序都接得住。
  Object.defineProperty(loop, 'callback', {
    configurable: true,
    get: () => wrapped,
    set: (fn: (time: number, delta: number) => void) => {
      inner = fn;
    },
  });
}
