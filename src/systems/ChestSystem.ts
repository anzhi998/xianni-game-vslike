/**
 * 洞府宝箱 —— 把「开箱」变成一串排队中的悟道三选一
 *
 * 设计书 3.4:木匣 1 次、玉盒 3 次、金匮 5 次。开箱不是弹一个结算框,
 * 而是**排 N 次队**——一次击杀的余韵被拉长成 N 个决策,这正是「攒匣子开」
 * 在手感上的价值所在。
 *
 * 本类只管计数。队列怎么消费(卡池、融合插队)由 GameScene 决定,
 * 因为只有它同时握有卡池与进化系统。
 */

export type ChestQuality = 'wood' | 'jade' | 'gold';

export const CHEST_QUALITY: Record<ChestQuality, { name: string; picks: number }> = {
  wood: { name: '木匣', picks: 1 },
  jade: { name: '玉盒', picks: 3 },
  gold: { name: '金匮', picks: 5 },
};

export class ChestSystem {
  /** 还没花掉的悟道次数 */
  private pending = 0;
  public chestsOpened = 0;

  /**
   * 开一件匣子,把次数排进队列。
   * @returns 这次排进去的次数(用于横幅文案)
   */
  open(quality: ChestQuality): number {
    const n = CHEST_QUALITY[quality]?.picks ?? 1;
    this.pending += n;
    this.chestsOpened++;
    return n;
  }

  /** 取一次悟道。没有剩余时返回 false —— GameScene 据此结束排队循环 */
  takeOne(): boolean {
    if (this.pending <= 0) return false;
    this.pending--;
    return true;
  }

  get remaining(): number {
    return this.pending;
  }

  /** 调试用:直接塞 n 次悟道 */
  debugGrant(n: number): void {
    this.pending += n;
  }
}