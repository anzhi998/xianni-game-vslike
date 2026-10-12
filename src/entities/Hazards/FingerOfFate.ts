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
 * ## 形态:为什么是「审判」而不是「一根柱子」
 *
 * 第一版把指身画成几段矩形堆叠,实测下来它读起来像**发射塔 / 岩柱**,
 * 完全没有手指的形态 —— 而那正是这一招的全部意象。问题出在:
 *   - 矩形没有**轮廓收放**:真手指在指节处收、指腹处鼓,是一串**纺锤形**;
 *   - 没有**指尖的朝向**:真手指按下来时指尖是**前倾**的,不是垂直的圆锥;
 *   - 没有**指甲**:指甲是「这是手指」最经济的识别符号,比任何曲线都管用。
 *
 * 所以现在整根指由 `traceFingerSilhouette` 用**左右两条二次贝塞尔**勾勒:
 * 沿中轴取样、逐点求宽度,得到一条**自然的、有收放的**轮廓带。
 * 这是把「手指」画对的关键一步 —— 矩形是画不出指腹的。
 *
 * 观感目标(用户指定):**天命的审判感** —— 缓慢、确定、不可违。
 * 所以它是半透明的**发光虚影**(additive 辉光 + 内部更亮的芯),
 * 而不是一根写实的血肉手指。它像神明伸下来的一划,不像一根肉肠。
 *
 * 池化约定与 FireVent 一致:setup() 重置全部字段、不用 tween、
 * preUpdate 带暂停守卫(否则玩家读升级面板时它的进度会凭空快进)。
 */
export class FingerOfFate extends Phaser.GameObjects.Container {
  public isDead = false;

  private gfx: Phaser.GameObjects.Graphics;
  /** 辉光层。单独一个 Graphics,用 ADD 混合 —— 主体本身是 src-over,只有辉光叠光 */
  private glowGfx: Phaser.GameObjects.Graphics;
  /**
   * 指身贴图(`fx_finger_of_fate`,AI 出图 + make-finger.mjs 处理)。
   *
   * 存在时指身用它、Graphics 剪影退位 —— 位图的手指有真正的指节、指甲与
   * 辉光质感,是矩形/贝塞尔都画不出来的。缺失时回退到 drawFingerBody 的
   * 程序化剪影,与项目的「素材缺失自动退回」约定一致。
   *
   * ⚠️ 贴图是**直的**,没有 TIP_LEAN 的前倾 —— 那是程序化版独有的微弯,
   *    用了贴图就接受这一点(贴图的形态收益远大于这点损失)。
   */
  private fingerImg?: Phaser.GameObjects.Image;
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

  /**
   * 手指从多高的地方落下(像素)。够高才有「从天而降」的体量感。
   *
   * ⚠️ 它同时决定**指身有多长** —— 指身从这个高度一直延伸到指尖。
   *    调小它会让手指变短,像一根指头而不是一整根。
   */
  private static readonly DROP_HEIGHT = 620;

  /**
   * 指根的宽度上限(相对落点半径)。
   *
   * 第一版用了 0.78,实测读起来像柱子 —— 人的食指长宽比约 4:1,
   * 落点半径 104px、DROP_HEIGHT 620px 的尺度下,0.46(半宽 0.23×半径)
   * 才落在「一眼是手指」的区间。宽了像岩柱,窄了像锥子。
   */
  private static readonly FINGER_WIDTH_RATIO = 0.46;

  /** 指尖的横向偏移比例 —— 按下来时指尖**前倾**,不是垂直的 */
  private static readonly TIP_LEAN = 0.28;

  /** 指甲相对指尖宽度 */
  private static readonly NAIL_RATIO = 0.5;

  constructor(scene: Phaser.Scene) {
    super(scene, 0, 0);
    this.glowGfx = scene.add.graphics();
    this.glowGfx.setBlendMode(Phaser.BlendModes.ADD);
    this.gfx = scene.add.graphics();
    this.add([this.glowGfx, this.gfx]);
    // 真实指身贴图。放在两层 Graphics 之上 —— 指要压过地面的法阵刻度
    if (scene.textures.exists('fx_finger_of_fate')) {
      this.fingerImg = scene.add.image(0, 0, 'fx_finger_of_fate');
      // origin(0.5, 1):贴图的**底端是指尖**(贴图朝下画),把底端钉在 tipY 上
      this.fingerImg.setOrigin(0.5, 1);
      this.add(this.fingerImg);
    }
    scene.add.existing(this);
    this.setActive(false).setVisible(false);
    // 在 FireVent(40)之上:它要从天而降盖过地面与低层的怪,
    // 但又要在 HUD(更高层)之下
    this.setDepth(46);
  }

  /**
   * 指身贴图的统一摆放。`tipY` 同 drawFingerBody 的语义(指尖的 y),
   * `alpha` 是整体透明度。贴图缺失时调用方应走程序化剪影。
   */
  private drawFingerTexture(tipY: number, alpha: number): void {
    if (!this.fingerImg) return;
    // 高度对齐 DROP_HEIGHT(随落点半径微缩),宽度按贴图纵横比走 ——
    // 非均匀缩放会把指节拉扁,像素画的形变一眼可见
    const tex = this.fingerImg.texture.getSourceImage();
    const s = (FingerOfFate.DROP_HEIGHT * (this.radius / 104)) / tex.height;
    this.fingerImg.setScale(s);
    this.fingerImg.setPosition(0, tipY);
    this.fingerImg.setAlpha(alpha);
    this.fingerImg.setVisible(alpha > 0.01);
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
    const glow = this.glowGfx;
    g.clear();
    glow.clear();

    if (elapsed < this.warnMs) {
      this.drawWarn(g, glow, elapsed / this.warnMs);
    } else if (elapsed < this.warnMs + this.slamMs) {
      this.drawSlam(g, glow, (elapsed - this.warnMs) / this.slamMs);
    } else {
      this.drawFade(g, glow, (elapsed - this.warnMs - this.slamMs) / this.fadeMs);
    }
  }

  // =====================================================================
  // 指形轮廓 —— 整个重做的核心
  // =====================================================================

  /**
   * 沿中轴采样出这根指的左右轮廓。
   *
   * ## 为什么不用矩形
   *
   * 真手指的侧面是一条**有收放的曲线**:指节处内凹、指腹处外鼓,
   * 到指尖再猛地收成一个圆头。矩形堆叠画不出这个 ——
   * 它只能画出「几段等宽的柱子」,那正是上一版读起来像发射塔的原因。
   *
   * ## 参数怎么定
   *
   * 不是用解剖学数据,而是用**可读性**反推的:
   *   - `t = 0`(指根)最粗:它是「一根粗大的指」的第一印象,不能细
   *   - 两个**指节收窄**在 t≈0.38 / 0.68:收得不多(×0.93),但它存在 ——
   *     光靠这两个内凹就能让眼睛认出「这是一节一节的」
   *   - 指腹在 t≈0.52 / 0.82 微微外鼓(×1.03):指腹是手指最有肉感的地方
   *   - 最后 12% 快速收成指尖圆头(`tipRound`)
   *
   * 返回的是**相对宽度**(1 = 指根宽),乘上实际半宽即可。
   */
  private static silhouetteHalfWidth(t: number): number {
    // 指根 → 指尖的总体收窄。前 55% 几乎不收,后 45% 收到一半 ——
    // 「指根粗、指尖细」的对比必须足够强,否则还是柱子
    const taper = 1 - Math.pow(t, 1.7) * 0.5;
    // 指节内凹:两个窄口。深度 0.13/0.10 —— 第一版 0.07 太浅,
    // 缩放一变就看不见,「一节一节」全靠它们
    const knuckle = Math.abs(t - 0.38) < 0.06 ? 0.13
      : Math.abs(t - 0.68) < 0.06 ? 0.10
      : 0;
    // 指腹外鼓:两个鼓包(与指节交错)
    const pad = Math.abs(t - 0.53) < 0.05 ? 0.05
      : Math.abs(t - 0.83) < 0.05 ? 0.04
      : 0;
    return Math.max(0.04, taper - knuckle + pad);
  }

  /**
   * 把指身画成一条**填充出来的轮廓带**:沿中轴逐行取样,求左右边界,连成多边形。
   *
   * `tipY` 是指尖的 y(相对落点),`halfW` 是指根半宽,`alpha` 是整体透明度。
   *
   * 中轴本身也是弯的 —— 手指按下来时不是一根直棍,而是从指根到指尖
   * 带一点**前倾的弧度**(`TIP_LEAN`)。这条微弯是整个形态的关键:
   * 笔直的手指读起来像「压路机」,微弯的才像「按」。
   */
  private drawFingerBody(
    g: Phaser.GameObjects.Graphics,
    tipY: number,
    halfW: number,
    alpha: number,
  ): { tipCx: number; tipHalfW: number } {
    const len = FingerOfFate.DROP_HEIGHT;
    const steps = 40;
    const lean = halfW * 2 * FingerOfFate.TIP_LEAN;

    // 中轴横向偏移:t=0 指根在 0,t=1 指尖偏 lean(前倾)
    const axisX = (t: number) => lean * t * t;

    const left: Array<{ x: number; y: number }> = [];
    const right: Array<{ x: number; y: number }> = [];
    let tipHalfW = halfW * 0.2;
    let tipCx = 0;

    for (let i = 0; i <= steps; i++) {
      const t = i / steps;                 // 0 = 指根,1 = 指尖
      const y = tipY - len * (1 - t);
      const hw = halfW * FingerOfFate.silhouetteHalfWidth(t);
      const cx = axisX(t);
      left.push({ x: cx - hw, y });
      right.push({ x: cx + hw, y });
      if (i === steps) { tipHalfW = hw; tipCx = cx; }
    }

    // 闭合多边形:左链自上而下 + 右链自下而上
    const poly = [...right, ...left.slice().reverse()];
    g.fillStyle(this.color, 0.30 * alpha);
    g.beginPath();
    g.moveTo(poly[0].x, poly[0].y);
    for (let i = 1; i < poly.length; i++) g.lineTo(poly[i].x, poly[i].y);
    g.closePath();
    g.fillPath();

    // 内部更亮的芯:同一轮廓按 0.55 宽再填一次。这根亮芯是「发光虚影」的来源
    g.fillStyle(this.color, 0.26 * alpha);
    g.beginPath();
    const coreR = right.map((p, i) => ({ x: p.x - (p.x - left[i].x) * 0.22, y: p.y }));
    const coreL = left.map((p, i) => ({ x: p.x + (right[i].x - p.x) * 0.22, y: p.y }));
    const corePoly = [...coreR, ...coreL.slice().reverse()];
    g.moveTo(corePoly[0].x, corePoly[0].y);
    for (let i = 1; i < corePoly.length; i++) g.lineTo(corePoly[i].x, corePoly[i].y);
    g.closePath();
    g.fillPath();

    // 指节横纹:两处内凹各压一道暗/暗金色横线,把「一节一节」点明。
    // 光有轮廓的内凹不够 —— 混战里缩放变化会吃掉那一点点宽度差
    g.fillStyle(this.color, 0.5 * alpha);
    for (const kt of [0.38, 0.68]) {
      const y = tipY - len * (1 - kt);
      const hw = halfW * FingerOfFate.silhouetteHalfWidth(kt) * 0.94;
      const cx = axisX(kt);
      g.fillRect(cx - hw, y - 2, hw * 2, 4);
    }

    // 左侧高光:一条细长的亮边,给这根虚影一点体积
    g.fillStyle(0xffffff, 0.10 * alpha);
    g.beginPath();
    const hl = left.map((p, i) => ({ x: p.x + (right[i].x - p.x) * 0.16, y: p.y }));
    const hl2 = left.map((p, i) => ({ x: p.x + (right[i].x - p.x) * 0.24, y: p.y }));
    const hlPoly = [...hl, ...hl2.slice().reverse()];
    g.moveTo(hlPoly[0].x, hlPoly[0].y);
    for (let i = 1; i < hlPoly.length; i++) g.lineTo(hlPoly[i].x, hlPoly[i].y);
    g.closePath();
    g.fillPath();

    return { tipCx, tipHalfW };
  }

  /**
   * 指尖 —— 这一招的「眼睛」。
   *
   * 它必须比指身**亮得多、实得多**,因为玩家的视线会自然落在威胁的尖端。
   * 三层:外晕 → 指头圆 → 指甲。
   *
   * ## 指甲为什么是最关键的一笔
   *
   * 在 40 轴像素以内,「这是手指」靠的不是轮廓精度,而是一个**符号**。
   * 指甲(一个椭圆形的亮块,偏在指尖一侧)是最经济的那个符号 ——
   * 有它,一根发光的长条立刻读成「手指」;没它,它仍然可能读成锥子。
   */
  private drawFingertip(
    g: Phaser.GameObjects.Graphics,
    glow: Phaser.GameObjects.Graphics,
    tipCx: number,
    tipY: number,
    tipHalfW: number,
    alpha: number,
  ): void {
    const r = tipHalfW * 1.3;

    // 外晕:additive 层。指尖的光要**溢出去**,这是「审判」感的来源
    glow.fillStyle(this.color, 0.22 * alpha);
    glow.fillCircle(tipCx, tipY - r * 0.35, r * 2.1);
    glow.fillStyle(0xfff2cc, 0.16 * alpha);
    glow.fillCircle(tipCx, tipY - r * 0.35, r * 1.15);

    // 指头:一个略微竖向的圆 —— 指尖本来就是圆的
    g.fillStyle(this.color, 0.34 * alpha);
    g.fillCircle(tipCx, tipY - r * 0.3, r * 1.18);
    g.fillStyle(this.color, 0.5 * alpha);
    g.fillCircle(tipCx, tipY - r * 0.38, r);

    // 指甲:偏在指尖**前侧**的椭圆亮块。朝向随 TIP_LEAN 一致
    const nx = tipCx + r * 0.32;
    const ny = tipY - r * 0.62;
    g.fillStyle(0xfff4d8, 0.72 * alpha);
    g.fillEllipse(nx, ny, r * FingerOfFate.NAIL_RATIO * 1.5, r * FingerOfFate.NAIL_RATIO * 1.9);
    g.fillStyle(0xffffff, 0.42 * alpha);
    g.fillEllipse(nx - r * 0.08, ny - r * 0.1, r * FingerOfFate.NAIL_RATIO * 0.8,
      r * FingerOfFate.NAIL_RATIO * 1.1);

    // 指尖最亮的一点白热
    glow.fillStyle(0xffffff, 0.5 * alpha);
    glow.fillCircle(tipCx + r * 0.1, tipY - r * 0.5, r * 0.3);
  }

  // =====================================================================
  // 三段
  // =====================================================================

  /**
   * 天启:落点圈收缩 + 巨指下降。
   *
   * 两者进度同步 —— 圈收到最小、指降到最低,是同一时刻。
   * 玩家因此有**两个**可以读的进度指示,混战里只要看见其中一个就够了。
   */
  private drawWarn(g: Phaser.GameObjects.Graphics, glow: Phaser.GameObjects.Graphics, t: number): void {
    this.drawGroundSigil(g, glow, t, 1);

    // 巨指:从上方降下,透明度随进度增加(越来越「实」)
    // 用 Cubic.In —— 前段慢、后段快,像真的在**加速砸下来**
    const fall = Phaser.Math.Easing.Cubic.In(t);
    const tipY = -FingerOfFate.DROP_HEIGHT * (1 - fall);
    const alpha = 0.30 + 0.60 * t;
    if (this.fingerImg) {
      this.drawFingerTexture(tipY, alpha);
    } else {
      const halfW = this.radius * FingerOfFate.FINGER_WIDTH_RATIO * 0.5;
      const { tipCx, tipHalfW } = this.drawFingerBody(g, tipY, halfW, alpha);
      this.drawFingertip(g, glow, tipCx, tipY, tipHalfW, alpha);
    }
  }

  /**
   * 地面的落点法阵 —— 三段共用的底子。
   *
   * `t` 是「这一段的进度」,`strength` 是整体强度(收尾段会衰减)。
   *
   * 除了收缩的判定圈,这里还画了三样让它**不只是个圈**的东西:
   *   - 一圈**刻度齿**(像钟面/罗盘):把「命数」的意象立住;
   *   - 一段**缓慢自转的内环**:告诉玩家「这个阵是活的」;
   *   - 中心一个**十字准星**:指出确切的落点。
   * 三样都是纯 Graphics,不加素材依赖。
   */
  private drawGroundSigil(
    g: Phaser.GameObjects.Graphics,
    glow: Phaser.GameObjects.Graphics,
    t: number,
    strength: number,
  ): void {
    const r = this.radius;
    const s = strength;
    const spin = t * Math.PI * 0.7; // 内环自转,约 126°

    // 地面辉光(ADD):贴着地的一层暖光,越接近落地越亮
    glow.fillStyle(this.color, 0.10 * s * (0.4 + 0.6 * t));
    glow.fillCircle(0, 0, r * 0.95);

    // 落点圈:由外向内收缩到判定半径
    const ringR = r * (1 + (1 - t) * 0.7);
    g.lineStyle(3, this.color, (0.30 + 0.55 * t) * s);
    g.strokeCircle(0, 0, ringR);
    g.lineStyle(2, 0xffffff, (0.05 + 0.25 * t) * s);
    g.strokeCircle(0, 0, r * 0.55);

    // 刻度齿:判定圈外侧 16 道短齿,长短交替
    g.lineStyle(3, this.color, (0.35 + 0.4 * t) * s);
    for (let i = 0; i < 16; i++) {
      const a = (i / 16) * Math.PI * 2;
      const long = i % 2 === 0;
      const r0 = r * 1.06;
      const r1 = r * (long ? 1.18 : 1.12);
      g.beginPath();
      g.moveTo(Math.cos(a) * r0, Math.sin(a) * r0);
      g.lineTo(Math.cos(a) * r1, Math.sin(a) * r1);
      g.strokePath();
    }

    // 自转的内环:一段虚线圈(四段弧)
    g.lineStyle(2, this.color, (0.25 + 0.35 * t) * s);
    for (let i = 0; i < 4; i++) {
      const a0 = spin + (i / 4) * Math.PI * 2;
      g.beginPath();
      g.arc(0, 0, r * 0.72, a0, a0 + 0.9);
      g.strokePath();
    }

    // 中心十字准星
    g.lineStyle(2, 0xffffff, (0.15 + 0.35 * t) * s);
    const cr = r * 0.16;
    g.beginPath();
    g.moveTo(-cr, 0); g.lineTo(cr, 0);
    g.moveTo(0, -cr); g.lineTo(0, cr);
    g.strokePath();
  }

  /** 指落:触地一刻。冲击环 + 高亮,短促推满 */
  private drawSlam(g: Phaser.GameObjects.Graphics, glow: Phaser.GameObjects.Graphics, t: number): void {
    const r = this.radius;
    // 冲击环:从落点向外扩散
    const shock = r * (1 + t * 0.9);
    glow.lineStyle(8 * (1 - t) + 2, 0xffffff, 0.9 * (1 - t));
    glow.strokeCircle(0, 0, shock);
    g.lineStyle(6 * (1 - t) + 2, 0xffffff, 0.9 * (1 - t));
    g.strokeCircle(0, 0, shock);
    g.lineStyle(3, this.color, 0.7 * (1 - t));
    g.strokeCircle(0, 0, r * (0.9 + t * 0.2));
    // 触地闪光
    glow.fillStyle(0xffeecc, 0.55 * (1 - t));
    glow.fillCircle(0, 0, r * (0.5 + t * 0.5));
    // 落点法阵保持满亮,但随 t 略收
    this.drawGroundSigil(g, glow, 1, 0.6 + 0.4 * (1 - t));

    // 指身压在落点上(已触地),轻轻下压一下再回
    const press = Math.sin(t * Math.PI) * 8;
    if (this.fingerImg) {
      this.drawFingerTexture(press, 1 - t * 0.35);
    } else {
      const halfW = this.radius * FingerOfFate.FINGER_WIDTH_RATIO * 0.5;
      const { tipCx, tipHalfW } = this.drawFingerBody(g, press, halfW, 1 - t * 0.35);
      this.drawFingertip(g, glow, tipCx, press, tipHalfW, 1 - t * 0.35);
    }
  }

  /** 收尾:指抬起 + 虚化,地面留一圈余烬 */
  private drawFade(g: Phaser.GameObjects.Graphics, glow: Phaser.GameObjects.Graphics, t: number): void {
    const r = this.radius;
    const a = 1 - t;
    this.drawGroundSigil(g, glow, 1, a * 0.8);
    g.fillStyle(this.color, 0.18 * a);
    g.fillCircle(0, 0, r);
    g.lineStyle(3, this.color, 0.5 * a);
    g.strokeCircle(0, 0, r);
    // 手指抬起并变淡
    const lift = -FingerOfFate.DROP_HEIGHT * 0.4 * Phaser.Math.Easing.Quadratic.Out(t);
    if (this.fingerImg) {
      this.drawFingerTexture(lift, a * 0.6);
    } else {
      const halfW = this.radius * FingerOfFate.FINGER_WIDTH_RATIO * 0.5;
      const { tipCx, tipHalfW } = this.drawFingerBody(g, lift, halfW, a * 0.6);
      this.drawFingertip(g, glow, tipCx, lift, tipHalfW, a * 0.6);
    }
  }

  kill(): void {
    this.isDead = true;
    this.gfx.clear();
    this.glowGfx.clear();
    if (this.fingerImg) this.fingerImg.setVisible(false);
    this.setActive(false).setVisible(false);
  }
}
