import Phaser from 'phaser';
import { WORLD_WIDTH, WORLD_HEIGHT } from '../config/GameConfig';
import {
  FIRST_AT_SECONDS, mechanismIntervalAt, rollMechanism, BAIT, MIMIC_DIST,
} from '../config/MechanismConfig';
import type { MechanismDef } from '../config/MechanismConfig';

/**
 * 机制怪投放系统 —— 什么时候投、投哪一只
 *
 * 与 SpawnSystem 的分工:那个系统负责「日常的怪潮」(构成 + 密度),
 * 这个系统负责「例外」(一次一只、按时间间隔、且不连续重复)。
 * 两者唯一的耦合是机制怪也借用同一个敌人池。
 *
 * 三种投放形态各自落地的位置不同,所以这里只做决策与定位,
 * 真正的生成交给 GameScene 注入的三个回调 —— 屏幕级的地形事件(血海)
 * 根本不是「一只怪」,它不该被迫长成敌人的形状
 */
export interface MechanismDeps {
  getPlayer: () => { x: number; y: number };
  getRealmIndex: () => number;
  /** 从敌人池里生成一只机制怪 */
  spawnEnemy: (id: string, x: number, y: number) => void;
  /** 在地面放一件掉落物:幻饵或伪宝匣 */
  spawnPickup: (kind: 'bait' | 'mimic', x: number, y: number) => void;
  /** 升起血海 */
  summonTide: () => void;
}

export class MechanismSystem {
  private deps: MechanismDeps;
  private nextAt = FIRST_AT_SECONDS;
  /** 上一次投的是哪一只 —— 不允许连续重复 */
  private lastId = '';
  /** 诊断用:最近一次投放的 id */
  public lastFiredId = '';

  constructor(deps: MechanismDeps) {
    this.deps = deps;
  }

  update(seconds: number): void {
    if (seconds < this.nextAt) return;
    this.nextAt = seconds + mechanismIntervalAt(seconds);
    this.fire();
  }

  /**
   * 立刻投放一次,不动时间表(调试键用)。
   *
   * 与 update 共用同一段投放逻辑 —— 调试键若自己拼一遍参数,
   * 验证过的就不是线上那份逻辑了
   */
  forceFire(): string {
    const def = this.fire();
    return def ? def.id : '';
  }

  private fire(): MechanismDef | null {
    const def = rollMechanism(this.deps.getRealmIndex(), this.lastId);
    if (!def) return null;
    this.lastId = def.id;
    this.lastFiredId = def.id;
    this.dispatch(def);
    return def;
  }

  private dispatch(def: MechanismDef): void {
    const p = this.deps.getPlayer();
    switch (def.kind) {
      case 'enemy': {
        const [x, y] = this.ringPoint(p.x, p.y, 700, 1000);
        this.deps.spawnEnemy(def.id, x, y);
        return;
      }
      case 'bait': {
        // 幻饵必须落在玩家**够得着**的地方:它惩罚的是「低头捡钱」,
        // 扔在屏幕外就只是一块没人踩的地雷
        for (let i = 0; i < BAIT.count; i++) {
          const [x, y] = this.ringPoint(p.x, p.y, BAIT.minDist, BAIT.maxDist);
          this.deps.spawnPickup('bait', x, y);
        }
        return;
      }
      case 'mimic': {
        const [x, y] = this.ringPoint(p.x, p.y, MIMIC_DIST.min, MIMIC_DIST.max);
        this.deps.spawnPickup('mimic', x, y);
        return;
      }
      case 'tide': {
        this.deps.summonTide();
        return;
      }
    }
  }

  /** 玩家周围环上的一个随机点,钳在世界内 */
  private ringPoint(px: number, py: number, min: number, max: number): [number, number] {
    const a = Math.random() * Math.PI * 2;
    const d = min + Math.random() * (max - min);
    return [
      Phaser.Math.Clamp(px + Math.cos(a) * d, 40, WORLD_WIDTH - 40),
      Phaser.Math.Clamp(py + Math.sin(a) * d, 40, WORLD_HEIGHT - 40),
    ];
  }
}
