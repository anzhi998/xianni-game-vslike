/**
 * 全局游戏事件常量
 *
 * ⚠️ UIScene 订阅用的是**字符串字面量**而不是这个枚举(见 CLAUDE.md)。
 *    改这里的名字时记得同步 UIScene,否则 HUD 会静默地不再刷新。
 */
export const GameEvents = {
  PLAYER_DAMAGED: 'player-damaged',
  PLAYER_HEALED: 'player-healed',
  PLAYER_DIED: 'player-died',
  PLAYER_LEVEL_UP: 'player-level-up',
  ENEMY_KILLED: 'enemy-killed',
  XP_COLLECTED: 'xp-collected',
  WEAPON_FIRED: 'weapon-fired',
  GAME_PAUSE: 'game-pause',
  GAME_RESUME: 'game-resume',
  UPGRADE_APPLIED: 'upgrade-applied',
  /** 获得遗物或遗物升阶,载荷为 (遗物 id, 事后等级) */
  RELIC_EQUIPPED: 'relic-equipped',
  /** 神通精进一级,载荷为 (神通 id, 事后等级) */
  SPELL_LEVEL_UP: 'spell-level-up',
  /** 灵石数量变化,载荷为当前灵石数 */
  COINS_CHANGED: 'coins-changed',
  /** 大境界突破,载荷为新境界简称 */
  BREAKTHROUGH: 'breakthrough',
  /** 道法融合,载荷为 (融合后 id, 融合后名称) */
  SPELL_EVOLVED: 'spell-evolved',
  /** 获得洞府宝箱,载荷为品质 wood/jade/gold */
  CHEST_OBTAINED: 'chest-obtained',
  /** 宝箱已开,载荷为本次剩余的三选一次数 */
  CHEST_RESOLVED: 'chest-resolved',
  /** 环境危害开始喷发,载荷为 (x, y) */
  HAZARD_ERUPTED: 'hazard-erupted',
  /** Boss 登场,载荷为 Boss id */
  BOSS_SPAWNED: 'boss-spawned',
  /** Boss 死亡,载荷为 Boss id */
  BOSS_KILLED: 'boss-killed',
} as const;

/**
 * 悟道三选一的卡类型
 *
 * 对应《build设计》第三节的池子:新法术 / 法术升级 / 新遗物 / 遗物叠层 / 消耗品。
 * 「道法融合」不在这张卡池里 —— 它是宝箱结算的产物(见 ChestSystem)。
 */
export type UpgradeType =
  | 'newSpell'
  | 'spellLevel'
  | 'newRelic'
  | 'relicLevel'
  | 'consumable'
  | 'evolve';

/**
 * 升级条目
 */
export interface Upgrade {
  id: string;
  type: UpgradeType;
  name: string;
  description: string;
  iconColor: number;
  /**
   * 施加升级所需的全部上下文。
   *
   * 早期版本签名是 (player: Player),但那样无法表达「某门神通+1级」
   * 「+1 遗物槽」这类需要跨系统判断的卡,所以改为传入上下文。
   */
  apply: (ctx: UpgradeContext) => void;
}

/**
 * 升级上下文
 *
 * 卡池由 GameScene 构建(只有它同时握有全部系统,也只有它知道槽位是否已满),
 * 然后连同 ctx 一起交给 UpgradeScene —— UpgradeScene 因此保持「只渲染 + 回调」的形态。
 */
export interface UpgradeContext {
  player: import('../entities/Player').Player;
  weaponSystem: import('../systems/WeaponSystem').WeaponSystem;
  relicSystem: import('../systems/RelicSystem').RelicSystem;
  /** 清屏符要打全场:走 GameScene 的统一伤害入口 */
  damageAllEnemies: (amount: number) => void;
  /** 灵石袋 */
  addCoins: (amount: number) => void;
  /** 玩家当前等级。消耗品(清屏符)按它缩放 */
  level: number;
}

/**
 * 一次伤害附带的状态
 *
 * 为什么走参数而不是各形态自己去改敌人:「受到伤害」这件事只有一个观察点
 * (GameScene.applyDamageToEnemy)。点燃、减速、感电、流血、定身全部挂在这里,
 * 新增一种攻击形态时就不需要记得去补一遍 —— 忘了的话症状是
 * 「法术明明写了 30% 减速,怪却一点没慢」,而且只在实战里才看得见。
 */
export interface DamageOptions {
  /** 无视目标护甲的比例(破魔 / 破防) */
  armorPen?: number;
  /** 点燃 / 流血:每秒伤害与持续时间 */
  burn?: { dps: number; ms: number } | null;
  /** 减速强度 0~1 与持续时间 */
  slow?: { mul: number; ms: number } | null;
  /** 感电:叠加层数与刷新持续时间 */
  shock?: { stacks: number; ms: number } | null;
  /**
   * 伤害的元素。只有雷系带这个标记 ——
   * 感电只强化雷系自身伤害,所以「这一发是不是雷」必须能被识别,
   * 否则给一只叠了感电的怪丢一发火球也会吃雷系加成。
   */
  element?: 'thunder';
  /**
   * 吹熄:本次命中把「血量低于该比例」的敌人**直接抹除**。
   *
   * 0 = 本形态不带吹熄。之所以挂在 DamageOptions 而不是各形态自己判断,
   * 是因为「即死抗性」只有伤害入口知道该怎么看(见 Enemy.executeResist),
   * 而它绝不能长成第二个绕过 enemy.takeDamage 的击杀入口。
   *
   * 阈值还会被抗性折算:`有效阈值 = executeBelow × (1 - 即死抗性)`,
   * 精英抗性 0.5 → 20% 的阈值降成 10%,首领抗性 1 → 直接免疫。
   * 「不产生额外伤害」:抹除走静默击杀入口,不弹第二个伤害数字。
   */
  executeBelow?: number;
}

/**
 * 敌人受到伤害的回调。由 GameScene 注入,统一处理伤害数字、状态与击杀掉落。
 *
 * ⚠️ 这是**唯一**的伤害入口。新增攻击形态一律走它,不要直接调 enemy.takeDamage ——
 * 直接调会跳过伤害数字、暴击、定身、击杀掉落与死亡补间。
 */
export type DamageApplier = (
  enemy: import('../entities/Enemy').Enemy,
  amount: number,
  textX: number,
  textY: number,
  opts?: DamageOptions,
) => void;

/**
 * 攻击形态
 *
 * 直射   projectile 从玩家射出,直线飞行(寂灭指的射程、火球术的落点爆裂都在这里)
 * 环绕   orbiter     持续绕玩家公转,接触即伤害(剑阵)
 * 扇形   cone        前方扇面分 N 段推进,每段结算并把敌人向外推挤(厚土术)
 * 弧带   arc         一条**有厚度的弧带**自脚下向外旋卷,沿途把敌人往弧线内侧牵引(龙卷)
 * 连锁   chain       瞬时弹射,逐跳衰减并给目标叠感电(五雷正法)
 * 地效   zone        在指定地点持续灼烧(焚天·火海的落点火海)
 *
 * 六种几何两两不同:线 / 环 / 扇面 / 弧带 / 链 / 滞留。
 * 这是《build设计》第四节「五者在关闭特效、只看碰撞体时仍可一眼分辨」的代码落点。
 *
 * ⚠️ **弧带为什么不能复用扇形**:cone 是一整片**实心**扇面、逐段结算、
 *    有命中上限、把敌人**向外推**;arc 是一圈**薄弧**、整片同时飞出去、
 *    无命中上限(每目标结算 2 次封顶)、把敌人**向内拉**。两者方向相反、
 *    结算模型不同,共用一个形态会让「牵引」被推挤的命中上限卡住。
 */
export type AttackForm = 'projectile' | 'orbiter' | 'cone' | 'arc' | 'chain' | 'zone';

/** 敌人随机变异体 */
export interface EnemyMutation {
  elite: boolean;
  /** 0 = 普通,1 = 精英(同阶修士) */
  tier: number;
  hpMul: number;
  damageMul: number;
  speedMul: number;
  xpMul: number;
  scaleMul: number;
  /** 精英随机带的抗性(文档硬约束:绝不三抗齐全) */
  resist?: EnemyResist;
}

export const NORMAL_MUTATION: EnemyMutation = {
  elite: false, tier: 0,
  hpMul: 1, damageMul: 1, speedMul: 1, xpMul: 1, scaleMul: 1,
};

/**
 * 掉落物种类。共用同一个 Pickup 池
 *
 * xp        灵气(经验)
 * relic     遗物
 * heal      回春丹
 * xpPill    加修为的丹药
 * chest     洞府宝箱,payload 为 wood / jade / gold
 *
 * 后两类的数量在**拾取时**按玩家当前状态计算,而不是掉落时 ——
 * 精英可能在拾取之前就被别的机制吞掉,掉落时算好的数值到拾取时就过期了。
 */
export type PickupKind =
  | 'xp' | 'relic' | 'heal' | 'xpPill' | 'chest'
  /** 幻饵:长得和灵气一模一样的假货,靠近即爆 */
  | 'bait'
  /** 伪宝匣:长得和洞府宝箱一模一样的假货,靠近后变成敌人 */
  | 'mimic';

/** 一条掉落表条目 */
export interface DropEntry {
  kind: PickupKind;
  /** kind==='xp' 时是数值,relic 时是 id,heal/xpPill/chest 时忽略或品质 */
  payload: number | string;
}

/**
 * 逼近几何 ——《怪物设计》文档第一节对偶表在代码里的落点
 *
 * 每个原型只负责一件事:它怎么逼近,决定玩家必须用哪种覆盖形状应对。
 * chase    直线冲脸 —— 群怪,教学段
 * advance  稳步推进 —— 坦克,慢、厚、接触即重伤
 * stealth  穿墙潜行 —— 潜行,在屏内任意角度现身,「后方」失效
 * flank    环绕包抄 —— 术修集群,绕到侧后合围
 * ranged   远程驻停 —— 术修,保持距离隔空放法
 * bomber   逼近自爆 —— 贴上即伤,把「不让它靠近」变成输出
 * splitter 死后衍化 —— 清屏 ≠ 清干净
 * charger  冲锋突刺 —— 高危单体,蓄力后突进
 * puller   拉拽牵引 —— 夺走站位主动权
 * boss     首领行为 —— 只负责「按阶段出什么招」,移动仍是直线追击
 */
export type Approach =
  | 'chase'
  | 'advance'
  | 'stealth'
  | 'flank'
  | 'ranged'
  | 'bomber'
  | 'splitter'
  | 'charger'
  | 'puller'
  | 'boss'
  // ---- 机制怪专属 ----
  | 'gemEater'  // 噬灵虫:追地上的掉落物,吃掉即强化
  | 'hexer'     // 寄魂:缓慢靠近,定期附身附近普通怪
  | 'shepherd'; // 引路尸:缓慢靠近,把沿途的怪拖到自己身后

/** 原型。决定美术分型与自检 */
export type EnemyArchetype =
  | 'horde'     // 群怪
  | 'tank'      // 坦克
  | 'caster'    // 术修
  | 'stalker'   // 潜行
  | 'bomber'    // 自爆
  | 'spawnling' // 衍体
  | 'beast'     // 高危单体
  | 'soul'      // 终局混合
  | 'guardian'; // 首领

/**
 * 敌人抗性
 *
 * 硬约束:精英最多带两条,绝不三抗齐全 —— 三抗齐全会让控制彻底失效,
 * 玩家只剩「堆伤害」一条路,几何等于白设计。
 */
export interface EnemyResist {
  /** 牵引抗性:免疫聚拢类法术 */
  pull?: boolean;
  /** 定身抗性:免疫冻结 */
  freeze?: boolean;
  /** 击退抗性:厚土术的推挤对它无效(《build设计》第七节 ④ 的已知冲突点) */
  knockback?: boolean;
}

/**
 * 机制怪专属参数
 *
 * 机制怪「每一只都对应一条『此前一直有效的经验,这次不管用』」,
 * 所以它们的能力都不在数值上,而在这张表描述的例外里。
 */
export interface EnemyMechanism {
  /** 追命者:每受一次伤害永久加速一档,封顶 speedCap */
  speedPerHit?: number;
  speedCap?: number;
  /** 伪仙:死亡瞬间的反噬(以玩家为圆心判定) */
  deathBlast?: { radius: number; damage: number };
  /** 遮天:存活期间压暗屏幕边缘。它不造成任何伤害 */
  vignette?: boolean;
  /** 噬灵虫:吃掉地面掉落物的半径,以及每吃一份的永久成长 */
  eatRadius?: number;
  eatHpGain?: number;
  eatSpeedGain?: number;
  /** 寄魂:附身的间隔与搜索半径 */
  hexIntervalMs?: number;
  hexRadius?: number;
  /** 引路尸:把附近怪拖到身后的半径 */
  dragRadius?: number;
}

/** 冲锋突刺的时间参数(全部走数值字段,不用 tween —— 池化对象带 tween 会跨存活期) */
export interface EnemyCharge {
  /** 蓄力前摇(毫秒),期间停住不动,给玩家反应窗口 */
  windupMs: number;
  /** 突进持续(毫秒) */
  dashMs: number;
  /** 突进速度倍率 */
  dashSpeedMul: number;
  /** 突进结束后的冷却(毫秒) */
  cooldownMs: number;
}

/**
 * 敌人配置
 */
export interface EnemyConfig {
  id: string;
  name: string;
  /** 逼近几何。决定 EnemyAiSystem 用哪套移动逻辑 */
  approach: Approach;
  /** 原型。用于美术分型与自检 */
  archetype: EnemyArchetype;
  maxHealth: number;
  speed: number;
  contactDamage: number;
  xpValue: number;
  size: number;
  color: number;
  bodyColor: number;
  /**
   * 护甲:0~0.5 的伤害减免。
   * 傀儡卫的「高减伤」靠它成立,化魔指的「破魔 30%」与斩罗的「破防 35%」
   * 也靠 armorPen 穿透它 —— 少了这个字段,那两条遗物/进化就只是文案。
   */
  armor?: number;
  /** 天生抗性(精英是另掷的,见 EliteConfig.rollEliteResists) */
  resist?: EnemyResist;
  /** 机制怪专属参数。只有机制怪会带它 */
  mechanism?: EnemyMechanism;
  /** 首领 id。存在即由 BossSystem 按时间表投放,不进刷怪表 */
  boss?: string;

  // ---- 行为参数(只有对应 approach 会读)----
  /** ranged / flank / boss: 驻停距离(像素) */
  attackRange?: number;
  /** flank: 环绕半径(像素) */
  flankRadius?: number;
  /** ranged / flank: 开火间隔(毫秒) */
  fireIntervalMs?: number;
  /** ranged / flank: 弹速 */
  shotSpeed?: number;
  /** ranged / flank: 单发伤害 */
  shotDamage?: number;
  /** bomber: 起爆距离与爆炸伤害 */
  explodeRadius?: number;
  explodeDamage?: number;
  /** splitter: 死亡后裂成几只什么 */
  splitInto?: { type: string; count: number };
  /** charger: 冲锋时间参数 */
  charge?: EnemyCharge;
  /** puller: 牵引半径与拉力速度(px/s) */
  pullRadius?: number;
  pullSpeed?: number;
}

/**
 * 遗物对**某一门神通**的修饰
 *
 * 专属遗物只强化它对应的那一门(散魔铠甲不该给火球术加成),所以这是一张
 * 「按神通 id 索引」的表,而不是全局 FireModifiers。
 * 合并规则见 RelicSystem.mergeSpellMods。
 */
export interface SpellRelicMods {
  /** 该神通的伤害倍率(专属遗物 + 通用遗物里的全局项都落在这里) */
  damageMul: number;
  /** 额外飞剑数(仙剑) */
  orbAdd: number;
  /** 额外穿透(通用遗物里的「穿透」项) */
  pierceAdd: number;
  /**
   * 环绕转速倍率(仙剑 5 级「穿透」)
   *
   * ⚠️ 它**曾经**是 `pierceAdd` 被 `fireOrbiter` 当成「命中冷却减半」来用 ——
   *    而那在环绕体系里几乎没有意义:飞剑擦过一只怪之后能不能再打,
   *    取决于它**有没有转回去**,不是冷却到没到。实测(无头夹具,把 `hitCd`
   *    从一圈压到半圈)命中次数只从 2 变 3,因为它一共只经过那个位置 3 次。
   *    环绕 DPS = 飞剑数 × 伤害 ÷ 一圈时长,所以真正的旋钮是**转速**。
   */
  orbitSpeedMul: number;
  /** 推距倍率(厚土印) */
  pushMul: number;
  /**
   * 弧角倍率(仙帝传道画轴)
   *
   * 只对弧带形态有意义。画轴每级 +8%,满级 +40% —— 这是它把「一条弧」
   * 变成「几乎半圈」的那一半收益,与 `damageMul` 同一件遗物给、但作用在
   * 完全不同的维度上(一个改伤害,一个改覆盖面)。
   */
  arcSpanMul: number;
  /** 额外减速幅度(厚土印) */
  slowAdd: number;
  /** 感电层数上限加成(紫金雷葫) */
  shockCapAdd: number;
  /** 感电持续加成(毫秒,紫金雷葫) */
  shockMsAdd: number;
  /** 无视护甲比例(散魔铠甲「破魔」) */
  armorPen: number;
}

/**
 * 遗物对**玩家**的修饰
 *
 * 与 Player 上的字段同构:加法用 +、乘法用 ×。
 */
export interface PlayerRelicMods {
  maxHealthMul: number;
  moveSpeedMul: number;
  pickupMul: number;
  cooldownMul: number;
  /** 攻速倍率(定身术:与冷却无关的独立攻速线) */
  attackSpeedMul: number;
  critChance: number;
  /** 暴击倍率(气运) */
  critMul: number;
  /** 命中定身概率(定身术满级 40%) */
  freezeChance: number;
  /** 定身时长(毫秒) */
  freezeMs: number;
  /** 灵石获取倍率 */
  coinMul: number;
  /** 每秒回血 */
  healthRegen: number;
  /** 受击回血占最大生命的比例,0 = 无 */
  lifestealOnHit: number;
  /** 受击回血的冷却(毫秒),0 = 无 */
  lifestealCdMs: number;
}

/** 全中性修饰集合:没装备任何遗物时 RelicSystem 返回它 */
export const NEUTRAL_PLAYER_MODS: PlayerRelicMods = {
  maxHealthMul: 1,
  moveSpeedMul: 1,
  pickupMul: 1,
  cooldownMul: 1,
  attackSpeedMul: 1,
  critChance: 0,
  critMul: 2,
  freezeChance: 0,
  freezeMs: 1000,
  coinMul: 1,
  healthRegen: 0,
  lifestealOnHit: 0,
  lifestealCdMs: 0,
};

export function neutralSpellMods(): SpellRelicMods {
  return {
    damageMul: 1,
    orbAdd: 0,
    pierceAdd: 0,
    orbitSpeedMul: 1,
    pushMul: 1,
    arcSpanMul: 1,
    slowAdd: 0,
    shockCapAdd: 0,
    shockMsAdd: 0,
    armorPen: 0,
  };
}

/** 玩家已装备的一件遗物 */
export interface RelicInstance {
  id: string;
  level: number;
}