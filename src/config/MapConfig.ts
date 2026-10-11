/**
 * 地图表 —— 目前只落地一张朱雀星,机制按配置走,加图不改代码
 *
 * ## 为什么地图要做成配置而不是一段 if
 *
 * 《地图设计》第二节列了六张图,每张给玩家一个**环境机制**(灵脉地热 / 魔气侵蚀 /
 * 星力潮汐 / 雷劫洗礼 / 古神威压 / 定身·时停)。这些机制的形状差别很大,
 * 现在只有「定时在场上刷一个带预警圈的伤害区」这一种被实现了 ——
 * 其余五种需要各自的系统(持续掉血上限、周期性增减益、点名落雷)。
 * 所以这里声明的是一个**机制描述**,由 HazardSystem 解释执行;
 * 新增一种机制形态时加一个 kind 分支,而不是在 update() 里堆 if。
 */

export interface HazardDef {
  id: string;
  name: string;
  kind: 'vent';
  /** 每隔多久喷发一次(秒) */
  intervalSec: number;
  /** 预警圈时长(秒)。给玩家的反应窗口 */
  warnSec: number;
  /** 喷发持续(秒) */
  eruptSec: number;
  /** 喷发期间每 tick 的伤害 */
  damage: number;
  /** tick 间隔(毫秒) */
  tickMs: number;
  /** 火柱半径(像素) */
  radius: number;
  color: number;
}

export interface MapDef {
  id: string;
  name: string;
  /** 世界尺寸(像素) */
  worldWidth: number;
  worldHeight: number;
  /** 相机与物理边界之外的可视留白 */
  ground: {
    base: number;
    /** 散布的斑块:[颜色, 概率, 尺寸] */
    specks: Array<[number, number, number]>;
    /** 几条浅色「路」区域 */
    roads: Array<[number, number, number, number]>;
    border: number;
  };
  /** 环境机制。null = 无 */
  hazard: HazardDef | null;
}

export const MAPS: Record<string, MapDef> = {

  /**
   * 朱雀星 —— 起始图,凡间修真星
   *
   * 环境机制「灵脉地热」:地脉随机喷发火柱,先给一个预警圈再喷发。
   * 它不造成「必须绕开某个东西」的伤害,而是**逼你在空地与怪群之间选一个站位**——
   * 这正是新手图该教的东西(设计总原则第三条)。
   */
  zhuque: {
    id: 'zhuque', name: '朱雀星',
    worldWidth: 3200, worldHeight: 3200,
    ground: {
      base: 0x4a2620,
      specks: [
        [0x6b3524, 0.50, 2],
        [0x341b16, 0.20, 1],
        [0x8a4526, 0.15, 3],
        [0x2a1412, 0.15, 4],
      ],
      roads: [
        [200, 200, 600, 200],
        [2400, 400, 700, 200],
        [1300, 2600, 600, 250],
      ],
      border: 0x241210,
    },
    hazard: {
      id: 'lingmai',
      name: '灵脉地热',
      kind: 'vent',
      // 8 秒一次。开局第一个 3 秒后开始,让玩家先熟悉基础手感
      intervalSec: 8,
      warnSec: 1.2,
      eruptSec: 1.6,
      damage: 14,
      tickMs: 500,
      radius: 78,
      color: 0xff5522,
    },
  },
};

export const DEFAULT_MAP_ID = 'zhuque';

export function getMap(id: string): MapDef {
  return MAPS[id] ?? MAPS[DEFAULT_MAP_ID];
}