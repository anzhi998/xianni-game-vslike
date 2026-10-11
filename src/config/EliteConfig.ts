import { RELIC_IDS, RELICS } from './RelicConfig';
import { EVOLUTIONS } from './EvolutionConfig';
import { NORMAL_MUTATION } from '../types';
import type { DropEntry, EnemyMutation, EnemyResist } from '../types';

/**
 * 精英怪与掉落 ——「精英 · 同阶修士」(怪物设计文档第五节)
 *
 * 文档对它的定义只有三条,但三条都很硬:
 *   1. 血量 ×30 于同段普通怪,必掉一个秘境宝匣
 *   2. 不随玩家远离而消失 —— 会直接传回屏幕上(见 EnemyAiSystem 的传回逻辑)
 *   3. 最多带两条抗性,绝不三抗齐全
 *
 * 它是整局资源链的入口:**没有精英,就没有宝匣,就没有进化**。
 * 所以宝匣从「低概率掉落」改成了「必掉」—— 旧的 2.4%~6% 掷骰让宝匣
 * 变成运气,而设计书里它是节奏点,不该靠运气。
 *
 * 精英仍然按「时间间隔」而非「固定概率」掷出:固定概率会与段表的
 * spawnInterval 曲线打架,导致屏幕最挤的时候精英反而更密。
 */

/** 开局时多少秒出一只精英 */
export const ELITE_PERIOD_START = 25;
/** 后期(约 12 分钟)多少秒出一只 */
export const ELITE_PERIOD_END = 7;
/** 精英密度线性增长到多少秒为止 */
const RAMP_END_SECONDS = 720;

/** 精英对同段普通怪的倍率(文档:血量 ×30) */
const ELITE_HP_MUL = 30;
/** 接触伤害倍率。文档没写,取 3 —— 让「别被它碰到」成立,又不至于一碰秒杀 */
const ELITE_DAMAGE_MUL = 3;
/** 体型倍率。同阶修士比同段杂兵大一圈,混战里一眼可辨 */
const ELITE_SCALE_MUL = 1.6;
/** 修为倍率 */
const ELITE_XP_MUL = 8;

export function elitePeriodAt(seconds: number): number {
  const t = Math.min(1, seconds / RAMP_END_SECONDS);
  return ELITE_PERIOD_START + (ELITE_PERIOD_END - ELITE_PERIOD_START) * t;
}

/**
 * 同时存在的精英上限。
 *
 * ×30 血 + 不 despawn + 必掉宝匣,三条加起来意味着「玩家打不动」时精英会
 * 无限累积成一堵墙。这条上限不是装饰,是那三条规则的保险丝。
 */
export const MAX_LIVE_ELITES = 2;

/**
 * 掷出本次生成是否为精英。
 * @param spawnInterval 当前出怪间隔,用于换算成「期望每 N 只出一只」
 */
export function rollEliteMutation(
  seconds: number,
  spawnInterval: number,
  baseResist: EnemyResist = {},
): EnemyMutation {
  if (Math.random() >= spawnInterval / elitePeriodAt(seconds)) {
    return NORMAL_MUTATION;
  }
  return makeEliteMutation(baseResist);
}

/** 无条件造一只精英(调试键用,也用于把「是否为精英」与「精英长什么样」分开) */
export function makeEliteMutation(baseResist: EnemyResist = {}): EnemyMutation {
  return {
    elite: true,
    tier: 1,
    hpMul: ELITE_HP_MUL,
    damageMul: ELITE_DAMAGE_MUL,
    // 精英是同阶修士,不靠速度吓人 —— 跑得比杂兵快会让「跑掉」这条退路失效
    speedMul: 1,
    xpMul: ELITE_XP_MUL,
    scaleMul: ELITE_SCALE_MUL,
    resist: rollEliteResists(baseResist),
  };
}

/** 抗性键的顺序(掷骰与计数共用,别在两处各写一份) */
const RESIST_KEYS: (keyof EnemyResist)[] = ['pull', 'freeze', 'knockback'];

function resistCount(r: EnemyResist): number {
  return RESIST_KEYS.reduce((n, k) => n + (r[k] ? 1 : 0), 0);
}

/**
 * 掷出精英的抗性。
 *
 * 文档的硬约束:**最多两条,绝不三抗齐全**。三抗齐全 = 控制流彻底失效,
 * 玩家只剩堆伤害一条路,十四类覆盖几何等于白设计。
 *
 * 从基础抗性(base)出发再补 —— 而不是掷一份覆盖它:铁甲兽天生免疫牵引,
 * 那只抗性写在它的数据里,不能因为精英掷骰没抽到牵引就丢掉。
 * 补的总数(基础 + 掷骰)封顶两条,所以「天生一条的坦克」最多再补一条。
 *
 * 即死抗性目前没有对应机制(梦道在阶段 4),但它仍会出现在数据里 ——
 * 让「抗性表」从第一天起就是同一张,比事后补一条更好。
 */
export function rollEliteResists(base: EnemyResist = {}): EnemyResist {
  const out: EnemyResist = { ...base };
  const target = Math.min(2, Math.random() < 0.55 ? 1 : 2);
  const pool = RESIST_KEYS.filter((k) => !out[k]);
  while (resistCount(out) < target && pool.length > 0) {
    const idx = Math.floor(Math.random() * pool.length);
    out[pool.splice(idx, 1)[0]] = true;
  }
  return out;
}

// ===== 丹药 =====

/** 精英掉回血丹药的概率 */
export const HEAL_PILL_CHANCE = 0.45;
/** 精英掉加修为丹药的概率 */
export const XP_PILL_CHANCE = 0.40;

/**
 * 回血丹药回复的气血 = 最大气血 × 此比例。
 *
 * 用比例而非固定值,因为最大气血会随大境界突破乘算增长 ——
 * 固定值到后期会变得毫无意义。
 */
export const HEAL_PILL_FRACTION = 0.25;

/**
 * 加修为丹药给予的修为 = 当前一级所需 × 此比例。
 * 同样按比例,保证任何境界捡到都有意义(与突破道具重复时的转化率一致)。
 */
export const XP_PILL_FRACTION = 0.35;

/**
 * 该遗物是否为某门神通的进化钥匙。
 * 判定从 EVOLUTIONS 反查,而不是在遗物表里手写 isKey 字段 ——
 * 配对表是唯一事实来源,两处各维护一份必然会走偏。
 */
function isEvolutionKey(id: string): boolean {
  return EVOLUTIONS.some((e) => e.keyRelic === id);
}

/** 还缺的那件专属遗物的权重 */
const KEY_WEIGHT = 3;
/** 没拿过的通用遗物的权重 */
const MISSING_WEIGHT = 2;

/**
 * 掷出这具精英尸体的掉落。
 *
 * 洞府宝箱必掉(木匣 = 1 次悟道三选一)。精英是整局资源链的入口:
 * **没有精英就没有宝匣,就没有道法融合** —— 所以它不该靠运气。
 *
 * 遗物三档权重(理由见 pickRelic):
 *   专属钥匙 ×3 / 没拿过的 ×2 / 已持有的 ×1
 *
 * 专属遗物只在**已学会对应神通**时才会被抽到 —— 抽到「仙剑」却没学剑阵是废牌。
 * 这条门槛同时意味着:玩家想拿齐五把钥匙,就必须去学那五门法术。
 *
 * 溢出不做过滤:遗物槽满 / 已满级时 equip() 返回 null,
 * GameScene 在拾取时把它折成修为,掉落因此永不浪费。
 */
export function rollEliteDrops(spellIds: string[] = [], ownedRelics: string[] = []): DropEntry[] {
  const out: DropEntry[] = [];
  out.push({ kind: 'chest', payload: 'wood' });

  if (Math.random() < 0.4) {
    const id = pickRelic(spellIds, ownedRelics);
    if (id) out.push({ kind: 'relic', payload: id });
  }

  if (Math.random() < HEAL_PILL_CHANCE) out.push({ kind: 'heal', payload: 0 });
  if (Math.random() < XP_PILL_CHANCE) out.push({ kind: 'xpPill', payload: 0 });

  return out;
}

/**
 * 随机挑一件遗物掉落。
 *
 *   KEY_WEIGHT(3) —— 还没拿到的**专属**遗物(且对应神通已学会)。
 *     没有它们就凑不齐道法融合,而一局能开几次宝匣是有限的。
 *   MISSING_WEIGHT(2) —— 没拿过的通用遗物。遗物栏 6 格要填满 + 每件要养到 5 级,
 *     新遗物始终有稀释重复值的价值。
 *   权重 1 —— 已经持有的(重复拾取 = 叠一级),仍然有效但不该占掉前两档的名额。
 */
function pickRelic(spellIds: string[], owned: string[]): string | null {
  const missingKey: string[] = [];
  const missing: string[] = [];
  const ownedList: string[] = [];

  for (const id of RELIC_IDS) {
    const cfg = RELICS[id];
    // 专属遗物有门槛:没学对应神通的钥匙不进池
    if (cfg.exclusive && !spellIds.includes(cfg.exclusive)) continue;
    if (!owned.includes(id)) {
      (isEvolutionKey(id) ? missingKey : missing).push(id);
    } else {
      ownedList.push(id);
    }
  }

  const pool: { id: string; w: number }[] = [
    ...missingKey.map((id) => ({ id, w: KEY_WEIGHT })),
    ...missing.map((id) => ({ id, w: MISSING_WEIGHT })),
    ...ownedList.map((id) => ({ id, w: 1 })),
  ];
  if (pool.length === 0) return null;

  const total = pool.reduce((s, p) => s + p.w, 0);
  let r = Math.random() * total;
  for (const p of pool) {
    r -= p.w;
    if (r <= 0) return p.id;
  }
  return pool[pool.length - 1].id;
}
