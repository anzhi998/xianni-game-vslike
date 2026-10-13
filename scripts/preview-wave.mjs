#!/usr/bin/env node
/**
 * 道化黄泉水浪预览 —— 把 UnderworldWave 的画法在 node 里跑一遍,输出 PNG。
 *
 * ## 为什么需要它
 *
 * 「浪头像不像冲浪术」是**纯视觉**问题。在浏览器里验证要起 dev server、
 * 等刷怪、等法术刷新 —— 而形态每改一次参数就要看一次。
 * 与 preview-finger.mjs 同一思路:绘制逻辑复制一份到 node(纯几何,无 Phaser),
 * 改参数 → 重跑 → 看图,两秒一轮。
 *
 * ## 必须与 UnderworldWave.ts 保持一致
 *
 * 浪身五层(底色/高光带/上下沿/暗带/反光线)与浪头的**旋转 90° + 缩放 +
 * 摆位**是照抄过来的。改了 draw() 或浪头摆位就要同步改这里,
 * 否则预览会开始撒谎 —— 而一个撒谎的预览比没有预览更糟。
 *
 * 采样用 NEAREST:与游戏 pixelArt:true 的过滤一致,预览能如实暴露
 * 缩放/旋转带来的锯齿。
 *
 * 用法:node scripts/preview-wave.mjs
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { deflateSync, inflateSync } from 'node:zlib';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..');
const OUT = resolve(ROOT, '.preview');
const TEX = resolve(ROOT, 'src/assets/fx_daohua_wave.png');

// ─── 与 UnderworldWave.ts / SpellConfig 同步的常量 ────────────────────────
const PX_PER_GRID = 64;
const RECT_W = 3 * PX_PER_GRID;        // rectWidthGrid 3 → 192
const RECT_L = 5.5 * PX_PER_GRID;      // rectLengthGrid 5.5 → 352
const FRONT_MS = 300;
const LINGER_MS = 1500;
const COLOR = [0x39, 0xb9, 0x8a];      // SpellConfig.daohua.color
const HI = [0xbf, 0xff, 0xe8];
const LO = [0x0c, 0x38, 0x2a];
const GROUND = [0x4a, 0x26, 0x20];     // 朱雀星地面色,判可读性
// 浪头摆位(与 UnderworldWave.ts 的浪头常量同步)
const CREST_SPAN_MUL = 1.15;           // 浪头比浪前宽 15%
const CREST_LEAD = 10;                 // 浪头前沿超出伤害前沿的 px
const CREST_MIN_CENTER = 26;           // 施放瞬间浪头中心的最小回撤

// ─── PNG 编解码(与 make-wave.mjs 同一实现) ──────────────────────────────
const CRC_TABLE = new Int32Array(256);
for (let n = 0; n < 256; n++) {
  let c = n;
  for (let k = 0; k < 8; k++) c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : c >>> 1;
  CRC_TABLE[n] = c >>> 0;
}
const crc32 = (buf) => {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};
function pngChunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length, 0);
  const body = Buffer.concat([Buffer.from(type, 'latin1'), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(body), 0);
  return Buffer.concat([len, body, crc]);
}
function encodePng(width, height, rgba) {
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0); ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; ihdr[9] = 6;
  const stride = width * 4;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (stride + 1)] = 0;
    rgba.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
  }
  return Buffer.concat([sig, pngChunk('IHDR', ihdr), pngChunk('IDAT', deflateSync(raw, { level: 6 })), pngChunk('IEND', Buffer.alloc(0))]);
}
function decodePng(buf) {
  const sig = [137, 80, 78, 71, 13, 10, 26, 10];
  for (let i = 0; i < 8; i++) if (buf[i] !== sig[i]) throw new Error('不是 PNG');
  let p = 8, width, height, color, idat = [];
  while (p < buf.length) {
    const len = buf.readUInt32BE(p); p += 4;
    const type = buf.slice(p, p + 4).toString('latin1'); p += 4;
    const data = buf.slice(p, p + len); p += len + 4;
    if (type === 'IHDR') { width = data.readUInt32BE(0); height = data.readUInt32BE(4); color = data[9]; }
    else if (type === 'IDAT') idat.push(data);
    else if (type === 'IEND') break;
  }
  const ch = color === 6 ? 4 : 3;
  const raw = inflateSync(Buffer.concat(idat));
  const stride = width * ch;
  const px = Buffer.alloc(stride * height);
  let rp = 0, prev = Buffer.alloc(stride);
  for (let y = 0; y < height; y++) {
    const ft = raw[rp++];
    const row = raw.subarray(rp, rp + stride); rp += stride;
    const cur = Buffer.from(row);
    for (let x = 0; x < stride; x++) {
      const a = x >= ch ? cur[x - ch] : 0, b = prev[x], c = x >= ch ? prev[x - ch] : 0;
      let v = cur[x];
      if (ft === 1) v = (v + a) & 255; else if (ft === 2) v = (v + b) & 255;
      else if (ft === 3) v = (v + ((a + b) >> 1)) & 255;
      else if (ft === 4) {
        const pa = Math.abs(b - c), pb = Math.abs(a - c), pc = Math.abs(a + b - 2 * c);
        const pr = (pa <= pb && pa <= pc) ? a : (pb <= pc ? b : c);
        v = (v + pr) & 255;
      }
      cur[x] = v;
    }
    cur.copy(px, y * stride); prev = cur;
  }
  const out = Buffer.alloc(width * height * 4);
  for (let i = 0; i < width * height; i++) {
    out[i * 4] = px[i * ch];
    out[i * 4 + 1] = px[i * ch + 1];
    out[i * 4 + 2] = px[i * ch + 2];
    out[i * 4 + 3] = ch === 4 ? px[i * ch + 3] : 255;
  }
  return { width, height, data: out };
}

// ─── 画布 ─────────────────────────────────────────────────────────────────
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
  /** 水平/垂直线段(浪身只用这两种) */
  hline(x0, x1, y, r, g, b, a, wgt = 1) {
    for (let x = Math.round(x0); x <= Math.round(x1); x++)
      for (let o = 0; o < wgt; o++) this.over(x, y + o, r, g, b, a);
  }
  vline(x, y0, y1, r, g, b, a, wgt = 1) {
    for (let y = Math.round(y0); y <= Math.round(y1); y++)
      for (let o = 0; o < wgt; o++) this.over(x + o, y, r, g, b, a);
  }
  /** 旋转 90° 贴图,NEAREST 采样(与游戏 pixelArt 一致) */
  crest(img, cx, cy, scale) {
    // 浪头在容器里 rotation = +PI/2:贴图右 → 容器 +y,贴图上 → 容器 +x。
    // 反变换:容器偏移 u → 贴图坐标 (u.y, -u.x)。
    const hw = img.height * scale / 2, hh = img.width * scale / 2;
    for (let dy = -Math.ceil(hh); dy <= Math.ceil(hh); dy++) {
      for (let dx = -Math.ceil(hw); dx <= Math.ceil(hw); dx++) {
        const ay = Math.round(-dx / scale + img.height / 2);
        const ax = Math.round(dy / scale + img.width / 2);
        if (ax < 0 || ay < 0 || ax >= img.width || ay >= img.height) continue;
        const i = (ay * img.width + ax) * 4;
        const a = img.data[i + 3] / 255;
        if (a <= 0) continue;
        this.over(cx + dx, cy + dy, img.data[i], img.data[i + 1], img.data[i + 2], a);
      }
    }
  }
  toPng(bg) {
    const buf = Buffer.alloc(this.w * this.h * 4);
    for (let i = 0; i < this.w * this.h; i++) {
      const a = Math.max(0, Math.min(1, this.a[i]));
      buf[i * 4] = Math.round(this.r[i] * a + bg[0] * (1 - a));
      buf[i * 4 + 1] = Math.round(this.g[i] * a + bg[1] * (1 - a));
      buf[i * 4 + 2] = Math.round(this.b[i] * a + bg[2] * (1 - a));
      buf[i * 4 + 3] = 255;
    }
    return encodePng(this.w, this.h, buf);
  }
}

/** 浪身五层 —— 照抄 UnderworldWave.draw() 推进段(浪头在场时画的子集) */
function drawBody(cv, ox, oy, front, alpha) {
  const half = RECT_W / 2;
  const F = Math.max(0.0001, front);
  // 1. 浪体实体
  for (let y = -half; y < half; y++)
    for (let x = 0; x < F; x++)
      cv.over(ox + x, oy + y, COLOR[0], COLOR[1], COLOR[2], 0.32 * alpha);
  // 2. 高光带(上半段 32%)
  for (let y = -half; y < -half + RECT_W * 0.32; y++)
    for (let x = 0; x < F; x++)
      cv.over(ox + x, oy + y, HI[0], HI[1], HI[2], 0.18 * alpha);
  // 3. 上沿亮边 + 底沿暗线
  cv.hline(0, F, -half, HI[0], HI[1], HI[2], 0.55 * alpha, 2);
  cv.hline(0, F, half - 1, LO[0], LO[1], LO[2], 0.45 * alpha, 2);
  // 4. 波前暗带
  cv.vline(ox + Math.max(0, front - 14), oy - half, oy + half, COLOR[0], COLOR[1], COLOR[2], 0.55 * alpha, 2);
  // 5. 水面反光线
  cv.hline(Math.max(0, front - 6), F, -half + 1, HI[0], HI[1], HI[2], 0.85 * alpha, 1);
}

const crestImg = decodePng(readFileSync(TEX));
const crestScale = (RECT_W * CREST_SPAN_MUL) / crestImg.width;
console.log(`浪头贴图 ${crestImg.width}x${crestImg.height} → 显示 ${Math.round(crestImg.width * crestScale)}x${Math.round(crestImg.height * crestScale)}(缩放 ${crestScale.toFixed(3)})`);

// 三个时刻:推进 35% / 推进 100% / 残留 55%
const STAGES = [
  { label: 'advance 35%', t: 0.35 },
  { label: 'advance 100%', t: 1.0 },
  { label: 'linger 55%', t: 1.55 },
];
const PANEL_W = Math.ceil(RECT_L + 120);
const PANEL_H = Math.ceil(RECT_W + 120);
const sheet = new Canvas(PANEL_W * STAGES.length, PANEL_H);

STAGES.forEach((s, idx) => {
  const cv = new Canvas(PANEL_W, PANEL_H);
  const ox = 60, oy = PANEL_H / 2;
  const front = RECT_L * Math.min(1, s.t);
  const alpha = s.t <= 1 ? 1 - s.t * 0.25 : Math.max(0, 1 - (s.t - 1) * LINGER_MS / LINGER_MS * 0);

  if (s.t <= 1) {
    drawBody(cv, ox, oy, front, alpha);
    // 浪头:旋转 90°,泡沫领先伤害前沿 CREST_LEAD(照抄 UnderworldWave.draw)
    const depth = crestImg.height * crestScale;
    const cx = Math.max(front + CREST_LEAD - depth / 2, CREST_MIN_CENTER);
    cv.crest(crestImg, ox + cx, oy, crestScale);
  } else {
    // 残留水洼(整片匀速淡出,浪头隐藏)
    const t2 = Math.min(1, (s.t - 1));
    const a2 = 1 - t2;
    const half = RECT_W / 2, L = RECT_L;
    for (let y = -half; y < half; y++)
      for (let x = 0; x < L; x++)
        cv.over(ox + x, oy + y, COLOR[0], COLOR[1], COLOR[2], 0.18 * a2);
    cv.hline(0, L, -half, HI[0], HI[1], HI[2], 0.45 * a2, 3);
    cv.hline(0, L, half - 1, LO[0], LO[1], LO[2], 0.35 * a2, 2);
    cv.hline(L * 0.08, L * 0.92, 0, COLOR[0], COLOR[1], COLOR[2], 0.55 * a2, 2);
  }

  // 合到长图 + 分隔线 + 施放点标记(玩家所在处)
  for (let y = 0; y < PANEL_H; y++) {
    for (let x = 0; x < PANEL_W; x++) {
      const di = y * sheet.w + idx * PANEL_W + x;
      const si = y * PANEL_W + x;
      sheet.r[di] = cv.r[si]; sheet.g[di] = cv.g[si];
      sheet.b[di] = cv.b[si]; sheet.a[di] = cv.a[si];
    }
  }
  for (let y = 0; y < PANEL_H; y++) {
    const di = y * sheet.w + idx * PANEL_W;
    sheet.r[di] = 30; sheet.g[di] = 20; sheet.b[di] = 18;
  }
  for (let o = -6; o <= 6; o++) {
    sheet.over(ox, oy + o, 255, 240, 200, 0.9);
  }
});

mkdirSync(OUT, { recursive: true });
const outFile = resolve(OUT, 'daohua_wave.png');
writeFileSync(outFile, sheet.toPng(GROUND));
console.log(`预览已写出:${outFile}`);
console.log(`${STAGES.length} 个时刻 × ${PANEL_W}x${PANEL_H},浪 ${RECT_L}x${RECT_W}px,白点 = 施放点`);
