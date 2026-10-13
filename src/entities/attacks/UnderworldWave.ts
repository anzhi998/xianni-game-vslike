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
   * 推进段(7 层叠加,从底到顶):
   *   1. 浪体实体 —— 整片矩形的低 alpha 填色,推进过程中透明度小幅衰减;
   *   2. 浪体高光(上半段偏冷的光带) —— 让水面读出方向感;
   *   3. 前沿的「冲击弧」—— 一道亮色 capstone 弧线,模拟波前水体堆起的弧;
   *   4. **波前后的暗带**(front-12 处)—— 推进的「厚度」;
   *   5. **波前卷起的浪花**(front 处一对泪滴,朝外)—— 告诉玩家水从脚下喷过来;
   *   6. **水面反光**(顶部一条亮色 line)—— 给水面「流」感;
   *   7. **两侧稍退**(底部 -half 与 half 一条深色边)—— 让矩形像水而不是木条。
   *
   * 残留段:整片水洼匀速淡出,矩形内保留一道水面 highlight,框是软边粗描。
   *
   * 与 SandWave 同源的「**推进 vs 残留两段 + 推进段三层(底色 / 主线 / 亮弧)**」
   * 设计语言:沙浪用扇面 slice,这里用矩形 fillRect,层数与命名都对齐,
   * 这样以后看代码就能认出「这是水浪版不是沙浪版」。
   */
  private draw(): void {
    const g = this.gfx;
    const half = this.widthPx / 2;
    g.clear();

    if (this.elapsedMs <= this.frontMs) {
      const t = this.elapsedMs / this.frontMs;
      const front = this.lengthPx * t;
      const alpha = 1 - t * 0.25;
      const color = this.color;
      // 亮芯(白偏水蓝):底色 + 提亮后的高光色
      const hi = 0xbfffe8;
      // 阴面色:把底色压暗一档,做上沿/底沿与浪花描边
      const lo = 0x0c382a;

      /* 1. 浪体实体(整片矩形低 alpha 填色) */
      g.fillStyle(color, 0.32 * alpha);
      g.fillRect(0, -half, Math.max(0.0001, front), this.widthPx);

      /* 2. 浪体高光带(上半段 1/3 处的冷光带) */
      g.fillStyle(hi, 0.18 * alpha);
      g.fillRect(0, -half, Math.max(0.0001, front), this.widthPx * 0.32);

      /* 3. 上沿亮边 + 底沿暗线(让矩形像水而不是木条) */
      g.lineStyle(2, hi, 0.55 * alpha);
      g.lineBetween(0, -half, front, -half);
      g.lineStyle(2, lo, 0.45 * alpha);
      g.lineBetween(0, half, front, half);

      /* 4. 波前后的暗带(前沿后 12px 处一道浅主线,推一下「厚度」) */
      const trailX = Math.max(0, front - 14);
      g.lineStyle(2, color, 0.55 * alpha);
      g.lineBetween(trailX, -half, trailX, half);

      /* 5. 波前的水面反光线(顶边一道更亮的 line) */
      g.lineStyle(1, hi, 0.85 * alpha);
      g.lineBetween(Math.max(0, front - 6), -half + 1, front, -half + 1);

      /* 6. 冲击弧:波前 caps a «Δ» 形 —— 上下两道粗亮线 + 一段弧,
            让水从脚下腾起的同时还能看见「翻过来的波顶」 */
      // 6a. 上沿亮边增厚 + 反白
      g.lineStyle(4, hi, 0.95 * alpha);
      g.lineBetween(front, -half, front, half);
      // 6b. 波前中央往外鼓一道小弧(模拟水头卷起的反射)
      const brimR = Math.min(this.widthPx * 0.42, half * 1.05);
      g.lineStyle(3, hi, 0.80 * alpha);
      g.beginPath();
      g.arc(front, 0, brimR, -Math.PI / 2, Math.PI / 2, false);
      g.strokePath();

      /* 7. 浪花:波前上下沿各一对泪滴(朝外),给水「飞起来」的瞬间 */
      const foamLen = Math.min(this.widthPx * 0.55, half * 1.4);
      // 上泪滴
      g.fillStyle(hi, 0.85 * alpha);
      g.fillTriangle(
        front, -half - 1,
        front + foamLen * 0.55, -half - 1 - foamLen * 0.35,
        front + foamLen * 0.30, -half - 1,
      );
      // 下泪滴
      g.fillTriangle(
        front, half + 1,
        front + foamLen * 0.55, half + 1 + foamLen * 0.35,
        front + foamLen * 0.30, half + 1,
      );
      // 浪花碎点:上下各 2 颗小水珠(沿前沿往后撒)
      g.fillStyle(0xffffff, 0.70 * alpha);
      g.fillCircle(front - foamLen * 0.20, -half - 3, 1.2);
      g.fillCircle(front - foamLen * 0.45, -half - 6, 0.9);
      g.fillCircle(front - foamLen * 0.20, half + 3, 1.2);
      g.fillCircle(front - foamLen * 0.45, half + 6, 0.9);
      g.fillCircle(front + foamLen * 0.15, -half + 2, 0.8);
      g.fillCircle(front + foamLen * 0.15, half - 2, 0.8);
    } else {
      // 残留水洼:整片矩形匀速淡出
      const t2 = Math.min(1, (this.elapsedMs - this.frontMs) / Math.max(1, this.lingerMs));
      const alpha = 1 - t2;
      const color = this.color;
      const hi = 0xbfffe8;
      const lo = 0x0c382a;
      const L = this.lengthPx;

      /* 洼体整片:同色但更淡 */
      g.fillStyle(color, 0.18 * alpha);
      g.fillRect(0, -half, L, this.widthPx);

      /* 顶沿水面 highlight:让水洼读出「这是一片浅水」 */
      g.fillStyle(hi, 0.22 * alpha);
      g.fillRect(0, -half, L, Math.max(2, this.widthPx * 0.18));

      /* 软边粗框:上下沿各描一道,左右边界不封口
            —— 让水洼的边往外晕,而不像一块平板 */
      g.lineStyle(3, hi, 0.45 * alpha);
      g.lineBetween(0, -half, L, -half);
      g.lineStyle(2, lo, 0.35 * alpha);
      g.lineBetween(0, half, L, half);

      /* 水洼中段一道主水纹 —— 给水洼一个"流心"读出水量 */
      g.lineStyle(2, color, 0.55 * alpha);
      g.lineBetween(L * 0.08, 0, L * 0.92, 0);
      // 中段再补一道反光
      g.lineStyle(1, hi, 0.55 * alpha);
      g.lineBetween(L * 0.12, -half * 0.4, L * 0.88, -half * 0.4);

      /* 收尾的边变暗:让半透的水更接近「干涸的痕迹」 */
      g.lineStyle(1, lo, 0.30 * alpha);
      g.lineBetween(L * 0.92, -half, L, -half);
      g.lineBetween(L * 0.92, half, L, half);
    }
  }

  kill(): void {
    this.isDead = true;
    this.gfx.clear();
    this.setActive(false).setVisible(false);
  }
}
