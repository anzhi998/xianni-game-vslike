import type { AttackForm } from '../types';
import { EVOLUTIONS } from './EvolutionConfig';

/**
 * 神通表 —— 五门法术,每门一张 1–8 级的固定数值表
 *
 * ## 为什么没有「基础值 × 等级倍率」
 *
 * 旧实现是「一个基础值 + 一个倍率曲线」,于是每门法术实际上只需要两行数字,
 * 剩下的全靠曲线外推。《build设计》第七节给的是**逐级手写表**:
 * 厚土术的第 5 级同时改了扇角、段数、每段伤害、推送、命中上限;
 * 寂灭指第 3 级突然多出减速。这不是一条曲线能表达的东西,照抄成倍率就会丢掉
 * 「机制节点放在 3 / 5 / 8 级」这条设计原则。所以这里一行就是一行,不做任何外推。
 *
 * ## 单位
 *
 * 表里的距离单位是**格**、弹速是**格/秒**、时间是**秒**,与设计书写法完全一致,
 * 这样任何人拿设计书对表都不用心算。转换只在 resolveSpell() 一处发生。
 * 1 格 = 64px:设计书写「标准可视范围约 20 × 12 格」,而视口是 1280 × 720。
 */
export const PX_PER_GRID = 64;

/** 出手就自带的持续伤害(点燃 / 流血)。0 = 不带 */
export interface BurnDef {
  dps: number;
  ms: number;
}

/** 命中后原地留下灼烧区(焚天·火海的火海) */
export interface FireSeaDef {
  radiusGrid: number;
  lifeMs: number;
  /** 每秒伤害。设计书给的是 28/s,这里原样保留 —— 它才是这个进化的主伤害 */
  dps: number;
  /** 同一点最多叠几层 */
  maxStacks: number;
}

/** 周期放射状剑气(斩罗决)。用投射物池发射,不新建实体 */
export interface BurstDef {
  everyMs: number;
  damage: number;
  /** 0 = 用当前飞剑数(仙剑叠满即 8 道) */
  count: number;
  widthGrid: number;
  speedGrid: number;
  lifeMs: number;
  /** 破防:无视目标护甲的比例 */
  armorPen: number;
  bleed: BurnDef | null;
}

/**
 * 一门神通在某一级的全部数值。行内字段直接就是最终值。
 *
 * 通用字段对所有形态有意义但只有对应形态会读:
 * count 对直射=弹数、对环绕=飞剑数、对连锁=雷弧道数、对扇形=命中上限。
 */
export interface SpellLevel {
  damage: number;
  /** 冷却(秒) */
  cooldown: number;
  count: number;
  pierce: number;
  area: number;
  /** 弹速(格/秒)。扇形/连锁为 0 */
  speed: number;
  /** 存续或周期(秒)。环绕形态用 `lifeLaps` 代替,见下 */
  life?: number;

  // ---- 直射 ----
  /** 射程(格)。0 = 全屏 */
  rangeGrid?: number;
  /**
   * 光束宽度(格)。寂灭指 0.4 格,化魔指 2.0 格。
   *
   * ⚠️ 这是**碰撞宽度**,不是画出来的宽度 —— 两者必须由 visualScale 手动对齐,
   *    否则会出现「判定了却看着没打中」(贴图太小时最常见)。
   */
  widthGrid?: number;
  /**
   * 贴图的视觉缩放。
   *
   * 为什么需要它:Projectile 的碰撞圆半径会被 sprite 的 scale **乘一遍**
   * (Phaser 的 Body.updateBounds 从 frame.realWidth × scaleX 推导),
   * 所以「把贴图放大到和碰撞宽度一致」不能只改 scale —— 那会把命中判定
   * 一起放大。Projectile.setup 的做法是「半径 ÷ scale」,两个数字必须成对给。
   *
   * 化魔指的范围是寂灭指的 5 倍(0.4 格 → 2.0 格),贴图不跟着宽 5 倍,
   * 玩家看到的就是一道细芒而不是「宽阔魔气带」—— 表现力不够的根因就在这里。
   */
  visualScale?: number;
  /** 多发齐射的总张角(弧度)。宽光束要用更大的张角,否则三道叠成一道看不见 */
  spreadRad?: number;
  slowMul?: number;
  slowMs?: number;
  burn?: BurnDef;
  fireSea?: FireSeaDef;

  // ---- 环绕 ----
  orbitRadiusGrid?: number;
  orbitSpeed?: number;
  /**
   * 同一只怪多久能被同一把剑再撞一次(毫秒)。**环绕形态不要给这个值** ——
   * 它由 `orbitSpeed` 现算成「一圈」。原因见上方 `lifeLaps` 的注释:
   * 环绕体系里冷却**永远只能是限制项**,填什么都不可能让它多打一下。
   */
  hitCdMs?: number;
  /**
   * 飞剑存活**多少圈**(环绕形态专用,给了它就不再看 `life`)。
   *
   * ⚠️ 为什么环绕形态不能用秒:一圈的时长是 `2π / orbitSpeed`,而飞剑
   * **只有真的转回去才会第二次碰到同一个敌人**。手填 `life` 等于手填「它
   * 能不能活到转完第二圈」—— 剑阵曾经把 `life` 写成 1600ms 而一圈是 1599ms,
   * 差 1ms,穿透机制就靠这 1ms 撑着,改任何一个数都会让它悄悄退回一段且不报错。
   * 改成圈数之后,「活两圈」在数据里就是 `lifeLaps: 2`,没有可以填错的余量。
   */
  lifeLaps?: number;

  // ---- 扇形 ----
  /** 扇角(弧度)。90° = PI/2,山崩地裂 180° = PI */
  coneSpan?: number;
  coneRadiusGrid?: number;
  segments?: number;
  pushGrid?: number;
  /** 崩墙:阻挡带存活时长。0 = 本级没有崩墙 */
  barrierMs?: number;
  /**
   * 沙浪能否打掉敌方弹丸(首领的除外)。
   *
   * 只在厚土术**满级**与山崩地裂上开。为什么放在满级而不是初始:
   * 厚土术的单体 DPS 是五门里最低的(满级 30),它换来的价值全在「控制」上 ——
   * 推挤、减速、崩墙。清弹是这条控制线的**终点**:从「把怪推开」升级到
   * 「把这波攻击推开」。放在第 1 级会让它变成一张万能的防御牌,
   * 放在第 8 级则是「你把这条线走完了」的兑现。
   */
  clearsShots?: boolean;

  // ---- 连锁 ----
  jumps?: number;
  chainRangeGrid?: number;
  falloff?: number;
  shockCap?: number;
  shockMs?: number;
  /** 每层感电给雷系伤害的加成 */
  shockAmp?: number;
  /** 天雷引:感电满层目标自动降雷的间隔。0 = 没有 */
  skyThunderMs?: number;
  skyThunderDamage?: number;

  /** 无视护甲比例(破魔 / 破防) */
  armorPen?: number;

  /**
   * 本级**新出现**的机制,一行话。
   *
   * 只写玩家从伤害数字里推不出来的东西:「多 2 点伤害」不用写,
   * 「沙浪从此能打落敌方弹道」必须写 —— 否则那张悟道卡在他眼里
   * 与别的升级卡毫无区别,而设计书的「机制节点放在 3/5/8 级」
   * 就成了一句只有配表的人知道的暗话。
   */
  note?: string;
}

export interface SpellDef {
  id: string;
  name: string;
  /** 一句话几何说明。会印在悟道卡面上 —— 玩家要能看出这件与手上的形状不同 */
  desc: string;
  form: AttackForm;
  /**
   * 直射的索敌方式。
   * target = 自动锁最近的敌人(火球术),facing = 朝玩家面向射(寂灭指)。
   * 这一个字段就是「同为自动索敌」的同门之间那条区分线的一半:
   * 火球有落点、空间上可躲;寂灭指要你自己摆正朝向。
   */
  aim?: 'target' | 'facing';
  texture: string;
  color: number;
  /** 索引 0 = 1 级。进化形态只有一行(它只有一个强度) */
  levels: SpellLevel[];
  /** 专属遗物 id,同时是这条进化链的钥匙 */
  keyRelic?: string;
  /** 周期放射剑气(仅斩罗决) */
  burst?: BurstDef;
}

/** 一门神通在某一级的**解析结果**:单位已换算成像素/毫秒,可以直接开火 */
export interface ResolvedSpell {
  def: SpellDef;
  id: string;
  name: string;
  form: AttackForm;
  aim: 'target' | 'facing';
  texture: string;
  color: number;
  level: number;

  damage: number;
  cooldownMs: number;
  count: number;
  pierce: number;
  area: number;
  speed: number;
  lifeMs: number;

  rangePx: number;
  widthPx: number;
  visualScale: number;
  spreadRad: number;
  slowMul: number;
  slowMs: number;
  burn: BurnDef | null;
  fireSea: FireSeaDef | null;

  note: string;
  orbitRadius: number;
  orbitSpeed: number;
  hitCdMs: number;

  coneSpan: number;
  coneRadius: number;
  segments: number;
  pushPx: number;
  barrierMs: number;
  clearsShots: boolean;

  jumps: number;
  chainRange: number;
  falloff: number;
  shockCap: number;
  shockMs: number;
  shockAmp: number;
  skyThunderMs: number;
  skyThunderDamage: number;

  armorPen: number;
}

export const MAX_SPELL_LEVEL = 8;

/**
 * 法术槽的**上限**(不是开局槽数)。
 *
 * ⚠️ 槽位阶梯住在 RealmConfig —— 开局 2 格,筑基/结丹/元婴/化神各 +1。
 *    这里只声明天花板,因为超过它之后再加槽位也没有第五门以上的法术可放。
 *    WeaponSystem 的当前上限由 RealmSystem 在突破时推进。
 */
export const MAX_SPELL_SLOTS = 6;

/**
 * 开局神通。设计书第一节:主角王林的起始法术是火球术。
 */
export const STARTING_SPELL = 'fireball';

/** 进化形态的 id 集合。「进化形态不得直接出现在悟道池里」的校验靠它 */
export const EVOLVED_IDS = new Set(EVOLUTIONS.map((e) => e.evolved));

export const SPELLS: Record<string, SpellDef> = {

  // ===== ① 火球术 · 焚天火海流 =====

  /**
   * 火球术 —— 追踪直线飞弹,命中爆裂(不穿透)。
   *
   * 设计书对它的判词是「什么都不决定的入门件」,所以它没有专属几何:
   * 它的价值在第 3 级才出现(点燃),在此之前它就是一发一发的小火球。
   * 强在密集怪群(落点火海叠层),弱在高速冲刺怪(要预判落点)。
   */
  fireball: {
    id: 'fireball', name: '火球术',
    desc: '自动锁敌的追踪火球,命中爆裂。第 3 级起附带点燃。',
    form: 'projectile', aim: 'target', texture: 'proj_fireball', color: 0xff5522,
    keyRelic: 'tianni_ye',
    levels: [
      { damage: 12, cooldown: 1.80, count: 1, pierce: 0, area: 1, speed: 8, life: 0.9 },
      { damage: 16, cooldown: 1.70, count: 1, pierce: 0, area: 1, speed: 8, life: 0.9 },
      { damage: 16, cooldown: 1.60, count: 2, pierce: 0, area: 1, speed: 8, life: 0.9, burn: { dps: 4, ms: 2000 }, note: '命中附带点燃' },
      { damage: 20, cooldown: 1.50, count: 2, pierce: 0, area: 1, speed: 9, life: 0.9, burn: { dps: 6, ms: 2000 } },
      { damage: 20, cooldown: 1.40, count: 3, pierce: 0, area: 1, speed: 9, life: 0.9, burn: { dps: 6, ms: 3000 } },
      { damage: 24, cooldown: 1.30, count: 3, pierce: 0, area: 1, speed: 9, life: 0.9, burn: { dps: 8, ms: 3000 } },
      { damage: 24, cooldown: 1.20, count: 4, pierce: 0, area: 1, speed: 10, life: 0.9, burn: { dps: 8, ms: 3000 } },
      { damage: 30, cooldown: 1.10, count: 4, pierce: 0, area: 1, speed: 10, life: 0.9, burn: { dps: 10, ms: 4000 }, note: '点燃 10/s,持续 4 秒' },
    ],
  },

  /**
   * 焚天·火海 —— 火球术 8 级 + 天逆珠灵液 5 级。
   *
   * 进化的主伤害**不在弹上,在地上**:直伤只从 30 抬到 45(4×45/1.1 ≈ 164),
   * 真正的跃升来自命中落点的火海(28/s,可叠 3 层)。
   * 「进化在画面上看得见」—— 这一条是五路里做得最明显的。
   */
  fenhai: {
    id: 'fenhai', name: '焚天·火海',
    desc: '火球命中处炸开灼烧区,最多叠 3 层。空间上可躲,用来封路分割怪群。',
    form: 'projectile', aim: 'target', texture: 'proj_nine_nether_fire', color: 0xff3311,
    levels: [
      {
        damage: 45, cooldown: 1.10, count: 4, pierce: 0, area: 1.2, speed: 10, life: 0.9,
        burn: { dps: 10, ms: 4000 },
        fireSea: { radiusGrid: 1.2, lifeMs: 3000, dps: 28, maxStacks: 3 },
      },
    ],
  },

  // ===== ② 寂灭指 · 化魔指流 =====

  /**
   * 寂灭指 —— 朝移动方向射出指气,穿透直线上的敌人。
   *
   * 唯一「由玩家朝向决定」的直线法术:它逼你面对威胁最大的方向。
   * 进化前极度依赖走位拉线串怪,拐角与绕圈怪容易漏清。
   */
  jimie: {
    id: 'jimie', name: '寂灭指',
    desc: '朝面向射出一道贯穿指气,穿透直线上的敌人。第 3 级起附带减速。',
    form: 'projectile', aim: 'facing', texture: 'proj_jimie', color: 0xcc44ff,
    keyRelic: 'sanmo',
    levels: [
      { damage: 15, cooldown: 2.20, count: 1, pierce: 2, area: 1, speed: 16, life: 0.42, rangeGrid: 6, widthGrid: 0.4, visualScale: 1.4 },
      { damage: 20, cooldown: 2.00, count: 1, pierce: 2, area: 1, speed: 16, life: 0.42, rangeGrid: 6, widthGrid: 0.4, visualScale: 1.4 },
      { damage: 20, cooldown: 1.90, count: 1, pierce: 3, area: 1, speed: 16, life: 0.45, rangeGrid: 7, widthGrid: 0.4, visualScale: 1.4, slowMul: 0.15, slowMs: 1000, note: '命中附带减速' },
      { damage: 22, cooldown: 1.80, count: 2, pierce: 3, area: 1, speed: 16, life: 0.45, rangeGrid: 7, widthGrid: 0.4, visualScale: 1.4, spreadRad: 0.20, slowMul: 0.15, slowMs: 1500 },
      { damage: 26, cooldown: 1.70, count: 2, pierce: 4, area: 1, speed: 16, life: 0.52, rangeGrid: 8, widthGrid: 0.4, visualScale: 1.4, spreadRad: 0.20, slowMul: 0.20, slowMs: 1500 },
      { damage: 30, cooldown: 1.60, count: 2, pierce: 4, area: 1, speed: 16, life: 0.52, rangeGrid: 8, widthGrid: 0.4, visualScale: 1.4, spreadRad: 0.20, slowMul: 0.20, slowMs: 2000 },
      { damage: 30, cooldown: 1.50, count: 3, pierce: 5, area: 1, speed: 16, life: 0.58, rangeGrid: 9, widthGrid: 0.4, visualScale: 1.4, spreadRad: 0.24, slowMul: 0.25, slowMs: 2000 },
      { damage: 36, cooldown: 1.40, count: 3, pierce: 6, area: 1, speed: 16, life: 0.62, rangeGrid: 10, widthGrid: 0.4, visualScale: 1.4, spreadRad: 0.24, slowMul: 0.25, slowMs: 2000 },
    ],
  },

  /**
   * 化魔指 —— 寂灭指 8 级 + 散魔铠甲 5 级。
   *
   * 「范围 ×5」是这五条进化里最大的一跳:光束从 0.4 格宽变 2.0 格、
   * 射程变成全屏、穿透变成无限。单目标 DPS 只有 125(比火球术还低),
   * 它换来的是「一线扫过成片湮灭」—— 五条路线里唯一能从开局直通终局的。
   */
  huamo: {
    id: 'huamo', name: '化魔指',
    desc: '一道全屏贯穿的宽阔魔气带,穿透无限,附带破魔与重减速。',
    form: 'projectile', aim: 'facing', texture: 'proj_huamo', color: 0xaa22ff,
    levels: [
      {
        // 速度刻意压到 12 格/s(768px/s)而不是寂灭指的 16 ——
        // 一条 128px 宽的魔气带以 1024px/s 掠过屏幕只是一闪,看不见形状。
        // 慢下来之后玩家才读得出「这是那条 5 倍宽的带」。
        // 穿透无限,所以慢不影响它打中什么,只影响你好不好看。
        damage: 50, cooldown: 1.20, count: 3, pierce: 999, area: 1, speed: 12, life: 1.8,
        rangeGrid: 0, widthGrid: 2.0, visualScale: 1.55, spreadRad: 0.34,
        slowMul: 0.40, slowMs: 3000, armorPen: 0.30,
      },
    ],
  },

  // ===== ③ 剑阵 · 斩罗决流 =====

  /**
   * 剑阵 —— 数把飞剑绕身持续旋转,靠碰撞造成伤害。
   *
   * 全体系唯一「贴身自动生效、完全不需要瞄准」的一条,所以它的冷却
   * 语义与别门不同:periodMs 就是转一圈的周期,不是「多久打一次」。
   * 进化前对远程炮台乏力 —— 那是斩罗决要补的洞。
   */
  jianzhen: {
    id: 'jianzhen', name: '剑阵',
    desc: '数把飞剑绕身旋转,碰撞即伤。无需瞄准,但打不到远处的炮台。',
    form: 'orbiter', texture: 'proj_sword_array', color: 0x88ddff,
    keyRelic: 'xianjian',
    levels: [
      // ⚠️ 伤害比设计书第一版低,是因为**命中次数变了**,不是削弱:
      //    老代码的 hitSet 终身不清,每把剑对同一只怪一辈子只打 1 下;
      //    修好之后是 1(生成点)+ lifeLaps(每圈一次)共 3 下。实测 6 × 21 × 3 ÷ 3.20
      //    ≈ 118,正好落在「8 级 DPS 100–120」的上沿。改 `lifeLaps` 必须重算这张表。
      // ⚠️ 时长一律以**圈**给(`lifeLaps`),冷却也跟着走,
      //    因为飞剑的命中次数完全由「它活了几圈」决定 ——
      //    活 2 圈 + 每圈打一次 = 每只怪吃 2 次,活 1 圈就只有 1 次。
      //    `cooldown` 保持等于存活期,场上飞剑把数才恒定(不会叠成两倍,也不会断档)。
      //    ⚠️ `visualScale` 在这里只改**外观**:飞剑没有物理体,命中判定走
      //    `Orbiter.hitRadius`(恒定 16px),不随 scale 变化。
      //    它解决的是「武器比目标还小」——10px 的原图比铁甲蚁(10px)、
      //    腐尸(15px)、石傀(20px)都小,屏幕上读不出「我在输出」。
      //    与 `SpellLevel.visualScale`(投射物那张)同名不同义:那边是
      //    「半径 ÷ scale」成对给,这边没有任何东西需要抵消。
      { damage: 9, cooldown: 5.98, count: 2, pierce: 0, area: 1, speed: 0, lifeLaps: 2, orbitRadiusGrid: 1.5, orbitSpeed: 2.1, visualScale: 1.8 },
      { damage: 11, cooldown: 5.61, count: 2, pierce: 0, area: 1, speed: 0, lifeLaps: 2, orbitRadiusGrid: 1.5, orbitSpeed: 2.24, visualScale: 1.8 },
      { damage: 11, cooldown: 5.19, count: 3, pierce: 0, area: 1, speed: 0, lifeLaps: 2, orbitRadiusGrid: 1.6, orbitSpeed: 2.42, visualScale: 1.9, note: '飞剑增至 3 把' },
      { damage: 13, cooldown: 4.80, count: 3, pierce: 0, area: 1, speed: 0, lifeLaps: 2, orbitRadiusGrid: 1.8, orbitSpeed: 2.62, visualScale: 2.0 },
      { damage: 13, cooldown: 4.39, count: 4, pierce: 0, area: 1, speed: 0, lifeLaps: 2, orbitRadiusGrid: 1.8, orbitSpeed: 2.86, visualScale: 2.05 },
      { damage: 17, cooldown: 4.00, count: 4, pierce: 0, area: 1, speed: 0, lifeLaps: 2, orbitRadiusGrid: 2.0, orbitSpeed: 3.14, visualScale: 2.15 },
      { damage: 17, cooldown: 3.60, count: 5, pierce: 0, area: 1, speed: 0, lifeLaps: 2, orbitRadiusGrid: 2.0, orbitSpeed: 3.49, visualScale: 2.25 },
      { damage: 21, cooldown: 3.20, count: 6, pierce: 0, area: 1, speed: 0, lifeLaps: 2, orbitRadiusGrid: 2.2, orbitSpeed: 3.93, visualScale: 2.4 },
    ],
  },

  /**
   * 斩罗决 —— 剑阵 8 级 + 仙剑 5 级。
   *
   * 环绕保留,并每 4 秒来一次「收束斩出放射状剑气」。
   * 剑气道数 = 当前飞剑数,所以仙剑每叠一级,斩罗的覆盖面就宽一道 ——
   * 剑数联动是这一条进化唯一的成长线,不另开数值。
   * 它补的正是剑阵的短板:远处炮台怪。
   */
  zhanluo: {
    id: 'zhanluo', name: '斩罗决',
    desc: '飞剑环绕,每 4 秒收束一次,向四周斩出等量放射剑气,贯穿全场。',
    form: 'orbiter', texture: 'proj_sword_array', color: 0xaaeaff,
    levels: [
      // 飞剑数直接写 8,而不是「6 + 仙剑的 +2」。
      //
      // 原因:融合会把仙剑**吸收掉**(腾出一个遗物槽,设计书 3.5 规则 4),
      // 于是合完那一瞬间 mods.orbAdd 归零 —— 若这里只写 6,玩家会眼看着
      // 飞剑从 8 把**掉回** 6 把。「融合应该是一次纯粹的跃升」,不该有这种倒退。
      // 设计书也明说斩罗的剑气道数 = 仙剑叠满的 8 道,所以这里把那一档直接烘进数值行。
      // ⚠️ `damage: 48` = 剑阵8 的 32 × 仙剑5 级的 1.5,**一字不差地把遗物的
      //    收益烘进来**。这才是「融合 = 纯粹的跃升」的前提:融合会 absorb 掉仙剑,
      //    `mods` 里再也拿不到那 1.5 倍,而融合多出来的剑气又还没到冷却,
      //    于是这一行比不过「不融合、把仙剑叠满」。行里写 41(一个随手挑的数)
      //    的时候,融合是**降级**的。
      // ⚠️ 转速 4.2 → 7.0(`lifeLaps` 2.2 而非 2:留出余量,否则第三圈那次经过
      //    正好卡在寿命边界上,能不能算第三下取决于帧相位 —— 实测 7.0 + 2.0 圈
      //    只打出 2 下,2.2 圈才稳定 3 下)。
      //    实测:8 × 50 × 3 下 ÷ 1.97s ≈ 608,加剑气 90 ≈ **698**,
      //    压过「剑阵8 + 仙剑5」的 473 —— 融合必须赢得看得见(约 +47%)。
      { damage: 50, cooldown: 1.97, count: 8, pierce: 0, area: 1, speed: 0, lifeLaps: 2.2, orbitRadiusGrid: 2.2, orbitSpeed: 7.0, armorPen: 0, visualScale: 2.5 },
    ],
    burst: {
      // 剑气放慢(9 → 7 格/s)并加宽加长:它是每 4 秒才有一次的招牌动作,
      // 一闪而过等于没做。45 伤害不变,只是让它看得见
      everyMs: 4000, damage: 45, count: 0, widthGrid: 1.2,
      speedGrid: 7, lifeMs: 1600, armorPen: 0.35, bleed: { dps: 15, ms: 3000 },
    },
  },

  // ===== ④ 厚土术 · 山崩地裂流 =====

  /**
   * 厚土术 —— 朝面向翻卷喷出沙土,扇面内**分段推进**:敌人被向外推挤,
   * 会依次穿过每一段并各结算一次伤害。所以单目标吃满 N 段、群体吃一次扇扫。
   *
   * ⚠️ **射程已在试玩后砍半**(设计书写满级 7 格,实测半个屏幕太宽,现为 3.5 格)。
   *    扇角、段数、推距都没动 —— 只把「够得着多远」缩回来,打击感与聚怪逻辑不受影响。
   *
   * ⚠️ 配表口径:这是五条路线里单体最低的一条(满级 30)。
   *    强度基准「8 级 DPS ≈ 100–120」在这里按**常态群伤(典型命中 4 个)= 120** 口径对齐,
   *    并按表里的命中上限封顶。误按单目标配表会把数值配爆约 4 倍。
   *
   * 刻意的设计约束(勿改):厚土术走推挤 + 减速,**不做硬控** ——
   * 否则会直接压废通用遗物「定身术」。全体系唯一的硬控是进化后的「撞墙眩晕」。
   */
  houtu: {
    id: 'houtu', name: '厚土术',
    desc: '朝面向翻卷喷出沙浪,分 3 段推进并把敌人向外推挤。走位把怪群挤成一坨。',
    // ⚠️ `texture` 在 cone / chain 两种形态上**没有消费者** —— 那两种形态是
    // Container + Graphics 现场画的。`proj_sand` / `proj_bolt` 是死键,别为它做图。
    form: 'cone', texture: 'proj_sand', color: 0xc8a05a,
    keyRelic: 'houtu_yin',
    levels: [
      { damage: 8, cooldown: 1.60, count: 3, pierce: 0, area: 1, speed: 0, life: 0.4, coneSpan: 0.96, coneRadiusGrid: 2.0, segments: 2, pushGrid: 0.4 },
      { damage: 9, cooldown: 1.55, count: 3, pierce: 0, area: 1, speed: 0, life: 0.4, coneSpan: 1.05, coneRadiusGrid: 2.15, segments: 2, pushGrid: 0.5 },
      { damage: 10, cooldown: 1.50, count: 4, pierce: 0, area: 1, speed: 0, life: 0.4, coneSpan: 1.13, coneRadiusGrid: 2.3, segments: 2, pushGrid: 0.6, slowMul: 0.15, slowMs: 1000, note: '命中附带减速' },
      { damage: 11, cooldown: 1.45, count: 4, pierce: 0, area: 1, speed: 0, life: 0.4, coneSpan: 1.22, coneRadiusGrid: 2.5, segments: 2, pushGrid: 0.7, slowMul: 0.15, slowMs: 1500 },
      { damage: 11, cooldown: 1.40, count: 5, pierce: 0, area: 1, speed: 0, life: 0.4, coneSpan: 1.31, coneRadiusGrid: 2.75, segments: 3, pushGrid: 0.8, slowMul: 0.20, slowMs: 1500, note: '沙浪增至 3 段,推得更远' },
      { damage: 11, cooldown: 1.30, count: 5, pierce: 0, area: 1, speed: 0, life: 0.4, coneSpan: 1.40, coneRadiusGrid: 3.0, segments: 3, pushGrid: 0.9, slowMul: 0.20, slowMs: 2000 },
      { damage: 12, cooldown: 1.25, count: 6, pierce: 0, area: 1, speed: 0, life: 0.4, coneSpan: 1.48, coneRadiusGrid: 3.25, segments: 3, pushGrid: 1.0, slowMul: 0.25, slowMs: 2000 },
      { damage: 12, cooldown: 1.20, count: 6, pierce: 0, area: 1, speed: 0, life: 0.4, coneSpan: 1.57, coneRadiusGrid: 3.5, segments: 3, pushGrid: 1.2, slowMul: 0.25, slowMs: 2000, clearsShots: true, note: '沙浪可打落敌方弹道(首领的除外)' },
    ],
  },

  /**
   * 山崩地裂 —— 厚土术 8 级 + 厚土印 5 级。
   *
   * 扇角 90° → 180°(转身即换正面),段数 3 → 4,新增**崩墙**:
   * 扇面末端隆起一道弧形土墙,3 秒。
   *
   * 土墙是**阻挡带,不是伤害区** —— 敌人被挡住,玩家与玩家弹道可自由穿过。
   * 被推上墙的敌人额外 40 伤害 + 眩晕 0.6 秒(全体系唯一的硬控)。
   * 对 Boss / 精英推距与撞伤减半,防止推挤流直接破坏 Boss 战设计。
   */
  shanbeng: {
    id: 'shanbeng', name: '山崩地裂',
    desc: '半屏沙浪 + 扇面末端隆起一道土墙。撞墙者受伤并被眩晕。',
    form: 'cone', texture: 'proj_sand', color: 0xa8783a,
    levels: [
      {
        damage: 15, cooldown: 1.05, count: 6, pierce: 0, area: 1, speed: 0, life: 0.4,
        coneSpan: Math.PI, coneRadiusGrid: 4.5, segments: 4, pushGrid: 1.2,
        slowMul: 0.25, slowMs: 2000, barrierMs: 3000,
        note: '沙浪打落敌弹 + 撞墙眩晕',
        // 进化必须继承基础形态满级的能力 —— 融合掉它会让玩家在变强的那一刻
        // 失去清弹(与斩罗决掉剑数是同一类倒退)
        clearsShots: true,
      },
    ],
  },

  // ===== ⑤ 五雷正法 · 五雷轰顶流 =====

  /**
   * 五雷正法 —— 瞬时锁敌,雷弧依次跳跃至邻近目标,逐跳衰减,并给命中的叠感电。
   *
   * 三个刻意的设计约束(勿改):
   *   - 跳跃距离 3.5 格是全局最重要的平衡参数,它决定连锁能不能「成网」,
   *     调它比调伤害有效得多;
   *   - 感电只强化**雷系自身**伤害,不给任何控制 ——
   *     雷系最容易想到的「麻痹/定身」会与通用遗物「定身术」正面撞车;
   *   - 无飞行时间,与火球术的弹道形成对照。两者同为自动索敌,
   *     差异全在这条:火球有落点、空间上可躲;五雷瞬时、空间上不可躲。
   */
  wulei: {
    id: 'wulei', name: '五雷正法',
    desc: '瞬时锁敌,雷弧逐跳弹射并给目标叠感电。怪越多越强。',
    // ⚠️ 同上:`texture` 在 chain 形态上没有被读过,`proj_bolt` 是死键
    form: 'chain', texture: 'proj_bolt', color: 0x88ccff,
    keyRelic: 'zijin_lei',
    levels: [
      { damage: 18, cooldown: 1.80, count: 1, pierce: 0, area: 1, speed: 0, life: 0.2, jumps: 2, chainRangeGrid: 3.5, falloff: 0.80, shockCap: 1, shockMs: 3000, shockAmp: 0.06 },
      { damage: 19, cooldown: 1.75, count: 1, pierce: 0, area: 1, speed: 0, life: 0.2, jumps: 2, chainRangeGrid: 3.5, falloff: 0.80, shockCap: 1, shockMs: 3000, shockAmp: 0.06 },
      { damage: 20, cooldown: 1.70, count: 1, pierce: 0, area: 1, speed: 0, life: 0.2, jumps: 3, chainRangeGrid: 3.5, falloff: 0.80, shockCap: 2, shockMs: 3000, shockAmp: 0.06, note: '感电上限 2 层' },
      { damage: 21, cooldown: 1.65, count: 1, pierce: 0, area: 1, speed: 0, life: 0.2, jumps: 3, chainRangeGrid: 3.5, falloff: 0.82, shockCap: 2, shockMs: 3000, shockAmp: 0.06 },
      { damage: 21, cooldown: 1.60, count: 2, pierce: 0, area: 1, speed: 0, life: 0.2, jumps: 3, chainRangeGrid: 3.5, falloff: 0.82, shockCap: 2, shockMs: 3000, shockAmp: 0.06, note: '雷弧增至 2 道' },
      { damage: 22, cooldown: 1.50, count: 2, pierce: 0, area: 1, speed: 0, life: 0.2, jumps: 4, chainRangeGrid: 3.5, falloff: 0.82, shockCap: 3, shockMs: 3000, shockAmp: 0.06 },
      { damage: 23, cooldown: 1.40, count: 2, pierce: 0, area: 1, speed: 0, life: 0.2, jumps: 4, chainRangeGrid: 3.5, falloff: 0.85, shockCap: 3, shockMs: 3000, shockAmp: 0.06 },
      { damage: 23, cooldown: 1.30, count: 3, pierce: 0, area: 1, speed: 0, life: 0.2, jumps: 5, chainRangeGrid: 3.5, falloff: 0.85, shockCap: 3, shockMs: 3000, shockAmp: 0.06, note: '雷弧增至 3 道,跳跃 5 次' },
    ],
  },

  /**
   * 五雷轰顶 —— 五雷正法 8 级 + 紫金雷葫 5 级。
   *
   * 新增「天雷引」:感电满层的目标每 2 秒自动降下一道天雷,无视递减,
   * 并优先锁定「感电满层且当前血量最高」的目标 —— 自动集火精英与 Boss。
   *
   * 天雷存在的唯一理由是补雷系单体短板:未进化时连锁递减在单目标上
   * 完全不生效,打 Boss 明显吃力。进化后单体 53 → 135(×2.5)。
   */
  wulei_hong: {
    id: 'wulei_hong', name: '五雷轰顶',
    desc: '四道雷弧、跳跃更深、感电更厚;感电满层的目标会被天雷自动点名。',
    form: 'chain', texture: 'proj_bolt', color: 0xaaddff,
    levels: [
      {
        damage: 26, cooldown: 1.15, count: 4, pierce: 0, area: 1, speed: 0, life: 0.2,
        jumps: 7, chainRangeGrid: 3.5, falloff: 0.88, shockCap: 5, shockMs: 4500, shockAmp: 0.08,
        skyThunderMs: 2000, skyThunderDamage: 80,
      },
    ],
  },
};

/**
 * 把某门神通的某一级解析成可以直接开火的数据。
 *
 * 进化形态只有一行,所以这里对行数做了 clamp —— 融合后神通的等级会
 * 跟着玩家一起涨,但它**永远只有那一个强度**,多出来的等级不产生收益
 * (这正是设计书「融合后原专属遗物被吸收」的另一面:等级已经兑现完了)。
 */
export function resolveSpell(id: string, level: number): ResolvedSpell | null {
  const def = SPELLS[id];
  if (!def) return null;
  const lv = Math.max(1, Math.min(level, def.levels.length));
  const r = def.levels[lv - 1];
  const g = PX_PER_GRID;

  // 环绕形态的时长单位是**圈**。一圈 = 2π / 角速度,由 orbitSpeed 现算 ——
  // 手填毫秒的话,「活几圈」和「多久能再打一次」就会各自漂,两个数对不上时
  // 不报错,只是默默地少打一次(实测踩过:life 1600ms vs 一圈 1599ms)。
  const lapMs = r.orbitSpeed ? (Math.PI * 2 / r.orbitSpeed) * 1000 : 0;

  return {
    def, id, name: def.name, form: def.form, aim: def.aim ?? 'target',
    texture: def.texture, color: def.color, level: lv,
    damage: r.damage,
    cooldownMs: r.cooldown * 1000,
    count: r.count,
    pierce: r.pierce,
    area: r.area,
    speed: r.speed * g,
    lifeMs: r.lifeLaps ? r.lifeLaps * lapMs : (r.life ?? 0) * 1000,
    rangePx: (r.rangeGrid ?? 0) * g,
    widthPx: (r.widthGrid ?? 0) * g,
    visualScale: r.visualScale ?? 1,
    spreadRad: r.spreadRad ?? 0,
    slowMul: r.slowMul ?? 0,
    slowMs: r.slowMs ?? 0,
    burn: r.burn ?? null,
    fireSea: r.fireSea ?? null,
    note: r.note ?? '',
    orbitRadius: (r.orbitRadiusGrid ?? 0) * g,
    orbitSpeed: r.orbitSpeed ?? 0,
    // 环绕形态的按敌冷却固定给**半圈**。
    //   为什么不暴露成数据项:能不能打第二下取决于飞剑**有没有转回来**,
    //   所以这个数调小永远不会多打一下 —— 它唯一的作用是**防漏判**。
    //   填「正好一圈」时,「解冻时刻」和「再次经过」在赛跑,实测斩罗决
    //   (一圈 898ms、存活 2.2 圈)只打出 2 下而不是 3 下,差的就是一帧。
    //   半圈让解冻稳稳早于下一次经过,每次经过必中。
    hitCdMs: lapMs > 0 ? lapMs / 2 : (r.hitCdMs ?? 500),
    coneSpan: r.coneSpan ?? 0,
    coneRadius: (r.coneRadiusGrid ?? 0) * g,
    segments: r.segments ?? 1,
    pushPx: (r.pushGrid ?? 0) * g,
    barrierMs: r.barrierMs ?? 0,
    clearsShots: r.clearsShots ?? false,
    jumps: r.jumps ?? 0,
    chainRange: (r.chainRangeGrid ?? 0) * g,
    falloff: r.falloff ?? 1,
    shockCap: r.shockCap ?? 0,
    shockMs: r.shockMs ?? 0,
    shockAmp: r.shockAmp ?? 0,
    skyThunderMs: r.skyThunderMs ?? 0,
    skyThunderDamage: r.skyThunderDamage ?? 0,
    armorPen: r.armorPen ?? 0,
  };
}

/** 五门基础法术(不含五个进化形态) */
export const BASE_SPELL_IDS = Object.keys(SPELLS).filter((id) => !EVOLVED_IDS.has(id));

/**
 * 可达性自检:每一门神通都必须有一条**获取路径**。
 *
 * 三条路径,任意一条命中即可:
 *   开局自带 · 悟道「参悟新术」卡(池 = 全部未掌握的基础神通)· 进化的产物
 *
 * 写进表里却没有任何卡池能给出它,这门神通就只是死数据 —— 与敌人侧
 * validateEnemyReachability 同一条规矩(见 CLAUDE.md 的调试面板约定)。
 */
export function validateSpellReachability(): string[] {
  return Object.keys(SPELLS).filter((id) => !BASE_SPELL_IDS.includes(id) && !EVOLVED_IDS.has(id));
}

/**
 * 进化形态不得出现在悟道池里。
 *
 * 进化形态只能由「法术 8 级 + 专属遗物 5 级 + 开一次宝匣」得到。一旦它能被直接抽到,
 * 整套进化系统当场作废 —— 而且这种错误在试玩里看起来完全正常(你确实拿到了一门更强的法术)。
 */
export function validateEvolvedNotOffered(): string[] {
  return Object.keys(SPELLS).filter((id) => EVOLVED_IDS.has(id) && !EVOLUTIONS.some((e) => e.evolved === id));
}

/** 进化链两端必须都在表里 */
export function validateEvolutionLinks(): string[] {
  const bad: string[] = [];
  for (const e of EVOLUTIONS) {
    if (!SPELLS[e.base]) bad.push(`进化配方的基础法术不存在:${e.base}`);
    if (!SPELLS[e.evolved]) bad.push(`进化产物不存在:${e.evolved}`);
  }
  return bad;
}

/** 专属遗物必须真的专属:每条进化链都要挂一把钥匙 */
export function validateSpellKeys(): string[] {
  return EVOLUTIONS.filter((e) => !SPELLS[e.base]?.keyRelic).map((e) => `${e.base} 没有专属遗物`);
}