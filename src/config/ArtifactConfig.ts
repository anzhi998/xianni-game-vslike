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
};

/** 法宝最高阶数。重复拾取已装备的法宝即为升阶,而不是弹出替换界面。 */
export const MAX_ARTIFACT_TIER = 3;

/** 所有法宝 id,供掉落随机使用 */
export const ARTIFACT_IDS = Object.keys(ARTIFACTS);