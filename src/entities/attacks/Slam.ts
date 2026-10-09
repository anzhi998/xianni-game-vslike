import Phaser from 'phaser';
import { damageEnemiesInRadius } from '../../utils/AreaDamage';
import type { DamageApplier } from '../../types';

/**
 * 落印 —— 从目标头顶垂直砸落,落地时对落点周围造成范围伤害
 *
 * 与直射的���键差异:生成位置在**目标**而非玩家,不做碰撞检测,
 * 而是在落地瞬间按半径做一次范围判定(utils/AreaDamage)。
 */
export class Slam extends Phaser.GameObjects.Container {
  public isDead = false;
  public damage = 10;
  public radius = 60;
  public areaMul = 1;

  private marker: Phaser.GameObjects.Graphics;
  private seal: Phaser.GameObjects.Image;
  private enemyGroup!: Phaser.GameObjects.Group;
  private applyDamage!: DamageApplier;

  private targetX = 0;
  private targetY = 0;
  private fallHeight = 260;
  private fallMs = 320;
  private elapsedMs = 0;
  private areaScale = 1;

  /**
   * 落地后的回调,由 WeaponSystem 按神通配置注入。
   *
   * 为什么用回调而不是让 Slam 直接持有 zone 池:那样会让 Slam 依赖
   * WeaponSystem 的池子,违反「实体不自己够取依赖」的约定。
   *
   * ⚠️ 池化对象带回调必须在下一次 setup 前清掉 —— kill() 与 impact() 都置 null。
   * 漏清会让上一次发射的回调在新对象上触发(旧位置冒出一片火海)。
   */
  public onImpact: ((x: number, y: number, radius: number) => void) | null = null;

  constructor(scene: Phaser.Scene) {
    super(scene, 0, 0);
    // 地面落点标记(一个圆环)
    this.marker = scene.add.graphics();
    this.seal = scene.add.image(0, 0, 'proj_earth_pillar');
    this.add([this.marker, this.seal]);
    scene.add.existing(this);
    this.setActive(false).setVisible(false);
  }

  /** 依赖注入要在第一次 setup 之前完成 */
  bind(enemyGroup: Phaser.GameObjects.Group, apply: DamageApplier): void {
    this.enemyGroup = enemyGroup;
    this.applyDamage = apply;
  }

  setup(
    targetX: number,
    targetY: number,
    damage: number,
    radius: number,
    height: number,
    fallMs: number,
    areaMul: number,
    texture: string,
  ): void {
    this.damage = damage;
    this.radius = radius * areaMul;
    this.areaScale = areaMul;
    this.fallHeight = height;
    this.fallMs = Math.max(80, fallMs);
    this.elapsedMs = 0;
    this.isDead = false;

    this.targetX = targetX;
    this.targetY = targetY;

    this.setActive(true).setVisible(true);
    this.seal.setTexture(texture);
    this.setPosition(targetX, targetY - height);
    this.setAlpha(1);
    this.setScale(1);
    this.drawMarker();
  }

  private drawMarker(): void {
    const g = this.marker;
    g.clear();
    const r = this.radius * this.areaScale;
    g.lineStyle(2, 0xffcc55, 0.85);
    g.strokeCircle(0, this.fallHeight, r);
    g.fillStyle(0xffcc55, 0.14);
    g.fillCircle(0, this.fallHeight, r);
  }

  preUpdate(_time: number, delta: number): void {
    if (!this.active) return;
    if (this.scene.physics.world.isPaused) return;

    this.elapsedMs += delta;
    const t = Math.min(1, this.elapsedMs / this.fallMs);

    // 抛物线下落:加速砸地,落地前最后一段明显
    const eased = t * t;
    this.y = this.targetY - this.fallHeight * (1 - eased);
    // 影子随高度收缩,给出「越来越近」的视觉
    this.seal.setScale(this.areaScale * (0.4 + 0.6 * eased));

    if (t >= 1) {
      this.impact();
    }
  }

  private impact(): void {
    // 真正的落点范围判定:一次伤害半径内的全部敌人
    damageEnemiesInRadius(
      this.enemyGroup, this.targetX, this.targetY, this.radius,
      this.damage, this.applyDamage,
    );
    // 落地后的额外效果(进化态的「一片火海」)。
    // 必须在 kill() 之前调用 —— 回调里通常会 spawn 一个 Zone 实体,
    // 而 kill() 之后本对象已回到池中,字段会被下一次 setup 覆盖。
    this.onImpact?.(this.targetX, this.targetY, this.radius);
    this.onImpact = null;
    this.kill();
  }

  kill(): void {
    this.isDead = true;
    this.onImpact = null;
    this.setActive(false).setVisible(false);
  }
}