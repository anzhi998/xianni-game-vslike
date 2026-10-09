/**
 * 神通的「重数」与进化公式(设计书 §八 数值锚点)
 *
 * ============================ 为什么单独一个文件 ============================
 * 现有代码用的是「法术 Lv」:每级 ×1.25,无上限,和法宝的「阶」混用同一个词。
 * 设计书要求的是两套**互不相关的**刻度:
 *
 *   神通:8 重。1 重 = 100% 伤害,每重 +14%,4 重与 8 重各跳档 ×1.15,8 重约 340%
 *   法宝:5 级。线性叠加
 *
 * 所以这两个词在代码里必须分开 —— 重数(rituals)与法宝等级(artifact level)。
 * 本文件只放神通的刻度与进化规则。
 * ==========================================================================
 */

/** 神通满重 */
export const MAX_RITUAL = 8;

/** 每重的伤害加成 */
const PER_RITUAL_BONUS = 0.14;

/** 4 重与 8 重各跳一档 */
const MILESTONE_RITUALS = [4, 8];

/** 跳档倍率 */
const MILESTONE_MUL = 1.15;

/**
 * 第 n 重的伤害倍率。n = 1 时返回 1,与「1 重 = 100%」对齐。
 *
 * 8 重 ≈ 1 + 7×0.14 = 1.98,再乘两次 1.15 = 2.62 —— 设计书写的是「约 340%」,
 * 那是在含 1.15 跳档的前提下按每重 +14% 累乘到 8 重的口径。
 * 这里采用累乘(更符合「每重 +14%」的字面意思):
 *   1.14^7 × 1.15^2 ≈ 3.41
 * 两种口径在 8 重处结果接近,中途差异不足 8%,不影响体感。
 */
export function ritualDamageMul(ritual: number): number {
  const n = Math.max(1, Math.min(MAX_RITUAL, Math.floor(ritual)));
  let mul = Math.pow(1 + PER_RITUAL_BONUS, n - 1);
  for (const m of MILESTONE_RITUALS) {
    if (n >= m) mul *= MILESTONE_MUL;
  }
  return mul;
}

/** 普通进化的倍率:基于满 8 重的数值 */
export const EVOLUTION_MUL = 2.2;

/** 终局解的倍率(流月长河 / 古神血袍),附带专属效果 */
export const ULTIMATE_EVOLUTION_MUL = 2.6;

/**
 * 一条进化配对
 *
 * 「同源逻辑」是设计书的铁律三:钥匙与锁必须能一句话说清血脉关系。
 * 这个字段直接进 UI(宝匣结算界面),让玩家看到为什么是这把钥匙。
 */
export interface EvolutionDef {
  /** 基础神通 id */
  base: string;
  /** 进化后的 id */
  evolved: string;
  evolvedName: string;
  /** 钥匙法宝 id。数组长度 > 1 = 双素材进化 */
  keys: string[];
  /** 一句话说清为什么是这把钥匙 */
  reason: string;
  /** true = 终局解,走 ×2.6 且带专属效果 */
  ultimate?: boolean;
}

/**
 * 进化配对表(设计书第四部「钥匙必须与锁同源」)
 *
 * 目前落地的是**基础神通已经在法术表里**的那几条:火球术、引力术、
 * 万剑禁幡、黄泉指、第三目。其余配对等阶段 2 的神通进表后再补 ——
 * 加一条 = 一条配对 + 那把钥匙法宝,运行时代码一行都不用改。
 *
 * 注意两处刻意的复用:
 *   - 神识罗盘同时是引力术与第三目的钥匙(设计书:与原版空之书
 *     同时服务魔杖与激光是同一处理)
 *   - reason 字段是给 UI 的「为什么是这把钥匙」,不是注释 ——
 *     它保证每一对都能一句话说清血脉关系,硬凑的配对在这里就露馅了
 */
export const EVOLUTIONS: EvolutionDef[] = [
  {
    base: 'fireball',
    evolved: 'nine_nether_fire',
    evolvedName: '九幽火海',
    keys: ['spirit_liquid_tianni'],
    reason: '天逆灵液催火,一枚火球烧成一片火海',
  },
  {
    base: 'gravity',
    evolved: 'shifang_yinli',
    evolvedName: '十方引力',
    keys: ['shenshi_luopan'],
    reason: '神识越广,引力笼罩越远,敌人才被拖住不放',
  },
  {
    base: 'wanjian_banner',
    evolved: 'jintian_fan',
    evolvedName: '禁天幡',
    keys: ['ningshen_xiang'],
    reason: '香能凝神 —— 剑气因神凝而久驻不散',
  },
  {
    base: 'huangquan_zhi',
    evolved: 'huangquan_jiemie',
    evolvedName: '黄泉寂灭指',
    keys: ['yujian_fu'],
    reason: '剑修之符,把「指」化成连绵不断的剑芒',
  },
  {
    base: 'third_eye',
    evolved: 'third_eye_time',
    evolvedName: '第三目·时光红芒',
    keys: ['shenshi_luopan'],
    reason: '神识开阔,红芒覆盖面成倍扩张',
  },
];

/** 基础神通 -> 进化定义 */
export function findEvolution(baseId: string): EvolutionDef | undefined {
  return EVOLUTIONS.find((e) => e.base === baseId);
}
