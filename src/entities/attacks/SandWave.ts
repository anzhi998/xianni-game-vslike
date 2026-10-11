import Phaser from 'phaser';
import { forEachEnemyInArc } from '../../utils/AreaDamage';
import type { EnemyShot } from '../EnemyShot';
import type { DamageApplier, DamageOptions } from '../../types';

/**
 * 沙浪 —— 厚土术的扇形推进
 *
 * 一次释放分成 N 段,由近及远依次结算。敌人被推着往外走,
 * 于是它会依次穿过每一段并**各结算一次伤害** —— 这就是「分段推进」的全部含义,
 * 也是厚土术「单体 36 / 常态群伤 120」这个奇怪配比的来源:
 * 单目标要穿过全部 N 段,群怪只需要被扇面扫到一次。
 *
 * ⚠️ 因此这里**不能**用「本次已命中过」的集合去重:去重会让分段推进退化成
 *    一段,厚土术的单体伤害直接砍到三分之一,而那正是它最低的那一项数值。
 *
 * ## 推挤为什么写成「速度偏移」
 *
 * EnemyAiSystem 每帧整体重写敌人速度,所以 applyKnock 写的不是位移量而是一个
 * 持续 ms 的速度偏移(见 Enemy.knockX/knockY)。早先用「给敌人加一个位移量」
 * 的写法看起来在动,下一帧就被 AI 抹平了 —— 推挤会完全无效,而且不报错。
 *
 * ## 不使用 tween
 *
 * 池化对象带 tween 会跨存活期触发(见 CLAUDE.md)。存续用 preUpdate 里的
 * elapsedMs 计时 + 透明度衰减。
 */
export class SandWave extends Phaser.GameObjects.Container {
  public isDead = false;

  private gfx: Phaser.GameObjects.Graphics;
  private enemyGroup!: Phaser.GameObjects.Group;
  private enemyShots!: Phaser.GameObjects.Group;
  private applyDamage!: DamageApplier;
  /** 满级厚土术起效:沙浪会打掉沿途的敌弹。首领的弹免疫(见 EnemyShot.fromBoss) */
  private clearsShots = false;

  private facing = 0;
  private radius = 200;
  private span = 1;
  private segments = 2;
  private segmentMs = 120;
  private damage = 8;
  private pushSpeed = 200;
  private pushMs = 260;
  private maxTargets = 4;
  private lifeMs = 400;
  private color = 0xc8a05a;
  private elapsedMs = 0;
  private nextSegmentAt = 0;
  private status: DamageOptions = {};

  constructor(scene: Phaser.Scene) {
    super(scene, 0, 0);
    this.gfx = scene.add.graphics();
    this.add([this.gfx]);
    scene.add.existing(this);
    this.setActive(false).setVisible(false);
    this.setDepth(78);
  }

  bind(
    enemyGroup: Phaser.GameObjects.Group,
    enemyShots: Phaser.GameObjects.Group,
    apply: DamageApplier,
  ): void {
    this.enemyGroup = enemyGroup;
    this.enemyShots = enemyShots;
    this.applyDamage = apply;
  }

  setup(
    x: number,
    y: number,
    facing: number,
    damage: number,
    radius: number,
    span: number,
    segments: number,
    pushSpeed: number,
    maxTargets: number,
    lifeMs: number,
    color: number,
    status: DamageOptions = {},
    clearsShots = false,
  ): void {
    this.facing = facing;
    this.radius = radius;
    this.span = span;
    this.segments = Math.max(1, segments);
    this.damage = damage;
    this.pushSpeed = pushSpeed;
    this.maxTargets = maxTargets;
    this.lifeMs = lifeMs;
    // 段与段之间铺满整个存续期,段数越多单段越薄 —— 4 段的推进感强于 2 段
    this.segmentMs = Math.max(30, lifeMs / this.segments);
    this.elapsedMs = 0;
    this.nextSegmentAt = 0;
    this.status = status;
    this.clearsShots = clearsShots;
    this.isDead = false;

    this.pushMs = 260;
    this.color = color;
    this.setActive(true).setVisible(true);
    this.setPosition(x, y);
    this.setAlpha(1);
    this.draw(0);
  }

  preUpdate(time: number, delta: number): void {
    if (!this.active) return;
    if (this.scene.physics.world.isPaused) return;

    this.elapsedMs += delta;
    const t = Math.min(1, this.elapsedMs / this.lifeMs);
    this.draw(t);

    if (time >= this.nextSegmentAt) {
      this.nextSegmentAt = time + this.segmentMs;
      this.advanceSegment();
    }

    if (t >= 1) this.kill();
  }

  /**
   * 推进一段。
   *
   * 本段的扇面半径 = 总半径 × (已推进段数 / 总段数):
   * 于是每一段只看「刚刚被覆盖到的那一圈」,而不是每次都把整个扇面重扫一遍。
   */
  private advanceSegment(): void {
    const done = Math.min(this.segments, Math.floor(this.elapsedMs / this.segmentMs) + 1);
    const inner = this.radius * ((done - 1) / this.segments);
    const outer = this.radius * (done / this.segments);

    let hits = 0;
    forEachEnemyInArc(
      this.enemyGroup, this.x, this.y, outer, this.facing, this.span,
      (e) => {
        // 命中上限。超出的目标这一段不吃伤害,但仍然被推(推挤是范围效果,不该被上限卡掉)
        if (hits >= this.maxTargets) return;
        const dx = e.x - this.x;
        const dy = e.y - this.y;
        const d = Math.hypot(dx, dy) || 1;
        // 站在内圈边界上的(没被这一段真正覆盖)不算
        if (d < inner * 0.85) return;
        hits++;
        this.applyDamage(e, this.damage, e.x, e.y - 8, this.status);
        // 推挤方向:从玩家指向敌人 —— 被推出扇形外侧,而不是沿扇面切向
        e.applyKnock(dx / d, dy / d, this.pushSpeed, this.pushMs, this.scene.time.now);
      },
      undefined,
    );

    if (this.clearsShots) this.sweepShots(inner, outer);
  }

  /**
   * 打掉推进段里的敌弹。
   *
   * 判定与敌人同一套环带(内圈边界到外圈),所以「沙浪扫过去」在视觉与判定上是
   * 同一条弧 —— 玩家看到波前经过弹丸,弹丸就没了。首领的弹免疫。
   */
  private sweepShots(inner: number, outer: number): void {
    const shots = this.enemyShots.getChildren();
    const half = this.span / 2;
    for (let i = 0; i < shots.length; i++) {
      const shot = shots[i] as EnemyShot;
      if (!shot || !shot.active || shot.isDead) continue;
      if (shot.fromBoss) continue;          // 首领的招不能被打掉
      const dx = shot.x - this.x;
      const dy = shot.y - this.y;
      const d = Math.hypot(dx, dy);
      if (d < inner * 0.85 || d > outer) continue;
      let diff = Math.atan2(dy, dx) - this.facing;
      while (diff > Math.PI) diff -= Math.PI * 2;
      while (diff < -Math.PI) diff += Math.PI * 2;
      if (Math.abs(diff) > half) continue;
      shot.kill();
    }
  }

  private draw(t: number): void {
    const g = this.gfx;
    const color = this.color;
    g.clear();
    // 已推进的部分画实,尚未推进的部分画淡 —— 玩家能一眼看出「沙浪走到哪了」
    const front = this.radius * t;
    const alpha = 1 - t * 0.6;

    g.fillStyle(color, 0.18 * alpha);
    g.slice(0, 0, front, this.facing - this.span / 2, this.facing + this.span / 2, false);
    g.fillPath();

    g.lineStyle(3, color, 0.75 * alpha);
    g.beginPath();
    g.arc(0, 0, front, this.facing - this.span / 2, this.facing + this.span / 2, false);
    g.strokePath();

    // 波前的亮弧
    g.lineStyle(5, 0xffe0a0, 0.9 * alpha);
    g.beginPath();
    g.arc(0, 0, front, this.facing - this.span / 2, this.facing + this.span / 2, false);
    g.strokePath();
  }

  kill(): void {
    this.isDead = true;
    this.gfx.clear();
    this.setActive(false).setVisible(false);
  }
}