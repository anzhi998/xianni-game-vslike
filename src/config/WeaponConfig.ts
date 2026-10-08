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
 *
 * 攻击形态见 types/index.ts 的 AttackForm。直射类可被法宝改写弹道
 * (追踪/连锁/散射),非直射形态没有弹道可改,只受数值类修饰影响。
 */

export const WEAPONS: Record<string, WeaponConfig> = {

  // ===== 凝气期(灵动,十五层) =====
  knife: {
    id: 'knife', name: '飞剑', realmId: 'ningqi', texture: 'proj_knife',
    form: 'projectile',
    damage: 10, cooldown: 700, projectileSpeed: 420,
    projectileCount: 1, pierce: 0, area: 1, duration: 800,
    color: 0xdddddd,
  },
  magic: {
    id: 'magic', name: '灵气弹', realmId: 'ningqi', texture: 'proj_magic',
    form: 'projectile',
    damage: 18, cooldown: 1100, projectileSpeed: 360,
    projectileCount: 1, pierce: 1, area: 1, duration: 1200,
    color: 0xaa66ff,
  },
  axe: {
    id: 'axe', name: '回旋斧', realmId: 'ningqi', texture: 'proj_axe',
    form: 'projectile',
    damage: 22, cooldown: 1400, projectileSpeed: 320,
    projectileCount: 1, pierce: 3, area: 1.3, duration: 1800,
    color: 0xff8844,
  },

  // ===== 筑基期 =====
  sword_array: {
    id: 'sword_array', name: '御剑诀', realmId: 'zhuji', texture: 'proj_sword_array',
    form: 'projectile',
    damage: 26, cooldown: 820, projectileSpeed: 480,
    projectileCount: 2, pierce: 1, area: 1, duration: 900,
    color: 0x88ddff,
  },
  frost_needle: {
    id: 'frost_needle', name: '玄冰针', realmId: 'zhuji', texture: 'proj_frost_needle',
    form: 'projectile',
    damage: 34, cooldown: 1000, projectileSpeed: 520,
    projectileCount: 1, pierce: 2, area: 1, duration: 1100,
    color: 0xaaccff,
  },
  fire_wheel: {
    id: 'fire_wheel', name: '火轮', realmId: 'zhuji', texture: 'proj_fire_wheel',
    form: 'orbiter',
    orbitRadius: 70, orbitSpeed: 2.4,
    damage: 46, cooldown: 1350, projectileSpeed: 400,
    projectileCount: 1, pierce: 1, area: 1.4, duration: 1600,
    color: 0xff6633,
  },

  // ===== 结丹期 =====
  golden_light: {
    id: 'golden_light', name: '金光斩', realmId: 'jiedan', texture: 'proj_golden_light',
    form: 'arc',
    arcRadius: 150, arcSpan: Math.PI * 0.7,
    damage: 58, cooldown: 900, projectileSpeed: 560,
    projectileCount: 3, pierce: 1, area: 1, duration: 1000,
    color: 0xffdd44,
  },
  demon_eye: {
    id: 'demon_eye', name: '魔光瞳', realmId: 'jiedan', texture: 'proj_demon_eye',
    form: 'zone',
    zoneRadius: 80, zoneTickMs: 400,
    damage: 72, cooldown: 1500, projectileSpeed: 440,
    projectileCount: 1, pierce: 2, area: 1.2, duration: 1500,
    color: 0xaa44ff,
  },
  earth_pillar: {
    id: 'earth_pillar', name: '厚土印', realmId: 'jiedan', texture: 'proj_earth_pillar',
    form: 'slam',
    slamRadius: 75, slamHeight: 280,
    damage: 96, cooldown: 1900, projectileSpeed: 340,
    projectileCount: 1, pierce: 0, area: 2, duration: 2000,
    color: 0xaa8855,
  },

  // ===== 元婴期 =====
  baby_soul: {
    id: 'baby_soul', name: '元婴吐纳', realmId: 'yuanying', texture: 'proj_baby_soul',
    form: 'orbiter',
    orbitRadius: 85, orbitSpeed: 1.8,
    damage: 88, cooldown: 1050, projectileSpeed: 540,
    projectileCount: 2, pierce: 2, area: 1.1, duration: 1200,
    color: 0xff88dd,
  },
  void_edge: {
    id: 'void_edge', name: '虚空刃', realmId: 'yuanying', texture: 'proj_void_edge',
    form: 'projectile',
    damage: 112, cooldown: 1300, projectileSpeed: 620,
    projectileCount: 1, pierce: 3, area: 1, duration: 1300,
    color: 0x6644ff,
  },

  // ===== 化神期 =====
  sea_of_souls: {
    id: 'sea_of_souls', name: '天地意境', realmId: 'huashen', texture: 'proj_sea_of_souls',
    form: 'zone',
    zoneRadius: 95, zoneTickMs: 380,
    damage: 134, cooldown: 950, projectileSpeed: 580,
    projectileCount: 3, pierce: 2, area: 1.2, duration: 1300,
    color: 0xff5577,
  },
  chaos_bolt: {
    id: 'chaos_bolt', name: '元神击', realmId: 'huashen', texture: 'proj_chaos_bolt',
    form: 'projectile',
    damage: 168, cooldown: 1400, projectileSpeed: 640,
    projectileCount: 1, pierce: 4, area: 1, duration: 1400,
    color: 0x8866ff,
  },

  // ===== 婴变期 =====
  star_slash: {
    id: 'star_slash', name: '意境化芒', realmId: 'yingbian', texture: 'proj_star_slash',
    form: 'arc',
    arcRadius: 170, arcSpan: Math.PI * 0.8,
    damage: 150, cooldown: 1750, projectileSpeed: 460,
    projectileCount: 1, pierce: 2, area: 1.5, duration: 1700,
    color: 0xbb88ff,
  },
  void_swap: {
    id: 'void_swap', name: '仙力催发', realmId: 'yingbian', texture: 'proj_void_swap',
    form: 'projectile',
    damage: 168, cooldown: 900, projectileSpeed: 660,
    projectileCount: 4, pierce: 2, area: 1.1, duration: 1200,
    color: 0xbb88ff,
  },

  // ===== 问鼎期 =====
  heaven_candle: {
    id: 'heaven_candle', name: '天烛灭世', realmId: 'wending', texture: 'proj_heaven_candle',
    form: 'slam',
    slamRadius: 110, slamHeight: 340,
    damage: 230, cooldown: 2100, projectileSpeed: 380,
    projectileCount: 1, pierce: 1, area: 1.8, duration: 2100,
    color: 0xffcc55,
  },
  dao_seal: {
    id: 'dao_seal', name: '问鼎之印', realmId: 'wending', texture: 'proj_dao_seal',
    form: 'slam',
    slamRadius: 95, slamHeight: 300,
    damage: 240, cooldown: 1250, projectileSpeed: 700,
    projectileCount: 2, pierce: 4, area: 1.2, duration: 1500,
    color: 0xffdd88,
  },
  grand_collapse: {
    id: 'grand_collapse', name: '大寂灭', realmId: 'wending', texture: 'proj_grand_collapse',
    form: 'zone',
    zoneRadius: 120, zoneTickMs: 500,
    damage: 320, cooldown: 1800, projectileSpeed: 480,
    projectileCount: 1, pierce: 3, area: 1.6, duration: 2000,
    color: 0xff3344,
  },
}

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