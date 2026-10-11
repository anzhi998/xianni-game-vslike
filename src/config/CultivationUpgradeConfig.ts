import type { Upgrade, UpgradeContext, UpgradeType } from '../types';

/**
 * 悟道卡池里的「消耗品」
 *
 * 《build设计》3.3 给了卡池五类的权重(新法术 30 / 法术升级 22 / 新遗物 25 /
 * 遗物叠层 13 / 消耗品 10)。前四类都由当前状态动态生成(有没有空槽、这件满了没),
 * 只有消耗品是固定的三件 —— 它是「所有法术都满了」时的兜底,也是清场救命的手段。
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
}

export const CONSUMABLES: ConsumableDef[] = [
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
    apply: (ctx) => ctx.addCoins(50),
  },
];

/**
 * 悟道卡池的权重表(设计书 3.3)。
 *
 * 抽的是**类别**而不是具体条目:先按权重摇一个还有货的类别,再从那一类里随机取。
 * 类别全空时回落到消耗品 —— 绝不出「空面板」。
 */
export const CARD_WEIGHTS: Record<'newSpell' | 'spellLevel' | 'newRelic' | 'relicLevel' | 'consumable', number> = {
  newSpell: 30,
  spellLevel: 22,
  newRelic: 25,
  relicLevel: 13,
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