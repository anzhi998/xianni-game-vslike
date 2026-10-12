import Phaser from 'phaser';
import type { Player } from '../Player';

/**
 * 朱雀·火雨 —— 一颗从天上斜坠下来的紫红陨石
 *
 * ## 为什么不复用 FireVent
 *
 * 火雨原先直接走灵脉地热的 `FireVent`(地面火柱)—— 结果是 Boss 的招式
 * 与地图机制**同色同形**:都是 0xff5522 的橙红火柱,玩家根本分不清
 * 「这是地图的地火」还是「朱雀在点名」。三种火必须在三个维度上同时分开:
 *
 * | | 玩家火海 | 地图地火 | 朱雀火雨 |
 * |---|---|---|---|
 * | 形态 | 地面燃烧区(自叠) | 地面**柱状持续喷发** | **天上斜坠的陨石** |
 * | 结算 | 持续 dps | 持续 tick | **单次爆发** |
 * | 色相 | 深血红 0xff3311 | 橙红 0xff8833 | **紫红 0xcc33cc** |
 *
 * 「天上来的」是这一招的全部语义 —— 朱雀是火的神主,它下雨是天降火,
 * 不是地里冒火。陨石斜坠还能带出**提前量读法**:看见天上有东西在飞,
 * 就知道它要落在哪。
 *
 * ## 三段
 *
 *   1. **坠落(warnMs)**:陨石从右上斜坠向落点,地面画出收缩的落点圈 ——
 *      圈收到最小、陨石落到底,是同一时刻。玩家读的是**飞行的陨石本身**,
 *      这比任何地面标记都直观。
 *   2. **撞击**:单次伤害(radius+8 判定) + 冲击环 + 碎屑飞溅。
 *      与 FireVent 的持续 tick 刻意不同 —— 陨石是「砸开就没事」的一击。
 *   3. **残烬(emberMs)**:地面留一圈紫红余烬渐隐。**不持续掉血** ——
 *      「站在火里持续烧」是地火/火海的语言,撞一下就走是陨石的语言。
 *
 * 池化约定与 FireVent 一致:setup() 重置全部字段、不用 tween、
 * preUpdate 带暂停守卫。
 */
export class MeteorFall extends Phaser.GameObjects.Container {
  public isDead = false;

  private gfx: Phaser.GameObjects.Graphics;
  /** ADD 辉光层 */
  private glowGfx: Phaser.GameObjects.Graphics;
  /**
   * 陨石本体贴图(`fx_meteor`,AI 出图:紫红陨火,尖端朝**左下**)。
   * 缺失时回退 Graphics 画的锯齿陨石(见 drawMeteorFallback)。
   */
  private meteorImg?: Phaser.GameObjects.Image;
  private getPlayer: () => Player = () => ({ x: 0, y: 0, isDead: () => false } as Player);
  private damagePlayer: (amount: number, x: number, y: number) => void = () => {};
  /** 撞击瞬间的额外反馈(震屏等)。由 GameScene 注入 */
  private onImpact: (x: number, y: number, radius: number) => void = () => {};

  private radius = 86;
  private warnMs = 1000;
  private emberMs = 450;
  private damage = 22;
  private color = 0xcc33cc;

  private elapsedMs = 0;
  private impacted = false;

  /** 陨石从多高的地方进场(沿对角线的距离)。斜坠的「斜」就是这条向量 */
  private static readonly DROP_DIST = 460;
  /** 坠落方向:指向左下(与贴图的尖端朝向一致,贴图不用旋转) */
  private static readonly FALL_DIR = { x: -Math.SQRT1_2, y: Math.SQRT1_2 };

  constructor(scene: Phaser.Scene) {
    super(scene, 0, 0);
    this.glowGfx = scene.add.graphics();
    this.glowGfx.setBlendMode(Phaser.BlendModes.ADD);
    this.gfx = scene.add.graphics();
    this.add([this.glowGfx, this.gfx]);
    if (scene.textures.exists('fx_meteor')) {
      this.meteorImg = scene.add.image(0, 0, 'fx_meteor');
      // 贴图的尖端在左下(陨石头部),把**几何中心**当锚点 ——
      // 撞击判定的圆心是落点,陨石中心对到「落点上方一段距离」更自然
      this.add(this.meteorImg);
      this.meteorImg.setVisible(false);
    }
    scene.add.existing(this);
    this.setActive(false).setVisible(false);
    // 与 FireVent(40)同层:两者永远不会同时读错 —— 火雨只出现在 Boss 战
    this.setDepth(41);
  }

  bind(
    getPlayer: () => Player,
    damagePlayer: (amount: number, x: number, y: number) => void,
    onImpact: (x: number, y: number, radius: number) => void,
  ): void {
    this.getPlayer = getPlayer;
    this.damagePlayer = damagePlayer;
    this.onImpact = onImpact;
  }

  setup(
    x: number,
    y: number,
    radius: number,
    warnMs: number,
    damage: number,
    color: number,
  ): void {
    this.radius = radius;
    this.warnMs = warnMs;
    this.damage = damage;
    this.color = color;
    this.elapsedMs = 0;
    this.impacted = false;
    this.isDead = false;

    this.setActive(true).setVisible(true);
    this.setPosition(x, y);
    if (this.meteorImg) this.meteorImg.setVisible(true);
    this.draw(0);
  }

  /** 总寿命:坠落 + 残烬 */
  private get totalMs(): number {
    return this.warnMs + this.emberMs;
  }

  preUpdate(time: number, delta: number): void {
    if (!this.active) return;
    if (this.scene.physics.world.isPaused) return;

    this.elapsedMs += delta;
    this.draw(this.elapsedMs);

    // 伤害只在触地那一瞬结算一次 —— 陨石是「砸开就没事」的一击,
    // 与 FireVent 的持续 tick 刻意不同
    if (!this.impacted && this.elapsedMs >= this.warnMs) {
      this.impacted = true;
      const p = this.getPlayer();
      const dx = p.x - this.x;
      const dy = p.y - this.y;
      if (!p.isDead() && dx * dx + dy * dy <= (this.radius + 8) * (this.radius + 8)) {
        this.damagePlayer(this.damage, this.x, this.y);
      }
      this.onImpact(this.x, this.y, this.radius);
      if (this.meteorImg) this.meteorImg.setVisible(false);
    }

    if (this.elapsedMs >= this.totalMs) this.kill();
    void time;
  }

  /** 陨石在 t 时刻的位置(相对落点)。坠落段沿对角线从右上来 */
  private meteorOffset(elapsed: number): { x: number; y: number } {
    if (elapsed >= this.warnMs) return { x: 0, y: 0 };
    // 加速坠落:Cubic.In —— 前段慢(看得见它飞),后段快(躲不及的压迫)
    const t = elapsed / this.warnMs;
    const fall = Phaser.Math.Easing.Cubic.In(t);
    const d = MeteorFall.DROP_DIST * (1 - fall);
    return {
      x: -MeteorFall.FALL_DIR.x * d,
      y: -MeteorFall.FALL_DIR.y * d,
    };
  }

  private draw(elapsed: number): void {
    const g = this.gfx;
    const glow = this.glowGfx;
    g.clear();
    glow.clear();

    if (elapsed < this.warnMs) {
      this.drawFall(g, glow, elapsed / this.warnMs);
    } else {
      this.drawEmber(g, glow, (elapsed - this.warnMs) / this.emberMs);
    }
  }

  /** 坠落段:收缩的落点圈 + 飞行中的陨石 */
  private drawFall(g: Phaser.GameObjects.Graphics, glow: Phaser.GameObjects.Graphics, t: number): void {
    const r = this.radius;
    // 落点圈:由外向内收缩,紫红
    const ringR = r * (1 + (1 - t) * 0.6);
    g.lineStyle(3, this.color, 0.30 + 0.55 * t);
    g.strokeCircle(0, 0, ringR);
    g.lineStyle(2, 0xffffff, 0.05 + 0.22 * t);
    g.strokeCircle(0, 0, r * 0.55);
    // 四道刻度齿(与命数指的法阵区分:火雨是「简单的圈」,不带仪式符纹)
    g.lineStyle(2, this.color, 0.3 + 0.4 * t);
    for (let i = 0; i < 4; i++) {
      const a = (i / 4) * Math.PI * 2 + Math.PI / 4;
      g.beginPath();
      g.moveTo(Math.cos(a) * r * 1.05, Math.sin(a) * r * 1.05);
      g.lineTo(Math.cos(a) * r * 1.16, Math.sin(a) * r * 1.16);
      g.strokePath();
    }

    // 陨石本体
    const off = this.meteorOffset(t * this.warnMs);
    const alpha = 0.45 + 0.55 * t;
    if (this.meteorImg) {
      const tex = this.meteorImg.texture.getSourceImage();
      const s = (this.radius * 1.5) / tex.width;
      this.meteorImg.setScale(s);
      this.meteorImg.setPosition(off.x, off.y - 6);
      this.meteorImg.setAlpha(alpha);
      // 坠落尾焰辉光:贴图自带拖尾,这里只补一团运动方向的紫光
      glow.fillStyle(this.color, 0.20 * alpha);
      glow.fillCircle(
        off.x - MeteorFall.FALL_DIR.x * 40,
        off.y - MeteorFall.FALL_DIR.y * 40,
        this.radius * 0.55,
      );
    } else {
      this.drawMeteorFallback(g, glow, off.x, off.y, alpha);
    }
  }

  /** 无贴图时的锯齿陨石。朝向与贴图一致:尖端在左下,拖尾甩向右上 */
  private drawMeteorFallback(
    g: Phaser.GameObjects.Graphics,
    glow: Phaser.GameObjects.Graphics,
    ox: number,
    oy: number,
    alpha: number,
  ): void {
    const r = this.radius * 0.42;
    // 拖尾:三段渐细渐淡的紫焰,甩向右上
    for (let i = 0; i < 3; i++) {
      const d = r * (1.2 + i * 0.9);
      const w = r * (0.75 - i * 0.2);
      glow.fillStyle(i === 2 ? 0x9911bb : this.color, (0.30 - i * 0.08) * alpha);
      glow.fillCircle(ox + d * 0.5, oy - d * 0.5, w);
    }
    // 陨石核:锯齿多边形(暗紫岩石 + 亮紫裂纹)
    const jag = 7;
    g.beginPath();
    for (let i = 0; i <= jag; i++) {
      const a = Math.PI * 0.75 + (i / jag) * Math.PI * 1.5;
      const rr = r * (i % 2 === 0 ? 1 : 0.72);
      const px = ox + Math.cos(a) * rr;
      const py = oy + Math.sin(a) * rr;
      if (i === 0) g.moveTo(px, py); else g.lineTo(px, py);
    }
    g.closePath();
    g.fillStyle(0x8a1140, 0.9 * alpha);
    g.fillPath();
    g.fillStyle(this.color, 0.55 * alpha);
    g.fillCircle(ox - r * 0.15, oy + r * 0.15, r * 0.4);
    glow.fillStyle(0xffd0ff, 0.5 * alpha);
    glow.fillCircle(ox - r * 0.2, oy + r * 0.1, r * 0.22);
  }

  /** 撞击后:冲击环 + 紫红余烬渐隐。不持续掉血 —— 那是地火的语言 */
  private drawEmber(g: Phaser.GameObjects.Graphics, glow: Phaser.GameObjects.Graphics, t: number): void {
    const r = this.radius;
    const a = 1 - t;
    // 冲击环(只在最初一小段可见)
    if (t < 0.5) {
      const st = t / 0.5;
      const shock = r * (1 + st * 0.9);
      g.lineStyle(6 * (1 - st) + 2, 0xffffff, 0.9 * (1 - st));
      g.strokeCircle(0, 0, shock);
      g.lineStyle(3, this.color, 0.7 * (1 - st));
      g.strokeCircle(0, 0, r * (0.9 + st * 0.3));
    }
    // 余烬:一圈紫红的暗光渐隐
    glow.fillStyle(this.color, 0.22 * a);
    glow.fillCircle(0, 0, r * 0.9);
    g.fillStyle(this.color, 0.16 * a);
    g.fillCircle(0, 0, r);
    g.lineStyle(3, this.color, 0.45 * a);
    g.strokeCircle(0, 0, r);
    // 几片散落的碎屑(固定位置,不用随机 —— 池化重置要确定)
    g.fillStyle(0x8a1140, 0.7 * a);
    const shards: Array<[number, number, number]> = [
      [r * 0.8, -r * 0.3, 5], [-r * 0.9, r * 0.2, 4], [r * 0.4, r * 0.85, 6],
      [-r * 0.5, -r * 0.8, 4], [r * 1.1, r * 0.5, 3],
    ];
    for (const [sx, sy, ss] of shards) g.fillRect(sx, sy, ss, ss);
    glow.fillStyle(0xffd0ff, 0.35 * a);
    glow.fillCircle(r * 0.8, -r * 0.3, 3);
    glow.fillCircle(-r * 0.9, r * 0.2, 2.5);
  }

  kill(): void {
    this.isDead = true;
    this.gfx.clear();
    this.glowGfx.clear();
    if (this.meteorImg) this.meteorImg.setVisible(false);
    this.setActive(false).setVisible(false);
  }
}
