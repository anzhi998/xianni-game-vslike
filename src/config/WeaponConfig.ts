import type { WeaponConfig } from '../types';
import { SPELL_SLOTS, SPELL_SLOT_LAST } from './SpellSlotConfig';
import { EVOLUTIONS } from './EvolutionConfig';

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

  // ===== 设计书 v2.7 的神通(阶段 1 第一刀:火球术链路)=====

  /**
   * 火球术 —— 格 1 的默认装备位,开局自动装上,不进卡池。
   *
   * 普通弹道(直线飞行),不是抛物线。所以形态走 projectile 而非 slam,
   * 也不设 geometry —— 它不占设计书 14 类几何里的任何一格,
   * 定位是「什么都不决定的入门件」。
   */
  fireball: {
    id: 'fireball', name: '火球术', realmId: 'ningqi', texture: 'proj_fireball',
    form: 'projectile',
    damage: 18, cooldown: 1100, projectileSpeed: 380,
    projectileCount: 1, pierce: 0, area: 1, duration: 1000,
    color: 0xff4422,
    usesRituals: true,
  },

  /**
   * 引力术 —— 格 2 候选(LV5),向心聚拢几何。
   *
   * 零伤害。它的全部价值是把敌人拖到一点,好让火球术这类弹道覆盖。
   * 设计书对它的判词是「它本身几乎不造成伤害——先聚拢,再让别的神通打」。
   *
   * ⚠️ 半径刻意压在 150:初版给了 240,在 1280×720 的视口里那几乎是半个屏幕,
   * 加上 3.6 秒冷却 / 2.2 秒持续,实际效果是「开局全程挂着一个全屏紫圈」——
   * 既看不见形状也剥夺了走位。收窄之后它才真正是一块「往这边打」的区域。
   */
  gravity: {
    id: 'gravity', name: '引力术', realmId: 'ningqi', texture: 'proj_magic',
    form: 'attractor', geometry: 'gravity',
    damage: 0, cooldown: 4200, projectileSpeed: 0,
    projectileCount: 1, pierce: 0, area: 1, duration: 1800,
    color: 0x8866ff,
    usesRituals: true,
    // attractorPull 是拉力速度(px/s),不是加速度 —— 详情见 Attractor.pull 的注释
    zoneRadius: 150, attractorPull: 320, fieldLifeMs: 1800,
  },

  /**
   * 万剑禁幡 —— 格 2 候选(LV5),抽中权重最低。
   * 环绕自身几何,是全局唯一的纯自保件(对应原版的「大蒜」)。
   */
  wanjian_banner: {
    id: 'wanjian_banner', name: '万剑禁幡', realmId: 'ningqi', texture: 'proj_sword_array',
    form: 'orbiter', geometry: 'orbit',
    damage: 16, cooldown: 2600, projectileSpeed: 0,
    projectileCount: 3, pierce: 0, area: 1, duration: 3000,
    color: 0x88ddff,
    usesRituals: true,
    orbitRadius: 110, orbitSpeed: 2.4,
  },

  /**
   * 十方引力 —— 引力术的进化形态(钥匙:神识罗盘)。
   * 「吸得住、留不住」→ 笼罩更远、拖得更狠、留得更久。
   * ⚠️ 半径 200 是刻意压着的:见引力术那条注释,初版 240 在 1280×720 里
   * 几乎是半个屏幕。进化给的是「更远」,不是「全屏」。
   */
  shifang_yinli: {
    id: 'shifang_yinli', name: '十方引力', realmId: 'ningqi', texture: 'proj_magic',
    form: 'attractor', geometry: 'gravity',
    damage: 0, cooldown: 4000, projectileSpeed: 0,
    projectileCount: 1, pierce: 0, area: 1, duration: 2400,
    color: 0x9a77ff,
    usesRituals: true,
    zoneRadius: 200, attractorPull: 380, fieldLifeMs: 2400,
  },

  /**
   * 禁天幡 —— 万剑禁幡的进化形态(钥匙:凝神香)。
   * 「剑气散得太快」→ 剑气因神凝而久驻不散:更多、更久、更密。
   */
  jintian_fan: {
    id: 'jintian_fan', name: '禁天幡', realmId: 'ningqi', texture: 'proj_sword_array',
    form: 'orbiter', geometry: 'orbit',
    damage: 20, cooldown: 2400, projectileSpeed: 0,
    projectileCount: 5, pierce: 0, area: 1.1, duration: 4200,
    color: 0xaaeaff,
    usesRituals: true,
    orbitRadius: 120, orbitSpeed: 2.8,
  },

  /**
   * 黄泉寂灭指 —— 黄泉指的进化形态(钥匙:御剑符)。
   * 「单发、慢」→ 一道指芒化成连绵不断的剑芒:三发齐出、贯穿更深。
   * 单发伤害比黄泉指低,但乘上进化倍率与三发齐射,总量是另一个量级 ——
   * 进化该改的是「形状」,不只是数字
   */
  huangquan_jiemie: {
    id: 'huangquan_jiemie', name: '黄泉寂灭指', realmId: 'zhuji', texture: 'proj_huangquan',
    form: 'projectile', geometry: 'line',
    damage: 26, cooldown: 900, projectileSpeed: 660,
    projectileCount: 3, pierce: 5, area: 1.05, duration: 900,
    color: 0xdd88ff,
    usesRituals: true,
  },

  /**
   * 第三目 · 时光红芒 —— 第三目的进化形态(钥匙:神识罗盘,与引力术共用)。
   * 「红芒只照一条线」→ 覆盖面成倍扩张:更宽、更久,依旧贯穿一切。
   */
  third_eye_time: {
    id: 'third_eye_time', name: '第三目·时光红芒', realmId: 'zhuji', texture: 'proj_third_eye',
    form: 'projectile', geometry: 'beam',
    damage: 16, cooldown: 1400, projectileSpeed: 700,
    projectileCount: 1, pierce: 99, area: 1.4, duration: 2600,
    color: 0xff6688,
    usesRituals: true,
  },

  /**
   * 九幽火海 —— 火球术的进化形态,不可直接获取,只能由宝匣结算得到。
   *
   * 仍是直线弹道,但命中后炸开一片持续灼烧的火海(zone)。
   * 这样「进化」在画面上是看得见的,而不只是一个数字变大。
   */
  nine_nether_fire: {
    id: 'nine_nether_fire', name: '九幽火海', realmId: 'ningqi', texture: 'proj_nine_nether_fire',
    form: 'projectile',
    damage: 24, cooldown: 1000, projectileSpeed: 360,
    projectileCount: 1, pierce: 2, area: 1.4, duration: 1000,
    color: 0xff5522,
    usesRituals: true,
    // 命中处炸开的灼烧区 —— zoneRadius 是「会炸开火海」的开关本身
    zoneRadius: 150, zoneTickMs: 500,
  },

  /**
   * 黄泉指 —— 格 3 候选(LV16 筑基),朝向直线几何。
   * 一条贯穿的指芒,决定玩家必须始终面对威胁最大的方向。
   *
   * ⚠️ 弹体贴图与 color 必须同源:它曾经用 proj_knife(一把带剑柄的白色飞剑),
   * 一门指法长得像另一门法术,玩家没法从弹体判断自己面对的是什么。
   */
  huangquan_zhi: {
    id: 'huangquan_zhi', name: '黄泉指', realmId: 'zhuji', texture: 'proj_huangquan',
    form: 'projectile', geometry: 'line',
    damage: 34, cooldown: 900, projectileSpeed: 620,
    projectileCount: 1, pierce: 3, area: 1, duration: 900,
    color: 0xcc44ff,
    usesRituals: true,
  },

  /**
   * 第三目 · 神目 —— 格 3 候选(LV16 筑基),朝向光柱几何。
   * 一道持续压在精英身上的红色光柱,持续时间远长于其他神通。
   * 弹体是「柱」不是「刃」——它穿透一切且存续 2.2 秒,视觉上必须读得出持续性。
   */
  third_eye: {
    id: 'third_eye', name: '第三目·神目', realmId: 'zhuji', texture: 'proj_third_eye',
    form: 'projectile', geometry: 'beam',
    damage: 12, cooldown: 1500, projectileSpeed: 700,
    projectileCount: 1, pierce: 99, area: 1.1, duration: 2200,
    color: 0xff4466,
    usesRituals: true,
  },
};

/**
 * 开局武器的兜底 id。
 *
 * 正常路径不走这里 —— 开局装备由 SpellSlotConfig 声明的「默认装备位」
 * (格 1 = 火球术)决定,见 defaultSpell()。这里只防「解锁表被改坏、
 * 一个默认位都没有」这种情况,所以指向同一位格 1 神通而非另一个法术:
 * 兜底路径不该改变玩家的开局体验。
 */
export const STARTING_WEAPON = 'fireball';

/**
 * 可达性自检:法术表里的每一门都必须有**一条获取路径**。
 *
 * 与敌人侧 validateEnemyReachability 同一条规矩(见 CLAUDE.md 的调试面板约定):
 * 写进表里却没有任何卡池能给出它,这门法术就只是死数据。
 * 三条获取路径,任意一条命中即可:
 *   神通栏解锁表 · 问鼎段争空位的那两张 · 进化的产物(EVOLUTIONS.evolved)
 */
export function validateSpellReachability(): string[] {
  const reachable = new Set<string>();
  for (const slot of SPELL_SLOTS) for (const id of slot.candidates) reachable.add(id);
  for (const id of SPELL_SLOT_LAST.candidates) reachable.add(id);
  for (const evo of EVOLUTIONS) {
    reachable.add(evo.base);
    reachable.add(evo.evolved);
  }
  return Object.keys(WEAPONS).filter((id) => !reachable.has(id));
}

/**
 * 反方向的自检:卡池里引用的、但本表里还不存在的 id。
 *
 * 两个方向都要查,因为它们的失败方式不同却同样安静:
 *   - 表里有、卡池没有 → 这门法术永远拿不到(上面那个函数)
 *   - 卡池有、表里没有 → 那张卡点下去什么都不发生(buildDynamicCards 会 `if (cfg)` 悄悄跳过)
 *
 * ⚠️ 这个函数现在**预期**会返回一批 id —— 阶段 2 的神通(尸魅/蚊兽/定身术/
 * 焚界古伞/流月/雷法/呼风唤雨)还没写,而解锁表已经按设计书定稿了。
 * 所以它是一条待办清单,不是错误。黄泉指曾经就是在这里被查出来的:
 * 解锁表写的是 huangquan_finger,法术表里却叫 huangquan_zhi。
 */
export function validateSlotCandidates(): string[] {
  const known = new Set(Object.keys(WEAPONS));
  const refs = new Set<string>();
  for (const slot of SPELL_SLOTS) for (const id of slot.candidates) refs.add(id);
  for (const id of SPELL_SLOT_LAST.candidates) refs.add(id);
  return [...refs].filter((id) => !known.has(id));
}

/**
 * 进化形态不得出现在解锁表里。
 *
 * 进化形态只能由「满 8 重 + 钥匙 + 宝匣」结算得到。一旦它被写进某个卡的候选,
 * 玩家就能跳过全部三个条件直接拿到 —— 整个进化系统当场作废,
 * 而且这种错误在试玩里看起来完全正常(你确实拿到了一门更强的法术)。
 */
export function validateEvolvedNotOffered(): string[] {
  const evolved = new Set(EVOLUTIONS.map((e) => e.evolved));
  const offered = new Set<string>();
  for (const slot of SPELL_SLOTS) for (const id of slot.candidates) offered.add(id);
  for (const id of SPELL_SLOT_LAST.candidates) offered.add(id);
  return [...offered].filter((id) => evolved.has(id));
}
