import Phaser from 'phaser';
import type { Enemy } from '../Enemy';

/**
 * 引力场 —— 向心聚拢几何
 *
 * 设计书给它一句很特别的话:「它本身几乎不造成伤害——先聚拢,再让别的神通打」。
 * 所以这个实体的伤害默认接近 0,它的价值是把敌人拖向中心。
 *
 * 为什么不用物理引擎的吸引:Arcade 没有内建吸引,而且那会让引力随刚体数量线性变贵。
 * 这里直接在 preUpdate 里遍历敌人改速度 —— 敌人数被 WaveConfig 限死,成本可接受,
 * 换来的是完全可控的强度曲线。
 */
export class Attractor extends Phaser.GameObjects.Container {
  public isDead = false;
  /**
   * 把敌人往中心拉的速度(px/s),在影响半径边缘为零、越近越强。
   *
   * ⚠️ 单位是速度而不是加速度。这里曾经写的是 `velocity += accel * dt`,
   * 那是把本体系当成「速度会跨帧累积」的物理引擎来用了 —— 但敌人的速度
   * 每帧都会被 EnemyAiSystem 整份覆盖,所以加速度只能作用一帧,
   * 实际拉扯量是 accel × dt² ≈ 每帧 0.1 像素,整门法术约等于不存在。
   * 改成「叠加一个速度偏移」之后,它才是设计书里那句「把敌人拖到一点」。
   */
  public pull = 300;
  /** 影响半径 */
  public radius = 240;

  private gfx: Phaser.GameObjects.Graphics;
  private enemyGroup!: Phaser.GameObjects.Group;
  /**
   * 本实体不造成伤害 —— 设计书原话「它本身几乎不造成伤害」,那就真的不造成。
   *
   * 曾经给过一个 0.5 的固定伤害以驱动击杀链,那是错的:引力每帧结算,
   * 0.5 × 60 帧/秒 × N 个敌人会把伤害数字刷成瀑布,而且让实际输出与
   * 配置里的 damage 字段对不上。它纯粹是控制工具。
   */

  private lifeMs = 2000;
  private elapsedMs = 0;

  constructor(scene: Phaser.Scene) {
    super(scene, 0, 0);
    this.gfx = scene.add.graphics();
    this.add([this.gfx]);
    scene.add.existing(this);
    this.setActive(false).setVisible(false);
  }

  bind(enemyGroup: Phaser.GameObjects.Group): void {
    this.enemyGroup = enemyGroup;
  }

  setup(x: number, y: number, radius: number, pull: number, lifeMs: number): void {
    this.radius = radius;
    this.pull = pull;
    this.lifeMs = lifeMs;
    this.elapsedMs = 0;
    this.isDead = false;

    this.setActive(true).setVisible(true);
    this.setPosition(x, y);
    this.setAlpha(1);
    this.draw(0);
  }

  private draw(phase: number): void {
    const g = this.gfx;
    g.clear();
    // 收缩的同心圆:直观表达「往里吸」
    for (let i = 0; i < 3; i++) {
      const t = (phase + i / 3) % 1;
      g.lineStyle(2, 0x8866ff, 0.6 * (1 - t));
      g.strokeCircle(0, 0, this.radius * (1 - t * 0.8));
    }
    g.lineStyle(1, 0xaa88ff, 0.35);
    g.strokeCircle(0, 0, this.radius);
  }

  preUpdate(_time: number, delta: number): void {
    if (!this.active) return;
    if (this.scene.physics.world.isPaused) return;

    this.elapsedMs += delta;
    if (this.elapsedMs >= this.lifeMs) {
      this.kill();
      return;
    }

    this.draw(this.elapsedMs / this.lifeMs);

    for (const e of this.enemyGroup.getChildren()) {
      const enemy = e as Enemy;
      if (!enemy.active || enemy.isDead) continue;
      // 牵引抗性(怪物设计文档第六节):坦克原型拉不动。
      // 抗性读的是 Enemy 上的字段而不是自己判断 enemyKey ——
      // 天生抗性与精英掷骰合并的那一步发生在 Enemy.setup 里
      if (enemy.resistPull) continue;

      const dx = this.x - enemy.x;
      const dy = this.y - enemy.y;
      const dist = Math.hypot(dx, dy);
      if (dist > this.radius || dist < 1) continue;

      // 平方衰减:边缘处几乎无效,越近拉得越狠 —— 避免出现「隔着半屏被吸过来」
      const falloff = 1 - dist / this.radius;
      const pull = this.pull * falloff * falloff;
      const body = enemy.body as Phaser.Physics.Arcade.Body;
      body.velocity.x += (dx / dist) * pull;
      body.velocity.y += (dy / dist) * pull;
    }
  }

  kill(): void {
    this.isDead = true;
    this.setActive(false).setVisible(false);
    this.gfx.clear();
  }
}
