import Phaser from 'phaser';
import type { Player } from '../entities/Player';
import type { Enemy } from '../entities/Enemy';
import { Projectile } from '../entities/Projectile';
import { Orbiter } from '../entities/attacks/Orbiter';
import { Zone } from '../entities/attacks/Zone';
import { SandWave } from '../entities/attacks/SandWave';
import { Tornado } from '../entities/attacks/Tornado';
import { IceSpikeDrop } from '../entities/attacks/IceSpikeDrop';
import { UnderworldWave } from '../entities/attacks/UnderworldWave';
import { ChainBolt } from '../entities/attacks/ChainBolt';
import { Barrier } from '../entities/attacks/Barrier';
import { resolveSpell, MAX_SPELL_LEVEL, SPELLS } from '../config/SpellConfig';
import { findEvolution } from '../config/EvolutionConfig';
import type { ResolvedSpell } from '../config/SpellConfig';
import type { RelicSystem } from './RelicSystem';
import type { AttackForm, DamageOptions, SpellRelicMods } from '../types';
import { killFuryBonus } from '../types';
import { findNearestEnemy } from '../utils/Targeting';
import { viewRadius } from '../config/GameConfig';
import { MathUtils } from '../utils/MathUtils';

/** 神通栏里的一门神通 */
export interface SpellInstance {
  id: string;
  /** 1–8。进化形态只有一行,超过的部分不产生收益 */
  level: number;
  lastFiredAt: number;
  /** 斩罗的下一个收束时刻(仅剑阵的进化形态用到) */
  nextBurstAt: number;
  /** 天雷引的下一次判定时刻(仅五雷轰顶用到) */
  nextSkyThunderAt: number;
}

export interface WeaponPools {
  projectiles: Phaser.GameObjects.Group;
  orbiters: Phaser.GameObjects.Group;
  zones: Phaser.GameObjects.Group;
  sandWaves: Phaser.GameObjects.Group;
  tornadoPool: Phaser.GameObjects.Group;
  chainBolts: Phaser.GameObjects.Group;
  barriers: Phaser.GameObjects.Group;
  iceSpikes: Phaser.GameObjects.Group;
  waves: Phaser.GameObjects.Group;
}

/**
 * 神通系统 —— 持有法术栏、按形态分发开火
 *
 * ## 三个合成来源,各乘一次
 *
 * `法术表的这一行 × 遗物(专属/通用) × Player(境界与全局修正)`
 * —— 全部在 compose() 里一次算完,开火循环里零分支。
 * 遗物不再改写弹道(追踪/连锁/散射那一套已随旧法宝表删除),
 * 所以这里没有任何「这件遗物对这门法术无效吗」的判断。
 */
export class WeaponSystem {
  /** 多发同时命中时默认的总张角(弧度) */
  private static readonly DEFAULT_SPREAD = 0.16;
  /** 自动索敌的搜索半径 */
  /**
   * 自动索敌的搜索半径,以「一屏半对角线」为单位(zoom = 1 时 620px ≈ 0.85 倍)。
   *
   * ⚠️ 它必须跟着镜头缩放:镜头拉近之后一屏变窄,还按旧像素搜的话,
   *    火球术会去锁定**玩家根本看不见**的敌人 ——「自动索敌」变成
   *    「自动打空气」,而且不报错,只是偶尔朝一个空方向开火。
   */
  private static get TARGET_RADIUS(): number {
    return viewRadius() * 0.85;
  }
  /** 推挤速度 = 推距 ÷ 这个时长。写在常量里是为了让「推 1.2 格」有个统一的手感基准 */
  private static readonly PUSH_SECONDS = 0.25;
  /**
   * 牵引时长。与 PUSH_SECONDS 共用同一个基准 —— 推 0.4 格与拉 0.4 格
   * 必须一样的手感,否则两条路线一对比就显得其中一条「更黏」
   */
  private static readonly PULL_SECONDS = 0.25;
  /** 火海叠层判定:落点在这个距离内的火海视为同一片 */
  private static readonly SEA_MERGE_PX = 48;
  /** 落锥首道的落点距离(px)= 2 格 —— 护得住身位,又不至于贴脸糊屏 */
  private static readonly FIRST_DROP_PX = 2 * 64;
  /** 相邻两道冰锥的落地间隔。「一串接力砸下」的节奏感来自这里,不来自伤害差 */
  private static readonly DROP_STAGGER_MS = 200;

  private scene: Phaser.Scene;
  private player: Player;
  private spells: SpellInstance[] = [];
  /**
   * 当前法术槽上限。开局 2,随大境界突破递增(见 RealmConfig.spellSlots)。
   * 由 RealmSystem 在建制时与每次突破时推进 —— 法术系统不该知道境界的存在,
   * 所以是一句 setSlotCap,而不是让它去 import REALMS。
   */
  private slotCap = 2;
  private pools: WeaponPools;
  private enemyGroup: Phaser.GameObjects.Group;
  private relicSystem: RelicSystem;
  /** 当前击杀数(局内成长型被动「杀魂」的输入) */
  private getKillCount: () => number;

  constructor(
    scene: Phaser.Scene,
    player: Player,
    enemyGroup: Phaser.GameObjects.Group,
    relicSystem: RelicSystem,
    pools: WeaponPools,
    /**
     * 当前击杀数。**注入而不是直接读 GameScene** —— 神通系统只该知道
     * 「有这么个数」,不该知道它记在哪个场景字段上(与 RealmSystem 的
     * `setSlotCap` 同一思路:域间只递数据,不递场景)。
     */
    getKillCount: () => number,
  ) {
    this.scene = scene;
    this.player = player;
    this.enemyGroup = enemyGroup;
    this.relicSystem = relicSystem;
    this.pools = pools;
    this.getKillCount = getKillCount;
  }

  // ===== 神通栏 =====

  /**
   * 学会一门神通。
   * @returns 是否真的学会了(已持有或槽满时返回 false —— 悟道卡据此隐藏)
   */
  addSpell(id: string): boolean {
    if (this.spells.some((s) => s.id === id)) return false;
    if (!SPELLS[id]) return false;
    // ⚠️ 融合会把基础形态**原地换成**进化形态(id 变了),于是「有没有火球术」
    //    这个问题的答案在融合之后变成了 false —— 基础形态会被当成一门没学过的
    //    新法术重新出现在悟道池里。玩家会同时持有火球术与焚天·火海。
    //    这里挡在唯一的入口上,而不是只在卡池里过滤:卡池有三处,入口只有一处。
    if (this.hasEvolvedForm(id)) return false;
    if (this.spells.length >= this.slotCap) return false;
    this.spells.push({ id, level: 1, lastFiredAt: -9999, nextBurstAt: 0, nextSkyThunderAt: 0 });
    return true;
  }

  getSpells(): SpellInstance[] {
    return this.spells;
  }

  hasSpell(id: string): boolean {
    return this.spells.some((s) => s.id === id);
  }

  /**
   * 该**基础**法术的进化形态是否已在手上。
   *
   * 卡池与掉落都用它回答「这门法术还算不算没学过」——
   * 只看 hasSpell() 会让融合后的基础形态复活。
   */
  hasEvolvedForm(id: string): boolean {
    const evo = findEvolution(id);
    return !!evo && this.hasSpell(evo.evolved);
  }

  getLevel(id: string): number {
    return this.spells.find((s) => s.id === id)?.level ?? 0;
  }

  getSpellCount(): number {
    return this.spells.length;
  }

  /** 由 RealmSystem 在大境界突破时推进 */
  setSlotCap(n: number): void {
    this.slotCap = Math.max(1, n);
  }

  getSlotCap(): number {
    return this.slotCap;
  }

  /** 该门神通的等级上限。进化形态只有一行,升级它没有意义 */
  getMaxLevel(id: string): number {
    return SPELLS[id]?.levels.length ?? MAX_SPELL_LEVEL;
  }

  /** 悟道卡「法术升级」走这条路。满级返回 false —— 卡片据此隐藏 */
  levelUp(id: string): boolean {
    const s = this.spells.find((x) => x.id === id);
    if (!s) return false;
    const max = this.getMaxLevel(id);
    if (s.level >= max) return false;
    s.level++;
    return true;
  }

  canLevelUp(id: string): boolean {
    const s = this.spells.find((x) => x.id === id);
    return !!s && s.level < this.getMaxLevel(id);
  }

  /**
   * 道法融合:把基础神通原地换成它的进化形态。
   *
   * 只换 id,不重置等级 —— 玩家不需要重新养,这正是「进化」与
   * 「换一件新装备」的区别。进化形态只有一行数值,所以多出来的等级
   * 自动失效(见 resolveSpell 的 clamp)。
   *
   * @returns 融合后的名称,失败返回 null
   */
  evolve(baseId: string, evolvedId: string): string | null {
    const s = this.spells.find((x) => x.id === baseId);
    if (!s) return null;
    if (!SPELLS[evolvedId]) return null;
    s.id = evolvedId;
    s.lastFiredAt = -9999;
    s.nextBurstAt = 0;
    s.nextSkyThunderAt = 0;
    return SPELLS[evolvedId].name;
  }

  resetCooldowns(): void {
    this.spells.forEach((s) => { s.lastFiredAt = -9999; });
  }

  /** 调试用:直接指定神通栏与等级 */
  debugSetSpells(list: Array<{ id: string; level: number }>): void {
    this.spells = list.map((l) => ({
      id: l.id, level: l.level, lastFiredAt: -9999, nextBurstAt: 0, nextSkyThunderAt: 0,
    }));
  }

  // ===== 每帧 =====

  update(time: number, _delta: number): void {
    const cdMul = this.relicSystem.getCooldownMul();
    for (const s of this.spells) {
      const sp = resolveSpell(s.id, s.level);
      if (!sp) continue;

      // ① 环绕 / 直射本体。冷却乘区(天逆珠 ×0.95^l ÷ 定身术攻速)把间隔压短,
      //    但**压不破 `cooldownFloorMs`**。环绕形态的这个下限是飞剑存活期,
      //    压破了就是两批剑同场(输出源数量翻倍),而不是「多放几发弹」。
      //    实测破口:满配乘区 ×0.595 会让斩罗决 1.97s → 1.17s、峰值 16 把剑。
      const cd = Math.max(sp.cooldownMs * cdMul, sp.cooldownFloorMs);
      if (time - s.lastFiredAt >= cd) {
        this.fire(s, sp, time);
        s.lastFiredAt = time;
      }

      // ② 斩罗:收束斩出的放射剑气。走**自己的计时器**,而且必须**每帧判** ——
      //    这一段以前写在 `fire()` 里,于是被环绕的开火节奏**门控**掉了:
      //    环绕周期被 floor 锁死在 1.9747s,4 秒的门槛永远只能落在它的整数倍上,
      //    配表写的「每 4 秒」实测是 **5.9241s**(第 3 个周期才跨过门槛)。
      //    而天逆珠要能缩短剑气间隔,就更不能挂在这个网格上:×0.595 之后是
      //    2380ms,落在网格上会被抹平成 3949ms —— 收益只剩 33%,乘区本应给 40.5%。
      //    顺序仍排在环绕开火**之后**:让这一拍刚生成的飞剑也一起收束,
      //    读感才是「剑一亮 → 收束 → 斩出去」,而不是「斩了一半才生成剑」。
      //    ⚠️ `everyMs * cdMul`:这是用户明确要的那一条 —— 天逆珠**可以**缩短
      //    剑气,但**动不了环绕**(环绕那一半被 ① 的 floor 锁着)。
      if (sp.def.burst && time >= s.nextBurstAt) {
        this.fireBurst(sp, this.relicSystem.getSpellMods(sp.id), time);
        s.nextBurstAt = time + sp.def.burst.everyMs * cdMul;
      }
    }
  }

  /**
   * 按形态分发。
   *
   * 「要不要先找到目标」也在这里分:自动索敌的形态(雷弧)屏上没怪就不放,
   * 而覆盖一片区域 / 由玩家自己瞄准的形态(扇形、朝向直线、环绕)照常放 ——
   * 玩家可能正在攒冷却等下一个怪潮,空放是他的节奏选择。
   */
  private fire(s: SpellInstance, sp: ResolvedSpell, time: number): void {
    const mods = this.relicSystem.getSpellMods(sp.id);
    switch (sp.form) {
      case 'orbiter': this.fireOrbiter(sp, mods); break;
      case 'cone': this.fireCone(sp, mods); break;
      case 'arc': this.fireArc(sp, mods); break;
      case 'chain': this.fireChain(sp, mods); break;
      case 'projectile': this.fireProjectile(sp, mods); break;
      case 'zone': this.fireZone(sp, mods); break;
      case 'drop': this.fireDrop(sp, mods); break;
      case 'wave': this.fireWave(sp, mods); break;
    }
    // ⚠️ 斩罗的收束剑气**不在这里**了 —— 它已经搬去 `update()` 每帧自查。
    //    留在这个函数里就会被「开火冷却」门控住:这个函数只有冷却到点才被调用,
    //    于是 4 秒的门槛会被量化成环绕周期的整数倍(实测 5.9241s),而且
    //    冷却乘区对它的收益也会被同一张网格抹掉一半。详见 `update()` 的 ②。

    // 天雷引走自己的计时器:它判定的是「场上有没有感电满层的目标」,
    // 与本门神通有没有开火无关 —— 玩家一开手就铺满感电,之后天雷自己会点名
    // ⚠️ 但它**仍然挂在这个函数里**,所以同样受开火节奏门控(配表 2000ms,
    //    实际要等下一次开火才跨过门槛 —— 五雷正法冷却 1.15s,量化后约 2.30s)。
    //    与斩罗剑气是同一个耦合,只是误差小得多(约 +15%),本轮未动。
    if (sp.skyThunderMs > 0 && time >= s.nextSkyThunderAt) {
      s.nextSkyThunderAt = time + sp.skyThunderMs;
      this.fireSkyThunder(sp, mods);
    }
  }

  /**
   * 天雷引 —— 感电满层的目标每 2 秒自动降下一道天雷。
   *
   * 它存在的唯一理由是补雷系的单体短板:未进化时连锁递减在单目标上完全
   * 不生效,打 Boss 明显吃力(满级单体 53 vs 化魔指的 125)。
   *
   * 目标选择:**感电满层**且**当前血量最高** —— 后半句是刻意的,
   * 它让天雷自动集火精英与 Boss,玩家只需要负责铺感电。
   * 「无视递减」体现在这里直接吃 sp.damage 的全额,不走 falloff。
   */
  private fireSkyThunder(sp: ResolvedSpell, mods: SpellRelicMods): void {
    const cap = sp.shockCap + mods.shockCapAdd;
    const now = this.scene.time.now;
    const children = this.enemyGroup.getChildren();
    let best: { e: Enemy; hp: number } | null = null;

    for (let i = 0; i < children.length; i++) {
      const e = children[i] as Enemy;
      if (!e || !e.active || e.isDead) continue;
      if (e.shockActive(now) < cap) continue;
      if (!best || e.health > best.hp) best = { e, hp: e.health };
    }
    if (!best) return;

    const bolt = this.pools.chainBolts.get() as ChainBolt;
    if (!bolt) return;
    bolt.setup(
      best.e.x, best.e.y - 140,
      1, sp.skyThunderDamage * this.player.damageMul,
      0, 0, 1, 0, 0, 0xffffff, {}, 220,
    );
  }

  /**
   * 「杀魂」乘数 —— 局内成长型被动的兑现点。
   *
   * 斜率与上限来自遗物(在 mods 里,随装备重算),击杀数是**本局的实时值**,
   * 所以乘数在这里现算,**不进任何缓存**(同一门神通每次开火都要重读)。
   * 没有这条被动的神通 `killFuryCap` 为 0,直接返回 1 —— 也就是零成本。
   * 公式与暂停面板的显示共用 `killFuryBonus`,两处永不脱钩。
   */
  private killFuryMul(mods: SpellRelicMods): number {
    return 1 + killFuryBonus(mods.killFuryPerKill, mods.killFuryCap, this.getKillCount());
  }

  /** 该形态当前实际伤害 */
  private damageOf(sp: ResolvedSpell, mods: SpellRelicMods): number {
    return sp.damage * mods.damageMul * this.player.damageMul * this.killFuryMul(mods);
  }

  /** 该形态本次发射附带的状态 */
  private statusOf(sp: ResolvedSpell, mods: SpellRelicMods): DamageOptions {
    const slow = sp.slowMul > 0 || mods.slowAdd > 0
      ? { mul: Math.min(0.6, sp.slowMul + mods.slowAdd), ms: sp.slowMs }
      : null;
    return {
      armorPen: Math.max(sp.armorPen, mods.armorPen),
      burn: sp.burn,
      slow,
      shock: null,
      executeBelow: sp.executeBelow,
      sourceId: sp.id,
    };
  }

  /** 直线飞行。aim 决定它朝哪边飞 */
  private fireProjectile(sp: ResolvedSpell, mods: SpellRelicMods): void {
    const fx = this.player.facingX;
    const fy = this.player.facingY;
    let baseAngle = Math.atan2(fy, fx);
    if (sp.aim === 'target') {
      const t = findNearestEnemy(this.enemyGroup, this.player.x, this.player.y, WeaponSystem.TARGET_RADIUS);
      if (!t) return;                    // 自动索敌:屏上没怪就不放
      baseAngle = MathUtils.angle(this.player.x, this.player.y, t.x, t.y);
    }

    const damage = this.damageOf(sp, mods);
    const status = this.statusOf(sp, mods);
    const count = Math.max(1, sp.count);
    // 宽光束(化魔指)必须用更大的张角,否则三道 128px 宽的带子叠在一起,
    // 看上去仍是一道 —— 「范围 ×5」在画面上就不成立
    const spread = count > 1 ? (sp.spreadRad > 0 ? sp.spreadRad : WeaponSystem.DEFAULT_SPREAD) : 0;
    const startOffset = -((count - 1) * spread) / 2;
    const pierce = sp.pierce + mods.pierceAdd;

    // 射程优先于存续:寂灭指的射程由射程决定,而不是由一张手调的秒数决定
    const lifeMs = sp.rangePx > 0 ? (sp.rangePx / Math.max(1, sp.speed)) * 1000 : sp.lifeMs;
    const hitRadius = sp.widthPx > 0 ? sp.widthPx / 2 : 6;

    for (let i = 0; i < count; i++) {
      const a = baseAngle + startOffset + i * spread;
      const proj = this.pools.projectiles.get() as Projectile;
      // 池耗尽时返回 null(依赖 setupPools 设了有限 maxSize),跳过这一发
      if (!proj) continue;
      proj.setup(
        this.player.x + Math.cos(a) * 18,
        this.player.y + Math.sin(a) * 18,
        a, damage, sp.speed, pierce, sp.id, sp.texture, hitRadius, lifeMs, status,
        sp.visualScale,
      );
      if (sp.fireSea) proj.onImpact = (x, y) => this.spawnFireSea(x, y, sp);
    }
  }

  /**
   * 命中处炸开火海。
   *
   * 落点附近已经有活着的火海就叠一层,否则才从池里取一个 ——
   * 「最多 3 层」因此是同一片区域的层数上限,而不是同屏火海的数量上限。
   */
  private spawnFireSea(x: number, y: number, sp: ResolvedSpell): void {
    const sea = sp.fireSea;
    if (!sea) return;
    const radius = sea.radiusGrid * 64;

    const list = this.pools.zones.children.entries;
    for (const z of list) {
      const zone = z as Zone;
      if (!zone.active || zone.isDead) continue;
      if (Math.abs(zone.x - x) > WeaponSystem.SEA_MERGE_PX) continue;
      if (Math.abs(zone.y - y) > WeaponSystem.SEA_MERGE_PX) continue;
      if (zone.addStack()) return;
    }

    const zone = this.pools.zones.get() as Zone;
    if (!zone) return;
    zone.setup(x, y, 0, radius, sea.lifeMs, sea.dps, sp.color, sea.maxStacks, sea.texture);
  }

  /** 环绕 */
  private fireOrbiter(sp: ResolvedSpell, mods: SpellRelicMods): void {
    const damage = this.damageOf(sp, mods);
    const count = Math.max(1, sp.count + mods.orbAdd);
    // 仙剑 5 级的「穿透」:命中冷却减半 → 同一只怪被犁得更勤
    // ⚠️ 这里**曾经**是 `hitCdMs * (pierceAdd > 0 ? 0.5 : 1)`,现在改成不动冷却。
    //    理由是实测:环绕 DPS = 飞剑数 × 伤害 ÷ 一圈时长,而能不能打第二下取决于
    //    飞剑**有没有转回去**。把冷却压到半圈,命中次数只从 2 变 3 —— 因为它总共
    //    只经过那个位置 3 次。真正的旋钮是转速,见 mods.orbitSpeedMul。
    const hitCdMs = sp.hitCdMs;
    const orbitSpeed = sp.orbitSpeed * (mods.orbitSpeedMul ?? 1);

    for (let i = 0; i < count; i++) {
      const orb = this.pools.orbiters.get() as Orbiter;
      if (!orb) continue;
      orb.setup(
        (i / count) * Math.PI * 2,
        damage,
        sp.orbitRadius,
        orbitSpeed,
        sp.lifeMs,
        hitCdMs,
        sp.texture,
        this.statusOf(sp, mods),
        sp.visualScale,
        // 轨道环由第 0 把剑代画 —— 每次施法只有一圈,不是每把剑一圈
        i === 0,
      );
    }
  }

  /** 扇形推进 + 推挤 + 崩墙 */
  private fireCone(sp: ResolvedSpell, mods: SpellRelicMods): void {
    const facing = Math.atan2(this.player.facingY, this.player.facingX);
    const damage = this.damageOf(sp, mods);
    const status = this.statusOf(sp, mods);

    const wave = this.pools.sandWaves.get() as SandWave;
    if (wave) {
      wave.setup(
        this.player.x, this.player.y, facing,
        damage,
        sp.coneRadius,
        sp.coneSpan,
        sp.segments,
        (sp.pushPx * mods.pushMul) / WeaponSystem.PUSH_SECONDS,
        sp.count,                       // count 在扇形形态上是「命中上限」
        sp.lifeMs,
        sp.color,
        status,
        sp.clearsShots,
      );
    }

    // 崩墙只在扇面末端:半径取扇形边界的九成,让土墙正好卡在沙浪推到的位置
    if (sp.barrierMs > 0) {
      const wall = this.pools.barriers.get() as Barrier;
      if (wall) {
        wall.setup(
          this.player.x, this.player.y,
          sp.coneRadius * 0.92,
          facing, sp.coneSpan,
          sp.barrierMs, 40, 600, 0x8a6a3a,
        );
      }
    }
  }

  /**
   * 弧带推进 + 牵引 + (呼风)主龙与吹熄
   *
   * ## 两个角度:`arcSpan` 管方向,`arcWidth` 管形状
   *
   * `arcSpan` 是**散布角** —— `count` 道弧弹的方向在这个角内均分:
   * 3 道 × 220° = 每 73° 一道;仙术·呼风 8 道 × 360° ÷ 8 = **每 45° 一道**,
   * 与设计书那句话一字不差。1 道时散布角不生效(`start + sub*0.5` 恒等于 facing)。
   *
   * `arcWidth` 是**单道弧弹自身的张角**,与散布角无关:
   *   - 填了(基础龙卷 50°)= 各道之间留空档 → 画面上是 **N 道分开飞出去的弯弹**;
   *   - 不填(= 沿用 `sub`)= 各道首尾相接 → 合成**一整片弧面**。
   *     呼风靠「不填」保住它的「全周一圈」,见 SpellConfig 的说明。
   *
   * ## 为什么必须分开:同向多道会完全重叠
   *
   * 多道若都朝 facing 且宽度不变,3 道只是把同一片弧打了 3 遍,道数就退化成
   * 纯伤害倍率。所以方向要**分开**(同心弧),这是从呼风的 8×45° 反推出来的规则。
   */
  private fireArc(sp: ResolvedSpell, mods: SpellRelicMods): void {
    // 弧向由释放瞬间的移动方向决定 —— 全体系唯一把走位当瞄准用的形态
    const facing = Math.atan2(this.player.facingY, this.player.facingX);
    const damage = this.damageOf(sp, mods);
    const status = this.statusOf(sp, mods);
    const count = Math.max(1, sp.count);
    const span = Math.min(Math.PI * 2, sp.arcSpan * mods.arcSpanMul);
    // 道间距。1 道时 sub = 0,而 face 恰好落在 facing 上,散布角无损
    const sub = span / count;
    const start = facing - span / 2;
    // 单道实际张角。画轴的弧角加成作用**在这里**而不是散布角上:
    // 加成散布角会把弹打得更散、在正前开出一个谁都打不到的死区,
    // 而加宽单道是单调的收益 —— 加满时相邻两道几近相切,又变回一片连续弧面。
    const perArc = sp.arcWidth > 0 ? sp.arcWidth * mods.arcSpanMul : sub;
    const pullSpeed = sp.pullPx / WeaponSystem.PULL_SECONDS;
    const pullMs = WeaponSystem.PULL_SECONDS * 1000;
    // 本次释放的**共用**命中表:同一目标最多结算 2 次,不论被几道刮到。
    // 建在这里而不是每道一张,理由见 Tornado.hitCounts 的长注释
    const sharedHits = new Map<Enemy, number>();

    // 风助火势的注入点:把风的当前位置报给每一片扫到的火海。
    // 「同一片火海只扩一次」的去重**不在**这里 —— 曾建在释放闭包里,
    // 挡得住一次施放内的八道黑龙,挡不住下一次施放,连发呼风就是无限触发;
    // 现在由 Zone.windFed 在实例上一票否决(见 expandByWind)。
    // 判定放宽到「外圈被风掠到就算经过」(前缘半径 + 火海外径),不要求
    // 火海圆心真的进带 —— 风是面,不是线,吹到边缘也算吹到。
    const feedWind = (x: number, y: number, reach: number): void => {
      for (const c of this.pools.zones.children.entries) {
        const z = c as Zone;
        if (!z.active || z.isDead) continue;
        if (Math.hypot(z.x - x, z.y - y) > reach + z.outerRadius) continue;
        z.expandByWind();
      }
    };

    for (let i = 0; i < count; i++) {
      const t = this.pools.tornadoPool.get() as Tornado;
      // 池耗尽时返回 null(有限 maxSize),少放一道就少放一道,不抛
      if (!t) continue;
      t.setup(
        this.player.x, this.player.y,
        start + sub * (i + 0.5), perArc,
        sp.arcRadius,
        damage,
        pullSpeed, pullMs,
        sp.lifeMs,
        sp.color,
        // 弧带的**旋卷量**不随遗物变 —— 画轴买的是覆盖面,不是转圈数
        sp.arcSweep,
        sharedHits,
        sp.texture,
        status,
        feedWind,
      );
    }

    // 主龙:固定在正前方、伤害 ×1.5 的**第 9 道**。
    // 它刻意与八道黑龙重叠在正前这一段 —— 因为整套术法里只有它是可瞄准的
    if (sp.mainDragonMul > 0) {
      const t = this.pools.tornadoPool.get() as Tornado;
      if (t) {
        t.setup(
          this.player.x, this.player.y,
          facing, perArc,
          sp.arcRadius,
          damage * sp.mainDragonMul,
          pullSpeed, pullMs,
          sp.lifeMs,
          sp.color,
          sp.arcSweep,
          sharedHits,
          sp.texture,
          status,
          feedWind,
        );
      }
    }
  }

  /** 瞬时连锁 */
  private fireChain(sp: ResolvedSpell, mods: SpellRelicMods): void {
    const t = findNearestEnemy(this.enemyGroup, this.player.x, this.player.y, WeaponSystem.TARGET_RADIUS);
    if (!t) return;
    const bolt = this.pools.chainBolts.get() as ChainBolt;
    if (!bolt) return;
    bolt.setup(
      this.player.x, this.player.y,
      sp.count,                         // count 在连锁形态上是「道数」
      this.damageOf(sp, mods),
      sp.jumps,
      sp.chainRange,
      sp.falloff,
      sp.shockCap + mods.shockCapAdd,
      sp.shockMs + mods.shockMsAdd,
      sp.color,
      this.statusOf(sp, mods),
      sp.lifeMs,
    );
  }

  /** 地效:当前没有法术直接使用,保留给后续新增 */
  private fireZone(sp: ResolvedSpell, mods: SpellRelicMods): void {
    const t = findNearestEnemy(this.enemyGroup, this.player.x, this.player.y, WeaponSystem.TARGET_RADIUS);
    if (!t) return;
    const zone = this.pools.zones.get() as Zone;
    if (!zone) return;
    zone.setup(
      t.x, t.y, this.damageOf(sp, mods), sp.coneRadius, sp.lifeMs, sp.damage,
      sp.color, 1,
    );
  }

  /**
   * 落锥:面前依次落下的冰锥(黄泉升窍诀)。
   *
   * 首道落点固定在面向 2 格处,后续每道 +dropGap(由表给出),
   * 道与道错开 DROP_STAGGER_MS —— 面向在**施放瞬间**锁定,玩家转脸
   * 不影响这一轮;这也是它与自动索敌形态的空间判读差异所在。
   */
  private fireDrop(sp: ResolvedSpell, mods: SpellRelicMods): void {
    const facing = Math.atan2(this.player.facingY, this.player.facingX);
    const drop = this.pools.iceSpikes.get() as IceSpikeDrop;
    if (!drop) return;
    drop.setup(
      this.player.x, this.player.y, facing,
      Math.max(1, sp.count),
      this.damageOf(sp, mods),
      sp.dropRadius, sp.dropGap,
      WeaponSystem.FIRST_DROP_PX,
      sp.impactDelayMs,
      WeaponSystem.DROP_STAGGER_MS,
      sp.color,
      this.statusOf(sp, mods),
    );
  }

  /**
   * 浪扫:面前长方形水浪(道化黄泉)。
   *
   * 伤害与形状全部交给 UnderworldWave —— 前沿推进期结算(单怪一次),
   * 残留期只刷减速。这里只负责把表的矩形尺寸与两段时长原样递过去。
   */
  private fireWave(sp: ResolvedSpell, mods: SpellRelicMods): void {
    const facing = Math.atan2(this.player.facingY, this.player.facingX);
    const wave = this.pools.waves.get() as UnderworldWave;
    if (!wave) return;
    wave.setup(
      this.player.x, this.player.y, facing,
      this.damageOf(sp, mods),
      sp.rectLength, sp.rectWidth,
      sp.waveFrontMs, sp.waveLingerMs,
      sp.color,
      this.statusOf(sp, mods),
    );
  }

  /**
   * 斩罗 —— 每 4 秒的放射状剑气。
   *
   * 直接用投射物池均分角度发射,而不是新建一个「放射」形态:
   * 一道贯穿全场的剑气在物理上就是一发速度很快、穿透无限的弹。
   * 新建形态只会多出第二个要调池容量、要重置字段、要写 preUpdate 的类。
   *
   * 道数跟着当前飞剑数走,所以仙剑每叠一级,覆盖密度就多一道。
   */
  private fireBurst(sp: ResolvedSpell, mods: SpellRelicMods, _time: number): void {
    const b = sp.def.burst;
    if (!b) return;
    const count = b.count > 0 ? b.count : Math.max(1, sp.count + mods.orbAdd);
    const damage = b.damage * mods.damageMul * this.player.damageMul * this.killFuryMul(mods);
    const status: DamageOptions = { armorPen: b.armorPen, burn: b.bleed, slow: null, shock: null, sourceId: sp.id };

    // 「收束」:所有在飞的剑先向内缩一下再斩出去。
    // 少了这一下,斩罗在屏幕上就是「几颗青点飞走了」,和环绕的剑长得一样,
    // 玩家根本分不出刚才发生了什么 —— 而这是每 4 秒才出现一次的招牌动作。
    const orbs = this.pools.orbiters.getChildren();
    for (let i = 0; i < orbs.length; i++) {
      const o = orbs[i] as Orbiter;
      if (o.active && !o.isDead) o.contract(Orbiter.CONTRACT_MS);
    }

    for (let i = 0; i < count; i++) {
      const a = (i / count) * Math.PI * 2;
      const proj = this.pools.projectiles.get() as Projectile;
      if (!proj) continue;
      proj.setup(
        this.player.x + Math.cos(a) * 24,
        this.player.y + Math.sin(a) * 24,
        a, damage, b.speedGrid * 64, 999, sp.id, 'proj_zhanluo',
        b.widthGrid * 64 / 2, b.lifeMs, status, 1.4,
      );
    }
  }

  /** 攻击形态的注册表。调试面板与自检都靠它,别在别处硬写形态名 */
  static formOf(id: string): AttackForm | null {
    return SPELLS[id]?.form ?? null;
  }
}