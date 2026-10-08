import Phaser from 'phaser';
import { damageEnemiesInRadius } from '../../utils/AreaDamage';
import type { DamageApplier } from '../../types';

/**
 * 地效 —— 在指定地点持续存在一段时间,周期性对范围内造成伤害
 *
 * 与落印的区别:落印是一次性砸落判定,地效是持续驻留 + 周期性跳伤。
 */
export class Zone extends Phaser.GameObjects.Container {
  public isDead = false;
  public damage = 10;

  private gfx: Phaser.GameObjects.Graphics;
  private enemyGroup!: Phaser.GameObjects.Group;
  private applyDamage!: DamageApplier;

  private radius = 70;
  private lifeMs = 4000;
  private elapsedMs = 0;
  private tickMs = 500;
  private nextTickAt = 0;
  private color = 0xaa44ff;

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
    tickMs: number,
    areaMul: number,
    color: number,
  ): void {
    this.damage = damage;
    this.radius = radius * areaMul;
    this.lifeMs = Math.max(200, lifeMs);
    this.tickMs = Math.max(80, tickMs);
    this.elapsedMs = 0;
    this.nextTickAt = 0;
    this.isDead = false;
    this.color = color;

    this.setActive(true).setVisible(true);
    this.setPosition(x, y);
    this.setAlpha(1);
    this.draw(0);
  }

  /** fade-in / 呼吸 / 收尾三个阶段,视觉上区分地效的存续 */
  private draw(t: number): void {
    const g = this.gfx;
    g.clear();
    const grow = t < 0.12 ? t / 0.12 : t > 0.85 ? Math.max(0, (1 - t) / 0.15) : 1;
    const r = this.radius * grow;
    const breathe = 1 + Math.sin(t * 12) * 0.03;

    g.fillStyle(this.color, 0.16 * grow);
    g.fillCircle(0, 0, r * breathe);
    g.lineStyle(2, this.color, 0.7 * grow);
    g.strokeCircle(0, 0, r * breathe);
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
        this.enemyGroup, this.x, this.y, this.radius,
        this.damage, this.applyDamage,
      );
    }

    if (t >= 1) this.kill();
  }

  kill(): void {
    this.isDead = true;
    this.gfx.clear();
    this.setActive(false).setVisible(false);
  }
}