/**
 * 程序化资源生成器
 * 用 Phaser.Graphics 绘制所有 sprite 作为 Kenney 素材的占位实现
 * 真实素材可放置到 public/assets/ 后,直接替换 PreloadScene 即可
 */

import Phaser from 'phaser';

export function generateAllAssets(scene: Phaser.Scene): void {
  generateTiles(scene);
  generatePlayer(scene);
  generateEnemies(scene);
  generateProjectiles(scene);
  generateRealmProjectiles(scene);
  generatePickups(scene);
}

function makeTexture(scene: Phaser.Scene, key: string, w: number, h: number, draw: (g: Phaser.GameObjects.Graphics) => void): void {
  if (scene.textures.exists(key)) return;
  const g = scene.add.graphics({ x: 0, y: 0 });
  g.setVisible(false);
  draw(g);
  g.generateTexture(key, w, h);
  g.destroy();
}

function generateTiles(scene: Phaser.Scene): void {
  // 草地地面瓦片(32x32) - 4 种变化 + 边缘
  for (let i = 0; i < 6; i++) {
    makeTexture(scene, `tile_grass_${i}`, 32, 32, (g) => {
      g.fillStyle(0x2d5a2d, 1);
      g.fillRect(0, 0, 32, 32);
      // 随机草簇
      const seed = i * 7919;
      g.fillStyle(0x3d7a3d, 1);
      for (let j = 0; j < 6; j++) {
        const x = ((seed * (j + 1) * 13) % 32);
        const y = ((seed * (j + 1) * 17) % 32);
        g.fillRect(x, y, 2, 2);
      }
      g.fillStyle(0x1d4a1d, 1);
      for (let j = 0; j < 3; j++) {
        const x = ((seed * (j + 2) * 11) % 30);
        const y = ((seed * (j + 2) * 23) % 30);
        g.fillRect(x, y, 1, 1);
      }
    });
  }

  // 障碍物
  makeTexture(scene, 'tree', 64, 80, (g) => {
    // 树干
    g.fillStyle(0x5c3a1e, 1);
    g.fillRect(26, 50, 12, 30);
    g.fillStyle(0x3e2410, 1);
    g.fillRect(26, 50, 3, 30);
    // 树冠
    g.fillStyle(0x2d6a2d, 1);
    g.fillCircle(32, 30, 28);
    g.fillStyle(0x3d8a3d, 1);
    g.fillCircle(22, 22, 14);
    g.fillCircle(42, 24, 12);
    g.fillStyle(0x1d5a1d, 1);
    g.fillCircle(32, 40, 22);
  });

  makeTexture(scene, 'rock', 48, 40, (g) => {
    g.fillStyle(0x777788, 1);
    g.fillEllipse(24, 28, 44, 24);
    g.fillStyle(0x9999aa, 1);
    g.fillEllipse(20, 20, 24, 14);
    g.fillStyle(0x555566, 1);
    g.fillEllipse(30, 34, 30, 10);
  });

  makeTexture(scene, 'bush', 40, 32, (g) => {
    g.fillStyle(0x2a5a2a, 1);
    g.fillEllipse(20, 20, 36, 22);
    g.fillStyle(0x3a7a3a, 1);
    g.fillEllipse(14, 14, 18, 14);
    g.fillEllipse(26, 18, 14, 10);
  });
}

function generatePlayer(scene: Phaser.Scene): void {
  // 玩家 16x24 朝下 sprite
  makeTexture(scene, 'player', 16, 24, (g) => {
    // 头
    g.fillStyle(0xf5c89a, 1);
    g.fillRect(5, 2, 6, 6);
    // 头发
    g.fillStyle(0x3a2418, 1);
    g.fillRect(4, 1, 8, 3);
    // 眼睛
    g.fillStyle(0x000000, 1);
    g.fillRect(6, 4, 1, 1);
    g.fillRect(9, 4, 1, 1);
    // 身体 (披风)
    g.fillStyle(0x4a4a8a, 1);
    g.fillRect(4, 8, 8, 12);
    g.fillStyle(0x6a6aaa, 1);
    g.fillRect(5, 8, 6, 2);
    // 腰带
    g.fillStyle(0x8a6a2a, 1);
    g.fillRect(4, 14, 8, 2);
    // 腿
    g.fillStyle(0x2a2a4a, 1);
    g.fillRect(5, 16, 2, 6);
    g.fillRect(9, 16, 2, 6);
    // 鞋
    g.fillStyle(0x1a1a1a, 1);
    g.fillRect(4, 22, 3, 2);
    g.fillRect(9, 22, 3, 2);
  });

  // 玩家发光光晕(用于指示)
  makeTexture(scene, 'player_glow', 64, 64, (g) => {
    for (let i = 0; i < 4; i++) {
      g.fillStyle(0x6a6aff, 0.08);
      g.fillCircle(32, 32, 30 - i * 6);
    }
  });
}

/**
 * 敌人形状。普通与精英共用同一套绘制,只换配色 ——
 * 抽出来是为了避免把三个怪物的画法复制两遍。
 */
type EnemyKind = 'bat' | 'skeleton' | 'wraith';

const ENEMY_SIZE: Record<EnemyKind, { w: number; h: number }> = {
  bat: { w: 16, h: 16 },
  skeleton: { w: 16, h: 20 },
  wraith: { w: 18, h: 22 },
};

/** elite=true 时用更饱和的「妖气」配色 */
const ELITE_PALETTE = {
  bat: { body: 0xff44ff, dark: 0xaa22aa, wing: 0xdd55ee },
  skeleton: { body: 0xfff0c0, dark: 0xd8c090, spine: 0xffaa44 },
  wraith: { body: 0xff8888, dark: 0xcc4444, spine: 0xff6666 },
};

function drawEnemyShape(g: Phaser.GameObjects.Graphics, kind: EnemyKind, elite: boolean): void {
  if (kind === 'bat') {
    const c = elite ? ELITE_PALETTE.bat : { body: 0x9a4aaa, dark: 0x6a2a7a, wing: 0x7a3a8a };
    g.fillStyle(c.wing, 1);
    g.fillRect(1, 5, 5, 3);
    g.fillRect(10, 5, 5, 3);
    g.fillStyle(c.body, 1);
    g.fillRect(6, 6, 4, 6);
    g.fillStyle(c.dark, 1);
    g.fillRect(7, 7, 2, 4);
    g.fillStyle(elite ? 0xffee00 : 0xff3333, 1);
    g.fillRect(7, 7, 1, 1);
    g.fillRect(9, 7, 1, 1);
  } else if (kind === 'skeleton') {
    const c = elite ? ELITE_PALETTE.skeleton : { body: 0xeaeaea, dark: 0x000000, spine: 0xcacaca };
    g.fillStyle(c.body, 1);
    g.fillRect(4, 1, 8, 7);      // 头骨
    g.fillStyle(c.dark, 1);
    g.fillRect(5, 3, 2, 2);
    g.fillRect(9, 3, 2, 2);
    g.fillRect(7, 6, 2, 1);
    g.fillStyle(elite ? 0xffee00 : 0xcacaca, 1);
    g.fillRect(5, 8, 6, 8);      // 身体
    g.fillStyle(c.spine, 1);
    g.fillRect(7, 9, 2, 6);
    g.fillStyle(elite ? 0xffee00 : 0xcacaca, 1);
    g.fillRect(5, 16, 2, 4);
    g.fillRect(9, 16, 2, 4);
  } else {
    const c = elite ? ELITE_PALETTE.wraith : { body: 0xaaccff, dark: 0x000000, spine: 0xaaccff };
    g.fillStyle(c.body, elite ? 0.95 : 0.85);
    g.fillRect(3, 2, 12, 14);
    g.fillCircle(9, 8, 8);
    g.fillStyle(c.body, 0.7);
    g.fillRect(3, 14, 12, 4);
    g.fillStyle(c.body, 0.6);
    g.fillRect(4, 17, 3, 3);
    g.fillRect(8, 17, 2, 4);
    g.fillRect(11, 17, 3, 3);
    g.fillStyle(elite ? 0xffee00 : 0x000000, 1);
    g.fillRect(5, 6, 2, 2);
    g.fillRect(11, 6, 2, 2);
  }
}

function generateEnemies(scene: Phaser.Scene): void {
  // 普通敌人 + 精英变体(同形状,换配色)
  (['bat', 'skeleton', 'wraith'] as EnemyKind[]).forEach((kind) => {
    const { w, h } = ENEMY_SIZE[kind];
    makeTexture(scene, `enemy_${kind}`, w, h, (g) => drawEnemyShape(g, kind, false));
    makeTexture(scene, `elite_${kind}`, w, h, (g) => {
      drawEnemyShape(g, kind, true);
      // 精英外圈描边,让玩家在混战里一眼分辨
      g.lineStyle(1, 0xffcc44, 1);
      g.strokeRect(0.5, 0.5, w - 1, h - 1);
    });
  });
}

function generateProjectiles(scene: Phaser.Scene): void {
  // 飞剑投射物(剑尖朝 +X)
  makeTexture(scene, 'proj_knife', 12, 6, (g) => {
    // 剑身(带对称双刃)
    g.fillStyle(0xdddddd, 1);
    g.fillTriangle(11, 3, 3, 1, 3, 5);
    // 剑脊高光
    g.fillStyle(0xffffff, 1);
    g.fillRect(4, 3, 6, 1);
    // 护手
    g.fillStyle(0xaa8800, 1);
    g.fillRect(2, 0, 2, 6);
    // 剑柄
    g.fillStyle(0x6a3a1a, 1);
    g.fillRect(0, 2, 2, 2);
  });

  // 灵气弹
  makeTexture(scene, 'proj_magic', 14, 14, (g) => {
    for (let i = 0; i < 3; i++) {
      g.fillStyle(0xaa66ff, 0.4 - i * 0.1);
      g.fillCircle(7, 7, 7 - i * 2);
    }
    g.fillStyle(0xffffff, 1);
    g.fillCircle(7, 7, 2);
  });

  // 回旋斧投射物(朝向 +X 轴)
  makeTexture(scene, 'proj_axe', 14, 14, (g) => {
    // 斧刃(上)
    g.fillStyle(0xff8844, 1);
    g.fillTriangle(12, 7, 4, 2, 4, 6);
    // 斧刃(下)
    g.fillTriangle(12, 7, 4, 8, 4, 12);
    // 斧柄
    g.fillStyle(0x6a3a1a, 1);
    g.fillRect(0, 6, 6, 2);
    // 金属高光
    g.fillStyle(0xffcc88, 1);
    g.fillRect(8, 3, 2, 1);
    g.fillRect(8, 10, 2, 1);
  });

  // 攻击命中粒子
  makeTexture(scene, 'fx_hit', 16, 16, (g) => {
    g.fillStyle(0xffdd44, 1);
    g.fillCircle(8, 8, 6);
    g.fillStyle(0xffffff, 1);
    g.fillCircle(8, 8, 2);
  });
}

/**
 * 高境界法术的投射物图
 *
 * 这些法术的攻击形态已经由数值主导(多发/穿透/大范围),
 * 精灵只需一眼能分辨形态与阵营色,所以用一套参数化绘制按颜色生成。
 */
function generateRealmProjectiles(scene: Phaser.Scene): void {
  /** 纯弹体:核心 + 光晕,朝 +X 拉长一点 */
  const orb = (key: string, color: number, w = 12, h = 12) =>
    makeTexture(scene, key, w, h, (g) => {
      const cx = w / 2, cy = h / 2;
      for (let i = 0; i < 3; i++) {
        g.fillStyle(color, 0.22 - i * 0.06);
        g.fillCircle(cx, cy, Math.min(cx, cy) - i * 1.5);
      }
      g.fillStyle(color, 1);
      g.fillCircle(cx, cy, Math.min(cx, cy) * 0.45);
      g.fillStyle(0xffffff, 0.9);
      g.fillCircle(cx - 1, cy - 1, 1.2);
    });

  /** 刃形:细长三角,朝 +X */
  const blade = (key: string, color: number, w = 16, h = 8) =>
    makeTexture(scene, key, w, h, (g) => {
      g.fillStyle(color, 0.25);
      g.fillTriangle(w, h / 2, 0, 0, 0, h);
      g.fillStyle(color, 1);
      g.fillTriangle(w - 2, h / 2, 1, 2, 1, h - 2);
      g.fillStyle(0xffffff, 0.85);
      g.fillRect(3, h / 2 - 1, w - 6, 1);
    });

  // 筑基
  orb('proj_sword_array', 0x88ddff, 10, 10);
  blade('proj_frost_needle', 0xaaccff, 16, 7);
  orb('proj_fire_wheel', 0xff6633, 16, 16);

  // 结丹
  blade('proj_golden_light', 0xffdd44, 18, 8);
  orb('proj_demon_eye', 0xaa44ff, 14, 14);
  orb('proj_earth_pillar', 0xaa8855, 18, 18);

  // 元婴
  orb('proj_baby_soul', 0xff88dd, 12, 12);
  blade('proj_void_edge', 0x6644ff, 20, 8);
  orb('proj_star_slash', 0xbb88ff, 16, 16);

  // 化神
  orb('proj_sea_of_souls', 0xff5577, 13, 13);
  blade('proj_chaos_bolt', 0x8866ff, 22, 9);
  orb('proj_heaven_candle', 0xffcc55, 18, 18);

  // 问鼎
  blade('proj_void_swap', 0xbb88ff, 20, 8);
  blade('proj_dao_seal', 0xffdd88, 22, 10);
  orb('proj_grand_collapse', 0xff3344, 20, 20);
}

function generatePickups(scene: Phaser.Scene): void {
  // XP 宝石 4 档
  const xpColors = [0x44ff44, 0x44aaff, 0xaa44ff, 0xffdd44];
  const xpSizes = [6, 8, 10, 12];
  for (let i = 0; i < 4; i++) {
    const s = xpSizes[i];
    makeTexture(scene, `xp_gem_${i}`, s, s, (g) => {
      g.fillStyle(xpColors[i], 1);
      g.fillRect(1, 2, s - 2, s - 4);
      g.fillTriangle(1, 2, s - 1, 2, Math.floor(s / 2), 0);
      g.fillTriangle(1, s - 2, s - 1, s - 2, Math.floor(s / 2), s);
      g.fillStyle(0xffffff, 0.6);
      g.fillRect(2, 3, 1, 1);
    });
  }

  // 金币
  makeTexture(scene, 'coin', 10, 10, (g) => {
    g.fillStyle(0xffcc00, 1);
    g.fillCircle(5, 5, 5);
    g.fillStyle(0xffee44, 1);
    g.fillCircle(4, 4, 2);
    g.fillStyle(0xaa8800, 1);
    g.fillRect(5, 3, 1, 4);
  });

  // 法宝掉落:悬浮的法宝剪影,四周有光晕
  makeTexture(scene, 'pickup_artifact', 16, 16, (g) => {
    for (let i = 0; i < 3; i++) {
      g.fillStyle(0x66ccff, 0.12 - i * 0.03);
      g.fillCircle(8, 8, 8 - i * 2);
    }
    g.fillStyle(0xaaccff, 1);
    g.fillRect(7, 3, 2, 10);
    g.fillRect(3, 7, 10, 2);
    g.fillStyle(0xffffff, 1);
    g.fillCircle(8, 8, 2);
  });

  // 突破道具(丹药):金色丹丸
  makeTexture(scene, 'pickup_key', 14, 14, (g) => {
    for (let i = 0; i < 3; i++) {
      g.fillStyle(0xffcc44, 0.12 - i * 0.03);
      g.fillCircle(7, 7, 7 - i * 2);
    }
    g.fillStyle(0xff8822, 1);
    g.fillCircle(7, 7, 5);
    g.fillStyle(0xffdd88, 1);
    g.fillCircle(5, 5, 2);
  });
}

