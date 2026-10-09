/**
 * 程序化资源生成器
 * 用 Phaser.Graphics 绘制所有 sprite 作为 Kenney 素材的占位实现
 * 真实素材可放置到 public/assets/ 后,直接替换 PreloadScene 即可
 */

import Phaser from 'phaser';
import { ARTIFACTS, ARTIFACT_IDS } from '../config/ArtifactConfig';
import { ENEMIES } from '../config/EnemyConfig';
import type { EnemyConfig, EnemyArchetype } from '../types';

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
 * 敌人形状 —— 按「原型」参数化绘制,配色由 EnemyConfig 提供
 *
 * 十二只具名怪不可能每只都手绘一张。它们本来就只分六种原型 + 两种特殊体型,
 * 所以画法按 `archetype` 分八套,同一套里换配色即可 ——
 * 与 generateRealmProjectiles 是同一个思路:形状读「原型」,颜色读数据表。
 * 加一只怪 = 在 ENEMIES 里加一行,这里一行都不用动。
 */
interface Palette { body: number; dark: number; accent: number; }

/** 把颜色往白里提亮(0 = 原色,1 = 纯白) */
function brighten(color: number, t: number): number {
  const r = (color >> 16) & 0xff;
  const g = (color >> 8) & 0xff;
  const b = color & 0xff;
  const mix = (v: number) => Math.round(v + (255 - v) * t);
  return (mix(r) << 16) | (mix(g) << 8) | mix(b);
}

/** 贴图尺寸由碰撞直径推导(碰撞圆用 cfg.size,贴图比它大一圈免得撞上了还看着没碰到) */
function enemyTextureSize(cfg: EnemyConfig): { w: number; h: number } {
  const s = cfg.size;
  switch (cfg.archetype) {
    case 'spawnling': return { w: Math.round(s * 1.6), h: Math.round(s * 1.0) };
    case 'caster': return { w: Math.round(s * 1.1), h: Math.round(s * 1.5) };
    case 'soul': return { w: Math.round(s * 1.3), h: Math.round(s * 1.5) };
    case 'beast': return { w: Math.round(s * 1.5), h: Math.round(s * 1.2) };
    case 'tank': return { w: Math.round(s * 1.3), h: Math.round(s * 1.3) };
    case 'bomber': return { w: Math.round(s * 1.3), h: Math.round(s * 1.3) };
    case 'stalker': return { w: Math.round(s * 1.2), h: Math.round(s * 1.4) };
    default: return { w: Math.round(s * 1.2), h: Math.round(s * 1.3) };
  }
}

function drawEnemyShape(
  g: Phaser.GameObjects.Graphics,
  shape: EnemyArchetype,
  w: number,
  h: number,
  c: Palette,
): void {
  const r = Math.round;
  switch (shape) {
    // 群怪:四足小兽(山野妖兽 / 腐尸)。矮、宽,一眼是「多而弱」
    case 'horde': {
      g.fillStyle(c.dark, 1);
      g.fillRect(r(w * 0.22), r(h * 0.66), r(w * 0.16), r(h * 0.3));
      g.fillRect(r(w * 0.6), r(h * 0.66), r(w * 0.16), r(h * 0.3));
      g.fillStyle(c.body, 1);
      g.fillRect(r(w * 0.18), r(h * 0.34), r(w * 0.56), r(h * 0.36)); // 躯干
      g.fillRect(r(w * 0.64), r(h * 0.26), r(w * 0.3), r(h * 0.34));  // 头
      g.fillStyle(c.accent, 1);
      g.fillRect(r(w * 0.66), r(h * 0.14), r(w * 0.08), r(h * 0.14)); // 耳
      g.fillRect(r(w * 0.82), r(h * 0.14), r(w * 0.08), r(h * 0.14));
      g.fillStyle(0xff3333, 1);
      g.fillRect(r(w * 0.76), r(h * 0.36), 2, 2); // 眼
      return;
    }

    // 坦克:甲壳块(石傀 / 铁甲兽)。方、厚,没有脖子 —— 不说「快」
    case 'tank': {
      g.fillStyle(c.dark, 1);
      g.fillRect(r(w * 0.12), r(h * 0.62), r(w * 0.76), r(h * 0.32));
      g.fillStyle(c.body, 1);
      g.fillRect(r(w * 0.16), r(h * 0.2), r(w * 0.68), r(h * 0.48));
      g.fillStyle(c.accent, 1);
      g.fillRect(r(w * 0.2), r(h * 0.28), r(w * 0.6), r(h * 0.08)); // 甲片
      g.fillRect(r(w * 0.2), r(h * 0.46), r(w * 0.6), r(h * 0.08));
      g.fillStyle(0xff5522, 1);
      g.fillRect(r(w * 0.34), r(h * 0.36), 3, 2); // 眼
      g.fillRect(r(w * 0.6), r(h * 0.36), 3, 2);
      return;
    }

    // 术修:袍 + 冠 + 法杖(散修 / 魔道修士)。细高,站在远处
    case 'caster': {
      g.fillStyle(c.dark, 1);
      g.fillRect(r(w * 0.12), r(h * 0.12), 2, r(h * 0.8));           // 法杖
      g.fillStyle(c.accent, 1);
      g.fillRect(r(w * 0.06), r(h * 0.08), 4, 4);                    // 杖顶灵光
      g.fillStyle(c.body, 1);
      g.fillRect(r(w * 0.28), r(h * 0.3), r(w * 0.48), r(h * 0.62)); // 袍(下宽上窄)
      g.fillRect(r(w * 0.36), r(h * 0.16), r(w * 0.32), r(h * 0.2)); // 头
      g.fillStyle(c.accent, 1);
      g.fillRect(r(w * 0.32), r(h * 0.1), r(w * 0.4), r(h * 0.08));  // 冠
      g.fillStyle(0x111133, 1);
      g.fillRect(r(w * 0.42), r(h * 0.24), 2, 2);
      g.fillRect(r(w * 0.56), r(h * 0.24), 2, 2);
      return;
    }

    // 潜行:幽体(阴魂 / 尸修)。没有腿,下摆渐隐 —— 「不受地形约束」的视觉语言
    case 'stalker': {
      g.fillStyle(c.body, 0.85);
      g.fillCircle(r(w * 0.5), r(h * 0.36), r(w * 0.32));
      g.fillRect(r(w * 0.2), r(h * 0.34), r(w * 0.6), r(h * 0.42));
      g.fillStyle(c.body, 0.55);
      g.fillRect(r(w * 0.24), r(h * 0.74), r(w * 0.52), r(h * 0.14));
      g.fillStyle(c.body, 0.3);
      g.fillRect(r(w * 0.32), r(h * 0.86), r(w * 0.36), r(h * 0.1));
      g.fillStyle(c.dark, 1);
      g.fillRect(r(w * 0.36), r(h * 0.3), 3, 3); // 空洞的眼
      g.fillRect(r(w * 0.56), r(h * 0.3), 3, 3);
      return;
    }

    // 自爆:火核 + 外焰(火灵)。圆得可疑,再加一圈尖角
    case 'bomber': {
      g.fillStyle(c.accent, 0.7);
      g.fillCircle(r(w * 0.5), r(h * 0.5), r(w * 0.48));
      g.fillStyle(c.body, 1);
      g.fillCircle(r(w * 0.5), r(h * 0.5), r(w * 0.32));
      g.fillStyle(brighten(c.body, 0.6), 1);
      g.fillCircle(r(w * 0.5), r(h * 0.5), r(w * 0.16));
      return;
    }

    // 衍体:节肢虫(蛊虫)。横着的三段体节
    case 'spawnling': {
      g.fillStyle(c.dark, 1);
      for (let i = 0; i < 3; i++) {
        g.fillRect(r(w * (0.12 + i * 0.26)), r(h * 0.7), 2, r(h * 0.28)); // 足
      }
      g.fillStyle(c.body, 1);
      g.fillCircle(r(w * 0.22), r(h * 0.5), r(h * 0.26));
      g.fillCircle(r(w * 0.48), r(h * 0.46), r(h * 0.3));
      g.fillCircle(r(w * 0.74), r(h * 0.42), r(h * 0.28));
      g.fillStyle(c.accent, 1);
      g.fillCircle(r(w * 0.86), r(h * 0.34), r(h * 0.2)); // 头
      g.fillStyle(0x111111, 1);
      g.fillRect(r(w * 0.88), r(h * 0.3), 2, 2);
      return;
    }

    // 高危单体:带角巨兽(上古凶兽)。大、低,角是它唯一的辨识点
    case 'beast': {
      g.fillStyle(c.dark, 1);
      g.fillRect(r(w * 0.14), r(h * 0.6), r(w * 0.16), r(h * 0.36));
      g.fillRect(r(w * 0.6), r(h * 0.6), r(w * 0.18), r(h * 0.36));
      g.fillStyle(c.body, 1);
      g.fillRect(r(w * 0.1), r(h * 0.32), r(w * 0.68), r(h * 0.36)); // 躯干
      g.fillRect(r(w * 0.66), r(h * 0.2), r(w * 0.28), r(h * 0.36)); // 头
      g.fillStyle(c.accent, 1);
      g.fillTriangle(r(w * 0.68), r(h * 0.2), r(w * 0.72), r(h * 0.2), r(w * 0.66), r(h * 0.02)); // 双角
      g.fillTriangle(r(w * 0.84), r(h * 0.2), r(w * 0.9), r(h * 0.2), r(w * 0.92), r(h * 0.02));
      g.fillStyle(0xffcc00, 1);
      g.fillRect(r(w * 0.8), r(h * 0.32), 3, 2); // 眼
      return;
    }

    // 终局:界外之魂。大幽体 + 面具
    case 'soul': {
      g.fillStyle(c.body, 0.8);
      g.fillCircle(r(w * 0.5), r(h * 0.34), r(w * 0.36));
      g.fillRect(r(w * 0.14), r(h * 0.32), r(w * 0.72), r(h * 0.44));
      g.fillStyle(c.body, 0.45);
      g.fillRect(r(w * 0.2), r(h * 0.76), r(w * 0.6), r(h * 0.12));
      g.fillStyle(c.body, 0.25);
      g.fillRect(r(w * 0.3), r(h * 0.88), r(w * 0.4), r(h * 0.1));
      g.fillStyle(c.accent, 1);
      g.fillRect(r(w * 0.3), r(h * 0.22), r(w * 0.4), r(h * 0.2)); // 面具
      g.fillStyle(0x140a20, 1);
      g.fillRect(r(w * 0.36), r(h * 0.28), 3, 3);
      g.fillRect(r(w * 0.58), r(h * 0.28), 3, 3);
      return;
    }
  }
}

function generateEnemies(scene: Phaser.Scene): void {
  // 遍历数据表自动出图 —— 加怪只需改 EnemyConfig
  for (const id of Object.keys(ENEMIES)) {
    const cfg = ENEMIES[id];
    const { w, h } = enemyTextureSize(cfg);
    const body = cfg.color;
    const dark = cfg.bodyColor;
    const accent = brighten(cfg.color, 0.45);

    makeTexture(scene, `enemy_${id}`, w, h, (g) => {
      drawEnemyShape(g, cfg.archetype, w, h, { body, dark, accent });
    });

    makeTexture(scene, `elite_${id}`, w, h, (g) => {
      // 精英 = 同阶修士:同形状、整体提亮、描金边。
      // 混战里「哪只是精英」必须一秒可辨,这比它长什么样重要
      drawEnemyShape(g, cfg.archetype, w, h, {
        body: brighten(body, 0.35),
        dark: brighten(dark, 0.3),
        accent: 0xffee00,
      });
      g.lineStyle(1, 0xffcc44, 1);
      g.strokeRect(0.5, 0.5, w - 1, h - 1);
    });
  }
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

  // 火球:红色弹丸。专用一张而不是复用 proj_magic(那是紫色的灵气弹)——
  // 法宝图标与弹体用同一套配色,玩家看到红色就该预期它是火。
  // ⚠️ 内芯必须留在红里:原先的橙芯 0xff7733 + 黄芯 0xffe088 在 14px 下
  // 连外圈的红光一起被读成橙色。提亮只做「更亮的红」,不跨到黄。
  makeTexture(scene, 'proj_fireball', 14, 14, (g) => {
    for (let i = 0; i < 3; i++) {
      g.fillStyle(0xff2200, 0.45 - i * 0.1);
      g.fillCircle(7, 7, 7 - i * 2);
    }
    g.fillStyle(0xdd1100, 1);
    g.fillCircle(7, 7, 4);
    g.fillStyle(0xff5533, 1);
    g.fillCircle(6, 6, 2);
  });

  // 九幽火海:火球术的进化弹。
  //
  // 它是**看得见的进化** —— 所以比火球大一圈(16 vs 14)、外面裹一层暗红的血焰,
  // 内芯留一点白热的业火。进化形态的弹体曾经直接借用 proj_magic(紫色的灵气弹),
  // 结果「九幽火海」飞出去是一颗紫色光球 —— 配色是玩家判断法术归属的唯一线索,
  // 一个火系神通的弹体不能长成灵气弹的样子
  makeTexture(scene, 'proj_nine_nether_fire', 16, 16, (g) => {
    for (let i = 0; i < 3; i++) {
      g.fillStyle(0x550011, 0.5 - i * 0.1);
      g.fillCircle(8, 8, 8 - i * 2);
    }
    g.fillStyle(0xbb1a00, 1);
    g.fillCircle(8, 8, 5);
    g.fillStyle(0xff4422, 1);
    g.fillCircle(7, 7, 3);
    g.fillStyle(0xffaa77, 1);
    g.fillCircle(7, 7, 1.5);
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

  // 敌方弹丸(术修)。暗红发紫 —— 与玩家侧的红色火球/紫色灵气弹都拉开,
  // 混战时「这发是打我的」必须一眼可辨
  makeTexture(scene, 'proj_enemy_shot', 10, 10, (g) => {
    for (let i = 0; i < 3; i++) {
      g.fillStyle(0x882244, 0.45 - i * 0.12);
      g.fillCircle(5, 5, 5 - i * 1.4);
    }
    g.fillStyle(0xdd4466, 1);
    g.fillCircle(5, 5, 2.4);
    g.fillStyle(0xffccdd, 1);
    g.fillCircle(4, 4, 1);
  });

  // 回旋斧投射物(朝向 +X 轴)

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

  // 筑基
  orb('proj_sword_array', 0x88ddff, 10, 10);

  // 黄泉指:一条贯穿的指芒。
  // 刻意不套上面的 blade —— 那是「刃」,而这是一道指力:更长更细、前段收成一点、
  // 尾部留一段渐隐的指迹。配色取自 WeaponConfig 里的 0xcc44ff,
  // 「配置里的颜色」与「弹体长什么样」必须是同一件事
  makeTexture(scene, 'proj_huangquan', 20, 6, (g) => {
    g.fillStyle(0xcc44ff, 0.28);
    g.fillRect(0, 2, 15, 2); // 指迹
    g.fillStyle(0xcc44ff, 1);
    g.fillTriangle(20, 3, 2, 1, 2, 5); // 指芒
    g.fillStyle(0xe9b8ff, 1);
    g.fillRect(4, 2, 12, 1); // 中段提亮
    g.fillStyle(0xffffff, 1);
    g.fillRect(16, 2, 2, 2); // 指端
  });

  // 第三目·神目:一道持续压在精英身上的红色光柱。
  // 它穿透一切(pierce 99)且存续 2.2 秒 —— 所以画成**柱**而不是刃:
  // 上下等宽、内部一条白热芯,读起来像持续照射,而不是一掠而过的暗器
  makeTexture(scene, 'proj_third_eye', 22, 10, (g) => {
    g.fillStyle(0xff4466, 0.3);
    g.fillRect(0, 1, 22, 8); // 外圈光晕
    g.fillStyle(0xff4466, 1);
    g.fillRect(1, 3, 20, 4); // 柱身
    g.fillStyle(0xffdddd, 1);
    g.fillRect(3, 4, 16, 2); // 白热芯
    g.fillStyle(0xffffff, 0.9);
    g.fillCircle(20, 5, 2);  // 柱头
  });

  // 结丹
  orb('proj_earth_pillar', 0xaa8855, 18, 18);

  // 元婴

  // 化神

  // 问鼎
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

  // 每件法宝一张独立纹理。
  //
  // 之前所有法宝共用 pickup_artifact 一张图,地面上的法宝彼此无法区分,
  // 玩家只能捡起来才知道捡到了什么。现在按 ArtifactConfig.color 上色,
  // 且同一批武器的实际配色与法宝面板图标的配色一致 —— 看到地上一抹紫,
  // 就知道捡的是极阴。
  for (const id of ARTIFACT_IDS) {
    const color = ARTIFACTS[id].color;
    makeTexture(scene, `pickup_artifact_${id}`, 16, 16, (g) => {
      for (let i = 0; i < 3; i++) {
        g.fillStyle(color, 0.14 - i * 0.04);
        g.fillCircle(8, 8, 8 - i * 2);
      }
      g.fillStyle(color, 1);
      g.fillRect(7, 3, 2, 10);
      g.fillRect(3, 7, 10, 2);
      g.fillStyle(0xffffff, 1);
      g.fillCircle(8, 8, 2);
    });
  }

  // 秘境宝匣:全场最显眼的一件 —— 金色宝匣 + 向上窜的光柱,
  // 20px(其他掉落物 14-16px)且最亮,为了它改变走位是值得的
  makeTexture(scene, 'pickup_chest', 20, 20, (g) => {
    // 光柱:向上渐隐
    for (let i = 0; i < 4; i++) {
      g.fillStyle(0xffdd66, 0.10 - i * 0.02);
      g.fillRect(8 + i * 0.5, 0, 4 - i, 10 - i * 2);
    }
    // 匣身
    g.fillStyle(0x8a5a20, 1);
    g.fillRect(4, 8, 12, 9);
    g.fillStyle(0xddaa44, 1);
    g.fillRect(4, 8, 12, 2);
    // 锁扣
    g.fillStyle(0xffee88, 1);
    g.fillRect(9, 11, 2, 3);
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

  // 回血丹药:碧绿丹丸,与突破丹同为丹丸形状但配色区分
  makeTexture(scene, 'pickup_heal', 14, 14, (g) => {
    for (let i = 0; i < 3; i++) {
      g.fillStyle(0x44ff88, 0.12 - i * 0.03);
      g.fillCircle(7, 7, 7 - i * 2);
    }
    g.fillStyle(0x22aa55, 1);
    g.fillCircle(7, 7, 5);
    g.fillStyle(0xaaffcc, 1);
    g.fillCircle(5, 5, 2);
  });

  // 加修为丹药:青蓝丹丸
  makeTexture(scene, 'pickup_xp_pill', 14, 14, (g) => {
    for (let i = 0; i < 3; i++) {
      g.fillStyle(0x66ccff, 0.12 - i * 0.03);
      g.fillCircle(7, 7, 7 - i * 2);
    }
    g.fillStyle(0x2288cc, 1);
    g.fillCircle(7, 7, 5);
    g.fillStyle(0xcceeff, 1);
    g.fillCircle(5, 5, 2);
  });
}

