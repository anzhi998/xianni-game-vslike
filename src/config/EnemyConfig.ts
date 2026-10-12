import type { EnemyConfig } from '../types';

/**
 * 敌人数据表 ——《怪物设计.md》的图鉴在这里落成数据
 *
 * 表的分组就是刷怪表的分组(见 WaveConfig):每突破一个大境界,
 * 新的一段就推出一种**此前没见过的逼近方式**,而不是「同一只怪血更厚」。
 * 一只怪的 `approach` 比它的数值重要 —— 数值只决定它多久死,
 * 逼近几何决定玩家必须换成哪种覆盖形状去应对。
 *
 * 数值口径:
 *   - 表里的 maxHealth 是**基础值**,实际血量 = 基础 × 时间难度 × 精英倍率 × 境界倍率
 *   - 精英不再是另一种怪,而是同段任意一只怪的变异(见 EliteConfig)
 */

/**
 * 「血量 × 玩家境界」的系数(文档第七节)
 *
 * 实际倍率 = 1 + 0.5 × 大境界下标:凝气 ×1 → 筑基 ×1.5 → … → 问鼎 ×4。
 *
 * ⚠️ 这是压级流的对齐旋钮。文档里这条机制只有和极境(阶段 3:冻结境界、
 * 伤害 ×2)合起来才成立 —— 你停级,敌人也停档,成长不再被抵消。
 * 极境落地前,它单纯是「越强怪越硬」,所以刻意取 0.5 而不是 1.0。
 */
export const REALM_HP_SCALE = 0.5;

export const ENEMIES: Record<string, EnemyConfig> = {

  // ===== 凝气期 0–2 分:教学段,只有一种逼近方式(直线冲脸)=====

  /**
   * 山野妖兽 —— 群怪。多、快、单只极弱,逼「覆盖」成为硬需求。
   */
  beast: {
    id: 'beast', name: '山野妖兽',
    approach: 'chase', archetype: 'horde',
    maxHealth: 8, speed: 70, contactDamage: 4, xpValue: 1, size: 13,
    color: 0x9a7a4a, bodyColor: 0x5a4222,
  },

  /**
   * 腐尸 —— 群怪。比妖兽慢但更耐打,是引力术聚拢后一次贯穿的靶子。
   */
  /**
   * 铁甲蚁 —— T1 的第二只,与山野妖兽构成开局的第一次对比。
   *
   * 山野妖兽慢而稍厚 / 铁甲蚁极快而极脆 —— 玩家在 30 秒时就拿到
   * 「跑不过的东西未必肉」这条经验,而不是等到十分钟后才被迫学会。
   * 血量 6 是被开局一击线钉住的(见 WaveConfig.validateOpeningDifficulty)。
   */
  iron_ant: {
    id: 'iron_ant', name: '铁甲蚁',
    approach: 'chase', archetype: 'horde',
    maxHealth: 6, speed: 138, contactDamage: 3, xpValue: 1, size: 10,
    color: 0x4a4a5a, bodyColor: 0x1a1a2a,
  },

  corpse: {
    id: 'corpse', name: '腐尸',
    approach: 'chase', archetype: 'horde',
    maxHealth: 16, speed: 45, contactDamage: 7, xpValue: 2, size: 15,
    color: 0x7a9a5a, bodyColor: 0x3a5a2a,
  },

  // ===== 筑基期 2–3 分:第一次不能站着打 =====

  /**
   * 散修 —— 术修。驻停、远程、脆。
   * 它的价值是制造方向:你必须朝它前进,不能原地磨。
   */
  rogue_cultivator: {
    id: 'rogue_cultivator', name: '散修',
    approach: 'ranged', archetype: 'caster',
    maxHealth: 14, speed: 58, contactDamage: 5, xpValue: 3, size: 15,
    color: 0x8a9ac0, bodyColor: 0x4a5a80,
    attackRange: 280, fireIntervalMs: 2200, shotSpeed: 230, shotDamage: 8,
  },

  // ===== 结丹期 3–6 分:第一次「没有后方」 =====

  /**
   * 阴魂 —— 潜行。在屏内任意角度现身(见 SpawnSystem 的 stealth 生成规则),
   * 「往空地跑」第一次不管用。半透明,提醒玩家它不受地形约束。
   */
  yin_hun: {
    id: 'yin_hun', name: '阴魂',
    approach: 'stealth', archetype: 'stalker',
    maxHealth: 12, speed: 95, contactDamage: 8, xpValue: 3, size: 15,
    color: 0x9ab8d8, bodyColor: 0x5a7898,
  },

  /** 尸修 —— 潜行 · 近身。同样穿墙,但血更厚、会主动贴进内圈 */
  shi_xiu: {
    id: 'shi_xiu', name: '尸修',
    approach: 'stealth', archetype: 'stalker',
    maxHealth: 30, speed: 66, contactDamage: 12, xpValue: 4, size: 17,
    color: 0x8a9a7a, bodyColor: 0x4a5a3a,
  },

  // ===== 元婴期 6–12 分:第一次需要用 DPS 硬顶 =====

  /**
   * 石傀 —— 坦克。慢、厚、接触即重伤,天生带牵引抗性。
   * 无论多偏爱 AOE,单点输出都不能全砍,否则它会一路推到你脸上。
   */
  stone_puppet: {
    id: 'stone_puppet', name: '石傀',
    approach: 'advance', archetype: 'tank',
    maxHealth: 70, speed: 32, contactDamage: 18, xpValue: 6, size: 20,
    color: 0x9a9a8a, bodyColor: 0x5a5a4a,
    armor: 0.35,
    resist: { pull: true },
  },

  /** 铁甲兽 —— 坦克。同上,牵引抗性写在数据里而不是 AI 里 */
  iron_beast: {
    id: 'iron_beast', name: '铁甲兽',
    approach: 'advance', archetype: 'tank',
    maxHealth: 90, speed: 38, contactDamage: 16, xpValue: 6, size: 20,
    color: 0x8a8a98, bodyColor: 0x4a4a58,
    armor: 0.30,
    resist: { pull: true },
  },

  // ===== 化神期 12–16 分:第一次被合围 =====

  /**
   * 魔道修士 —— 术修 · 集群,环绕包抄。
   * 它绕开正面、从侧后驻停放法 —— 单方向输出不够用了。
   */
  demonic_cultivator: {
    id: 'demonic_cultivator', name: '魔道修士',
    approach: 'flank', archetype: 'caster',
    maxHealth: 40, speed: 72, contactDamage: 10, xpValue: 5, size: 16,
    color: 0x9a5aaa, bodyColor: 0x5a2a6a,
    flankRadius: 250, fireIntervalMs: 2600, shotSpeed: 250, shotDamage: 10,
  },

  // ===== 婴变期 16–19 分:第一次「杀错了更糟」 =====

  /**
   * 火灵 —— 自爆。贴到玩家身上就炸,不需要出手。
   * 把「不让它靠近」变成一种输出需求。
   */
  fire_spirit: {
    id: 'fire_spirit', name: '火灵',
    approach: 'bomber', archetype: 'bomber',
    maxHealth: 20, speed: 105, contactDamage: 0, xpValue: 3, size: 14,
    color: 0xff7733, bodyColor: 0xcc3311,
    explodeRadius: 44, explodeDamage: 22,
  },

  /**
   * 蛊虫 —— 衍体。被击杀后裂成两只幼虫 —— 清屏不等于清干净。
   */
  gu_worm: {
    id: 'gu_worm', name: '蛊虫',
    approach: 'splitter', archetype: 'spawnling',
    maxHealth: 26, speed: 80, contactDamage: 9, xpValue: 4, size: 15,
    color: 0xb0cc55, bodyColor: 0x6a8a2a,
    splitInto: { type: 'gu_wormling', count: 2 },
  },

  /** 蛊虫 · 幼虫 —— 分裂产物。不再分裂,否则会指数爆炸 */
  gu_wormling: {
    id: 'gu_wormling', name: '蛊虫·幼虫',
    approach: 'chase', archetype: 'spawnling',
    maxHealth: 8, speed: 112, contactDamage: 5, xpValue: 1, size: 10,
    color: 0xccee77, bodyColor: 0x88aa33,
  },

  // ===== 问鼎期 19–22 分:第一次被单只怪追着跑 =====

  /**
   * 上古凶兽 —— 高危单体,冲锋突刺。
   * 蓄力前摇是玩家唯一的反应窗口 —— 靠强度压制,是极境的主场。
   */
  ancient_beast: {
    id: 'ancient_beast', name: '上古凶兽',
    approach: 'charger', archetype: 'beast',
    maxHealth: 160, speed: 55, contactDamage: 26, xpValue: 12, size: 24,
    color: 0xbb6644, bodyColor: 0x6a2a11,
    charge: { windupMs: 620, dashMs: 380, dashSpeedMul: 3.4, cooldownMs: 3200 },
  },

  // ===== 阴虚以上 22–25 分(本作终点):拉拽 + 领域 =====

  /**
   * 界外之魂 —— 终局混合。把玩家往外拖,夺走站位的主动权。
   * 其余逼近方式(血海上涌等)是机制怪,留在后续批次。
   */
  outer_soul: {
    id: 'outer_soul', name: '界外之魂',
    approach: 'puller', archetype: 'soul',
    maxHealth: 110, speed: 60, contactDamage: 20, xpValue: 10, size: 22,
    color: 0x8a7acc, bodyColor: 0x4a3a7a,
    pullRadius: 260, pullSpeed: 280,
  },

  // ===== 机制怪 ======
  //
  // 它们**不进刷怪表**,由 MechanismSystem 按时间间隔单只投放(事件的定位)。
  // 每一只都对应一条「此前一直有效的经验,这次不管用」——
  // 所以它们的威胁都不在数值上,在那条经验的失效里。

  /**
   * 追命者 —— 反直觉:初速极慢,每受一次伤害永久加速一档。
   * 它惩罚「无脑铺伤害」:你越想边跑边刮死它,它越快贴到你脸上。
   * 正确处理是先用引力术拖住、等它滑进光柱后一口气打死。
   */
  chaser: {
    id: 'chaser', name: '追命者',
    approach: 'chase', archetype: 'beast',
    maxHealth: 90, speed: 26, contactDamage: 22, xpValue: 8, size: 18,
    color: 0xd8d8c8, bodyColor: 0x7a7a68,
    mechanism: { speedPerHit: 14, speedCap: 150 },
  },

  /**
   * 伪仙 —— 识别:以普通怪的外形混在怪群里,被击杀的瞬间才现形,并爆发反噬。
   * 配色刻意抄山野妖兽 —— 它逼你在清屏时保留一点观察,纯 AOE 无脑清场会被反复咬到。
   */
  false_immortal: {
    id: 'false_immortal', name: '伪仙',
    approach: 'chase', archetype: 'horde',
    maxHealth: 40, speed: 72, contactDamage: 12, xpValue: 6, size: 14,
    color: 0x9a7a4a, bodyColor: 0x5a4222,
    mechanism: { deathBlast: { radius: 110, damage: 26 } },
  },

  /**
   * 遮天 —— 视野:出现时压暗屏幕边缘,只留中心可见。
   * 它不造成任何伤害(contactDamage: 0),却直接吃掉你的信息 ——
   * 对一个靠「看盲区」运转的几何体系来说,这是最狠的一种削弱。
   */
  sky_veil: {
    id: 'sky_veil', name: '遮天',
    approach: 'chase', archetype: 'soul',
    maxHealth: 70, speed: 46, contactDamage: 0, xpValue: 8, size: 20,
    color: 0x3a3a5a, bodyColor: 0x14141f,
    mechanism: { vignette: true },
  },

  /**
   * 噬灵虫 —— 资源:爬向地上的灵石并吃掉,每吃一份永久强化自身。
   * 它给「攒着不捡、等磁铁成型再扫图」这条技巧加上了对价:
   * 你攒着不捡,就有东西替你捡。
   */
  spirit_gnawer: {
    id: 'spirit_gnawer', name: '噬灵虫',
    approach: 'gemEater', archetype: 'spawnling',
    maxHealth: 45, speed: 86, contactDamage: 10, xpValue: 5, size: 15,
    color: 0x9ad86a, bodyColor: 0x4a7a2a,
    mechanism: { eatRadius: 420, eatHpGain: 0.25, eatSpeedGain: 6 },
  },

  /**
   * 寄魂 —— 优先级:定期附身附近一只普通怪,使其等级与体型同时翻倍,
   * 被附身者脱离怪群直冲向你。它在密集怪堆里制造「必须先点掉的那一只」。
   */
  soul_hexer: {
    id: 'soul_hexer', name: '寄魂',
    approach: 'hexer', archetype: 'caster',
    maxHealth: 60, speed: 62, contactDamage: 8, xpValue: 8, size: 16,
    color: 0x66d8c8, bodyColor: 0x2a7a6a,
    mechanism: { hexIntervalMs: 3200, hexRadius: 320 },
  },

  /**
   * 引路尸 —— 堵路:缓慢向你靠近,并把沿途的怪拖到它身后堆成一堵墙。
   * 本来开阔的地图会突然只剩一个方向可走。
   */
  path_corpse: {
    id: 'path_corpse', name: '引路尸',
    approach: 'shepherd', archetype: 'stalker',
    maxHealth: 120, speed: 34, contactDamage: 16, xpValue: 9, size: 19,
    color: 0x9a9a6a, bodyColor: 0x4a4a2a,
    mechanism: { dragRadius: 240 },
  },

  // ===== 首领(《怪物设计》第五节)=====

  /**
   * 朱雀(成体) —— 朱雀星守护神,10:00 登场。
   *
   * 它**不进刷怪表**,由 BossSystem 按时间表单只投放。
   * 三阶段的招式与节奏写在 BossConfig,这里只负责「它是一只什么样的怪」:
   * 血量、护甲、体型、配色。
   *
   * 护甲 0.20 是给破防类构筑留的活口:化魔指的破魔 30%、斩罗的破防 35%
   * 在它身上能削掉约 1/3 护甲 —— 少了这个数字,那两条遗物/进化在终局毫无意义。
   */
  zhuque: {
    id: 'zhuque', name: '朱雀(成体)',
    approach: 'boss', archetype: 'guardian',
    maxHealth: 4000, speed: 78, contactDamage: 26, xpValue: 300, size: 76,
    color: 0xff6622, bodyColor: 0xffaa44,
    armor: 0.20,
    attackRange: 300, fireIntervalMs: 2200, shotSpeed: 260, shotDamage: 16,
    boss: 'zhuque',
  },

  /**
   * 天运子·分身 —— 罗天星域天运宗主,20:00 登场。
   *
   * 招式(命数镀金 / 无敌闪现)与阶段节奏写在 BossConfig,这里只定
   * 「它是一只什么样的怪」。血量比朱雀高一档:20:00 的玩家 Build 已近成型,
   * 而它的机制不直接打血 —— 战斗时长靠闪现的无敌窗口拉长,不靠堆甲。
   */
  tianyunzi: {
    id: 'tianyunzi', name: '天运子·分身',
    approach: 'boss', archetype: 'guardian',
    maxHealth: 10000, speed: 64, contactDamage: 34, xpValue: 500, size: 72,
    color: 0x8855ee, bodyColor: 0xd8b860,
    armor: 0.22,
    attackRange: 300, fireIntervalMs: 2800, shotSpeed: 240, shotDamage: 18,
    boss: 'tianyunzi',
  },

  /**
   * 凌天侯·剑尊分身 —— 天运星大罗剑宗开派老祖,15:00 登场。
   *
   * 原著:净涅后期剑修,天运星战力仅次于天运子。真实身份是逆尘界大能
   * 「灭生老人」外放的一道**监视分身** —— 所以这里的「试炼幻影」换成了
   * 「剑尊分身」:他的分量不在数值,在于他带的**剑域**与**剑肖十二子**。
   *
   * 数值故意「没那么吓人」:接触伤 18(比朱雀 26 低一档),装甲 0.10(最低档),
   * 扇形弹 14-18。真正的难度来自机制(剑域持续掉血 + 弟子围堵),不在数值。
   */
  lingtianhou: {
    id: 'lingtianhou', name: '凌天侯·剑尊分身',
    approach: 'boss', archetype: 'guardian',
    maxHealth: 9000, speed: 70, contactDamage: 18, xpValue: 400, size: 70,
    color: 0x9db4d0, bodyColor: 0xe4ecf6,
    armor: 0.10,
    attackRange: 300, fireIntervalMs: 2400, shotSpeed: 260, shotDamage: 14,
    boss: 'lingtianhou',
  },

  /**
   * 剑肖十二子 —— 凌天侯亲手培养的弟子,由 boss 的 summon 招在战斗中召出。
   *
   * 原著里他们以**十二生肖**命名(子鼠/丑牛/寅虎…辰龙),每人配一只妖灵、
   * 得师尊赐一道保命剑气。纸面修为不弱(婴变~阴虚,大师兄辰龙问鼎初期),
   * 但实战经验极差 —— 在妖灵之地几乎被王林屠尽,只有辰龙活了下来。
   *
   * 所以这里他们**就是普通剑修档的杂兵**:威胁来自「剑尊在背后」,
   * 而不是他们自己有多强。给他们太高的数值会毁掉剑域那道距离题 ——
   * 玩家会被迫先去清弟子,剑域就退化成了背景装饰。
   *
   * ⚠️ 不出现在常规刷怪表里:他们只由 boss 召唤
   *    (approach: 'summon' —— 见 WaveConfig 的可达性自检与 BossConfig 的 summon 表)。
   *
   * ⚠️ `archetype` 复用 `caster`(术修)而不是新开一档:archetype 决定美术分型
   *    (见 AssetGenerator.generateEnemies 的「archetype × 配表」),新开一档意味着
   *    还要给整张 archetype 表补一套程序化画法与两个贴图键。剑修弟子是**远程点射**
   *    的瘦削人形,术修那一套形状本来就贴 —— 不值得为它撑开一个新分型。
   */
  sword_disciple: {
    id: 'sword_disciple', name: '剑肖弟子',
    approach: 'summon', archetype: 'caster',
    maxHealth: 150, speed: 92, contactDamage: 12, xpValue: 22, size: 26,
    color: 0x9db4d0, bodyColor: 0xd8e4f2,
    armor: 0.04,
    attackRange: 240, fireIntervalMs: 2600, shotSpeed: 230, shotDamage: 10,
  },
};
