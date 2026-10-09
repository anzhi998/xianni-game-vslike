import Phaser from 'phaser';
import type { Player } from './Player';
import { TIDE } from '../config/MechanismConfig';

/**
 * 血海上涌 —— 机制怪里唯一的「地形」威胁(怪物设计文档第四节)
 *
 * 屏幕下方升起一道持续伤害的魔气平面,缓慢上推,把可用面积临时砍掉一半。
 * **它是屏幕空间而不是世界空间**:写在世界坐标里,玩家只要往南跑就能甩掉它,
 * 那样它就不再是「唯一无法靠输出来解决」的那一类威胁了。
 * 屏幕空间下,「向上逃」是唯一正确的动作 —— 因为潮面永远压在你的视野下方。
 *
 * 池化约定与其他实体一致:setup 复位全部状态、kill 关掉自己、
 * preUpdate 带暂停守卫(否则玩家读升级面板时血海会继续上推)。
 */
export class BloodTide extends Phaser.GameObjects.Graphics {
  public isDead = false;

  private getPlayer: () => Player = () => null as unknown as Player;
  private damagePlayer: (amount: number, sx: number, sy: number) => void = () => {};

  /** 潮面当前高度(屏幕坐标 y,从上往下) */
  private topY = 0;
  /** 上推目标高度 */
  private targetTop = 0;
  private elapsedMs = 0;
  private phase: 'rise' | 'hold' | 'recede' = 'rise';
  private nextTickAt = 0;

  constructor(scene: Phaser.Scene) {
    // ⚠️ 直接继承 Graphics 而不是 Container:scrollFactor 只有 Transform 带得动,
    // 而 **Container 没有 ScrollFactor 组件** —— 写成 Container + setScrollFactor(0)
    // 会在第一次上涌时抛 TypeError。Graphics 自己就带 ScrollFactor
    super(scene);
    scene.add.existing(this);
    // 固定在屏幕上,并压在敌人之上、玩家之下 —— 它是「视野里的地形」
    this.setScrollFactor(0);
    this.setDepth(85);
    this.setActive(false).setVisible(false);
  }

  bind(getPlayer: () => Player, damagePlayer: (amount: number, sx: number, sy: number) => void): void {
    this.getPlayer = getPlayer;
    this.damagePlayer = damagePlayer;
  }

  setup(): void {
    const cam = this.scene.cameras.main;
    this.topY = cam.height;
    this.targetTop = cam.height * TIDE.topFraction;
    this.elapsedMs = 0;
    this.phase = 'rise';
    this.nextTickAt = 0;
    this.isDead = false;
    this.setActive(true).setVisible(true);
    this.clear();
    this.draw();
  }

  preUpdate(time: number, delta: number): void {
    if (!this.active) return;
    if (this.scene.physics.world.isPaused) return;

    const cam = this.scene.cameras.main;
    this.elapsedMs += delta;

    // 三段:上推 → 维持 → 退去。退去之后自己回收
    if (this.phase === 'rise') {
      const t = Math.min(1, this.elapsedMs / TIDE.riseMs);
      this.topY = cam.height + (this.targetTop - cam.height) * t;
      if (t >= 1) {
        this.phase = 'hold';
        this.elapsedMs = 0;
      }
    } else if (this.phase === 'hold') {
      this.topY = this.targetTop;
      if (this.elapsedMs >= TIDE.holdMs) {
        this.phase = 'recede';
        this.elapsedMs = 0;
      }
    } else {
      const t = Math.min(1, this.elapsedMs / TIDE.recedeMs);
      this.topY = this.targetTop + (cam.height - this.targetTop) * t;
      if (t >= 1) {
        this.kill();
        return;
      }
    }

    // 伤害判定:把玩家换算到屏幕坐标再比 —— 潮面是屏幕空间的,两者必须在同一坐标系里
    const player = this.getPlayer();
    if (player && player.active && !player.isDead()) {
      const screenY = player.y - cam.scrollY;
      if (screenY > this.topY && time >= this.nextTickAt) {
        this.nextTickAt = time + TIDE.tickMs;
        this.damagePlayer(TIDE.damage, player.x, player.y);
      }
    }

    this.draw();
  }

  private draw(): void {
    const cam = this.scene.cameras.main;
    const g = this;
    g.clear();

    // 三层墨色:越往下越浓,让潮面看起来有厚度
    const depth = cam.height - this.topY;
    if (depth <= 0) return;
    for (let i = 0; i < 3; i++) {
      g.fillStyle(0x5a0a12, 0.55 - i * 0.12);
      g.fillRect(0, this.topY + (depth * i) / 3, cam.width, depth / 3 + 1);
    }

    // 潮头:一排起伏的暗红浪尖,让它读起来像「正在上涌」而不是一块 UI 面板
    const wave = this.scene.time.now / 260;
    g.fillStyle(0xaa2233, 0.8);
    for (let x = 0; x <= cam.width; x += 16) {
      const h = 8 + Math.sin(x * 0.045 + wave) * 5 + Math.sin(x * 0.013 - wave * 0.6) * 3;
      g.fillRect(x, this.topY - h, 16, h + 2);
    }
  }

  kill(): void {
    this.isDead = true;
    this.setActive(false).setVisible(false);
    this.clear();
  }
}
