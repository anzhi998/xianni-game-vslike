import Phaser from 'phaser';
import { findNearestEnemy } from '../../utils/Targeting';
import type { Enemy } from '../Enemy';
import type { DamageApplier, DamageOptions } from '../../types';

/**
 * 雷弧 —— 五雷正法的瞬时连锁
 *
 * 一次释放的结算**全部发生在 setup() 那一瞬间**:从最近的目标起,
 * 每次弹射跳到跳跃距离内最近的、还没被打过的新目标,伤害逐跳乘 falloff。
 * 视觉上的折线留在场上一小会儿淡出,只是为了让人看得见「刚才那条弧」。
 *
 * 为什么必须瞬时而不是发射一颗会飞的弹:
 *   - 五雷正法全体系**没有任何控制**,它的强度完全来自「怪群密度」,
 *     一颗飞行中的弹在密集怪群里只能打到一颗,连锁永远只有一跳;
 *   - 它与火球术的差异就在这:火球有落点、空间上可躲,五雷没有落点、躲不掉。
 *
 * 不使用 tween(池化对象带 tween 会跨存活期),折线用 Graphics 画,
 * 透明度在 preUpdate 里递减。
 */
export class ChainBolt extends Phaser.GameObjects.Container {
  public isDead = false;

  private gfx: Phaser.GameObjects.Graphics;
  private enemyGroup!: Phaser.GameObjects.Group;
  private applyDamage!: DamageApplier;

  private lifeMs = 180;
  private elapsedMs = 0;
  /** 雷弧折线的顶点(世界坐标) */
  private points: number[] = [];
  private color = 0x88ccff;
  /** 本次释放打中过的目标。天雷引只认它们 */
  public shocked = new Set<Enemy>();

  constructor(scene: Phaser.Scene) {
    super(scene, 0, 0);
    this.gfx = scene.add.graphics();
    this.add([this.gfx]);
    scene.add.existing(this);
    this.setActive(false).setVisible(false);
    this.setDepth(95);
  }

  bind(enemyGroup: Phaser.GameObjects.Group, apply: DamageApplier): void {
    this.enemyGroup = enemyGroup;
    this.applyDamage = apply;
  }

  /**
   * 释放一道雷弧。
   *
   * @param arcs   本次释放打几道(五雷正法 8 级是 3 道,五雷轰顶是 4 道)
   * @param jumpDamage 首目标伤害;后续每跳乘 falloff
   * @param shock  命中后给目标叠的感电。0 层表示这一发不带感电
   */
  setup(
    originX: number,
    originY: number,
    arcs: number,
    firstDamage: number,
    jumps: number,
    jumpRange: number,
    falloff: number,
    shockStacks: number,
    shockMs: number,
    color: number,
    status: DamageOptions,
    lifeMs: number,
  ): void {
    this.color = color;
    this.lifeMs = lifeMs;
    this.elapsedMs = 0;
    this.isDead = false;
    this.points.length = 0;
    this.shocked.clear();

    const hitSet = new Set<Enemy>();
    for (let a = 0; a < Math.max(1, arcs); a++) {
      // 每道弧从玩家重新起跳:多道弧意味着「一次锁定几个目标」,
      // 而不是「一条弧跳两倍远」
      let srcX = originX;
      let srcY = originY;
      let dmg = firstDamage;

      for (let j = 0; j <= jumps; j++) {
        const target = findNearestEnemy(this.enemyGroup, srcX, srcY, jumpRange, hitSet);
        if (!target) break;
        hitSet.add(target);
        this.shocked.add(target);
        this.points.push(srcX, srcY, target.x, target.y);
        this.applyDamage(target, dmg, target.x, target.y - 10, {
          ...status,
          element: 'thunder',
          shock: shockStacks > 0 ? { stacks: shockStacks, ms: shockMs } : null,
        });
        srcX = target.x;
        srcY = target.y;
        dmg *= falloff;
      }
    }

    this.setActive(true).setVisible(true);
    this.setPosition(0, 0);
    this.setAlpha(1);
    this.redraw();
  }

  /** 把世界坐标折线画成一层容器:容器在原点,顶点用世界坐标,免去逐帧同步位置 */
  private redraw(): void {
    const g = this.gfx;
    g.clear();
    const p = this.points;
    if (p.length < 4) return;

    // 外层辉光 + 内层亮芯,两道线才像「电弧」而不是「绳子」
    for (const [w, a, c] of [[7, 0.35, this.color], [2, 1, 0xffffff]] as const) {
      g.lineStyle(w, c, a);
      g.beginPath();
      g.moveTo(p[0], p[1]);
      for (let i = 2; i < p.length; i += 2) {
        // 折线中点加一个随机偏移 —— 直线的锯齿不像闪电
        const jx = (Math.random() - 0.5) * 14;
        const jy = (Math.random() - 0.5) * 14;
        g.lineTo((p[i] + p[i - 2]) / 2 + jx, (p[i + 1] + p[i - 1]) / 2 + jy);
        g.lineTo(p[i], p[i + 1]);
      }
      g.strokePath();
    }
  }

  preUpdate(_time: number, delta: number): void {
    if (!this.active) return;
    if (this.scene.physics.world.isPaused) return;
    this.elapsedMs += delta;
    const t = this.elapsedMs / this.lifeMs;
    this.setAlpha(Math.max(0, 1 - t));
    if (t >= 1) this.kill();
  }

  kill(): void {
    this.isDead = true;
    this.gfx.clear();
    this.points.length = 0;
    this.shocked.clear();
    this.setActive(false).setVisible(false);
  }
}