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
  /** 法宝被装备或升阶,载荷为法宝 id */
  ARTIFACT_EQUIPPED: 'artifact-equipped',
  /** 获得大境界突破道具,载荷为道具 id */
  KEYITEM_OBTAINED: 'keyitem-obtained',
  /** 大境界突破,载荷为新境界简称 */
  BREAKTHROUGH: 'breakthrough',
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
export interface WeaponConfig {
  id: string;
  name: string;
  /** 所属大境界 id。决定「参悟新术」卡从哪个池子里抽 */
  realmId: string;
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
}

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
  /** 0 = 普通,1~3 = 精英档位 */
  tier: number;
  hpMul: number;
  damageMul: number;
  speedMul: number;
  xpMul: number;
  scaleMul: number;
}

export const NORMAL_MUTATION: EnemyMutation = {
  elite: false, tier: 0,
  hpMul: 1, damageMul: 1, speedMul: 1, xpMul: 1, scaleMul: 1,
};

/** 掉落物种类。三类共用同一个 Pickup 池 */
export type PickupKind = 'xp' | 'artifact' | 'keyItem';

/** 一条掉落表条目 */
export interface DropEntry {
  kind: PickupKind;
  /** kind==='xp' 时是数值,其余是 id */
  payload: number | string;
}

/**
 * 敌人配置
 */
export interface EnemyConfig {
  id: string;
  name: string;
  maxHealth: number;
  speed: number;
  contactDamage: number;
  xpValue: number;
  size: number;
  color: number;
  bodyColor: number;
}
