/**
 * 境界系统
 *
 * 职责边界:XPSystem 只管「修为够不够」,完全不知道境界的存在;
 * RealmSystem 管境界、突破道具、槽位,以及「现在允不允许升级」这个门控。
 * 门控通过 canLevelUp 谓词注入 XPSystem,避免把境界概念塞进 XPSystem 内部。
 */
import type Phaser from 'phaser';
import type { Player } from '../entities/Player';
import type { WeaponSystem } from './WeaponSystem';
import type { ArtifactSystem } from './ArtifactSystem';
import { REALMS } from '../config/RealmConfig';
import type { MajorRealmDef } from '../config/RealmConfig';
import { GameEvents } from '../types';

export class RealmSystem {
  /** REALMS 的下标,0 = 炼气期 */
  public majorIndex = 0;
  /** 当前大境界内的小境界层数,突破大境界时归零 */
  public minorLevel = 0;
  /** 已持有的突破道具 id -> 数量 */
  public keyItems: Record<string, number> = {};
  /** 「开辟法位」卡提供的额外槽位 */
  public bonusSpellSlots = 0;

  /** 突破大境界时的回调,由 GameScene 注入(用于播放演出、刷新 HUD) */
  public onBreakthrough: (realm: MajorRealmDef) => void = () => {};

  private scene: Phaser.Scene;
  private player: Player;
  private weaponSystem: WeaponSystem;
  private artifactSystem: ArtifactSystem;

  constructor(
    scene: Phaser.Scene,
    player: Player,
    weaponSystem: WeaponSystem,
    artifactSystem: ArtifactSystem,
  ) {
    this.scene = scene;
    this.player = player;
    this.weaponSystem = weaponSystem;
    this.artifactSystem = artifactSystem;
    this.artifactSystem.setSlotCap(this.current.artifactSlots);
  }

  get current(): MajorRealmDef {
    return REALMS[this.majorIndex];
  }

  get next(): MajorRealmDef | null {
    return REALMS[this.majorIndex + 1] ?? null;
  }

  /** 是否已到最高境界 */
  get isMaxRealm(): boolean {
    return this.next === null;
  }

  getDisplayName(): string {
    return `${this.current.name}·${this.getMinorName()}`;
  }

  getMinorName(): string {
    // 每个大境界有自己的层数命名(炼气是「一层~十层」,其余是「初期~圆满」)
    const names = this.current.minorNames;
    return names[this.minorLevel] ?? '';
  }

  /** 法术槽位上限 = 境界基础值 + 卡加成(硬上限为 基础 + 2) */
  getSpellSlots(): number {
    const base = this.current.spellSlots;
    return Math.min(base + 2, base + this.bonusSpellSlots);
  }

  /** 当前境界内已用掉的小境界层数 */
  getMinorProgress(): number {
    return this.minorLevel;
  }

  hasKeyItem(id: string): boolean {
    return (this.keyItems[id] ?? 0) > 0;
  }

  /**
   * 获得突破道具。
   * @returns true = 收下了;false = 已经有一份了(调用方转化为修为)
   */
  addKeyItem(id: string): boolean {
    if (!id) return true;               // 首个境界无需求道具,不算失败
    if (this.hasKeyItem(id)) return false;
    this.keyItems[id] = 1;
    this.scene.events.emit(GameEvents.KEYITEM_OBTAINED, id);
    return true;
  }

  private consumeKeyItem(id: string): void {
    if (!id) return;
    if ((this.keyItems[id] ?? 0) > 0) {
      this.keyItems[id]--;
      if (this.keyItems[id] <= 0) delete this.keyItems[id];
    }
  }

  /** 突破大境界所需的道具名,已在最高境界时返回 null */
  getRequiredKeyItemName(): string | null {
    return this.next ? this.next.keyItemName || null : null;
  }

  /**
   * 升级门控,注入给 XPSystem。
   * 小境界内直接放行;跨大境界则必须持有对应道具。
   */
  canAdvanceLevel(): boolean {
    const next = this.next;
    if (!next) return true;                                   // 最高境界:无限升级
    if (this.minorLevel + 1 < this.current.minorSpan) return true;  // 普通小境界
    return this.hasKeyItem(next.keyItemId);                    // 大境界需道具
  }

  /** 修为已满但卡在道具上 */
  get isBlocked(): boolean {
    return !this.canAdvanceLevel();
  }

  /**
   * 由 XPSystem.onLevelUp 调用。注意此时 level 已经自增过了。
   * 区分这次升级是「小境界推进」还是「大境界突破」。
   */
  applyLevelUp(): boolean {
    // 小境界推进
    if (this.minorLevel + 1 < this.current.minorSpan) {
      this.minorLevel++;
      return false;
    }

    // 大境界突破
    const next = this.next;
    if (!next) {
      // 已到最高境界,继续涨小境界层数(仅用于展示)
      this.minorLevel++;
      return false;
    }

    this.consumeKeyItem(next.keyItemId);
    this.majorIndex++;
    this.minorLevel = 0;

    const r = this.current;
    this.player.maxHealth = Math.round(this.player.maxHealth * r.hpMul);
    this.player.health = this.player.maxHealth;
    this.player.damageMul *= r.damageMul;
    this.player.moveSpeedMul *= r.moveSpeedMul;

    this.artifactSystem.setSlotCap(r.artifactSlots);
    this.weaponSystem.resetCooldowns();

    this.scene.events.emit(GameEvents.BREAKTHROUGH, r.shortName);
    this.onBreakthrough(r);
    return true;
  }
}