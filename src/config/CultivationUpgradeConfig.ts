import type { Upgrade, UpgradeContext, UpgradeType } from '../types';
import { META_PROGRESSION_ENABLED } from './FeatureConfig';

/**
 * 悟道卡池里的「消耗品」
 *
 * 《build设计》3.3 给了卡池五类的权重(新法术 30 / 法术升级 22 / 新遗物 25 /
 * 遗物叠层 13 / 消耗品 10)。前四类都由当前状态动态生成(有没有空槽、这件满了没),
 * 只有消耗品是固定的几件 —— 它是「所有法术都满了」时的兜底,也是清场救命的手段。
 *
 * ⚠️ 表里的条目**不是全部都会进池**:标了 `metaOnly` 的会被
 *    `FeatureConfig.META_PROGRESSION_ENABLED` 摘掉(当前是「灵石袋」,
 *    理由见该条目的注释)。所以「三件」是设计书的原始配比,不是当前实际张数。
 *
 * 数值写在 effect() 里而不是常量表里:清屏符的伤害必须随等级涨,
 * 否则 30 分钟里它永远只能清掉 T1 杂兵,一张好牌都没有。
 */

export interface ConsumableDef {
  id: string;
  name: string;
  description: string;
  iconColor: number;
  apply: (ctx: UpgradeContext) => void;
  /** 收益完全落在局外成长上 —— 没接通前不进池(见 `FeatureConfig`) */
  metaOnly?: boolean;
}

/**
 * 消耗品的**全量表**(含被上闸的条目)。
 *
 * 与 `CONSUMABLES` 的分工同 `RelicConfig` 里 `RELICS` / `RELIC_IDS` 那一对:
 * 这里是「定义了哪些」,`CONSUMABLES` 是「实际进池哪些」。
 * 只被启动自检用来打印「哪些条目正在被挡着」,玩法侧一律读 `CONSUMABLES`。
 */
export const ALL_CONSUMABLES: ConsumableDef[] = [
  {
    id: 'heal_pill',
    name: '回春丹',
    description: '立刻回复 30% 最大生命',
    iconColor: 0x66ff88,
    apply: (ctx) => {
      const before = ctx.player.health;
      ctx.player.heal(Math.round(ctx.player.maxHealth * 0.3));
      const got = Math.round(ctx.player.health - before);
      if (got > 0) ctx.player.healed(got);
    },
  },
  {
    id: 'clear_tally',
    name: '清屏符',
    description: '对场上所有敌人造成一次伤害',
    iconColor: 0xff8844,
    apply: (ctx) => {
      // 随等级线性涨。清屏符的价值全在「现在是后期」时的一次性清场,
      // 固定数值会让它在 20 级之后变成一张废牌
      ctx.damageAllEnemies(40 + ctx.level * 8);
    },
  },
  {
    id: 'spirit_stone',
    name: '灵石袋',
    description: '获得 50 灵石',
    iconColor: 0xffd070,
    // ⚠️ `metaOnly` —— 它给的是**局外货币**，而局外强化树还没做，
    //    所以这现在是一张**零收益**的牌：三选一里占掉一个位置，换回 50 个
    //    花不出去的数字。而且它看起来最不像废牌 —— 卡面是明晃晃的「获得 50 灵石」，
    //    玩家会以为是自己不会用。
    metaOnly: true,
    apply: (ctx) => ctx.addCoins(50),
  },
];

/**
 * 当前**实际进池**的消耗品。
 *
 * 卡池的兜底补齐(`GameScene.buildInsightCards` 末尾)也读这个数组，所以摘掉
 * 灵石袋之后「法术与遗物全满」时只剩回春丹 / 清屏符两张 —— 极端情况下三选一
 * 的第三张会是前两张里的重复。这是**已知且可接受**的临时代价：
 * 要凑满三张不重复的消耗品，就得临时造一张新消耗品，而那是玩法内容，
 * 不该由「关掉一个无效选项」顺手带出来。局外成长接通后它会自己恢复。
 */
export const CONSUMABLES: ConsumableDef[] = ALL_CONSUMABLES.filter(
  (c) => META_PROGRESSION_ENABLED || !c.metaOnly,
);

/**
 * 悟道卡池的权重表(设计书 3.3)。
 *
 * 抽的是**类别**而不是具体条目:先按权重摇一个还有货的类别,再从那一类里随机取。
 * 类别全空时回落到消耗品 —— 绝不出「空面板」。
 *
 * ⚠️ **「遗物祭炼」拆成两档,不是为了分前后期,是为了分稀释。**
 *
 *   桶内是**均匀抽取**的:装了 6 件可升级遗物时,分给某一件的概率就是 1/6。
 *   而专属遗物祭炼不是普通收益 —— 它是**道法融合的硬门槛**(专属遗物 5 级,
 *   见 EvolutionConfig)。让它和「冷却遗物 +1 级」抢同一个名额,结果是玩家
 *   明明攥着火系钥匙,却整局都抽不到那张卡去把它养到 5 级。
 *
 *   这与本文件顶部的口径是同一条:**先把会被稀释的东西分桶,再谈权重**。
 *   精英宝箱的掉落池早就这么做了(`EliteConfig.KEY_WEIGHT = 3`,专属优先);
 *   悟道池此前漏了这一步 —— 13 的权重再被除以 5~6,单件专属仅约 4%/次升级。
 *
 * 拆开后:专属祭炼每张卡 ≈ 18/117 ≈ 15%/次抽取(第一张卡被「保底未拥有项」
 * 占用,实际是第 2、3 张),单件专属在装 2 件时才被 2 除 —— 比原来高一个量级,
 * 又没高到压住新法术/新遗物(两者合计 55)。
 */
export const CARD_WEIGHTS: Record<
  'newSpell' | 'spellLevel' | 'newRelic' | 'relicLevelKey' | 'relicLevel' | 'consumable',
  number
> = {
  newSpell: 30,
  spellLevel: 22,
  newRelic: 25,
  /** 专属遗物祭炼:融合门槛,单独一档防止被通用遗物稀释 */
  relicLevelKey: 18,
  /** 通用遗物祭炼(冷却/血量/攻速/拾取…) */
  relicLevel: 12,
  consumable: 10,
};

/** 把一个消耗品包成一张悟道卡 */
export function consumableCard(def: ConsumableDef): Upgrade {
  return {
    id: `consumable_${def.id}`,
    type: 'consumable' as UpgradeType,
    name: def.name,
    description: def.description,
    iconColor: def.iconColor,
    apply: def.apply,
  };
}