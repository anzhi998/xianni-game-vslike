import Phaser from 'phaser';
import { gameConfig } from './config/GameConfig';
import { GameScene } from './scenes/GameScene';
import { autoPauseOnHide, lockLandscape, registerOffline } from './utils/mobile';
import { guardMainLoop } from './utils/MainLoopGuard';

const game = new Phaser.Game(gameConfig);

// 主循环保险丝:接管一帧的总入口,帧内异常兜住不外抛。
// 少了它,帧里任何一次异常都会让下一帧的 rAF 不再注册 —— 整条渲染循环当场死掉,
// 现象就是「画面停住、点什么都没反应」(标签页还活着、控制台还能打字)。
// 与调试无关,是常驻保护,详见 MainLoopGuard.ts
guardMainLoop(game);

// ===== 手机端外壳 =====
// 装到主屏幕 → 离线可玩 → 锁横屏 → 切后台自动暂停。
// 四件事都在这里,而不是散进各个场景:它们属于「游戏跑在浏览器里」这一层。
registerOffline();
lockLandscape();

autoPauseOnHide(() => {
  const scene = game.scene.getScene('GameScene') as GameScene | null;
  // `isActive` 对「已启动但被 scene.pause()」的场景仍然返回 true(死亡结算就是这种
  // 状态),所以这里查的是 isPaused:玩家已经不在战斗里,再弹一层暂停遮罩
  // 只会在结算画面上糊一块黑。scene.isPaused 则挡住悟道/融合面板 —— 那时物理已停,
  // 战斗其实已经暂停了,叠第二层同样会打架。
  if (!scene || game.scene.isPaused('GameScene') || scene.isPaused) return;
  scene.pauseGame();
});