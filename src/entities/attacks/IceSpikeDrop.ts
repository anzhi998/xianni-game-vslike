import Phaser from 'phaser';
import { forEachEnemyInRadius } from '../../utils/AreaDamage';
import type { Enemy } from '../Enemy';
import type { DamageApplier, DamageOptions } from '../../types';

/**
 * 黄泉升窍诀 —— 面前依次落下的冰锥
 *
 * 一次施放 = 一个容器管住本次**全部道数**:道序 i 的落点在面向上
 * 「首距 + i × 间距」处,依次亮预警圈(impactDelayMs)→ 坠锥(FALL_MS)→ 炸圈。
 * 道与道之间错开 staggerMs,画面上读作「一串冰锥从近到远接力砸下」。
 *
 * ⚠️ **单怪一次施放只吃 1 道**。三道满级半径 1.0 格的炸圈沿同一条线排开,
 *    而间距只有 1.6 格 < 直径 2.0 格,圆必然互相咬边 —— 若不去重,站在线上
 *    的怪会连吃 3 发,单体 DPS 按「吃满 3 道」翻三倍,把配表口径
 *    (群口径 4 × 40 ÷ 1.60 = 100)直接打爆。去重表建在**本次施放**上,
 *    与 Tornado 的 sharedHits 同一手法;下一次施放重新记账。
 *
 * ⚠️ 半径从 0.8 格上调到 1.0 格时,**这条去重是唯一让「只加范围」成立的前提** ——
 *    半径一涨,咬边更深,覆盖面变宽但单体仍只吃 1 道。若哪天有人为了「让圈更大」
 *    把去重去掉,这条线的群口径会立刻从 100 变成 300 量级。
 *
 * ## 不使用 tween
 *
 * 池化对象带 tween 会跨存活期触发(见 CLAUDE.md)。全部阶段用 preUpdate 里的
 * elapsedMs 计时 + Graphics 重画,与 SandWave 同一套纪律。
 */
export class IceSpikeDrop extends Phaser.GameObjects.Container {
  public isDead = false;

  /** 冰锥从圈顶坠到地面的时长。纯演出 —— 伤害在触地那一帧结算 */
  private static readonly FALL_MS = 180;
  /** 炸圈亮起后淡出的时长,随后整个容器归还池 */
  private static readonly BLAST_MS = 160;
  /** 坠落起点距地面的高度(px):足够高才读得出「从天上掉下来」 */
  private static readonly DROP_HEIGHT = 110;

  private gfx: Phaser.GameObjects.Graphics;
  private enemyGroup!: Phaser.GameObjects.Group;
  private applyDamage!: DamageApplier;

  private damage = 0;
  private radius = 48;
  private telegraphMs = 400;
  private color = 0x59d9a0;
  private status: DamageOptions = {};
  private elapsedMs = 0;
  /** 本次施放的去重表。setup 里清空 —— 它只活一次施放 */
  private hitSet = new Set<Enemy>();
  private spikes: Array<{ x: number; y: number; delayMs: number; landed: boolean }> = [];

  constructor(scene: Phaser.Scene) {
    super(scene, 0, 0);
    this.gfx = scene.add.graphics();
    this.add([this.gfx]);
    scene.add.existing(this);
    this.setActive(false).setVisible(false);
    // 预警圈贴地(与沙浪同层),锥体压在怪与预警圈之上
    this.setDepth(79);
  }

  bind(enemyGroup: Phaser.GameObjects.Group, apply: DamageApplier): void {
    this.enemyGroup = enemyGroup;
    this.applyDamage = apply;
  }

  setup(
    x: number,
    y: number,
    facing: number,
    count: number,
    damage: number,
    radiusPx: number,
    gapPx: number,
    firstOffsetPx: number,
    telegraphMs: number,
    staggerMs: number,
    color: number,
    status: DamageOptions = {},
  ): void {
    this.damage = damage;
    this.radius = radiusPx;
    this.telegraphMs = telegraphMs;
    this.color = color;
    this.status = status;
    this.elapsedMs = 0;
    this.hitSet.clear();
    this.isDead = false;

    // 落点在 setup 里一次算死:施放瞬间锁定,玩家面向之后怎么变都不影响这一轮
    this.spikes = [];
    for (let i = 0; i < count; i++) {
      const d = firstOffsetPx + i * gapPx;
      this.spikes.push({
        x: x + Math.cos(facing) * d,
        y: y + Math.sin(facing) * d,
        delayMs: i * staggerMs,
        landed: false,
      });
    }

    this.setActive(true).setVisible(true);
    this.setPosition(0, 0);
    this.setAlpha(1);
    this.draw();
  }

  preUpdate(_time: number, delta: number): void {
    if (!this.active) return;
    if (this.scene.physics.world.isPaused) return;

    this.elapsedMs += delta;

    for (const s of this.spikes) {
      if (!s.landed && this.elapsedMs >= s.delayMs + this.telegraphMs + IceSpikeDrop.FALL_MS) {
        s.landed = true;
        this.burst(s.x, s.y);
      }
    }
    this.draw();

    const last = this.spikes[this.spikes.length - 1];
    const totalMs = (last ? last.delayMs : 0) + this.telegraphMs + IceSpikeDrop.FALL_MS + IceSpikeDrop.BLAST_MS;
    if (this.elapsedMs >= totalMs) this.kill();
  }

  /** 触地炸圈。去重在这层做:同一只怪一次施放只结算 1 道 */
  private burst(x: number, y: number): void {
    forEachEnemyInRadius(this.enemyGroup, x, y, this.radius, (e) => {
      if (this.hitSet.has(e)) return;
      this.hitSet.add(e);
      this.applyDamage(e, this.damage, e.x, e.y - 8, this.status);
    });
  }

  /**
   * 每帧重画全部道数的当前阶段。
   *
   * 三段式:预警圈(由松到紧)→ 坠锥(从 DROP_HEIGHT 落下)→ 炸圈(外扩淡出)。
   * 全部画在一个 Graphics 里,帧成本与道数线性、与怪数无关。
   */
  private draw(): void {
    const g = this.gfx;
    g.clear();

    for (const s of this.spikes) {
      const phase = this.elapsedMs - s.delayMs;

      // 预警圈:全程保留,炸圈阶段随之淡出
      if (phase < this.telegraphMs + IceSpikeDrop.FALL_MS) {
        const p = Math.min(1, phase / this.telegraphMs);
        // 圈由大收到锁定半径:收紧的圈比渐亮的圈更能读出「这里要炸」
        g.lineStyle(2, this.color, 0.35 + 0.45 * p);
        g.strokeCircle(s.x, s.y, this.radius * (1.25 - 0.25 * p));
        g.lineStyle(1, this.color, 0.25 * p);
        g.strokeCircle(s.x, s.y, this.radius * 0.5);
      }

      if (phase < this.telegraphMs) continue;

      if (phase < this.telegraphMs + IceSpikeDrop.FALL_MS) {
        // 坠锥:一枚竖直的冰凌从圈顶上方砸向落点
        const fp = (phase - this.telegraphMs) / IceSpikeDrop.FALL_MS;
        const sy = s.y - IceSpikeDrop.DROP_HEIGHT * (1 - fp);
        const len = 34;
        const wid = 7;
        g.fillStyle(0xdfffee, 0.95);
        g.fillPoints([
          new Phaser.Geom.Point(s.x - wid, sy - len * 0.4),
          new Phaser.Geom.Point(s.x, sy - len),
          new Phaser.Geom.Point(s.x + wid, sy - len * 0.4),
          new Phaser.Geom.Point(s.x, sy + len * 0.2),
        ], true);
        g.fillStyle(this.color, 0.5);
        g.fillCircle(s.x, s.y, this.radius * 0.35 * fp);
        continue;
      }

      // 炸圈:实心闪光 + 外扩的环,一起淡出
      const bp = (phase - this.telegraphMs - IceSpikeDrop.FALL_MS) / IceSpikeDrop.BLAST_MS;
      if (bp < 1) {
        g.fillStyle(this.color, 0.35 * (1 - bp));
        g.fillCircle(s.x, s.y, this.radius);
        g.lineStyle(3, 0xdfffee, 0.85 * (1 - bp));
        g.strokeCircle(s.x, s.y, this.radius * (1 + 0.22 * bp));
      }
    }
  }

  kill(): void {
    this.isDead = true;
    this.gfx.clear();
    this.setActive(false).setVisible(false);
  }
}
