/**
 * 全局游戏事件常量
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
  /** 法宝被装备或升阶,载荷为 (法宝 id, 事后阶数) */
  ARTIFACT_EQUIPPED: 'artifact-equipped',
  /** 获得大境界突破道具,载荷为道具 id */
  KEYITEM_OBTAINED: 'keyitem-obtained',
  /** 大境界突破,载荷为新境界简称 */
  BREAKTHROUGH: 'breakthrough',
  /** 神通进化,载荷为 (进化后 id, 进化后名称) */
  SPELL_EVOLVED: 'spell-evolved',
  /** 获得秘境宝匣,载荷为持有数量 */
  CHEST_OBTAINED: 'chest-obtained',
  /** 秘境宝匣已结算(可能一次触发多个进化),载荷为本次进化结果摘要 */
  CHEST_RESOLVED: 'chest-resolved',
} as const;

/**
 * 升级类型
 */
export type UpgradeType =
  | 'damage'
  | 'cooldown'
  | 'projectileCount'
  | 'projectileSpeed'
  | 'area'
  | 'pierce'
  | 'moveSpeed'
  | 'pickupRange'
  | 'maxHealth'
  | 'healthRegen'
  /** 某门已装备法术精进一级 */
  | 'spellLevel'
  /** 某件已装备法宝祭炼一级 */
  | 'artifactLevel'
  /** 参悟一门尚未掌握的新法术 */
  | 'newSpell'
  /** 开辟额外法术槽位 */
  | 'spellSlot';

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
   * 早期版本签名是 (player: Player),但那样无法表达「某门法术+1级」
   * 「+1 法术槽」这类需要跨系统判断的卡,所以改为传入上下文。
   */
  apply: (ctx: UpgradeContext) => void;
}

/**
 * 升级上下文
 *
 * 卡池由 GameScene 构建(只有它同时握有四个系统,也只有它知道槽位是否已满),
 * 然后连同 ctx 一起交给 UpgradeScene —— UpgradeScene 因此保持「只渲染 + 回调」的形态。
 */
export interface UpgradeContext {
  player: import('../entities/Player').Player;
  weaponSystem: import('../systems/WeaponSystem').WeaponSystem;
  artifactSystem: import('../systems/ArtifactSystem').ArtifactSystem;
}

/**
 * 武器配置
 */
/**
 * 攻击形态
 *
 * 直射   projectile  从玩家射出,直线飞行,可被法宝改写(追踪/连锁/散射)
 * 落印   slam        从目标头顶垂直砸落,落地时对落点周围造成范围伤害
 * 弧斩   arc         以玩家为中心扫过一段圆弧,沿途命中
 * 环绕   orbiter     持续存在并绕玩家公转,接触即伤害
 * 地效   zone        在指定地点持续存在一段时间,周期性对范围内造成伤害
 * 引力   attractor   把范围内敌人拖向一点。**不造成伤害** —— 纯控制
 * 扫描   scan        全场冻结环。**不造成伤害** —— 纯开窗口
 *
 * 注意:法宝的「追踪/连锁/散射」只对直射生效 —— 那三者本质都是改写弹道,
 * 落印/弧斩/环绕/地效没有弹道可改。其余数值类修饰(伤害/范围/冷却/存续)对所有形态生效。
 *
 * 引力与扫描是仅有的两个**零伤害**形态:它们的价值全在控制,
 * 伤害来自与它们搭配的其他神通。
 */
export type AttackForm = 'projectile' | 'slam' | 'arc' | 'orbiter' | 'zone' | 'attractor' | 'scan';

export interface WeaponConfig {
  id: string;
  name: string;
  /** 所属大境界 id。决定「参悟新术」卡从哪个池子里抽 */
  realmId: string;
  /** 攻击形态。非直射的形态由各自的实体类实现 */
  form: AttackForm;
  /** 投射物纹理键(AssetGenerator 生成) */
  texture: string;
  damage: number;
  cooldown: number;
  projectileSpeed: number;
  projectileCount: number;
  pierce: number;
  area: number;
  duration: number;
  color: number;

  /**
   * true = 走设计书的「重数」刻度(1..8 重,ritualDamageMul),
   * false = 走旧的「Lv」刻度(每级 ×1.25)。
   *
   * 阶段 1 先让新神通用重数、旧法术保持原样,阶段 2 替换法术表后全量迁移。
   * 切勿在同一个设计里混用两个词:「重数」与「等级」是不同的东西。
   */
  usesRituals?: boolean;

  // ---- 形态专属参数(仅对应 form 生效)----
  /** slam: 落点半径(像素) */
  slamRadius?: number;
  /** slam: 起始高度(像素),决定下砸的视觉落差 */
  slamHeight?: number;
  /** arc: 挥斩半径(像素) */
  arcRadius?: number;
  /** arc: 扫过的角度(弧度) */
  arcSpan?: number;
  /** orbiter: 环绕半径(像素) */
  orbitRadius?: number;
  /** orbiter: 公转角速度(弧度/秒) */
  orbitSpeed?: number;
  /** zone: 持续区域半径(像素) */
  zoneRadius?: number;
  /** zone: 每次跳伤间隔(毫秒) */
  zoneTickMs?: number;

  // ---- 覆盖几何(设计书第二条轴)----
  /**
   * 这门神通覆盖什么形状。
   *
   * 与 form 正交:form 决定**怎么实现**,geometry 决定**覆盖什么**。
   * 几何决定站位与朝向,是设计书所说的「原版乐趣来源」。
   */
  geometry?: import('./Geometry').Geometry;

  // ---- 形态专属参数(引力/扫描)----
  /** attractor: 把敌人往中心拉的速度(px/s)。见 Attractor.pull 的单位说明 */
  attractorPull?: number;
  /** attractor/scan: 持续时长(毫秒) */
  fieldLifeMs?: number;
  /** scan: 定身强度 0~1,1 = 完全定住 */
  freezeStrength?: number;
}

/** 敌人受到伤害的回调。由 GameScene 注入,统一处理伤害数字与击杀掉落 */
export type DamageApplier = (
  enemy: import('../entities/Enemy').Enemy,
  amount: number,
  textX: number,
  textY: number,
) => void;

/**
 * 法宝对开火行为的修饰集合
 *
 * 设计要点:这个接口刻意与 Player 上的修饰字段同构
 * (加法用 +、乘法用 ×)。WeaponSystem.fire() 因此只需把
 * 「法术基础值 × Player 修正 × 法宝修正」三者合成一次,
 * 循环内零分支 —— 不需要为每件法宝写 if。
 */
export interface FireModifiers {
  // ---- 与 Player 修饰面镜像的数值 ----
  /** 额外发射的投射物数量 */
  projectileAdd: number;
  projectileSpeedMul: number;
  damageMul: number;
  cooldownMul: number;
  areaMul: number;
  /** 额外穿透次数 */
  pierceAdd: number;
  /** 投射物存在时间倍率 */
  lifeMul: number;

  // ---- 法宝专属的行为开关 ----
  /** 散射总张角(弧度)。0 = 退回 WeaponSystem 的默认张角 */
  spreadRad: number;
  /** 追踪转向速率(弧度/秒)。0 = 直线飞行 */
  homingTurn: number;
  /** 追踪重新索敌的间隔(毫秒) */
  homingRetargetMs: number;
  /** 命中后可连锁跳转的额外次数 */
  chainCount: number;
  /** 连锁搜索半径(像素) */
  chainRadius: number;
  /** 每次连锁跳转的伤害衰减倍率 */
  chainFalloff: number;
}

/**
 * 全中性修饰集合。
 * 不装备任何法宝时 ArtifactSystem.getModifiers() 返回它,
 * 此时 fire() 的行为与改造前完全一致。
 */
export const NEUTRAL_MODS: FireModifiers = {
  projectileAdd: 0,
  projectileSpeedMul: 1,
  damageMul: 1,
  cooldownMul: 1,
  areaMul: 1,
  pierceAdd: 0,
  lifeMul: 1,
  spreadRad: 0,
  homingTurn: 0,
  homingRetargetMs: 150,
  chainCount: 0,
  chainRadius: 0,
  chainFalloff: 1,
};

/** 法宝定义。字段含义同 FireModifiers,重复拾取时按阶数放大。 */
export interface ArtifactConfig {
  id: string;
  name: string;
  desc: string;
  /** 用于 HUD 图标与掉落物外观 */
  color: number;
  mods: FireModifiers;
}

/** 玩家已装备的一件法宝 */
export interface ArtifactInstance {
  id: string;
  level: number;
}

/**
 * 精英变异 —— 普通怪随机变异而成
 *
 * 注意:目前没有任何定时 Boss。精英就是普通怪按时间间隔掷出的变异个体。
 */
export interface EnemyMutation {
  elite: boolean;
  /** 0 = 普通,1 = 精英(同阶修士)。档位已按文档合并为单档 */
  tier: number;
  hpMul: number;
  damageMul: number;
  speedMul: number;
  xpMul: number;
  scaleMul: number;
  /** 精英随机带的 1~2 条抗性(文档硬约束:绝不三抗齐全) */
  resist?: import('./index').EnemyResist;
}

export const NORMAL_MUTATION: EnemyMutation = {
  elite: false, tier: 0,
  hpMul: 1, damageMul: 1, speedMul: 1, xpMul: 1, scaleMul: 1,
};

/**
 * 掉落物种类。共用同一个 Pickup 池
 *
 * xp / artifact / keyItem  —— 主循环掉落
 * heal                     —— 回血丹药,回复最大气血的固定比例
 * xpPill                   —— 加经验丹药,给予当前一级所需修为的固定比例
 * chest                    —— 秘境宝匣。10:00 后才掉落,拾取时优先结算进化
 *
 * 后两类的数量在**拾取时**按玩家当前状态计算,而不是掉落时 ——
 * 精英可能在境界突破前就被击杀,掉落时算好的数值到拾取时就过期了。
 */
export type PickupKind =
  | 'xp' | 'artifact' | 'keyItem' | 'heal' | 'xpPill' | 'chest'
  /** 幻饵:长得和灵液一模一样的假货,靠近即爆 */
  | 'bait'
  /** 伪宝匣:长得和秘境宝匣一模一样,靠近后变成敌人 */
  | 'mimic';

/** 一条掉落表条目 */
export interface DropEntry {
  kind: PickupKind;
  /** kind==='xp' 时是数值,artifact/keyItem 时是 id,heal/xpPill 时忽略 */
  payload: number | string;
}

/**
 * 逼近几何 ——《怪物设计》文档第一节对偶表在代码里的落点
 *
 * 每个原型只负责一件事:它怎么逼近,决定玩家必须用哪种覆盖形状应对。
 * chase   直线冲脸 —— 群怪,教学段
 * advance 稳步推进 —— 坦克,慢、厚、接触即重伤
 * stealth 穿墙潜行 —— 潜行,在屏内任意角度现身,「后方」失效
 * flank   环绕包抄 —— 术修集群,绕到侧后合围
 * ranged  远程驻停 —— 术修,保持距离隔空放法
 * bomber  逼近自爆 —— 贴上即伤,把「不让它靠近」变成输出
 * splitter 死后衍化 —— 清屏 ≠ 清干净
 * charger 冲锋突刺 —— 高危单体,蓄力后突进
 * puller  拉拽牵引 —— 夺走站位主动权
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
  // ---- 机制怪专属(第四节)----
  | 'gemEater'  // 噬灵虫:追地上的掉落物,吃掉即强化
  | 'hexer'     // 寄魂:缓慢靠近,定期附身附近普通怪
  | 'shepherd'; // 引路尸:缓慢靠近,把沿途的怪拖到自己身后

/** 六个原型(文档第二节)。决定美术分型,也是「每原型只负责一件事」的自检依据 */
export type EnemyArchetype =
  | 'horde'     // 群怪
  | 'tank'      // 坦克
  | 'caster'    // 术修
  | 'stalker'   // 潜行
  | 'bomber'    // 自爆
  | 'spawnling' // 衍体
  | 'beast'     // 高危单体
  | 'soul';     // 终局混合

/**
 * 敌人抗性(文档第六节)
 *
 * 硬约束:同一只精英最多两条,绝不三抗齐全 —— 三抗齐全会让控制彻底失效,
 * 玩家只剩「堆伤害」一条路,十四类几何等于白设计。
 */
export interface EnemyResist {
  /** 牵引抗性:免疫引力术的聚拢 */
  pull?: boolean;
  /** 定身抗性:免疫扫描环的冻结 */
  freeze?: boolean;
  /** 即死抗性:免疫梦道 · 一梦万古的即死结算(阶段 4,先占位) */
  instakill?: boolean;
}

/**
 * 机制怪专属参数(怪物设计文档第四节)
 *
 * 八只机制怪「每一只都对应一条『此前一直有效的经验,这次不管用』」,
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
  /** 天生抗性(精英是另掷的,见 EliteConfig.rollEliteResists) */
  resist?: EnemyResist;
  /** 机制怪专属参数。只有机制怪会带它 */
  mechanism?: EnemyMechanism;

  // ---- 行为参数(只有对应 approach 会读)----
  /** ranged / flank: 驻停距离(像素) */
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
