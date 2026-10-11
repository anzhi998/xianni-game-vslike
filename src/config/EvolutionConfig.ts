/**
 * 道法融合表 —— 法术满 8 级 + 专属遗物满 5 级 + 开一次宝匣 → 进化
 *
 * 与旧版的区别有两处,都是刻意的:
 *   1. **没有倍率**。旧版给一个 EVOLUTION_MUL=2.2 让伤害翻倍,现在不翻了 ——
 *      每条进化的强度完全由它自己的数值行给(见 SpellConfig 里那五个单行法术),
 *      因为「机制 1.6 倍 + 数值 0.6 倍」这种拆法一旦用倍率表达,
 *      就会和那行手写数值互相打架。
 *   2. **钥匙只有一件**。旧版一条链可以挂多把法宝;设计书写的是
 *      「法术 8 级 + 对应专属遗物 5 级」,两件事。多把钥匙会让卡池算不清。
 */

export interface EvolutionDef {
  /** 基础法术 id */
  base: string;
  /** 融合后的法术 id */
  evolved: string;
  evolvedName: string;
  /** 融合掉的那件专属遗物 */
  keyRelic: string;
  /** 卡面上给玩家看的一句「凭什么」 */
  reason: string;
}

export const EVOLUTIONS: EvolutionDef[] = [
  {
    base: 'fireball', evolved: 'fenhai', evolvedName: '焚天·火海',
    keyRelic: 'tianni_ye',
    reason: '火球命中处炸开灼烧区,可叠 3 层 —— 单体点杀之外多了分割怪群的手段。',
  },
  {
    base: 'jimie', evolved: 'huamo', evolvedName: '化魔指',
    keyRelic: 'sanmo',
    reason: '光束范围 ×5、射程全屏、穿透无限 —— 一线扫过成片湮灭。',
  },
  {
    base: 'jianzhen', evolved: 'zhanluo', evolvedName: '斩罗决',
    keyRelic: 'xianjian',
    reason: '保留环绕,每 4 秒收束一次斩出等量放射剑气 —— 补上剑阵打不到远处炮台的短板。',
  },
  {
    base: 'houtu', evolved: 'shanbeng', evolvedName: '山崩地裂',
    keyRelic: 'houtu_yin',
    reason: '扇角扩到 180°,扇面末端隆起土墙 —— 推挤聚怪之外多了封路。',
  },
  {
    base: 'wulei', evolved: 'wulei_hong', evolvedName: '五雷轰顶',
    keyRelic: 'zijin_lei',
    reason: '感电上限翻倍,满层目标每 2 秒自动降一道天雷 —— 补上雷系单体不足的短板。',
  },
];

export function findEvolution(baseId: string): EvolutionDef | undefined {
  return EVOLUTIONS.find((e) => e.base === baseId);
}