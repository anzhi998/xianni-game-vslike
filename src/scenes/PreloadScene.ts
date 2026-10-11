import Phaser from 'phaser';
import { generateAllAssets } from '../utils/AssetGenerator';
import { loadRealAssets, reportMissingAssets } from '../utils/AssetLoader';
import { ensureEnemyFrames } from '../utils/EnemyFrames';

/**
 * 资源加载场景 —— 两段式
 *
 *   preload():排入 `src/assets/` 下的真实素材(文件名即纹理键)
 *   create() :剩下的键由 Phaser.Graphics 程序化补齐
 *
 * ⚠️ 进度条与 `complete` 回调必须挂在 **preload()** 里,不能留在 create()。
 *
 *    Phaser 在 `preload()` 返回之后就把队列跑完,然后才调 `create()`。
 *    一旦 create() 里才注册 `load.on('complete')`,那个事件**永远不会再触发** ——
 *    文件越多越明显:进度条停在 0,游戏卡在「正在生成世界...」直到超时。
 *    而 `load.start()` 在 create() 里是另一回事:那是**重新开一次空的加载**,
 *    它会触发 complete,于是原来的代码靠这个副作用「碰巧」还能往下走。
 *    一旦 preload() 里真的排了文件,这个巧合就成了掩盖 bug 的东西。
 */
export class PreloadScene extends Phaser.Scene {
  /** 缺失报告的一行摘要。调试面板读它(HUD 是拉取式的,不靠事件传值) */
  public assetSummary = '';
  /** 真的切出多帧的怪物贴图数量。0 = 素材全是单帧,或根本没加载 */
  public enemyFrameCount = 0;

  constructor() {
    super('PreloadScene');
  }

  preload(): void {
    this.cameras.main.setBackgroundColor('#0d0d1a');

    const cx = this.cameras.main.width / 2;
    const cy = this.cameras.main.height / 2;

    this.add.text(cx, cy - 60, '正在生成世界...', {
      fontFamily: 'monospace',
      fontSize: '24px',
      color: '#e0e0e0',
    }).setOrigin(0.5);

    const barWidth = 400;
    const barHeight = 20;
    const barX = cx - barWidth / 2;
    const barY = cy;

    const bg = this.add.rectangle(barX, barY, barWidth, barHeight, 0x222244).setOrigin(0, 0.5);
    bg.setStrokeStyle(2, 0x4444aa);

    const fill = this.add.rectangle(barX + 2, barY, 0, barHeight - 4, 0x6bff6b).setOrigin(0, 0.5);

    this.load.on('progress', (value: number) => {
      fill.width = (barWidth - 4) * value;
    });

    // 真实素材全部就位后再补程序化的那批,然后进主菜单。
    // ⚠️ 不要用 create() + load.start() 那套「空跑一次来触发 complete」的做法
    this.load.on('complete', () => {
      this.finishLoad();
    });

    loadRealAssets(this);
  }

  private finishLoad(): void {
    // generateAllAssets 的每个 makeTexture 都有 `if (textures.exists(key)) return;` 守卫,
    // 所以真实素材已经占住的位置不会被程序化图覆盖 —— 接线不需要改它一行
    generateAllAssets(this);
    // 切帧必须在生成之后:真实素材与程序化图都要已经进了 scene.textures,
    // 而一张单帧图会被判成「帧数 1」而跳过 —— 这是有意的(素材是逐步替换的)
    // 怪物已经不走动了,但切帧仍然要留着:真实素材是多帧横排,不切帧的话整张图
    // 会被铺出来 —— 2 帧的表就是两只怪并排。
    // 切出来的数量必须单独打一行:**切帧失败在日志里没有痕迹**,因为
    // getFrameNames() 默认隐藏 __BASE,切成功和切失败的帧名清单长得一模一样。
    // 这个数就是唯一能查的线索(屏幕上是两只怪,日志上一切正常)。
    this.enemyFrameCount = ensureEnemyFrames(this);
    this.assetSummary = reportMissingAssets(this);
    // eslint-disable-next-line no-console
    console.info(
      `[切帧] 怪物横排素材切出 ${this.enemyFrameCount} 张。` +
      (this.enemyFrameCount === 0
        ? '\n  当前没有任何多帧素材,所有怪都直接显示整张图 —— 这是正常的。'
        : '\n  这些图只取第 0 帧显示,其余帧不参与任何动画。'),
    );

    // 进度条画到头再切场景,避免菜单在进度条还是 0 的时候冒出来
    this.time.delayedCall(200, () => {
      this.scene.start('MainMenuScene');
    });
  }
}