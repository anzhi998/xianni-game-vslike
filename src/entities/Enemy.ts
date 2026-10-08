import Phaser from 'phaser';
import { ENEMIES } from '../config/EnemyConfig';
import { rollEliteDrops } from '../config/EliteConfig';
import { NORMAL_MUTATION } from '../types';
import type { DropEntry, EnemyMutation } from '../types';

export class Enemy extends Phaser.Physics.Arcade.Sprite {
  public maxHealth = 10;
  public health = 10;
  public speed = 60;
  public contactDamage = 5;
  public xpValue = 1;
  public enemyKey = 'bat';
  public flashUntil = 0;
  public isDead = false;

  // ---- 精英变异 ----
  public isElite = false;
  public eliteTier = 0;
  public drops: DropEntry[] = [];
  /** 玩家当前所处的大境界下标,用于掉落加权。由 SpawnSystem 注入 */
  public currentRealmIndex = 0;

  constructor(scene: Phaser.Scene, x: number, y: number) {
    super(scene, x, y, 'enemy_bat');
    scene.add.existing(this);
    scene.physics.add.existing(this);
    this.setDepth(50);
  }

  setup(type: keyof typeof ENEMIES, difficultyMul: number, m: EnemyMutation = NORMAL_MUTATION): void {
    const cfg = ENEMIES[type];
    this.enemyKey = type;
    this.isElite = m.elite;
    this.eliteTier = m.tier;

    this.setTexture(m.elite ? `elite_${type}` : `enemy_${type}`);
    this.maxHealth = cfg.maxHealth * difficultyMul * m.hpMul;
    this.health = this.maxHealth;
    this.speed = cfg.speed * m.speedMul;
    this.contactDamage = cfg.contactDamage * difficultyMul * m.damageMul;
    this.xpValue = cfg.xpValue * m.xpMul;
    this.setOrigin(0.5, 0.7);

    // 体型缩放。
    // Phaser 的 Arcade.Body.updateBounds() 从 sprite.frame.realWidth * scaleX
    // 推导源矩形,所以 setScale 单独用就能正确缩放碰撞盒 ——
    // 不要再同时把 cfg.size 乘进 setSize/setCircle,那会双重计算。
    this.setScale(m.scaleMul);

    // 死亡补间会改 alpha/scale,复用时必须复位,否则精英的体型/透明度会泄漏到普通怪
    this.setAlpha(1);
    this.setDepth(m.elite ? 52 : 50);

    const body = this.body as Phaser.Physics.Arcade.Body;
    // 注意:不要在这里调 body.setSize —— 它会把 isCircle 置回 false,
    // 把 setCircle 的结果整个覆盖掉(敌人原本就是这个 bug,实际是矩形碰撞体)。
    // 体型交给 setScale:Body.updateBounds 从 frame.realWidth * scale 推导碰撞盒,
    // 圆形碰撞体会自动跟着缩放。
    const r = (cfg.size / 2) * m.scaleMul;
    body.setCircle(r, 0, 0);
    // setCircle 的偏移相对 body 顶点(= 精灵中心 - 贴图尺寸/2),
    // 所以偏移要补上半个贴图尺寸,碰撞圆才会落在精灵中心。
    body.setOffset(this.frame.realWidth / 2 - r, this.frame.realHeight / 2 - r);
    body.enable = true;
    body.setVelocity(0, 0);

    this.clearTint();
    this.isDead = false;
    this.flashUntil = 0;
    this.drops = m.elite ? rollEliteDrops(m.tier, this.currentRealmIndex) : [];

    this.setActive(true).setVisible(true);
  }

  takeDamage(amount: number, now: number): boolean {
    if (this.isDead) return false;
    this.health -= amount;
    this.flashUntil = now + 80;
    if (this.health <= 0) {
      this.isDead = true;
      return true;
    }
    return false;
  }

  preUpdate(time: number, delta: number): void {
    super.preUpdate(time, delta);
    if (!this.active) return;
    if (this.scene.physics.world.isPaused) return;
    if (time < this.flashUntil) {
      this.setTintFill(0xffffff);
    } else {
      this.clearTint();
    }
  }
}