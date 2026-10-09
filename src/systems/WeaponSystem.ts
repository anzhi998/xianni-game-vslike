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
// 非 type 导入:这两个类要作为 classType 传给 Phaser 的 Group,
// 编译后必须保留对构造函数的引用
import { Attractor } from '../entities/attacks/Attractor';
import { ScanField } from '../entities/attacks/ScanField';
import { findNearestEnemy } from '../utils/Targeting';
import { MathUtils } from '../utils/MathUtils';
import { GameEvents } from '../types';
import type { WeaponConfig, FireModifiers } from '../types';
import { MAX_RITUAL, ritualDamageMul } from '../config/EvolutionConfig';

export interface WeaponInstance {
  id: string;
  /** 旧法术线的等级(每级 ×1.25)。新神通走 ritual,这个字段对它们不生效 */
  level: number;
  /**
   * 神通的重数(1..8),设计书 v2.7 的刻度。
   * 新神通用 ritualDamageMul(),不再用 level 的 ×1.25。
   * 阶段 2 整体替换法术表后,level 会被移除 —— 两套刻度不该长期共存。
   */
  ritual: number;
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
   * 落印落地后灼烧区域每跳的伤害占落印伤害的比例。
   * 刻意低于 1 —— 那片火海是「附加」,不该喧宾夺主抢走落印本身的定位。
   */
  private static readonly ZONE_TICK_DAMAGE = 0.45;

  /**
   * 火海的持续时间(ms)。
   *
   * 这个数字被池容量约束着,不是手感问题:Zone 池 20 个,
   * 穿透弹单发最多产出 3 个、冷却 1 秒,若火海活太久池会先耗尽,
   * 之后 setup() 拿到 null,表现是「火海凭空消失」。1.8s 留了约 3 倍余量。
   */
  private static readonly ZONE_LIFE_MS = 1800;

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
  private attractors: Phaser.GameObjects.Group;
  private scans: Phaser.GameObjects.Group;
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
      attractors: Phaser.GameObjects.Group;
      scans: Phaser.GameObjects.Group;
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
    this.attractors = attackPools.attractors;
    this.scans = attackPools.scans;
  }

  addWeapon(id: string): void {
    if (this.weapons.find((w) => w.id === id)) {
      this.weapons.find((w) => w.id === id)!.level++;
      return;
    }
    const cfg = WEAPONS[id];
    if (!cfg) return;    this.weapons.push({
      id,
      level: 1,
      ritual: 1,
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

  /**
   * 神通升一重。满 8 重封顶,不再增长。
   * @returns 是否真的升了(满重时返回 false —— 卡片据此隐藏)
   */
  addRitual(id: string): boolean {
    const w = this.weapons.find((x) => x.id === id);
    if (!w) return false;
    if (w.ritual >= MAX_RITUAL) return false;
    w.ritual++;
    return true;
  }

  /** 该神通的当前重数,未持有时返回 0 */
  getRitual(id: string): number {
    return this.weapons.find((w) => w.id === id)?.ritual ?? 0;
  }

  /** 该神通是否已满 8 重 —— 进化三条件之一 */
  isMaxRitual(id: string): boolean {
    return this.getRitual(id) >= MAX_RITUAL;
  }

  /**
   * 把神通替换成它的进化形态。
   *
   * 保留重数(已满 8 重才允许进化,所以重数必然是 8),只换 id 与基础值。
   * 玩家不需要重新养 —— 这正是「进化」与「换一件新装备」的区别。
   *
   * @returns 是否替换成功
   */
  evolve(baseId: string, evolvedId: string, mul: number): boolean {
    const idx = this.weapons.findIndex((w) => w.id === baseId);
    if (idx < 0) return false;
    const cfg = WEAPONS[evolvedId];
    if (!cfg) return false;

    const w = this.weapons[idx];
    w.id = evolvedId;
    w.baseCooldown = cfg.cooldown;
    w.cooldown = cfg.cooldown;
    w.baseDamage = cfg.damage * mul;
    w.baseSpeed = cfg.projectileSpeed;
    w.baseCount = cfg.projectileCount;
    w.basePierce = cfg.pierce;
    w.baseArea = cfg.area;
    w.duration = cfg.duration;
    return true;
  }

  getWeaponCount(): number {
    return this.weapons.length;
  }

  /**
   * 调试用:把法术栏整个换成给定的几门。
   *
   * addWeapon 只做「累加」,而调试时经常需要反过来 —— 先用「装满法术」
   * 把六门全试一遍,再退回来只测其中一门。没有这个入口就只能重开一局。
   * 命名带 debug 前缀,与 ArtifactSystem.debugEquip 同一套约定
   */
  debugSetWeapons(ids: string[]): void {
    this.weapons.length = 0;
    for (const id of ids) this.addWeapon(id);
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

      // 控制类形态同理:引力场与扫描环覆盖的是「一片区域」而非某个目标,
      // 屏上没怪时按兵不动反而是错的 —— 玩家可能正在攒冷却等下一个怪潮。
      // 这两种形态的 fire 不需要 target(见 fireAttractor / fireScan)。
      if (cfg.form === 'attractor' || cfg.form === 'scan') {
        this.fire(w, cfg, null);
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
    // 新神通按重数算,旧法术仍走 level —— 阶段 2 替换法术表后统一为前者
    const levelMul = WEAPONS[w.id]?.usesRituals
      ? ritualDamageMul(w.ritual)
      : Math.pow(WeaponSystem.LEVEL_DAMAGE_MUL, w.level - 1);
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
  private fire(w: WeaponInstance, cfg: WeaponConfig, target: Enemy | null): void {
    switch (cfg.form) {
      case 'attractor': this.fireAttractor(w, cfg); return;
      case 'scan':    this.fireScan(w, cfg); return;
      // 以下形态都需要目标。这里显式断言而不是各加一个 if:
      // 调用方已经保证「除控制类外,target 必非空」,再检查一次只会掩盖真错误。
      case 'slam':    this.fireSlam(w, cfg, target!); break;
      case 'arc':     this.fireArc(w, cfg, target!); break;
      case 'zone':    this.fireZone(w, cfg, target!); break;
      default:        this.fireProjectile(w, cfg, target!); break;
    }
    this.scene.events.emit(GameEvents.WEAPON_FIRED, w.id);
  }

  /** 直射 —— 唯一可被法宝改写弹道的形态(纹理由 Projectile 依 weaponId 自查) */
  private fireProjectile(w: WeaponInstance, cfg: WeaponConfig, target: Enemy): void {
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

      // 进化态「炸开一片火海」:命中处留一片灼烧区。
      // 配置里给了 zoneRadius 才生成,普通弹道不受影响。
      //
      // ⚠️ 穿透 2 = 单发最多生成 3 个 Zone,而 Zone 活 1.8s、弹冷却 1s,
      //    最坏情况每秒产 3 个 —— 20 个的池 6 秒就空了,之后 setup() 拿到 null,
      //    表现为「火海突然全没了」。所以火海的持续时间必须短于
      //    「池容量 / 每秒产出」,这里 1.8s 对应约 6 个同屏,是刻意留的余量。
      if (cfg.zoneRadius) {
        proj.onImpact = (x, y) => {
          const zone = this.zones.get() as Zone;
          if (!zone) return;
          zone.setup(x, y, damage * WeaponSystem.ZONE_TICK_DAMAGE, cfg.zoneRadius ?? 120, WeaponSystem.ZONE_LIFE_MS, cfg.zoneTickMs ?? 500, area, cfg.color);
        };
      }
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

      // 进化态「一片火海」:落地后再烧一片。配置里给了 zoneRadius 才生成,
      // 普通落印不受影响。
      if (cfg.zoneRadius) {
        slam.onImpact = (x, y) => {
          const zone = this.zones.get() as Zone;
          if (!zone) return;
          zone.setup(x, y, damage * WeaponSystem.ZONE_TICK_DAMAGE, cfg.zoneRadius ?? 120, 3200, cfg.zoneTickMs ?? 500, area, cfg.color);
        };
      }
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

  /**
   * 引力场 —— 把范围内的敌人往一点拖。
   *
   * 零伤害。它的价值是把敌人聚到一处,好让其他神通打。
   * 所以它不需要 target:落点固定在玩家身上(向心),而不是敌人脚下。
   */
  private fireAttractor(w: WeaponInstance, cfg: WeaponConfig): void {
    const m = this.artifactSystem.getModifiers();
    const { area } = this.compose(w, m);

    const a = this.attractors.get() as Attractor;
    if (!a) return;
    a.setup(
      this.player.x, this.player.y,
      (cfg.zoneRadius ?? 240) * area,
      cfg.attractorPull ?? 260,
      cfg.fieldLifeMs ?? 2000,
    );
  }

  /**
   * 全场扫描 —— 冻结环,零伤害。
   *
   * 与引力场同样不需要 target:它覆盖全场,不指向任何东西。
   * 这也是为什么这两种形态在 update() 里不参与「没找到目标就不放」:
   * 环外无敌人时照样该放(空放是玩家自己的节奏选择)。
   */
  private fireScan(w: WeaponInstance, cfg: WeaponConfig): void {
    const m = this.artifactSystem.getModifiers();
    const { area, lifeMs } = this.compose(w, m);

    const s = this.scans.get() as ScanField;
    if (!s) return;
    s.setup(
      this.player.x, this.player.y,
      (cfg.zoneRadius ?? 900) * area,
      cfg.fieldLifeMs ?? lifeMs,
      cfg.freezeStrength ?? 1,
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