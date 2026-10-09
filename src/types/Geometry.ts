/**
 * 覆盖几何 —— 设计书的第二条轴
 *
 * ============================== 为什么要有这一层 ==============================
 * 现有代码的 AttackForm(projectile/slam/arc/orbiter/zone)回答的是
 * 「攻击**怎么实现**」;设计书的 14 类几何回答的是
 * 「攻击**覆盖什么形状**」。两者是正交的两个维度:
 *
 *   一件神通可以是 slam 实现(怎么打)+ 向上抛投几何(覆盖什么)
 *
 * 几何决定站位与朝向 —— 覆盖形状互不相同 → 有盲区 → 玩家必须走位。
 * 这正是设计书说的「原版的乐趣来源」。
 *
 * 所以这一层不替换 AttackForm,而是叠加在它上面。
 * ==========================================================================
 */

/** 十四类覆盖几何 */
export type Geometry =
  /** 朝向直线:面向方向的一条穿刺线 */
  | 'line'
  /** 朝向扇形:面向方向的一片扇面 */
  | 'cone'
  /** 朝向光柱:面向方向的持续穿透光柱 */
  | 'beam'
  /** 左右横扫:身体两侧的横向打击 */
  | 'sweep'
  /** 向上抛投:抛物线越过自身落到身后 */
  | 'lob'
  /** 向心聚拢:把敌人拖向自己/一点 */
  | 'gravity'
  /** 环绕自身:以自己为圆心的常驻领域 */
  | 'orbit'
  /** 脚下领域:跟随自己移动的减速/伤害域 */
  | 'ground'
  /** 地面布点:随机落在地面的伤害水洼 */
  | 'scatter'
  /** 全屏随机:无视位置的随机结算 */
  | 'storm'
  /** 全场扫描:穿透一切、不造成伤害的冻结环 */
  | 'scan'
  /** 弹射反弹:遇边缘或敌人反弹的持久弹道 */
  | 'ricochet'
  /** 自动索敌:锁定最近的敌人自主攻击 */
  | 'seek'
  /** 周期结算:按固定周期结算全屏 */
  | 'pulse';

/** 几何的展示信息。悬停提示与解锁规则校验共用 */
export interface GeometryDef {
  id: Geometry;
  name: string;
  /** 覆盖形状一句话 */
  shape: string;
  /** 玩家的决策 —— 设计书原表的第三列 */
  decision: string;
}

export const GEOMETRIES: Record<Geometry, GeometryDef> = {
  line: {
    id: 'line', name: '朝向直线',
    shape: '面向方向的一条穿刺线',
    decision: '你必须始终对着威胁最大的方向',
  },
  cone: {
    id: 'cone', name: '朝向扇形',
    shape: '面向方向的一片扇面',
    decision: '扇面之外是盲区,不能背对怪流',
  },
  beam: {
    id: 'beam', name: '朝向光柱',
    shape: '面向方向的持续穿透光柱',
    decision: '光柱要持续压在精英身上',
  },
  sweep: {
    id: 'sweep', name: '左右横扫',
    shape: '身体两侧的横向打击',
    decision: '前后都是盲区,必须站进敌流正中',
  },
  lob: {
    id: 'lob', name: '向上抛投',
    shape: '抛物线越过自身落到身后',
    decision: '贴脸的怪打不到,要靠走位拉开',
  },
  gravity: {
    id: 'gravity', name: '向心聚拢',
    shape: '把敌人拖向自己/一点的引力场',
    decision: '它本身几乎不造成伤害——先聚拢,再让别的神通打',
  },
  orbit: {
    id: 'orbit', name: '环绕自身',
    shape: '以自己为圆心的常驻领域',
    decision: '要主动往怪堆里钻',
  },
  ground: {
    id: 'ground', name: '脚下领域',
    shape: '跟随自己移动的减速/伤害域',
    decision: '站桩时间越长收益越高',
  },
  scatter: {
    id: 'scatter', name: '地面布点',
    shape: '随机落在地面的伤害水洼',
    decision: '你完全控不住落点,只能靠范围堆',
  },
  storm: {
    id: 'storm', name: '全屏随机',
    shape: '无视位置的随机结算',
    decision: '你控不了,纯粹赌覆盖',
  },
  scan: {
    id: 'scan', name: '全场扫描',
    shape: '穿透一切、不造成伤害的冻结环',
    decision: '用来开窗口,不靠它输出',
  },
  ricochet: {
    id: 'ricochet', name: '弹射反弹',
    shape: '遇边缘或敌人反弹的持久弹道',
    decision: '站位越贴边、越容易被反复弹中',
  },
  seek: {
    id: 'seek', name: '自动索敌',
    shape: '锁定最近的敌人自主攻击',
    decision: '完全不需要瞄准,数量即强度',
  },
  pulse: {
    id: 'pulse', name: '周期结算',
    shape: '按固定周期结算全屏',
    decision: '抓节奏,卡在怪潮峰值时触发',
  },
};

/**
 * 五处「同几何复用」——设计书逐条核过的清单。
 *
 * 复用的前提是取向必须不同(同为环绕,万剑禁幡是输出、不灭之躯是护体)。
 * 这张表是解锁规则「同段几何不重复」的校验依据:
 * 如果有人给同一段塞了两件同几何、取向也相同的神通,应该在这里报错。
 */
export const GEOMETRY_SHARED_BY: Partial<Record<Geometry, string[]>> = {
  ground: ['sheng_si_yi_jing', 'liu_yue'],
  seek: ['shi_mei', 'wen_shou'],
  scan: ['ding_shen_shu', 'gu_shen_nu_hao'],
  line: ['huangquan_zhi', 'gu_shen_zhi_quan'],
  orbit: ['wan_jian_jin_fan', 'bu_mie_zhi_jun'],
};
