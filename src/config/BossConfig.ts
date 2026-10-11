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
 */

export interface BossFanDef {
  /** 一次射出几片火羽 */
  count: number;
  /** 总张角(弧度) */
  spread: number;
  damage: number;
  speed: number;
  /** 出招间隔(毫秒) */
  intervalMs: number;
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

export interface BossPhaseDef {
  name: string;
  /** 血量比例高于这个值时处于该阶段 */
  hpAbove: number;
  /** 移动速度(px/s) */
  speed: number;
  /** 火羽扇 */
  fan?: BossFanDef;
  /** 火雨:落点预警圈 */
  rain?: BossRainDef;
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

export const BOSSES: Record<string, BossDef> = {

  /**
   * 朱雀(成体) —— 朱雀星守护神,10:00
   *
   * 三阶段,每阶段换一个**走位习惯**:
   *   一阶 火羽扇   —— 扇形弹道,逼你朝扇形缺口走
   *   二阶 火羽 + 火雨 —— 落点预警圈,逼你在「躲扇形」与「躲地圈」之间做二维选择
   *   三阶 浴火重生 —— 半血回满一次并狂暴,前两招同时更密
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
        fan: { count: 7, spread: 1.5, damage: 16, speed: 260, intervalMs: 2200 },
      },
      {
        name: '火雨', hpAbove: 0.3, speed: 62, tempo: 1,
        fan: { count: 9, spread: 2.0, damage: 18, speed: 280, intervalMs: 1900 },
        rain: { count: 3, warnMs: 1100, radius: 86, damage: 22, intervalMs: 2600 },
      },
      {
        name: '浴火重生', hpAbove: 0, speed: 96, tempo: 1.45,
        fan: { count: 11, spread: 2.4, damage: 20, speed: 320, intervalMs: 1500 },
        rain: { count: 4, warnMs: 900, radius: 92, damage: 24, intervalMs: 2000 },
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
  }
  return bad;
}