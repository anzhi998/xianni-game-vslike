/**
 * 范围查询
 *
 * 扇形推进(厚土术)、环绕接触(剑阵)、灼烧区(焚天·火海)都需要
 * 「一次遍历一片敌人」的能力。统一放这里,避免每个形态各写一遍遍历。
 *
 * 全部走 **回调** 而不是返回数组:每帧能命中几十个怪,
 * 为了返回结果每帧分配一个新数组是纯浪费(还会制造 GC 尖峰)。
 */
import type Phaser from 'phaser';
import type { Enemy } from '../entities/Enemy';
import type { DamageApplier, DamageOptions } from '../types';

/** 命中回调:只传敌人,伤害由调用方自己带 */
export type EnemyVisitor = (e: Enemy) => void;

/** 圆形范围 */
export function forEachEnemyInRadius(
  group: Phaser.GameObjects.Group,
  cx: number,
  cy: number,
  radius: number,
  visit: EnemyVisitor,
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
    visit(e);
    hits++;
  }
  return hits;
}

/**
 * 圆弧范围(扇形)
 *
 * @param facing 弧的中心方向(弧度)
 * @param span   扫过的总张角(弧度)。山崩地裂的 180° 就是 Math.PI
 */
export function forEachEnemyInArc(
  group: Phaser.GameObjects.Group,
  cx: number,
  cy: number,
  radius: number,
  facing: number,
  span: number,
  visit: EnemyVisitor,
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
    if (dx * dx + dy * dy > r2) continue;
    // 落在正后方(原点)的不计,否则 span 大于 2π 时会恒真
    if (dx === 0 && dy === 0) continue;

    // 归一化到 [-π, π] 再与 half 比较
    let diff = Math.atan2(dy, dx) - facing;
    while (diff > Math.PI) diff -= Math.PI * 2;
    while (diff < -Math.PI) diff += Math.PI * 2;
    if (Math.abs(diff) > half) continue;

    visit(e);
    hits++;
  }
  return hits;
}

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
  return forEachEnemyInRadius(group, cx, cy, radius, (e) => {
    apply(e, damage, e.x, e.y - 8);
  }, exclude);
}

/** 圆弧范围伤害 */
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
  opts?: DamageOptions,
): number {
  return forEachEnemyInArc(group, cx, cy, radius, facing, span, (e) => {
    apply(e, damage, e.x, e.y - 8, opts);
  }, exclude);
}