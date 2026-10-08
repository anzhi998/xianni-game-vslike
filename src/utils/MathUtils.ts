/**
 * 通用数学工具
 */
export const MathUtils = {
  distance(x1: number, y1: number, x2: number, y2: number): number {
    const dx = x2 - x1;
    const dy = y2 - y1;
    return Math.sqrt(dx * dx + dy * dy);
  },
  distanceSq(x1: number, y1: number, x2: number, y2: number): number {
    const dx = x2 - x1;
    const dy = y2 - y1;
    return dx * dx + dy * dy;
  },
  angle(fromX: number, fromY: number, toX: number, toY: number): number {
    return Math.atan2(toY - fromY, toX - fromX);
  },
  clamp(v: number, min: number, max: number): number {
    return Math.max(min, Math.min(max, v));
  },
  randRange(min: number, max: number): number {
    return min + Math.random() * (max - min);
  },
  pickRandom<T>(arr: T[]): T {
    return arr[Math.floor(Math.random() * arr.length)];
  },
  shuffle<T>(arr: T[]): T[] {
    const a = arr.slice();
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  },
};
