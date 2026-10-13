/**
 * DPS 统计 —— 调参工具,不是玩家功能。
 *
 * 挂在唯一伤害入口(GameScene.applyDamageToEnemy)上,按「伤害来源」
 * (神通 id)分桶:每来源 10 个秒桶的环形缓冲 + 全程累计。
 * 窗口 DPS = 近 10s 桶和 ÷ 10;占比 = 来源累计 ÷ 全程总伤。
 *
 * 写入 O(1)、零逐帧分配 —— 混战中每发伤害都会调它,不能成为 GC 源。
 * 统计的是结算完护甲/暴击/感电之后的**真实伤害**,不是面板数值。
 */

export interface MeterRow {
  id: string;
  /** 近 WINDOW_SEC 秒的每秒伤害 */
  dps: number;
  /** 全程累计伤害 */
  total: number;
  /** 占全程总伤的比例 0~1 */
  share: number;
}

interface SourceStat {
  /** buckets 对应的最新秒下标(环形缓冲的锚) */
  base: number;
  buckets: number[];
  total: number;
}

export class DamageMeter {
  /** 滚动窗口长度(秒)。10s:短到看得出「这套 build 现在什么水平」,长到 AoE 空窗不会归零 */
  static readonly WINDOW_SEC = 10;

  private per = new Map<string, SourceStat>();
  private grand = 0;

  record(id: string, amount: number, nowMs: number): void {
    const sec = Math.floor(nowMs / 1000);
    let s = this.per.get(id);
    if (!s) {
      s = { base: sec, buckets: new Array(DamageMeter.WINDOW_SEC).fill(0), total: 0 };
      this.per.set(id, s);
    }
    // 时间跨过桶:把新窗口覆盖到的旧桶清零再落笔,否则上周期的伤害会混进这周期
    const shift = sec - s.base;
    if (shift >= DamageMeter.WINDOW_SEC) {
      s.buckets.fill(0);
      s.base = sec;
    } else if (shift > 0) {
      for (let k = 1; k <= shift; k++) s.buckets[(s.base + k) % DamageMeter.WINDOW_SEC] = 0;
      s.base = sec;
    }
    s.buckets[sec % DamageMeter.WINDOW_SEC] += amount;
    s.total += amount;
    this.grand += amount;
  }

  /** 按全程累计降序。窗口和只随 record 变化 —— 游戏暂停时读数自然冻结 */
  snapshot(): MeterRow[] {
    const rows: MeterRow[] = [];
    for (const [id, s] of this.per) {
      let sum = 0;
      for (const b of s.buckets) sum += b;
      rows.push({
        id,
        dps: sum / DamageMeter.WINDOW_SEC,
        total: s.total,
        share: this.grand > 0 ? s.total / this.grand : 0,
      });
    }
    return rows.sort((a, b) => b.total - a.total);
  }
}
