import Phaser from 'phaser';
import type { Player } from '../Player';

/**
 * 天运·命数 —— 一根从天而降的巨型虚化手指
 *
 * 天运子的「普通攻击」。它不是弹幕,而是**从天上来的一记点名**:
 * 天运子伸出手指,自画面的上方按下来,指到的地方炸开一片。
 *
 * ## 为什么要单独一个实体,而不是复用 FireVent
 *
 * FireVent 是「地面喷出的火柱」——它从**地里**长出来,视觉重心在脚下。
 * 这一招正好相反:威胁从**头顶**来。两者的预警语义完全不同:
 *   - 火柱:脚下亮圈 = 快离开这块地
 *   - 指落:天上有个庞然大物正在下来 = 快离开这块地,**而且你会看见它**
 *
 * 复用 FireVent 会让「从天而降」这件事彻底看不出来,而那正是这一招的全部。
 *
 * ## 三段
 *
 *   1. **天启(warn)**:地面画出落点圈,同时一根虚化的巨指从上方降下、
 *      由透明逐渐凝实。圈在收紧、指在下落 —— 两个进度条同步,玩家随时能读
 *      「还有多久」。
 *   2. **指落(slam)**:触地瞬间。震屏 + 冲击环 + 范围伤害。伤害只在**这一瞬**
 *      结算一次,不是持续掉血 —— 它是「躲开就没事」的一招,与火柱的持续灼烧区分开。
 *   3. **收尾(fade)**:手指抬起并虚化消散,留一圈余烬。
 *
 * ## 关于「慢」
 *
 * 用户与设计都要求这一招**频率慢**(8–11 秒一次)。慢不等于弱:
 * 它给的是一段很长的预警(1.6 秒),因此它可以给**很重**的一击(单次高伤),
 * 而且范围很大。玩家有充足时间躲,但一旦分心在怪堆里,代价很高 ——
 * 这正是天运子「你不看天,天就点你」的压迫。
 *
 * 池化约定与 FireVent 一致:setup() 重置全部字段、不用 tween、
 * preUpdate 带暂停守卫(否则玩家读升级面板时它的进度会凭空快进)。
 */
export class FingerOfFate extends Phaser.GameObjects.Container {
  public isDead = false;

  private gfx: Phaser.GameObjects.Graphics;
  private getPlayer: () => Player = () => ({ x: 0, y: 0, isDead: () => false } as Player);
  private damagePlayer: (amount: number, x: number, y: number) => void = () => {};
  /** 触地瞬间的额外反馈(震屏等)。由 GameScene 注入,免得实体自己去碰相机 */
  private onSlam: (x: number, y: number, radius: number) => void = () => {};

  private radius = 96;
  private warnMs = 1600;
  private slamMs = 260;
  private fadeMs = 420;
  private damage = 34;
  private color = 0xd8b860;

  private elapsedMs = 0;
  private slammed = false;

  /** 手指从多高的地方落下(像素)。够高才有「从天而降」的体量感 */
  private static readonly DROP_HEIGHT = 460;
  /** 指身相对落点半径的粗细 */
  private static readonly FINGER_WIDTH_RATIO = 0.62;
  /** 指节数(画出来的一节一节,像真手指) */
  private static readonly JOINT_COUNT = 3;

  constructor(scene: Phaser.Scene) {
    super(scene, 0, 0);
    this.gfx = scene.add.graphics();
    this.add([this.gfx]);
    scene.add.existing(this);
    this.setActive(false).setVisible(false);
    // 在 FireVent(40)之上:它要从天而降盖过地面与低层的怪,
    // 但又要在 HUD(更高层)之下
    this.setDepth(46);
  }

  bind(
    getPlayer: () => Player,
    damagePlayer: (amount: number, x: number, y: number) => void,
    onSlam: (x: number, y: number, radius: number) => void,
  ): void {
    this.getPlayer = getPlayer;
    this.damagePlayer = damagePlayer;
    this.onSlam = onSlam;
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
    this.slammed = false;
    this.isDead = false;

    this.setActive(true).setVisible(true);
    this.setPosition(x, y);
    this.draw(0);
  }

  /** 总寿命。三段之和 —— preUpdate 用它判断结束 */
  private get totalMs(): number {
    return this.warnMs + this.slamMs + this.fadeMs;
  }

  preUpdate(time: number, delta: number): void {
    if (!this.active) return;
    if (this.scene.physics.world.isPaused) return;

    this.elapsedMs += delta;
    this.draw(this.elapsedMs);

    // 伤害只在触地那一瞬结算一次 —— 与 FireVent 的持续 tick 不同,
    // 因为这一招是「躲开就没事」,不是「站着就持续掉血」
    if (!this.slammed && this.elapsedMs >= this.warnMs) {
      this.slammed = true;
      const p = this.getPlayer();
      const dx = p.x - this.x;
      const dy = p.y - this.y;
      // 判定用半径 + 玩家身位的一半(与 FireVent 同一套口径),
      // 否则玩家「看着站在圈外」却被判在里面
      if (!p.isDead() && dx * dx + dy * dy <= (this.radius + 8) * (this.radius + 8)) {
        this.damagePlayer(this.damage, this.x, this.y);
      }
      this.onSlam(this.x, this.y, this.radius);
    }

    if (this.elapsedMs >= this.totalMs) this.kill();
    void time;
  }

  private draw(elapsed: number): void {
    const g = this.gfx;
    g.clear();

    if (elapsed < this.warnMs) {
      this.drawWarn(g, elapsed / this.warnMs);
    } else if (elapsed < this.warnMs + this.slamMs) {
      this.drawSlam(g, (elapsed - this.warnMs) / this.slamMs);
    } else {
      this.drawFade(g, (elapsed - this.warnMs - this.slamMs) / this.fadeMs);
    }
  }

  /**
   * 天启:落点圈收缩 + 巨指下降。
   *
   * 两者进度同步 —— 圈收到最小、指降到最低,是同一时刻。
   * 玩家因此有**两个**可以读的进度指示,混战里只要看见其中一个就够了。
   */
  private drawWarn(g: Phaser.GameObjects.Graphics, t: number): void {
    const r = this.radius;
    // 落点圈:由外向内收缩
    const ringR = r * (1 + (1 - t) * 0.7);
    g.fillStyle(this.color, 0.05 + 0.05 * t);
    g.fillCircle(0, 0, r);
    g.lineStyle(3, this.color, 0.30 + 0.55 * t);
    g.strokeCircle(0, 0, ringR);
    // 内圈:触地点本身,越接近越亮
    g.lineStyle(2, 0xffffff, 0.05 + 0.25 * t);
    g.strokeCircle(0, 0, r * 0.55);

    // 巨指:从上方降下,透明度随进度增加(越来越「实」)
    const fall = Phaser.Math.Easing.Cubic.In(t);
    // 指尖最终停在落点中心上方一点点(压在圈里)
    const tipY = -FingerOfFate.DROP_HEIGHT * (1 - fall);
    const alpha = 0.25 + 0.55 * t;
    this.drawFinger(g, tipY, alpha);
  }

  /** 指落:触地一刻。冲击环 + 高亮,短促推满 */
  private drawSlam(g: Phaser.GameObjects.Graphics, t: number): void {
    const r = this.radius;
    // 冲击环:从落点向外扩散
    const shock = r * (1 + t * 0.8);
    g.lineStyle(6 * (1 - t) + 2, 0xffffff, 0.9 * (1 - t));
    g.strokeCircle(0, 0, shock);
    g.lineStyle(3, this.color, 0.7 * (1 - t));
    g.strokeCircle(0, 0, r * (0.9 + t * 0.2));
    // 触地闪光
    g.fillStyle(0xffeecc, 0.5 * (1 - t));
    g.fillCircle(0, 0, r * (0.5 + t * 0.5));
    // 指身压在落点上(已触地)
    this.drawFinger(g, 0, 1 - t * 0.5);
  }

  /** 收尾:指抬起 + 虚化,地面留一圈余烬 */
  private drawFade(g: Phaser.GameObjects.Graphics, t: number): void {
    const r = this.radius;
    const a = 1 - t;
    g.fillStyle(this.color, 0.18 * a);
    g.fillCircle(0, 0, r);
    g.lineStyle(3, this.color, 0.5 * a);
    g.strokeCircle(0, 0, r);
    // 手指抬起并变淡
    this.drawFinger(g, -FingerOfFate.DROP_HEIGHT * 0.35 * Phaser.Math.Easing.Quadratic.Out(t), a * 0.5);
  }

  /**
   * 画一根虚化的巨指。`tipY` 是**指尖**相对落点的 y 偏移。
   *
   * 手指朝下(指尖在下方),指身向上延伸出画面 —— 所以它是一个
   * 「从屏幕外伸进来」的构图,而不是一根漂浮在空中的棒子。
   */
  private drawFinger(g: Phaser.GameObjects.Graphics, tipY: number, alpha: number): void {
    if (alpha <= 0.01) return;
    const w = this.radius * FingerOfFate.FINGER_WIDTH_RATIO;
    const halfW = w / 2;
    const segH = FingerOfFate.DROP_HEIGHT / FingerOfFate.JOINT_COUNT;

    // 指身:从指尖往上画若干节,越往上越淡(虚化)
    for (let i = 0; i < FingerOfFate.JOINT_COUNT; i++) {
      const segTop = tipY - w * 0.9 - segH * (i + 1);
      const segBottom = tipY - w * 0.9 - segH * i;
      const fadeOut = 1 - i * 0.26;
      // 外辉
      g.fillStyle(this.color, 0.16 * alpha * fadeOut);
      g.fillRect(-halfW - 6, segTop, w + 12, segBottom - segTop);
      // 指身
      g.fillStyle(this.color, 0.42 * alpha * fadeOut);
      g.fillRect(-halfW, segTop, w, segBottom - segTop);
      // 指节横纹
      g.fillStyle(0xffffff, 0.10 * alpha * fadeOut);
      g.fillRect(-halfW, segBottom - 3, w, 3);
    }

    // 指尖:一个圆头 + 一点白热。这是整根指最实的地方
    const tipR = halfW * 0.92;
    g.fillStyle(this.color, 0.30 * alpha);
    g.fillCircle(0, tipY - tipR * 0.2, tipR * 1.25);
    g.fillStyle(this.color, 0.55 * alpha);
    g.fillCircle(0, tipY - tipR * 0.2, tipR);
    g.fillStyle(0xffffff, 0.35 * alpha);
    g.fillCircle(0, tipY - tipR * 0.35, tipR * 0.42);
  }

  kill(): void {
    this.isDead = true;
    this.gfx.clear();
    this.setActive(false).setVisible(false);
  }
}
