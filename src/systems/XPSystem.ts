/**
 * 修为系统
 *
 * 刻意保持「笨」:只管 xp / level / xpToNext,完全不知道境界的存在。
 * 「现在能不能升级」这个判断由 canLevelUp 谓词注入,默认永远为真。
 */
import type { Player } from '../entities/Player';
import { GameEvents } from '../types';
import Phaser from 'phaser';

export class XPSystem {
  private scene: Phaser.Scene;
  private xp = 0;
  public level = 1;
  private xpToNext: number;
  public onLevelUp: () => void = () => {};

  /** 升级门控。由 RealmSystem 注入,默认放行 */
  private canLevelUp: () => boolean;

  constructor(scene: Phaser.Scene, _player: Player, canLevelUp: () => boolean = () => true) {
    this.scene = scene;
    this.canLevelUp = canLevelUp;
    this.xpToNext = this.computeXpToNext(this.level);
  }

  /**
   * 升到下一级所需的修为。
   *
   * ⚠️ 这是全局最重要的调参数字。
   *
   * 系数 4 对应《仙逆》原著的七境界体系(凝气十五层 + 六境各五层):
   * 凝气期约 4.5 分钟走完,满问鼎约 13.2 分钟。
   * 换成七境界之前的六境时是 6,但那套境界更短,系数需要跟着调。
   */
  private computeXpToNext(level: number): number {
    return Math.floor(12 + level * 4);
  }

  getXp(): number {
    return this.xp;
  }
  getXpToNext(): number {
    return this.xpToNext;
  }
  /** 可能 > 1(卡在大境界道具门槛上时),HUD 用它把进度条画满 */
  getProgress(): number {
    return this.xp / this.xpToNext;
  }

  add(amount: number): { leveledUp: boolean } {
    this.xp += amount;
    let leveledUp = false;
    while (this.xp >= this.xpToNext) {
      // 门控不放行时保留修为,等玩家拿到道具后下一次拾取自然补升
      if (!this.canLevelUp()) break;

      this.xp -= this.xpToNext;
      this.level++;
      this.xpToNext = this.computeXpToNext(this.level);
      leveledUp = true;
      this.scene.events.emit(GameEvents.PLAYER_LEVEL_UP, this.level);
      this.onLevelUp?.();
      // 每次只升一级:onLevelUp 会 pauseGame() 并 launch UpgradeScene,
      // 对已运行场景再次 launch 是空操作,继续循环会把多出来的等级白白吞掉。
      // 余下的修为保留在 xp 里,选完卡之后下一次拾取会自动补升。
      break;
    }
    return { leveledUp };
  }
}