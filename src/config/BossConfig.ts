/**
 * 首领表 —— 定时刷新,每只绑一个「改变走位习惯」的机制
 *
 * 设计原则(《怪物设计》第五节):**Boss 不能只是血厚**。
 * 每只必须带一个迫使玩家在 Build 之外靠操作续命的机制 ——
 * 火雨 / 冰封 / 拉拽 / 定身 / 反弹,五者至少占一。
 *
 * 阶段用血量比例切分:从 1 往下找第一个满足的 hpAbove。
 * 首领的移动仍由 EnemyAiSystem 写速度(见 CLAUDE.md:敌人速度只由 AI 写),
 * 本表只决定「什么时候出什么招」,所以它被实现成 BossSystem.act()。
 *
 * ## 招式不是「一堆子弹」,是几件有名字的事
 *
 * 表里的招式各自对应一道**不同的走位题**,而且都不是靠「更多子弹」加难的:
 *
 *   - `fan`  火羽扇 —— 一道有缺口的扇形。玩家要判断**往哪一侧的缺口走**。
 *   - `nova` 环形羽爆 —— 360° 等分的一整圈,没有缺口。玩家要判断**往哪个方向跑**,
 *              并且接受「一定会穿过羽幕」这件事。它是唯一不给安全区的招。
 *   - `rain` 火雨 —— 地面预警圈。玩家要判断**放弃哪块地**。
 *   - `fate` 命数 —— 镀金小怪。玩家要判断**先清谁**。
 *   - `blink` 闪现 —— 瞬移无敌。打断「站桩输出」的节奏。
 *
 * 前几者叠加时才会出现真正的压迫:扇形逼你横移,环形逼你直冲,火雨逼你站住 ——
 * 要求互相冲突,玩家只能选一个「更不坏」的答案。这是本表存在的全部理由。
 *
 * ## 外观字段为什么写在这里
 *
 * `texture` / `color` / `spin` / `trail` 是**招式的一部分**,不是弹丸的属性:
 * 换一只首领换一套配色时,火羽的形状与拖尾行为应该跟着它走。写死在 EnemyShot 里
 * 会让第二只 Boss 只能长成朱雀的样子。
 */

/** 弹体外观。带弹道的招式共用 —— 它们打出去的是同一种「羽」,只是方向不同 */
export interface BossShotStyle {
  /** 弹体纹理键。缺省 'proj_enemy_shot'(会退化成一颗普通敌弹) */
  texture?: string;
  /** 命中玩家时爆焰的颜色 */
  color?: number;
  /**
   * 自转速度(弧度/秒)。
   *
   * 羽毛不是球,不转的话它永远是同一个角度,读起来像一支钉在空中的箭;
   * 缓慢自转让它「活着」。0 = 不自转(圆球弹体应当填 0)。
   */
  spin?: number;
  /** 拖尾。羽毛越密越该开 —— 密集弹幕里拖尾是分辨「哪片往哪飞」的主要线索 */
  trail?: boolean;
}

export interface BossFanDef extends BossShotStyle {
  /** 一次射出几片火羽 */
  count: number;
  /** 总张角(弧度) */
  spread: number;
  damage: number;
  speed: number;
  /** 出招间隔(毫秒) */
  intervalMs: number;
}

/**
 * 环形羽爆 —— 360° 等分的一整圈火羽。
 *
 * ⚠️ 它**故意不给缺口**。扇形的全部乐趣在于「找缝钻过去」,如果一圈也留缝,
 *    它就只是「一圈更长的扇形」,玩家会继续用同一套解法(横移找缺口)。
 *    真正的区别是:这一招要求玩家**主动冲进羽幕**,在最近的两片之间穿过去 ——
 *    那是一段有时机的动作,而不是一次走位。
 *
 * `count` 必须够大才有「幕」的感觉:相邻羽间隔要小于玩家身位张角,
 * 玩家站着不动必定被打,必须移动。
 */
export interface BossNovaDef extends BossShotStyle {
  /** 一圈几片火羽。等分,不是随机角度 —— 随机角度会出现偶然的大空隙 */
  count: number;
  damage: number;
  speed: number;
  intervalMs: number;
  /**
   * 每次出招的整体角度偏移(弧度)的**取值上限**。
   *
   * 每圈随机转一个小角度,是为了避免「两圈之间缝隙正好重叠」——
   * 完美对齐的圈会让玩家找到一条永远安全的直线,前摇一过就能无伤通过。
   * 0.35 弧度(约 20°)足以错开,又不会大到让玩家读不出「这是一圈」。
   */
  angleJitter?: number;
}

export interface BossRainDef {
  /** 一次落几处火雨 */
  count: number;
  /** 预警时长(毫秒) */
  warnMs: number;
  /** 落点半径(像素) */
  radius: number;
  damage: number;
  intervalMs: number;
}

/** 天运·命数:给随机小怪镀金强化(每只怪只镀一次,压力靠轮次累积) */
export interface BossFateDef {
  /** 一次「点名」几只 */
  count: number;
  hpMul: number;
  speedMul: number;
  damageMul: number;
  intervalMs: number;
}

/**
 * 天运·命数指 —— 一根从天而降的巨型虚化手指,落地成范围重击。
 *
 * 它是天运子的**普通攻击**,但「普通」只体现在频率上,不体现在分量上:
 * 一次一根、很慢(8–11 秒)、预警很长(1.6 秒),但伤害与范围都很大。
 * 慢而重,与扇形的「快而散」正好互补 —— 扇形逼你在平面上找缺口,
 * 这一招逼你**抬头看天**。两者混在一起时,玩家要同时管地面与头顶。
 *
 * ⚠️ 它**不追踪玩家的当前位置**,而是罩住「出招那一刻玩家在哪」+ 一点提前量。
 *    追踪到底的话,这招会变成「无论怎么走都会挨一下」,那不是走位题而是扣血题;
 *    给提前量则保留博弈:站着不动必中,跑起来能躲开。
 */
export interface BossFingerDef {
  /** 一次落几根手指。>1 时落点会散开,封住一小片区域 */
  count: number;
  /** 落点半径(像素) */
  radius: number;
  /** 预警时长(毫秒)。越长越好躲,也越有「看着它下来」的压迫 */
  warnMs: number;
  damage: number;
  intervalMs: number;
  /**
   * 落点相对玩家的提前量(像素)。沿玩家当前速度方向外推的距离。
   *
   * 0 = 精确罩住玩家的位置(站着不动必中);给一个正值则「预判走位」,
   * 玩家急停或变向就能躲开。它不是难度旋钮,是**博弈旋钮**。
   */
  leadPx: number;
  /** 落点整体角度偏移的取值上限(弧度),用于 count>1 时把几根指散开 */
  spreadRad?: number;
  /** 手指颜色。缺省取首领自己的主题色 */
  color?: number;
}

/** 无敌闪现:瞬移到玩家附近一点,落地后短暂无敌 */
export interface BossBlinkDef {
  intervalMs: number;
  /** 落地后的无敌时长(毫秒) */
  invulnMs: number;
  /** 落点与玩家的距离区间(像素) */
  minDist: number;
  maxDist: number;
}

/**
 * 剑域 —— 凌天侯脚下常驻的「万物皆可斩」领域。
 *
 * 与 `rain` 的落点圈有本质区别:火雨是**一次一个圈**,躲开那一下就好;
 * 剑域是**跟着剑尊走的持续区**,玩家必须决定「要不要进到它身边打」。
 * 它把「离 Boss 多远」从一个被动结果变成了一个主动选择 ——
 * 凌天侯的剑域内近身伤害极高,但远程 Build 站在外面输出又慢。
 *
 * 判定在 BossSystem 每帧算一次距离,不进 physics —— 领域是「场地」不是「碰撞体」,
 * 走 overlap 会在玩家擦边的每一帧反复进出,掉血变成抖动。
 */
export interface BossDomainDef {
  /** 领域半径(像素) */
  radius: number;
  /** 站在域内每秒掉多少血 */
  dps: number;
  /**
   * 掉血的判定间隔(毫秒)。dps 被切成一小口一小口地扣 ——
   * 一次性每秒扣一大口会让玩家「不知道自己是怎么死的」,
   * 而且扣血数字太大、太稀,读不出「我正在被烧」。
   */
  tickMs: number;
}

/**
 * 剑肖十二子 —— 凌天侯亲手培养的十二名剑修弟子(以十二生肖命名)。
 *
 * 「召唤」这一招承载的是他的**性格**:原著的凌天侯恃才傲物,却对剑肖十二子
 * 极为护短。所以这里不是「随机刷怪」,而是「他叫他的徒弟来」——
 * 每次召唤都伴随一道点名特效,且弟子有数量上限(十二子只有十二个)。
 *
 * ⚠️ 弟子**不是精锐**:原著里他们纸面修为强、实战弱,跟着王林几乎全军覆没。
 *    所以数值上他们是普通杂兵档,作用是**干扰走位与分散群攻**,
 *    不是「突然出现一群小 Boss」。他们的威胁来自「剑尊在背后」。
 */
export interface BossSummonDef {
  /** 一次召唤几名弟子 */
  count: number;
  /** 弟子的敌人 id(ENEMIES 的键) */
  type: string;
  /** 全场上限。超过就不召 —— 十二子只有十二个,且不能让画面变成怪海 */
  maxAlive: number;
  intervalMs: number;
}

export interface BossPhaseDef {
  name: string;
  /** 血量比例高于这个值时处于该阶段 */
  hpAbove: number;
  /** 移动速度(px/s) */
  speed: number;
  /** 火羽扇 */
  fan?: BossFanDef;
  /** 环形羽爆:360° 无缺口的一圈 */
  nova?: BossNovaDef;
  /** 火雨:落点预警圈 */
  rain?: BossRainDef;
  /** 命数指:从天而降的巨型虚化手指 */
  finger?: BossFingerDef;
  /** 命数:镀金全场小怪 */
  fate?: BossFateDef;
  /** 无敌闪现 */
  blink?: BossBlinkDef;
  /** 杀戮仙诀:四方符印护体,期间完全免伤(radius = 符印环绕半径) */
  shield?: BossShieldDef;
  /** 剑域:脚下常驻的持续伤害领域 */
  domain?: BossDomainDef;
  /** 召唤剑肖十二子 */
  summon?: BossSummonDef;
  /** 整体出招节奏倍率。>1 = 该阶段出招更快 */
  tempo: number;
}

/**
 * 一只首领的「行为」定义。
 *
 * 血量/护甲/体型/配色**不在这里** —— 它们住在 ENEMIES 表里,
 * 因为美术是按 archetype × 配表画的(见 AssetGenerator.generateEnemies),
 * 首领的贴图走的正是同一条路。数值只留一份,免得两只表各改一半。
 */
export interface BossDef {
  id: string;
  name: string;
  /** 出场时刻(秒) */
  atSeconds: number;
  /** 击杀掉落。kind 见 types.DropEntry */
  drops: Array<{ kind: string; payload?: number | string }>;
  phases: BossPhaseDef[];
  /**
   * 浴火重生:血量跌到该比例时**回满一次**,并进入最后一个阶段。
   * 只允许发生一次(enemy.bossRebornUsed 保证),否则玩家永远打不死它。
   */
  rebirthAtHp?: number;
  /** 重生后进入的阶段下标 */
  rebirthPhase?: number;
}

/** 朱雀的三种火羽共用配色 —— 一处改,三招一起变 */
const ZHUQUE_FEATHER: BossShotStyle = {
  texture: 'proj_fire_feather',
  color: 0xff6622,
  spin: 6,
  trail: true,
};

/**
 * 天运子的「签文」—— 淡青的符箓。
 *
 * 与朱雀的橙金火羽拉开色相是硬要求:20:00 这一场玩家同时面对怪堆与 Boss,
 * 如果两轮 Boss 的弹体同色,「这是 Boss 的招还是杂兵的弹」就没了答案。
 */
const TIANYUNZI_SIGN: BossShotStyle = {
  texture: 'proj_boss_sign',
  color: 0x66ddcc,
  spin: -3,
  trail: false,
};

/**
 * 凌天侯的剑气 —— 青灰凌厉的净荡剑气。
 *
 * 原著(动漫第 137 集起)里「凌天侯剑气」表现为**灰/金色**的凌厉剑气,
 * 自带霸道的灭杀意境 —— 幻无情越退避,剑气越强悍。
 *
 * ⚠️ 色相必须与另两只 Boss 拉开。三只的弹体色各据一方:
 *     朱雀 0xff6622 橙红(火) / 天运子 0x66ddcc 淡青(符) / 凌天侯 0x9db4d0 青灰(剑)。
 *    剑气选**青灰**而不是纯白:纯白在 ADD 混合下会糊成一片亮斑,
 *    而青灰自带「铁与霜」的冷感,与朱雀的暖色完全对立。
 */
const LINGTIANHOU_SWORD: BossShotStyle = {
  texture: 'proj_boss_sword',
  color: 0x9db4d0,
  spin: 0,
  trail: false,
};

/** 天运子命数指的落点圈颜色 —— 与它的签文同源的金,但更沉 */
const TIANYUNZI_FINGER_COLOR = 0xd8b860;

/**
 * 朱雀火雨的陨石色 —— 紫红。
 *
 * 三种「火」必须在色相上互不相同,这是玩家判断「这团火归谁」的唯一线索:
 *
 * | 火 | 色 | 形态 |
 * |---|---|---|
 * | 玩家火海(焚天) | 0xff3311 深血红 | 地面燃烧区,自叠 |
 * | 地图地火(灵脉) | 0xff8833 橙黄 | 地面柱状持续喷发 |
 * | 朱雀火雨 | **0xcc33cc 紫红** | 天上斜坠的陨石 |
 *
 * ⚠️ 它**不跟随** `ZHUQUE_FEATHER.color`(弹体的橙红 0xff6622)。弹体与场所
 *    是两套配色体系:火羽橙红是为了「快、锐、在飞」,陨石紫红是为了「归属」。
 */
export const METEOR_COLOR = 0xcc33cc;

/**
 * 杀戮仙决 —— 天运子周身张开的一层白色半透明仙力遮罩。
 *
 * ## 它为什么可以「完全免伤」而不显得耍赖
 *
 * 这招把 5 秒的**纯免伤窗口**摊在明处:罩子亮着的时候,打本体是零收益。
 * 于是它其实是**一道指路题**,而不是一道扣血题 —— 玩家在窗口里该做的是
 * 转向场上的怪堆(命数镀过金的那几只),把火力还回去,而不是继续对着罩子
 * 空放。这与天运子「考清点意识」的定位是同一件事的第二次表达:
 * 命数让你**先打谁**,杀诀让你**先不打谁**。
 *
 * 三个数字都是刻意的:
 *   - 5 秒:短于一次「清掉两只镀金怪」的时间,窗口内打得完,所以不是白等;
 *   - 15 秒:免伤占比 1/3。再短会让整场 DPS 变成随机数,再长则等于没有这招;
 *   - 半径只决定**看起来多大**,判定是本体免疫 —— 「罩子罩住它」比
 *     「罩子罩住一块地」更符合「仙力护体」的直觉,也不会产生「站在罩子里也安全」的误读。
 *
 * ⚠️ 遮罩间隔**不随 tempo 缩短**(BossSystem.castShield):免伤窗口占的是一局的总
 *    DPS,不是出手频率。狂暴阶段若把间隔也按 1.3 倍压掉,三个阶段的
 *    「免伤占比」就各不相同,配表上的 1/3 会变成一个越打越假的数。
 */
export interface BossShieldDef {
  /** 遮罩从张开到消散的时长(毫秒)。这段时间内玩家伤害**完全无效** */
  durationMs: number;
  /** 两次之间的间隔(毫秒),从张开那一刻起算 */
  intervalMs: number;
  /** 遮罩半径(像素)。只决定视觉尺寸 —— 判定是本体的,与半径无关 */
  radius: number;
}

/**
 * 剑域贴图(`fx_sworddomain`,160×160)画出来的**内容半径**。
 *
 * 贴图的外环画在距中心 72px 处,所以这张图「代表」一个半径 72 的圆。
 * `GameScene.updateBossDomain` 用 `state.radius / 这个值` 反算缩放 ——
 * 于是配表里的 `domain.radius` 一改,画面上的圈跟着变,而判定用的也是同一个数。
 *
 * ⚠️ **改贴图就必须改这里。** 视觉圈与实际判定错开,比「根本没有圈」更糟:
 *    玩家会开始不信任何地面标记,连带火雨那套预警圈一起失去意义。
 */
export const SWORD_DOMAIN_TEXTURE_RADIUS = 72;

/**
 * 杀戮仙诀符印贴图(`fx_sigil`,96×96)画出来的**内容半径**。
 *
 * 与 `SWORD_DOMAIN_TEXTURE_RADIUS` 同一套规矩:贴图把外环画在这个半径上,
 * `GameScene.updateBossShield` 用它反算缩放。⚠️ 改贴图必须改这里 ——
 * 但这张图与剑域有一处不同:它**不参与判定**(符印只表示本体免伤),
 * 所以这个数字错了只是「不好看」,不会让玩家读到假的危险区。
 */
export const SIGIL_TEXTURE_RADIUS = 44;

export const BOSSES: Record<string, BossDef> = {

  /**
   * 朱雀(成体) —— 朱雀星守护神,10:00
   *
   * 三阶段,每阶段换一个**走位习惯**,并且招式的**种类**在增加而不是只加密:
   *   一阶 火羽扇      —— 扇形弹道,逼你朝扇形缺口走(有缝可钻)
   *   二阶 火羽 + 火雨  —— 落点预警圈,逼你在「躲扇形」与「躲地圈」之间做二维选择
   *   三阶 三招齐发    —— 半血回满并狂暴,新增**环形羽爆**(没有缝了),
   *                        前两招同时更密、更快、更多片
   *
   * 「环形羽爆只出现在三阶段」是刻意的:前两阶一直在教「找缺口」,
   * 而环形羽爆正是把这条经验作废的那一招。它出现在玩家已经用熟了这条经验的时候,
   * 才有「原来这招不管用」的重量 —— 如果一开场就有,它只是「又一个弹幕」。
   *
   * 血量 4000(写在 ENEMIES.zhuque):玩家在 10:00 的单体 DPS 约 100–120,
   * 打满全程约 35 秒 —— 足够长到能记住它的三段,又不至于打断刷节奏。
   */
  zhuque: {
    id: 'zhuque', name: '朱雀(成体)',
    atSeconds: 600,
    drops: [
      { kind: 'chest', payload: 'gold' },
      { kind: 'heal' },
    ],
    rebirthAtHp: 0.5,
    rebirthPhase: 2,
    phases: [
      {
        name: '火羽扇', hpAbove: 0.66, speed: 78, tempo: 1,
        fan: {
          count: 7, spread: 1.5, damage: 16, speed: 260, intervalMs: 2200,
          ...ZHUQUE_FEATHER,
        },
      },
      {
        name: '火雨', hpAbove: 0.3, speed: 62, tempo: 1,
        fan: {
          count: 9, spread: 2.0, damage: 18, speed: 280, intervalMs: 1900,
          ...ZHUQUE_FEATHER,
        },
        rain: { count: 3, warnMs: 1100, radius: 86, damage: 22, intervalMs: 2600 },
      },
      {
        name: '浴火重生', hpAbove: 0, speed: 96, tempo: 1.45,
        // 重生后的羽换一张更红更亮的图 —— 「它变强了」必须一眼可见
        fan: {
          count: 11, spread: 2.4, damage: 20, speed: 320, intervalMs: 1500,
          texture: 'proj_fire_feather_rage', color: 0xff3300, spin: 9, trail: true,
        },
        // 环形羽爆:18 片等分(相邻 20°),比玩家身位窄 —— 站着必中,必须穿幕
        nova: {
          count: 18, damage: 22, speed: 280, intervalMs: 3400, angleJitter: 0.35,
          texture: 'proj_fire_feather_rage', color: 0xff3300, spin: 9, trail: true,
        },
        rain: { count: 4, warnMs: 900, radius: 92, damage: 24, intervalMs: 2000 },
      },
    ],
  },

  /**
   * 天运子·分身 —— 罗天星域天运宗主,20:00
   *
   * 与朱雀「考走位」相对,它考的是**清点意识**:
   *   命数指 —— **普通攻击**:一根巨型虚化手指从天而降,落地成范围重击。
   *             慢(8–11 秒一次)、重(30–38 单次)、预警长(1.5–1.7 秒)。
   *             前两阶一直逼你「低头看地、找缺口」,这一招逼你**抬头看天** ——
   *             它不是「又一个弹幕」,是唯一从**头顶**来的威胁。
   *   命数 —— 周期性给随机小怪镀金(血/速/伤抬一档,每只仅一次),
   *           不优先点掉,整片怪堆会被一轮轮镀成铁板,拖得越久越难打
   *   闪现 —— 瞬移到玩家附近并短暂无敌,专门打断「站桩输出 Boss」的节奏
   *   杀戮仙诀 —— 周身张开白色仙力遮罩,**5 秒内完全免伤**,15 秒一轮。
   *           它不是「更硬的甲」,而是把「这 5 秒别打本体」写在脸上:
   *           窗口里该把火力转向怪堆(尤其镀了金的那几只)。与命数互补 ——
   *           一个决定先打谁,一个决定先不打谁。
   * 三阶段逐步收紧:命数点名更多、闪现更频、签文扇更密、落指从一根到三根。
   * ⚠️ 杀戮仙诀是唯一**不随阶段变强**的一招(5s/15s 全程一样):免伤吃的是
   *    总 DPS 的固定比例,跟着狂暴一起加会把它从「节奏题」变成「数值墙」。
   *
   * 血量 15000(写在 ENEMIES.tianyunzi):20:00 玩家单体 DPS 约 250–300,
   * 刨去闪现无敌的窗口,全程约 60 秒 —— 比朱雀长得多是刻意的:
   * 它的压力被分摊给了怪堆,本体该给的只是「打不中」的焦躁。
   */
  tianyunzi: {
    id: 'tianyunzi', name: '天运子·分身',
    atSeconds: 1200,
    drops: [
      { kind: 'chest', payload: 'gold' },
      { kind: 'heal' },
    ],
    phases: [
      {
        name: '命数·签动', hpAbove: 0.62, speed: 64, tempo: 1,
        fan: { count: 3, spread: 0.7, damage: 18, speed: 240, intervalMs: 2800, ...TIANYUNZI_SIGN },
        // 普攻:一根,慢(11 秒)。提前量 90px 是「预判走位」而非「必中」
        finger: {
          count: 1, radius: 96, warnMs: 1700, damage: 30, intervalMs: 11000,
          leadPx: 90, color: TIANYUNZI_FINGER_COLOR,
        },
        fate: { count: 3, hpMul: 1.5, speedMul: 1.25, damageMul: 1.3, intervalMs: 6500 },
        blink: { intervalMs: 7000, invulnMs: 1000, minDist: 300, maxDist: 460 },
        shield: { durationMs: 5000, intervalMs: 15000, radius: 84 },
      },
      {
        name: '命数·逆天', hpAbove: 0.3, speed: 72, tempo: 1,
        fan: { count: 5, spread: 1.1, damage: 20, speed: 260, intervalMs: 2400, ...TIANYUNZI_SIGN },
        // 二阶起落两根,左右散开 0.55rad —— 封住一段横向走位空间
        finger: {
          count: 2, radius: 104, warnMs: 1600, damage: 34, intervalMs: 10000,
          leadPx: 110, spreadRad: 0.55, color: TIANYUNZI_FINGER_COLOR,
        },
        fate: { count: 5, hpMul: 1.5, speedMul: 1.25, damageMul: 1.3, intervalMs: 5500 },
        blink: { intervalMs: 5500, invulnMs: 1200, minDist: 280, maxDist: 440 },
        shield: { durationMs: 5000, intervalMs: 15000, radius: 88 },
      },
      {
        name: '命数·无我', hpAbove: 0, speed: 84, tempo: 1.3,
        fan: { count: 7, spread: 1.6, damage: 22, speed: 300, intervalMs: 2000, ...TIANYUNZI_SIGN },
        // 终阶三根成扇面落下 —— 「命数已定」的那种合围感。仍是 8 秒一根的慢节奏
        finger: {
          count: 3, radius: 110, warnMs: 1500, damage: 38, intervalMs: 8200,
          leadPx: 130, spreadRad: 0.85, color: TIANYUNZI_FINGER_COLOR,
        },
        fate: { count: 7, hpMul: 1.6, speedMul: 1.3, damageMul: 1.35, intervalMs: 4500 },
        blink: { intervalMs: 4200, invulnMs: 1500, minDist: 260, maxDist: 420 },
        shield: { durationMs: 5000, intervalMs: 15000, radius: 92 },
      },
    ],
  },

  /**
   * 凌天侯·剑尊分身 —— 15:00(900s)
   *
   * 原著:《仙逆》洞府界天运星大罗剑宗开派老祖,人称**剑尊**,
   * 净涅后期修为,天运星战力仅次于天运子。修**大罗诛剑道**,不需要法宝,
   * 仅凭神魂便能凝聚亿万斩道剑气;又亲手培养**剑肖十二子**(以十二生肖命名)。
   * 他的真实身份是逆尘界大能「灭生老人」外放的一道**分身**,任务是监视天运子 ——
   * 所以标题里的「分身」不是修辞,是他的设定本身。
   *
   * 与另两只 Boss 的**走位题**刻意错开三类:
   *
   *   - 朱雀考「往哪躲」—— 弹幕是问题,走位是答案(动态威胁)
   *   - 天运子考「先清谁」—— 压力在别的小怪身上,要分配火力(纵向分配)
   *   - 凌天侯考「站哪打」—— 威胁是**一块地**,而这块地跟着他走(静态区)
   *
   * 这一招「剑域」是本次改动的核心:领域**跟着剑尊移动**,半径随阶段扩大。
   * 于是「近身输出」不再是无脑最优 —— 贴着他打 DPS 最高,但每秒掉血;
   * 远程 Build 可以站在域外安全输出,代价是命中率与 DPS。玩家必须**算一个距离**,
   * 这是三只 Boss 里唯一一道「空间取舍题」,而不是「反应题」。
   *
   * 剑肖十二子是第二层:他们本身很弱(原著里几乎是纸面修为,实战被王林屠尽),
   * 作用是**打断玩家的距离计算** —— 你想站在域外慢慢磨,十二子就从背后围上来。
   *
   * 数值(9000)介于朱雀(4000)与天运子(15000)之间 —— 他不靠血量拖时间,
   * 靠的是「近身就要付钱」:接触伤 27(略高于朱雀 26)、剑域 dps 24→33→45,
   * 三只 Boss 里贴脸站桩的代价最高。拖长 = 剑域越张越大、弟子越聚越多。
   */
  lingtianhou: {
    id: 'lingtianhou', name: '凌天侯·剑尊分身',
    atSeconds: 900,
    drops: [
      { kind: 'chest', payload: 'gold' },
      { kind: 'heal' },
    ],
    phases: [
      {
        // 一阶:刚亮剑。剑域很小(140px),只够逼玩家别贴脸站着;弟子两人一轮
        name: '剑域·初开', hpAbove: 0.6, speed: 70, tempo: 1,
        fan: { count: 4, spread: 1.2, damage: 21, speed: 260, intervalMs: 2400, ...LINGTIANHOU_SWORD },
        domain: { radius: 140, dps: 24, tickMs: 500 },
        summon: { count: 2, type: 'sword_disciple', maxAlive: 6, intervalMs: 6000 },
      },
      {
        // 二阶:剑域扩张到 210px,「近身输出」的代价开始明显
        name: '剑域·合围', hpAbove: 0.28, speed: 78, tempo: 1,
        fan: { count: 6, spread: 1.4, damage: 24, speed: 280, intervalMs: 2000, ...LINGTIANHOU_SWORD },
        domain: { radius: 210, dps: 33, tickMs: 500 },
        summon: { count: 3, type: 'sword_disciple', maxAlive: 10, intervalMs: 5200 },
      },
      {
        // 三阶:剑域全开 300px,弟子三人一轮 —— 域内几乎没有安全输出位,
        // 玩家被迫在「掉血换输出」与「退出去但打不动」之间反复权衡
        name: '剑域·万物皆斩', hpAbove: 0, speed: 92, tempo: 1.15,
        fan: { count: 8, spread: 1.6, damage: 27, speed: 300, intervalMs: 1700, ...LINGTIANHOU_SWORD },
        domain: { radius: 300, dps: 45, tickMs: 480 },
        summon: { count: 3, type: 'sword_disciple', maxAlive: 12, intervalMs: 4600 },
      },
    ],
  },
};

/** 出场时刻升序,供时间表调度 */
export const BOSS_SCHEDULE = Object.values(BOSSES).sort((a, b) => a.atSeconds - b.atSeconds);

export function validateBossSchedule(): string[] {
  const bad: string[] = [];
  const seen = new Set<number>();
  for (const b of Object.values(BOSSES)) {
    if (seen.has(b.atSeconds)) bad.push(`首领时刻冲突:${b.name} 与另一只同为 ${b.atSeconds}s`);
    seen.add(b.atSeconds);
    if (b.phases.length === 0) bad.push(`${b.name} 没有任何阶段`);
    if (b.rebirthAtHp !== undefined && (b.rebirthPhase === undefined || b.rebirthPhase >= b.phases.length)) {
      bad.push(`${b.name} 的重生阶段下标越界`);
    }
    for (const p of b.phases) {
      // 环形羽爆必须真的成「圈」:片数太少会变成「一圈超长扇形」,缝隙大得毫无压力
      if (p.nova && p.nova.count < 8) {
        bad.push(`${b.name} 的「${p.name}」环形羽爆只有 ${p.nova.count} 片 —— 不构成一圈(至少 8)`);
      }
      // 剑域的 tick 必须**明显短于玩家 600ms 无敌帧**。
      // 等于或长于它,玩家就会在两次 tick 之间反复进出无敌,
      // 配表上的 dps 变成随机数 —— 这是那次「一半 tick 被吞掉」的直接教训。
      if (p.domain && p.domain.tickMs > 550) {
        bad.push(`${b.name} 的「${p.name}」剑域 tick 为 ${p.domain.tickMs}ms —— 超过玩家无敌帧(600ms)前会丢伤害,建议 ≤550`);
      }
      // 召唤物必须真的能刷出来(键名对得上 ENEMIES)
      if (p.summon && p.summon.count > p.summon.maxAlive) {
        bad.push(`${b.name} 的「${p.name}」一次召 ${p.summon.count} 名但上限只有 ${p.summon.maxAlive} —— 永远召不满`);
      }
    }
  }
  return bad;
}