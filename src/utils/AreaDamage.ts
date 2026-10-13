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

/**
 * 长方形范围(轴对齐于 facing)
 *
 * 矩形从 (cx, cy) 出发沿 facing 延伸 `length`,两侧各展开 `width / 2` ——
 * 「面前长方形」的边**贴着**施放点,不是以它为中心。
 *
 * 判定不做圆-矩形保守近似:把每个敌人的位移向量投影到「沿面向 / 垂直面向」
 * 两个轴上,along ∈ [0, length] 且 |side| ≤ width/2 即命中。两次乘加换来的
 * 是与画出来的浪严格同形 —— 浪前画到哪,伤害就压到哪(道化黄泉)。
 *
 * @param facing 矩形的延伸方向(弧度)
 * @param length 沿 facing 的长度(px)
 * @param width  垂直于 facing 的全宽(px)
 */
export function forEachEnemyInRect(
  group: Phaser.GameObjects.Group,
  cx: number,
  cy: number,
  facing: number,
  length: number,
  width: number,
  visit: EnemyVisitor,
): number {
  const list = group.children.entries;
  const cos = Math.cos(facing);
  const sin = Math.sin(facing);
  const half = width / 2;
  let hits = 0;

  for (let i = 0; i < list.length; i++) {
    const e = list[i] as Enemy;
    if (!e.active || e.isDead) continue;

    const dx = e.x - cx;
    const dy = e.y - cy;
    const along = dx * cos + dy * sin;
    if (along < 0 || along > length) continue;
    if (Math.abs(-dx * sin + dy * cos) > half) continue;

    visit(e);
    hits++;
  }
  return hits;
}

/** 长方形范围伤害 */
export function damageEnemiesInRect(
  group: Phaser.GameObjects.Group,
  cx: number,
  cy: number,
  facing: number,
  length: number,
  width: number,
  damage: number,
  apply: DamageApplier,
  opts?: DamageOptions,
): number {
  return forEachEnemyInRect(group, cx, cy, facing, length, width, (e) => {
    apply(e, damage, e.x, e.y - 8, opts);
  });
}