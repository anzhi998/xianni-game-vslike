import { ENEMIES } from './EnemyConfig';

export interface WaveEntry {
  startTime: number;
  spawnInterval: number;
  weights: Record<string, number>;
  difficulty: number;
}

/**
 * 敌潮时间表(单位:秒)
 */
export const WAVE_SCHEDULE: WaveEntry[] = [
  { startTime: 0,   spawnInterval: 1.0, weights: { bat: 1 },                              difficulty: 1.0 },
  { startTime: 60,  spawnInterval: 0.9, weights: { bat: 0.85, skeleton: 0.15 },          difficulty: 1.1 },
  { startTime: 120, spawnInterval: 0.8, weights: { bat: 0.7, skeleton: 0.3 },            difficulty: 1.2 },
  { startTime: 180, spawnInterval: 0.7, weights: { bat: 0.55, skeleton: 0.4, wraith: 0.05 }, difficulty: 1.35 },
  { startTime: 240, spawnInterval: 0.6, weights: { bat: 0.45, skeleton: 0.4, wraith: 0.15 }, difficulty: 1.5 },
  { startTime: 360, spawnInterval: 0.55, weights: { bat: 0.4, skeleton: 0.4, wraith: 0.2 }, difficulty: 1.7 },
  { startTime: 480, spawnInterval: 0.45, weights: { bat: 0.3, skeleton: 0.45, wraith: 0.25 }, difficulty: 1.9 },
  { startTime: 600, spawnInterval: 0.35, weights: { bat: 0.25, skeleton: 0.45, wraith: 0.3 }, difficulty: 2.2 },
];

export const MAX_DIFFICULTY = 4.0;
export const DIFFICULTY_GROWTH_PER_MIN = 0.08;

/**
 * 根据当前时间取对应的生成配置
 */
export function getWaveAtTime(seconds: number): WaveEntry {
  let wave = WAVE_SCHEDULE[0];
  for (const w of WAVE_SCHEDULE) {
    if (seconds >= w.startTime) wave = w;
  }
  return wave;
}

/**
 * 难度持续增长(每分钟)
 */
export function getDifficultyMultiplier(seconds: number, baseDifficulty: number): number {
  const minutes = seconds / 60;
  const extra = minutes * DIFFICULTY_GROWTH_PER_MIN;
  const d = baseDifficulty + extra;
  return Math.min(d, MAX_DIFFICULTY);
}

/**
 * 根据权重随机选敌人
 */
export function pickEnemyType(weights: Record<string, number>): keyof typeof ENEMIES {
  const entries = Object.entries(weights);
  const total = entries.reduce((s, [, w]) => s + w, 0);
  let r = Math.random() * total;
  for (const [k, w] of entries) {
    r -= w;
    if (r <= 0) return k as keyof typeof ENEMIES;
  }
  return entries[0][0] as keyof typeof ENEMIES;
}
