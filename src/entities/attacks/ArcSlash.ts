import Phaser from 'phaser';
import { damageEnemiesInArc } from '../../utils/AreaDamage';
import type { DamageApplier } from '../../types';

/**
 * 弧斩 —— 以玩家为中心扫过一段圆弧,沿途命中
 *
 * 判定发生在挥斩的**中段**而不是每帧,以免同一次挥斩对同一敌人反复结算。
 * 因此维护 hitSet 记录本次挥斩已命中的敌人。
 */
export class ArcSlash extends Phaser.GameObjects.Container {
  public isDead = false;
  public damage = 10;

  private arc: Phaser.GameObjects.Graphics;
  private enemyGroup!: Phaser.GameObjects.Group;
  private applyDamage!: DamageApplier;

  private facing = 0;
  private radius = 120;
  private span = Math.PI / 3;
  private sweepMs = 220;
  private elapsedMs = 0;
  private pivotX = 0;
  private pivotY = 0;
  private hasStruck = false;
  private hitSet = new Set<import('../Enemy').Enemy>();

  constructor(scene: Phaser.Scene) {
    super(scene, 0, 0);
    this.arc = scene.add.graphics();
    this.add([this.arc]);
    scene.add.existing(this);
    this.setActive(false).setVisible(false);
  }

  bind(enemyGroup: Phaser.GameObjects.Group, apply: DamageApplier): void {
    this.enemyGroup = enemyGroup;
    this.applyDamage = apply;
  }

  setup(
    pivotX: number,
    pivotY: number,
    facing: number,
    damage: number,
    radius: number,
    span: number,
    sweepMs: number,
    areaMul: number,
  ): void {
    this.pivotX = pivotX;
    this.pivotY = pivotY;
    this.facing = facing;
    this.damage = damage;
    this.radius = radius * areaMul;
    this.span = span;
    this.sweepMs = Math.max(80, sweepMs);
    this.elapsedMs = 0;
    this.hasStruck = false;
    this.isDead = false;
    this.hitSet.clear();

    this.setActive(true).setVisible(true);
    this.setPosition(pivotX, pivotY);
    this.setAlpha(1);
    this.drawArc(0);
  }

  private drawArc(t: number): void {
    const g = this.arc;
    g.clear();
    // 挥砍过程中弧从窄到满再到窄,像刀锋扫过
    const grow = t < 0.5 ? t / 0.5 : 1 - (t - 0.5) / 0.5;
    const half = (this.span / 2) * Math.max(0.05, grow);
    g.lineStyle(6 * Math.max(0.3, grow), 0xffffff, 0.85);
    g.beginPath();
    g.arc(0, 0, this.radius, this.facing - half, this.facing + half);
    g.strokePath();
    g.lineStyle(2, 0xffffff, 0.4);
    g.beginPath();
    g.arc(0, 0, this.radius * 0.8, this.facing - half, this.facing + half);
    g.strokePath();
  }

  preUpdate(_time: number, delta: number): void {
    if (!this.active) return;
    if (this.scene.physics.world.isPaused) return;

    this.elapsedMs += delta;
    const t = Math.min(1, this.elapsedMs / this.sweepMs);
    this.drawArc(t);

    // 中段(30%~70%)判定一次范围伤害,hitSet 防止重复
    if (!this.hasStruck && t >= 0.3) {
      this.hasStruck = true;
      damageEnemiesInArc(
        this.enemyGroup, this.pivotX, this.pivotY,
        this.radius, this.facing, this.span, this.damage,
        this.applyDamage, this.hitSet,
      );
    }

    if (t >= 1) this.kill();
  }

  kill(): void {
    this.isDead = true;
    this.hitSet.clear();
    this.setActive(false).setVisible(false);
  }
}