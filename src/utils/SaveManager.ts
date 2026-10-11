/**
 * 存档管理 (localStorage)
 *
 * ⚠️ 所有读写都必须包在 try/catch 里。
 * `localStorage` 在移动端比想象中脆弱:iOS 无痕模式下访问它直接抛
 * `SecurityError`,空间写满时 `setItem` 抛 `QuotaExceededError`,隐私设置下
 * 还可能整片禁用。这不是「存档功能坏了」这种小问题 —— `getBestTime()` 是在
 * `MainMenuScene.create` 里调用的,一次抛异常就会让**主菜单整个建不起来**,
 * 玩家看到的是一张空白页面,连报错都未必看得见。
 * 所以这里降级成内存:读不到就当新档,写不进就只活在这一次会话里。
 */
const KEY_BEST_TIME = 'xianni:bestTime';
const KEY_BEST_KILLS = 'xianni:bestKills';
const KEY_RUNS = 'xianni:totalRuns';
const KEY_COINS = 'xianni:coins';

/** localStorage 不可用时的兜底。同一会话内自洽,关掉页面就没了 —— 诚实但可玩 */
const memory = new Map<string, string>();

function read(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return memory.get(key) ?? null;
  }
}

function write(key: string, value: string): void {
  memory.set(key, value);
  try {
    localStorage.setItem(key, value);
  } catch {
    /* 只留在 memory 里,下次读能读回来就够了 */
  }
}

function drop(key: string): void {
  memory.delete(key);
  try {
    localStorage.removeItem(key);
  } catch {
    /* 读不到也删不掉,无所谓 */
  }
}

function readNumber(key: string): number {
  return Number(read(key) || 0);
}

function writeNumber(key: string, v: number): void {
  write(key, String(v));
}

export const SaveManager = {
  getBestTime(): number {
    return readNumber(KEY_BEST_TIME);
  },
  setBestTime(v: number): void {
    writeNumber(KEY_BEST_TIME, v);
  },
  getBestKills(): number {
    return readNumber(KEY_BEST_KILLS);
  },
  setBestKills(v: number): void {
    writeNumber(KEY_BEST_KILLS, v);
  },
  getTotalRuns(): number {
    return readNumber(KEY_RUNS);
  },
  incTotalRuns(): void {
    writeNumber(KEY_RUNS, this.getTotalRuns() + 1);
  },
  /**
   * 灵石累计。
   *
   * 局外的灵石强化树(道行/护体/寿元…)还没做,这里只负责累计与展示 ——
   * 但它从第一天起就是**真存档**:钱堆在那儿,接上强化树时不用回头改掉落逻辑。
   */
  getCoins(): number {
    return readNumber(KEY_COINS);
  },
  addCoins(v: number): void {
    writeNumber(KEY_COINS, this.getCoins() + v);
  },
  reset(): void {
    drop(KEY_BEST_TIME);
    drop(KEY_BEST_KILLS);
    drop(KEY_RUNS);
    drop(KEY_COINS);
  },
};
