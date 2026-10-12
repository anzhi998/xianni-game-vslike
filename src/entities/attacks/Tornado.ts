import Phaser from 'phaser';
import { forEachEnemyInArc } from '../../utils/AreaDamage';
import type { Enemy } from '../Enemy';
import type { DamageApplier, DamageOptions } from '../../types';

/**
 * 龙卷 —— 一条**有厚度的弧带**,自释放点向外旋卷
 *
 * ## 几何:一条弧带,一边外移一边**转**
 *
 * 本体是半径 `head` 与 `tail` 之间的一段圆环扇(annular sector):
 * `head` 随时间从 0 涨到弧半径,`tail` 恒落后 `head` 一个固定厚度。
 * 同时整条弧的中心方向从 `facing` 转到 `facing + arcSweep` ——
 * 于是任一点的轨迹是**螺旋**,而不是一根从脚下射出去的直线。
 *
 * ⚠️ **「会转」不是装饰,是设计书写死的**。第七节 ⑥ 对多道龙卷的判词是
 *    「同圆心、**同角速度**、互不重叠」—— 同角速度只有在弧带会转时才是一句话,
 *    否则八个「同心弧」各自沿半径直线飞出,永远是同八个方向,没有任何角速度可言。
 *    玩家对「弹道不是弧形」的反馈,指的就是缺了这一项。
 *    而**一起转**恰好保证互不重叠:8 道始终相差 45°,不会挤到一起。
 *
 * ## 结算模型:覆盖即命中,离开再命中一次
 *
 * 设计书:「对沿途每个敌人结算 2 次(弧线切入时 1 次、卷过其位置时 1 次)」。
 * 把它翻译成对**移动区域**也成立的写法,就是「进入弧带 1 次、离开弧带 1 次」:
 *   - 进入(0 → 1):前缘扫到它 / 弧转到它头上 —— 「弧线切入」
 *   - 离开(1 → 2):后缘卷过它 / 弧转离它 —— 「卷过其位置」
 *   - 计数 ≥ 2 → 永不再结算
 *
 * 直线飞行时这两句与设计书逐字对应(前缘到达 = 进入,后缘越过 = 离开),
 * 而弧带一旦会转,旧写法就会漏:`d < tail` 之后再被弧扫到的敌人会被
 * 「已经过去」这条判据挡掉,**一次都不吃伤害**。按区域进出判定没有这个盲区。
 *
 * ⚠️ 为什么不能像沙浪那样「不去重」:弧带飞出去的距离是固定的,而敌人在
 *    弧里待的时间由 `head-tail` 决定;每帧都结算的话,站在弧里 0.16 秒的
 *    怪会吃满十几次,单体直接翻五倍。计数表把「两次」写进实现,
 *    于是 `道数 × 伤害 × 2 ÷ 冷却` 这个公式在代码里成立,而不是只在文档里成立。
 *
 * ## 为什么是**速度偏移**而不是位移
 *
 * 与 SandWave 的推挤同理(见该文件的注释):EnemyAiSystem 每帧整体重写
 * 敌人速度,一次性位移下一帧就没了。牵引走 Enemy.pullX/pullY。
 *
 * ## 不用 tween
 *
 * 池化对象带 tween 会跨存活期触发(见 CLAUDE.md)。存续用 preUpdate 里的
 * elapsedMs 计时 + 透明度衰减。
 */
export class Tornado extends Phaser.GameObjects.Container {
  public isDead = false;

  /**
   * 弧带厚度(px)。**不是**设计书给的数 —— 文档没有这一项,
   * 但它是「每目标结算 2 次」得以成立的物理前提:前缘与后缘必须有距离,
   * 否则整段弧只是一瞬间的扫过,第二次结算无从发生。
   * 40px ≈ 0.62 格,比一只怪略宽,所以「卷过去」在视觉上确实像是被刮了一次。
   */
  private static readonly THICKNESS = 40;
  /** 旋卷臂的转速(弧度/秒)。纯表现:弧带本体是不旋转的 */
  private static readonly SPIN_SPEED = 7;

  private gfx: Phaser.GameObjects.Graphics;
  private enemyGroup!: Phaser.GameObjects.Group;
  private applyDamage!: DamageApplier;
  /**
   * 弧带前缘的「龙头」贴图(龙卷 / 呼风的 proj_longjuan / proj_hufeng)。
   *
   * 弧带本体是 Graphics 画的,但这两个法术的画面承诺是**黑龙** ——
   * 只有一条发光的弧在卷,玩家看到的是「一圈会动的光」而不是龙。
   * 贴图缺图时整个字段保持 undefined,弧带照常工作(素材是逐步替换的)。
   */
  private head?: Phaser.GameObjects.Image;
  private headKey = '';

  /** 本段弧的**起始**中心方向(弧度)。释放时由走位决定 */
  private facing = 0;
  /** 整次释放里绕玩家转过的总角度(弧度)。见类注释「会转不是装饰」 */
  private sweep = 0;
  /** 本段弧**自身**的张角(弧度)。由配置的 `arcWidth` 决定(50°),
   *  **不是**整次释放的总张角 —— 后者是「散布角」,只管 count 道往哪几个方向飞 */
  private span = 1;
  private radius = 224;
  private damage = 8;
  private pullSpeed = 0;
  private pullMs = 250;
  private lifeMs = 900;
  private color = 0x5fd9c0;
  private status: DamageOptions = {};
  private elapsedMs = 0;
  private spin = 0;
  /**
   * 已被刮过的敌人与刮了几次 —— **本次释放的若干道弧带共用同一张表**。
   *
   * ⚠️ 为什么不是每道一张(设计书那句「不同龙卷各自结算」):
   *    那句话的前提是「多道龙卷是同心弧、互不重叠,因此不存在同一位置被两道
   *    反复刮」。**弧带会转之后这个前提不成立了** —— 8 道 45° 的黑龙在旋转中
   *    会依次扫过同一片地面,一个站桩目标在一次释放里会被**两道**先后刮到。
   *    每道各自记账的话,呼风的群伤 DPS 正好翻倍(≈229 → ≈458),
   *    而设计书那张表的配表告警写得很死:按 2 次结算,不许配爆。
   *
   *    所以恒等式改成「**一次释放,同一目标最多结算 2 次**」——
   *    它与设计书的数字完全一致,且不受弧带怎么动的影响。
   *    由 WeaponSystem.fireArc 建表并传给本次释放的每一道弧带。
   *
   * ⚠️ 因此 setup / kill **都不能 clear 它**:先消散的那一道会把表清空,
   *    还在场的兄弟道于是重新记账,又变回翻倍。表跟着「一次释放」生灭,
   *    下一次释放会拿到一张新表。
   */
  private hitCounts = new Map<Enemy, number>();
  /**
   * 本帧落在弧带内的敌人。
   *
   * ⚠️ 必须跨帧复用同一个 Set(每帧 clear),不能每帧 new 一个:
   *    这是 60fps 下每只弧带每帧都要走一遍的路径。
   */
  private covered = new Set<Enemy>();

  constructor(scene: Phaser.Scene) {
    super(scene, 0, 0);
    this.gfx = scene.add.graphics();
    this.add([this.gfx]);
    scene.add.existing(this);
    this.setActive(false).setVisible(false);
    this.setDepth(78);
  }

  bind(enemyGroup: Phaser.GameObjects.Group, apply: DamageApplier): void {
    this.enemyGroup = enemyGroup;
    this.applyDamage = apply;
  }

  /**
   * @param facing  本段弧的中心方向(弧度)。释放时由走位决定
   * @param span    本段弧**自身**的张角(弧度)= 配置的 `arcWidth`(50°)。
   *                不是「总张角 ÷ 道数」—— 那是旧行为,各道首尾相接连成一整片扇面
   * @param pullSpeed 牵引速度(px/s),由「牵引距离 ÷ 牵引时长」在 WeaponSystem 现算
   * @param pullMs    牵引持续时长。与推挤共用同一个手感基准,单一来源在 WeaponSystem
   * @param sweep     整次释放里弧带绕玩家转过的总角度(弧度)。0 = 直线射出
   * @param texture   前缘龙头贴图。缺图时为 undefined,弧带照常
   */
  setup(
    x: number,
    y: number,
    facing: number,
    span: number,
    radius: number,
    damage: number,
    pullSpeed: number,
    pullMs: number,
    lifeMs: number,
    color: number,
    sweep: number,
    /** 本次释放共用的命中表(见 hitCounts 的注释) */
    sharedHits: Map<Enemy, number>,
    texture?: string,
    status: DamageOptions = {},
  ): void {
    this.hitCounts = sharedHits;
    this.facing = facing;
    this.sweep = sweep;
    this.span = span;
    this.radius = radius;
    this.damage = damage;
    this.pullSpeed = pullSpeed;
    this.pullMs = pullMs;
    this.lifeMs = lifeMs;
    this.color = color;
    this.status = status;
    this.prepareHead(texture);
    this.elapsedMs = 0;
    this.spin = Math.random() * Math.PI * 2;
    // ⚠️ 必须清空:敌人是池化实体,留着上一轮敌人的引用会让它们一出场
    // 就带着「已经刮过两次」的计数,于是从头到尾一次都不吃伤害。
    this.covered.clear();
    this.isDead = false;

    this.setActive(true).setVisible(true);
    this.setPosition(x, y);
    this.setAlpha(1);
    this.draw(0);
  }

  /**
   * 备好前缘龙头贴图。
   *
   * 三条刻意的选择:
   *   - **只在贴图真的存在时才建**:`scene.add.image` 拿到不存在的键会退到
   *     `__MISSING`(一个绿方块),那还不如什么都不画;
   *   - **按需创建 + 换键换图**:池里的一个 Tornado 这次是龙卷、下次可能是呼风,
   *     而两张图尺寸不同(20×20 vs 28×16),所以尺寸也要跟着重算;
   *   - **缩放按弧带厚度算**:`THICKNESS / max(w, h)` —— 龙头画得比弧带厚就
   *     会盖住判定线,画得比它薄就看不出来是同一件事。素材换了尺寸也自动跟。
   */
  private prepareHead(texture?: string): void {
    if (!texture || !this.scene.textures.exists(texture)) {
      // 没有真实素材:藏掉上一轮可能留下的图,别让它带着旧贴图复用
      this.head?.setVisible(false);
      this.headKey = '';
      return;
    }
    if (!this.head) {
      this.head = this.scene.add.image(0, 0, texture);
      this.add([this.head]);   // 加在 gfx 之后 → 压在弧带上面
    } else if (this.headKey !== texture) {
      this.head.setTexture(texture);
    }
    this.headKey = texture;
    const frame = this.head.frame;
    this.head.setScale(Tornado.THICKNESS / Math.max(frame.realWidth, frame.realHeight));
    this.head.setVisible(true);
  }

  preUpdate(_time: number, delta: number): void {
    if (!this.active) return;
    if (this.scene.physics.world.isPaused) return;

    this.elapsedMs += delta;
    this.spin += delta / 1000 * Tornado.SPIN_SPEED;
    const t = Math.min(1, this.elapsedMs / this.lifeMs);
    this.draw(t);
    if (t < 1) this.strikeAll(t);
    else this.kill();
  }

  /**
   * 当前时刻弧带的中心方向。整条弧按 `t` 匀速转出 `arcSweep`。
   *
   * 用**线性**而不是缓出:弧带是匀速旋卷,缓动会让「它到哪了」变得不可预期,
   * 而玩家要靠这个判断还有没有怪会被扫到。
   */
  private faceAt(t: number): number {
    return this.facing + this.sweep * t;
  }

  /**
   * 结算本段弧此刻的覆盖:进入弧带 = 第 1 次,离开弧带 = 第 2 次。
   *
   * 两遍而不是一遍,是因为「离开」这件事**只有上一帧在带内、这一帧不在**
   * 才成立 —— 单次遍历只看得见还在带内的敌人,永远等不到它们离开。
   */
  private strikeAll(t: number): void {
    const head = Math.max(1, this.radius * t);
    const tail = Math.max(0, head - Tornado.THICKNESS);
    const face = this.faceAt(t);

    this.covered.clear();
    forEachEnemyInArc(this.enemyGroup, this.x, this.y, head, face, this.span, (e) => {
      const dx = e.x - this.x;
      const dy = e.y - this.y;
      // 后缘还没卷到它 —— 在前缘与后缘之间才算「在带内」
      if (Math.hypot(dx, dy) < tail) return;
      this.covered.add(e);
    });

    // ① 进入:前缘扫到它,或者弧转到它头上
    for (const e of this.covered) {
      if ((this.hitCounts.get(e) ?? 0) !== 0) continue;
      this.hitCounts.set(e, 1);
      this.strike(e);
    }

    // ② 离开:后缘卷过它,或者弧转离它。
    //    已经在带内(计数 1 且本帧仍被覆盖)的跳过;计数 2 的永不再碰。
    for (const [e, n] of this.hitCounts) {
      if (n !== 1 || this.covered.has(e)) continue;
      this.hitCounts.set(e, 2);
      // 它可能已经死了(第 1 次就打死了,或者被别的法术收掉)——
      // 死亡补间期间 active 仍为 true,靠 isDead 挡
      if (e.active && !e.isDead) this.strike(e);
    }
  }

  /** 一次结算:伤害 + 牵引。进入与离开各调一次,合计就是设计书的「结算 2 次」 */
  private strike(e: Enemy): void {
    this.applyDamage(e, this.damage, e.x, e.y - 8, this.status);

    // 牵引:朝弧心(释放点)拉。与厚土术的推挤方向相反,两者叠加即抵消
    if (this.pullSpeed <= 0) return;
    const dx = e.x - this.x;
    const dy = e.y - this.y;
    const d = Math.hypot(dx, dy) || 1;
    if (d > 1) e.applyPull(-dx / d, -dy / d, this.pullSpeed, this.pullMs, this.scene.time.now);
  }

  private draw(t: number): void {
    const g = this.gfx;
    const color = this.color;
    g.clear();
    // ⚠️ 下面这个局部 `head` 是**前缘半径**(一个数),与 this.head(龙头贴图)
    //    只是重名。两者都在本方法里,别把 this.head 写成 head。
    const head = Math.max(1, this.radius * t);
    const tail = Math.max(0, head - Tornado.THICKNESS);
    // 弧带**转**到哪了 —— 绘制与判定必须用同一个 face,否则会出现
    // 「看着扫过去了却没伤害」。两者都读 faceAt(t),不各算一遍
    const face = this.faceAt(t);
    const a0 = face - this.span / 2;
    const a1 = face + this.span / 2;
    // 越飞越淡 —— 弧带扫完的外圈留不住,「正在卷出去」这件事由它表达
    const alpha = 1 - t * 0.55;

    // 环带本体。前缘还没推出去时 inner 为 0,退化成一片扇面
    g.fillStyle(color, 0.22 * alpha);
    g.beginPath();
    g.arc(0, 0, head, a0, a1, false);
    if (tail > 0) g.arc(0, 0, tail, a1, a0, true);
    g.closePath();
    g.fillPath();

    // 旋卷臂:三条随时间转相位的小弧,让「旋」在静止画面上也读得出来。
    // ⚠️ 它们只是表现 —— 判定用的始终是上面那一个 head/tail 环带
    g.lineStyle(3, 0xffffff, 0.22 * alpha);
    for (let i = 0; i < 3; i++) {
      const r = Math.max(1, this.radius * (0.25 + i * 0.25) * (0.35 + t * 0.65));
      const phase = this.spin * (i % 2 === 0 ? 1 : -1);
      g.beginPath();
      g.arc(0, 0, r, a0 + phase, a1 - (a1 - a0) * 0.25 + phase, false);
      g.strokePath();
    }

    // 前缘:玩家真正在看的「这道弧走到哪了」
    g.lineStyle(5, 0xffffff, 0.6 * alpha);
    g.beginPath();
    g.arc(0, 0, head, a0, a1, false);
    g.strokePath();
    // 两侧的边线,把这条弧的**宽度**画出来(判定就是那个宽度)
    g.lineStyle(3, color, 0.8 * alpha);
    for (const a of [a0, a1]) {
      g.beginPath();
      g.moveTo(Math.cos(a) * tail, Math.sin(a) * tail);
      g.lineTo(Math.cos(a) * head, Math.sin(a) * head);
      g.strokePath();
    }

    // 龙头:压在弧带**前缘的正中**,位置跟着朝外走,但贴图**永不旋转**。
    //
    // ⚠️ 这里**不要** setRotation(face)。素材是「正面朝镜头」画的一张立绘,
    //    跟着弹道转的话,卷到左边那只就整个倒过来 —— 玩家看到的是
    //    「龙头横躺着飞」,实测反馈就是「方向不对,应该永远是正面」。
    //    与怪物同一条约定:只翻面、不旋转(见 CLAUDE.md)。
    //    位置仍然由 face 决定,所以「龙领着弧带走」这一点不受影响。
    if (this.head?.visible) {
      this.head.setPosition(Math.cos(face) * head, Math.sin(face) * head);
      this.head.setAlpha(alpha);
    }
  }

  kill(): void {
    // ⚠️ 消散前,给「进过带、但还没吃到第二次」的敌人补上第二击。
    //
    // 设计书的命中模型是**每目标恰好 2 次**,而弧带一旦会转,进入得晚的目标
    // 会在弧带消散时还没等到「离开」那一次 —— 于是只吃 1 次。正前方向的目标
    // 尤其容易这样(它由外侧那道弧负责扫到,而外侧那道是最后才转过来的)。
    // 不补的话单体 DPS 直接砍半(101.5 → 51),而整张表是按 2 次算出来的。
    //
    // 它**不会**超出设计书的强度:被进入过的目标,在「弧带掠过」这个模型里
    // 本来就该吃满 2 次,这里只是把跑到寿命之外的那一次补上。
    // 表是本次释放共用的,所以这里补的可能包含兄弟道正覆盖着的目标 ——
    // 计数一到 2 就锁死,先补后补只是**时机**差一帧,总量仍是 2 次
    for (const [e, n] of this.hitCounts) {
      if (n !== 1) continue;
      if (e.active && !e.isDead) this.strike(e);
    }
    this.isDead = true;
    this.gfx.clear();
    // 龙头是独立子对象,容器 setVisible(false) 不会替它清干净 —— 池化复用时
    // 上一轮的龙头会留在原地(下一次 setup 若换了一门法术,那就是一条黑龙
    // 飘在没有弧带的地方)
    this.head?.setVisible(false);
    this.setActive(false).setVisible(false);
  }
}