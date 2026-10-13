import type { PlayerRelicMods, SpellRelicMods } from '../types';
import { META_PROGRESSION_ENABLED } from './FeatureConfig';

/**
 * 遗物表 —— 14 件,6 专属 + 8 通用,每件可叠 5 级,遗物槽 6 个
 *
 * ## 专属 vs 通用
 *
 * 专属遗物只强化它对应的那一门神通,并且是该门**道法融合的必要前置**;
 * 通用遗物可自由组合进任意路线。这是取舍的全部来源:
 * **14 选 6,必须放弃 8 件。**
 *
 * 收槽到 5 个法术位之后,取舍是**两面都有**的:法术侧放弃 6 条路线里的 1 条,
 * 遗物侧放弃 14 件里的 8 件 —— 扩到六条路线没有稀释取舍,反而把它加深了。
 *
 * ⚠️ **当前实际入池 13 件**(`POOL_RELIC_IDS`)—— 「灵石（财）」标了 `metaOnly`,
 *    局外成长接通前被挡在池外,所以现在的取舍是 **13 选 6、放弃 7 件**,
 *    正好与《build设计》§3.5 槽位经济学里「填满 6 遗物槽(13 选 6)」的预算口径对上。
 *    (它被上闸时入池只剩 12 件,是「聚灵珠」把这个名额填回来的 ——
 *     一件拿不到收益的局外货币遗物,换成一件真能兑现的局内修为遗物。)
 *    `RELICS` / `RELIC_IDS` 是完整的 14 件(贴图按它枚举),别误删条目。
 *
 * ## 为什么每件遗物是一段函数而不是一组常量
 *
 * 因为它们的**成长曲线互不相同**:
 *   天逆珠灵液 线性 +12%/级;天逆珠 却是每级 ×0.95(5 级才到 -25%);
 *   储物袋 加法 +40%(5 级 +200%),而按乘算会变成 ×5.4;
 *   散魔铠甲的「破魔 30%」只在 5 级出现,4 级和 1 级没有区别。
 * 一张统一的「每级加成」表表达不了这些,所以 mod() 拿到 level 自己算。
 * 好处是卡面文案可以直接调同一个函数,永远不会和实际数值对不上。
 */
export interface RelicConfig {
  id: string;
  name: string;
  /** 用于 HUD 图标与掉落物外观 */
  color: number;
  /** 对应的神通 id。存在即为专属遗物,只进该神通已学会后的卡池 */
  exclusive?: string;
  /** 该遗物在 level 级时的实际效果。level 恒为 1..5 */
  mod: (level: number) => { spell: Partial<SpellRelicMods>; player: Partial<PlayerRelicMods> };
  /** 卡面文案。同一个函数直接取当前等级的效果,保证描述与数值同源 */
  desc: (level: number) => string;
  /**
   * **收益完全落在局外成长上** —— 局外成长没接通前不入池(见 `FeatureConfig`)。
   *
   * 与 `exclusive` 是两回事:专属遗物是「有门槛」(没学对应神通就不给),
   * metaOnly 是「**现在给了也没用**」。两者可以同时成立,但当前没有这种条目。
   */
  metaOnly?: boolean;
}

export const MAX_RELIC_LEVEL = 5;
/** 遗物槽固定 6 个 —— 设计书 3.3:12 件里挑 6 件,这是唯一的取舍来源 */
export const RELIC_SLOTS = 6;

/** 攻速与冷却共用同一个冷却乘区(见 modCooldown 的注释) */
function spellMul(level: number, per: number): number {
  return 1 + per * level;
}

export const RELICS: Record<string, RelicConfig> = {

  // ===== 6 件专属遗物(同时是道法融合的钥匙)=====

  /** 火球术:每级 +12% 伤害,5 级 +60%。逐级线性,是这批里最"老实"的一件 */
  tianni_ye: {
    id: 'tianni_ye', name: '天逆珠灵液', color: 0xff8844, exclusive: 'fireball',
    mod: (l) => ({ spell: { damageMul: spellMul(l, 0.12) }, player: {} }),
    desc: (l) => `火球术伤害 +${(12 * l).toFixed(0)}%（满级 +60%，并解锁道法融合「焚天·火海」）`,
  },

  /** 寂灭指:每级 +10%,5 级额外「破魔」——无视 30% 护甲 */
  sanmo: {
    id: 'sanmo', name: '散魔铠甲', color: 0x9966cc, exclusive: 'jimie',
    mod: (l) => ({
      spell: { damageMul: spellMul(l, 0.10), armorPen: l >= MAX_RELIC_LEVEL ? 0.30 : 0 },
      player: {},
    }),
    desc: (l) => (l >= MAX_RELIC_LEVEL
      ? '寂灭指伤害 +50%；指气附带破魔，无视 30% 护甲（可融合「化魔指」）'
      : `寂灭指伤害 +${(10 * l).toFixed(0)}%`),
  },

  /**
   * 剑阵:每级 +10% 伤害、+0.4 把飞剑;5 级额外让飞剑获得穿透。
   *
   * 「穿透」在环绕形态上的落点是**命中冷却减半** —— 环绕体本来就不会因命中而停下,
   * 所以「打穿一排怪」只能表现为同一只怪被撞得更快。这与直线形态的穿透不是一回事,
   * 但它确实让 5 级的剑阵从「六把剑轮流蹭」变成「六把剑反复犁过去」。
   */
  xianjian: {
    id: 'xianjian', name: '仙剑', color: 0x88ddff, exclusive: 'jianzhen',
    mod: (l) => ({
      spell: { damageMul: spellMul(l, 0.10), orbAdd: 0.4 * l, orbitSpeedMul: l >= MAX_RELIC_LEVEL ? 2 : 1 },
      player: {},
    }),
    // ⚠️ 「穿透」的实现是 **orbitSpeed ×2**(飞剑转速翻倍),不是命中冷却减半。
    //    踩了两次才发现冷却不是旋钮:环绕 DPS = 飞剑数 × 伤害 ÷ 一圈时长,
    //    而能不能打第二下取决于飞剑**有没有转回去**。第一版用终身 hitSet,
    //    连冷却都形同虚设;改成按敌计时之后实测,把冷却从一圈压到半圈,
    //    命中次数只从 2 变 3 —— 它总共只经过那个位置 3 次。
    //    转速翻倍则是实打实的一圈两次,而且**画面上也读得出来**。
    desc: (l) => (l >= MAX_RELIC_LEVEL
      ? `剑阵伤害 +50%；飞剑 +${(0.4 * l).toFixed(1)} 把；飞剑穿透 —— 转速翻倍，一圈扫过两次（可融合「斩罗决」）`
      : `剑阵伤害 +${(10 * l).toFixed(0)}%；飞剑 +${(0.4 * l).toFixed(1)} 把`),
  },

  /** 厚土术:每级 +10%,5 级额外推送 +50%、减速 +10%(与法术自带减速叠加,合计 35%) */
  houtu_yin: {
    id: 'houtu_yin', name: '厚土印', color: 0xc8a05a, exclusive: 'houtu',
    mod: (l) => ({
      spell: {
        damageMul: spellMul(l, 0.10),
        pushMul: l >= MAX_RELIC_LEVEL ? 1.5 : 1,
        slowAdd: l >= MAX_RELIC_LEVEL ? 0.10 : 0,
      },
      player: {},
    }),
    desc: (l) => (l >= MAX_RELIC_LEVEL
      ? '厚土术伤害 +50%；推送 +50%；减速 +10%（可融合「山崩地裂」）'
      : `厚土术伤害 +${(10 * l).toFixed(0)}%`),
  },

  /** 五雷正法:每级 +10%,5 级额外感电上限 +2 层、持续 3.0s → 4.5s */
  zijin_lei: {
    id: 'zijin_lei', name: '紫金雷葫', color: 0xaaeeff, exclusive: 'wulei',
    mod: (l) => ({
      spell: {
        damageMul: spellMul(l, 0.10),
        shockCapAdd: l >= MAX_RELIC_LEVEL ? 2 : 0,
        shockMsAdd: l >= MAX_RELIC_LEVEL ? 1500 : 0,
      },
      player: {},
    }),
    desc: (l) => (l >= MAX_RELIC_LEVEL
      ? '五雷正法伤害 +50%；感电上限 +2 层、持续 4.5s（可融合「五雷轰顶」）'
      : `五雷正法伤害 +${(10 * l).toFixed(0)}%`),
  },

  /**
   * 仙帝传道画轴:每级 +10% 伤害、单道弧宽 +8%;5 级额外一道「主龙」(融合后生效)。
   *
   * `arcSpanMul` 现在作用在**单道弧弹的宽度**上(`arcWidth`),不再是释放的散布角。
   * 理由见 WeaponSystem.fireArc:加宽散布角只会把弹打得更散、在正前开一个
   * 谁都打不到的死区;加宽单道是单调收益,加满时相邻两道几近相切。
   *
   * +40% 是**倍率**:满级单道 50° → 70°,而 3 道的道间距是 73° ——
   * 于是画轴满级时三道几乎连成一片弧面。这是「覆盖面」这条收益的落点。
   * ⚠️ 设计书写的是「220° → 300°」,那是按旧口径(总张角)算的口算值;
   *    现在口径换了维度,卡片文案只印百分比,不印度数,免得对不上。
   */
  xiandi_huazhou: {
    // 颜色取自素材本身:那卷画是「青碧画心 + 褐色轴头」,
    // 画心占面积最大也最独特,所以取画心的 #16a296,不是轴头的褐
    // (褐会与储物袋 #c8b070 撞车)。
    id: 'xiandi_huazhou', name: '仙帝传道画轴', color: 0x16a296, exclusive: 'longjuan',
    mod: (l) => ({
      spell: { damageMul: spellMul(l, 0.10), arcSpanMul: spellMul(l, 0.08) },
      player: {},
    }),
    desc: (l) => (l >= MAX_RELIC_LEVEL
      ? '龙卷伤害 +50%；单道弧宽 +40%（50°→70°，三道几乎连成一片）；融合后多出第 9 道「主龙」（可融合「仙术·呼风」）'
      : `龙卷伤害 +${(10 * l).toFixed(0)}%；单道弧宽 +${(8 * l).toFixed(0)}%`),
  },

  // ===== 7 件通用遗物 =====

  /** 冷却每级 ×0.95,5 级 -25% */
  tianni_zhu: {
    // ⚠️ 天逆珠是**白**珠,不是琥珀色。早先这里写的是 0xddaa66(琥珀),
    //    而美术规格表从一开始就是白的 —— 两边对不上,后果是地面掉落物、
    //    面板色块、悟道卡片三处各画各的。
    //    取 #d8d8d4 而不是纯白:纯白在面板深底上会「发光」,
    //    而且和气运的 #ffee88、灵石的 #ffd070 挨在一起时边界发糊。
    id: 'tianni_zhu', name: '天逆珠', color: 0xd8d8d4,
    mod: (l) => ({ spell: {}, player: { cooldownMul: Math.pow(0.95, l) } }),
    desc: (l) => `所有神通冷却 -${((1 - Math.pow(0.95, l)) * 100).toFixed(0)}%（满级 -25%）`,
  },

  /** 最大生命每级 +10%,5 级额外「受击回血 2% 最大生命,3 秒一次」 */
  gushen_xue: {
    id: 'gushen_xue', name: '古神之血', color: 0xdd3355,
    mod: (l) => ({
      spell: {},
      player: {
        maxHealthMul: spellMul(l, 0.10),
        lifestealOnHit: l >= MAX_RELIC_LEVEL ? 0.02 : 0,
        lifestealCdMs: l >= MAX_RELIC_LEVEL ? 3000 : 0,
      },
    }),
    desc: (l) => (l >= MAX_RELIC_LEVEL
      ? '最大生命 +50%；受击回血 2% 最大生命（3 秒冷却）'
      : `最大生命 +${10 * l}%`),
  },

  /** 攻速每级 +6%,定身概率每级 +8%(5 级 40% 概率定身 1.0 秒) */
  dingshen: {
    id: 'dingshen', name: '定身术', color: 0x66ccff,
    mod: (l) => ({
      spell: {},
      player: { attackSpeedMul: spellMul(l, 0.06), freezeChance: 0.08 * l },
    }),
    desc: (l) => `攻速 +${6 * l}%；命中 ${(8 * l).toFixed(0)}% 概率定身 1.0 秒`,
  },

  /**
   * 暴击每级 +5%(满级 +25%)。暴击倍率固定 ×2 —— 遗物不加倍率,只加机会。
   *
   * 曾是 +3%/级(满级 +15%):全局暴击率**只**来自这一件(基础暴击为 0),
   * 同档通用遗物里定身术一给就是「攻速 +6% + 定身 8%」两行,
   * 3% 的机会率在尸潮里几乎读不出来 —— 期望伤害 +3%×1 = +3%/级,
   * 比任何一件纯伤害遗物都薄。提到 5%/级,满级 25% 才配得上「手感层」的定位。
   */
  qiyun: {
    id: 'qiyun', name: '气运', color: 0xffee88,
    mod: (l) => ({ spell: {}, player: { critChance: 0.05 * l } }),
    desc: (l) => `暴击率 +${5 * l}%`,
  },

  /** 移速每级 +4% */
  dunshu: {
    id: 'dunshu', name: '遁术', color: 0x99ffaa,
    mod: (l) => ({ spell: {}, player: { moveSpeedMul: spellMul(l, 0.04) } }),
    desc: (l) => `移动速度 +${4 * l}%`,
  },

  /**
   * 拾取半径每级 **+40%(加法)**。刻意不用乘算:乘算 5 级是 ×5.4,
   * 远超设计书的 +200%。这条是全表唯一一处「加法而非乘法」,
   * 因为它的满级数字在设计书里是按加法给的。
   */
  chuwandai: {
    id: 'chuwandai', name: '储物袋', color: 0xc8b070,
    mod: (l) => ({ spell: {}, player: { pickupMul: spellMul(l, 0.40) } }),
    desc: (l) => `拾取半径 +${40 * l}%`,
  },

  /**
   * 修为宝石获取每级 +6%,满级 +30%。
   *
   * ## 它是「灵石（财）」的**对内版本**
   *
   * 两件同形(每级 +6% / 满级 +30% / 都只放大一种掉落货币),差别在货币的**出口**:
   * 灵石是局外货币,而局外强化树没做,所以那件是空的(已上闸,见 `metaOnly`);
   * 修为是局内货币,每攒够一级就**立刻**弹出一次悟道三选一 —— 收益当帧兑现,
   * 这件是真的。所以它是把那一格遗物栏「从废牌换回一张牌」,而不是新增强度。
   *
   * ## 为什么敢给到 +30%
   *
   * 修为的兑换终点是**卡**,而卡的价值被槽位锁死:一局 ≈70 级就够
   * 「填满 5 法术 + 6 遗物 + 全部叠满 + 融合一次」(见《build设计》§3.5 的槽位经济学校验),
   * 多出来的等级会退化成消耗品与溢出折算。于是 +30% 修为 ≈ 提前/min 拿 10 级左右,
   * **有天花板、滚不成雪球** —— 这与「伤害 +30%」是两种东西,后者没有这个上限。
   * 真要把曲线调平,旋钮是升级曲线指数(1.75),不是这件遗物的百分比。
   *
   * ⚠️ 它**只吃地面上的宝石**(`PickupKind 'xp'`)。「加修为丹药」与
   *    遗物槽满时的溢出折算都不走这条倍率 —— 那两处是补偿机制,把它们也放大
   *    等于「补偿的补偿」,且名字里的「宝石」就对不上了。
   */
  julingzhu: {
    // 颜色取品红:遗物池里唯一空着的色相区间 —— 红 350°(古神之血) / 金 45°(气运·储物袋) /
    // 绿 130°(遁术) / 青 175°(传道画轴) / 蓝 205°(定身术·仙剑) / 紫 270°(散魔铠甲)
    // 已经全部占满。「聚灵」用一抹不属于以上任何一类的异色灵光,地上一眼可辨。
    id: 'julingzhu', name: '聚灵珠', color: 0xff5fbf,
    mod: (l) => ({ spell: {}, player: { xpMul: spellMul(l, 0.06) } }),
    desc: (l) => `修为宝石获取 +${6 * l}%`,
  },

  /**
   * 灵石每级 +6%
   *
   * ⚠️ `metaOnly` —— 它加的是**局外货币**，而局外强化树还没做，
   *    所以这件现在是一件**零收益**的遗物：占掉 6 格遗物栏里的一格，
   *    换回一个花不出去的百分比。卡面文案看着完全正常（「灵石获取 +6%」确实生效），
   *    玩家只会觉得「这局手气差」，根本定位不到是系统没做完。
   *    局外成长接通后把 `FeatureConfig.META_PROGRESSION_ENABLED` 改回 true 即可回池。
   *
   * ⚠️ 它的**对内版本是「聚灵珠」**（`xpMul`），那件已经进池了 —— 两件同形，
   *    别把这一件也顺手放进池里当成「同款」：修为能立刻换成卡，灵石换不到任何东西。
   */
  lingshi: {
    id: 'lingshi', name: '灵石（财）', color: 0xffd070, metaOnly: true,
    mod: (l) => ({ spell: {}, player: { coinMul: spellMul(l, 0.06) } }),
    desc: (l) => `灵石获取 +${6 * l}%`,
  },
};

export const RELIC_IDS = Object.keys(RELICS);

/**
 * **实际会出现在对局里**的遗物 id（卡池 + 精英掉落）。
 *
 * ⚠️ 与 `RELIC_IDS` 的分工，别混用：
 *   - `RELIC_IDS` = 「**定义**了哪些遗物」。`AssetGenerator` / `AssetLoader`
 *     按它枚举贴图键，少一个就会掉图 —— 所以它**必须**等于 `RELICS` 的全部键。
 *   - `POOL_RELIC_IDS` = 「玩家**能拿到**哪些遗物」。卡池与掉落池读这个。
 *
 * 混用的后果很具体：若把 `RELIC_IDS` 直接砍掉灵石（财），贴图键 `pickup_relic_lingshi`
 * 会跟着消失，于是「遗物图鉴」与调试面板里那件变成缺失贴图的绿方块 ——
 * 一件只是暂时不入池的遗物不该在贴图管线里蒸发。
 */
export const POOL_RELIC_IDS = RELIC_IDS.filter(
  (id) => META_PROGRESSION_ENABLED || !RELICS[id].metaOnly,
);

export function relicName(id: string): string {
  return RELICS[id]?.name ?? id;
}

/** 「天逆珠灵液 +2」这样的短标签。HUD 与 tooltip 都用它 */
export function describeRelic(id: string, level: number): string {
  const c = RELICS[id];
  if (!c) return id;
  return `${c.name} +${level}`;
}

export function isRelicKey(id: string): boolean {
  return !!RELICS[id]?.exclusive;
}

/**
 * 某一门神通当前可获得的专属遗物。
 *
 * 卡池用它做门槛:没学会对应神通的专属遗物不进池 ——
 * 抽到「仙剑」却没学剑阵是废牌(设计书 3.3 规则 2)。
 */
export function exclusiveRelicsFor(spellId: string): string[] {
  return POOL_RELIC_IDS.filter((id) => RELICS[id].exclusive === spellId);
}

/**
 * 自检:每一件专属遗物都必须挂在一条进化链上。
 *
 * 通用遗物恒可获得(悟道池里无条件有它);专属遗物只有「对应的法术已学会」
 * 时才进池,而它存在的全部理由是当那把钥匙 —— 没挂在任何链上的专属遗物
 * 会占着卡池位置却换不到融合。调用方把 EVOLUTIONS 的钥匙集合传进来,
 * 而不是在这里反向 import 进化表(那会绕成循环依赖)。
 */
export function validateRelicReachability(knownKeys: Set<string>): string[] {
  return RELIC_IDS.filter((id) => RELICS[id].exclusive && !knownKeys.has(id));
}