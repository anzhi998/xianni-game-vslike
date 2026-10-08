import type { Upgrade, UpgradeContext } from '../types';

/**
 * 修仙版强化卡池
 *
 * 分两类:
 *   - 静态卡:下面 STAT_UPGRADES,与法术/境界无关,任何时候都可出现
 *   - 动态卡:由 GameScene 生成 —— 「法术精进 / 参悟新术 / 开辟法位」
 *     这三种必须知道玩家当前持有哪些法术、槽位是否已满,所以没法在这里静态声明。
 *
 * 旧的 UpgradeConfig.ts 里的 (player) => void 签名无法表达「某门法术+1级」,
 * 故改为 (ctx) => void。
 */

export const STAT_UPGRADES: Upgrade[] = [
  {
    id: 'damage', type: 'damage',
    name: '神识精进 伤害 +20%',
    description: '提升所有法术 20% 威力',
    iconColor: 0xff5555,
    apply: (c: UpgradeContext) => { c.player.damageMul *= 1.2; },
  },
  {
    id: 'cooldown', type: 'cooldown',
    name: '凝气迅捷 冷却 -15%',
    description: '法力流转更快,施法间隔缩短 15%',
    iconColor: 0xffaa33,
    apply: (c: UpgradeContext) => { c.player.cooldownMul *= 0.85; },
  },
  {
    id: 'projectile', type: 'projectileCount',
    name: '万法诀 每次 +1 道',
    description: '每次施法额外催动一道法术',
    iconColor: 0x55ff55,
    apply: (c: UpgradeContext) => { c.player.projectileAdd += 1; },
  },
  {
    id: 'speed', type: 'projectileSpeed',
    name: '御风诀 弹速 +25%',
    description: '提升法术飞行速度 25%',
    iconColor: 0x55ddff,
    apply: (c: UpgradeContext) => { c.player.projectileSpeedMul *= 1.25; },
  },
  {
    id: 'area', type: 'area',
    name: '广域术 范围 +20%',
    description: '增大法术覆盖范围 20%',
    iconColor: 0xaa55ff,
    apply: (c: UpgradeContext) => { c.player.areaMul *= 1.2; },
  },
  {
    id: 'pierce', type: 'pierce',
    name: '锐金芒 穿透 +1',
    description: '法术可多穿透 1 名敌人',
    iconColor: 0xffff55,
    apply: (c: UpgradeContext) => { c.player.pierceAdd += 1; },
  },
  {
    id: 'move', type: 'moveSpeed',
    name: '身法 速度 +10%',
    description: '提升移动速度 10%',
    iconColor: 0x55ffff,
    apply: (c: UpgradeContext) => { c.player.moveSpeedMul *= 1.1; },
  },
  {
    id: 'pickup', type: 'pickupRange',
    name: '灵觉 拾取 +30%',
    description: '增大灵液自动吸附范围 30%',
    iconColor: 0xaaff55,
    apply: (c: UpgradeContext) => { c.player.pickupMul *= 1.3; },
  },
  {
    id: 'hp', type: 'maxHealth',
    name: '炼体 气血上限 +25',
    description: '气血上限 +25 并立刻回满',
    iconColor: 0xff8888,
    apply: (c: UpgradeContext) => {
      c.player.maxHealth += 25;
      c.player.health = c.player.maxHealth;
    },
  },
  {
    id: 'regen', type: 'healthRegen',
    name: '生机 +1/秒',
    description: '每秒自动恢复 1 点气血',
    iconColor: 0xffaaaa,
    apply: (c: UpgradeContext) => { c.player.healthRegen += 1; },
  },
];

/** 「开辟法位」卡的额外槽位硬上限 = 境界基础值 + 2 */
export const MAX_BONUS_SPELL_SLOTS = 2;