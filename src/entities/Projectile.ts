import Phaser from 'phaser';
import type { Enemy } from './Enemy';
import type { DamageApplier, DamageOptions } from '../types';

/**
 * 投射物 —— 直线飞行的实体,靠 Arcade overlap 结算命中
 *
 * 池化约定(见 CLAUDE.md):setup() 重置全部可变字段,kill() 关掉 body 并清零速度,
 * 不使用 tween。
 */
export class Projectile extends Phaser.Physics.Arcade.Sprite {
  public damage = 10;
  public pierceLeft = 0;
  public hitSet = new Set<Enemy>();
  public isDead = false;
  public spellId = 'fireball';
  public lifeMs = 1500;
  public bornAt = 0;
  /** 本发附带的状态(点燃 / 减速)。命中时原样交给 DamageApplier */
  public status: DamageOptions = {};

  /**
   * 命中回调,由 WeaponSystem 注入(焚天·火海的「命中炸开灼烧区」)。
   *
   * 不把 zone 池注入到投射物里,而是交出回调 —— 与旧实现的理由相同。
   * ⚠️ 池化对象必须在 kill() 与 setup() 里清干净,
   * 漏清会让上一发的回调在新弹上触发(表现为「一发火球炸出两片海」)。
   */
  public onImpact: ((x: number, y: number) => void) | null = null;

  constructor(scene: Phaser.Scene) {
    super(scene, 0, 0, 'proj_fireball');
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
    spellId: string,
    texture: string,
    hitRadius: number,
    lifeMs: number,
    status: DamageOptions,
    visualScale = 1,
  ): void {
    this.setPosition(x, y);
    this.setActive(true).setVisible(true);
    this.damage = damage;
    this.pierceLeft = pierce;
    this.spellId = spellId;
    this.lifeMs = lifeMs;
    this.bornAt = this.scene.time.now;
    this.isDead = false;
    this.hitSet.clear();
    this.status = status;
    this.onImpact = null;
    this.setAlpha(1);

    this.setTexture(texture);
    this.setRotation(angle);

    // 贴图缩放只改外观 —— 碰撞圆必须维持 hitRadius 不变。
    //
    // ⚠️ Phaser 的 Body.updateBounds 从 frame.realWidth × scaleX 推导尺寸,
    //    圆心半径会被 sprite 的 scale **乘一遍**(实测:scale=1.5 时传入 r=42.7
    //    得到的就是世界半径 64)。所以想让贴图变宽而命中判定不动,
    //    只能「半径 ÷ scale」——两个数必须成对给,见 SpellLevel.visualScale。
    const s = Math.max(0.5, visualScale);
    this.setScale(s);

    const body = this.body as Phaser.Physics.Arcade.Body;
    body.enable = true;

    const r = Math.max(4, hitRadius) / s;
    body.setCircle(r, -r, -r);
    // 关键:setCircle 的偏移是相对 body 顶点,而 body 顶点 = 精灵中心 - 贴图尺寸/2。
    // 只写 setCircle(-r,-r) 会让碰撞圆落在贴图左上角,表现为「剑尖插进敌人却不判定命中」。
    const fw = this.frame.realWidth;
    const fh = this.frame.realHeight;
    body.setOffset(fw / 2 - r, fh / 2 - r);

    // ⚠️ 这里只能 updateBounds(),绝不能 updateFromGameObject()。
    //
    //    setCircle 内部是 `width = radius*2 * _sx`,而 `_sx` 是**上一次**
    //    updateBounds 缓存的缩放 —— 池里上一发若是 1.55 倍的化魔指,这一发的
    //    碰撞圆就会按那个缩放算错。updateBounds 重算 width/halfWidth,且
    //    **不碰 position**;而 updateFromGameObject 会顺手按**上一发的 offset**
    //    改写 position(= x + 旧offset - 原点),那个被污染的 position 随后被
    //    postUpdate 写回精灵 —— 表现就是刚出手的弹在下一个物理步之前被挪走,
    //    实测落在 2 倍坐标上、离玩家好几千像素。
    //    「法术起点必须是人物当前位置」这条就是被那一行弄坏的。
    body.updateBounds();
    body.setVelocity(Math.cos(angle) * speed, Math.sin(angle) * speed);
  }

  preUpdate(time: number, delta: number): void {
    super.preUpdate(time, delta);
    if (!this.active) return;
    // lifeMs 走场景时钟。physics.world.pause() 不会停 preUpdate,
    // 不拦截的话飞行中的弹会在玩家读悟道面板时凭空过期。
    if (this.scene.physics.world.isPaused) return;
    if (this.isDead || time - this.bornAt > this.lifeMs) {
      this.kill();
    }
  }

  kill(): void {
    this.isDead = true;
    this.onImpact = null;
    this.status = {};
    this.setActive(false).setVisible(false);
    const body = this.body as Phaser.Physics.Arcade.Body;
    body.enable = false;
    body.setVelocity(0, 0);
  }

  /**
   * 命中之后消耗一次穿透。
   *
   * 只有穿透用尽才死 —— 寂灭指 3 道指气 ×6 穿透是它唯一的输出方式,
   * 打死一次就没了这条线的存在意义。
   */
  onHitEnemy(): void {
    // 火海沿途每一段都该炸,不只是第一次
    this.onImpact?.(this.x, this.y);
    this.pierceLeft--;
    if (this.pierceLeft < 0) this.kill();
  }
}

/** 供 GameScene 绑定伤害回调时用的窄类型 */
export type ProjectileDamageFn = DamageApplier;