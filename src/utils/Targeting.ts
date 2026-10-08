/**
 * 索敌工具
 *
 * 武器锁定、追踪重新索敌、连锁跳转三处都要「找最近的活着的敌人」,
 * 统一到这里。用 Structs.Set.entries 直接遍历底层数组,避免每帧 new Array。
 */
import type Phaser from 'phaser';
import type { Enemy } from '../entities/Enemy';

/**
 * 在 radius 内找最近的敌人
 *
 * @param exclude 已命中过的敌人集合(连锁时传入 hitSet,避免在同一个人身上反复弹跳)
 * @returns 最近的敌人;范围内没有则返回 null
 *
 * 注意 isDead 过滤是必须的:onEnemyKilled 的尸体在 200ms 死亡补间内
 * 仍然是 active 的,不跳过它们的话连锁会跳到一具尸体上。
 */
export function findNearestEnemy(
  group: Phaser.GameObjects.Group,
  x: number,
  y: number,
  radius: number,
  exclude?: Set<Enemy>,
): Enemy | null {
  const list = group.children.entries;
  const r2 = radius * radius;
  let best: Enemy | null = null;
  let bestD = r2;
  for (let i = 0; i < list.length; i++) {
    const e = list[i] as Enemy;
    if (!e.active || e.isDead) continue;
    if (exclude && exclude.has(e)) continue;
    const dx = e.x - x;
    const dy = e.y - y;
    const d2 = dx * dx + dy * dy;
    if (d2 < bestD) {
      bestD = d2;
      best = e;
    }
  }
  return best;
}