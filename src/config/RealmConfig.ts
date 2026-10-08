/**
 * 境界体系
 *
 * ⚠️ 调参指南
 * 如果节奏不对,先改 XPSystem.computeXpToNext 的曲线,再改这里的 minorSpan。
 * 这两处是全局最重要的调参数字。REALMS 里的属性倍率反而是最后该动的。
 *
 * 对原作的有意偏离:
 * 《仙逆》中炼气期有九层、筑基期是初期/中期/后期/圆满四层。照搬的话
 * 一局 12 分钟的局连金丹都到不了,后面几个境界全是死内容。
 * 这里统一压缩为每个大境界 4~6 个小境界 —— 是节奏取舍,不是遗漏。
 */

export interface MajorRealmDef {
  id: string;
  name: string;
  shortName: string;
  /** 本境界内需要升的小境界数 */
  minorSpan: number;
  /**
   * 小境界名。长度应与 minorSpan 一致。
   * 炼气期按原作用「一层~十层」,其余用初期/中期/后期/圆满。
   */
  minorNames: string[];
  /** 法术槽位上限(可被「开辟法位」卡额外 +2) */
  spellSlots: number;
  /** 法宝槽位上限 */
  artifactSlots: number;
  /** 突破进入本境界所需的道具(第一个境界为空,即开局无需道具) */
  keyItemId: string;
  keyItemName: string;
  /** 突破时一次性施加,乘算到 Player 上 */
  hpMul: number;
  damageMul: number;
  moveSpeedMul: number;
  color: number;
}

const TIER_NAMES = ['初期', '中期', '后期', '圆满'];

/** 炼气期沿用原作的层数命名 */
const QI_LAYERS = [
  '一层', '二层', '三层', '四层', '五层',
  '六层', '七层', '八层', '九层', '十层',
];

function tiers(n: number): string[] {
  const out: string[] = [];
  for (let i = 0; i < n; i++) out.push(TIER_NAMES[i] ?? `${i + 1}层`);
  return out;
}

export const REALMS: MajorRealmDef[] = [
  {
    id: 'qi', name: '炼气期', shortName: '炼气',
    // 炼气期有十层,是全程最长的一段 —— 玩家在这里停留的时间也最长
    minorSpan: 10, minorNames: QI_LAYERS,
    spellSlots: 2, artifactSlots: 1,
    keyItemId: '', keyItemName: '',
    hpMul: 1.0, damageMul: 1.0, moveSpeedMul: 1.0,
    color: 0x9acccc,
  },
  {
    id: 'zhuji', name: '筑基期', shortName: '筑基',
    minorSpan: 4, minorNames: tiers(4),
    spellSlots: 3, artifactSlots: 2,
    keyItemId: 'zhuji_dan', keyItemName: '筑基丹',
    hpMul: 1.15, damageMul: 1.1, moveSpeedMul: 1.05,
    color: 0x66aaff,
  },
  {
    id: 'jiedan', name: '结丹期', shortName: '结丹',
    minorSpan: 5, minorNames: tiers(5),
    spellSlots: 4, artifactSlots: 3,
    keyItemId: 'jiedan_dan', keyItemName: '结丹丹',
    hpMul: 1.35, damageMul: 1.25, moveSpeedMul: 1.1,
    color: 0xffcc55,
  },
  {
    id: 'yuanying', name: '元婴期', shortName: '元婴',
    minorSpan: 5, minorNames: tiers(5),
    spellSlots: 5, artifactSlots: 3,
    keyItemId: 'ningying_dan', keyItemName: '凝婴丹',
    hpMul: 1.6, damageMul: 1.45, moveSpeedMul: 1.15,
    color: 0xff88dd,
  },
  {
    id: 'huashen', name: '化神期', shortName: '化神',
    minorSpan: 6, minorNames: tiers(6),
    spellSlots: 6, artifactSlots: 3,
    keyItemId: 'huashen_dan', keyItemName: '化神丹',
    hpMul: 1.9, damageMul: 1.7, moveSpeedMul: 1.2,
    color: 0xff5577,
  },
  {
    id: 'lianxu', name: '炼虚期', shortName: '炼虚',
    minorSpan: 6, minorNames: tiers(6),
    spellSlots: 7, artifactSlots: 3,
    keyItemId: 'taixu_dan', keyItemName: '太虚丹',
    hpMul: 2.3, damageMul: 2.0, moveSpeedMul: 1.25,
    color: 0xbb88ff,
  },
];

/**
 * 突破全部境界所需的累计小境界数。
 * 炼气 10 层 → 筑基 Lv11 → 结丹 Lv15 → 元婴 Lv20 → 化神 Lv26 → 炼虚 Lv32
 */
export const TOTAL_MINOR_LEVELS = REALMS.reduce((s, r) => s + r.minorSpan, 0);