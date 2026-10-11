import Phaser from 'phaser';
import type { Player } from '../Player';

/**
 * 灵脉火柱 —— 朱雀星的环境机制「灵脉地热」
 *
 * 三段:预警圈 → 喷发 → 收尾。
 *
 * **预警圈是这个机制的全部意义**:它把「随机伤害」变成「走位题」。
 * 没有预警圈,火柱就只是随机扣血;有了 1.2 秒的圈,玩家可以主动选择
 * 「被逼到哪一侧」——这正是地图设计总原则第三条要的东西。
 *
 * 池化约定:setup() 重置全部字段,不用 tween。
 */
export class FireVent extends Phaser.GameObjects.Container {
  public isDead = false;

  private gfx: Phaser.GameObjects.Graphics;
  private getPlayer: () => Player = () => ({ x: 0, y: 0, isDead: () => false } as Player);
  private damagePlayer: (amount: number, x: number, y: number) => void = () => {};

  private radius = 78;
  private warnMs = 1200;
  private eruptMs = 1600;
  private tickMs = 500;
  private damage = 14;
  private color = 0xff5522;
  private elapsedMs = 0;
  private nextTickAt = 0;

  constructor(scene: Phaser.Scene) {
    super(scene, 0, 0);
    this.gfx = scene.add.graphics();
    this.add([this.gfx]);
    scene.add.existing(this);
    this.setActive(false).setVisible(false);
    this.setDepth(40);
  }

  bind(getPlayer: () => Player, damagePlayer: (amount: number, x: number, y: number) => void): void {
    this.getPlayer = getPlayer;
    this.damagePlayer = damagePlayer;
  }

  setup(
    x: number,
    y: number,
    radius: number,
    warnMs: number,
    eruptMs: number,
    tickMs: number,
    damage: number,
    color: number,
  ): void {
    this.radius = radius;
    this.warnMs = warnMs;
    this.eruptMs = eruptMs;
    this.tickMs = tickMs;
    this.damage = damage;
    this.color = color;
    this.elapsedMs = 0;
    this.nextTickAt = 0;
    this.isDead = false;

    this.setActive(true).setVisible(true);
    this.setPosition(x, y);
    this.draw(0);
  }

  preUpdate(time: number, delta: number): void {
    if (!this.active) return;
    if (this.scene.physics.world.isPaused) return;

    this.elapsedMs += delta;
    const t = this.elapsedMs / (this.warnMs + this.eruptMs);
    this.draw(t);

    const erupting = this.elapsedMs >= this.warnMs;
    if (erupting && time >= this.nextTickAt) {
      this.nextTickAt = time + this.tickMs;
      const p = this.getPlayer();
      const dx = p.x - this.x;
      const dy = p.y - this.y;
      // 判定用半径 + 玩家身位的一半,否则玩家「看着站在圈外」却被判在里面
      if (!p.isDead() && dx * dx + dy * dy <= (this.radius + 8) * (this.radius + 8)) {
        this.damagePlayer(this.damage, this.x, this.y);
      }
    }

    if (t >= 1) this.kill();
  }

  private draw(t: number): void {
    const g = this.gfx;
    g.clear();
    const warnT = Math.min(1, (t * (this.warnMs + this.eruptMs)) / this.warnMs);

    if (warnT < 1) {
      // 预警圈:由外向内收缩的一圈,收缩到底的那一刻喷发
      const r = this.radius * (1 + (1 - warnT) * 0.5);
      g.fillStyle(0xffffff, 0.06);
      g.fillCircle(0, 0, r);
      g.lineStyle(3, this.color, 0.35 + 0.5 * warnT);
      g.strokeCircle(0, 0, r);
      return;
    }

    // 喷发:一根升起的火柱 + 地面高亮
    const e = (t - warnT) / (1 - warnT);
    const fade = e > 0.75 ? Math.max(0, (1 - e) / 0.25) : 1;
    const h = 120 * (e < 0.2 ? e / 0.2 : 1) * fade;

    g.fillStyle(this.color, 0.28 * fade);
    g.fillCircle(0, 0, this.radius);
    g.fillStyle(0xffaa44, 0.5 * fade);
    g.fillRect(-this.radius * 0.35, -h, this.radius * 0.7, h);
    g.fillStyle(0xffee99, 0.7 * fade);
    g.fillRect(-this.radius * 0.18, -h, this.radius * 0.36, h);
    g.lineStyle(3, 0xffee99, 0.8 * fade);
    g.strokeCircle(0, 0, this.radius);
  }

  kill(): void {
    this.isDead = true;
    this.gfx.clear();
    this.setActive(false).setVisible(false);
  }
}