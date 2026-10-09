/**
 * 进化系统 —— 设计书的核心公式
 *
 *   进化 = 基础神通满 8 重 + 对应钥匙法宝在身 + 拾取 10 分钟后掉落的秘境宝匣
 *
 * 三者缺一不可。这套约束是全局最有分量的取舍:
 *   - 只有满 8 重 → 逼你在前期就锁定要养哪一门,而不是广撒网
 *   - 只有钥匙在手 → 法宝从「属性配件」变成「开锁工具」,栏位开始有战略价值
 *   - 只有宝匣 → 给了 10:00 之后一个明确的追赶节奏点
 *
 * 为什么单独成系统而不是塞进 ArtifactSystem:
 * 进化要同时读三处的状态(神通重数 / 法宝栏 / 玩家手上的宝匣),
 * 任何一个单独的系统都看不到全貌。参照 CLAUDE.md 里 RealmSystem 与
 * XPSystem 的分法 —— 状态各归各家,需要全局判断时由第三方汇总。
 */
import Phaser from 'phaser';
import type { WeaponSystem } from './WeaponSystem';
import type { ArtifactSystem } from './ArtifactSystem';
import { EVOLUTIONS, EVOLUTION_MUL, ULTIMATE_EVOLUTION_MUL, findEvolution } from '../config/EvolutionConfig';
import type { EvolutionDef } from '../config/EvolutionConfig';
import { GameEvents } from '../types';

/** 一门神通的进化条件核验结果 */
export interface EvolutionCheck {
  def: EvolutionDef;
  /** 神通是否已持有且满 8 重 */
  hasMaxRitual: boolean;
  /** 钥匙是否全部在身 */
  hasKeys: boolean;
  /** 三条件里还差什么(给 UI 看的短文案) */
  missing: string;
}

/** 三条件齐备 */
export function isEvoReady(c: EvolutionCheck): boolean {
  return c.hasMaxRitual && c.hasKeys;
}

export class EvolutionSystem {
  private scene: Phaser.Scene;
  private weaponSystem: WeaponSystem;
  private artifactSystem: ArtifactSystem;

  /**
 * 宝匣最早掉落时刻(ms)。
 *
 * 设计书规定 10:00 —— 那是平衡值,不是技术值。
 * ⚠️ 当前是临时压到 20 秒,方便验证「满 8 重 + 钥匙 + 宝匣 → 进化」这条链路。
 *    验证完请改回 600_000。
 */
  static readonly CHEST_UNLOCK_MS = 20_000;

  /** 玩家手上已开过的宝匣数(诊断用) */
  public chestsOpened = 0;

  constructor(scene: Phaser.Scene, weaponSystem: WeaponSystem, artifactSystem: ArtifactSystem) {
    this.scene = scene;
    this.weaponSystem = weaponSystem;
    this.artifactSystem = artifactSystem;
  }

  /** 宝匣是否已到掉落时间 */
  isChestAvailable(elapsed: number): boolean {
    return elapsed >= EvolutionSystem.CHEST_UNLOCK_MS;
  }

  /** 核验某门神通的进化条件 */
  check(baseId: string): EvolutionCheck | null {
    const def = findEvolution(baseId);
    if (!def) return null;

    const hasMaxRitual = this.weaponSystem.isMaxRitual(baseId);
    const hasKeys = def.keys.every((k) => this.artifactSystem.has(k));

    const miss: string[] = [];
    if (!hasMaxRitual) {
      const cur = this.weaponSystem.getRitual(baseId);
      miss.push(cur === 0 ? '尚未掌握' : `需满 8 重(当前 ${cur})`);
    }
    if (!hasKeys) miss.push('缺少钥匙法宝');

    return { def, hasMaxRitual, hasKeys, missing: miss.join(' · ') };
  }

  /**
   * 当前有哪些神通可以立刻进化。
   *
   * 宝匣面板据此只显示「能用的进化」,而不是让玩家开出一堆没反应的匣子 ——
   * 这正是设计书说的「宝匣永远优先结算进化而非金币」。
   */
  readyEvolutions(): EvolutionCheck[] {
    const out: EvolutionCheck[] = [];
    for (const def of EVOLUTIONS) {
      const c = this.check(def.base);
      if (c && isEvoReady(c)) out.push(c);
    }
    return out;
  }

  /** 玩家是否持有至少一件宝匣(用于 UI 提示「可进化了」) */
  hasPendingEvolution(): boolean {
    return this.readyEvolutions().length > 0;
  }

  /**
   * 结算一次进化。调用方负责先确认条件齐备。
   * @returns 进化后的神通名;失败返回 null
   */
  evolve(baseId: string): string | null {
    const c = this.check(baseId);
    if (!c || !isEvoReady(c)) return null;

    const mul = c.def.ultimate ? ULTIMATE_EVOLUTION_MUL : EVOLUTION_MUL;
    if (!this.weaponSystem.evolve(baseId, c.def.evolved, mul)) return null;

    this.scene.events.emit(GameEvents.SPELL_EVOLVED, c.def.evolved, c.def.evolvedName);
    return c.def.evolvedName;
  }
}
