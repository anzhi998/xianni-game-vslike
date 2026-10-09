import Phaser from 'phaser';
import type { Enemy } from '../Enemy';

/**
 * 全场扫描环 —— 冻结几何
 *
 * 设计书对这一类的判词是「用来开窗口,不靠它输出」。
 * 所以它**完全不造成伤害**,只在持续期间把范围内的敌人定住。
 *
 * 定身怎么实现:直接把敌人的速度压到 0,并在 preUpdate 里持续覆盖。
 * 不用 tween、不用计时器 —— 那些在 pauseGame() / 池化复用下都会出事,
 * 而每帧写 velocity 是最直白也最可控的做法。
 *
 * 与 Attractor 同一套哲学:控制类实体不碰伤害链。
 */
export class ScanField extends Phaser.GameObjects.Container {
  public isDead = false;
  public radius = 900;

  private gfx: Phaser.GameObjects.Graphics;
  private enemyGroup!: Phaser.GameObjects.Group;
  private lifeMs = 2400;
  private elapsedMs = 0;
  /** 定身强度:0 = 不定身 */
  public freeze = 1;

  constructor(scene: Phaser.Scene) {
    super(scene, 0, 0);
    this.gfx = scene.add.graphics();
    this.add([this.gfx]);
    scene.add.existing(this);
    this.setActive(false).setVisible(false);
  }

  bind(enemyGroup: Phaser.GameObjects.Group): void {
    this.enemyGroup = enemyGroup;
  }

  setup(x: number, y: number, radius: number, lifeMs: number, freeze = 1): void {
    this.radius = radius;
    this.lifeMs = lifeMs;
    this.freeze = freeze;
    this.elapsedMs = 0;
    this.isDead = false;

    this.setActive(true).setVisible(true);
    this.setPosition(x, y);
    this.setAlpha(1);
    this.draw(0);
  }

  private draw(phase: number): void {
    const g = this.gfx;
    g.clear();
    // 从外向内收缩的三道环 —— 视觉上表达「扫描正在推进」
    for (let i = 0; i < 3; i++) {
      const t = (phase + i / 3) % 1;
      g.lineStyle(3, 0x88eeff, 0.55 * (1 - t));
      g.strokeCircle(0, 0, this.radius * t);
    }
    g.lineStyle(1, 0xaaffff, 0.25);
    g.strokeCircle(0, 0, this.radius);
  }

  preUpdate(time: number, delta: number): void {
    if (!this.active) return;
    if (this.scene.physics.world.isPaused) return;

    this.elapsedMs += delta;
    if (this.elapsedMs >= this.lifeMs) {
      this.kill();
      return;
    }
    this.draw(this.elapsedMs / this.lifeMs);
    if (this.freeze <= 0) return;

    // 定身:覆盖速度而不是等敌人自己停下。敌人的移动逻辑在 GameScene.updateEnemies 里,
    // 它每帧也会写 velocity,所以这里必须在它之后执行才有意义 ——
    // 靠 depth 排序做不到,改为每帧重写一次,后写者胜。
    for (const e of this.enemyGroup.getChildren()) {
      const enemy = e as Enemy;
      if (!enemy.active || enemy.isDead) continue;
      // 定身抗性(怪物设计文档第六节):精英与秘境守不吃冻结。
      // 硬约束是「同一只精英最多两条抗性」,那条规则在 EliteConfig.rollEliteResists
      if (enemy.resistFreeze) continue;

      const dx = enemy.x - this.x;
      const dy = enemy.y - this.y;
      if (dx * dx + dy * dy > this.radius * this.radius) continue;

      const body = enemy.body as Phaser.Physics.Arcade.Body;
      body.velocity.x *= 1 - this.freeze;
      body.velocity.y *= 1 - this.freeze;
      // 除了压速度,还要把「动作」一起冻住(开火/引信/冲锋起手),
      // 每帧刷新一个短截止时刻 —— 与速度同一套「后写者胜」的生命周期
      enemy.frozenUntil = time + 80;
    }
  }

  kill(): void {
    this.isDead = true;
    this.setActive(false).setVisible(false);
    this.gfx.clear();
  }
}
