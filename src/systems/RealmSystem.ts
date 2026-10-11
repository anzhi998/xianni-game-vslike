/**
 * 境界系统 —— 纯粹的身份与增益阶梯
 *
 * ## 它现在只做一件事:在每次升级时把玩家挪到下一个「层」,并在大境界
 * 突破时给一次乘算加成。
 *
 * 旧版它还管突破道具与升级门控(修为满了卡住,要先去捡丹药)。那套被整个删掉了:
 * 《build设计》的成长链是「灵气 → 等级 → 悟道三选一 → 洞府宝箱 → 道法融合」,
 * 里面没有丹药这一环,而升级被卡住会让三选一永远等不来 —— 一个玩家
 * 不知道怎么解开的东西,是设计缺陷而不是难度。
 *
 * 境界阶梯本身留着,理由是它是《仙逆》的身份感:HUD 上从「凝气·三层」
 * 一路涨到「问鼎·初期」,这条可见的曲线本身就在传达进度。
 */
import type Phaser from 'phaser';
import type { Player } from '../entities/Player';
import type { WeaponSystem } from './WeaponSystem';
import { REALMS } from '../config/RealmConfig';
import type { MajorRealmDef } from '../config/RealmConfig';
import { GameEvents } from '../types';

export class RealmSystem {
  /** REALMS 的下标,0 = 凝气期 */
  public majorIndex = 0;
  /** 当前大境界内的小境界层数,突破大境界时归零 */
  public minorLevel = 0;

  /** 突破大境界时的回调,由 GameScene 注入(播横幅、刷 HUD) */
  public onBreakthrough: (realm: MajorRealmDef) => void = () => {};

  /** 累计的境界血量倍率。GameScene 用它和遗物倍率一起算出最大生命 */
  public hpMul = 1;
  /** 累计的境界移速倍率,同上 */
  public speedMul = 1;

  private scene: Phaser.Scene;
  private player: Player;
  private weaponSystem: WeaponSystem;

  constructor(scene: Phaser.Scene, player: Player, weaponSystem: WeaponSystem) {
    this.scene = scene;
    this.player = player;
    this.weaponSystem = weaponSystem;
    // 开局的法位来自凝气期那一行(2 格),不再是写死的常量
    this.weaponSystem.setSlotCap(this.current.spellSlots);
  }

  /** 当前大境界给的法术槽上限 */
  getSpellSlots(): number {
    return this.current.spellSlots;
  }

  get current(): MajorRealmDef {
    return REALMS[this.majorIndex];
  }

  get next(): MajorRealmDef | null {
    return REALMS[this.majorIndex + 1] ?? null;
  }

  get isMaxRealm(): boolean {
    return this.next === null;
  }

  getDisplayName(): string {
    return `${this.current.name}·${this.getMinorName()}`;
  }

  getMinorName(): string {
    const names = this.current.minorNames;
    return names[this.minorLevel] ?? names[names.length - 1] ?? '';
  }

  /** 当前境界内已用掉的小境界层数 */
  getMinorProgress(): number {
    return this.minorLevel;
  }

  /**
   * 由 XPSystem.onLevelUp 调用。注意此时 level 已经自增过了。
   * @returns 这次是不是一次大境界突破(调用方据此选横幅文案)
   */
  applyLevelUp(): boolean {
    if (this.minorLevel + 1 < this.current.minorSpan) {
      this.minorLevel++;
      return false;
    }

    const next = this.next;
    if (!next) {
      // 已到最高境界,继续涨层数(仅用于展示)
      this.minorLevel++;
      return false;
    }

    this.majorIndex++;
    this.minorLevel = 0;

    const r = this.current;
    // ⚠️ 这里**不再直接改 player.maxHealth**:最大生命现在是
    // 「基础 × 境界倍率 × 遗物倍率」的纯函数,由 GameScene.syncPlayerStats 算。
    // 直接乘进 player 会让遗物那份乘算在每次重新计算时被算两遍。
    this.hpMul *= r.hpMul;
    this.speedMul *= r.moveSpeedMul;
    this.player.damageMul *= r.damageMul;
    // 法位随大境界成长 —— 突破到筑基/结丹/元婴/化神各开一格,
    // 这是「越早突破越赚」这条压力线在数值上的唯一落点
    this.weaponSystem.setSlotCap(r.spellSlots);
    this.weaponSystem.resetCooldowns();

    this.scene.events.emit(GameEvents.BREAKTHROUGH, r.shortName);
    this.onBreakthrough(r);
    return true;
  }
}