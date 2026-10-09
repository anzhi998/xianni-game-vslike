/**
 * 机制怪投放表 ——《怪物设计》文档第四节
 *
 * 原型怪负责日常压力,机制怪负责**制造例外**。它们不进刷怪表,
 * 而是按时间间隔单只投放(原版每隔几分钟扔一只 Stalker / Drowner 出来),
 * 所以这里的两件事是分开的:
 *   - 什么时候投(间隔曲线,随时间收紧)
 *   - 投哪一只(按境界解锁 + 权重,且不允许连续两次同名)
 *
 * 「择优取用」在本作的落地就是这张表:秘境守依赖五行秘境、天运子依赖阶段 4
 * 的两条终局解,两者都不在这里 —— 它们不是「还没写」,是依赖的系统还不存在。
 */

/** 三种投放形态:敌人体、地面诱饵、屏幕级地形事件 */
export type MechanismKind = 'enemy' | 'bait' | 'mimic' | 'tide';

export interface MechanismDef {
  /** 敌人体时 = ENEMIES 的 id;否则是一个独立标识 */
  id: string;
  name: string;
  kind: MechanismKind;
  /** 从哪个大境界下标开始可能出现 */
  unlockRealmIndex: number;
  weight: number;
}

/** 第一次投放的时刻(秒)。开局先给一段纯粹的原型怪时间 */
export const FIRST_AT_SECONDS = 70;
/** 前期间隔(秒) */
export const INTERVAL_START = 85;
/** 后期(约 12 分钟)间隔(秒) */
export const INTERVAL_END = 45;
const RAMP_END_SECONDS = 720;

/** 投放间隔随时间收紧 —— 与精英密度同一套曲线语言 */
export function mechanismIntervalAt(seconds: number): number {
  const t = Math.min(1, seconds / RAMP_END_SECONDS);
  return INTERVAL_START + (INTERVAL_END - INTERVAL_START) * t;
}

/**
 * 机制怪池。
 *
 * 解锁顺序刻意与「它要打破的那条经验」出现的时间对齐:
 * 玩家先学会用某套打法(铺伤害、低头捡钱、看小地图边缘),
 * 再让对应的那只怪来把它作废。
 */
export const MECHANISMS: MechanismDef[] = [
  // 凝气:最早的一条经验是「输出越高越好」,追命者就是它的反例
  { id: 'chaser', name: '追命者', kind: 'enemy', unlockRealmIndex: 0, weight: 10 },
  // 筑基:玩家开始无脑清屏,伪仙来惩罚它
  { id: 'false_immortal', name: '伪仙', kind: 'enemy', unlockRealmIndex: 1, weight: 10 },
  // 结丹:开始随手捡灵石/随手开箱 —— 幻饵与噬灵虫一起给这两条习惯定价
  { id: 'spirit_gnawer', name: '噬灵虫', kind: 'enemy', unlockRealmIndex: 2, weight: 9 },
  { id: 'bait', name: '幻饵', kind: 'bait', unlockRealmIndex: 2, weight: 9 },
  // 元婴:宝匣开始值钱(必掉自精英),伪宝匣专门治「见箱就冲」
  { id: 'mimic', name: '伪宝匣', kind: 'mimic', unlockRealmIndex: 3, weight: 7 },
  { id: 'path_corpse', name: '引路尸', kind: 'enemy', unlockRealmIndex: 3, weight: 9 },
  // 化神:被合围之后,寄魂在怪堆里制造「必须先点掉的那一只」
  { id: 'soul_hexer', name: '寄魂', kind: 'enemy', unlockRealmIndex: 4, weight: 9 },
  // 婴变:信息开始被剥夺 —— 遮天不造成伤害,只让你看不见盲区
  { id: 'sky_veil', name: '遮天', kind: 'enemy', unlockRealmIndex: 5, weight: 8 },
  // 问鼎:唯一无法靠输出解决的威胁,权重压低 —— 它改变的是地形,不是强度
  { id: 'tide', name: '血海上涌', kind: 'tide', unlockRealmIndex: 6, weight: 5 },
];

/**
 * 掷出本次投放哪一只机制怪。
 *
 * 排除上一次投过的那一只 —— 「一次性事件怪」的价值在于意外,
 * 连续两次同名会把例外变成规律,玩家第二次就不会改动作了。
 */
export function rollMechanism(realmIndex: number, lastId = ''): MechanismDef | null {
  const pool = MECHANISMS.filter(
    (m) => m.unlockRealmIndex <= realmIndex && m.id !== lastId,
  );
  // 池子空时(只剩上次那一只可用)允许重复,总比不投放好
  const usable = pool.length > 0
    ? pool
    : MECHANISMS.filter((m) => m.unlockRealmIndex <= realmIndex);
  if (usable.length === 0) return null;

  const total = usable.reduce((s, m) => s + m.weight, 0);
  let r = Math.random() * total;
  for (const m of usable) {
    r -= m.weight;
    if (r <= 0) return m;
  }
  return usable[usable.length - 1];
}

// ===== 各形态的参数 =====

/** 幻饵:在玩家周围散布几枚假灵石 */
export const BAIT = {
  count: 3,
  minDist: 120,
  maxDist: 240,
  /** 靠近即爆的伤害与爆炸半径 */
  damage: 18,
  radius: 46,
};

/**
 * 伪宝匣:靠近后变成敌人。
 * 用蛊虫而不是随便一只 —— 「开箱开出一窝虫」比「开出一只精英」更记得住,
 * 而且它会分裂,贪心的代价会延续到开箱之后。
 */
export const MIMIC_ENEMY_ID = 'gu_worm';

/** 伪宝匣的落点距离 */
export const MIMIC_DIST = { min: 200, max: 360 };

/**
 * 血海上涌:屏幕下方升起一道持续伤害的魔气平面,缓慢上推,只能向上逃。
 *
 * 它是屏幕空间(camera 固定)而不是世界空间 —— 因为「把地图可用面积砍掉一半」
 * 说的是**视野**里能站的地方。写在世界坐标里,玩家只要往南跑就能甩掉它,
 * 那样它就不再是「无法靠输出解决」的那一类威胁了。
 */
export const TIDE = {
  riseMs: 2600,
  holdMs: 6500,
  recedeMs: 1600,
  /** 上推到屏幕高度的百分之多少处停住 */
  topFraction: 0.42,
  /** 身处其中的伤害与跳伤间隔 */
  damage: 9,
  tickMs: 500,
};
