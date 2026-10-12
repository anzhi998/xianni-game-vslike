import Phaser from 'phaser';

/** 弹体碰撞圆半径(像素)。**外观不影响它** —— 见 setup 的注释 */
const HIT_RADIUS = 4;

/**
 * 一次发射的外观参数。全部可选 —— 不传就是普通术修的暗红圆弹。
 *
 * ⚠️ 这里**没有碰撞半径**。首领的火羽画到 30px,碰撞圆仍然是 4px,
 *    与它取代的圆弹一字不差。原因不是偷懒,是**公正**:判定跟着贴图放大的话,
 *    同一道羽幕在「看起来擦过去」的地方会真的打中你,而玩家没有任何线索
 *    说明这片羽为什么有更大的判定 —— 视觉与判定不符是本项目最不能接受的一类错。
 *    想让火羽更难躲,改的是片数(count),不是让它「变大」。
 */
export interface ShotStyle {
  /** 纹理键。缺省 'proj_enemy_shot' */
  texture?: string;
  /** 命中玩家时的爆焰颜色 */
  color?: number;
  /** 自转速度(弧度/秒)。0 = 不自转 */
  spin?: number;
  /** 是否留拖尾 */
  trail?: boolean;
}

/**
 * 敌方弹丸 —— 术修(散修 / 魔道修士)的远程攻击,也是首领的招式载体
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
  /**
   * 是不是首领发出的弹。
   *
   * 只有满级厚土术会读它:沙浪可以打掉普通术修的弹,但**首领的火羽不能被打掉** ——
   * Boss 的招式是它唯一的压迫手段,允许清弹等于把「躲扇形」这道题直接删了,
   * 朱雀会退化成一只血厚的木桩。
   */
  public fromBoss = false;

  /** 命中时的爆焰颜色。由 GameScene.onPlayerHitShot 读取 */
  public hitColor = 0xdd4466;

  private spin = 0;
  private useTrail = false;
  private trail!: Phaser.GameObjects.Particles.ParticleEmitter;

  constructor(scene: Phaser.Scene) {
    super(scene, 0, 0, 'proj_enemy_shot');
    scene.add.existing(this);
    scene.physics.add.existing(this);
    this.setActive(false).setVisible(false);
    this.setDepth(78);
  }

  /**
   * 绑定拖尾发射器。由 GameScene 在池预建时调一次。
   *
   * 拖尾不进污染池:发射器常驻、只靠 `emitting` 开关 —— 每发新建一个
   * 会让 60 发的弹幕池变成 60 个发射器,而它们全都在 idle 空转。
   */
  bindTrail(emitter: Phaser.GameObjects.Particles.ParticleEmitter): void {
    this.trail = emitter;
  }

  setup(
    x: number, y: number, angle: number, damage: number, speed: number,
    lifeMs = 3000, fromBoss = false, style?: ShotStyle,
  ): void {
    this.fromBoss = fromBoss;
    this.setPosition(x, y);
    this.setActive(true).setVisible(true);
    this.setTexture(style?.texture ?? 'proj_enemy_shot');
    this.setRotation(angle);
    this.setAlpha(1);
    this.damage = damage;
    this.lifeMs = lifeMs;
    this.bornAt = this.scene.time.now;
    this.isDead = false;

    this.spin = style?.spin ?? 0;
    this.hitColor = style?.color ?? 0xdd4466;

    // 拖尾:常驻发射器挪到弹体位置并开启,回收时关掉。
    // ⚠️ 位置必须每发重置 —— 复用同一个发射器时它停在上一发死亡的地方,
    //    不重置的话新弹的拖尾会从屏幕另一头拉过来。
    this.useTrail = !!style?.trail && !!this.trail;
    if (this.useTrail) {
      this.trail.setPosition(x, y);
      this.trail.setParticleTint(this.hitColor);
      this.trail.start();
    }

    const body = this.body as Phaser.Physics.Arcade.Body;
    body.enable = true;
    const r = HIT_RADIUS;
    body.setCircle(r, 0, 0);
    // setCircle 的偏移相对 body 顶点,补半个贴图尺寸让碰撞圆落在精灵中心。
    // ⚠️ 用 frame.realWidth 而不是写死的 5 —— 火羽是 30px 宽,写死会让碰撞圆
    //    偏到羽根那一侧,玩家看着羽尖擦过去却被判中
    body.setOffset(this.frame.realWidth / 2 - r, this.frame.realHeight / 2 - r);
    body.setVelocity(Math.cos(angle) * speed, Math.sin(angle) * speed);
  }

  preUpdate(time: number, delta: number): void {
    super.preUpdate(time, delta);
    if (!this.active) return;
    if (this.scene.physics.world.isPaused) return;

    // 自转:羽毛在读秒里保持「活着」。碰撞圆在中心,自转不影响判定
    if (this.spin !== 0) {
      this.rotation += this.spin * (delta / 1000);
    }
    if (this.useTrail && this.trail) {
      this.trail.setPosition(this.x, this.y);
    }

    if (this.isDead || time - this.bornAt > this.lifeMs) {
      this.kill();
    }
  }

  kill(): void {
    this.isDead = true;
    this.setActive(false).setVisible(false);
    if (this.trail) this.trail.stop();
    this.useTrail = false;
    const body = this.body as Phaser.Physics.Arcade.Body;
    body.enable = false;
    body.setVelocity(0, 0);
  }
}
