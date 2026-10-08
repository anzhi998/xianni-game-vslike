import type { EnemyConfig } from '../types';

/**
 * 敌人数数据表
 */
export const ENEMIES: Record<string, EnemyConfig> = {
  bat: {
    id: 'bat',
    name: '暗影蝙蝠',
    maxHealth: 10,
    speed: 60,
    contactDamage: 5,
    xpValue: 1,
    size: 14,
    color: 0x9a4aaa,
    bodyColor: 0x6a2a7a,
  },
  skeleton: {
    id: 'skeleton',
    name: '骷髅',
    maxHealth: 20,
    speed: 75,
    contactDamage: 8,
    xpValue: 2,
    size: 16,
    color: 0xeaeaea,
    bodyColor: 0xcacaca,
  },
  wraith: {
    id: 'wraith',
    name: '幽灵',
    maxHealth: 40,
    speed: 100,
    contactDamage: 12,
    xpValue: 5,
    size: 18,
    color: 0xaaccff,
    bodyColor: 0x88aaff,
  },
};
