import Phaser from 'phaser';
import { BOSSES, BOSS_SCHEDULE, METEOR_COLOR } from '../config/BossConfig';
import type { BossDef, BossPhaseDef, BossShotStyle } from '../config/BossConfig';
import { WORLD_WIDTH, WORLD_HEIGHT } from '../config/GameConfig';
import { GameEvents } from '../types';
import type { Enemy } from '../entities/Enemy';
import type { ShotStyle } from '../entities/EnemyShot';

export interface BossDeps {
  /** 从池里生成一只首领。返回 null 表示池已满(不排队,直接放弃这一只) */
  spawnBoss: (bossId: string) => Enemy | null;
  /** 发一发敌方弹丸。style 决定它的外观(火羽 / 签文 / 剑气) */
  spawnShot: (x: number, y: number, angle: number, damage: number, speed: number, style?: ShotStyle) => void;
  /** 落点预警圈(火雨)。**已改走 spawnMeteor** —— 保留是因为它仍是地火的入口 */
  spawnVent: (x: number, y: number, radius: number, warnMs: number, eruptMs: number, damage: number) => void;
  /**
   * 朱雀·火雨:一颗从右上斜坠的紫红陨石,落在 (x, y)。
   *
   * 为什么不再是 `spawnVent`:地火的橙红火柱、玩家火海的深血红燃烧区,
   * 加上朱雀的火雨,三者原先全是「地面一团橙红」—— 玩家没法从画面上读出
   * 「这团火归谁」。陨石在**形态**(天上斜坠 vs 地面柱状)、**结算**(单次爆发
   * vs 持续 tick)、**色相**(紫红 0xcc33cc)三个维度上同时与另两者分开。
   */
  spawnMeteor: (x: number, y: number, radius: number, warnMs: number, damage: number, color: number) => void;
  /** 天运·命数指:一根从天而降的巨型虚化手指落向 (x, y) */
  spawnFinger: (x: number, y: number, radius: number, warnMs: number, damage: number, color: number) => void;
  /** 天运·命数:镀金至多 count 只小怪,返回实际镀上的数量 */
  buffEnemies: (count: number, hpMul: number, speedMul: number, damageMul: number) => number;
  /**
   * 环形羽爆炸开的那一帧的场面特效。
   *
   * 它**只给位置与颜色**,不描述画什么 —— 「爆一圈冲击环」是表现层的决定,
   * 系统层只负责说「这里刚放了一发 nova」。这样换美术不需要碰 BossSystem。
   */
  novaBurst?: (x: number, y: number, radius: number, color: number) => void;
  getPlayer: () => { x: number; y: number };
  /**
   * 玩家当前速度(px/s)。命数指的**提前量**要用它外推落点。
   *
   * 取速度而不是「下一帧位置」:它由 InputManager 写、每帧稳定,
   * 而这一招要判断的是「玩家正朝哪跑」,不是「玩家此刻挪了多少像素」。
   */
  getPlayerVelocity?: () => { x: number; y: number };
  /**
   * 剑域:玩家是否正站在域里。返回 true 表示**这一 tick 该扣血**。
   *
   * 判定放在表现层(GameScene)而不是这里,因为「玩家在不在域内」是一个纯几何问题,
   * 而域的中心(首领位置)与半径都在表现层才算得出来 —— 系统层只需要知道
   * 「这一下有一个人被烧到了」。与 novaBurst 同一口径:系统描述**发生了什么**,
   * 表现层决定**画成什么样**。
   */
  domainTick?: (x: number, y: number, radius: number, damage: number) => void;
  /**
   * 召唤剑肖十二子。系统只说「召几名、召什么」,落点与特效由表现层决定。
   * 返回**实际召出的数量**(池满 / 触达 maxAlive 时可能少于 count)。
   */
  summon?: (type: string, count: number, maxAlive: number) => number;
}

interface BossTimers {
  fanAt: number;
  novaAt: number;
  rainAt: number;
  fingerAt: number;
  fateAt: number;
  blinkAt: number;
  summonAt: number;
  /** 杀戮仙诀遮罩的下一次张开时刻 */
  shieldAt: number;
  /**
   * 剑域的伤害 tick 截止时刻。**过期的**时候才结算一次,而不是每帧结算 ——
   * 每帧扣 1/60 的话伤害数字会变成刷屏的杂讯,且玩家读不出「我在被烧」。
   */
  domainTickAt: number;
  /** 当前生效的剑域半径。每帧由 syncDomain 更新,blood 用它算距离 */
  domainRadius: number;
  /** 剑域是否在本帧生效(阶段没有 domain 时为 false,贴图也该收起来) */
  domainOn: boolean;
  /**
   * 前摇截止时刻。大于 0 表示「这一招已锁定,但还没打出去」。
   *
   * 前摇不是装饰。到点即发的话,玩家唯一的反应窗口是「看到弹幕」——
   * 而弹幕一旦出现,躲与不躲已经决定了。加一段几百毫秒的蓄力,出招的那一刻
   * Boss 先亮一下,玩家才有**预读**的余地:这是把 Boss 从「数值压力」变成
   * 「操作压力」的唯一杠杆,也是《怪物设计》第五节要的「靠操作续命」。
   */
  windupUntil: number;
  /** 蓄力中的是哪一招。前摇走完时靠它决定放什么 */
  pendingKind: '' | 'fan' | 'nova' | 'rain' | 'finger';
}

/** 前摇时长(毫秒)基准。实际时长还要 / tempo —— 狂暴阶段出招更快,前摇也更短 */
const WINDUP_MS = 320;

/**
 * 首领系统 —— 时间表 + 阶段
 *
 * 它**不写敌人的速度**。EnemyAiSystem 是敌人速度唯一的作者(见 CLAUDE.md),
 * 本类只回答「什么时候出什么招」,由 AI 的 boss 分支回调过来。
 * 拆开之后首领的移动手感与普通怪完全一致,不会因为多了一套 AI 而失衡。
 */
export class BossSystem {
  private scene: Phaser.Scene;
  private deps: BossDeps;
  private timers = new Map<Enemy, BossTimers>();

  /** 当前在场的首领。UIScene 的血条直接读它的 health/maxHealth */
  public current: Enemy | null = null;
  private fired = new Set<string>();

  constructor(scene: Phaser.Scene, deps: BossDeps) {
    this.scene = scene;
    this.deps = deps;
  }

  update(seconds: number): void {
    for (const def of BOSS_SCHEDULE) {
      if (this.fired.has(def.id)) continue;
      if (seconds < def.atSeconds) continue;
      this.fired.add(def.id);
      const e = this.deps.spawnBoss(def.id);
      if (e) {
        this.current = e;
        this.scene.events.emit(GameEvents.BOSS_SPAWNED, def.id);
      }
    }
  }

  /** 首领死亡时由 GameScene 叫来:清血条 */
  onBossKilled(): void {
    if (this.current) this.timers.delete(this.current);
    this.current = null;
  }

  /** 立即放某只首领(调试面板用)。清掉已放标记,好让调试能反复看 */
  forceSpawn(bossId: string): string {
    const def = BOSSES[bossId];
    if (!def) return '没有这只首领';
    this.fired.delete(bossId);
    const e = this.deps.spawnBoss(bossId);
    if (!e) return '敌人池已满';
    this.current = e;
    this.scene.events.emit(GameEvents.BOSS_SPAWNED, def.id);
    return `${def.name} 登场`;
  }

  /**
   * 首领的一次行动。由 EnemyAiSystem 的 boss 分支在到点时调用。
   *
   * 各招按各自独立的计时器走:扇、环形羽爆、雨、命数、闪现不必同频,
   * 硬绑在一起会让阶段压迫感变成一个规整的节拍器,反而好躲。
   *
   * ⚠️ 前摇只服务于**瞬间出现弹幕**的那几招(fan / nova / rain):玩家需要在
   *    弹幕出现之前读到它,否则「看到弹幕」时躲与不躲已经定了。
   *    其余招式各有各的预告方式,不叠这一层:
   *      - fate / blink:没有「打出去」这一刻,提前亮光既不改变什么也无从表现
   *      - finger:前摇长在实体自己身上(手指从天上降 1.5–1.7 秒),
   *        再叠 320ms 蓄力光是重复的
   */
  act(enemy: Enemy): void {
    const def = BOSSES[enemy.bossKey];
    if (!def || !enemy.active) return;
    const now = this.scene.time.now;
    const hpRatio = Math.max(0, enemy.health / enemy.maxHealth);

    // 浴火重生:只在跨过阈值的那一刻触发一次。
    // bossRebornUsed 保证只有一次 —— 否则这只 Boss 永远打不死。
    if (def.rebirthAtHp !== undefined && !enemy.bossRebornUsed && hpRatio <= def.rebirthAtHp) {
      enemy.bossRebornUsed = true;
      enemy.health = enemy.maxHealth;
      enemy.bossPhase = def.rebirthPhase ?? def.phases.length - 1;
      this.timers.delete(enemy);
      this.scene.events.emit('boss-reborn', def.id);
      return;                    // 回满当帧不出招,给玩家一眼看清「它变了」
    }

    const p = this.phaseOf(def, hpRatio);
    enemy.bossPhase = def.phases.indexOf(p);

    let t = this.timers.get(enemy);
    if (!t) {
      // 五招错开初次出手的时间 —— 同时落下只会合成一个「大招」,然后长时间空转
      t = {
        fanAt: now + 1200, novaAt: now + 2400, rainAt: now + 2600,
        fingerAt: now + 3600, fateAt: now + 3400, blinkAt: now + 2200,
        summonAt: now + 4000, shieldAt: now + 8000,
        domainTickAt: 0, domainRadius: 0, domainOn: false,
        windupUntil: 0, pendingKind: '',
      };
      this.timers.set(enemy, t);
    }

    // 剑域是**每帧**的事,不是「到点放一次」的事 —— 它必须在前摇 return 之前
    // 就被结算,否则首领一蓄力,领域就跟着静默 320ms,玩家读到的「站在域里」
    // 会变成断断续续的。这也是它不进 pendingKind 的原因:它不是一「招」。
    this.syncDomain(enemy, p, t, now);

    // 前摇中:只等它走完,不出新招。同一时刻只蓄一招 —— 几个计时器同时
    // 到点时如果各蓄各的,前摇就变成了一次「多招一起亮」,预读失去意义
    if (t.windupUntil > 0) {
      if (now >= t.windupUntil) {
        t.windupUntil = 0;
        // ⚠️ 用**蓄力时的招式**去打,而不是当前阶段的 `p` —— 前摇的这 300ms 里
        //    玩家可能刚好把它打进下一阶段,而下一阶段未必有这一招(比如朱雀
        //    二阶没有 nova)。那时 releasePending 会因为 p.nova 不存在而静默落空,
        //    表现为「亮了一下光却没出招」。所以按 pendingKind 直接取招式表,
        //    再回落到当前阶段。
        this.releasePending(enemy, p, t, now);
      }
      enemy.bossNextActionAt = t.windupUntil > 0 ? t.windupUntil : this.nextSlot(p, t, now);
      return;
    }

    // 无 Boss 前摇的两招到点即发(fate / blink)。
    // 命数指也走这一支:它的前摇**长在实体自己身上**(手指从天上缓缓降下
    // 1.5–1.7 秒),再叠一层 Boss 的 320ms 蓄力光是重复的 —— 那一段
    // 「看着它落下来」的过程本身就是全部预告。
    if (p.fate && now >= t.fateAt) {
      this.deps.buffEnemies(p.fate.count, p.fate.hpMul, p.fate.speedMul, p.fate.damageMul);
      t.fateAt = now + p.fate.intervalMs / p.tempo;
    }
    if (p.blink && now >= t.blinkAt) {
      this.castBlink(enemy, p.blink, now);
      t.blinkAt = now + p.blink.intervalMs / p.tempo;
    }
    // 杀戮仙诀:到点即发,不叠前摇 —— 它的「预告」就是罩子亮起来本身。
    // 而那是**保护**不是威胁,再给 320ms 蓄力光只会让玩家以为它要放大招。
    if (p.shield && now >= t.shieldAt) {
      this.castShield(enemy, p.shield, now);
      // ⚠️ 这里的间隔**不除 tempo** —— 免伤窗口占的是一局总 DPS 的固定比例,
      //    跟着狂暴一起缩短会把它从「节奏题」压成「数值墙」(见 BossShieldDef)
      t.shieldAt = now + p.shield.intervalMs;
    }
    if (p.finger && now >= t.fingerAt) {
      this.castFinger(p.finger);
      t.fingerAt = now + p.finger.intervalMs / p.tempo;
    }
    // 召唤走这一支而不是前摇支:十二子是**从场边走进来的**,
    // 他们的「预告」就是他们自己出现的这个过程,不需要再叠一层蓄力光
    if (p.summon && now >= t.summonAt) {
      this.castSummon(enemy, p.summon);
      t.summonAt = now + p.summon.intervalMs / p.tempo;
    }

    // 有弹幕的三招:谁到点谁先蓄。取最早到点的那个,避免高 tempo 阶段
    // 出现「一直在等最晚的那一招」而其他招空转
    let pending: '' | 'fan' | 'nova' | 'rain' = '';
    let earliest = Infinity;
    if (p.fan && now >= t.fanAt && t.fanAt < earliest) { earliest = t.fanAt; pending = 'fan'; }
    if (p.nova && now >= t.novaAt && t.novaAt < earliest) { earliest = t.novaAt; pending = 'nova'; }
    if (p.rain && now >= t.rainAt && t.rainAt < earliest) { earliest = t.rainAt; pending = 'rain'; }

    if (pending) {
      t.windupUntil = now + WINDUP_MS / p.tempo;
      t.pendingKind = pending;
      enemy.bossCastFlashUntil = t.windupUntil;
      enemy.bossCastKind = pending;
      enemy.bossNextActionAt = t.windupUntil;
      return;
    }

    enemy.bossNextActionAt = this.nextSlot(p, t, now);
  }

  /**
   * 前摇走完,真正把那一招打出去。
   *
   * 取的是**当前阶段**对应那一招;若当前阶段没有(前摇期间刚好被玩家打进新阶段,
   * 而新阶段撤掉了这一招),就把它的计时器推后一个间隔、静默跳过 ——
   * 不推后的话它会每帧都到点,变成连续蓄力的死循环。
   */
  private releasePending(enemy: Enemy, p: BossPhaseDef, t: BossTimers, now: number): void {
    enemy.bossCastKind = '';
    switch (t.pendingKind) {
      case 'fan':
        if (p.fan) {
          this.castFan(enemy, p.fan);
          t.fanAt = now + p.fan.intervalMs / p.tempo;
        } else {
          t.fanAt = now + 1000;
        }
        break;
      case 'nova':
        if (p.nova) {
          this.castNova(enemy, p.nova);
          t.novaAt = now + p.nova.intervalMs / p.tempo;
        } else {
          t.novaAt = now + 1000;
        }
        break;
      case 'rain':
        if (p.rain) {
          this.castRain(p.rain);
          t.rainAt = now + p.rain.intervalMs / p.tempo;
        } else {
          t.rainAt = now + 1000;
        }
        break;
      default:
        break;
    }
    t.pendingKind = '';
  }

  /**
   * 下一个真正有意义的动作时刻。
   *
   * 只统计本阶段**真有的**招式 —— 没有的招计时器停在过去,混进 min 会让 AI
   * 每帧都来问一次(空转)。fate / blink 算进来,是因为它们也必须被及时唤醒。
   */
  private nextSlot(p: BossPhaseDef, t: BossTimers, now: number): number {
    let next = now + 60000;
    if (p.fan) next = Math.min(next, t.fanAt);
    if (p.nova) next = Math.min(next, t.novaAt);
    if (p.rain) next = Math.min(next, t.rainAt);
    if (p.finger) next = Math.min(next, t.fingerAt);
    if (p.fate) next = Math.min(next, t.fateAt);
    if (p.blink) next = Math.min(next, t.blinkAt);
    if (p.shield) next = Math.min(next, t.shieldAt);
    if (p.summon) next = Math.min(next, t.summonAt);
    return next;
  }

  /**
   * 剑域的每帧结算。
   *
   * ⚠️ 它**不返回任何东西,也不短路 act()** —— 领域是「场地」,不是一「招」。
   *    把它塞进 pendingKind 会出现「首领在蓄力扇形时,玩家站域里反而不掉血」,
   *    因为那个分支会提前 return。场地必须一直在。
   *
   * 半径变化用**每帧直写**而不是 tween:阶段切换是瞬时的(血量跨过阈值),
   * 领域如果平滑过渡,玩家会看到「域在慢慢长大」却不知道是哪一刻变的,
   * 而那一刻正是他需要重新算距离的时候。突变 + 一次明显的换阶特效更诚实。
   */
  private syncDomain(enemy: Enemy, p: BossPhaseDef, t: BossTimers, now: number): void {
    if (!p.domain) {
      t.domainOn = false;
      t.domainRadius = 0;
      return;
    }
    t.domainOn = true;
    t.domainRadius = p.domain.radius;

    if (now < t.domainTickAt) return;
    t.domainTickAt = now + p.domain.tickMs;

    const player = this.deps.getPlayer();
    const dx = player.x - enemy.x;
    const dy = player.y - enemy.y;
    if (dx * dx + dy * dy > p.domain.radius * p.domain.radius) return;

    // 一口的量 = dps × 间隔占比。这样「每秒掉多少」与 tickMs 无关,
    // 改 tick 频率只影响手感(数字多密),不影响难度
    const damage = p.domain.dps * (p.domain.tickMs / 1000);
    this.deps.domainTick?.(player.x, player.y, p.domain.radius, damage);
  }

  /**
   * 点名剑肖十二子。
   *
   * `maxAlive` 由表现层数(它才知道场上活着的弟子有几只),系统只负责
   * 「按阶段给上限」。这样「场上已经有一堆弟子时不再召」这条规则不需要
   * BossSystem 去遍历敌人池 —— 那是表现层的领地。
   */
  private castSummon(enemy: Enemy, s: NonNullable<BossPhaseDef['summon']>): void {
    this.deps.summon?.(s.type, s.count, s.maxAlive);
    void enemy;
  }
  /** 供表现层读取的剑域状态。GameScene 的 updateBossDomain 每帧拉 */
  domainState(): { on: boolean; radius: number; x: number; y: number } {
    const e = this.current;
    const t = e ? this.timers.get(e) : undefined;
    if (!e || !e.active || e.isDead || !t || !t.domainOn) {
      return { on: false, radius: 0, x: 0, y: 0 };
    }
    return { on: true, radius: t.domainRadius, x: e.x, y: e.y };
  }

  /**
   * 杀戮仙诀 —— 四方符印护体(白色符阵),期间本体完全免伤。
   *
   * ⚠️ 免伤**不在这里自己记表**,而是写进实体的 `invulnerableUntil`:
   *    伤害入口只有 `Enemy.takeDamage` 一个,所有攻击形态(弹体、地面区域、
   *    弧带、环绕、连锁)自然全部尊重它 —— 与闪现同一套做法。
   *    `shieldUntil` 是**另一条**通道,只喂表现层(符印+白化)。
   *
   * 用 max 而不是直接赋值:闪现的无敌(1–1.5s)可能刚好落在罩子期间,
   * 直接覆盖会把 5 秒的罩子缩成闪现剩下的那点时间。
   */
  private castShield(enemy: Enemy, s: NonNullable<BossPhaseDef['shield']>, now: number): void {
    const until = now + s.durationMs;
    enemy.shieldUntil = until;
    enemy.shieldRadius = s.radius;
    enemy.invulnerableUntil = Math.max(enemy.invulnerableUntil, until);
  }

  /**
   * 供表现层读取的遮罩状态。GameScene 的 updateBossShield 每帧拉 ——
   * 与 domainState 同一口径:系统说「罩子还亮着、多大」,画成什么样由表现层定。
   */
  shieldState(): { on: boolean; radius: number; x: number; y: number; until: number } {
    const e = this.current;
    if (!e || !e.active || e.isDead) return { on: false, radius: 0, x: 0, y: 0, until: 0 };
    const on = this.scene.time.now < e.shieldUntil;
    return { on, radius: e.shieldRadius, x: e.x, y: e.y, until: e.shieldUntil };
  }

  private phaseOf(def: BossDef, hpRatio: number): BossPhaseDef {
    for (const p of def.phases) {
      if (hpRatio > p.hpAbove) return p;
    }
    return def.phases[def.phases.length - 1];
  }

  /** 把招式的外观字段收成一个 ShotStyle。表里没写 = 退回普通敌弹 */
  private styleOf(def: BossShotStyle, fallback: number): ShotStyle {
    return {
      texture: def.texture ?? 'proj_enemy_shot',
      color: def.color ?? fallback,
      spin: def.spin ?? 0,
      trail: def.trail ?? false,
      // 不写 `?? 4` —— 缺省值留在实体层(EnemyShot.DEFAULT_HIT_RADIUS)。
      // 配置层没给就等于「不覆盖」,这样默认半径只有一个出处,改一处全局生效。
      hitRadius: def.hitRadius,
    };
  }

  /** 火羽扇 —— 一道有缺口的扇形,缺口方向背对玩家 */
  private castFan(enemy: Enemy, fan: NonNullable<BossPhaseDef['fan']>): void {
    const player = this.deps.getPlayer();
    const base = Phaser.Math.Angle.Between(enemy.x, enemy.y, player.x, player.y);
    const step = fan.count > 1 ? fan.spread / (fan.count - 1) : 0;
    const style = this.styleOf(fan, 0xff6622);
    for (let i = 0; i < fan.count; i++) {
      const a = base - fan.spread / 2 + i * step;
      this.deps.spawnShot(enemy.x, enemy.y, a, fan.damage, fan.speed, style);
    }
  }

  /**
   * 环形羽爆 —— 360° 等分的一整圈。
   *
   * 与扇形最大的不同是**它不瞄准玩家**。扇形总有「背对 Boss 的那一侧」是安全的,
   * 环形没有;玩家唯一的选择是「穿过哪两片之间」。所以这里不读 player 的位置 ——
   * 一旦让它朝玩家偏向,这招就退化成一个「更宽的扇形」,那条经验又回来了。
   */
  private castNova(enemy: Enemy, nova: NonNullable<BossPhaseDef['nova']>): void {
    const style = this.styleOf(nova, 0xff6622);
    // 整圈随机转一个小角度:两圈之间缝隙错开,不然玩家能找出一条永远安全的直线
    const jitter = nova.angleJitter ? (Math.random() * 2 - 1) * nova.angleJitter : 0;
    const step = (Math.PI * 2) / nova.count;
    for (let i = 0; i < nova.count; i++) {
      this.deps.spawnShot(enemy.x, enemy.y, jitter + i * step, nova.damage, nova.speed, style);
    }
    // 爆炸圈的直径按「弹幕能飞多远」估:一圈的**外沿**才是玩家看见的范围。
    // 弹速 × 0.9s ≈ 弹幕铺开的半径,那是这一招真正占住的场地
    this.deps.novaBurst?.(enemy.x, enemy.y, nova.speed * 0.9, style.color ?? 0xff6622);
  }

  /**
   * 命数指 —— 一根/几根巨型虚化手指从天而降。
   *
   * ## 落点为什么要「提前量」而不是「必中」
   *
   * 直接用玩家当前位置的话,这一招会变成「无论怎么走都会挨一下」——
   * 那不是走位题,是扣血题,玩家唯一能做的是回血。给一点提前量(leadPx),
   * 博弈就回来了:站着不动必中,朝反方向跑就能躲开。
   * 外推用**玩家当前速度**而不是随机偏移 —— 玩家看见自己往哪跑,
   * 就该能预期手指落在哪,读得懂才有得躲。
   *
   * ## 为什么 count>1 时按角度散开而不是各罩一点
   *
   * 几根指头各随机落一处,会出现「三根挤在一起」或「三根都落空」的极端;
   * 沿玩家速度的法线方向左右均分,才能稳定封住一段横向走位空间 ——
   * 那正是「合围」该有的样子。
   */
  private castFinger(finger: NonNullable<BossPhaseDef['finger']>): void {
    const player = this.deps.getPlayer();
    const vel = this.deps.getPlayerVelocity?.() ?? { x: 0, y: 0 };
    const speed = Math.hypot(vel.x, vel.y);

    // 朝玩家移动方向外推。速度很低(几乎站着)时退化成「正中脚下」——
    // 站着不动本来就该挨打
    let aimX = player.x;
    let aimY = player.y;
    if (speed > 1) {
      aimX += (vel.x / speed) * finger.leadPx;
      aimY += (vel.y / speed) * finger.leadPx;
    }

    const color = finger.color ?? 0xd8b860;
    const spread = finger.spreadRad ?? 0.5;

    for (let i = 0; i < finger.count; i++) {
      // 单根:直接落在瞄准点。多根:沿瞄准点的法线方向左右铺开
      let ox = 0;
      let oy = 0;
      if (finger.count > 1) {
        // 把「第 i 根」映射到 [-1, 1] 的横向偏移(0 根时居中)
        const slot = finger.count === 1 ? 0 : (i / (finger.count - 1)) * 2 - 1;
        const lateral = slot * spread * finger.radius * 1.6;
        // 瞄准方向(可能为零向量)的法线
        const dirX = speed > 1 ? vel.x / speed : 1;
        const dirY = speed > 1 ? vel.y / speed : 0;
        ox = -dirY * lateral;
        oy = dirX * lateral;
      }
      this.deps.spawnFinger(aimX + ox, aimY + oy, finger.radius, finger.warnMs, finger.damage, color);
    }
  }

  /**
   * 朱雀·火雨 —— 一组斜坠的紫红陨石。
   *
   * 第 0 颗必定压在玩家脚下,其余散在四周:完全随机的落点只会砸空,
   * 而「有一半一定会逼近你」才构成压力。
   *
   * 颜色写死为紫红而不是读 `style.color`:火羽的橙红 0xff6622 属于**弹体**,
   * 而陨石要与地火(橙黄)、玩家火海(深血红)三者分开 —— 这是硬规则,
   * 不该被某只 Boss 的弹体配色顺手改掉。
   */
  private castRain(rain: NonNullable<BossPhaseDef['rain']>): void {
    const player = this.deps.getPlayer();
    for (let i = 0; i < rain.count; i++) {
      const a = Math.random() * Math.PI * 2;
      const d = i === 0 ? 0 : 120 + Math.random() * 260;
      this.deps.spawnMeteor(
        player.x + Math.cos(a) * d,
        player.y + Math.sin(a) * d,
        rain.radius, rain.warnMs, rain.damage, METEOR_COLOR,
      );
    }
  }

  private castBlink(enemy: Enemy, blink: NonNullable<BossPhaseDef['blink']>, now: number): void {
    const player = this.deps.getPlayer();
    const a = Math.random() * Math.PI * 2;
    const d = blink.minDist + Math.random() * (blink.maxDist - blink.minDist);
    // 落点钳在世界内 —— 闪出世界边缘的 Boss 等于自己脱离了战斗
    const x = Phaser.Math.Clamp(player.x + Math.cos(a) * d, 60, WORLD_WIDTH - 60);
    const y = Phaser.Math.Clamp(player.y + Math.sin(a) * d, 60, WORLD_HEIGHT - 60);
    enemy.setPosition(x, y);
    // 无敌写在敌人实体上而不是这里记表:伤害入口只有 takeDamage 一个,
    // 所有攻击形态(弹体/区域/接触反伤)自然都尊重它,不会漏掉某一种
    enemy.invulnerableUntil = now + blink.invulnMs;
  }

  /** 血条比例。UIScene 每帧拉取,不在这里发事件 */
  get bossHpRatio(): number {
    const e = this.current;
    if (!e || !e.active || e.isDead) return 0;
    return Math.max(0, Math.min(1, e.health / e.maxHealth));
  }

  /** 血条上的阶段名 */
  get phaseName(): string {
    const e = this.current;
    if (!e) return '';
    const def = BOSSES[e.bossKey];
    if (!def) return '';
    return def.phases[e.bossPhase]?.name ?? '';
  }
}