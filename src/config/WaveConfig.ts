import { ENEMIES } from './EnemyConfig';
import { REALMS } from './RealmConfig';
import { MIMIC_ENEMY_ID } from './MechanismConfig';

/**
 * 刷怪表 —— 从「时间表」改为「境界段表」
 *
 * 原文的时间表只回答「第几分钟出哪种怪」,所有怪的行为是一样的;
 * 怪物设计文档要求的是「每一段推出一批**逼近方式不同**的主怪」——
 * 玩家学会新走位的同时,正好也拿到了对应的新神通。
 *
 * 所以这里做了分工:
 *   - **构成**按大境界下标取(SEGMENT_WAVES),每段新怪的权重最高,旧怪降为填充
 *   - **密度与强度**仍随时间增长(getDifficultyMultiplier),因为段内也要有爬坡
 *
 * 取境界而非分钟作为分界,有一个副作用是好的:升级慢的玩家会多停留在
 * 低段,刷出的怪也就一直是他已经学会应对的那几种 —— 段表自动起到了
 * 「不懂的走位不会提前砸到脸上」的作用。
 */
export interface SegmentWave {
  /** 对应 REALMS 的下标 */
  realmIndex: number;
  /** 本段基础出怪间隔(秒) */
  spawnInterval: number;
  /** 各怪的抽取权重 */
  weights: Record<string, number>;
  /** 本段基础强度 */
  difficulty: number;
}

/**
 * 七段刷怪表 —— 段位名与 REALMS 一一对应
 *
 * ⚠️ 权重表里出现的 id 必须在 ENEMIES 里存在,否则 pickEnemyType 会返回
 * 一个查不到配置的 id,setup() 直接崩。ENEMIES 表是本文件唯一的事实来源。
 */
export const SEGMENT_WAVES: SegmentWave[] = [
  // 凝气:教学段,只有一种逼近方式,先把武器手感摸熟
  { realmIndex: 0, spawnInterval: 1.00, difficulty: 1.00,
    weights: { beast: 0.60, corpse: 0.40 } },

  // 筑基:第一次不能站着打
  { realmIndex: 1, spawnInterval: 0.85, difficulty: 1.10,
    weights: { beast: 0.35, corpse: 0.35, rogue_cultivator: 0.30 } },

  // 结丹:第一次「没有后方」
  { realmIndex: 2, spawnInterval: 0.70, difficulty: 1.25,
    weights: { corpse: 0.25, rogue_cultivator: 0.20, yin_hun: 0.35, shi_xiu: 0.20 } },

  // 元婴:第一次需要用 DPS 硬顶(本作最长的一段)
  { realmIndex: 3, spawnInterval: 0.55, difficulty: 1.45,
    weights: { yin_hun: 0.20, rogue_cultivator: 0.15, stone_puppet: 0.30, iron_beast: 0.35 } },

  // 化神:第一次被合围
  { realmIndex: 4, spawnInterval: 0.42, difficulty: 1.70,
    weights: { stone_puppet: 0.25, iron_beast: 0.25, demonic_cultivator: 0.50 } },

  // 婴变:第一次「杀错了更糟」
  { realmIndex: 5, spawnInterval: 0.32, difficulty: 1.95,
    weights: { demonic_cultivator: 0.30, fire_spirit: 0.35, gu_worm: 0.35 } },

  // 问鼎:第一次被单只怪追着跑
  { realmIndex: 6, spawnInterval: 0.24, difficulty: 2.20,
    weights: { gu_worm: 0.20, fire_spirit: 0.20, ancient_beast: 0.35, outer_soul: 0.25 } },
];

/**
 * 场上存活上限 —— 文档的「天道承载力 300 只」在这里保守取 200。
 *
 * 这条上限不是性能妥协,是设计:「敌人是有限的资源」。如果无限刷新,
 * 玩家最后只需要一路后退,而「迎怪而上」这条反直觉策略也就消失了。
 * 取值低于原文是出于帧率(200 只 × 每帧一次行为遍历),要提到 300 时
 * 记得把 GameScene.setupPools 里 enemyPool 的 maxSize 与预建数一起改。
 */
export const MAX_LIVE_ENEMIES = 200;

export const MAX_DIFFICULTY = 4.0;
export const DIFFICULTY_GROWTH_PER_MIN = 0.08;

/** 按大境界下标取本段刷怪配置。越界时钳到最近的一段 */
export function getWaveFor(realmIndex: number): SegmentWave {
  const i = Math.max(0, Math.min(SEGMENT_WAVES.length - 1, realmIndex));
  return SEGMENT_WAVES[i];
}

/**
 * 难度持续增长(每分钟)
 */
export function getDifficultyMultiplier(seconds: number, baseDifficulty: number): number {
  const minutes = seconds / 60;
  const extra = minutes * DIFFICULTY_GROWTH_PER_MIN;
  const d = baseDifficulty + extra;
  return Math.min(d, MAX_DIFFICULTY);
}

/**
 * 根据权重随机选敌人
 */
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

/** 段表自检:权重里出现未知 id 时,刷怪会在运行时崩溃。启动时先炸在配置上 */
export function validateSegmentWaves(): string[] {
  const bad: string[] = [];
  for (const w of SEGMENT_WAVES) {
    if (w.realmIndex < 0 || w.realmIndex >= REALMS.length) {
      bad.push(`realmIndex ${w.realmIndex} 越界(共 ${REALMS.length} 个境界)`);
    }
    for (const id of Object.keys(w.weights)) {
      if (!ENEMIES[id]) bad.push(`未知敌人 id: ${id}`);
    }
  }
  return bad;
}

/**
 * 可达性自检:ENEMIES 里的每一只都必须有**一条生成路径**。
 *
 * 加了一只怪却忘了把它放进段表 / 机制投放表 / 分裂产物,它就是一坨
 * 永远不出场的死数据 —— 类型检查看不见,试玩也碰不到,只有翻配置时才发现。
 * 生成路径有四条,任意一条命中即可:
 *   段表权重 · 机制怪投放表(带 mechanism)· 别人的 splitInto · 伪宝匣变身目标
 *
 * 与调试面板的关系:面板的「刷全部怪 / 下一个机制怪」都是遍历这张表得来的,
 * 所以只要这一步能过,新怪就一定点得到 —— 见 CLAUDE.md 的调试面板约定
 */
export function validateEnemyReachability(): string[] {
  const reachable = new Set<string>();
  for (const w of SEGMENT_WAVES) {
    for (const id of Object.keys(w.weights)) reachable.add(id);
  }
  for (const id of Object.keys(ENEMIES)) {
    const cfg = ENEMIES[id];
    if (cfg.mechanism) reachable.add(id);
    if (cfg.splitInto?.type) reachable.add(cfg.splitInto.type);
  }
  reachable.add(MIMIC_ENEMY_ID);

  return Object.keys(ENEMIES).filter((id) => !reachable.has(id));
}
