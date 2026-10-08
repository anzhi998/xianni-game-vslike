import { NORMAL_MUTATION } from '../types';
import type { DropEntry, EnemyMutation } from '../types';
import { ARTIFACT_IDS } from './ArtifactConfig';
import { REALMS } from './RealmConfig';

/**
 * 精英怪与掉落
 *
 * 精英按「时间间隔」而非「固定概率」掷出。
 * 固定概率会与 WaveConfig 里 spawnInterval 从 1.0s 压到 0.24s 的曲线打架,
 * 导致屏幕最挤的时候精英反而更密 —— 和设计意图正好相反。
 */

/** 开局时多少秒出一只精英 */
export const ELITE_PERIOD_START = 25;
/** 后期(约 12 分钟)多少秒出一只 */
export const ELITE_PERIOD_END = 7;
/** 精英密度线性增长到多少秒为止 */
const RAMP_END_SECONDS = 720;

/** 各档精英的血量倍率 */
const TIER_HP = [0, 4, 8, 15];

export function elitePeriodAt(seconds: number): number {
  const t = Math.min(1, seconds / RAMP_END_SECONDS);
  return ELITE_PERIOD_START + (ELITE_PERIOD_END - ELITE_PERIOD_START) * t;
}

/**
 * 掷出本次生成是否为精英。
 * @param spawnInterval 当前出怪间隔,用于换算成「期望每 N 只出一只」
 */
export function rollEliteMutation(seconds: number, spawnInterval: number): EnemyMutation {
  if (Math.random() >= spawnInterval / elitePeriodAt(seconds)) {
    return NORMAL_MUTATION;
  }
  const roll = Math.random();
  const tier = roll < 0.6 ? 1 : roll < 0.9 ? 2 : 3;
  const k = TIER_HP[tier];
  return {
    elite: true,
    tier,
    hpMul: k,
    damageMul: 1 + (k - 1) * 0.15,
    speedMul: 1 + (tier - 1) * 0.08,
    xpMul: 2 + tier * 2,
    scaleMul: 1.25 + tier * 0.22,
  };
}

/** 掉落物数量缩放 */
function dropCount(tier: number, chance: number): number {
  let n = 0;
  for (let i = 0; i < tier; i++) {
    if (Math.random() < chance) n++;
  }
  return n;
}

/**
 * 掷出这具精英尸体的掉落。
 *
 * 突破道具对「玩家当前正要突破的那个」加权 3 倍 ——
 * 避免大境界门槛退化成纯粹刷量,但不取消 hunt 的感觉。
 *
 * 不做「已满阶法宝过滤」:法宝槽满 / 已满阶时 equip() 会返回 null,
 * GameScene 会在拾取时把溢出转化为突破道具,掉落因此永不浪费。
 */
export function rollEliteDrops(tier: number, currentRealmIndex: number): DropEntry[] {
  const out: DropEntry[] = [];

  const n = dropCount(tier, 0.55 + tier * 0.12);
  for (let i = 0; i < n; i++) {
    const id = pickNeededKeyItem(currentRealmIndex);
    if (id) out.push({ kind: 'keyItem', payload: id });
  }

  const m = dropCount(tier, 0.18 + tier * 0.1);
  for (let i = 0; i < m; i++) {
    const id = ARTIFACT_IDS[Math.floor(Math.random() * ARTIFACT_IDS.length)];
    out.push({ kind: 'artifact', payload: id });
  }

  return out;
}

/** 随机挑一个突破道具。正缺的那个权重 3 倍,其余留少量权重供玩家囤下一境的丹药 */
function pickNeededKeyItem(currentRealmIndex: number): string | null {
  const withItems = REALMS.filter((r) => r.keyItemId);
  if (withItems.length === 0) return null;

  const weights = withItems.map((r) => (REALMS.indexOf(r) === currentRealmIndex ? 3 : 1));
  const total = weights.reduce((s, w) => s + w, 0);
  let r = Math.random() * total;
  for (let i = 0; i < withItems.length; i++) {
    r -= weights[i];
    if (r <= 0) return withItems[i].keyItemId;
  }
  return withItems[withItems.length - 1].keyItemId;
}