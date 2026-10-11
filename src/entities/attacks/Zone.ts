import Phaser from 'phaser';
import { damageEnemiesInRadius } from '../../utils/AreaDamage';
import type { DamageApplier } from '../../types';

/**
 * 灼烧区 —— 焚天·火海的落点残留
 *
 * 与「地效」的旧语义合并:它就是一片持续存在、按固定间隔跳伤的区域。
 *
 * ## 叠层
 *
 * 设计书给火海写了「最多叠加 3 层(同区峰值 84/s)」,而池里同时只会有
 * 一片同位置的火海 —— 所以叠层不靠「多生成几个 Zone」,靠**同一片区域自己数层**。
 * 每次新的火球落在已有火火海上时调 addStack():层数 +1、时间重置。
 * 这样「同屏火海数量」与池容量解耦,也不会因为池耗尽而出现火海凭空消失。
 */
export class Zone extends Phaser.GameObjects.Container {
  public isDead = false;
  public damage = 10;

  private gfx: Phaser.GameObjects.Graphics;
  private enemyGroup!: Phaser.GameObjects.Group;
  private applyDamage!: DamageApplier;

  private radius = 70;
  /** 火海的每秒灼烧伤害,叠层时线性叠加 */
  private dps = 0;
  private lifeMs = 3000;
  private elapsedMs = 0;
  private tickMs = 300;
  private nextTickAt = 0;
  private color = 0xff5522;
  private maxStacks = 1;
  public stacks = 1;

  constructor(scene: Phaser.Scene) {
    super(scene, 0, 0);
    this.gfx = scene.add.graphics();
    this.add([this.gfx]);
    scene.add.existing(this);
    this.setActive(false).setVisible(false);
  }

  bind(enemyGroup: Phaser.GameObjects.Group, apply: DamageApplier): void {
    this.enemyGroup = enemyGroup;
    this.applyDamage = apply;
  }

  setup(
    x: number,
    y: number,
    damage: number,
    radius: number,
    lifeMs: number,
    dps: number,
    color: number,
    maxStacks: number,
  ): void {
    this.damage = damage;
    this.radius = radius;
    this.dps = dps;
    this.lifeMs = Math.max(200, lifeMs);
    // 跳伤间隔 300ms —— 1 秒 3 跳,足够表现「持续灼烧」又不至于把
    // 每帧的敌人遍历放大三倍
    this.tickMs = 300;
    this.elapsedMs = 0;
    this.nextTickAt = 0;
    this.isDead = false;
    this.color = color;
    this.maxStacks = Math.max(1, maxStacks);
    this.stacks = 1;

    this.setActive(true).setVisible(true);
    this.setPosition(x, y);
    this.setAlpha(1);
    this.draw(0);
  }

  /**
   * 新一发火球落在已有的火海上:叠一层并把存活时间续满。
   * @returns 是否真的叠上了(已达上限返回 false)
   */
  addStack(): boolean {
    if (this.stacks >= this.maxStacks) return false;
    this.stacks++;
    this.elapsedMs = 0;
    this.draw(0);
    return true;
  }

  /** 每 tick 的伤害 = 直伤 × 叠层(伤害项) + 每秒灼烧 × 叠层 */
  private get tickDamage(): number {
    return this.damage * this.stacks + (this.dps * this.stacks * this.tickMs) / 1000;
  }

  preUpdate(time: number, delta: number): void {
    if (!this.active) return;
    if (this.scene.physics.world.isPaused) return;

    this.elapsedMs += delta;
    const t = Math.min(1, this.elapsedMs / this.lifeMs);
    this.draw(t);

    if (time >= this.nextTickAt) {
      this.nextTickAt = time + this.tickMs;
      damageEnemiesInRadius(
        this.enemyGroup, this.x, this.y, this.radius, this.tickDamage,
        this.applyDamage,
      );
    }

    if (t >= 1) this.kill();
  }

  /** fade-in / 呼吸 / 收尾三个阶段,视觉上区分地效的存续 */
  private draw(t: number): void {
    const g = this.gfx;
    g.clear();
    const grow = t < 0.12 ? t / 0.12 : t > 0.85 ? Math.max(0, (1 - t) / 0.15) : 1;
    const r = this.radius * grow;
    const breathe = 1 + Math.sin(t * 12) * 0.03;

    g.fillStyle(this.color, 0.18 * grow);
    g.fillCircle(0, 0, r * breathe);
    g.lineStyle(2, this.color, 0.7 * grow);
    g.strokeCircle(0, 0, r * breathe);
  }

  kill(): void {
    this.isDead = true;
    this.gfx.clear();
    this.setActive(false).setVisible(false);
  }
}