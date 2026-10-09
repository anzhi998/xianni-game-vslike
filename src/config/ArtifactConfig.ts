import { NEUTRAL_MODS } from '../types';
import type { ArtifactConfig, FireModifiers } from '../types';

/**
 * 法宝表 —— 改写已装备法术的开火行为
 *
 * 六件法宝均取自《仙逆》原著中王林实际持有的法宝,并按其在书中的表现
 * 映射到对应的机械类型。名字是原著的,效果是为游戏性重新设计的,
 * 不追求还原书中的具体数值(原著的威力跨度是数百章的累积,压缩进一局游戏
 * 只会让前期法宝显得毫无作用)。
 *
 * 明确不做(v1):环绕护体类法宝。
 * 现有 Projectile 是「发射即离手 + bornAt/lifeMs 超时销毁」的模型,
 * 而环绕体需要持续存在并跟随玩家,装不进去,要做得重写投射物层。
 */

/** 用中性集合起底,再覆写少数几个字段,避免每件法宝都写全 13 个键 */
function mods(over: Partial<FireModifiers>): FireModifiers {
  return { ...NEUTRAL_MODS, ...over };
}

export const ARTIFACTS: Record<string, ArtifactConfig> = {
  /**
   * 灵液 · 天逆 —— 火球术的钥匙(设计书进化配对表)。
   *
   * 设计书给它「伤害 +10%/级」的属性位,但本作是**属性位与钥匙双重职责**:
   * 它同时是伤害来源和开锁工具,占格就有双重价值。
   *
   * 注意:这是阶段 1 第一刀临时加的一件。设计书第五部列了 24 件法宝,
   * 阶段 2 会整体替换本表 —— 这里先只加火球术链路需要的那一件。
   */
  spirit_liquid_tianni: {
    id: 'spirit_liquid_tianni', name: '灵液·天逆',
    desc: '天逆灵液催火,持有时法术威力渐涨',
    color: 0xff6644,
    mods: mods({ damageMul: 1.1 }),
  },

  /**
   * 极阴 —— 王林入门即得的木杖,全书用得最久的一件。
   * 书中以「阴气极盛」著称,映射为纯粹的攻击强化。
   */
  jiyin: {
    id: 'jiyin', name: '极阴',
    desc: '极阴木杖,阴气极盛,锋芒更利且无坚不摧',
    color: 0xaa88ff,
    mods: mods({
      damageMul: 1.3,
      pierceAdd: 1,
    }),
  },

  /**
   * 射神车 —— 原著中能从车中连续射出光箭的法宝。
   * 书中明确的「多发」意象,映射为散射。
   */
  sheshen_che: {
    id: 'sheshen_che', name: '射神车',
    desc: '车中光箭连发,一次化作数道锋刃',
    color: 0x66ccff,
    mods: mods({
      projectileAdd: 4,
      spreadRad: 0.22,
    }),
  },

  /**
   * 昆极鞭 —— 原著中王林常用的缚敌长鞭,会自动缠住目标。
   * 缠住 = 追着打,映射为追踪。
   */
  kunji_bian: {
    id: 'kunji_bian', name: '昆极鞭',
    desc: '长鞭缚敌,锋刃自行追索敌踪',
    color: 0xffee66,
    mods: mods({
      homingTurn: 4.5,
      homingRetargetMs: 150,
    }),
  },

  /**
   * 玄阴鼎 —— 原著中的至宝鼎,内含玄阴之气,可吞纳镇压。
   * 吞纳 = 一击连锁到多个目标,映射为连锁。
   */
  xuanyin_ding: {
    id: 'xuanyin_ding', name: '玄阴鼎',
    desc: '鼎中玄阴之气外溢,命中后可连吞近处敌人',
    color: 0xff5577,
    mods: mods({
      chainCount: 3,
      chainRadius: 260,
      chainFalloff: 0.85,
    }),
  },

  /**
   * 靠山诀 —— 靠山老人传承的护身之法,意在稳固根基。
   * 护身 = 覆盖更广、留存更久,映射为范围与存续。
   */
  kaoshan_jue: {
    id: 'kaoshan_jue', name: '靠山诀',
    desc: '靠山之力护持周身,覆盖更广且绵延更久',
    color: 0xff99dd,
    mods: mods({
      areaMul: 1.35,
      lifeMul: 1.4,
    }),
  },

  /**
   * 黄泉升窍诀 —— 原著中王林修成的诡异秘法。
   * 书中以阴邪诡谲著称,映射为攻速与伤害的奇诡组合。
   */
  huangquan: {
    id: 'huangquan', name: '黄泉升窍',
    desc: '黄泉之力诡变莫测,法力流转迅疾且杀伤更重',
    color: 0xffdd88,
    mods: mods({
      cooldownMul: 0.82,
      damageMul: 1.08,
    }),
  },

  // ===== 钥匙(设计书第四部「进化配对」)======
  //
  // 下面三件都是**属性位与钥匙双重职责**:它们自己就该是值得占格的法宝,
  // 同时是某门神通进化的那把锁。判据写在 EvolutionConfig 的配对表里 ——
  // 修掉一处钥匙,别忘了那张表也会跟着变(反查而不是各写一份)

  /**
   * 御剑符 —— 黄泉指的钥匙。原版对应护腕(投射物速度)。
   * 同源逻辑:剑修之符,把「指」化成连绵不断的剑芒。
   */
  yujian_fu: {
    id: 'yujian_fu', name: '御剑符',
    desc: '剑修之符,法力流转更急,法术飞得更快',
    color: 0x9be7ff,
    mods: mods({ projectileSpeedMul: 1.1 }),
  },

  /**
   * 神识罗盘 —— 引力术与第三目的共用钥匙(设计书:与原版空之书同时服务
   * 魔杖与激光是同一处理)。原版对应烛台(作用范围)。
   * 同源逻辑:神识越广,引力笼罩越远;神识开阔,红芒覆盖面成倍扩张。
   *
   * ⚠️ 它一件服务两条链路,这不是笔误 —— 修配对时两行都要看
   */
  shenshi_luopan: {
    id: 'shenshi_luopan', name: '神识罗盘',
    desc: '神识越广,笼罩越远,法术与引力都覆盖更宽',
    color: 0xd8b44a,
    mods: mods({ areaMul: 1.1 }),
  },

  /**
   * 凝神香 —— 万剑禁幡的钥匙。原版对应咒缚(效果持续时间)。
   * 同源逻辑:香能凝神 —— 剑气因神凝而久驻不散。
   */
  ningshen_xiang: {
    id: 'ningshen_xiang', name: '凝神香',
    desc: '香能凝神,法术的留驻更久',
    color: 0xc0a0ff,
    mods: mods({ lifeMul: 1.1 }),
  },
};

/**
 * 法宝等级上限(设计书 §八:法宝满 5 级,线性叠加)
 *
 * 这与神通的「8 重」是两套刻度 —— 代码里刻意用 level/重数两个词区分,
 * 不要混用(设计书把它们放在同一张表里,但它们不是一回事)。
 */
export const MAX_ARTIFACT_LEVEL = 5;

/** 法宝栏格数 */
export const MAX_ARTIFACT_SLOTS = 6;

/**
 * 法宝最高阶数。重复拾取已装备的法宝即为升阶,而不是弹出替换界面。
 *
 * 阶段 1 过渡期保留:法宝等级改由升级卡线性提升(设计书的做法),
 * 但重复拾取仍保留为「+1 级」的兜底,否则现有精英掉落节奏下玩家几乎拿不到升级卡。
 * 阶段 2 铺开 24 件法宝后视情况收紧。
 */
export const MAX_ARTIFACT_TIER = MAX_ARTIFACT_LEVEL;

/** 所有法宝 id,供掉落随机使用 */
export const ARTIFACT_IDS = Object.keys(ARTIFACTS);

// ====== 阶数缩放 ======
//
// 升阶必须同时放大计数类与倍率类,否则「重复拾取即升阶」对半数法宝是空操作
// (倍率原样相乘,再乘多少次都是同一个数)。倍率用 x^s 而不是 x*(1+…) :
// s 在 1 阶时正好等于 1,Math.pow(x, 1) === x,一阶行为与无缩放完全一致。

/** 阶数缩放系数。每升一阶 +50% */
export function artifactTierScale(level: number): number {
  return 1 + (Math.max(1, level) - 1) * 0.5;
}

/** 按阶数缩放一个倍率。计数类请直接乘 artifactTierScale */
export function artifactTierPow(value: number, level: number): number {
  return Math.pow(value, artifactTierScale(level));
}

/** 上下浮动动画的相位 */
const DEG_PER_RAD = 180 / Math.PI;

/**
 * 把一件法宝翻译成中文效果行,例如
 *   「伤害×1.48 · 穿透+2 · 连锁3次」
 *
 * 拾取横幅与法宝面板的悬停提示共用这一份,所以面板显示的永远是
 * ArtifactSystem 真正会算出来的数 —— 而不是配置表里的原始字面量。
 */
export function describeArtifact(id: string, level = 1): string {
  const cfg = ARTIFACTS[id];
  if (!cfg) return '';

  const s = artifactTierScale(level);
  const m = cfg.mods;
  const parts: string[] = [];

  const mul = (label: string, v: number) => {
    if (v !== 1) parts.push(`${label}×${artifactTierPow(v, level).toFixed(2)}`);
  };
  const add = (label: string, v: number) => {
    const n = Math.round(v * s);
    if (n > 0) parts.push(`${label}+${n}`);
  };

  mul('伤害', m.damageMul);
  mul('冷却', m.cooldownMul);
  mul('范围', m.areaMul);
  mul('存续', m.lifeMul);
  mul('弹速', m.projectileSpeedMul);
  add('弹数', m.projectileAdd);
  add('穿透', m.pierceAdd);
  add('连锁', m.chainCount);
  if (m.homingTurn > 0) parts.push(`追踪${Math.round(m.homingTurn * s * DEG_PER_RAD)}°/s`);
  if (m.spreadRad > 0) parts.push(`散射${Math.round(m.spreadRad * DEG_PER_RAD)}°`);

  return parts.join(' · ');
}