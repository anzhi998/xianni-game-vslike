/**
 * 神通栏解锁表(设计书 §4.5,已定稿)
 *
 * 与现有 RealmConfig.spellSlots 的关系:那是「每个大境界给几格法术位」,
 * 它的增长节奏是为旧的 19 门法术配的。本表是设计书 v2.7 的节奏,
 * 二者当前并存 —— 第 2 格 @LV5 这一条就与 RealmConfig 的 16 级冲突。
 * 阶段 2 整体替换法术表时,再把 RealmConfig.spellSlots 收掉,只留本表。
 */

/** 神通栏的第几格,从 1 开始 */
export type SlotIndex = 1 | 2 | 3 | 4 | 5 | 6;

/**
 * 一格神通栏的解锁定义
 *
 * 格 1 是特例:开局默认装备位,不参与概率竞争。
 */
export interface SpellSlotDef {
  slot: SlotIndex;
  /** 解锁等级 */
  unlockLevel: number;
  /** 候选神通 id。空数组 = 这一格不放神通(如结丹,只开极境/古神流两扇门) */
  candidates: string[];
  /**
   * 是否为默认装备位。true 时该格的候选会在开局直接装上,不进卡池。
   * 目前只有格 1(火球术)。
   */
  isDefault?: boolean;
}

/**
 * 凝气吃 2 格。格 1 开局默认火球术,格 2 (LV5) 才是第一次真正的决策:
 * 抽聚拢(补控制)还是抽环绕(补自保)。
 *
 * 万剑禁幡的抽中权重最低 —— 它是全局唯一纯自保件,
 * 早拿会让前中期的压力曲线塌掉。约为引力术的 1/3。
 */
export const SPELL_SLOTS: SpellSlotDef[] = [
  { slot: 1, unlockLevel: 1, candidates: ['fireball'], isDefault: true },
  { slot: 2, unlockLevel: 5, candidates: ['gravity', 'wanjian_banner'], isDefault: false },
  { slot: 3, unlockLevel: 16, candidates: ['huangquan_zhi', 'third_eye'], isDefault: false },
  // 结丹:开格但不放神通,留给古神流入流时的洗点落点
  { slot: 4, unlockLevel: 21, candidates: [], isDefault: false },
  // 元婴:唯一允许同段同几何的一格(尸魅/蚊兽同为自动索敌,为凑融合)
  { slot: 5, unlockLevel: 31, candidates: ['shi_mei', 'wen_shou'], isDefault: false },
  { slot: 6, unlockLevel: 61, candidates: ['ding_shen', 'fen_ji_gu_san', 'liu_yue'], isDefault: false },
];

/**
 * 问鼎段(71 级)不再保底给格,改为争空位。
 *
 * 设计书原本称此段是「全作最陡的一次火力跳变」,但到 71 级六格几乎已满,
 * 雷法·落雷与呼风唤雨只能挤掉一件已有神通 —— 跳变只在玩家主动弃格时成立。
 * 满栏时走 GameScene 的替换面板(ReplaceSpellScene)。
 */
export const SPELL_SLOT_LAST = { unlockLevel: 71, candidates: ['thunder_law', 'storm_call'] };

/** 候选 id -> 抽中权重。缺省为 1 */
export const SPELL_CANDIDATE_WEIGHT: Record<string, number> = {
  // 万剑禁幡 ≈ 引力术的 1/3
  wanjian_banner: 0.35,
  gravity: 1,
};

/** 某等级时已解锁到第几格。格 1 恒为 1 */
export function unlockedSlotsAt(level: number): number {
  let n = 1;
  for (const s of SPELL_SLOTS) if (level >= s.unlockLevel) n = Math.max(n, s.slot);
  return n;
}

/** 该格是否已解锁 */
export function isSlotUnlocked(slot: SlotIndex, level: number): boolean {
  return level >= (SPELL_SLOTS.find((s) => s.slot === slot)?.unlockLevel ?? 999);
}

/** 开局默认装备的神通 */
export function defaultSpell(): string | null {
  return SPELL_SLOTS.find((s) => s.isDefault)?.candidates[0] ?? null;
}

/** 按权重抽一个候选。候选为空返回 null */
export function rollCandidate(candidates: string[]): string | null {
  if (candidates.length === 0) return null;
  let total = 0;
  for (const id of candidates) total += SPELL_CANDIDATE_WEIGHT[id] ?? 1;
  let r = Math.random() * total;
  for (const id of candidates) {
    r -= SPELL_CANDIDATE_WEIGHT[id] ?? 1;
    if (r <= 0) return id;
  }
  return candidates[candidates.length - 1];
}
