import Phaser from 'phaser';

/** 弹体碰撞圆半径(像素) */
const HIT_RADIUS = 4;

/**
 * 敌方弹丸 —— 术修(散修 / 魔道修士)的远程攻击
 *
 * 为什么单独一个实体而不是复用 Projectile:
 * Projectile 身上挂着整套法宝修饰(追踪/连锁/散射)、hitSet、索敌半径 ——
 * 那是「我方弹道」的全部语义。敌弹只需要「飞 → 命中玩家 → 消失」,
 * 复用它就得在 setup 里把一半字段喂成空值,反而更容易漏复位。
 *
 * 池化约定与其它实体一致:setup 复位全部状态、kill 关物理体、
 * preUpdate 带暂停守卫(否则玩家读升级面板时飞行中的弹丸会凭空过期)。
 */
export class EnemyShot extends Phaser.Physics.Arcade.Sprite {
  public damage = 8;
  public isDead = false;
  public lifeMs = 3000;
  public bornAt = 0;

  constructor(scene: Phaser.Scene) {
    super(scene, 0, 0, 'proj_enemy_shot');
    scene.add.existing(this);
    scene.physics.add.existing(this);
    this.setActive(false).setVisible(false);
    this.setDepth(78);
  }

  setup(x: number, y: number, angle: number, damage: number, speed: number, lifeMs = 3000): void {
    this.setPosition(x, y);
    this.setActive(true).setVisible(true);
    this.setTexture('proj_enemy_shot');
    this.setRotation(angle);
    this.setAlpha(1);
    this.damage = damage;
    this.lifeMs = lifeMs;
    this.bornAt = this.scene.time.now;
    this.isDead = false;

    const body = this.body as Phaser.Physics.Arcade.Body;
    body.enable = true;
    const r = HIT_RADIUS;
    body.setCircle(r, 0, 0);
    // setCircle 的偏移相对 body 顶点,补半个贴图尺寸让碰撞圆落在精灵中心
    body.setOffset(this.frame.realWidth / 2 - r, this.frame.realHeight / 2 - r);
    body.setVelocity(Math.cos(angle) * speed, Math.sin(angle) * speed);
  }

  preUpdate(time: number, delta: number): void {
    super.preUpdate(time, delta);
    if (!this.active) return;
    if (this.scene.physics.world.isPaused) return;
    if (this.isDead || time - this.bornAt > this.lifeMs) {
      this.kill();
    }
  }

  kill(): void {
    this.isDead = true;
    this.setActive(false).setVisible(false);
    const body = this.body as Phaser.Physics.Arcade.Body;
    body.enable = false;
    body.setVelocity(0, 0);
  }
}
