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
  /**
   * 法术槽上限。**它是本表的唯一事实来源** —— SpellConfig 不再声明槽位数,
   * 因为「什么时候能带第几门法术」是境界的节奏问题,不是法术的属性。
   *
   * 阶梯:凝气 2 → 筑基 3 → 结丹 4 → 元婴 5 → 化神 6,之后不再增长。
   * 开局只带两门,前中期的每一次大境界突破都直接换成一门新法术的选择权 ——
   * 这是全局唯一一条「越早突破越赚」的压力线。
   *
   * ⚠️ **化神那一格是刻意留的余量,不是漏算**(已确认保留)。目前只有 5 门法术,
   *    所以元婴(第 5 格)之后就能带满,HUD 会一直显示「法位 5/6 · 空 1」。
   *    留着它的三个理由:
   *      1. 第 6 门法术一旦加入,它自动补位,不需要再动境界表;
   *      2. 满格在 UI 上是「你没得选了」的信号,而空一格永远是「还有别的路」;
   *      3. 收掉它就得给化神另找一个收益,那是新机制,不是减法。
   *    若将来真的收槽,改这一张表即可 —— 法术系统只读 setSlotCap 的结果。
   */
  spellSlots: number;
  /** 突破进入本境界后,法位相比上一境增加多少(仅用于突破横幅文案) */
  slotGain: number;
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
    spellSlots: 2, slotGain: 0,
    hpMul: 1.0, damageMul: 1.0, moveSpeedMul: 1.0,
    color: 0x9acccc,
  },
  {
    id: 'zhuji', name: '筑基期', shortName: '筑基',
    minorSpan: 5, minorNames: stages(5),
    spellSlots: 3, slotGain: 1,
    hpMul: 1.15, damageMul: 1.1, moveSpeedMul: 1.05,
    color: 0x66aaff,
  },
  {
    id: 'jiedan', name: '结丹期', shortName: '结丹',
    minorSpan: 5, minorNames: stages(5),
    spellSlots: 4, slotGain: 1,
    hpMul: 1.35, damageMul: 1.25, moveSpeedMul: 1.1,
    color: 0xffcc55,
  },
  {
    id: 'yuanying', name: '元婴期', shortName: '元婴',
    minorSpan: 5, minorNames: stages(5),
    spellSlots: 5, slotGain: 1,
    hpMul: 1.6, damageMul: 1.45, moveSpeedMul: 1.15,
    color: 0xff88dd,
  },
  {
    id: 'huashen', name: '化神期', shortName: '化神',
    minorSpan: 5, minorNames: stages(5),
    spellSlots: 6, slotGain: 1,
    hpMul: 1.9, damageMul: 1.7, moveSpeedMul: 1.2,
    color: 0xff5577,
  },
  {
    id: 'yingbian', name: '婴变期', shortName: '婴变',
    minorSpan: 5, minorNames: stages(5),
    spellSlots: 6, slotGain: 0,
    hpMul: 2.2, damageMul: 1.95, moveSpeedMul: 1.22,
    color: 0xbb88ff,
  },
  {
    id: 'wending', name: '问鼎期', shortName: '问鼎',
    minorSpan: 5, minorNames: stages(5),
    spellSlots: 6, slotGain: 0,
    hpMul: 2.6, damageMul: 2.3, moveSpeedMul: 1.25,
    color: 0xffdd44,
  },
];

/** 突破全部境界所需的累计小境界数 */
export const TOTAL_MINOR_LEVELS = REALMS.reduce((s, r) => s + r.minorSpan, 0);