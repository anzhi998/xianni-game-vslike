import Phaser from 'phaser';
import type { Enemy } from '../Enemy';
import type { DamageApplier, DamageOptions } from '../../types';

/**
 * 环绕体 —— 绕玩家公转的剑,接触即伤害(剑阵)
 *
 * 全体系唯一「不用瞄准」的形态:它的存在意义是**跟着玩家走**,
 * 所以中心必须每帧从 getPivot() 取实时坐标 —— 在 setup() 里捕获一次
 * player.x/y 看起来完全正确,实际会让整圈飞剑在玩家一动就掉在原地。
 *
 * 命中判定分两层:**外层**每 `QUERY_MS` 跑一次邻近查询(按住遍历全池的开销),
 * **内层**按每个敌人的上次命中时刻决定能不能再打(`hitCdMs`)。
 * 只有内层那一层是设计参数 —— 剑阵的「同一目标再命中的间隔」就是它。
 * ⚠️ 把两层写成同一个值(历史上就是这么写的)会让内层失效,
 * 详见 `lastHitAt` 的注释。
 */
export class Orbiter extends Phaser.GameObjects.Image {
  /** 「收束」的全过程时长(ms)。斩罗决的放射剑气靠它做出前摇 */
  public static readonly CONTRACT_MS = 420;
  /** 收束时轨道缩到原半径的多少 */
  private static readonly CONTRACT_MIN = 0.28;

  public isDead = false;
  public damage = 10;

  private enemyGroup!: Phaser.GameObjects.Group;
  private applyDamage!: DamageApplier;
  /** 公转中心。必须每帧取实时坐标 —— 捕获坐标会让环绕体甩在原地 */
  private getPivot: () => { x: number; y: number } = () => ({ x: 0, y: 0 });

  private orbitAngle = 0;
  private orbitRadius = 60;
  private orbitSpeed = 2;
  /** 收束剩余时长(ms)。> 0 时轨道半径按一条缩-放曲线收缩 */
  private contractMsLeft = 0;
  private lifeMs = 3000;
  private elapsedMs = 0;
  private hitCdMs = 350;
  private hitRadius = 16;
  private status: DamageOptions = {};
  /**
   * 每个敌人的上次命中时刻(ms,与 Phaser 的 time 同轴)。
   *
   * ⚠️ 这里**曾经**是一个 `Set<Enemy>`,只在 setup/kill 清空 —— 也就是
   * 「每把飞剑对同一只怪,一生只打一次」。那个实现让 `hitCdMs` 形同虚设:
   * 剑阵每级的 life 恰好等于 hitCdMs(飞剑正好转满一圈就消失),所以一圈只挨一次,
   * 于是**仙剑 5 级「穿透 = 命中冷却减半」在伤害上几乎不产生任何收益** ——
   * 一张承诺 DPS 翻倍、实际给不了一张卡。改成按敌计时之后,冷却才真的存在。
   */
  private lastHitAt = new Map<Enemy, number>();
  /** 外观缩放。不参与命中判定 —— 见 setup() 的注释 */
  private visualScale = 1;
  /** 本次施法的第 0 把剑负责画轨道环 */
  private isRingOwner = false;
  /** 轨道环。**不是子对象** —— Orbiter 是 Image,加不了 children,所以它是一个平级的 Graphics */
  private ring!: Phaser.GameObjects.Graphics;

  constructor(scene: Phaser.Scene) {
    super(scene, 0, 0, 'proj_sword_array');
    scene.add.existing(this);
    this.setActive(false).setVisible(false);
    this.setDepth(85);
    // 深度压在飞剑之下(85):环是「轨道在哪儿」的说明,不该盖住剑本身。
    // 每帧 clear + 重画,不用 tween —— 池化对象带 tween 会跨存活期(见 CLAUDE.md)
    this.ring = scene.add.graphics().setDepth(84).setVisible(false);
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
    hitCdMs: number,
    texture: string,
    status: DamageOptions = {},
    visualScale = 1,
    isRingOwner = false,
  ): void {
    this.orbitAngle = startAngle;
    this.damage = damage;
    this.orbitRadius = orbitRadius;
    this.orbitSpeed = orbitSpeed;
    this.lifeMs = lifeMs;
    this.elapsedMs = 0;
    this.hitCdMs = Math.max(120, hitCdMs);
    this.hitRadius = 16;
    this.status = status;
    this.isDead = false;
    this.lastHitAt.clear();

    this.setTexture(texture);
    this.setActive(true).setVisible(true);
    this.setAlpha(1);
    // ⚠️ 纯外观。Orbiter 没有物理体,命中判定走 damageTouching() 里的
    //    `hitRadius`(恒 16px),**不**像 Projectile 那样「半径 ÷ scale」——
    //    那边必须成对给是因为 Body.updateBounds 会把 scale 乘进碰撞圆,
    //    这里根本没有 body。放大飞剑只是让它终于比杂兵(10–20px)大。
    this.visualScale = Math.max(0.5, visualScale);
    this.setScale(this.visualScale);
    this.setDepth(85);

    // 复用时这一步不能省:这一把可能不是环的拥有者,但池子里上一任可能是,
    // 不主动收掉就会留下一圈不属于任何剑的轨道环。
    this.isRingOwner = isRingOwner;
    this.ring.setVisible(isRingOwner);
    if (!isRingOwner) this.ring.clear();

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
    // 「收束」:剑先向内缩、再猛地弹回。半径用一条折返曲线,不加减速的补间 ——
    // 池化对象带 tween 会跨存活期(见 CLAUDE.md)
    if (this.contractMsLeft > 0) this.contractMsLeft = Math.max(0, this.contractMsLeft - delta);
    const t = 1 - this.contractMsLeft / Orbiter.CONTRACT_MS;   // 0 → 1
    const contract = this.contractMsLeft > 0
      ? (t < 0.45
          ? 1 - (t / 0.45) * (1 - Orbiter.CONTRACT_MIN)          // 缩
          : Orbiter.CONTRACT_MIN + ((t - 0.45) / 0.55) * (1 - Orbiter.CONTRACT_MIN)) // 放
      : 1;

    // 一旦开始收束,转速同步拉高:向外斩出之前先「绷紧」,动作才读得出来
    this.orbitAngle += this.orbitSpeed * (this.contractMsLeft > 0 ? 2.6 : 1) * (delta / 1000);
    // 每帧取玩家的实时坐标 —— 玩家移动时环绕体必须跟着走
    const p = this.getPivot();
    const radius = this.orbitRadius * contract;
    const prevX = this.x;
    const prevY = this.y;
    this.setPosition(
      p.x + Math.cos(this.orbitAngle) * radius,
      p.y + Math.sin(this.orbitAngle) * radius,
    );
    this.setRotation(this.orbitAngle + Math.PI / 2);
    if (this.isRingOwner) this.drawRing(p, radius);

    // ⚠️ 判定必须**沿这一帧走过的弧**子步进,只在终点查一次会穿隧。
    //
    // 穿隧:飞剑线速度 = 半径 × 角速度。斩罗决(141 × 7.0)约 **986px/s**,
    // 一帧走 16.4px,而判定半径只有 16px —— 它完全可以从「敌人左侧 16.4px」直接
    // 跳到「右侧 16.4px」,两帧都不在判定圈内,于是**从敌人身上穿过去而没打中**。
    // 实测:斩罗决在生成点的那一次经过就是这样丢掉的,
    // 命中时刻是 [867, 1767] 而不是 [0, 898, 1796]。
    //
    // 步长压到判定半径的一半以下,任何一段弧都不可能整个跨过判定圈。
    // 上限 8 步:正常帧只需 1 步,只在很卡的帧或半径突变(收束)时才细分。
    const stepLen = Math.hypot(this.x - prevX, this.y - prevY);
    const steps = Math.max(1, Math.min(8, Math.ceil(stepLen / (this.hitRadius * 0.5))));
    for (let st = 1; st <= steps; st++) {
      const f = st / steps;
      // 真正的门是按敌时间戳;全池遍历的开销(8 把 × N 个敌人 × 帧)可以接受
      this.damageTouching(time, prevX + (this.x - prevX) * f, prevY + (this.y - prevY) * f);
    }

    if (this.elapsedMs >= this.lifeMs) this.kill();
  }

  /**
   * 轨道环。
   *
   * 它一次画两笔:内层细亮线给「边界在哪」,外层宽淡圈给一圈柔光。
   * 只有两笔是因为再多的层次在这个尺寸下(半径 96–141px)都读不出来,
   * 而环本身必须**克制** —— 剑阵是常驻形态,环也就在场上一直亮着,
   * 画得太实就变成一层挡住战场的底色。
   *
   * 半径跟着 `contract` 一起收缩,所以斩罗决收束时环会先 inward 收一圈 ——
   * 那正是玩家读到的前摇。
   */
  private drawRing(pivot: { x: number; y: number }, radius: number): void {
    const g = this.ring;
    g.clear();
    g.lineStyle(2, 0x88ddff, 0.32);
    g.strokeCircle(pivot.x, pivot.y, radius);
    g.lineStyle(7, 0x88ddff, 0.10);
    g.strokeCircle(pivot.x, pivot.y, radius);
  }

  private damageTouching(time: number, cx: number, cy: number): void {
    const r = this.hitRadius;
    const r2 = r * r;
    const cd = this.hitCdMs;
    const list = this.enemyGroup.children.entries;
    for (let i = 0; i < list.length; i++) {
      const e = list[i] as Enemy;
      if (!e.active || e.isDead) continue;
      const last = this.lastHitAt.get(e);
      if (last !== undefined && time - last < cd) continue;
      const dx = e.x - cx;
      const dy = e.y - cy;
      if (dx * dx + dy * dy > r2) continue;
      this.lastHitAt.set(e, time);
      this.applyDamage(e, this.damage, e.x, e.y - 8, this.status);
    }
    // 敌人死亡/回收后会把**同一个对象**借给下一只,时间戳还挂在上面 ——
    // 那样新来的怪会莫名其妙地「还在冷却里」。所以顺手清掉失效的键。
    if (this.lastHitAt.size > 0) {
      for (const e of this.lastHitAt.keys()) {
        if (!e.active || e.isDead) this.lastHitAt.delete(e);
      }
    }
  }

  /** 开始一次收束。由 WeaponSystem 在斩罗决放射剑气之前调用 */
  contract(ms: number): void {
    this.contractMsLeft = Math.max(this.contractMsLeft, ms);
  }

  kill(): void {
    this.isDead = true;
    this.contractMsLeft = 0;
    this.lastHitAt.clear();
    this.isRingOwner = false;
    // 不 clear 就会留下一圈挂在场上、但已经没有剑在转的轨道环
    this.ring.clear();
    this.ring.setVisible(false);
    this.setActive(false).setVisible(false);
  }
}