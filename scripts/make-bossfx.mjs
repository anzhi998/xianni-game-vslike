#!/usr/bin/env node
/**
 * 首领招式特效贴图 —— 把游戏里那套程序化特效烘成真实 PNG 素材
 *
 * ## 为什么要烘一份 PNG
 *
 * `AssetGenerator.generateBossFx` 用 Phaser.Graphics 现场画这些图,好处是
 * 零素材依赖、随时可改;代价是**它们只能是纯色块** —— 画不出柔和的渐变、
 * 细密的噪点、发光衰减这类只有位图才有的东西。
 *
 * 所以这个脚本走另一条路:用同一套构图、但按**逐像素光栅化**重画一遍,
 * 输出到 `src/assets/`。`AssetLoader` 的「文件名 = 键名」约定会让它们自动
 * 顶掉同名程序化版本(`makeTexture` 首行有 `textures.exists` 守卫),
 * 一行游戏代码都不用改。
 *
 * ## 与程序化版本的构图必须一致
 *
 * 两边是**同一个东西的两种实现**,不是两个设计。尺寸、方位、透明中心这些
 * 约束都写在 `AssetGenerator.generateBossFx` 的注释里 —— 改一边就要改另一边,
 * 否则会出现「程序化版是对的、PNG 版把 Boss 盖住了」这种只在一半环境里复现的 bug。
 *
 * ## 零依赖
 *
 * 与 make-sprite.mjs / make-icons.mjs 同一条路子:只用 node 内置的 zlib
 * 手写 PNG 编码。装个 canvas 或 sharp 能让代码短一半,但会把「跑一次生成脚本」
 * 变成「先 npm install 一个原生模块」—— 在 Windows 上那本身就是一类故障源。
 *
 * ## 用法
 *
 *   node scripts/make-bossfx.mjs            # 全部生成
 *   node scripts/make-bossfx.mjs fx_boss_cast fx_fatemark   # 只做指定的几张
 *   node scripts/make-bossfx.mjs --list     # 列出全部键
 */

import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { deflateSync } from 'node:zlib';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..');
const OUT_DIR = resolve(ROOT, 'src/assets');

// ─── PNG 编码(与 make-sprite.mjs 同一实现) ────────────────────────────────
const CRC_TABLE = new Int32Array(256);
for (let n = 0; n < 256; n++) {
  let c = n;
  for (let k = 0; k < 8; k++) c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
  CRC_TABLE[n] = c >>> 0;
}
const crc32 = (buf) => {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};
const chunk = (type, data) => {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length, 0);
  const t = Buffer.from(type, 'latin1');
  const td = Buffer.concat([t, data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td), 0);
  return Buffer.concat([len, td, crc]);
};
function encodePng(width, height, rgba) {
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0); ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  const stride = width * 4;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (stride + 1)] = 0;
    rgba.copy(raw, y * (stride + 1) + 1, y * stride, y * stride + stride);
  }
  const idat = deflateSync(raw, { level: 6 });
  return Buffer.concat([sig, chunk('IHDR', ihdr), chunk('IDAT', idat), chunk('IEND', Buffer.alloc(0))]);
}

// ─── 画布抽象 ─────────────────────────────────────────────────────────────
/**
 * 一块 RGBA 浮点画布。刻意用**预乘前**的浮点 α,而不是 Uint8——
 * 因为这一批图全是加法混合用的「光」,需要大量半透明叠加;
 * 用 8 位 α 叠加十几层之后会有肉眼可见的台阶(尤其发光衰减)。
 * 最后统一转 8 位,精度损失只发生一次。
 */
class Canvas {
  constructor(w, h) {
    this.w = w; this.h = h;
    this.r = new Float32Array(w * h);
    this.g = new Float32Array(w * h);
    this.b = new Float32Array(w * h);
    this.a = new Float32Array(w * h);
  }
  /** 在 (x,y) 覆盖一层颜色,src-over 合成,alpha 为 0..1 */
  over(x, y, r, g, b, a) {
    if (a <= 0) return;
    const xi = Math.round(x), yi = Math.round(y);
    if (xi < 0 || yi < 0 || xi >= this.w || yi >= this.h) return;
    const i = yi * this.w + xi;
    const sa = Math.min(1, a);
    const da = this.a[i];
    const oa = sa + da * (1 - sa);
    if (oa <= 0) return;
    this.r[i] = (r * sa + this.r[i] * da * (1 - sa)) / oa;
    this.g[i] = (g * sa + this.g[i] * da * (1 - sa)) / oa;
    this.b[i] = (b * sa + this.b[i] * da * (1 - sa)) / oa;
    this.a[i] = oa;
  }
  /** 加法混合覆盖 —— 光效的正确叠法,α 也按「加到满」处理 */
  add(x, y, r, g, b, a) {
    if (a <= 0) return;
    const xi = Math.round(x), yi = Math.round(y);
    if (xi < 0 || yi < 0 || xi >= this.w || yi >= this.h) return;
    const i = yi * this.w + xi;
    this.r[i] += r * a;
    this.g[i] += g * a;
    this.b[i] += b * a;
    this.a[i] = Math.min(1, this.a[i] + a);
  }
  /**
   * 带**抗锯齿**的画线(Bresenham 的超采样版)。
   * 用 4× 子采样:每条线画 4 遍、每遍偏移 1/4 像素再平均 ——
   * 比真 AA 便宜得多,对这个尺寸完全够。硬边线在 128px 的环上毛刺很明显。
   */
  line(x0, y0, x1, y1, r, g, b, a, width = 1) {
    const steps = Math.max(2, Math.ceil(Math.hypot(x1 - x0, y1 - y0) * 2));
    const hw = Math.max(0.5, width / 2);
    for (let s = 0; s <= steps; s++) {
      const t = s / steps;
      const px = x0 + (x1 - x0) * t;
      const py = y0 + (y1 - y0) * t;
      for (let oy = -Math.ceil(hw); oy <= Math.ceil(hw); oy++) {
        for (let ox = -Math.ceil(hw); ox <= Math.ceil(hw); ox++) {
          const d = Math.hypot(ox, oy);
          if (d > hw) continue;
          // 边缘按距离衰减:内部实、外缘虚,这是 AA 的来源
          const fall = d > hw - 1 ? Math.max(0, hw - d) : 1;
          this.over(px + ox, py + oy, r, g, b, a * fall);
        }
      }
    }
  }
  /** 圆环。用解析距离场,边缘一定平滑 —— 环是这批图里最主要的形状 */
  ring(cx, cy, radius, r, g, b, a, width = 2) {
    const hw = Math.max(0.6, width / 2);
    const x0 = Math.floor(cx - radius - hw - 1), x1 = Math.ceil(cx + radius + hw + 1);
    const y0 = Math.floor(cy - radius - hw - 1), y1 = Math.ceil(cy + radius + hw + 1);
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        const d = Math.abs(Math.hypot(x - cx, y - cy) - radius);
        if (d > hw) continue;
        const fall = d > hw - 1 ? Math.max(0, hw - d) : 1;
        this.over(x, y, r, g, b, a * fall);
      }
    }
  }
  /** 实心圆(带 1px 羽化边) */
  disc(cx, cy, radius, r, g, b, a) {
    const x0 = Math.floor(cx - radius - 1), x1 = Math.ceil(cx + radius + 1);
    const y0 = Math.floor(cy - radius - 1), y1 = Math.ceil(cy + radius + 1);
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        const d = Math.hypot(x - cx, y - cy);
        if (d > radius) continue;
        const fall = d > radius - 1 ? Math.max(0, radius - d) : 1;
        this.over(x, y, r, g, b, a * fall);
      }
    }
  }
  /** 三角(用于剑尖/羽尖这类带方向的形状) */
  tri(ax, ay, bx, by, cx2, cy2, r, g, b, a) {
    const minX = Math.floor(Math.min(ax, bx, cx2)) - 1, maxX = Math.ceil(Math.max(ax, bx, cx2)) + 1;
    const minY = Math.floor(Math.min(ay, by, cy2)) - 1, maxY = Math.ceil(Math.max(ay, by, cy2)) + 1;
    const sign = (px, py, x1, y1, x2, y2) => (px - x2) * (y1 - y2) - (x1 - x2) * (py - y2);
    for (let y = minY; y <= maxY; y++) {
      for (let x = minX; x <= maxX; x++) {
        const d1 = sign(x, y, ax, ay, bx, by);
        const d2 = sign(x, y, bx, by, cx2, cy2);
        const d3 = sign(x, y, cx2, cy2, ax, ay);
        const hasNeg = d1 < 0 || d2 < 0 || d3 < 0;
        const hasPos = d1 > 0 || d2 > 0 || d3 > 0;
        if (hasNeg && hasPos) continue;
        this.over(x, y, r, g, b, a);
      }
    }
  }
  /** 旋转矩形 —— 剑身/符纸这类要摆角度的块 */
  box(cx, cy, w, h, angle, r, g, b, a) {
    const cos = Math.cos(angle), sin = Math.sin(angle);
    const hw = w / 2, hh = h / 2;
    const rad = Math.hypot(hw, hh) + 1;
    for (let y = Math.floor(cy - rad); y <= Math.ceil(cy + rad); y++) {
      for (let x = Math.floor(cx - rad); x <= Math.ceil(cx + rad); x++) {
        const dx = x - cx, dy = y - cy;
        const lx = dx * cos + dy * sin;
        const ly = -dx * sin + dy * cos;
        if (Math.abs(lx) <= hw && Math.abs(ly) <= hh) this.over(x, y, r, g, b, a);
      }
    }
  }
  /**
   * 辉光:在已有像素周围按距离铺一层衰减光。
   *
   * 它是这批图「像法术而不像贴纸」的关键 —— 纯色块 + 外圈一点点衰减,
   * 加法混合下就变成了发光体。不铺辉光的图叠上去是硬边的。
   */
  glow(radius, r, g, b, strength) {
    const src = Float32Array.from(this.a);
    for (let y = 0; y < this.h; y++) {
      for (let x = 0; x < this.w; x++) {
        if (src[y * this.w + x] < 0.02) continue;
        const R = Math.ceil(radius);
        for (let oy = -R; oy <= R; oy++) {
          for (let ox = -R; ox <= R; ox++) {
            const d = Math.hypot(ox, oy);
            if (d > radius || d < 0.5) continue;
            const fall = (1 - d / radius) ** 2;
            this.add(x + ox, y + oy, r, g, b, src[y * this.w + x] * fall * strength);
          }
        }
      }
    }
  }
  toPng() {
    const buf = Buffer.alloc(this.w * this.h * 4);
    for (let i = 0; i < this.w * this.h; i++) {
      const a = Math.max(0, Math.min(1, this.a[i]));
      buf[i * 4] = Math.max(0, Math.min(255, Math.round(this.r[i])));
      buf[i * 4 + 1] = Math.max(0, Math.min(255, Math.round(this.g[i])));
      buf[i * 4 + 2] = Math.max(0, Math.min(255, Math.round(this.b[i])));
      buf[i * 4 + 3] = Math.round(a * 255);
    }
    return encodePng(this.w, this.h, buf);
  }
}

// 色值辅助。全部用 RGB 分量而不是 0x 整数 —— 光栅化里到处要单独改一个通道
const rgb = (hex) => [(hex >> 16) & 255, (hex >> 8) & 255, hex & 255];

// ─── 逐张绘制 ──────────────────────────────────────────────────────────────
// ⚠️ 尺寸与 AssetGenerator.generateBossFx 里的 makeTexture 调用必须一致。
//    这里用更大的画布跑同一套构图(真实素材可以更细),但**方位/比例/透明中心
//    三条硬约束必须完全相同** —— 见该函数顶部的注释。

const BUILDERS = {
  /**
   * 首领出手阵。64×64(与程序化版同尺寸)。
   * 中心必须完全透明 —— Boss 立绘要透出来。
   */
  fx_boss_cast() {
    const S = 64, c = S / 2;
    const cv = new Canvas(S, S);
    const [R, G, B] = rgb(0xffffff);
    // 外双环
    cv.ring(c, c, 28, R, G, B, 0.9, 2);
    cv.ring(c, c, 23, R, G, B, 0.5, 1);
    // 八方位刻痕
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2;
      cv.line(c + Math.cos(a) * 23, c + Math.sin(a) * 23,
        c + Math.cos(a) * 28.5, c + Math.sin(a) * 28.5, R, G, B, 0.85, 3);
    }
    // 内圈四段弧
    for (let i = 0; i < 4; i++) {
      const a0 = (i / 4) * Math.PI * 2;
      const steps = 16;
      for (let s = 0; s < steps; s++) {
        const t0 = a0 + (s / steps) * 0.7;
        const t1 = a0 + ((s + 1) / steps) * 0.7;
        cv.line(c + Math.cos(t0) * 17, c + Math.sin(t0) * 17,
          c + Math.cos(t1) * 17, c + Math.sin(t1) * 17, R, G, B, 0.6, 2);
      }
    }
    cv.glow(5, R, G, B, 0.5);
    return cv;
  },

  /**
   * 范围落点的冲击环。128×128。
   * 环画在半径 52 处 —— GameScene.spawnSlamRing 按 52/64 反算缩放,
   * 改这个半径就必须同步改那边,否则视觉范围与判定范围对不上。
   */
  fx_ring_slam() {
    const S = 128, c = S / 2;
    const cv = new Canvas(S, S);
    const [R, G, B] = rgb(0xffffff);
    cv.ring(c, c, 52, R, G, B, 0.95, 7);
    cv.ring(c, c, 42, R, G, B, 0.55, 2);
    cv.ring(c, c, 60, R, G, B, 0.35, 2);
    // 十六道长短交替的放射刺
    for (let i = 0; i < 16; i++) {
      const a = (i / 16) * Math.PI * 2;
      const len = i % 2 === 0 ? 14 : 8;
      cv.line(c + Math.cos(a) * 52, c + Math.sin(a) * 52,
        c + Math.cos(a) * (52 + len), c + Math.sin(a) * (52 + len), R, G, B, 0.8, 4);
    }
    // 环内淡辉光
    for (let i = 0; i < 3; i++) cv.ring(c, c, 46 - i * 6, R, G, B, 0.10 - i * 0.03, 6 - i * 2);
    cv.glow(7, R, G, B, 0.55);
    return cv;
  },

  /**
   * 落点警示的方形符框。128×128。
   * 四角断开、内嵌一圆 —— 方与圆的叠加是「法阵」的经典构图。
   */
  fx_sigil_frame() {
    const S = 128, c = S / 2;
    const cv = new Canvas(S, S);
    const [R, G, B] = rgb(0xffffff);
    const pad = 16, size = S - pad * 2, gap = 22, cg = 16;
    // 四条边(中段),角上留缺口
    cv.line(pad + gap, pad, pad + size - gap, pad, R, G, B, 0.85, 3);
    cv.line(pad + gap, pad + size, pad + size - gap, pad + size, R, G, B, 0.85, 3);
    cv.line(pad, pad + gap, pad, pad + size - gap, R, G, B, 0.85, 3);
    cv.line(pad + size, pad + gap, pad + size, pad + size - gap, R, G, B, 0.85, 3);
    // 四角折角
    cv.line(pad + gap - cg, pad, pad + gap, pad, R, G, B, 0.95, 3);
    cv.line(pad + size - gap, pad, pad + size - gap + cg, pad, R, G, B, 0.95, 3);
    cv.line(pad, pad + gap - cg, pad, pad + gap, R, G, B, 0.95, 3);
    cv.line(pad + size, pad + gap - cg, pad + size, pad + gap, R, G, B, 0.95, 3);
    cv.line(pad + gap - cg, pad + size, pad + gap, pad + size, R, G, B, 0.95, 3);
    cv.line(pad + size - gap, pad + size, pad + size - gap + cg, pad + size, R, G, B, 0.95, 3);
    cv.line(pad, pad + size - gap, pad, pad + size - gap + cg, R, G, B, 0.95, 3);
    cv.line(pad + size, pad + size - gap, pad + size, pad + size - gap + cg, R, G, B, 0.95, 3);
    // 内圆
    cv.ring(c, c, 40, R, G, B, 0.45, 2);
    cv.glow(6, R, G, B, 0.45);
    return cv;
  },

  /**
   * 凌天侯的剑阵领域。160×160。
   * 十二柄剑沿环绕成一圈 + 阵心的十字剑痕。中心留空(Boss 站在阵心)。
   */
  fx_sworddomain() {
    const S = 160, c = S / 2;
    const cv = new Canvas(S, S);
    const [R, G, B] = rgb(0xffffff);
    cv.ring(c, c, 72, R, G, B, 0.75, 2);
    cv.ring(c, c, 62, R, G, B, 0.4, 1);
    // 十二柄指向圆心的剑
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * Math.PI * 2;
      const rIn = 58;
      const tipX = c + Math.cos(a) * rIn, tipY = c + Math.sin(a) * rIn;
      const baseX = c + Math.cos(a) * (rIn + 14), baseY = c + Math.sin(a) * (rIn + 14);
      const px = -Math.sin(a) * 3.5, py = Math.cos(a) * 3.5;
      cv.tri(tipX, tipY, baseX + px, baseY + py, baseX - px, baseY - py, R, G, B, 0.85);
    }
    // 阵心十字剑痕(两个细长菱形)
    const arm = 34, w = 3;
    cv.tri(c - arm, c, c, c - w, c + arm, c, R, G, B, 0.5);
    cv.tri(c - arm, c, c, c + w, c + arm, c, R, G, B, 0.5);
    cv.tri(c, c - arm, c - w, c, c, c + arm, R, G, B, 0.5);
    cv.tri(c, c - arm, c + w, c, c, c + arm, R, G, B, 0.5);
    cv.glow(4, R, G, B, 0.35);
    return cv;
  },

  /**
   * 剑气斩痕。72×24,**朝 +X**。
   * 要被 setRotation(飞行角)转,画反了整道剑光是倒着飞的。
   */
  fx_swordslash() {
    const W = 72, H = 24, mid = H / 2;
    const cv = new Canvas(W, H);
    const [R, G, B] = rgb(0xffffff);
    // 三层渐隐的宽光带
    for (let i = 0; i < 3; i++) {
      cv.tri(4 + i * 2, mid - 8 + i * 2, 4 + i * 2, mid + 8 - i * 2, 60 - i * 4, mid,
        R, G, B, 0.30 - i * 0.09);
    }
    // 柳叶本体(两端收尖)
    cv.tri(6, mid, 30, mid - 7, 30, mid + 7, R, G, B, 1);
    cv.tri(66, mid, 30, mid - 7, 30, mid + 7, R, G, B, 1);
    // 白色核心
    cv.tri(12, mid, 34, mid - 2, 34, mid + 2, R, G, B, 1);
    cv.tri(62, mid, 34, mid - 2, 34, mid + 2, R, G, B, 1);
    // 尾端两缕拖丝
    cv.box(5, mid - 6, 10, 1, 0, R, G, B, 0.6);
    cv.box(5, mid + 5, 10, 1, 0, R, G, B, 0.6);
    cv.glow(5, R, G, B, 0.7);
    return cv;
  },

  /**
   * 分身残影。40×64。人形剪影,不是圆形特效 ——
   * 分身一看就必须是「一个我」,不是一个光球。
   */
  fx_afterimage() {
    const W = 40, H = 64;
    const cv = new Canvas(W, H);
    const [R, G, B] = rgb(0xffffff);
    cv.disc(20, 10, 8, R, G, B, 0.45);                    // 头
    cv.tri(8, 22, 32, 22, 20, 40, R, G, B, 0.40);          // 肩胸
    cv.box(20, 29, 22, 14, 0, R, G, B, 0.40);
    cv.box(6, 35, 5, 22, 0, R, G, B, 0.40);                // 左臂
    cv.box(34, 35, 5, 22, 0, R, G, B, 0.40);               // 右臂
    cv.tri(11, 36, 29, 36, 34, 62, R, G, B, 0.30);         // 道袍下摆
    cv.tri(11, 36, 6, 62, 34, 62, R, G, B, 0.30);
    // 左侧轮廓高光
    cv.box(10, 15, 2, 10, 0, R, G, B, 0.55);
    cv.box(10, 29, 2, 14, 0, R, G, B, 0.55);
    cv.glow(3, R, G, B, 0.4);
    return cv;
  },

  /**
   * 天运子命数符。36×96,竖排不旋转。
   * 符纸底 + 上下横封 + 中央符胆 + 三道横栅。
   */
  fx_fateseal() {
    const W = 36, H = 96, cx = W / 2;
    const cv = new Canvas(W, H);
    const [R, G, B] = rgb(0xffffff);
    // 符纸底
    for (let i = 0; i < 3; i++) cv.box(cx, H / 2, 28 - i * 4, 92 - i * 6, 0, R, G, B, 0.16 - i * 0.04);
    // 上下横封
    cv.box(cx, 6, 28, 4, 0, R, G, B, 0.95);
    cv.box(cx, 90, 28, 4, 0, R, G, B, 0.95);
    // 符胆方框
    cv.ring(18, 48, 26, R, G, B, 0.95, 3); // 近似方框用环代替(方框见下)
    // 精确方框四边
    cv.line(10, 22, 26, 22, R, G, B, 0.95, 3);
    cv.line(10, 74, 26, 74, R, G, B, 0.95, 3);
    cv.line(10, 22, 10, 74, R, G, B, 0.95, 3);
    cv.line(26, 22, 26, 74, R, G, B, 0.95, 3);
    // 中竖
    cv.line(cx, 16, cx, 80, R, G, B, 0.95, 3);
    // 三道横栅(递减)
    const bars = [[12, 24, 34], [13, 23, 48], [14, 22, 62]];
    for (const [x0, x1, y] of bars) cv.line(x0, y, x1, y, R, G, B, 0.85, 2);
    // 中心金辉
    cv.disc(cx, 48, 3, R, G, B, 0.9);
    cv.glow(5, R, G, B, 0.6);
    return cv;
  },

  /**
   * 命数指的落点光柱。48×256。
   * ⚠️ 顶端必须渐透 —— 它要接上「看不见的高处」。画实了就是一个方块。
   * GameScene 用 origin(0.5, 1) 把它立起来,所以**底部是贴地的那一端**。
   */
  fx_fatepillar() {
    const W = 48, H = 256, cx = W / 2;
    const cv = new Canvas(W, H);
    const [R, G, B] = rgb(0xffffff);
    const segs = 64;
    for (let i = 0; i < segs; i++) {
      const y = (i / segs) * H;
      const t = i / (segs - 1);           // 0 = 顶(透) 1 = 底(实)
      cv.box(cx, y + H / segs / 2, 36, H / segs + 1, 0, R, G, B, 0.02 + t * 0.30);
      cv.box(cx, y + H / segs / 2, 8, H / segs + 1, 0, R, G, B, 0.04 + t * 0.42);
    }
    // 两侧符纹刻度
    for (let i = 3; i < segs; i += 6) {
      const y = (i / segs) * H;
      const t = i / (segs - 1);
      cv.box(7, y, 10, 2, 0, R, G, B, 0.15 + t * 0.35);
      cv.box(41, y, 10, 2, 0, R, G, B, 0.15 + t * 0.35);
    }
    cv.glow(6, R, G, B, 0.5);
    return cv;
  },

  /**
   * 命数印记。32×32。菱形 + 十字 + 四角点。
   * 贴在被镀金小怪头顶,不能比怪还大。
   */
  fx_fatemark() {
    const S = 32, c = S / 2;
    const cv = new Canvas(S, S);
    const [R, G, B] = rgb(0xffffff);
    // 外菱形
    cv.line(c, 3, 29, c, R, G, B, 0.95, 2);
    cv.line(29, c, c, 29, R, G, B, 0.95, 2);
    cv.line(c, 29, 3, c, R, G, B, 0.95, 2);
    cv.line(3, c, c, 3, R, G, B, 0.95, 2);
    // 内十字
    cv.line(c, 8, c, 24, R, G, B, 0.9, 2);
    cv.line(8, c, 24, c, R, G, B, 0.9, 2);
    // 四角点
    for (const [x, y] of [[c, 3], [29, c], [c, 29], [3, c]]) cv.disc(x, y, 2, R, G, B, 0.95);
    // 中心亮核
    cv.disc(c, c, 3, R, G, B, 0.85);
    cv.glow(5, R, G, B, 0.7);
    return cv;
  },

  /**
   * 命数指落点的碎屑。24×24。
   * 一小簇不规则的方屑 —— 不是圆,与通用爆尘区分开。
   */
  fx_fateashes() {
    const S = 24;
    const cv = new Canvas(S, S);
    const [R, G, B] = rgb(0xffffff);
    const bits = [
      [3, 5, 3], [10, 2, 2], [17, 6, 3], [7, 11, 2], [14, 12, 3], [20, 15, 2],
      [4, 17, 3], [11, 19, 2], [18, 21, 3], [2, 12, 2], [22, 9, 2], [13, 4, 2],
    ];
    for (const [x, y, s] of bits) cv.box(x + s / 2, y + s / 2, s, s, 0, R, G, B, 0.85);
    for (const [x, y] of [[9, 2], [14, 12], [4, 17]]) cv.box(x + 1, y + 1, 2, 2, 0, R, G, B, 0.9);
    for (const [x, y] of [[17, 6], [20, 15]]) cv.box(x + 1, y + 1, 2, 2, 0, R, G, B, 0.6);
    cv.glow(2, R, G, B, 0.4);
    return cv;
  },
};

// ─── 主流程 ───────────────────────────────────────────────────────────────
const args = process.argv.slice(2);
if (args.includes('--list')) {
  for (const k of Object.keys(BUILDERS)) console.log(k);
  process.exit(0);
}

const targets = args.length > 0 ? args : Object.keys(BUILDERS);
const unknown = targets.filter((t) => !BUILDERS[t]);
if (unknown.length > 0) {
  console.error(`未知键:${unknown.join(', ')}`);
  console.error(`可用键:${Object.keys(BUILDERS).join(', ')}`);
  process.exit(1);
}

mkdirSync(OUT_DIR, { recursive: true });
for (const key of targets) {
  const cv = BUILDERS[key]();
  const png = cv.toPng();
  const out = resolve(OUT_DIR, `${key}.png`);
  writeFileSync(out, png);
  console.log(`${key}.png  ${cv.w}×${cv.h}  ${(png.length / 1024).toFixed(1)} KB`);
}
console.log(`\n共 ${targets.length} 张 → ${OUT_DIR}`);
