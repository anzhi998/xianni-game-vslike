import Phaser from 'phaser';
import type { Player } from '../entities/Player';
import { WEAPONS } from '../config/WeaponConfig';
import type { Enemy } from '../entities/Enemy';
import type { Projectile } from '../entities/Projectile';
import type { ArtifactSystem } from './ArtifactSystem';
import type { Slam } from '../entities/attacks/Slam';
import type { ArcSlash } from '../entities/attacks/ArcSlash';
import type { Orbiter } from '../entities/attacks/Orbiter';
import type { Zone } from '../entities/attacks/Zone';
import { findNearestEnemy } from '../utils/Targeting';
import { MathUtils } from '../utils/MathUtils';
import { GameEvents } from '../types';
import type { WeaponConfig, FireModifiers } from '../types';

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
  private slams: Phaser.GameObjects.Group;
  private arcs: Phaser.GameObjects.Group;
  private orbiters: Phaser.GameObjects.Group;
  private zones: Phaser.GameObjects.Group;
  private enemyGroup: Phaser.GameObjects.Group;
  private artifactSystem: ArtifactSystem;

  constructor(
    scene: Phaser.Scene,
    player: Player,
    projectilesGroup: Phaser.GameObjects.Group,
    enemyGroup: Phaser.GameObjects.Group,
    artifactSystem: ArtifactSystem,
    attackPools: {
      slams: Phaser.GameObjects.Group;
      arcs: Phaser.GameObjects.Group;
      orbiters: Phaser.GameObjects.Group;
      zones: Phaser.GameObjects.Group;
    },
  ) {
    this.scene = scene;
    this.player = player;
    this.projectiles = projectilesGroup;
    this.enemyGroup = enemyGroup;
    this.artifactSystem = artifactSystem;
    this.slams = attackPools.slams;
    this.arcs = attackPools.arcs;
    this.orbiters = attackPools.orbiters;
    this.zones = attackPools.zones;
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

  /**
   * 用 newId 替换掉 dropId。
   *
   * 新法术的等级按「首次学会」处理,即 Lv1 —— 替换不是升级,
   * 玩家想变强仍然得靠后续的「法术精进」卡。
   *
   * @returns 是否替换成功
   */
  replaceWeapon(dropId: string, newId: string): boolean {
    const idx = this.weapons.findIndex((w) => w.id === dropId);
    if (idx < 0) return false;
    // 已经在手上就不替换(替换成同名法术没有意义)
    if (this.hasWeapon(newId)) return false;

    this.weapons.splice(idx, 1);
    this.addWeapon(newId);
    return true;
  }

  resetCooldowns(): void {
    this.weapons.forEach((w) => { w.lastFiredAt = -9999; });
  }

  update(time: number, _delta: number): void {
    const artifactCooldownMul = this.artifactSystem.getModifiers().cooldownMul;
    for (const w of this.weapons) {
      const cfg = WEAPONS[w.id];
      if (!cfg) continue;
      const cd = w.baseCooldown * this.player.cooldownMul * artifactCooldownMul;
      if (time - w.lastFiredAt < cd) continue;

      // 环绕体自行公转,不需要索敌 —— 有敌人没敌人都照常施放
      if (cfg.form === 'orbiter') {
        this.fireOrbiter(w, cfg);
        w.lastFiredAt = time;
        continue;
      }

      const target = this.findTarget(cfg);
      if (!target) continue;
      this.fire(w, cfg, target);
      w.lastFiredAt = time;
    }
  }

  /**
   * 索敌半径。
   * 非直射形态的「射程」概念不同:落印/地效是丢在目标头上,弧斩以玩家为圆心扫一圈,
   * 所以它们用各自的实际作用半径去索敌,而不是直射那套 600px。
   */
  private findTarget(cfg: WeaponConfig): Enemy | null {
    const range = cfg.form === 'arc'
      ? (cfg.arcRadius ?? 150) * this.player.areaMul
      : cfg.form === 'slam'
        ? 600
        : 600 * this.player.areaMul;
    return findNearestEnemy(this.enemyGroup, this.player.x, this.player.y, range);
  }

  /** 三个来源合成一次:法术基础值 × 精进倍率 × Player 修正 × 法宝修正 */
  private compose(w: WeaponInstance, m: FireModifiers) {
    const levelMul = Math.pow(WeaponSystem.LEVEL_DAMAGE_MUL, w.level - 1);
    return {
      damage: w.baseDamage * levelMul * this.player.damageMul * m.damageMul,
      speed: w.baseSpeed * this.player.projectileSpeedMul * m.projectileSpeedMul,
      pierce: w.basePierce + this.player.pierceAdd + m.pierceAdd,
      area: w.baseArea * this.player.areaMul * m.areaMul,
      lifeMs: w.duration * m.lifeMul,
    };
  }

  /**
   * 按形态分发。
   *
   * 注意法宝的弹道类修饰(追踪/连锁/散射)只对直射生效 ——
   * 那三者本质都是改写弹道,落印/弧斩/环绕/地效没有弹道可改。
   * 数值类修饰(伤害/范围/冷却/存续)通过 compose() 对所有形态生效。
   */
  private fire(w: WeaponInstance, cfg: WeaponConfig, target: Enemy): void {
    switch (cfg.form) {
      case 'slam':    this.fireSlam(w, cfg, target); break;
      case 'arc':     this.fireArc(w, cfg, target); break;
      case 'zone':    this.fireZone(w, cfg, target); break;
      default:        this.fireProjectile(w, cfg, target); break;
    }
    this.scene.events.emit(GameEvents.WEAPON_FIRED, w.id);
  }

  /** 直射 —— 唯一可被法宝改写弹道的形态(纹理由 Projectile 依 weaponId 自查) */
  private fireProjectile(w: WeaponInstance, _cfg: WeaponConfig, target: Enemy): void {
    const m = this.artifactSystem.getModifiers();
    const { damage, speed, pierce, area, lifeMs } = this.compose(w, m);
    const baseAngle = MathUtils.angle(this.player.x, this.player.y, target.x, target.y);

    const count = Math.max(1, w.baseCount + this.player.projectileAdd + m.projectileAdd);
    const spread = m.spreadRad > 0 ? m.spreadRad : (count > 1 ? WeaponSystem.DEFAULT_SPREAD : 0);
    const startOffset = -((count - 1) * spread) / 2;

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
  }

  /** 落印 —— 从目标头顶垂直砸落,落地时范围伤害 */
  private fireSlam(w: WeaponInstance, cfg: WeaponConfig, target: Enemy): void {
    const m = this.artifactSystem.getModifiers();
    const { damage, area } = this.compose(w, m);
    // 弹数不加 m.projectileAdd —— 散射属弹道类修饰,对落印无效(见文档 2.2)
    const count = Math.max(1, w.baseCount);
    const radius = (cfg.slamRadius ?? 70) * area;
    const height = cfg.slamHeight ?? 280;

    for (let i = 0; i < count; i++) {
      // 多发时绕目标散开,避免全部叠在同一点
      const a = count > 1 ? (i / count) * Math.PI * 2 : 0;
      const off = count > 1 ? radius * 0.5 : 0;
      const slam = this.slams.get() as Slam;
      if (!slam) continue;
      slam.setup(
        target.x + Math.cos(a) * off,
        target.y + Math.sin(a) * off,
        damage, cfg.slamRadius ?? 70,
        height + i * 40, 220 + height * 0.4, area, cfg.texture,
      );
    }
  }

  /** 弧斩 —— 以玩家为中心扫过一段弧 */
  private fireArc(w: WeaponInstance, cfg: WeaponConfig, target: Enemy): void {
    const m = this.artifactSystem.getModifiers();
    const { damage, area } = this.compose(w, m);
    const facing = MathUtils.angle(this.player.x, this.player.y, target.x, target.y);

    const arc = this.arcs.get() as ArcSlash;
    if (!arc) return;
    arc.setup(
      this.player.x, this.player.y, facing,
      damage, cfg.arcRadius ?? 150, cfg.arcSpan ?? Math.PI / 3,
      240, area,
    );
  }

  /** 地效 —— 在目标处留下持续伤害区域 */
  private fireZone(w: WeaponInstance, cfg: WeaponConfig, target: Enemy): void {
    const m = this.artifactSystem.getModifiers();
    const { damage, area, lifeMs } = this.compose(w, m);

    const zone = this.zones.get() as Zone;
    if (!zone) return;
    zone.setup(
      target.x, target.y, damage,
      cfg.zoneRadius ?? 80, lifeMs, cfg.zoneTickMs ?? 500,
      area, cfg.color,
    );
  }

  /** 环绕 —— 绕玩家公转的护卫体,多发时均匀分布 */
  private fireOrbiter(w: WeaponInstance, cfg: WeaponConfig): void {
    const m = this.artifactSystem.getModifiers();
    const { damage, area, lifeMs } = this.compose(w, m);
    // 同上:环绕数量不随散射法宝增加
    const count = Math.max(1, w.baseCount);

    for (let i = 0; i < count; i++) {
      const orb = this.orbiters.get() as Orbiter;
      if (!orb) continue;
      orb.setup(
        (i / count) * Math.PI * 2,
        damage,
        cfg.orbitRadius ?? 70, cfg.orbitSpeed ?? 2,
        lifeMs, area, cfg.texture,
      );
    }
  }
}