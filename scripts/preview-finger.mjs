#!/usr/bin/env node
/**
 * 命数指形态预览 —— 把 FingerOfFate 的绘制逻辑在 node 里跑一遍,输出一张 PNG。
 *
 * ## 为什么需要它
 *
 * 「这根东西像不像手指」是一个**纯视觉**问题。在浏览器里验证要启动 dev server、
 * 等 20 分钟 Boss 刷新或翻调试面板、再截图 —— 而形态本身**每改一次参数就要看一次**。
 *
 * 所以这里把绘制逻辑复制一份到 node 里(纯几何,没有 Phaser 依赖),
 * 一次跑出四个进度快照拼成一张图。改参数 → 重跑 → 看图,两秒一轮。
 *
 * ## 必须与 FingerOfFate.ts 保持一致
 *
 * `silhouetteHalfWidth` 与 `drawFingerBody` 的几何是**照抄**过来的。
 * 改了指形公式就要同步改这里,否则预览会开始撒谎 ——
 * 而一个撒谎的预览比没有预览更糟。
 */
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { deflateSync } from 'node:zlib';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..');
const OUT = resolve(ROOT, '.preview');

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
  ihdr[8] = 8; ihdr[9] = 6;
  const stride = width * 4;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (stride + 1)] = 0;
    rgba.copy(raw, y * (stride + 1) + 1, y * stride, y * stride + stride);
  }
  const idat = deflateSync(raw, { level: 6 });
  return Buffer.concat([sig, chunk('IHDR', ihdr), chunk('IDAT', idat), chunk('IEND', Buffer.alloc(0))]);
}

// ─── 与 FingerOfFate.ts 同步的常量 ─────────────────────────────────────────
const DROP_HEIGHT = 620;
const FINGER_WIDTH_RATIO = 0.46;
const TIP_LEAN = 0.28;
const NAIL_RATIO = 0.5;
const COLOR = [0xd8, 0xb8, 0x60];
const GROUND = [0x4a, 0x26, 0x20]; // 朱雀星地面色,用来判可读性

function silhouetteHalfWidth(t) {
  const taper = 1 - Math.pow(t, 1.7) * 0.5;
  const knuckle = Math.abs(t - 0.38) < 0.06 ? 0.13
    : Math.abs(t - 0.68) < 0.06 ? 0.10 : 0;
  const pad = Math.abs(t - 0.53) < 0.05 ? 0.05
    : Math.abs(t - 0.83) < 0.05 ? 0.04 : 0;
  return Math.max(0.04, taper - knuckle + pad);
}

class Canvas {
  constructor(w, h) {
    this.w = w; this.h = h;
    this.r = new Float32Array(w * h);
    this.g = new Float32Array(w * h);
    this.b = new Float32Array(w * h);
    this.a = new Float32Array(w * h);
  }
  over(x, y, r, g, b, a) {
    if (a <= 0) return;
    const xi = Math.round(x), yi = Math.round(y);
    if (xi < 0 || yi < 0 || xi >= this.w || yi >= this.h) return;
    const i = yi * this.w + xi;
    const sa = Math.min(1, a), da = this.a[i];
    const oa = sa + da * (1 - sa);
    if (oa <= 0) return;
    this.r[i] = (r * sa + this.r[i] * da * (1 - sa)) / oa;
    this.g[i] = (g * sa + this.g[i] * da * (1 - sa)) / oa;
    this.b[i] = (b * sa + this.b[i] * da * (1 - sa)) / oa;
    this.a[i] = oa;
  }
  add(x, y, r, g, b, a) {
    if (a <= 0) return;
    const xi = Math.round(x), yi = Math.round(y);
    if (xi < 0 || yi < 0 || xi >= this.w || yi >= this.h) return;
    const i = yi * this.w + xi;
    this.r[i] += r * a; this.g[i] += g * a; this.b[i] += b * a;
    this.a[i] = Math.min(1, this.a[i] + a);
  }
  disc(cx, cy, rad, r, g, b, a) {
    for (let y = Math.floor(cy - rad - 1); y <= Math.ceil(cy + rad + 1); y++) {
      for (let x = Math.floor(cx - rad - 1); x <= Math.ceil(cx + rad + 1); x++) {
        const d = Math.hypot(x - cx, y - cy);
        if (d > rad) continue;
        const fall = d > rad - 1 ? Math.max(0, rad - d) : 1;
        this.over(x, y, r, g, b, a * fall);
      }
    }
  }
  ellip(cx, cy, rx, ry, r, g, b, a) {
    for (let y = Math.floor(cy - ry - 1); y <= Math.ceil(cy + ry + 1); y++) {
      for (let x = Math.floor(cx - rx - 1); x <= Math.ceil(cx + rx + 1); x++) {
        const d = ((x - cx) / rx) ** 2 + ((y - cy) / ry) ** 2;
        if (d > 1) continue;
        this.over(x, y, r, g, b, a);
      }
    }
  }
  /** 闭合多边形填充(扫描线,非零环绕不做 —— 这些轮廓都是凸/简单多边形) */
  poly(pts, r, g, b, a) {
    let minY = Infinity, maxY = -Infinity;
    for (const p of pts) { minY = Math.min(minY, p[1]); maxY = Math.max(maxY, p[1]); }
    for (let y = Math.floor(minY); y <= Math.ceil(maxY); y++) {
      const xs = [];
      for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
        const [x1, y1] = pts[j], [x2, y2] = pts[i];
        if ((y1 <= y && y2 > y) || (y2 <= y && y1 > y)) {
          xs.push(x1 + ((y - y1) / (y2 - y1)) * (x2 - x1));
        }
      }
      xs.sort((p, q) => p - q);
      for (let k = 0; k + 1 < xs.length; k += 2) {
        for (let x = Math.floor(xs[k]); x <= Math.ceil(xs[k + 1]); x++) {
          this.over(x, y, r, g, b, a);
        }
      }
    }
  }
  ring(cx, cy, radius, r, g, b, a, width) {
    const hw = Math.max(0.6, width / 2);
    for (let y = Math.floor(cy - radius - hw - 1); y <= Math.ceil(cy + radius + hw + 1); y++) {
      for (let x = Math.floor(cx - radius - hw - 1); x <= Math.ceil(cx + radius + hw + 1); x++) {
        const d = Math.abs(Math.hypot(x - cx, y - cy) - radius);
        if (d > hw) continue;
        const fall = d > hw - 1 ? Math.max(0, hw - d) : 1;
        this.over(x, y, r, g, b, a * fall);
      }
    }
  }
  line(x0, y0, x1, y1, r, g, b, a, width) {
    const steps = Math.max(2, Math.ceil(Math.hypot(x1 - x0, y1 - y0) * 2));
    const hw = Math.max(0.5, width / 2);
    for (let s = 0; s <= steps; s++) {
      const t = s / steps;
      const px = x0 + (x1 - x0) * t, py = y0 + (y1 - y0) * t;
      for (let oy = -Math.ceil(hw); oy <= Math.ceil(hw); oy++) {
        for (let ox = -Math.ceil(hw); ox <= Math.ceil(hw); ox++) {
          const d = Math.hypot(ox, oy);
          if (d > hw) continue;
          const fall = d > hw - 1 ? Math.max(0, hw - d) : 1;
          this.over(px + ox, py + oy, r, g, b, a * fall);
        }
      }
    }
  }
  glow(radius, r, g, b, strength) {
    const src = Float32Array.from(this.a);
    const R = Math.ceil(radius);
    for (let y = 0; y < this.h; y++) {
      for (let x = 0; x < this.w; x++) {
        const s = src[y * this.w + x];
        if (s < 0.15) continue;
        for (let oy = -R; oy <= R; oy++) {
          for (let ox = -R; ox <= R; ox++) {
            const d = Math.hypot(ox, oy);
            if (d > radius || d < 0.5) continue;
            const fall = (1 - d / radius) ** 2;
            this.add(x + ox, y + oy, r, g, b, s * fall * strength);
          }
        }
      }
    }
  }
  toPng() {
    const buf = Buffer.alloc(this.w * this.h * 4);
    for (let i = 0; i < this.w * this.h; i++) {
      const a = Math.max(0, Math.min(1, this.a[i]));
      // 预览把图铺在深棕地面上,方便判断对比度(与游戏一致)
      const br = GROUND[0], bg = GROUND[1], bb = GROUND[2];
      buf[i * 4] = Math.round(this.r[i] * a + br * (1 - a));
      buf[i * 4 + 1] = Math.round(this.g[i] * a + bg * (1 - a));
      buf[i * 4 + 2] = Math.round(this.b[i] * a + bb * (1 - a));
      buf[i * 4 + 3] = 255;
    }
    return encodePng(this.w, this.h, buf);
  }
}

// ─── 绘制(照抄 FingerOfFate 的几何) ──────────────────────────────────────
function drawFingerBody(cv, glowCv, radius, tipY, alpha) {
  const halfW = radius * FINGER_WIDTH_RATIO * 0.5;
  const len = DROP_HEIGHT;
  const steps = 40;
  const lean = halfW * 2 * TIP_LEAN;
  const axisX = (t) => lean * t * t;
  const left = [], right = [];
  let tipHalfW = halfW * 0.2, tipCx = 0;
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const y = tipY - len * (1 - t);
    const hw = halfW * silhouetteHalfWidth(t);
    const cx = axisX(t);
    left.push([cx - hw, y]); right.push([cx + hw, y]);
    if (i === steps) { tipHalfW = hw; tipCx = cx; }
  }
  const poly = [...right, ...left.slice().reverse()];
  cv.poly(poly, COLOR[0], COLOR[1], COLOR[2], 0.30 * alpha);
  // 亮芯
  const coreR = right.map((p, i) => [p[0] - (p[0] - left[i][0]) * 0.22, p[1]]);
  const coreL = left.map((p, i) => [p[0] + (right[i][0] - p[0]) * 0.22, p[1]]);
  cv.poly([...coreR, ...coreL.slice().reverse()], COLOR[0], COLOR[1], COLOR[2], 0.26 * alpha);
  // 指节横纹
  for (const kt of [0.38, 0.68]) {
    const y = tipY - len * (1 - kt);
    const hw = halfW * silhouetteHalfWidth(kt) * 0.94;
    const cx = axisX(kt);
    const pts = [[cx - hw, y - 2], [cx + hw, y - 2], [cx + hw, y + 2], [cx - hw, y + 2]];
    cv.poly(pts, COLOR[0], COLOR[1], COLOR[2], 0.5 * alpha);
  }
  // 高光
  const hl = left.map((p, i) => [p[0] + (right[i][0] - p[0]) * 0.16, p[1]]);
  const hl2 = left.map((p, i) => [p[0] + (right[i][0] - p[0]) * 0.24, p[1]]);
  cv.poly([...hl, ...hl2.slice().reverse()], 255, 255, 255, 0.10 * alpha);

  // 指尖
  const r = tipHalfW * 1.3;
  glowCv.disc(tipCx, tipY - r * 0.35, r * 2.1, COLOR[0], COLOR[1], COLOR[2], 0.22 * alpha);
  glowCv.disc(tipCx, tipY - r * 0.35, r * 1.15, 0xff, 0xf2, 0xcc, 0.16 * alpha);
  cv.disc(tipCx, tipY - r * 0.3, r * 1.18, COLOR[0], COLOR[1], COLOR[2], 0.34 * alpha);
  cv.disc(tipCx, tipY - r * 0.38, r, COLOR[0], COLOR[1], COLOR[2], 0.5 * alpha);
  const nx = tipCx + r * 0.32, ny = tipY - r * 0.62;
  cv.ellip(nx, ny, r * NAIL_RATIO * 1.5 / 2, r * NAIL_RATIO * 1.9 / 2, 0xff, 0xf4, 0xd8, 0.72 * alpha);
  cv.ellip(nx - r * 0.08, ny - r * 0.1, r * NAIL_RATIO * 0.8 / 2, r * NAIL_RATIO * 1.1 / 2, 255, 255, 255, 0.42 * alpha);
  glowCv.disc(tipCx + r * 0.1, tipY - r * 0.5, r * 0.3, 255, 255, 255, 0.5 * alpha);
}

function drawGroundSigil(cv, glowCv, radius, t, s) {
  const spin = t * Math.PI * 0.7;
  glowCv.disc(0, 0, radius * 0.95, COLOR[0], COLOR[1], COLOR[2], 0.10 * s * (0.4 + 0.6 * t));
  const ringR = radius * (1 + (1 - t) * 0.7);
  cv.ring(0, 0, ringR, COLOR[0], COLOR[1], COLOR[2], (0.30 + 0.55 * t) * s, 3);
  cv.ring(0, 0, radius * 0.55, 255, 255, 255, (0.05 + 0.25 * t) * s, 2);
  for (let i = 0; i < 16; i++) {
    const a = (i / 16) * Math.PI * 2;
    const long = i % 2 === 0;
    const r0 = radius * 1.06, r1 = radius * (long ? 1.18 : 1.12);
    cv.line(Math.cos(a) * r0, Math.sin(a) * r0, Math.cos(a) * r1, Math.sin(a) * r1,
      COLOR[0], COLOR[1], COLOR[2], (0.35 + 0.4 * t) * s, 3);
  }
  for (let i = 0; i < 4; i++) {
    const a0 = spin + (i / 4) * Math.PI * 2;
    for (let k = 0; k < 12; k++) {
      const b0 = a0 + (k / 12) * 0.9, b1 = a0 + ((k + 1) / 12) * 0.9;
      cv.line(Math.cos(b0) * radius * 0.72, Math.sin(b0) * radius * 0.72,
        Math.cos(b1) * radius * 0.72, Math.sin(b1) * radius * 0.72,
        COLOR[0], COLOR[1], COLOR[2], (0.25 + 0.35 * t) * s, 2);
    }
  }
  const cr = radius * 0.16;
  cv.line(-cr, 0, cr, 0, 255, 255, 255, (0.15 + 0.35 * t) * s, 2);
  cv.line(0, -cr, 0, cr, 255, 255, 255, (0.15 + 0.35 * t) * s, 2);
}

/**
 * 画一个「时刻」的画面。四个时刻横排:
 *   warn 0.35 / warn 0.75 / warn 1.0(即指落前一刻)/ slam 0.3
 *
 * 相机取景:落点在画面中心,上方留足够空间让整根指进来。
 */
const RADIUS = 104;
const PANEL_W = 340;
const PANEL_H = 900;
const GROUND_Y = 720; // 落点在面板中的 y

const snapshots = [
  { label: 'warn 35%', kind: 'warn', t: 0.35 },
  { label: 'warn 75%', kind: 'warn', t: 0.75 },
  { label: 'warn 100%', kind: 'warn', t: 1.0 },
  { label: 'slam 30%', kind: 'slam', t: 0.3 },
];

const sheet = new Canvas(PANEL_W * snapshots.length, PANEL_H);
snapshots.forEach((snap, idx) => {
  const panel = new Canvas(PANEL_W, PANEL_H);
  const glowCv = new Canvas(PANEL_W, PANEL_H);
  // 把落点平移到面板中心
  const ox = PANEL_W / 2, oy = GROUND_Y;
  // 用一个临时 canvas 在同一坐标系里画:所有绘制 API 的相对坐标 + ox/oy
  // 简化:直接给 cv/glowCv 包一层偏移
  const offset = (cv) => ({
    poly: (pts, r, g, b, a) => cv.poly(pts.map(([x, y]) => [x + ox, y + oy]), r, g, b, a),
    disc: (cx, cy, rad, r, g, b, a) => cv.disc(cx + ox, cy + oy, rad, r, g, b, a),
    ellip: (cx, cy, rx, ry, r, g, b, a) => cv.ellip(cx + ox, cy + oy, rx, ry, r, g, b, a),
    ring: (cx, cy, rad, r, g, b, a, w) => cv.ring(cx + ox, cy + oy, rad, r, g, b, a, w),
    line: (x0, y0, x1, y1, r, g, b, a, w) => cv.line(x0 + ox, y0 + oy, x1 + ox, y1 + oy, r, g, b, a, w),
    add: (cx, cy, r, g, b, a) => cv.add(cx + ox, cy + oy, r, g, b, a),
  });
  const O = offset(panel), GO = offset(glowCv);

  if (snap.kind === 'warn') {
    drawGroundSigil(O, GO, RADIUS, snap.t, 1);
    const fall = snap.t ** 3;
    const tipY = -DROP_HEIGHT * (1 - fall);
    const alpha = 0.30 + 0.60 * snap.t;
    drawFingerBody(O, GO, RADIUS, tipY, alpha);
  } else {
    // slam
    drawGroundSigil(O, GO, RADIUS, 1, 0.6 + 0.4 * (1 - snap.t));
    const press = Math.sin(snap.t * Math.PI) * 8;
    drawFingerBody(O, GO, RADIUS, press, 1 - snap.t * 0.35);
  }
  glowCv.glow(9, COLOR[0], COLOR[1], COLOR[2], 0.7);

  // 合成:先把面板画上,再叠 glow(ADD)
  for (let y = 0; y < PANEL_H; y++) {
    for (let x = 0; x < PANEL_W; x++) {
      const tx = idx * PANEL_W + x;
      const si = y * PANEL_W + x;
      const di = y * sheet.w + tx;
      sheet.r[di] = panel.r[si]; sheet.g[di] = panel.g[si];
      sheet.b[di] = panel.b[si]; sheet.a[di] = panel.a[si];
    }
  }
  // ADD 辉光
  for (let y = 0; y < PANEL_H; y++) {
    for (let x = 0; x < PANEL_W; x++) {
      const si = y * PANEL_W + x;
      const di = y * sheet.w + idx * PANEL_W + x;
      sheet.r[di] += glowCv.r[si] * glowCv.a[si];
      sheet.g[di] += glowCv.g[si] * glowCv.a[si];
      sheet.b[di] += glowCv.b[si] * glowCv.a[si];
      sheet.a[di] = Math.min(1, sheet.a[di] + glowCv.a[si]);
    }
  }
  // 面板分隔线
  for (let y = 0; y < PANEL_H; y++) {
    const di = y * sheet.w + idx * PANEL_W;
    sheet.r[di] = 60; sheet.g[di] = 40; sheet.b[di] = 36;
  }
});

mkdirSync(OUT, { recursive: true });
const outFile = resolve(OUT, 'finger_of_fate.png');
writeFileSync(outFile, sheet.toPng());
console.log(`预览已写出:${outFile}`);
console.log(`面板 ${snapshots.length} 个 × ${PANEL_W}×${PANEL_H},落点半径 ${RADIUS}px`);
