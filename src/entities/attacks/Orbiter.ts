import Phaser from 'phaser';
import type { Enemy } from '../Enemy';
import type { DamageApplier } from '../../types';

/**
 * 环绕 —— 持续绕玩家公转的护卫体,接触即伤害
 *
 * 这是唯一「非发射式但持续存在」的形态:它不靠 lifeMs 超时销毁走完全程,
 * 而是在存续期内持续存在,因此需要一个独立的生命周期计时器。
 *
 * 之前环绕体被明确排除在设计之外(装不进发射即销毁的模型),
 * 现在通过独立实体类落地 —— 环绕与投射物本就不该共用一套生命周期。
 */
export class Orbiter extends Phaser.GameObjects.Image {
  public isDead = false;
  public damage = 10;
  public orbitRadius = 60;
  public orbitSpeed = 2;
  public touchCooldownMs = 350;

  private enemyGroup!: Phaser.GameObjects.Group;
  private applyDamage!: DamageApplier;
  /** 公转中心。必须每帧取实时坐标 —— 用施法瞬间的位置会让环绕体在玩家移动后落在原地 */
  private getPivot: () => { x: number; y: number } = () => ({ x: 0, y: 0 });

  private orbitAngle = 0;
  private lifeMs = 3000;
  private elapsedMs = 0;
  private tickAt = 0;
  private hitSet = new Set<Enemy>();

  constructor(scene: Phaser.Scene) {
    super(scene, 0, 0, 'proj_knife');
    scene.add.existing(this);
    this.setActive(false).setVisible(false);
    this.setDepth(85);
  }

  bind(
    enemyGroup: Phaser.GameObjects.Group,
    apply: DamageApplier,
    getPivot?: () => { x: number; y: number },
  ): void {
    this.enemyGroup = enemyGroup;
    this.applyDamage = apply;
    if (getPivot) this.getPivot = getPivot;
  }

  setup(
    startAngle: number,
    damage: number,
    orbitRadius: number,
    orbitSpeed: number,
    lifeMs: number,
    areaMul: number,
    texture: string,
  ): void {
    this.orbitAngle = startAngle;
    this.damage = damage;
    this.orbitRadius = orbitRadius * areaMul;
    this.orbitSpeed = orbitSpeed;
    this.lifeMs = lifeMs;
    this.elapsedMs = 0;
    this.tickAt = 0;
    this.isDead = false;
    this.hitSet.clear();

    this.setTexture(texture);
    this.setActive(true).setVisible(true);
    this.setAlpha(1);
    this.setScale(Math.max(0.6, Math.min(2, areaMul)));
    this.setDepth(85);

    const p = this.getPivot();
    this.setPosition(
      p.x + Math.cos(startAngle) * this.orbitRadius,
      p.y + Math.sin(startAngle) * this.orbitRadius,
    );
  }

  preUpdate(time: number, delta: number): void {
    if (!this.active) return;
    if (this.scene.physics.world.isPaused) return;

    this.elapsedMs += delta;
    this.orbitAngle += this.orbitSpeed * (delta / 1000);
    // 每帧取玩家的实时坐标 —— 玩家移动时环绕体必须跟着走,否则会落在原地
    const p = this.getPivot();
    this.setPosition(
      p.x + Math.cos(this.orbitAngle) * this.orbitRadius,
      p.y + Math.sin(this.orbitAngle) * this.orbitRadius,
    );
    this.setRotation(this.orbitAngle + Math.PI / 2);

    // 接触伤害:按冷却节流,避免每帧结算
    if (time >= this.tickAt) {
      this.tickAt = time + this.touchCooldownMs;
      this.damageTouching();
    }

    if (this.elapsedMs >= this.lifeMs) this.kill();
  }

  private damageTouching(): void {
    const r = 16 * this.scaleX;
    const r2 = r * r;
    const list = this.enemyGroup.children.entries;
    for (let i = 0; i < list.length; i++) {
      const e = list[i] as Enemy;
      if (!e.active || e.isDead) continue;
      if (this.hitSet.has(e)) continue;
      const dx = e.x - this.x;
      const dy = e.y - this.y;
      if (dx * dx + dy * dy > r2) continue;
      this.hitSet.add(e);
      this.applyDamage(e, this.damage, e.x, e.y - 8);
    }
  }

  kill(): void {
    this.isDead = true;
    this.hitSet.clear();
    this.setActive(false).setVisible(false);
  }
}