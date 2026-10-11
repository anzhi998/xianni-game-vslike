/**
 * 修为系统 —— 灵气 / 等级 / 升一级所需
 *
 * 刻意保持「笨」:只管三个数字,不知道法术、遗物、地图、Boss 的存在。
 * 悟道卡池由 GameScene 构建 —— 只有它同时握有全部系统。
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

  constructor(scene: Phaser.Scene, _player: Player) {
    this.scene = scene;
    this.xpToNext = this.computeXpToNext(this.level);
  }

  /**
   * 升到下一级所需灵气。
   *
   * 曲线 = 0.9 × L^1.75,取整到 5 的倍数。
   *
   * ⚠️ 这是全局最重要的调参数字。指数是「每级所需增长多快」的唯一旋钮:
   *    指数越大,前期快、后期慢(70 级才拿到),指数越小则一局能到更高等级。
   *    《build设计》3.2 给的表与这个公式逐点吻合(2 级 5、20 级 170、80 级 1925),
   *    并且写明一局 30 分钟常态落在 60–75 级。
   *    若实测一局等级偏低,先下调指数(1.75 → 1.65),**不要靠加槽位解决** ——
   *    加槽位会让「70 级够填满 + 叠满 + 融合」这条槽位经济学彻底失去参考价值。
   */
  private computeXpToNext(level: number): number {
    const raw = 0.9 * Math.pow(level, 1.75);
    return Math.max(5, Math.round(raw / 5) * 5);
  }

  getXp(): number {
    return this.xp;
  }
  getXpToNext(): number {
    return this.xpToNext;
  }
  getProgress(): number {
    return this.xp / this.xpToNext;
  }

  add(amount: number): { leveledUp: boolean } {
    this.xp += amount;
    let leveledUp = false;
    if (this.xp >= this.xpToNext) {
      this.xp -= this.xpToNext;
      this.level++;
      this.xpToNext = this.computeXpToNext(this.level);
      leveledUp = true;
      this.scene.events.emit(GameEvents.PLAYER_LEVEL_UP, this.level);
      this.onLevelUp?.();
      // 每次只升一级:onLevelUp 会 pauseGame() 并 launch UpgradeScene,
      // 对已运行场景再次 launch 是空操作,继续循环会把多出来的等级白白吞掉。
      // 余下的修为保留在 xp 里,选完卡之后 GameScene 会补升。
    }
    return { leveledUp };
  }

  /** 调试用:直接把等级设到某个值,并把修为补到该级起点 */
  debugSetLevel(level: number): void {
    this.level = Math.max(1, level);
    this.xp = 0;
    this.xpToNext = this.computeXpToNext(this.level);
  }
}