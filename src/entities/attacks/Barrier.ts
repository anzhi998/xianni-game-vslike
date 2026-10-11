import Phaser from 'phaser';
import type { Enemy } from '../Enemy';
import type { DamageApplier } from '../../types';

/**
 * 崩墙 —— 山崩地裂在扇面末端隆起的弧形阻挡带
 *
 * 它是**阻挡带,不是伤害区**:敌人被挡住,玩家与玩家的弹道可自由穿过。
 * 被推上墙的敌人额外吃一次撞墙伤害并眩晕 0.6 秒 ——
 * 全体系唯一的硬控(通用遗物「定身术」占的是概率定身,那不算硬控)。
 *
 * ## 阻挡是怎么做的
 *
 * 不做寻路,只做**速度抵消**:EnemyAiSystem 写完追猎速度之后(第二遍),
 * 逐个敌人查它是不是「正朝墙里走」。是就把该方向的速度分量清零,
 * 于是它贴着墙滑动。听起来粗糙,但它对这类玩法已经足够:
 * 厚土术的价值是「把怪挤成一坨」,而挤成一坨只需要它们不再前进。
 *
 * 玩家与弹道完全不受影响 —— 它们根本不查这道墙,这也是设计书
 * 「土墙是阻挡带」在代码里的落点。
 */
export class Barrier extends Phaser.GameObjects.Container {
  public isDead = false;

  /** 墙心(世界坐标) */
  public cx = 0;
  public cy = 0;
  /** 墙的半径 */
  public radius = 200;
  /** 覆盖的角度区间 */
  public facing = 0;
  public span = 0;
  /** 墙的厚度:敌人距墙心落在 ±thickness 内即视为「在墙上」 */
  public thickness = 26;

  private gfx: Phaser.GameObjects.Graphics;
  private applyDamage!: DamageApplier;

  private lifeMs = 3000;
  private elapsedMs = 0;
  private color = 0x8a6a3a;
  private damage = 40;
  private stunMs = 600;
  private riseMs = 220;
  /** 每只怪被撞一次的冷却 —— 不设的话一只贴着墙被持续推的怪会每帧掉一次血 */
  private hitCooldown = new Map<Enemy, number>();

  constructor(scene: Phaser.Scene) {
    super(scene, 0, 0);
    this.gfx = scene.add.graphics();
    this.add([this.gfx]);
    scene.add.existing(this);
    this.setActive(false).setVisible(false);
    this.setDepth(60);
  }

  bind(_enemyGroup: Phaser.GameObjects.Group, apply: DamageApplier): void {
    this.applyDamage = apply;
  }

  setup(
    cx: number,
    cy: number,
    radius: number,
    facing: number,
    span: number,
    lifeMs: number,
    damage: number,
    stunMs: number,
    color: number,
  ): void {
    this.cx = cx;
    this.cy = cy;
    this.radius = radius;
    this.facing = facing;
    this.span = span;
    this.lifeMs = lifeMs;
    this.damage = damage;
    this.stunMs = stunMs;
    this.color = color;
    this.elapsedMs = 0;
    this.isDead = false;
    this.hitCooldown.clear();

    this.setActive(true).setVisible(true);
    // 容器放在墙心,Graphics 用局部坐标画 —— 这样增删墙体不用重算每个顶点的世界坐标
    this.setPosition(cx, cy);
    this.setAlpha(1);
    this.draw(0);
  }

  /** 敌人 (x,y) 是否落在这道墙覆盖的环带里 */
  contains(x: number, y: number): boolean {
    const dx = x - this.cx;
    const dy = y - this.cy;
    const d = Math.hypot(dx, dy);
    if (Math.abs(d - this.radius) > this.thickness) return false;
    if (d === 0) return true;
    let diff = Math.atan2(dy, dx) - this.facing;
    while (diff > Math.PI) diff -= Math.PI * 2;
    while (diff < -Math.PI) diff += Math.PI * 2;
    return Math.abs(diff) <= this.span / 2 + 0.05;
  }

  /**
   * 把「正朝墙里走」的敌人挡在墙外,并结算撞墙。
   *
   * @returns 是否实际阻挡/结算了。调用方是 EnemyAiSystem 的第二遍
   */
  block(enemy: Enemy, now: number): boolean {
    if (!enemy.active || enemy.isDead) return false;
    if (!this.contains(enemy.x, enemy.y)) return false;

    const body = enemy.body as Phaser.Physics.Arcade.Body;
    const dx = enemy.x - this.cx;
    const dy = enemy.y - this.cy;
    const d = Math.hypot(dx, dy) || 1;
    // 墙的外法线:指向远离墙心的一侧
    const nx = dx / d;
    const ny = dy / d;
    // 正在朝墙里走(速度与外法线反向)才需要拦
    const into = body.velocity.x * nx + body.velocity.y * ny;
    const moving = Math.abs(body.velocity.x) + Math.abs(body.velocity.y) > 1;
    if (!moving || into >= 0) return false;

    // 抵消朝墙的分量,保留沿墙滑动的分量 —— 怪会沿着墙滑而不是黏住
    body.setVelocity(body.velocity.x - into * nx, body.velocity.y - into * ny);

    const last = this.hitCooldown.get(enemy) ?? 0;
    if (now < last + 400) return true;
    this.hitCooldown.set(enemy, now);

    // Boss / 精英撞墙伤害减半:推挤流不该直接破坏 Boss 战设计
    const scale = enemy.isElite ? 0.5 : 1;
    this.applyDamage(enemy, this.damage * scale, enemy.x, enemy.y - 10);
    enemy.stun(this.stunMs * scale, now);
    return true;
  }

  preUpdate(_time: number, delta: number): void {
    if (!this.active) return;
    if (this.scene.physics.world.isPaused) return;
    this.elapsedMs += delta;
    const t = Math.min(1, this.elapsedMs / this.lifeMs);
    this.draw(t);
    if (t >= 1) this.kill();
  }

  /** 隆起 → 稳定 → 塌落。塌落用碎块感的多边形,而不是整体淡出 */
  private draw(t: number): void {
    const g = this.gfx;
    g.clear();
    const rise = Math.min(1, t / (this.riseMs / this.lifeMs));
    const fade = t > 0.8 ? Math.max(0, (1 - t) / 0.2) : 1;
    const r = this.radius;
    const half = this.span / 2;

    g.fillStyle(this.color, 0.85 * rise * fade);
    g.beginPath();
    g.arc(0, 0, r, this.facing - half, this.facing + half, false);
    g.arc(0, 0, r - this.thickness, this.facing + half, this.facing - half, true);
    g.closePath();
    g.fillPath();

    g.lineStyle(2, 0xd8b070, 0.8 * rise * fade);
    g.beginPath();
    g.arc(0, 0, r, this.facing - half, this.facing + half, false);
    g.strokePath();
  }

  kill(): void {
    this.isDead = true;
    this.gfx.clear();
    this.hitCooldown.clear();
    this.setActive(false).setVisible(false);
  }
}