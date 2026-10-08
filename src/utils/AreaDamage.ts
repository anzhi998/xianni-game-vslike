/**
 * 范围伤害
 *
 * 落印的落点、弧斩的扫掠带、环绕体的接触、地效的区域 —— 都需要
 * 「一次对一片敌人造成伤害」的能力。统一放这里,避免四个形态各写一遍遍历。
 */
import type Phaser from 'phaser';
import type { Enemy } from '../entities/Enemy';
import type { DamageApplier } from '../types';

/** 圆形范围伤害 */
export function damageEnemiesInRadius(
  group: Phaser.GameObjects.Group,
  cx: number,
  cy: number,
  radius: number,
  damage: number,
  apply: DamageApplier,
  exclude?: Set<Enemy>,
): number {
  const list = group.children.entries;
  const r2 = radius * radius;
  let hits = 0;
  for (let i = 0; i < list.length; i++) {
    const e = list[i] as Enemy;
    if (!e.active || e.isDead) continue;
    if (exclude && exclude.has(e)) continue;
    const dx = e.x - cx;
    const dy = e.y - cy;
    if (dx * dx + dy * dy > r2) continue;
    apply(e, damage, e.x, e.y - 8);
    hits++;
  }
  return hits;
}

/**
 * 圆弧范围伤害
 *
 * @param facing 弧的中心方向(弧度)
 * @param span   扫过的总张角(弧度)
 */
export function damageEnemiesInArc(
  group: Phaser.GameObjects.Group,
  cx: number,
  cy: number,
  radius: number,
  facing: number,
  span: number,
  damage: number,
  apply: DamageApplier,
  exclude?: Set<Enemy>,
): number {
  const list = group.children.entries;
  const r2 = radius * radius;
  const half = span / 2;
  let hits = 0;

  for (let i = 0; i < list.length; i++) {
    const e = list[i] as Enemy;
    if (!e.active || e.isDead) continue;
    if (exclude && exclude.has(e)) continue;

    const dx = e.x - cx;
    const dy = e.y - cy;
    const d2 = dx * dx + dy * dy;
    if (d2 > r2) continue;

    // 落在正后方(原点)的不计,否则 span 大于 2π 时会恒真
    if (dx === 0 && dy === 0) continue;

    // 归一化到 [-π, π] 再与 half 比较
    let diff = Math.atan2(dy, dx) - facing;
    while (diff > Math.PI) diff -= Math.PI * 2;
    while (diff < -Math.PI) diff += Math.PI * 2;
    if (Math.abs(diff) > half) continue;

    apply(e, damage, e.x, e.y - 8);
    hits++;
  }
  return hits;
}