/**
 * 程序化资源生成器
 * 用 Phaser.Graphics 绘制所有 sprite 作为 Kenney 素材的占位实现
 * 真实素材可放置到 public/assets/ 后,直接替换 PreloadScene 即可
 */

import Phaser from 'phaser';
import { RELIC_IDS, RELICS } from '../config/RelicConfig';
import { ENEMIES } from '../config/EnemyConfig';
import type { EnemyConfig, EnemyArchetype } from '../types';

export function generateAllAssets(scene: Phaser.Scene): void {
  generateTiles(scene);
  generatePlayer(scene);
  generateEnemies(scene);
  generateProjectiles(scene);
  generateRealmProjectiles(scene);
  generateBossFx(scene);
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

/**
 * 玩家 16×24 的**四个朝向**。
 *
 * 只画三张:`side` 朝右,左边由 `setFlipX` 像素级镜像出来 —— 单独画一张左边
 * 只会带来「两张图的手抖」这种差异,镜像则永远严丝合缝。
 *
 * ⚠️ 三个键**都**要程序化生成。四视图素材是逐步替换的:玩家只做了
 * `player_down` 就上线时,另外两个朝向不能变成空白方块。程序化图正好是
 * 那一档降级 —— 真实素材进来后 `makeTexture` 的 exists 守卫自动顶掉。
 */
const PLAYER_W = 16;
const PLAYER_H = 24;

/** 正面(朝镜头下方)。脸朝下 —— 全局 Y 向下为正 */
function drawPlayerFront(g: Phaser.GameObjects.Graphics): void {
  g.fillStyle(0xf5c89a, 1);
  g.fillRect(5, 2, 6, 6);
  g.fillStyle(0x3a2418, 1);
  g.fillRect(4, 1, 8, 3);
  g.fillStyle(0x000000, 1);
  g.fillRect(6, 4, 1, 1);
  g.fillRect(9, 4, 1, 1);
  g.fillStyle(0x4a4a8a, 1);
  g.fillRect(4, 8, 8, 12);
  g.fillStyle(0x6a6aaa, 1);
  g.fillRect(5, 8, 6, 2);
  g.fillStyle(0x8a6a2a, 1);
  g.fillRect(4, 14, 8, 2);
  g.fillStyle(0x2a2a4a, 1);
  g.fillRect(5, 16, 2, 6);
  g.fillRect(9, 16, 2, 6);
  g.fillStyle(0x1a1a1a, 1);
  g.fillRect(4, 22, 3, 2);
  g.fillRect(9, 22, 3, 2);
}

/**
 * 背面(朝屏幕上方)。
 *
 * 与正面的差别**只在头部**:脸被头发整个盖住,露出后脑与发髻。
 * 袍子和腿完全照抄 —— 背对镜头时它们本来就一样,多画一笔就是多一处
 * 可能和正面画风对不上的地方。
 */
function drawPlayerBack(g: Phaser.GameObjects.Graphics): void {
  g.fillStyle(0xf5c89a, 1);
  g.fillRect(5, 2, 6, 6);
  // 头发盖住整张脸,只在底部露出一线后颈
  g.fillStyle(0x3a2418, 1);
  g.fillRect(4, 1, 8, 7);
  g.fillStyle(0x2a1810, 1);
  g.fillRect(7, 1, 2, 2);
  g.fillStyle(0x4a4a8a, 1);
  g.fillRect(4, 8, 8, 12);
  g.fillStyle(0x6a6aaa, 1);
  g.fillRect(5, 8, 6, 2);
  g.fillStyle(0x8a6a2a, 1);
  g.fillRect(4, 14, 8, 2);
  g.fillStyle(0x2a2a4a, 1);
  g.fillRect(5, 16, 2, 6);
  g.fillRect(9, 16, 2, 6);
  g.fillStyle(0x1a1a1a, 1);
  g.fillRect(4, 22, 3, 2);
  g.fillRect(9, 22, 3, 2);
}

/**
 * 侧面,**朝右**。
 *
 * 朝向感全在这一张上,所以它必须**左右不对称**:袍摆和肩线都往右偏,
 * 右边多一条手臂 + 一截剑柄。画成对称的话,`setFlipX` 翻转在屏幕上
 * 等于什么都没发生 —— 那是这张图最容易白做的地方。
 */
function drawPlayerSide(g: Phaser.GameObjects.Graphics): void {
  g.fillStyle(0xf5c89a, 1);
  g.fillRect(6, 2, 5, 6);
  g.fillStyle(0x3a2418, 1);
  g.fillRect(5, 1, 7, 3);
  g.fillStyle(0x000000, 1);
  g.fillRect(9, 4, 1, 1); // 只露一只眼
  g.fillStyle(0x4a4a8a, 1);
  g.fillRect(4, 8, 8, 12);
  // 袍摆往右甩 —— 朝向的第二处线索
  g.fillRect(4, 16, 10, 4);
  g.fillStyle(0x6a6aaa, 1);
  g.fillRect(5, 8, 6, 2);
  g.fillStyle(0x8a6a2a, 1);
  g.fillRect(4, 14, 8, 2);
  // 持剑的手臂 + 剑柄(只在右侧)
  g.fillStyle(0xf5c89a, 1);
  g.fillRect(10, 10, 3, 2);
  g.fillStyle(0x88ddff, 1);
  g.fillRect(11, 4, 2, 7);
  g.fillStyle(0x2a2a4a, 1);
  g.fillRect(5, 16, 2, 6);
  g.fillRect(9, 18, 2, 4);
  g.fillStyle(0x1a1a1a, 1);
  g.fillRect(4, 22, 3, 2);
  g.fillRect(9, 22, 3, 2);
}

function generatePlayer(scene: Phaser.Scene): void {
  makeTexture(scene, 'player_down', PLAYER_W, PLAYER_H, drawPlayerFront);
  makeTexture(scene, 'player_up', PLAYER_W, PLAYER_H, drawPlayerBack);
  makeTexture(scene, 'player_side', PLAYER_W, PLAYER_H, drawPlayerSide);
  // 旧键:四视图缺哪张时的兜底(也是美术规格表里原本登记的那个键)
  makeTexture(scene, 'player', PLAYER_W, PLAYER_H, drawPlayerFront);

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

/**
 * 程序化怪物贴图是**单帧**的 —— 怪物不走动,所以这里没有帧间变化可画。
 *
 * 真实素材(`src/assets/enemy_*.png`)可以是**等宽横排的多帧图**,
 * `EnemyFrames.ensureEnemyFrames` 会按实际宽度切帧,只取第 0 帧显示。
 */

/** 贴图尺寸由碰撞直径推导(碰撞圆用 cfg.size,贴图比它大一圈免得撞上了还看着没碰到) */
export function enemyTextureSize(cfg: EnemyConfig): { w: number; h: number } {
  const s = cfg.size;
  switch (cfg.archetype) {
    case 'spawnling': return { w: Math.round(s * 1.6), h: Math.round(s * 1.0) };
    case 'caster': return { w: Math.round(s * 1.1), h: Math.round(s * 1.5) };
    case 'soul': return { w: Math.round(s * 1.3), h: Math.round(s * 1.5) };
    case 'beast': return { w: Math.round(s * 1.5), h: Math.round(s * 1.2) };
    case 'tank': return { w: Math.round(s * 1.3), h: Math.round(s * 1.3) };
    case 'bomber': return { w: Math.round(s * 1.3), h: Math.round(s * 1.3) };
    case 'stalker': return { w: Math.round(s * 1.2), h: Math.round(s * 1.4) };
    // 首领:正方形 + 描边余量。它必须一眼看出「这不是杂兵」
    case 'guardian': return { w: Math.round(s * 1.15), h: Math.round(s * 1.15) };
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
    // 首领:巨大的圆盘 + 一圈旋转的焰羽。它在混战里的可辨识度全靠
    // 「比别的怪大一圈且有角冠」这两件事 —— 体型差是首领战的前提
    case 'guardian': {
      const cx = w / 2, cy = h / 2;
      for (let i = 0; i < 6; i++) {
        const a = (i / 6) * Math.PI * 2;
        g.fillStyle(c.accent, 1);
        g.fillTriangle(
          cx + Math.cos(a) * w * 0.42, cy + Math.sin(a) * h * 0.42,
          cx + Math.cos(a + 0.35) * w * 0.20, cy + Math.sin(a + 0.35) * h * 0.20,
          cx + Math.cos(a - 0.35) * w * 0.20, cy + Math.sin(a - 0.35) * h * 0.20,
        );
      }
      g.fillStyle(c.dark, 1);
      g.fillCircle(cx, cy, w * 0.34);
      g.fillStyle(c.body, 1);
      g.fillCircle(cx, cy, w * 0.28);
      g.fillStyle(c.accent, 1);
      g.fillCircle(cx, cy, w * 0.13);
      g.fillStyle(0xffffff, 0.9);
      g.fillCircle(cx - w * 0.06, cy - h * 0.06, w * 0.05);
      break;
    }

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

    // 贴图宽度就是单帧宽 w —— 怪物不走动,程序化图没有帧间变化。
    // 真实素材是同一套反向约定:等宽横排,`EnemyFrames` 按实际宽度切帧只取第 0 帧。
    const drawShape = (
      key: string,
      pal: Palette,
      outline?: number,
    ): void => {
      makeTexture(scene, key, w, h, (g) => {
        drawEnemyShape(g, cfg.archetype, w, h, pal);
        if (outline !== undefined) {
          g.lineStyle(1, outline, 1);
          g.strokeRect(0.5, 0.5, w - 1, h - 1);
        }
      });
    };

    drawShape(`enemy_${id}`, { body, dark, accent });

    // 精英 = 同阶修士:同形状、整体提亮、描金边。
    // 混战里「哪只是精英」必须一秒可辨,这比它长什么样重要
    drawShape(`elite_${id}`, {
      body: brighten(body, 0.35),
      dark: brighten(dark, 0.3),
      accent: 0xffee00,
    }, 0xffcc44);
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

  // 寂灭指:一道贯穿的指气(朝 +X)。
  //
  // ⚠️ 配色是玩家判断法术归属的唯一线索:它必须与 SpellConfig 里
  // jimie 的 color(0xcc44ff)同源。一门指法不能长得像另一门法术,
  // 否则玩家没法从弹体判断自己面对的是什么。
  makeTexture(scene, 'proj_jimie', 20, 6, (g) => {
    g.fillStyle(0xcc44ff, 0.25);
    g.fillRect(0, 2, 15, 2);                       // 指迹
    g.fillStyle(0xcc44ff, 1);
    g.fillTriangle(20, 3, 2, 1, 2, 5);             // 指芒
    g.fillStyle(0xe9b8ff, 1);
    g.fillRect(4, 2, 12, 1);
    g.fillStyle(0xffffff, 1);
    g.fillRect(16, 2, 2, 2);
  });

  // 化魔指(寂灭指的进化形态):一道**宽阔的魔气带**。
  //
  // ⚠️ 尺寸是被数值钉住的:化魔指的碰撞宽度是 2.0 格 = 128px,
  //    比寂灭指的 0.4 格宽 5 倍。贴图如果只画 26px,玩家看到的就是一道
  //    细芒 —— 「范围 ×5」在画面上完全不成立,这就是它表现力不够的根因。
  //    这里画 96px 宽、配合 SpellConfig 的 visualScale: 1.55,
  //    正好把宽度铺到与碰撞体一致。改任何一边都要同步另一边。
  makeTexture(scene, 'proj_huamo', 96, 44, (g) => {
    const h = 44, mid = h / 2;
    // 外层魔气:上下两条渐隐的紫雾
    for (let i = 0; i < 4; i++) {
      g.fillStyle(0x4400aa, 0.3 - i * 0.06);
      g.fillRect(6 + i * 2, 2 + i * 4, 88 - i * 5, h - 4 - i * 8);
    }
    // 带体:前段宽、尾部收窄(读起来像「扫出去」而不是「飞过去」)
    g.fillStyle(0x7700dd, 1);
    g.fillTriangle(0, mid, 16, mid - 18, 16, mid + 18);
    g.fillRect(14, mid - 18, 78, 36);
    // 亮芯
    g.fillStyle(0xbb44ff, 1);
    g.fillRect(18, mid - 11, 74, 22);
    g.fillStyle(0xeeccff, 1);
    g.fillRect(24, mid - 5, 64, 10);
    // 前端锋刃
    g.fillStyle(0xffffff, 1);
    g.fillTriangle(96, mid, 82, mid - 12, 82, mid + 12);
    // 尾端撕裂(几缕散开的魔气)
    g.fillStyle(0xaa22ff, 0.7);
    g.fillRect(0, mid - 16, 10, 4);
    g.fillRect(0, mid + 12, 12, 4);
    g.fillRect(2, mid - 6, 6, 3);
  });

  // 斩罗决的放射剑气:一柄细长的剑芒(朝 +X)。
  //
  // 它与环绕时用的 proj_sword_array(一颗 10px 的青点)必须是两张图 ——
  // 用同一张的话「飞剑射出去了」与「飞剑还在绕圈」在屏幕上没有区别,
  // 那正是玩家反馈「没看到效果」的直接原因。
  makeTexture(scene, 'proj_zhanluo', 40, 14, (g) => {
    const mid = 7;
    for (let i = 0; i < 3; i++) {
      g.fillStyle(0x2288cc, 0.34 - i * 0.1);
      g.fillRect(2 + i, mid - 6 + i * 2, 36 - i * 3, 12 - i * 4);
    }
    // 剑身:尾部渐隐的一段 + 前端收成尖
    g.fillStyle(0x88ddff, 1);
    g.fillTriangle(12, mid - 4, 30, mid - 3, 30, mid + 3);
    g.fillTriangle(12, mid + 4, 30, mid - 3, 30, mid + 3);
    g.fillStyle(0xccf4ff, 1);
    g.fillRect(14, mid - 2, 16, 4);
    // 剑尖
    g.fillStyle(0xffffff, 1);
    g.fillTriangle(40, mid, 30, mid - 4, 30, mid + 4);
    // 后拖的剑气
    g.fillStyle(0x88ddff, 0.55);
    g.fillRect(2, mid - 1, 12, 2);
    g.fillRect(6, mid - 4, 8, 1);
    g.fillRect(6, mid + 3, 8, 1);
  });

  // 厚土术:一道沙砾弹(朝 +X)。
  //
  // 它是全场唯一「土系」的弹体,所以刻意画成一颗粗糙的沙团而不是光滑的光球 ——
  // 关闭特效只看碰撞体时,五种法术仍然是五种可分辨的形状
  makeTexture(scene, 'proj_sand', 14, 14, (g) => {
    for (let i = 0; i < 3; i++) {
      g.fillStyle(0x6a4a22, 0.4 - i * 0.1);
      g.fillCircle(7, 7, 7 - i * 2);
    }
    g.fillStyle(0xc8a05a, 1);
    g.fillCircle(7, 7, 4.2);
    g.fillStyle(0xe8d0a0, 1);
    g.fillCircle(6, 6, 1.6);
    g.fillStyle(0x8a6a3a, 1);
    g.fillRect(9, 5, 2, 1);
    g.fillRect(10, 9, 2, 1);
  });

  // 五雷正法:一颗跳动的雷球(朝 +X)。
  // 瞬时连锁本身是 Graphics 画的折线(见 ChainBolt),这张图只用于
  // 天雷引的空放与形态识别 —— 所以必须是「冷蓝白」而不是火焰色
  makeTexture(scene, 'proj_bolt', 12, 12, (g) => {
    for (let i = 0; i < 3; i++) {
      g.fillStyle(0x4488ff, 0.4 - i * 0.1);
      g.fillCircle(6, 6, 6 - i * 1.6);
    }
    g.fillStyle(0xaaddff, 1);
    g.fillCircle(6, 6, 3);
    g.fillStyle(0xffffff, 1);
    g.fillCircle(5, 5, 1.4);
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

  // 朱雀火羽 —— 首领「火羽扇 / 环形羽爆」的专用弹体,朝 +X,羽尖在前。
  //
  // ⚠️ 为什么不能复用 proj_enemy_shot:那是一个 10px 的圆点,它是**术修**的弹。
  //    首领的招式是它唯一的压迫手段 —— 用一颗小圆点打出去,玩家读到的信息是
  //    「又有远程杂兵开火了」,而不是「朱雀出招了」。同理也不能复用玩家的
  //    proj_fireball:那会让「飞向自己」与「飞向敌人」在混战中混为一谈。
  //
  //    所以火羽在三个维度上与场上任何弹体都不同:形状(羽 ≠ 球)、尺寸(30px ≠ 10px)、
  //    色相(金橙的凤凰焰 ≠ 暗红紫的敌弹 / 正红的玩家火球)。三样同时成立,
  //    关闭特效只看剪影时也分得出「这是首领的招」。
  //
  // ⚠️ 羽尖必须在 +X:EnemyShot.setRotation 直接吃飞行角度,画反了就是「羽毛倒着飞」。
  makeTexture(scene, 'proj_fire_feather', 30, 14, (g) => {
    const mid = 7;
    // 外焰:两层渐隐的橙金,拉开「残焰」的层次
    for (let i = 0; i < 3; i++) {
      g.fillStyle(0xff6600, 0.30 - i * 0.08);
      g.fillTriangle(30 - i * 2, mid, 8 - i * 3, mid - 7 + i * 2, 8 - i * 3, mid + 7 - i * 2);
    }
    // 羽身:前窄后阔,尾端收成两点 —— 读起来像一片被风拽着的羽
    g.fillStyle(0xff8822, 1);
    g.fillTriangle(28, mid, 6, mid - 5, 6, mid + 5);
    g.fillStyle(0xffbb55, 1);
    g.fillTriangle(26, mid, 9, mid - 3, 9, mid + 3);
    // 羽轴高光
    g.fillStyle(0xffeebb, 1);
    g.fillRect(11, mid - 1, 15, 2);
    // 羽尖白热
    g.fillStyle(0xffffff, 1);
    g.fillTriangle(30, mid, 25, mid - 2, 25, mid + 2);
    // 尾部两缕分叉的火丝(与玩家的圆头火球彻底区分)
    g.fillStyle(0xff5500, 0.85);
    g.fillRect(1, mid - 4, 8, 2);
    g.fillRect(1, mid + 2, 8, 2);
    g.fillRect(4, mid - 1, 6, 2);
  });

  // 涅槃火羽 —— 三阶段「浴火重生」后打出的狂暴羽。比基础火羽更红更亮,
  // 并且**换一张图**而不是只加缩放:玩家必须能一眼看出「它变强了」。
  // 同样是 30px 外框(Boss 弹的碰撞圆不随阶段变化,视觉不能反过来暗示更大的判定)
  makeTexture(scene, 'proj_fire_feather_rage', 30, 16, (g) => {
    const mid = 8;
    for (let i = 0; i < 4; i++) {
      g.fillStyle(0xff2200, 0.34 - i * 0.08);
      g.fillTriangle(30 - i * 2, mid, 6 - i * 2, mid - 8 + i * 2, 6 - i * 2, mid + 8 - i * 2);
    }
    g.fillStyle(0xff3300, 1);
    g.fillTriangle(28, mid, 6, mid - 6, 6, mid + 6);
    g.fillStyle(0xff7733, 1);
    g.fillTriangle(26, mid, 9, mid - 4, 9, mid + 4);
    // 白热羽轴:狂暴羽的辨识点是这条命中的亮线
    g.fillStyle(0xfff0cc, 1);
    g.fillRect(10, mid - 1, 16, 3);
    g.fillStyle(0xffffff, 1);
    g.fillTriangle(30, mid, 24, mid - 3, 24, mid + 3);
    // 尾部散得更开的三缕残焰
    g.fillStyle(0xff2200, 0.9);
    g.fillRect(0, mid - 6, 8, 2);
    g.fillRect(0, mid - 1, 9, 2);
    g.fillRect(0, mid + 4, 8, 2);
  });

  // 天运子的签文 —— 一片淡青的符箓。与朱雀的橙金火羽刻意拉开色相(见 BossConfig)
  makeTexture(scene, 'proj_boss_sign', 22, 12, (g) => {
    const mid = 6;
    for (let i = 0; i < 3; i++) {
      g.fillStyle(0x2288aa, 0.28 - i * 0.08);
      g.fillTriangle(22 - i, mid, 5, mid - 6 + i * 2, 5, mid + 6 - i * 2);
    }
    g.fillStyle(0x44ccbb, 1);
    g.fillRect(3, mid - 5, 16, 10);
    g.fillStyle(0x99ffee, 1);
    g.fillRect(5, mid - 3, 12, 6);
    // 符箓上的两道横纹(签文感)
    g.fillStyle(0x1a6677, 1);
    g.fillRect(7, mid - 2, 8, 1);
    g.fillRect(7, mid + 1, 8, 1);
    g.fillStyle(0xffffff, 1);
    g.fillRect(19, mid - 1, 3, 2);
  });

  // 凌天侯的剑气 —— **兜底版**。正式版是美术精修的 src/assets/proj_boss_sword.png
  // (96×14,由 `make-sprite.mjs --aspect free` 从 sword_qi_crop.png 出图,见规格 §3);
  // AssetLoader 先载 PNG,纹理已存在时本函数直接早退。只有 PNG 丢失才会走到这里,
  // 退化成小一号的代码画版 —— 判定不受影响(Boss 弹体一律 4px 碰撞圆,与外观无关)。
  makeTexture(scene, 'proj_boss_sword', 34, 14, (g) => {
    const mid = 7;
    for (let i = 0; i < 3; i++) {
      g.fillStyle(0x2288cc, 0.30 - i * 0.09);
      g.fillRect(2 + i, mid - 6 + i * 2, 30 - i * 3, 12 - i * 4);
    }
    g.fillStyle(0x88ddff, 1);
    g.fillTriangle(10, mid - 4, 26, mid - 3, 26, mid + 3);
    g.fillTriangle(10, mid + 4, 26, mid - 3, 26, mid + 3);
    g.fillStyle(0xccf4ff, 1);
    g.fillRect(12, mid - 2, 14, 4);
    // 剑尖
    g.fillStyle(0xffffff, 1);
    g.fillTriangle(34, mid, 26, mid - 4, 26, mid + 4);
    // 后拖的剑气
    g.fillStyle(0x88ddff, 0.55);
    g.fillRect(2, mid - 1, 10, 2);
  });

  // 拖尾用的白点。4×4 的实心圆,靠 tint 上色 ——
  // 它必须**没有形状**,否则拖尾会变成一串小太阳(见 GameScene 的火羽拖尾)
  makeTexture(scene, 'fx_spark', 4, 4, (g) => {
    g.fillStyle(0xffffff, 1);
    g.fillCircle(2, 2, 2);
  });

  // 攻击命中粒子
  makeTexture(scene, 'fx_hit', 16, 16, (g) => {
    g.fillStyle(0xffdd44, 1);
    g.fillCircle(8, 8, 6);
    g.fillStyle(0xffffff, 1);
    g.fillCircle(8, 8, 2);
  });

  // 暴击星芒。白色打底、靠 tint 上色(金色由调用处给)。
  // 形状必须与 fx_hit 的「通用圆点」拉开 —— 暴击是稀有时刻,它要有自己的形状。
  // 一律朝「无方向」画(旋转随机起始角),与首领特效同一条约定
  makeTexture(scene, 'fx_crit', 24, 24, (g) => {
    g.fillStyle(0xffffff, 1);
    // 主四芒:细长的十字星
    g.fillPoints([
      { x: 12, y: 1 }, { x: 14, y: 10 }, { x: 23, y: 12 }, { x: 14, y: 14 },
      { x: 12, y: 23 }, { x: 10, y: 14 }, { x: 1, y: 12 }, { x: 10, y: 10 },
    ], true);
    // 45° 菱形垫在下面,让星有厚度,不至于缩成一根干瘪的十字
    g.fillPoints([
      { x: 12, y: 7.5 }, { x: 16.5, y: 12 }, { x: 12, y: 16.5 }, { x: 7.5, y: 12 },
    ], true);
  });

  // 定身锁链的一环。白色椭圆环、靠 tint 上金色 —— 与 fx_crit 同一条约定。
  // 使用时相邻两环互转 90°,读出「环环相扣」而不是一排珠子
  makeTexture(scene, 'fx_chain_link', 12, 8, (g) => {
    g.lineStyle(2, 0xffffff, 1);
    g.strokeEllipse(6, 4, 9, 5);
  });
}

/**
 * 首领招式特效
 *
 * ## 为什么首领需要一整套「非弹体」的特效
 *
 * 弹体贴图解决的是「飞在路上的那一发长什么样」,但一招真正的**体量**来自
 * 三个弹体之外的时刻:
 *   1. **出手** —— Boss 抬手蓄力的那一瞬。没有它,弹幕像是凭空刷在脸上;
 *   2. **落点** —— nova/剑阵/命数指砸下去的地方。没有它,伤害像是从空气里扣的;
 *   3. **场所** —— 环绕的剑阵、脚下的法域。没有它,阶段机制不可见。
 *
 * 原先这三处全都在复用 `fx_hit`(16px 的黄色圆点)。那是个**通用**特效,
 * 它在杂兵身上是对的,但在首领身上会把「首领出招了」降级成「哪里炸了一下」。
 * 首领是每局的节奏顶点,它的每一层反馈都该有自己的身份。
 *
 * ## 命名与色系约定
 *
 * `fx_<boss>_<用途>`。色系跟着该 Boss 的弹体走(见 BossConfig):
 *   - 凌天侯 = 青白剑系(0x88ddff),冷、锐、快 —— 与它的「低伤高频率」同调
 *   - 天运子 = 青金符系(0x44ccbb 符 / 0xd8b860 金),古、沉、慢
 * 色系必须与弹体同源,否则玩家无法把「地上炸开的那片」和「打中我的那发」联系起来。
 *
 * ## 一律朝「无方向」画
 *
 * 这些图都会被旋转使用(或本就该对称),所以**不要**画带朝向的构图 ——
 * 带朝向的东西一律留给弹体(它们吃 `setRotation(飞行角度)`)。
 * 唯一例外是下面明确标注了 `朝 +X` 的那几张。
 */
function generateBossFx(scene: Phaser.Scene): void {
  // ---------------------------------------------------------------------
  // 通用:首领出手阵
  //
  // 蓄力前摇(WINDUP_MS)期间贴在 Boss 身上的一圈符文。它是**加法混合**的,
  // 所以颜色用纯白 + 内圈留暗,靠 tint 上色 —— 一套图服务所有 Boss。
  //
  // ⚠️ 中心必须完全透明:Boss 的立绘要透过它露出来。画成实心圆盘的话,
  //    前摇那 0.3 秒 Boss 会变成一盏灯。
  // ---------------------------------------------------------------------
  makeTexture(scene, 'fx_boss_cast', 64, 64, (g) => {
    const c = 32;
    // 外圈:两道同心圆环,一实一虚,读起来像「法阵在转」
    g.lineStyle(2, 0xffffff, 0.9);
    g.strokeCircle(c, c, 28);
    g.lineStyle(1, 0xffffff, 0.5);
    g.strokeCircle(c, c, 23);
    // 八个方位的刻痕:外圈上的短放射线。前摇时整张图在自转,
    // 这些刻痕是「它在转」的唯一线索 —— 没有它们,旋转看不出来
    g.lineStyle(3, 0xffffff, 0.85);
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2;
      const x1 = c + Math.cos(a) * 23;
      const y1 = c + Math.sin(a) * 23;
      const x2 = c + Math.cos(a) * 28;
      const y2 = c + Math.sin(a) * 28;
      g.lineBetween(x1, y1, x2, y2);
    }
    // 内圈:四道短弧,与外圈反向转(靠调用侧的 scale 翻转就行,这里只画一圈)
    g.lineStyle(2, 0xffffff, 0.6);
    for (let i = 0; i < 4; i++) {
      const a0 = (i / 4) * Math.PI * 2;
      g.beginPath();
      g.arc(c, c, 17, a0, a0 + 0.7);
      g.strokePath();
    }
  });

  // ---------------------------------------------------------------------
  // 通用:范围招落点的冲击环
  //
  // nova / 剑阵 / 命数指砸下去的那一瞬铺在地上的一圈光环。朝**无方向**,
  // 用 `setScale(radius * 2 / 与) ` 铺到实际范围 —— 所以尺寸只是比例参考。
  //
  // ⚠️ 它是**空心**的:环内留透明,地面要看得见。实心圆盘会把落点变成一个
  //    大白斑,反而盖掉了「这里刚被砸过」的地面反馈(震屏与爆尘)。
  // ---------------------------------------------------------------------
  makeTexture(scene, 'fx_ring_slam', 128, 128, (g) => {
    const c = 64;
    // 主环:一圈粗环 + 内侧一道细环,拉出「冲击波有厚度」的层次
    g.lineStyle(7, 0xffffff, 0.95);
    g.strokeCircle(c, c, 52);
    g.lineStyle(2, 0xffffff, 0.55);
    g.strokeCircle(c, c, 42);
    g.lineStyle(2, 0xffffff, 0.35);
    g.strokeCircle(c, c, 60);
    // 十六道放射短刺:让环看起来是「炸开」而不是「画上去的」
    // 长短交替 —— 等长的刺会读成一个齿轮,交替才有冲击的不规则感
    g.lineStyle(4, 0xffffff, 0.8);
    for (let i = 0; i < 16; i++) {
      const a = (i / 16) * Math.PI * 2;
      const len = i % 2 === 0 ? 14 : 8;
      const x1 = c + Math.cos(a) * 52;
      const y1 = c + Math.sin(a) * 52;
      const x2 = c + Math.cos(a) * (52 + len);
      const y2 = c + Math.sin(a) * (52 + len);
      g.lineBetween(x1, y1, x2, y2);
    }
    // 环内的一点点辉光(很淡,只为托住环,不遮地)
    for (let i = 0; i < 3; i++) {
      g.lineStyle(6 - i * 2, 0xffffff, 0.10 - i * 0.03);
      g.strokeCircle(c, c, 46 - i * 6);
    }
  });

  // ---------------------------------------------------------------------
  // 通用:落点警示里的符文边
  //
  // 给「地面预警圈」(火雨/命数指)叠一层**方形**符文框,把原本的光秃圆圈
  // 变成「有人在地上写了字」。方与圆叠加是修真法阵的经典构图,
  // 也让它一眼区别于玩家自己的蓝色范围技(那些是纯圆)。
  // ---------------------------------------------------------------------
  makeTexture(scene, 'fx_sigil_frame', 128, 128, (g) => {
    const pad = 16;
    const size = 128 - pad * 2;
    // 外层方框 + 内层方框(四角断开,读起来像「符」而不是「UI 选中框」)
    g.lineStyle(3, 0xffffff, 0.85);
    // 四条边各画中段,角上留缺口
    const gap = 22;
    g.lineBetween(pad + gap, pad, pad + size - gap, pad);                       // 上
    g.lineBetween(pad + gap, pad + size, pad + size - gap, pad + size);         // 下
    g.lineBetween(pad, pad + gap, pad, pad + size - gap);                       // 左
    g.lineBetween(pad + size, pad + gap, pad + size, pad + size - gap);         // 右
    // 四角:各画一个折角(向内拐的短边),把缺口的断口收成「角」
    g.lineStyle(3, 0xffffff, 0.95);
    const cg = 16;
    g.lineBetween(pad, pad + gap, pad, pad + gap - cg + cg); // 左上的竖已画,这里补横
    g.lineBetween(pad + gap - cg, pad, pad + gap, pad);
    g.lineBetween(pad + size - gap, pad, pad + size - gap + cg, pad);
    g.lineBetween(pad + size, pad + gap - cg, pad + size, pad + gap);
    g.lineBetween(pad, pad + size - gap, pad, pad + size - gap + cg);
    g.lineBetween(pad + gap - cg, pad + size, pad + gap, pad + size);
    g.lineBetween(pad + size - gap, pad + size, pad + size - gap + cg, pad + size);
    g.lineBetween(pad + size, pad + size - gap, pad + size, pad + size - gap + cg);
    // 内圈的圆:方与圆的接缝,是这套构图的重心
    g.lineStyle(2, 0xffffff, 0.45);
    g.strokeCircle(64, 64, 40);
  });

  // ---------------------------------------------------------------------
  // 凌天侯:剑阵领域
  //
  // 「剑阵围杀」的**场所**。原先这一招完全没有视觉主体 —— 只有一堆剑气球
  // 从 Boss 身上扇形喷出来,玩家看不到「阵」在哪里。
  //
  // 画成**环 + 内十字剑痕**:环是围杀的范围,十字是剑意。
  // 朝无方向,用 tint 上青白色,叠在 Boss 脚下随它走。
  // ⚠️ 中心留空 —— Boss 站在阵心,不能把它自己盖掉。
  // ---------------------------------------------------------------------
  makeTexture(scene, 'fx_sworddomain', 160, 160, (g) => {
    const c = 80;
    // 外环:两圈细环
    g.lineStyle(2, 0xffffff, 0.75);
    g.strokeCircle(c, c, 72);
    g.lineStyle(1, 0xffffff, 0.4);
    g.strokeCircle(c, c, 62);
    // 十二柄剑的剪影:沿环均匀分布的小剑(朝心的方向),这是「剑阵」二字的本体
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * Math.PI * 2;
      const rIn = 58;
      const tipX = c + Math.cos(a) * rIn;
      const tipY = c + Math.sin(a) * rIn;
      // 剑尖指向圆心:从环上往里画一个细长三角
      const baseX = c + Math.cos(a) * (rIn + 14);
      const baseY = c + Math.sin(a) * (rIn + 14);
      const perpX = -Math.sin(a) * 3.5;
      const perpY = Math.cos(a) * 3.5;
      g.fillStyle(0xffffff, 0.85);
      g.fillTriangle(tipX, tipY, baseX + perpX, baseY + perpY, baseX - perpX, baseY - perpY);
    }
    // 内十字剑痕:两道细长的菱形交叉,是阵心的「剑意」所在
    g.fillStyle(0xffffff, 0.5);
    const arm = 34;
    const w = 3;
    // 横向
    g.fillTriangle(c - arm, c, c, c - w, c + arm, c);
    g.fillTriangle(c - arm, c, c, c + w, c + arm, c);
    // 纵向
    g.fillTriangle(c, c - arm, c - w, c, c, c + arm);
    g.fillTriangle(c, c - arm, c + w, c, c, c + arm);
  });

  // ---------------------------------------------------------------------
  // 天运子:杀戮仙决的白色护体符印
  //
  // 它**不是地面标记**,而是悬在本体四周的阵纹 —— 与剑域的「贴地」相反。
  //
  // 为什么敢用纯白:天运子身上已有的两层颜色是紫(本体 0x8855ee)与青金
  // (签文/命数 0x44ccbb、0xd8b860),白在这个色域里没有任何东西能冒充。
  // 而且它是**唯一一个「别打它」的信号** —— 与所有「小心,要来了」的红橙黄
  // 都不同类,玩家不需要再学一种新语义。
  //
  // ---------------------------------------------------------------------
  // 杀戮仙诀·符印(fx_sigil, 96×96)
  //
  // 参考图(仙侠剧护体符阵):白色半透明的**圆形符印**悬在角色四周,
  // 而不是一整块玻璃罩。多层同心环 + 放射刻度 + 内圈纹样,
  // 纯白(理由同上:天运子的紫/青金色域里,白只属于「打不动」)。
  //
  // ⚠️ 外环画在距中心 44px 处,必须与 BossConfig.SIGIL_TEXTURE_RADIUS 一致
  // ---------------------------------------------------------------------
  makeTexture(scene, 'fx_sigil', 96, 96, (g) => {
    const c = 48;
    const R = 44;
    // 外壳:亮环 + 内衬细环 —— 符印的「边框」
    g.lineStyle(2.5, 0xffffff, 0.95);
    g.strokeCircle(c, c, R);
    g.lineStyle(1, 0xffffff, 0.4);
    g.strokeCircle(c, c, R - 5);
    // 放射刻度:一圈短齿,转起来时最出「阵法在转」的味道
    for (let i = 0; i < 24; i++) {
      const a = (i / 24) * Math.PI * 2;
      const r1 = i % 2 === 0 ? R - 5 : R - 10;
      g.lineStyle(1.5, 0xffffff, i % 2 === 0 ? 0.8 : 0.45);
      g.lineBetween(c + Math.cos(a) * r1, c + Math.sin(a) * r1,
        c + Math.cos(a) * (R - 1), c + Math.sin(a) * (R - 1));
    }
    // 中环:四段断弧 —— 参考图里那种「环中套环、断口藏纹」的层次
    for (let i = 0; i < 4; i++) {
      g.lineStyle(2, 0xffffff, 0.55);
      g.beginPath();
      g.arc(c, c, 30, (i / 4) * Math.PI * 2 + 0.18, ((i + 1) / 4) * Math.PI * 2 - 0.18);
      g.strokePath();
    }
    // 内环:实线细环 + 四方位小圆点(对应「四个方位」的阵眼)
    g.lineStyle(1.5, 0xffffff, 0.65);
    g.strokeCircle(c, c, 19);
    for (let i = 0; i < 4; i++) {
      const a = (i / 4) * Math.PI * 2 + Math.PI / 4;
      g.fillStyle(0xffffff, 0.9);
      g.fillCircle(c + Math.cos(a) * 19, c + Math.sin(a) * 19, 2.5);
    }
    // 芯:小实心圆 + 一圈淡光晕 —— 符印的「眼」
    g.fillStyle(0xffffff, 0.12);
    g.fillCircle(c, c, 12);
    g.fillStyle(0xffffff, 0.85);
    g.fillCircle(c, c, 4);
  });

  // ---------------------------------------------------------------------
  // 凌天侯:剑气斩痕(命中/落点)
  //
  // 一道**斜向**的剑光划痕,青白双色。用在剑气命中玩家、以及剑阵落点。
  //
  // `朝 +X` 是刻意的:虽然看起来像「一道痕」,但它要被 `setRotation(角度)`
  // 转到挥来的方向 —— 一道不跟着来的剑光是说不通的。
  // ---------------------------------------------------------------------
  makeTexture(scene, 'fx_swordslash', 72, 24, (g) => {
    const mid = 12;
    // 外辉:一道渐隐的宽光带
    for (let i = 0; i < 3; i++) {
      g.fillStyle(0x2288cc, 0.30 - i * 0.09);
      g.fillTriangle(4 + i * 2, mid - 8 + i * 2, 4 + i * 2, mid + 8 - i * 2, 60 - i * 4, mid);
    }
    // 剑光本体:两端收尖的一道柳叶
    g.fillStyle(0x88ddff, 1);
    g.fillTriangle(6, mid, 30, mid - 7, 30, mid + 7);
    g.fillTriangle(66, mid, 30, mid - 7, 30, mid + 7);
    // 白色核心:细长的一条,是「锐」的来源
    g.fillStyle(0xffffff, 1);
    g.fillTriangle(12, mid, 34, mid - 2, 34, mid + 2);
    g.fillTriangle(62, mid, 34, mid - 2, 34, mid + 2);
    // 尾端两层拖丝(切空了的两缕剑气)
    g.fillStyle(0x88ddff, 0.6);
    g.fillRect(0, mid - 6, 10, 1);
    g.fillRect(0, mid + 5, 10, 1);
  });

  // ---------------------------------------------------------------------
  // 凌天侯:分身残影
  //
  // 「分身戏耍」机制。设计文档要求它「分裂 3 个分身分散站位」——
  // 但机制尚未实现。这里先把**残影**这张图备好:画成一个人形轮廓的虚线体,
  // 半透明,用于 Boss 闪现(blink)的起落点,以及将来的分身表现。
  //
  // ⚠️ 它是**人形剪影**,不是圆形特效:分身一看就必须是「一个我」,
  //    不是一个光球。轮廓只给肩到脚的一段,不画脸 —— 留白让玩家自己补。
  // ---------------------------------------------------------------------
  makeTexture(scene, 'fx_afterimage', 40, 64, (g) => {
    // 头
    g.fillStyle(0x88ddff, 0.45);
    g.fillCircle(20, 10, 8);
    // 肩/胸:上宽下窄的梯形
    g.fillStyle(0x88ddff, 0.40);
    g.fillTriangle(8, 22, 32, 22, 20, 40);
    g.fillRect(9, 22, 22, 14);
    // 双臂:两条垂下的细条
    g.fillRect(4, 24, 5, 22);
    g.fillRect(31, 24, 5, 22);
    // 下摆:散开的道袍
    g.fillStyle(0x88ddff, 0.30);
    g.fillTriangle(11, 36, 29, 36, 34, 62);
    g.fillTriangle(11, 36, 6, 62, 34, 62);
    // 轮廓高光:只在左侧描一条,给一点体积感
    g.fillStyle(0xccf4ff, 0.55);
    g.fillRect(9, 10, 2, 10);
    g.fillRect(9, 22, 2, 14);
  });

  // ---------------------------------------------------------------------
  // 天运子:命数符
  //
  // 天运子的**场所与预告**共用一张。它是一道竖长的符箓纹样,
  // 用于:命数指的落点柱、fate 镀金时在小怪头上闪一下的印记。
  //
  // 色系走符青(0x44ccbb)+ 金(0xd8b860)—— 与它的签文弹、落点圈同源。
  // 朝无方向(竖排,不转)。
  // ---------------------------------------------------------------------
  makeTexture(scene, 'fx_fateseal', 36, 96, (g) => {
    const cx = 18;
    // 符纸底:一道很淡的竖长条,给纹样一个「承托面」
    for (let i = 0; i < 3; i++) {
      g.fillStyle(0x22aa99, 0.16 - i * 0.04);
      g.fillRect(4 + i * 2, 2 + i * 3, 28 - i * 4, 92 - i * 6);
    }
    // 上下两道横封(符头符尾)
    g.fillStyle(0x44ccbb, 0.95);
    g.fillRect(4, 4, 28, 4);
    g.fillRect(4, 88, 28, 4);
    // 中央符胆:一个竖长的方框 + 贯穿的一竖,是「命」字的抽象
    g.lineStyle(3, 0xd8b860, 0.95);
    g.strokeRect(10, 22, 16, 52);
    g.lineStyle(3, 0xd8b860, 0.95);
    g.lineBetween(cx, 16, cx, 80);
    // 三道横栅:符胆上的刻纹,越往下越短(收势)
    g.lineStyle(2, 0x44ccbb, 0.85);
    g.lineBetween(12, 34, 24, 34);
    g.lineBetween(13, 48, 23, 48);
    g.lineBetween(14, 62, 22, 62);
    // 一点金辉:符胆中心,是整张图最亮的地方
    g.fillStyle(0xffeebb, 0.9);
    g.fillCircle(cx, 48, 3);
  });

  // ---------------------------------------------------------------------
  // 天运子:命数指的落点柱
  //
  // 命数指从天而降时,指尖到地面之间**本该有一道光柱** —— 没有它,玩家
  // 只看到一个圈在缩,不知道东西是从哪来的。这张图是一根竖长条,
  // 从上（透明)到下(实)渐变,叠在落点圈上。
  //
  // ⚠️ 顶端必须渐透:它要接上「看不见的高处」。顶端画实了就成了一个方块。
  // ---------------------------------------------------------------------
  makeTexture(scene, 'fx_fatepillar', 48, 256, (g) => {
    const cx = 24;
    // 光柱主体:分 16 段往下画,alpha 由 0.02 线性升到 0.30
    const segs = 16;
    const segH = 256 / segs;
    for (let i = 0; i < segs; i++) {
      const y = i * segH;
      const t = i / (segs - 1);
      g.fillStyle(0xd8b860, 0.02 + t * 0.30);
      g.fillRect(6, y, 36, segH);
    }
    // 中轴亮线:比柱身更亮的细芯,同样是上透下实
    for (let i = 0; i < segs; i++) {
      const y = i * segH;
      const t = i / (segs - 1);
      g.fillStyle(0xffeecc, 0.04 + t * 0.42);
      g.fillRect(cx - 4, y, 8, segH);
    }
    // 两侧的符纹刻度:每隔一段来一道短短的横纹,把光柱读成「一炷香」
    for (let i = 3; i < segs; i += 3) {
      const y = i * segH;
      const t = i / (segs - 1);
      g.fillStyle(0x44ccbb, 0.15 + t * 0.35);
      g.fillRect(2, y, 10, 2);
      g.fillRect(36, y, 10, 2);
    }
  });

  // ---------------------------------------------------------------------
  // 天运子:镀金/命数印记
  //
  // `fate` 招的视觉:被强化的小怪应该「头上一亮」。原先完全没有这个反馈,
  // 玩家只觉得怪忽然变硬了。
  //
  // 画成一个小型的对称符印(菱形 + 十字 + 四角点),金色。
  // 尺寸小(32),因为它要贴在小怪头顶,不能比怪还大。
  // ---------------------------------------------------------------------
  makeTexture(scene, 'fx_fatemark', 32, 32, (g) => {
    const c = 16;
    // 外菱形
    g.lineStyle(2, 0xd8b860, 0.95);
    g.beginPath();
    g.moveTo(c, 3);
    g.lineTo(29, c);
    g.lineTo(c, 29);
    g.lineTo(3, c);
    g.closePath();
    g.strokePath();
    // 内十字
    g.lineStyle(2, 0xffeecc, 0.9);
    g.lineBetween(c, 8, c, 24);
    g.lineBetween(8, c, 24, c);
    // 四角点
    g.fillStyle(0x44ccbb, 0.95);
    g.fillCircle(c, 3, 2);
    g.fillCircle(29, c, 2);
    g.fillCircle(c, 29, 2);
    g.fillCircle(3, c, 2);
    // 中心亮核
    g.fillStyle(0xffeebb, 0.85);
    g.fillCircle(c, c, 3);
  });

  // ---------------------------------------------------------------------
  // 天运子:命数指的落尘
  //
  // 指落之后地面扬起的尘/纸屑。原先 onFingerSlam 用的是通用爆尘。
  // 画成一小簇不规则的碎屑(不是圆),金色 —— 与「符纸碎掉」呼应。
  // ---------------------------------------------------------------------
  makeTexture(scene, 'fx_fateashes', 24, 24, (g) => {
    // 十余片大小不一的方屑,位置固定(程序化素材不用随机,否则每次热重载都变)
    const bits: Array<[number, number, number]> = [
      [3, 5, 3], [10, 2, 2], [17, 6, 3], [7, 11, 2], [14, 12, 3], [20, 15, 2],
      [4, 17, 3], [11, 19, 2], [18, 21, 3], [2, 12, 2], [22, 9, 2], [13, 4, 2],
    ];
    for (const [x, y, s] of bits) {
      g.fillStyle(0xd8b860, 0.85);
      g.fillRect(x, y, s, s);
    }
    // 亮一点的几片,让这堆碎屑有层次
    g.fillStyle(0xffeebb, 0.9);
    g.fillRect(9, 2, 2, 2);
    g.fillRect(14, 12, 2, 2);
    g.fillRect(4, 17, 2, 2);
    // 一点符青的余烬
    g.fillStyle(0x44ccbb, 0.6);
    g.fillRect(17, 6, 2, 2);
    g.fillRect(20, 15, 2, 2);
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

  // 剑阵的飞剑:细长的一柄,尖端朝 +X
  orb('proj_sword_array', 0x88ddff, 10, 10);

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

  // 遗物掉落:悬浮的法宝剪影,四周有光晕
  makeTexture(scene, 'pickup_relic', 16, 16, (g) => {
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

  // 每件遗物一张独立纹理。
  //
  // 所有遗物共用一张图的话,地面上的遗物彼此无法区分,玩家只能捡起来
  // 才知道捡到了什么。按 RelicConfig.color 上色,并且与遗物面板图标的配色
  // 完全一致 —— 看到地上一抹紫,就知道捡的是散魔铠甲。
  for (const id of RELIC_IDS) {
    const color = RELICS[id].color;
    makeTexture(scene, `pickup_relic_${id}`, 16, 16, (g) => {
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

  // 洞府宝箱:全场最显眼的一件 —— 宝匣 + 向上窜的光柱,
  // 20px(其他掉落物 14-16px)且最亮,为了它改变走位是值得的。
  //
  // 三档品质各一张:木匣 1 次悟道、玉盒 3 次、金匮 5 次,而它们掉在地上
  // 是同一件东西 —— 不区分的话玩家没法判断「这一趟值不值得冒险去捡」。
  const chest = (key: string, glow: number, body: number, lid: number, lock: number) =>
    makeTexture(scene, key, 20, 20, (g) => {
      for (let i = 0; i < 4; i++) {
        g.fillStyle(glow, 0.10 - i * 0.02);
        g.fillRect(8 + i * 0.5, 0, 4 - i, 10 - i * 2);
      }
      g.fillStyle(body, 1);
      g.fillRect(4, 8, 12, 9);
      g.fillStyle(lid, 1);
      g.fillRect(4, 8, 12, 2);
      g.fillStyle(lock, 1);
      g.fillRect(9, 11, 2, 3);
    });
  chest('pickup_chest_wood', 0xbbbbbb, 0x6a4a2a, 0x9a7a4a, 0xcccccc);
  chest('pickup_chest_jade', 0x66ccff, 0x2a4a6a, 0x66aaff, 0xaaddff);
  chest('pickup_chest_gold', 0xffdd66, 0x8a5a20, 0xddaa44, 0xffee88);
  // 兼容键:旧存档 / 旧掉落表引用的通用宝匣
  chest('pickup_chest', 0xffdd66, 0x8a5a20, 0xddaa44, 0xffee88);

  // 洞府遗宝的替代图:金色丹丸(灵石袋)
  makeTexture(scene, 'pickup_stone', 14, 14, (g) => {
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

