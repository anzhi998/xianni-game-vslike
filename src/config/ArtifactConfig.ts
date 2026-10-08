import { NEUTRAL_MODS } from '../types';
import type { ArtifactConfig, FireModifiers } from '../types';

/**
 * 法宝表 —— 改写已装备法术的开火行为
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
  zhuixing_fan: {
    id: 'zhuixing_fan',
    name: '追星扇',
    desc: '扇面劲风扩散,一次化作五道锋刃',
    color: 0x66ccff,
    mods: mods({
      projectileAdd: 4,
      spreadRad: 0.22,
    }),
  },
  yinhun_bell: {
    id: 'yinhun_bell',
    name: '引魂铃',
    desc: '铃声摄魂,锋刃自行追索敌踪',
    color: 0xffee66,
    mods: mods({
      homingTurn: 4.5,
      homingRetargetMs: 150,
    }),
  },
  wanxue_banner: {
    id: 'wanxue_banner',
    name: '万血幡',
    desc: '血光连绵,命中后可跃向近处下一个敌人',
    color: 0xff5577,
    mods: mods({
      chainCount: 3,
      chainRadius: 260,
      chainFalloff: 0.85,
    }),
  },
  luohun_sword: {
    id: 'luohun_sword',
    name: '落魂剑',
    desc: '剑意夺魂,锋芒更盛且无坚不摧',
    color: 0xaa88ff,
    mods: mods({
      damageMul: 1.3,
      pierceAdd: 1,
    }),
  },
  xuantian_silk: {
    id: 'xuantian_silk',
    name: '玄天绫',
    desc: '绫影铺展,覆盖更广且绵延更久',
    color: 0xff99dd,
    mods: mods({
      areaMul: 1.35,
      lifeMul: 1.4,
    }),
  },
  taiji_tu: {
    id: 'taiji_tu',
    name: '太极图',
    desc: '阴阳轮转,法力流转迅疾',
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