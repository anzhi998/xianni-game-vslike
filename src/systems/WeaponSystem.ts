import Phaser from 'phaser';
import type { Player } from '../entities/Player';
import { WEAPONS } from '../config/WeaponConfig';
import type { Enemy } from '../entities/Enemy';
import type { Projectile } from '../entities/Projectile';
import type { ArtifactSystem } from './ArtifactSystem';
import { findNearestEnemy } from '../utils/Targeting';
import { MathUtils } from '../utils/MathUtils';
import { GameEvents } from '../types';

export interface WeaponInstance {
  id: string;
  level: number;
  baseCooldown: number;
  cooldown: number;
  baseDamage: number;
  baseSpeed: number;
  baseCount: number;
  basePierce: number;
  baseArea: number;
  duration: number;
  lastFiredAt: number;
}

export class WeaponSystem {
  /** 多发同时命中时默认的总张角 */
  private static readonly DEFAULT_SPREAD = 0.2;

  /**
   * 法术每精进一级的伤害倍率(方案 a:固定倍率)
   *
   * 「法术精进」是专精,「法宝」是外物加持 —— 两者刻意分层:
   * 这一项只影响该法术自身,玩家的全局 Player 修正是另一条线,
   * 法宝则叠在两者之上。所以加算飞刀和加一件伤害法宝,收益是相乘而非互相顶替。
   *
   * 数值锚点:Lv1 恒为 ×1,Lv2 ×1.25,Lv3 ×1.56(满级约 +56%)。
   * 与法宝的伤害档(落魂剑 ×2.2)相比刻意留了差距 ——
   * 法宝依然是更强的构筑方向,精进只是让专精有回报。
   */
  private static readonly LEVEL_DAMAGE_MUL = 1.25;

  private scene: Phaser.Scene;
  private player: Player;
  private weapons: WeaponInstance[] = [];
  private projectiles: Phaser.GameObjects.Group;
  private enemyGroup: Phaser.GameObjects.Group;
  private artifactSystem: ArtifactSystem;

  constructor(
    scene: Phaser.Scene,
    player: Player,
    projectilesGroup: Phaser.GameObjects.Group,
    enemyGroup: Phaser.GameObjects.Group,
    artifactSystem: ArtifactSystem,
  ) {
    this.scene = scene;
    this.player = player;
    this.projectiles = projectilesGroup;
    this.enemyGroup = enemyGroup;
    this.artifactSystem = artifactSystem;
  }

  addWeapon(id: string): void {
    if (this.weapons.find((w) => w.id === id)) {
      this.weapons.find((w) => w.id === id)!.level++;
      return;
    }
    const cfg = WEAPONS[id];
    if (!cfg) return;
    this.weapons.push({
      id,
      level: 1,
      baseCooldown: cfg.cooldown,
      cooldown: cfg.cooldown,
      baseDamage: cfg.damage,
      baseSpeed: cfg.projectileSpeed,
      baseCount: cfg.projectileCount,
      basePierce: cfg.pierce,
      baseArea: cfg.area,
      duration: cfg.duration,
      lastFiredAt: -9999,
    });
  }

  getWeapons(): WeaponInstance[] {
    return this.weapons;
  }

  getWeaponCount(): number {
    return this.weapons.length;
  }

  hasWeapon(id: string): boolean {
    return this.weapons.some((w) => w.id === id);
  }

  resetCooldowns(): void {
    this.weapons.forEach((w) => { w.lastFiredAt = -9999; });
  }

  update(time: number, _delta: number): void {
    const artifactCooldownMul = this.artifactSystem.getModifiers().cooldownMul;
    for (const w of this.weapons) {
      const cd = w.baseCooldown * this.player.cooldownMul * artifactCooldownMul;
      if (time - w.lastFiredAt >= cd) {
        const target = this.findTarget();
        if (target) {
          this.fire(w, target);
          w.lastFiredAt = time;
        }
      }
    }
  }

  private findTarget(): Enemy | null {
    return findNearestEnemy(this.enemyGroup, this.player.x, this.player.y, 600 * this.player.areaMul);
  }

  /**
   * 三个来源合成一次:法术基础值 × Player 修正 × 法宝修正。
   * 循环内不做任何法宝分支 —— 修饰已经在 ArtifactSystem.merge() 里合完了。
   */
  private fire(w: WeaponInstance, target: Enemy): void {
    const m = this.artifactSystem.getModifiers();
    const baseAngle = MathUtils.angle(this.player.x, this.player.y, target.x, target.y);

    const count = Math.max(1, w.baseCount + this.player.projectileAdd + m.projectileAdd);
    // 法宝指定了张角就用法宝的,否则沿用默认
    const spread = m.spreadRad > 0 ? m.spreadRad : (count > 1 ? WeaponSystem.DEFAULT_SPREAD : 0);
    const startOffset = -((count - 1) * spread) / 2;

    // 提到循环外 —— 原来每颗投射物都重算一遍这几个值,纯属浪费
    const speed = w.baseSpeed * this.player.projectileSpeedMul * m.projectileSpeedMul;
    // 法术精进只乘在这一项上,与 Player 全局修正、法宝修正三者相乘
    const levelMul = Math.pow(WeaponSystem.LEVEL_DAMAGE_MUL, w.level - 1);
    const damage = w.baseDamage * levelMul * this.player.damageMul * m.damageMul;
    const pierce = w.basePierce + this.player.pierceAdd + m.pierceAdd;
    const area = w.baseArea * this.player.areaMul * m.areaMul;
    const lifeMs = w.duration * m.lifeMul;

    for (let i = 0; i < count; i++) {
      const angle = baseAngle + startOffset + i * spread;
      const proj = this.projectiles.get() as Projectile;
      // 池耗尽时返回 null(依赖 setupPools 设了有限 maxSize),跳过这一发
      if (!proj) continue;
      proj.setup(
        this.player.x + Math.cos(angle) * 18,
        this.player.y + Math.sin(angle) * 18,
        angle, damage, speed, pierce, w.id, area, lifeMs, m,
      );
    }
    this.scene.events.emit(GameEvents.WEAPON_FIRED, w.id);
  }
}