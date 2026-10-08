import type { WeaponConfig } from '../types';
import { REALMS } from './RealmConfig';

/**
 * 法术表 —— 每个大境界有独立的法术池
 *
 * 规则(详见 docs/法术与法宝.md):
 *   - 突破到某境界后,「参悟新术」卡优先从该境界的池子里抽
 *   - 该池子学完(或不剩未掌握的)时,才回退到更早境界尚未掌握的法术
 *   - 已学会的法术永久保留,不因境界提升而自动变强
 *     (法宝才是跨境界通用的成长线,避免稀释法宝的价值)
 *   - 没有丢弃法术的界面 —— 槽位增长次数恰好等于突破次数,
 *     所以每次突破补一门新法术就不会卡死
 *
 * ⚠️ id 与显示名已脱钩:knife/magic 是历史标识符(含纹理键),显示名是飞剑/灵气弹。
 *    改显示名时不要动 id。
 */
export const WEAPONS: Record<string, WeaponConfig> = {
  // ===== 炼气期 =====
  knife: {
    id: 'knife', name: '飞剑', realmId: 'qi', texture: 'proj_knife',
    damage: 10, cooldown: 700, projectileSpeed: 420,
    projectileCount: 1, pierce: 0, area: 1, duration: 800,
    color: 0xdddddd,
  },
  magic: {
    id: 'magic', name: '灵气弹', realmId: 'qi', texture: 'proj_magic',
    damage: 18, cooldown: 1100, projectileSpeed: 360,
    projectileCount: 1, pierce: 1, area: 1, duration: 1200,
    color: 0xaa66ff,
  },
  axe: {
    id: 'axe', name: '回旋斧', realmId: 'qi', texture: 'proj_axe',
    damage: 22, cooldown: 1400, projectileSpeed: 320,
    projectileCount: 1, pierce: 3, area: 1.3, duration: 1800,
    color: 0xff8844,
  },

  // ===== 筑基期 =====
  sword_array: {
    id: 'sword_array', name: '御剑诀', realmId: 'zhuji', texture: 'proj_sword_array',
    damage: 26, cooldown: 820, projectileSpeed: 480,
    projectileCount: 2, pierce: 1, area: 1, duration: 900,
    color: 0x88ddff,
  },
  frost_needle: {
    id: 'frost_needle', name: '玄冰针', realmId: 'zhuji', texture: 'proj_frost_needle',
    damage: 34, cooldown: 1000, projectileSpeed: 520,
    projectileCount: 1, pierce: 2, area: 1, duration: 1100,
    color: 0xaaccff,
  },
  fire_wheel: {
    id: 'fire_wheel', name: '火轮', realmId: 'zhuji', texture: 'proj_fire_wheel',
    damage: 46, cooldown: 1350, projectileSpeed: 400,
    projectileCount: 1, pierce: 1, area: 1.4, duration: 1600,
    color: 0xff6633,
  },

  // ===== 结丹期 =====
  golden_light: {
    id: 'golden_light', name: '金光斩', realmId: 'jiedan', texture: 'proj_golden_light',
    damage: 58, cooldown: 900, projectileSpeed: 560,
    projectileCount: 3, pierce: 1, area: 1, duration: 1000,
    color: 0xffdd44,
  },
  demon_eye: {
    id: 'demon_eye', name: '魔光瞳', realmId: 'jiedan', texture: 'proj_demon_eye',
    damage: 72, cooldown: 1500, projectileSpeed: 440,
    projectileCount: 1, pierce: 2, area: 1.2, duration: 1500,
    color: 0xaa44ff,
  },
  earth_pillar: {
    id: 'earth_pillar', name: '厚土印', realmId: 'jiedan', texture: 'proj_earth_pillar',
    damage: 96, cooldown: 1900, projectileSpeed: 340,
    projectileCount: 1, pierce: 0, area: 2, duration: 2000,
    color: 0xaa8855,
  },

  // ===== 元婴期 =====
  baby_soul: {
    id: 'baby_soul', name: '元婴吐纳', realmId: 'yuanying', texture: 'proj_baby_soul',
    damage: 88, cooldown: 1050, projectileSpeed: 540,
    projectileCount: 2, pierce: 2, area: 1.1, duration: 1200,
    color: 0xff88dd,
  },
  void_edge: {
    id: 'void_edge', name: '虚空刃', realmId: 'yuanying', texture: 'proj_void_edge',
    damage: 112, cooldown: 1300, projectileSpeed: 620,
    projectileCount: 1, pierce: 3, area: 1, duration: 1300,
    color: 0x6644ff,
  },
  star_slash: {
    id: 'star_slash', name: '星陨斩', realmId: 'yuanying', texture: 'proj_star_slash',
    damage: 150, cooldown: 1750, projectileSpeed: 460,
    projectileCount: 1, pierce: 2, area: 1.5, duration: 1700,
    color: 0xbb88ff,
  },

  // ===== 化神期 =====
  sea_of_souls: {
    id: 'sea_of_souls', name: '神识海', realmId: 'huashen', texture: 'proj_sea_of_souls',
    damage: 134, cooldown: 950, projectileSpeed: 580,
    projectileCount: 3, pierce: 2, area: 1.2, duration: 1300,
    color: 0xff5577,
  },
  chaos_bolt: {
    id: 'chaos_bolt', name: '混沌击', realmId: 'huashen', texture: 'proj_chaos_bolt',
    damage: 168, cooldown: 1400, projectileSpeed: 640,
    projectileCount: 1, pierce: 4, area: 1, duration: 1400,
    color: 0x8866ff,
  },
  heaven_candle: {
    id: 'heaven_candle', name: '天烛灭世', realmId: 'huashen', texture: 'proj_heaven_candle',
    damage: 230, cooldown: 2100, projectileSpeed: 380,
    projectileCount: 1, pierce: 1, area: 1.8, duration: 2100,
    color: 0xffcc55,
  },

  // ===== 炼虚期 =====
  void_swap: {
    id: 'void_swap', name: '虚空挪移', realmId: 'lianxu', texture: 'proj_void_swap',
    damage: 168, cooldown: 900, projectileSpeed: 660,
    projectileCount: 4, pierce: 2, area: 1.1, duration: 1200,
    color: 0xbb88ff,
  },
  dao_seal: {
    id: 'dao_seal', name: '道印', realmId: 'lianxu', texture: 'proj_dao_seal',
    damage: 240, cooldown: 1250, projectileSpeed: 700,
    projectileCount: 2, pierce: 4, area: 1.2, duration: 1500,
    color: 0xffdd88,
  },
  grand_collapse: {
    id: 'grand_collapse', name: '大寂灭', realmId: 'lianxu', texture: 'proj_grand_collapse',
    damage: 320, cooldown: 1800, projectileSpeed: 480,
    projectileCount: 1, pierce: 3, area: 1.6, duration: 2000,
    color: 0xff3344,
  },
};

export const STARTING_WEAPON = 'knife';

/** 取某个大境界的法术池 */
export function getSpellsForRealm(realmId: string): WeaponConfig[] {
  return Object.values(WEAPONS).filter((w) => w.realmId === realmId);
}

/**
 * 「参悟新术」的候选池 —— 新池优先,旧池降级
 *
 * 1. 先取当前大境界尚未掌握的法术
 * 2. 若该池已学完,回退到更早境界尚未掌握的法术(新池优先,旧法术降级)
 *
 * @param realmId 当前大境界 id
 * @param has     判断某门法术是否已掌握
 */
export function getAttainableSpells(
  realmId: string,
  has: (id: string) => boolean,
): WeaponConfig[] {
  const realms = REALMS;
  const idx = realms.findIndex((r) => r.id === realmId);
  if (idx < 0) return [];

  const current = getSpellsForRealm(realmId).filter((w) => !has(w.id));
  if (current.length > 0) return current;

  // 当前池学完 —— 降级回更早境界
  const older: WeaponConfig[] = [];
  for (let i = idx - 1; i >= 0; i--) {
    older.push(...getSpellsForRealm(realms[i].id).filter((w) => !has(w.id)));
  }
  return older;
}