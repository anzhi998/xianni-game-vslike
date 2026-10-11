import type Phaser from 'phaser';
import type { WeaponSystem } from './WeaponSystem';
import type { RelicSystem } from './RelicSystem';
import { EVOLUTIONS, findEvolution } from '../config/EvolutionConfig';
import { MAX_RELIC_LEVEL } from '../config/RelicConfig';
import { MAX_SPELL_LEVEL } from '../config/SpellConfig';
import { GameEvents } from '../types';
import type { EvolutionDef } from '../config/EvolutionConfig';

/** 某条进化链当前的状态 */
export interface EvolutionStatus {
  def: EvolutionDef;
  /** 主神通是否已满 8 级 */
  spellOk: boolean;
  /** 专属遗物是否已满 5 级 */
  relicOk: boolean;
  /** 两项都满足 —— 也就是「下一次开宝匣就会融合」 */
  ready: boolean;
}

/**
 * 道法融合系统 —— 只负责「条件判定」与「换 id + 吞遗物」这一下结算
 *
 * ## 为什么条件达成之后还要再开一次宝匣
 *
 * 设计书 3.5 的规则 2:条件达成只提示「道机已至」,真正的融合发生在**下一次
 * 打开任意宝箱**时,并且当次第 1 个选项必定是融合、且**不占奖励次数**。
 * 这一条让融合保留了「开箱」的仪式感,而不是一个后台自动结算。
 * 本类因此只回答一个问题:现在有哪些链 ready。
 */
export class EvolutionSystem {
  private scene: Phaser.Scene;
  private weaponSystem: WeaponSystem;
  private relicSystem: RelicSystem;
  /** 本局已经融合过的链条。已融合的不再重复提示 */
  private evolvedBases = new Set<string>();
  public chestsOpened = 0;

  constructor(scene: Phaser.Scene, weaponSystem: WeaponSystem, relicSystem: RelicSystem) {
    this.scene = scene;
    this.weaponSystem = weaponSystem;
    this.relicSystem = relicSystem;
  }

  /** 一条链的状态。没持有它的主神通时返回 null */
  check(baseId: string): EvolutionStatus | null {
    const def = findEvolution(baseId);
    if (!def) return null;
    if (this.evolvedBases.has(baseId)) return null;
    const spellOk = this.weaponSystem.getLevel(baseId) >= MAX_SPELL_LEVEL;
    const relicOk = this.relicSystem.getLevel(def.keyRelic) >= MAX_RELIC_LEVEL;
    return { def, spellOk, relicOk, ready: spellOk && relicOk };
  }

  /** 当前所有满足条件的链(按法术栏顺序) */
  readyEvolutions(): EvolutionStatus[] {
    const out: EvolutionStatus[] = [];
    for (const s of this.weaponSystem.getSpells()) {
      const st = this.check(s.id);
      if (st?.ready) out.push(st);
    }
    return out;
  }

  hasPendingEvolution(): boolean {
    return this.readyEvolutions().length > 0;
  }

  /**
   * 该专属遗物的进化链是否已经融合完成。
   *
   * 融合会把专属遗物**吸收掉**(腾出遗物槽),所以 relicSystem.has() 从此返回 false ——
   * 只看那一个判断,被吞掉的钥匙会重新出现在悟道池里。而它对进化形态**毫无作用**
   * (RelicSystem 的专属判定是 exclusive === spellId,而法术 id 已经变成进化形态了),
   * 于是玩家花一次三选一换来一件什么都不做的遗物。
   */
  isRelicSpent(relicId: string): boolean {
    const def = EVOLUTIONS.find((e) => e.keyRelic === relicId);
    return !!def && this.evolvedBases.has(def.base);
  }

  /**
   * 结算一条融合。
   *
   * 三件事一次做完:换 id、吞掉专属遗物(腾出一个遗物槽)、发事件。
   * 吞遗物是进化「最舒服的一下」—— 两条成本同时兑现,玩家立刻多一个位置补通用遗物。
   *
   * @returns 融合后的名称;条件不满足时返回 null
   */
  evolve(baseId: string): string | null {
    const st = this.check(baseId);
    if (!st?.ready) return null;
    const name = this.weaponSystem.evolve(baseId, st.def.evolved);
    if (!name) return null;
    this.relicSystem.absorb(st.def.keyRelic);
    this.evolvedBases.add(baseId);
    this.scene.events.emit(GameEvents.SPELL_EVOLVED, st.def.evolved, name);
    return name;
  }

  /** 调试用:跳过条件检查直接标记为已融合 */
  debugMarkEvolved(baseId: string): void {
    this.evolvedBases.add(baseId);
  }
}