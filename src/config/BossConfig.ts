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

/** 司徒南的剑气 —— 与「斩罗决」同源的青白剑芒,但更宽更长 */
const SITUNAN_SWORD: BossShotStyle = {
  texture: 'proj_boss_sword',
  color: 0x88ccff,
  spin: 0,
  trail: false,
};

/** 天运子命数指的落点圈颜色 —— 与它的签文同源的金,但更沉 */
const TIANYUNZI_FINGER_COLOR = 0xd8b860;

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
   * 三阶段逐步收紧:命数点名更多、闪现更频、签文扇更密、落指从一根到三根。
   *
   * 血量 10000(写在 ENEMIES.tianyunzi):20:00 玩家单体 DPS 约 250–300,
   * 刨去闪现无敌的窗口,全程约 40 秒 —— 比朱雀略长是刻意的:
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
      },
    ],
  },

  /**
   * 司徒南·试炼幻影 —— 15:00(900s),王林挚友/前辈残影
   *
   * 文档定位:剑阵围杀 + 分身戏耍(低伤高频率)。
   * 设计**专攻清小怪的 Builds** —— 15:00 玩家法术面板通常已有 3-4 门
   * 群攻(剑阵/火海/五雷),这些法术只有"怪扎堆"时才有输出;
   * 司徒南的剑阵**强制把怪向场心吸**且**自己分裂 3 个分身分散站位**,
   * 群攻打到的怪数被拆散,等于**暗中削掉群攻 Build 的有效输出**。
   * 物理 Build(寂灭指/化魔指/斩罗决)反而舒服。
   *
   * 数值(9000)介于朱雀(4000)与天运子(10000)之间 —— 第一次见 Boss 的玩家
   * 不能被秒杀(伤害=18,弱于朱雀),但拖长=剑阵越吸越紧,主动出招。
   */
  situnan: {
    id: 'situnan', name: '司徒南·试炼幻影',
    atSeconds: 900,
    drops: [
      { kind: 'chest', payload: 'gold' },
      { kind: 'heal' },
    ],
    phases: [
      {
        name: '剑阵·初动', hpAbove: 0.55, speed: 70, tempo: 1,
        fan: { count: 4, spread: 1.2, damage: 14, speed: 260, intervalMs: 2400, ...SITUNAN_SWORD },
      },
      {
        name: '剑阵·合围', hpAbove: 0.25, speed: 78, tempo: 1,
        fan: { count: 6, spread: 1.4, damage: 16, speed: 280, intervalMs: 2000, ...SITUNAN_SWORD },
      },
      {
        name: '剑阵·分身', hpAbove: 0, speed: 92, tempo: 1.15,
        fan: { count: 8, spread: 1.6, damage: 18, speed: 300, intervalMs: 1700, ...SITUNAN_SWORD },
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
    }
  }
  return bad;
}