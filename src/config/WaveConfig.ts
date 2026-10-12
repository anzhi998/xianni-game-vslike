import { ENEMIES } from './EnemyConfig';
import { MIMIC_ENEMY_ID } from './MechanismConfig';
import { BOSSES } from './BossConfig';
import { SPELLS, STARTING_SPELL } from './SpellConfig';
import type { Approach } from '../types';

/**
 * 刷怪节奏 —— 两张互相独立的表
 *
 * **「出什么」与「多密」是两件事,所以分两张表管。**
 *
 *   - `ENEMY_INTROS` —— 怪物登场表:谁在第几秒第一次出现。
 *     它回答的是「这一局的怪种怎么一步步交出来」。
 *   - `PACE_SEGMENTS` —— 节奏段:每段的基础出怪间隔与强度。
 *     它回答的是「压力条怎么涨」,与具体是哪种怪无关。
 *
 * 为什么把原来的「段落 = 权重表」拆开:旧的写法里,「第 4 分钟换一批怪」和
 * 「第 4 分钟加快出怪」是同一条数据,于是**想早一点引出第二种杂兵,
 * 就必须连着改密度与强度**;反过来也一样。开局四分钟只出一种怪、接下来
 * 又一口气塞进来三种,都是这个耦合的产物 —— 那是四分钟一跳的阶梯,
 * 不是曲线。拆开之后,登场时间以「秒」为单位自由安排,密度曲线照旧。
 */
export interface EnemyIntro {
  /** 第几秒开始出现。同一只怪只写一次 */
  atSeconds: number;
  id: string;
  /** 稳定后的相对权重(不是概率,只与同池其它怪比大小) */
  weight: number;
  /**
   * 从 `INTRO_START_FRACTION` 爬到满权重需要多少秒。
   *
   * 新怪**先稀后密**是刻意的:它刚登场时应该是「咦,那是什么」,
   * 而不是「屏幕忽然全变成了它」。中间那几十秒正好用来认它的行为。
   */
  rampSeconds: number;
}

/** 刚出现时的权重比例,rampSeconds 之后升到 1.0 */
const INTRO_START_FRACTION = 0.3;

export const ENEMY_INTROS: EnemyIntro[] = [
  // ---- 开局:只出「一击必杀」的杂兵 ----
  // 第一个 30 秒只有山野妖兽一种。这一段的全部内容是:移动、自动索敌、捡灵气。
  { atSeconds: 0, id: 'beast', weight: 1.00, rampSeconds: 0 },

  // 30 秒:第二种。铁甲蚁快而脆 —— 第一课是「有些东西你跑不过,但它一碰就碎」,
  // 与山野妖兽(慢、稍厚)刚好形成第一组对比
  { atSeconds: 30, id: 'iron_ant', weight: 0.60, rampSeconds: 90 },

  // 90 秒:第一种两刀怪。它慢,所以「打不死就绕开」是真选项
  { atSeconds: 90, id: 'corpse', weight: 0.70, rampSeconds: 120 },

  // 180 秒:第一次「没有后方」
  { atSeconds: 180, id: 'yin_hun', weight: 0.60, rampSeconds: 120 },

  // 300 秒:第一次「不让它靠近就是输出」
  { atSeconds: 300, id: 'fire_spirit', weight: 0.50, rampSeconds: 150 },

  // 420 秒:第一次「清屏 ≠ 清干净」
  { atSeconds: 420, id: 'gu_worm', weight: 0.50, rampSeconds: 150 },

  // ---- 8:00:第一道弹道 ----
  // 远程怪要求玩家「朝它走」。前六种教的都是「跑动中清场」,
  // 两种要求叠在一起只会互相抵消 —— 所以它排在第六种之后
  { atSeconds: 480, id: 'rogue_cultivator', weight: 0.55, rampSeconds: 120 },

  { atSeconds: 600, id: 'shi_xiu', weight: 0.55, rampSeconds: 150 },

  // 12:00:第一次需要「堆穿透」而不是「堆伤害」
  { atSeconds: 720, id: 'stone_puppet', weight: 0.55, rampSeconds: 150 },

  // 14:00:合围 + 弹道
  { atSeconds: 840, id: 'demonic_cultivator', weight: 0.55, rampSeconds: 150 },

  { atSeconds: 960, id: 'iron_beast', weight: 0.55, rampSeconds: 150 },

  // 19:00:第一次被单只怪追着跑
  { atSeconds: 1140, id: 'ancient_beast', weight: 0.45, rampSeconds: 180 },

  // 23:00:最后一次「站位不再由你决定」
  { atSeconds: 1380, id: 'outer_soul', weight: 0.50, rampSeconds: 180 },
];

/**
 * 节奏段 —— 只回答「多密、多强」。
 *
 * ⚠️ `fromSeconds` 必须**递增**,而且必须与数组顺序一致
 * (`getPace` 按顺序找最后一条已经生效的)。校验器会检查这一点。
 */
export interface PaceSegment {
  fromSeconds: number;
  /** 本段基础出怪间隔(秒) */
  spawnInterval: number;
  /** 本段基础强度 */
  difficulty: number;
}

export const PACE_SEGMENTS: PaceSegment[] = [
  { fromSeconds: 0, spawnInterval: 1.00, difficulty: 1.00 },
  { fromSeconds: 240, spawnInterval: 0.85, difficulty: 1.10 },
  { fromSeconds: 480, spawnInterval: 0.70, difficulty: 1.25 },
  { fromSeconds: 720, spawnInterval: 0.55, difficulty: 1.45 },
  { fromSeconds: 1020, spawnInterval: 0.42, difficulty: 1.70 },
  { fromSeconds: 1260, spawnInterval: 0.32, difficulty: 1.95 },
  { fromSeconds: 1500, spawnInterval: 0.24, difficulty: 2.20 },
];

/**
 * 开局窗口(秒):这**之内**登场的怪必须被起手法术一击必杀。
 *
 * 这是试玩定下来的规矩,不是推导出来的:开局的三十秒该教移动与索敌,
 * 而「两刀才能杀死的杂兵」会把「打怪」变成「被怪追」。
 * 窗口之后两刀怪是正常的强度递进,不算破例。
 */
export const OPENING_SECONDS = 30;

/**
 * 第一个允许出现**有弹道**的怪的秒数。
 *
 * 远程怪的全部要求是「主动朝它走」,而开局的课是「跑动中清场」。
 * 把两种要求叠在同一时刻,玩家学到的既不是前者也不是后者,而是「站着挨打」。
 */
export const FIRST_PROJECTILE_SECONDS = 480;

/** 会在远处朝玩家丢东西的逼近方式 */
const PROJECTILE_APPROACHES: Approach[] = ['ranged', 'flank'];

/**
 * 怪物境界段(T1–T8)的时间窗 ——《怪物设计.md》第二节的表。
 *
 * ⚠️ 它**不参与刷怪**(那由 ENEMY_INTROS 决定),只用于对外交流与调试文案:
 *    「现在到 T4 了」比「现在 800 秒」更容易和设计文档对上。
 */
const TIER_STARTS_SECONDS = [0, 240, 480, 720, 1020, 1260, 1500, 1800];

export function getTierAt(seconds: number): number {
  let t = 0;
  for (let i = 0; i < TIER_STARTS_SECONDS.length; i++) {
    if (seconds >= TIER_STARTS_SECONDS[i]) t = i;
  }
  return t;
}

/** 当前生效的节奏段 */
export function getPace(seconds: number): PaceSegment {
  let seg = PACE_SEGMENTS[0];
  for (const p of PACE_SEGMENTS) {
    if (seconds >= p.fromSeconds) seg = p;
  }
  return seg;
}

/**
 * 当前这一秒的刷怪权重池。
 *
 * 尚未登场的怪权重为 0(直接不进池),刚登场的按 rampSeconds 从 30% 爬到满。
 */
export function buildWeights(seconds: number): Record<string, number> {
  const weights: Record<string, number> = {};
  for (const intro of ENEMY_INTROS) {
    if (seconds < intro.atSeconds) continue;
    if (intro.rampSeconds <= 0) {
      weights[intro.id] = intro.weight;
      continue;
    }
    const t = Math.min(1, (seconds - intro.atSeconds) / intro.rampSeconds);
    weights[intro.id] = intro.weight * (INTRO_START_FRACTION + (1 - INTRO_START_FRACTION) * t);
  }
  // 兜底:任何时刻都必须至少有一种能出的怪
  if (Object.keys(weights).length === 0) weights[ENEMY_INTROS[0].id] = 1;
  return weights;
}

export const MAX_LIVE_ENEMIES = 200;

export const MAX_DIFFICULTY = 4.0;
export const DIFFICULTY_GROWTH_PER_MIN = 0.08;

/** 难度在段基础值上随时间持续增长 */
export function getDifficultyMultiplier(seconds: number, baseDifficulty: number): number {
  const minutes = seconds / 60;
  const extra = minutes * DIFFICULTY_GROWTH_PER_MIN;
  const d = baseDifficulty + extra;
  return Math.min(d, MAX_DIFFICULTY);
}

/** 根据权重随机选敌人 */
export function pickEnemyType(weights: Record<string, number>): keyof typeof ENEMIES {
  const entries = Object.entries(weights);
  const total = entries.reduce((s, [, w]) => s + w, 0);
  let r = Math.random() * total;
  for (const [k, w] of entries) {
    r -= w;
    if (r <= 0) return k as keyof typeof ENEMIES;
  }
  return entries[0][0] as keyof typeof ENEMIES;
}

/** 登场表自检:未知 id、时间倒序、重复登场 */
export function validateIntros(): string[] {
  const bad: string[] = [];
  const seen = new Set<string>();
  let lastAt = -1;
  for (const intro of ENEMY_INTROS) {
    if (!ENEMIES[intro.id]) {
      bad.push(`登场表里有未知敌人 id: ${intro.id}`);
      continue;
    }
    if (intro.atSeconds < lastAt) {
      bad.push(`${intro.id} 的登场时间 ${intro.atSeconds}s 排在更早的条目之后(表必须按时间递增)`);
    }
    lastAt = intro.atSeconds;
    if (seen.has(intro.id)) bad.push(`${intro.id} 在登场表里出现了两次`);
    seen.add(intro.id);
  }
  PACE_SEGMENTS.forEach((p, i) => {
    if (i > 0 && p.fromSeconds <= PACE_SEGMENTS[i - 1].fromSeconds) {
      bad.push(`节奏段的 fromSeconds 必须递增:第 ${i + 1} 条是 ${p.fromSeconds}s`);
    }
  });
  return bad;
}

/**
 * 开局强度自检 —— 两条由试玩定下来的硬规矩。
 *
 *   1. **有弹道的怪不得早于 FIRST_PROJECTILE_SECONDS**。
 *   2. **开局窗口内登场的每一只都必须被起手法术一击必杀**,按窗口**末**的难度算 ——
 *      只按登场那一瞬算是不够的,难度时钟在窗口内也一直把血量往上抬。
 *
 * 这两条都是「不写出来的话,加一行登场表就会悄悄破掉」的类型:
 * 破掉之后游戏仍然能跑,只是开局手感变了,而手感问题没有报错可看。
 */
export function validateOpeningDifficulty(): string[] {
  const bad: string[] = [];

  for (const intro of ENEMY_INTROS) {
    const cfg = ENEMIES[intro.id];
    if (!cfg) continue; // 未知 id 由 validateIntros 负责报
    if (intro.atSeconds < FIRST_PROJECTILE_SECONDS && PROJECTILE_APPROACHES.includes(cfg.approach)) {
      bad.push(
        `${cfg.name}(${intro.id}) 在 ${intro.atSeconds}s 登场且有弹道;` +
        `第一只远程怪不得早于 ${FIRST_PROJECTILE_SECONDS}s(${FIRST_PROJECTILE_SECONDS / 60}:00)`,
      );
    }
  }

  // 起手伤害直接从法术表读,而不是再抄一个常量 —— 两处各写一份必然会走偏
  const openingDamage = SPELLS[STARTING_SPELL]?.levels[0]?.damage ?? 0;
  const worstDifficulty = getDifficultyMultiplier(OPENING_SECONDS, getPace(OPENING_SECONDS).difficulty);
  for (const intro of ENEMY_INTROS) {
    if (intro.atSeconds > OPENING_SECONDS) continue;
    const cfg = ENEMIES[intro.id];
    if (!cfg) continue;
    const hp = cfg.maxHealth * worstDifficulty;
    if (hp > openingDamage) {
      bad.push(
        `开局的 ${cfg.name}(${intro.id}) 在 ${OPENING_SECONDS}s 时有 ${hp.toFixed(0)} 点血,` +
        `超过起手法术的 ${openingDamage} 点一击线(要么降血,要么推迟登场)`,
      );
    }
  }
  return bad;
}

/**
 * 可达性自检:ENEMIES 里的每一只都必须有**一条生成路径**,且每只都排进了登场表。
 *
 * 加了一只怪却忘了排登场 / 放进机制投放表 / 挂到别人的 splitInto,它就是一坨
 * 永远不出场的死数据 —— 类型检查看不见,试玩也碰不到,只有翻配置时才发现。
 * 生成路径有五条,任意一条命中即可:
 *   登场表 · 机制怪投放表(带 mechanism)· 别人的 splitInto · 伪宝匣变身目标 ·
 *   首领时间表 · **首领召唤表(approach: 'summon')**
 *
 * 与调试面板的关系:面板的「刷全部怪 / 下一个机制怪」都是遍历这张表得来的,
 * 所以只要这一步能过,新怪就一定点得到 —— 见 CLAUDE.md 的调试面板约定
 */
export function validateEnemyReachability(): string[] {
  const reachable = new Set<string>();
  for (const intro of ENEMY_INTROS) reachable.add(intro.id);
  for (const id of Object.keys(ENEMIES)) {
    const cfg = ENEMIES[id];
    if (cfg.mechanism) reachable.add(id);
    if (cfg.splitInto?.type) reachable.add(cfg.splitInto.type);
  }
  reachable.add(MIMIC_ENEMY_ID);
  // 首领走 BossSystem 的时间表,不进登场表
  for (const id of Object.keys(BOSSES)) reachable.add(id);
  // 首领的召唤物(剑肖十二子等)只在 Boss 战里出现 —— 它们的设计前提就是
  // 「不参与常规波次」,所以必须在这里被认账,否则可达性自检会误报
  for (const boss of Object.values(BOSSES)) {
    for (const phase of boss.phases) {
      if (phase.summon) reachable.add(phase.summon.type);
    }
  }

  return Object.keys(ENEMIES).filter((id) => !reachable.has(id));
}
