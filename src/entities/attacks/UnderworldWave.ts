import Phaser from 'phaser';
import { forEachEnemyInRect } from '../../utils/AreaDamage';
import type { Enemy } from '../Enemy';
import type { DamageApplier, DamageOptions } from '../../types';

/**
 * 道化黄泉 —— 面前涌出的长方形水浪
 *
 * 两段式生命周期:
 *
 *   前沿推进(waveFrontMs)—— 浪前从脚下推到最远端,被压过的敌人**各结算一次**
 *     (去重表建在本次施放上)。矩形从施放点贴边向前延伸,与画出来的浪严格同形。
 *
 *   残留水洼(waveLingerMs)—— 浪过之处留下水洼,**只减速不伤**:洼内敌人
 *     每 SLOW_TICK_MS 被刷一次减速(与命中减速同源同值)。伤害区生态是
 *     火海的,这里只负责把残敌按在浪里。
 *
 * ## 矩形怎么画
 *
 * Container 整体 rotate 到 facing,浪体在**局部坐标**里就是一个
 * (0..length, -half..half) 的普通矩形 —— Graphics 画矩形不用自己算四角。
 * 判定则用世界坐标走 forEachEnemyInRect(投影法),两边同形不同源,
 * 靠同一组 length/width 参数对齐。
 *
 * ## 不使用 tween
 *
 * 与 SandWave / IceSpikeDrop 同一条纪律:池化对象一律 preUpdate 计时,
 * tween 会跨存活期触发。
 */
export class UnderworldWave extends Phaser.GameObjects.Container {
  public isDead = false;

  /** 残留期给洼内敌人刷减速的间隔。刷新而非常驻:慢走速的怪不靠帧级轮询 */
  private static readonly SLOW_TICK_MS = 400;

  private gfx: Phaser.GameObjects.Graphics;
  private enemyGroup!: Phaser.GameObjects.Group;
  private applyDamage!: DamageApplier;

  private facing = 0;
  private damage = 0;
  private lengthPx = 0;
  private widthPx = 0;
  private frontMs = 0;
  private lingerMs = 0;
  private color = 0x39b98a;
  private status: DamageOptions = {};
  private elapsedMs = 0;
  private nextSlowTickAt = 0;
  /** 本次施放的去重表:前沿只把每只怪压过一次 */
  private hitSet = new Set<Enemy>();

  constructor(scene: Phaser.Scene) {
    super(scene, 0, 0);
    this.gfx = scene.add.graphics();
    this.add([this.gfx]);
    scene.add.existing(this);
    this.setActive(false).setVisible(false);
    // 与沙浪同层:贴地的水,不遮怪
    this.setDepth(78);
  }

  bind(enemyGroup: Phaser.GameObjects.Group, apply: DamageApplier): void {
    this.enemyGroup = enemyGroup;
    this.applyDamage = apply;
  }

  setup(
    x: number,
    y: number,
    facing: number,
    damage: number,
    lengthPx: number,
    widthPx: number,
    frontMs: number,
    lingerMs: number,
    color: number,
    status: DamageOptions = {},
  ): void {
    this.facing = facing;
    this.damage = damage;
    this.lengthPx = lengthPx;
    this.widthPx = widthPx;
    this.frontMs = frontMs;
    this.lingerMs = lingerMs;
    this.color = color;
    this.status = status;
    this.elapsedMs = 0;
    this.nextSlowTickAt = 0;
    this.hitSet.clear();
    this.isDead = false;

    this.setActive(true).setVisible(true);
    this.setPosition(x, y);
    this.setRotation(facing);
    this.setAlpha(1);
    this.draw();
  }

  preUpdate(time: number, delta: number): void {
    if (!this.active) return;
    if (this.scene.physics.world.isPaused) return;

    this.elapsedMs += delta;

    if (this.elapsedMs <= this.frontMs) {
      // 推进段:浪前扫到哪,伤害压到哪。hitSet 保证每只怪只吃一次
      const front = this.lengthPx * (this.elapsedMs / this.frontMs);
      forEachEnemyInRect(this.enemyGroup, this.x, this.y, this.facing, front, this.widthPx, (e) => {
        if (this.hitSet.has(e)) return;
        this.hitSet.add(e);
        this.applyDamage(e, this.damage, e.x, e.y - 8, this.status);
      });
    } else if (this.lingerMs > 0 && this.status.slow && this.status.slow.ms > 0) {
      // 残留段:水洼只减速,不伤。低频刷新,不做帧级轮询
      if (time >= this.nextSlowTickAt) {
        this.nextSlowTickAt = time + UnderworldWave.SLOW_TICK_MS;
        const slow = this.status.slow;
        forEachEnemyInRect(this.enemyGroup, this.x, this.y, this.facing, this.lengthPx, this.widthPx, (e: Enemy) => {
          e.applySlow(slow.mul, slow.ms, time);
        });
      }
    }

    this.draw();

    if (this.elapsedMs >= this.frontMs + this.lingerMs) this.kill();
  }

  /**
   * 局部坐标画浪:+x 沿面向、±y 为横向半宽。
   *
   * 推进段:已推进的部分画实、前沿一道亮边(玩家读得出浪走到哪);
   * 残留段:整片水洼随时间淡出。
   */
  private draw(): void {
    const g = this.gfx;
    const half = this.widthPx / 2;
    g.clear();

    if (this.elapsedMs <= this.frontMs) {
      const t = this.elapsedMs / this.frontMs;
      const front = this.lengthPx * t;
      const alpha = 1 - t * 0.25;

      // 浪体
      g.fillStyle(this.color, 0.30 * alpha);
      g.fillRect(0, -half, front, this.widthPx);
      // 前沿亮边
      g.lineStyle(4, 0xbfffe8, 0.90 * alpha);
      g.lineBetween(front, -half, front, half);
      // 前沿后一道渐淡的水纹,给推进一点「厚度」
      g.lineStyle(2, this.color, 0.55 * alpha);
      g.lineBetween(Math.max(0, front - 18), -half, Math.max(0, front - 18), half);
    } else {
      // 残留水洼:整片矩形匀速淡出
      const t2 = Math.min(1, (this.elapsedMs - this.frontMs) / Math.max(1, this.lingerMs));
      const alpha = 1 - t2;
      g.fillStyle(this.color, 0.16 * alpha);
      g.fillRect(0, -half, this.lengthPx, this.widthPx);
      g.lineStyle(2, this.color, 0.35 * alpha);
      g.strokeRect(0, -half, this.lengthPx, this.widthPx);
    }
  }

  kill(): void {
    this.isDead = true;
    this.gfx.clear();
    this.setActive(false).setVisible(false);
  }
}
