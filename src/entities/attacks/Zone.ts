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
 *
 * ## ⚠️ 外径恒等于判定半径,入场出场只走 alpha
 *
 * 旧实现用 `grow` 把圆**缩着**画出来(开场放大、收尾缩没),于是收尾那 15%
 * 的时间里「看着火已经没了,人还站在里面掉血」—— 视觉与判定不符,而且是
 * 对玩家不利的那一侧。现在外径自始至终就是 `radius`,生死由 alpha 表达。
 * **任何新画法都别再用缩放做出入场。**
 *
 * ## 图层(有真实素材时)
 *
 *   sea   外层:整片火海,直径 = 判定直径,**缓慢自转**
 *   core  亮心:同一张图缩小叠在中心,尺寸随**叠层**长大,反向转
 *
 * 叠层只放大亮心、绝不动外层 —— 外层一旦变大就等于谎报灼烧范围。
 * 火海只能靠「中心更亮更旺」表达层数,这与「外径即判定」是同一条约束的两面。
 */
export class Zone extends Phaser.GameObjects.Container {
  /** 外层自转(弧度/秒)。约 3 秒生命里转半圈,足够读出「在烧」而不像搅拌机 */
  private static readonly SPIN = 1.1;
  /** 亮心反向转速倍率 —— 两层反向转,火才有翻腾感 */
  private static readonly CORE_SPIN_MUL = -1.7;
  /** 亮心占外层的比例:1 层 / 2 层 / 3 层 */
  private static readonly CORE_SCALE = [0.42, 0.58, 0.74];

  public isDead = false;
  public damage = 10;
  public stacks = 1;

  private gfx: Phaser.GameObjects.Graphics;
  private enemyGroup!: Phaser.GameObjects.Group;
  private applyDamage!: DamageApplier;
  /** 真实素材的两层。缺图时两者都不建,全部退回 Graphics */
  private sea?: Phaser.GameObjects.Image;
  private core?: Phaser.GameObjects.Image;
  private seaKey = '';

  private radius = 70;
  /** 火海的每秒灼烧伤害,叠层时线性叠加 */
  private dps = 0;
  private lifeMs = 3000;
  private elapsedMs = 0;
  private tickMs = 300;
  private nextTickAt = 0;
  private color = 0xff5522;
  private maxStacks = 1;
  private spin = 0;

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
    texture = '',
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
    this.spin = Math.random() * Math.PI * 2;
    this.prepareSea(texture);

    this.setActive(true).setVisible(true);
    this.setPosition(x, y);
    this.setAlpha(1);
    this.draw(0);
  }

  /**
   * 备好火海贴图。
   *
   * 与 Tornado.prepareHead 同一套规矩:贴图不存在就整个不建
   * (`scene.add.image` 拿错键会退到 `__MISSING` 绿方块,比什么都不画还糟);
   * 池里的一个 Zone 这次是火海、下次可能是别的地效,所以要能换键换图。
   */
  private prepareSea(texture: string): void {
    if (!texture || !this.scene.textures.exists(texture)) {
      this.sea?.setVisible(false);
      this.core?.setVisible(false);
      this.seaKey = '';
      return;
    }
    if (!this.sea) {
      this.sea = this.scene.add.image(0, 0, texture);
      this.add([this.sea]);
    }
    if (!this.core) {
      // 亮心用**同一张图**:素材只需要画一张,层数靠「缩小的自己叠在上面」表达
      this.core = this.scene.add.image(0, 0, texture);
      this.add([this.core]);
    }
    if (this.seaKey !== texture) {
      this.sea.setTexture(texture);
      this.core.setTexture(texture);
    }
    this.seaKey = texture;
    this.sea.setVisible(true);
    this.core.setVisible(true);
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
    this.spin += (delta / 1000) * Zone.SPIN;
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

  /**
   * 出入场只走 alpha,外径恒定(见类注释)。
   * 呼吸 ±3% 只是让边缘活起来,幅度小到不会误读成「范围在变」。
   */
  private draw(t: number): void {
    const g = this.gfx;
    g.clear();
    const rise = Math.min(1, t / 0.12);
    const fall = t > 0.85 ? Math.max(0, (1 - t) / 0.15) : 1;
    const fade = rise * fall;
    const r = this.radius;
    const breathe = 1 + Math.sin(t * 12) * 0.03;

    if (this.seaKey) {
      this.drawSea(fade, r, breathe);
    } else {
      // 缺图:退回旧的圆 + 环。亮心用 Graphics 也画一颗,
      // 免得没有素材时叠层在屏幕上完全读不出来
      g.fillStyle(this.color, 0.18 * fade);
      g.fillCircle(0, 0, r * breathe);
      const coreR = r * Zone.CORE_SCALE[Math.min(this.stacks, 3) - 1];
      g.fillStyle(0xffcc66, 0.22 * fade * this.stacks / this.maxStacks * 3);
      g.fillCircle(0, 0, coreR * breathe);
    }

    // 判定圈:无论有没有素材都画。它是唯一能保证「灼烧范围可读」的东西 ——
    // 素材画得对不对不该由玩家用命去试
    g.lineStyle(2, this.color, 0.55 * fade);
    g.strokeCircle(0, 0, r * breathe);
  }

  private drawSea(fade: number, r: number, breathe: number): void {
    const sea = this.sea as Phaser.GameObjects.Image;
    const core = this.core as Phaser.GameObjects.Image;
    const d = r * breathe * 2;
    const f = sea.frame;

    sea.setScale(d / f.realWidth);
    sea.setRotation(this.spin);
    sea.setAlpha(0.9 * fade);

    const cs = Zone.CORE_SCALE[Math.min(this.stacks, 3) - 1];
    core.setScale((d * cs) / f.realWidth);
    core.setRotation(this.spin * Zone.CORE_SPIN_MUL);
    // 亮心不透明度跟着叠层走:1 层像余烬,3 层是明火
    core.setAlpha((0.25 + 0.25 * (this.stacks - 1)) * fade);
  }

  kill(): void {
    this.isDead = true;
    this.gfx.clear();
    // 两个 Image 是独立子对象,容器 setVisible(false) 不会替它们清干净 ——
    // 池里复用时光靠容器隐藏,上一轮的火海会留在原地(与 Tornado 的龙头同理)
    this.sea?.setVisible(false);
    this.core?.setVisible(false);
    this.setActive(false).setVisible(false);
  }
}