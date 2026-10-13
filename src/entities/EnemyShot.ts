import Phaser from 'phaser';

/**
 * 弹体碰撞圆的**默认**半径(像素)。4px ≈ 术修圆弹贴图的一半。
 *
 * 绝大多数弹体不该越过它 —— 为什么,以及唯一的例外,见 `ShotStyle.hitRadius`。
 */
const DEFAULT_HIT_RADIUS = 4;

/**
 * 一次发射的外观参数。全部可选 —— 不传就是普通术修的暗红圆弹。
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
  /**
   * 碰撞圆半径的**覆盖值**(像素)。缺省 4,与普通术修圆弹一字不差。
   *
   * ⚠️ 这是一个刻意留出的**例外口**,全场只有一张弹体配得上:凌天侯的剑气。
   *    理由不是「首领就该更强」,而是**形状**。剑气是一片 96×14 的长条实体,
   *    一条独立飞行的剑身。玩家看它读到的信息是「这条线是危险的」——
   *    而一条线的判定不该缩成中心一颗直径 8px 的珠子:剑身明明从身侧划过
   *    却安然无事,玩家只会判定「这游戏的碰撞坏了」。把 r 提到 8,圆直径 16
   *    刚好盖住贴图的整条宽度(14px),剑身扫过的位置就是会中招的位置。
   *
   * ⚠️ 反过来,**密集成幕**的弹体(朱雀火羽、天运子命数指)绝不能用它。
   *    单片羽的判定在「幕」里没有任何可读线索 —— 玩家数不清十片羽各自的边缘,
   *    放大只会变成「莫名其妙被打中」。想让羽幕更难躲,改的是片数 count。
   *
   * ⚠️ 硬上限:r 不得大到让圆在**垂直于飞行方向**上明显超出贴图高度。
   *    Arcade body 不随 rotation 旋转,圆形是唯一在旋转下不变形的选择 ——
   *    换成贴合剑身的矩形/胶囊,剑羽一斜 AABB 就膨胀成外接方框,判定比贴图
   *    大出好几倍。所以这里能调的只有半径,做不出「沿剑身的长条判定」。
   */
  hitRadius?: number;
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
    const r = style?.hitRadius ?? DEFAULT_HIT_RADIUS;
    body.setCircle(r, 0, 0);
    // setCircle 的偏移相对 body 顶点,补半个贴图尺寸让碰撞圆落在精灵中心。
    // ⚠️ 用 frame.realWidth 而不是写死的 5 —— 火羽是 30px 宽、剑气是 96px,
    //    写死会让碰撞圆偏到贴图的一侧,玩家看着贴图边缘过去却被判中。
    //    偏移用 r 反推,所以覆盖半径变化时圆心自动留在中心(offset 允许为负)。
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
