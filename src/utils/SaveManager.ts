/**
 * 存档管理 (localStorage)
 */
const KEY_BEST_TIME = 'xianni:bestTime';
const KEY_BEST_KILLS = 'xianni:bestKills';
const KEY_RUNS = 'xianni:totalRuns';

export const SaveManager = {
  getBestTime(): number {
    return Number(localStorage.getItem(KEY_BEST_TIME) || 0);
  },
  setBestTime(v: number): void {
    localStorage.setItem(KEY_BEST_TIME, String(v));
  },
  getBestKills(): number {
    return Number(localStorage.getItem(KEY_BEST_KILLS) || 0);
  },
  setBestKills(v: number): void {
    localStorage.setItem(KEY_BEST_KILLS, String(v));
  },
  getTotalRuns(): number {
    return Number(localStorage.getItem(KEY_RUNS) || 0);
  },
  incTotalRuns(): void {
    localStorage.setItem(KEY_RUNS, String(this.getTotalRuns() + 1));
  },
  reset(): void {
    localStorage.removeItem(KEY_BEST_TIME);
    localStorage.removeItem(KEY_BEST_KILLS);
    localStorage.removeItem(KEY_RUNS);
  },
};
