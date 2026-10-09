import Phaser from 'phaser';
import type { Enemy } from './Enemy';
import { findNearestEnemy } from '../utils/Targeting';
import { WEAPONS } from '../config/WeaponConfig';
import { NEUTRAL_MODS } from '../types';
import type { FireModifiers } from '../types';

/** 投射物碰撞圆的基础半径(像素,未乘 scale) */
const HIT_RADIUS = 5;

export class Projectile extends Phaser.Physics.Arcade.Sprite {
  public damage = 10;
  public speed = 400;
  public pierceLeft = 0;
  public hitSet = new Set<Enemy>();
  public isDead = false;
  public weaponId = 'knife';
  public lifeMs = 1500;
  public bornAt = 0;
  public facing = 0;
  public areaMul = 1;

  // ---- 法宝修饰 ----
  /** 本次发射所属的修饰集合。同一次齐射的所有投射物共享同一个对象,只读 */
  public mods: FireModifiers = NEUTRAL_MODS;
  public homingTurn = 0;
  public homingTarget: Enemy | null = null;
  public nextRetargetAt = 0;
  public chainLeft = 0;
  public chainRadius = 0;
  public chainFalloff = 1;
  public searchRadius = 420;
  /** 连锁余辉时长(ms),在 preUpdate 里衰减 —— 不用 tween,因为池化对象带 tween 会跨存活期 */
  public chainGlowMs = 0;

  /**
   * 命中回调,由 WeaponSystem 注入(进化态的「炸开一片火海」)。
   *
   * 与 Slam.onImpact 同一套理由:不把 zone 池注入到投射物里,
   * 而是交出回调。⚠️ 池化对象必须在 kill()/setup() 里清干净 ——
   * 漏清会让上一发的回调在新弹上触发。
   */
  public onImpact: ((x: number, y: number) => void) | null = null;

  private enemyGroup!: Phaser.GameObjects.Group;

  constructor(scene: Phaser.Scene, enemyGroup: Phaser.GameObjects.Group) {
    super(scene, 0, 0, 'proj_knife');
    this.enemyGroup = enemyGroup;
    scene.add.existing(this);
    scene.physics.add.existing(this);
    this.setActive(false).setVisible(false);
    this.setDepth(80);
  }

  setup(
    x: number,
    y: number,
    angle: number,
    damage: number,
    speed: number,
    pierce: number,
    weaponId: string,
    areaMul: number,
    lifeMs: number,
    mods: FireModifiers,
  ): void {
    this.setPosition(x, y);
    this.setActive(true).setVisible(true);
    this.damage = damage;
    this.speed = speed;
    this.pierceLeft = pierce;
    this.weaponId = weaponId;
    this.areaMul = areaMul;
    this.lifeMs = lifeMs;
    this.bornAt = this.scene.time.now;
    this.isDead = false;
    this.hitSet.clear();
    this.facing = angle;

    // 池复用必须重置全部新增状态,否则会带上一次射击的残留
    this.mods = mods;
    this.homingTurn = mods.homingTurn;
    this.homingTarget = null;
    this.nextRetargetAt = 0;
    this.chainLeft = mods.chainCount;
    this.chainRadius = mods.chainRadius;
    this.chainFalloff = mods.chainFalloff;
    this.chainGlowMs = 0;
    // 池复用必须重置回调,否则上一次发射的命中特效会在新弹上触发
    this.onImpact = null;
    this.setAlpha(1);
    // 索敌半径随弹速放大,快弹不会因为射程不够而追不上
    this.searchRadius = 420 * (10 + this.speed / 40);

    // 纹理键读配置,不为每门法术加一个分支
    this.setTexture(WEAPONS[weaponId]?.texture ?? 'proj_knife');
    this.setRotation(angle);
    const s = Math.max(0.6, Math.min(2, areaMul));
    this.setScale(s);

    const body = this.body as Phaser.Physics.Arcade.Body;
    body.enable = true;
    body.setCircle(HIT_RADIUS * s, -HIT_RADIUS * s, -HIT_RADIUS * s);
    // 关键:setCircle 的偏移是相对 body 顶点,而 body 顶点 = 精灵中心 - 贴图尺寸/2。
    // 只写 setCircle(-r,-r) 会让碰撞圆落在贴图左上角,而不是中心 ——
    // 对横向的剑形/刃形贴图(12x6、20x8)来说,圆心会偏到剑柄后面,
    // 表现为「剑尖已经插进敌人却不判定命中」。
    const fw = this.frame.realWidth;
    const fh = this.frame.realHeight;
    body.setOffset(fw / 2 - HIT_RADIUS * s, fh / 2 - HIT_RADIUS * s);
    body.setVelocity(Math.cos(angle) * speed, Math.sin(angle) * speed);
  }

  preUpdate(time: number, delta: number): void {
    super.preUpdate(time, delta);
    if (!this.active) return;
    // lifeMs 用的是场景时钟,暂停期间若不拦截,飞行中的投射物会在玩家读升级面板时凭空过期
    if (this.scene.physics.world.isPaused) return;

    // 连锁余辉
    if (this.chainGlowMs > 0) {
      this.chainGlowMs -= delta;
      if (this.chainGlowMs <= 0) {
        this.setAlpha(1);
        this.chainGlowMs = 0;
      }
    }

    if (this.isDead || time - this.bornAt > this.lifeMs) {
      this.kill();
      return;
    }

    if (this.homingTurn > 0) {
      this.steer(time, delta);
    }
  }

  /**
   * 每帧转向(一次 atan2 + 一次 RotateTo,很便宜)。
   * 需要节流的是目标获取,不是转向 —— 否则每颗弹每帧扫一遍全部敌人。
   */
  private steer(time: number, delta: number): void {
    const t = this.homingTarget;
    if (!t || !t.active || t.isDead || time >= this.nextRetargetAt) {
      this.homingTarget = findNearestEnemy(this.enemyGroup, this.x, this.y, this.searchRadius);
      this.nextRetargetAt = time + this.mods.homingRetargetMs;
    }
    const target = this.homingTarget;
    if (!target) return;

    const desired = Math.atan2(target.y - this.y, target.x - this.x);
    const body = this.body as Phaser.Physics.Arcade.Body;
    const cur = Math.atan2(body.velocity.y, body.velocity.x);
    // RotateTo 走最短路径,正是转向需要的原语
    const next = Phaser.Math.Angle.RotateTo(cur, desired, this.homingTurn * (delta / 1000));
    body.setVelocity(Math.cos(next) * this.speed, Math.sin(next) * this.speed);
    this.setRotation(next);
  }

  kill(): void {
    this.isDead = true;
    this.homingTarget = null;
    this.chainLeft = 0;
    this.onImpact = null;
    this.setActive(false).setVisible(false);
    const body = this.body as Phaser.Physics.Arcade.Body;
    body.enable = false;
    body.setVelocity(0, 0);
  }

  /**
   * 命中后:优先连锁,没有可连锁的目标才消耗穿透次数。
   *
   * 连锁采用「原地重定向」而非「从命中点 fork 新弹」,因为后者需要把投射物池
   * 注入投射物(回到池耗尽崩溃)、放大并发弹数、并让 hitSet 变成双向记账。
   * 原地重定向复用现有 hitSet,零分配。
   */
  onHitEnemy(): void {
    // 命中特效(进化态炸开火海)。每次命中都触发,不只是第一次 ——
    // 穿透弹沿途每一段都该炸
    this.onImpact?.(this.x, this.y);

    if (this.chainLeft > 0) {
      const next = findNearestEnemy(this.enemyGroup, this.x, this.y, this.chainRadius, this.hitSet);
      if (next) {
        this.chainLeft--;
        this.damage *= this.chainFalloff;
        // 必须落在新目标身上,否则 Arcade overlap 在下一个物理步才触发
        this.setPosition(next.x, next.y);
        this.chainGlowMs = 120;
        this.setAlpha(0.75);
        // 连锁与追踪叠加时的涌现效果:每次跳跃都自动朝新目标追踪,无需特判
        if (this.homingTurn > 0) {
          this.homingTarget = next;
          this.nextRetargetAt = 0;
        }
        return; // 不 kill,不递减穿透
      }
    }
    this.pierceLeft--;
    if (this.pierceLeft < 0) {
      this.kill();
    }
  }
}