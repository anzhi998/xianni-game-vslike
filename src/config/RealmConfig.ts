/**
 * 境界体系 ——《仙逆》原著「修真第一步 · 凡修七境」
 *
 * ⚠️ 调参指南
 * 节奏不对时,先改 XPSystem.computeXpToNext 的系数(k),再改这里的 minorSpan。
 * 这两处是全局最重要的调参数字。
 *
 * 原著结构:
 *   凝气(灵动) 十五层,二层产生神识,十五层圆满
 *   筑基  凡体蜕变为适合灵力运转的体质
 *   结丹  灵力由无形凝为金丹
 *   元婴  金丹碎裂诞生元婴
 *   化神  化凡、感悟天地人生产生意境,意境与元婴融合长出元神
 *   婴变  意境实质化,灵力蜕变为仙力
 *   问鼎  意境与仙力融合成问鼎之晶 —— 第一步顶点
 *
 * 化神之后原著进入「涅之三境 / 空之四境 / 踏天」,那是修真的第二、三、四步,
 * 主角早已超脱凡修。一个十余分钟的单局走不到那里,塞进来只会让前期被
 * 一堆看不懂的名词淹没,因此明确不做。
 *
 * 对原作的有意偏离:
 * 凝气期保留原著的十五层;筑基及以后压缩到 5 层。
 * 原著各境均分十层左右,一局十余分钟走完全程会导致每境只够升两三次,
 * 「突破」这个最有分量的时刻会因过于频繁而失去重量。
 */

export interface MajorRealmDef {
  id: string;
  name: string;
  shortName: string;
  /** 本境界内需要升的小境界数 */
  minorSpan: number;
  /** 小境界名,长度应与 minorSpan 一致 */
  minorNames: string[];
  /** 法术槽位上限(可被「开辟法位」卡额外 +2) */
  spellSlots: number;
  /** 法宝槽位上限 */
  artifactSlots: number;
  /** 突破进入本境界所需的道具(凝气期为空,即开局无需道具) */
  keyItemId: string;
  keyItemName: string;
  /** 突破时一次性施加,乘算到 Player 上 */
  hpMul: number;
  damageMul: number;
  moveSpeedMul: number;
  color: number;
}

/** 凝气期沿用原著的十五层命名 */
const NQ_LAYERS = [
  '一层', '二层', '三层', '四层', '五层',
  '六层', '七层', '八层', '九层', '十层',
  '十一层', '十二层', '十三层', '十四层', '十五层',
];

/** 凝气之后原著不再细分十层,统一用 初期/中期/后期/圆满 + 一层 */
const STAGES = ['初期', '中期', '后期', '圆满'];

function stages(n: number): string[] {
  const out: string[] = [];
  for (let i = 0; i < n; i++) out.push(STAGES[i % STAGES.length]);
  return out;
}

export const REALMS: MajorRealmDef[] = [
  {
    id: 'ningqi', name: '凝气期', shortName: '凝气',
    minorSpan: 15, minorNames: NQ_LAYERS,
    spellSlots: 2, artifactSlots: 1,
    keyItemId: '', keyItemName: '',
    hpMul: 1.0, damageMul: 1.0, moveSpeedMul: 1.0,
    color: 0x9acccc,
  },
  {
    id: 'zhuji', name: '筑基期', shortName: '筑基',
    minorSpan: 5, minorNames: stages(5),
    spellSlots: 3, artifactSlots: 2,
    keyItemId: 'zhuji_dan', keyItemName: '筑基丹',
    hpMul: 1.15, damageMul: 1.1, moveSpeedMul: 1.05,
    color: 0x66aaff,
  },
  {
    id: 'jiedan', name: '结丹期', shortName: '结丹',
    minorSpan: 5, minorNames: stages(5),
    spellSlots: 4, artifactSlots: 3,
    keyItemId: 'jiedan_dan', keyItemName: '结丹丹',
    hpMul: 1.35, damageMul: 1.25, moveSpeedMul: 1.1,
    color: 0xffcc55,
  },
  {
    id: 'yuanying', name: '元婴期', shortName: '元婴',
    minorSpan: 5, minorNames: stages(5),
    spellSlots: 5, artifactSlots: 3,
    keyItemId: 'ningying_dan', keyItemName: '凝婴丹',
    hpMul: 1.6, damageMul: 1.45, moveSpeedMul: 1.15,
    color: 0xff88dd,
  },
  {
    id: 'huashen', name: '化神期', shortName: '化神',
    minorSpan: 5, minorNames: stages(5),
    spellSlots: 6, artifactSlots: 3,
    keyItemId: 'huashen_dan', keyItemName: '化神丹',
    hpMul: 1.9, damageMul: 1.7, moveSpeedMul: 1.2,
    color: 0xff5577,
  },
  {
    id: 'yingbian', name: '婴变期', shortName: '婴变',
    minorSpan: 5, minorNames: stages(5),
    spellSlots: 7, artifactSlots: 3,
    keyItemId: 'yingbian_dan', keyItemName: '婴变丹',
    hpMul: 2.2, damageMul: 1.95, moveSpeedMul: 1.22,
    color: 0xbb88ff,
  },
  {
    id: 'wending', name: '问鼎期', shortName: '问鼎',
    minorSpan: 5, minorNames: stages(5),
    spellSlots: 8, artifactSlots: 3,
    keyItemId: 'wending_dan', keyItemName: '问鼎丹',
    hpMul: 2.6, damageMul: 2.3, moveSpeedMul: 1.25,
    color: 0xffdd44,
  },
];

/** 突破全部境界所需的累计小境界数 */
export const TOTAL_MINOR_LEVELS = REALMS.reduce((s, r) => s + r.minorSpan, 0);