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
   * 阶梯:凝气 2 → 筑基 3 → 结丹 4 → 元婴 5,之后不再增长(化神 / 婴变 / 问鼎都是 5)。
   * 开局只带两门,前中期的每一次大境界突破都直接换成一门新法术的选择权 ——
   * 这是全局唯一一条「越早突破越赚」的压力线。
   *
   * ⚠️ **收槽到 5 是设计书 3.5 的既决事项,不是省事**(见「为什么收槽」)。
   *    这张表曾是 2/3/4/5/6 —— 化神那一格是当年为「第 6 门法术预留的余量」,
   *    理由是「第 6 门法术一旦加入,它自动补位,不需要再动境界表」。
   *    龙卷加入时这个预留被**兑现成收槽**:法术变成 6 门,槽位停在 5。
   *
   * ## 为什么收槽(设计书 3.5,已执行)
   *
   * 6 门法术全带且全推满,一局要花 5(填槽)+ 35(法术升满)+ 6(遗物)+ 24 + 1
   * = 71 次;而**不收槽**时法术升级是 6×7 = 42,合计 **78 次** ——
   * 超出一局约 70 级的预算 8 级,「全满」这个参照点当场失去配表价值。
   * 收槽后正好回到 71,与既有预算一致。
   *
   * 副作用是设计要的那一边:**取舍从「只有遗物侧」变成「两面都有」** ——
   * 法术侧要决定放弃哪一条路线,遗物侧放弃 13 选 6 里的 7 件。
   * 扩内容没有稀释取舍,反而加深了它。
   *
   * ⚠️ 若实测一局等级偏低,预案是**下调升级曲线指数(1.75 → 1.65)**,
   *    不是把化神那一格加回来。
   */
  spellSlots: number;
  /** 突破进入本境界后,法位相比上一境增加多少(仅用于突破横幅文案) */
  slotGain: number;
  /**
   * 突破时一次性施加,乘算到 Player 上。
   *
   * hpMul 按 +0.05 等差递进(1.10 → 1.35),全程累计约 ×3.3。
   * 曾经的 1.15/1.35/1.6/1.9/2.2/2.6 累计约 ×27,突破一次血量跳一大截,
   * 后期怪的伤害完全追不上血池 —— 血量不能成为境界的主要收益,
   * 境界的主收益是法位与伤害。
   */
  hpMul: number;
  damageMul: number;
  color: number;
}

/** 凝气期沿用原著的十五层命名 */
const NQ_LAYERS = [
  '一层', '二层', '三层', '四层', '五层',
  '六层', '七层', '八层', '九层', '十层',
  '十一层', '十二层', '十三层', '十四层', '十五层',
];

/** 凝气之后原著不再细分十层,统一用 初期/中期/后期/圆满/大圆满 */
const STAGES = ['初期', '中期', '后期', '圆满', '大圆满'];

/**
 * 小境界名。⚠️ 名字表必须 ≥ minorSpan:五层境界的第 5 层曾经被
 * `i % 4` 静默回卷成「初期」,于是每条链都出现「圆满之后又初期」的
 * 幽灵层(婴变·圆满 → 婴变·初期 → 化神·初期)。这里改为直接截取,
 * 真不够时宁可让 undefined 冒出来在开发期炸掉,也不再悄悄循环。
 */
function stages(n: number): string[] {
  return STAGES.slice(0, n);
}

export const REALMS: MajorRealmDef[] = [
  {
    id: 'ningqi', name: '凝气期', shortName: '凝气',
    minorSpan: 15, minorNames: NQ_LAYERS,
    spellSlots: 2, slotGain: 0,
    hpMul: 1.0, damageMul: 1.0,
    color: 0x9acccc,
  },
  {
    id: 'zhuji', name: '筑基期', shortName: '筑基',
    minorSpan: 5, minorNames: stages(5),
    spellSlots: 3, slotGain: 1,
    hpMul: 1.1, damageMul: 1.1,
    color: 0x66aaff,
  },
  {
    id: 'jiedan', name: '结丹期', shortName: '结丹',
    minorSpan: 5, minorNames: stages(5),
    spellSlots: 4, slotGain: 1,
    hpMul: 1.15, damageMul: 1.25,
    color: 0xffcc55,
  },
  {
    id: 'yuanying', name: '元婴期', shortName: '元婴',
    minorSpan: 5, minorNames: stages(5),
    spellSlots: 5, slotGain: 1,
    hpMul: 1.2, damageMul: 1.45,
    color: 0xff88dd,
  },
  {
    id: 'huashen', name: '化神期', shortName: '化神',
    minorSpan: 5, minorNames: stages(5),
    // ⚠️ 收槽:化神不再 +1(见 MajorRealmDef.spellSlots 的「为什么收槽」)
    spellSlots: 5, slotGain: 0,
    hpMul: 1.25, damageMul: 1.7,
    color: 0xff5577,
  },
  {
    id: 'yingbian', name: '婴变期', shortName: '婴变',
    minorSpan: 5, minorNames: stages(5),
    spellSlots: 5, slotGain: 0,
    hpMul: 1.3, damageMul: 1.95,
    color: 0xbb88ff,
  },
  {
    id: 'wending', name: '问鼎期', shortName: '问鼎',
    minorSpan: 5, minorNames: stages(5),
    spellSlots: 5, slotGain: 0,
    hpMul: 1.35, damageMul: 2.3,
    color: 0xffdd44,
  },
];

/** 突破全部境界所需的累计小境界数 */
export const TOTAL_MINOR_LEVELS = REALMS.reduce((s, r) => s + r.minorSpan, 0);