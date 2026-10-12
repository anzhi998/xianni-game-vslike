#!/usr/bin/env node
/**
 * 怪物贴图管线 —— 把 AI 出的原图自动抠黑底、缩放到目标尺寸,顺便生成精英版(提亮+描金)
 *
 * ## 干什么 / 不干什么
 *
 * 只做"让一张图变成游戏贴图"的机械活:读 PNG → 抹水印 → 软边抠图 → 方形裁切 →
 * 立方缩放 → 写 PNG。**不**做:绘制、调色、贴到画布。
 * 调色留给 AI 出图时的 prompt(让模特穿着对的配色,见 docs/美术素材规格.md)。
 *
 * ## 用法
 *
 *   node scripts/make-sprite.mjs <id> [<id> ...]
 *   node scripts/make-sprite.mjs --from <file> --id <id> [--no-elite] [--out-size N]
 *
 * 前者从 `src/assets/_raw/<id>.png` 读图,后者从任意路径读图。
 * 默认会**同时**产出 `enemy_<id>.png` 与 `elite_<id>.png`,符合设计文档"成对"约定。
 * `--no-elite` 只出普通版;精英版要重做,再跑一次加 `--only elite`。
 *
 * ## 为什么是 PNG 输入
 *
 * 零依赖是设计目标(同 make-icons.mjs),手写 JPEG 解码的代码量要 200+ 行。
 * PNG 解码 + 编码 < 100 行,够用。AI 出图时切到 PNG 即可。
 *
 * ## 尺寸表从哪来
 *
 * 维护一份与 EnemyConfig 对应的"键 → (w, h)"表(查表而非读 TS,
 * 因为读 TS 要起 ts-node / tsx,等于隐式引入依赖)。
 * 缺表项时命令失败,而不是用猜的尺寸出图。
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync, statSync } from 'node:fs';
import { dirname, resolve, basename, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { deflateSync, inflateSync } from 'node:zlib';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..');
const RAW_DIR = resolve(ROOT, 'src/assets/_raw');
const ASSET_DIR = resolve(ROOT, 'src/assets');

// ─── CLI 解析 ─────────────────────────────────────────────────────────────
const argv = process.argv.slice(2);
const opts = { from: null, id: null, noElite: false, only: null, outSize: null, help: false };
const ids = [];
for (let i = 0; i < argv.length; i++) {
  const a = argv[i];
  if (a === '--from') opts.from = argv[++i];
  else if (a === '--id') opts.id = argv[++i];
  else if (a === '--no-elite') opts.noElite = true;
  else if (a === '--only') opts.only = argv[++i];        // 'normal' | 'elite'
  else if (a === '--out-size') opts.outSize = parseInt(argv[++i], 10);
  else if (a === '-h' || a === '--help') opts.help = true;
  else if (a.startsWith('--')) { console.error(`未知选项: ${a}`); process.exit(2); }
  else ids.push(a);
}
if (opts.id) ids.push(opts.id);
if (opts.only && !['normal', 'elite'].includes(opts.only)) {
  console.error(`--only 仅接受 normal|elite,收到: ${opts.only}`); process.exit(2);
}
if (opts.help || ids.length === 0) {
  console.log(`用法:
  node scripts/make-sprite.mjs <id> [<id> ...]
  node scripts/make-sprite.mjs --from <file> --id <id> [--no-elite] [--only normal|elite] [--out-size N]
`);
  process.exit(0);
}

// ─── 尺寸表 ────────────────────────────────────────────────────────────────
// 与 docs/美术素材规格.md §3.1 + src/config/EnemyConfig.ts 一一对应。
// 缺表项时**显式失败** —— 写错键的后果是游戏里一只空方块,必须让脚本哭着罢工。
const SIZE_TABLE = {
  zhuque: 87, tianyunzi: 84, situnan: 80, beast: 16, jinglingzhu: 16, shilingchong: 18,
  pugongying: 20, mihu: 22, heiguai: 24, shaoye: 24, tunshi: 28,
  yuling: 30, changwei: 32, wuqing: 34, zhangli: 36, sidian: 38,
  danyang: 40, daxiu: 42, shenyou: 44, fenghou: 46, jiuying: 48,
  shentian: 50, minghuang: 52, dadi: 54, diying: 56, changsheng: 58,
  tianmo: 60, yuefu: 62, tianluo: 64, zhuxian: 66, sanqing: 68,
};
function lookupSize(id) {
  if (id in SIZE_TABLE) return SIZE_TABLE[id];
  // 不在表里就**不猜**。给一个明确错误比给一只空方块强。
  throw new Error(
    `未知 id "${id}":SIZE_TABLE 里没有。\n` +
    `在 SIZE_TABLE 加一行 { ${id}: <边长> },数值必须与 src/config/EnemyConfig.ts 一致。`
  );
}

// ─── PNG 解码 ─────────────────────────────────────────────────────────────
// 零依赖手写:够用就行,只处理 color type 2/6(RGB/RGBA,8 bit)、filter 0、interlace 0。
function decodePng(buf) {
  const sig = [137, 80, 78, 71, 13, 10, 26, 10];
  for (let i = 0; i < 8; i++) if (buf[i] !== sig[i]) throw new Error('不是 PNG');
  let p = 8, width, height, depth, color, chunks = [];
  while (p < buf.length) {
    const len = buf.readUInt32BE(p); p += 4;
    const type = buf.slice(p, p + 4).toString('latin1'); p += 4;
    const data = buf.slice(p, p + len); p += len + 4;     // +4 跳过 CRC
    if (type === 'IHDR') {
      width = data.readUInt32BE(0); height = data.readUInt32BE(4);
      depth = data[8]; color = data[9];
    } else if (type === 'IDAT') {
      chunks.push(data);
    } else if (type === 'IEND') break;
  }
  if (depth !== 8) throw new Error(`仅支持 8 位色深,收到 ${depth}`);
  if (color !== 2 && color !== 6) throw new Error(`仅支持 RGB(A),color type=${color}`);
  const channels = color === 6 ? 4 : 3;
  const raw = inflateSync(Buffer.concat(chunks));
  const stride = width * channels;
  const px = Buffer.alloc(stride * height);
  let rp = 0, wp = 0, prev = Buffer.alloc(stride);
  for (let y = 0; y < height; y++) {
    const filter = raw[rp++];
    const row = raw.subarray(rp, rp + stride); rp += stride;
    const out = Buffer.alloc(stride);
    for (let x = 0; x < stride; x++) {
      const a = x >= channels ? out[x - channels] : 0;
      const b = prev[x];
      const c = x >= channels ? prev[x - channels] : 0;
      let v = row[x];
      if (filter === 0) v = v;
      else if (filter === 1) v = (v + a) & 0xff;
      else if (filter === 2) v = (v + b) & 0xff;
      else if (filter === 3) v = (v + ((a + b) >> 1)) & 0xff;
      else if (filter === 4) {
        const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
        const pr = pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
        v = (v + pr) & 0xff;
      }
      out[x] = v;
    }
    out.copy(px, wp);
    prev = out;
    wp += stride;
  }
  return { width, height, channels, data: px };
}

// ─── PNG 编码 ─────────────────────────────────────────────────────────────
// 与 make-icons.mjs 同一套(alpha type=4,non-interlaced),但用真 4 通道。
const CRC_TABLE = new Uint32Array(256);
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
  // 每行前置 0 滤镜字节 + raw 行
  const stride = width * 4;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (stride + 1)] = 0;
    rgba.copy(raw, y * (stride + 1) + 1, y * stride, y * stride + stride);
  }
  const idat = deflateSync(raw, { level: 6 });
  return Buffer.concat([sig, chunk('IHDR', ihdr), chunk('IDAT', idat), chunk('IEND', Buffer.alloc(0))]);
}

// ─── 像素访问辅助 ──────────────────────────────────────────────────────────
const getPx = (img, x, y) => {
  const i = (y * img.width + x) * img.channels;
  return [img.data[i], img.data[i + 1], img.data[i + 2], img.channels === 4 ? img.data[i + 3] : 255];
};
const setPx = (img, x, y, r, g, b, a) => {
  const i = (y * img.width + x) * img.channels;
  img.data[i] = r; img.data[i + 1] = g; img.data[i + 2] = b;
  if (img.channels === 4) img.data[i + 3] = a;
};

// ─── 1. 抹掉 AI 水印 ──────────────────────────────────────────────────────
// AI 图右下角常带「AI生成」水印。抹掉比抠图容易:用左上角背景色回填即可。
// 如果该图恰好没水印,这块区域被涂回背景色,在后续抠图里是背景,a=0,无副作用。
function eraseWatermark(img) {
  // 抹水印的关键是 RGB 和 alpha 一起写 —— 只涂 RGB 留下一层 a=255,
  // 抠图会把它当"内容"留下,后续描金甚至会把它圈出边来,看上去就是
  // 怪背后挂着一块脏块。所以这里强制把 alpha 一起置 0。
  const W = img.width, H = img.height;
  for (let y = Math.floor(H * 0.86); y < H; y++) {
    for (let x = Math.floor(W * 0.76); x < W; x++) {
      const i = (y * W + x) * img.channels;
      img.data[i] = 0; img.data[i + 1] = 0; img.data[i + 2] = 0;
      if (img.channels === 4) img.data[i + 3] = 0;
    }
  }
}

// ─── 2. 抠图:八点采样选最暗最冷 + 欧氏距离软边 18~88 ─────────────────────
// 软边区间不能写死 —— 后续若发现某张图阈值不对,这里加一张「该 id 调阈值」的表。
function findBackground(img) {
  const W = img.width, H = img.height;
  const samples = [
    [8, 8], [Math.floor(W / 2), 8], [W - 9, 8],
    [8, Math.floor(H / 2)], [W - 9, Math.floor(H / 2)],
    [8, H - 9], [Math.floor(W / 2), H - 9], [W - 9, H - 9],
  ];
  let best = { r: 255, g: 255, b: 255, sum: 255 * 3 };
  for (const [x, y] of samples) {
    const [r, g, b] = getPx(img, x, y);
    const sum = r + g + b;
    if (sum < best.sum) best = { r, g, b, sum };
  }
  return best;
}
const CHROMA = { t0: 28, t1: 90 };
// 阈值的选择:AI 图常有半透明紫雾/光晕糊到背景上,深紫/深蓝+暗背景
// 的色差只有 30~80,卡在 18~88 区间会被判定为半透明内容。T0=28 + T1=90
// 让"明显是背景"的区(色差<28)直接全透,"明显是内容"的区(色差>90)
// 直接全实,中间过渡更窄 —— 雾气和人物就分开了。
/**
 * 只保留 alpha 矩阵中**最大**的 4 邻连通块(满足阈值)。
 * 用途:抠图后去除 AI 图浮在主体外的星点、光晕、水印残余。
 * 用显式栈避免递归栈溢出,O(N) 时间 O(N) 空间。
 */
function keepLargestComponent(alpha, W, H, threshold) {
  const visited = new Uint8Array(W * H);
  let best = { size: 0, root: -1 };
  const comp = new Int32Array(W * H);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = y * W + x;
      if (visited[i] || alpha[i] < threshold) continue;
      const root = i;
      const stack = [i];
      let size = 0;
      while (stack.length) {
        const p = stack.pop();
        if (visited[p]) continue;
        visited[p] = 1;
        comp[p] = root;
        size++;
        const x0 = p % W, y0 = (p - x0) / W;
        if (x0 > 0) { const q = p - 1; if (!visited[q] && alpha[q] >= threshold) stack.push(q); }
        if (x0 < W - 1) { const q = p + 1; if (!visited[q] && alpha[q] >= threshold) stack.push(q); }
        if (y0 > 0) { const q = p - W; if (!visited[q] && alpha[q] >= threshold) stack.push(q); }
        if (y0 < H - 1) { const q = p + W; if (!visited[q] && alpha[q] >= threshold) stack.push(q); }
      }
      if (size > best.size) best = { size, root };
    }
  }
  if (best.root < 0) return;                       // 全是空
  for (let i = 0; i < alpha.length; i++) {
    if (alpha[i] >= threshold && comp[i] !== best.root) alpha[i] = 0;
  }
}
function keyOutAlpha(img, bg) {
  if (!bg) throw new Error(`keyOutAlpha: bg is ${JSON.stringify(bg)}`);
  const W = img.width, H = img.height;
  let minX = W, minY = H, maxX = -1, maxY = -1;
  const alpha = new Uint8Array(W * H);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const [r, g, b] = getPx(img, x, y);
      const dr = r - bg.r, dg = g - bg.g, db = b - bg.b;
      const dist = Math.sqrt(dr * dr + dg * dg + db * db);
      let a;
      if (dist <= CHROMA.t0) a = 0;
      else if (dist >= CHROMA.t1) a = 255;
      else a = Math.round((dist - CHROMA.t0) / (CHROMA.t1 - CHROMA.t0) * 255);
      alpha[y * W + x] = a;
      if (a > 12) {
        if (x < minX) minX = x; if (x > maxX) maxX = x;
        if (y < minY) minY = y; if (y > maxY) maxY = y;
      }
    }
  }
  if (maxX < 0) { minX = 0; minY = 0; maxX = W - 1; maxY = H - 1; }
  // 浮在主体外的离散小区域(AI 图的光晕/星点)对游戏是噪声不是细节。
  // 只保留最大连通块,其余清 0 —— 边角水印也被这次一起清掉。
  // 4 邻 floodfill:栈式实现,O(N)。
  keepLargestComponent(alpha, W, H, 96);
  // 重新算 bbox:floodfill 把外部小区域清掉后,内容外接框通常更小
  minX = W; minY = H; maxX = -1; maxY = -1;
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      if (alpha[y * W + x] > 12) {
        if (x < minX) minX = x; if (x > maxX) maxX = x;
        if (y < minY) minY = y; if (y > maxY) maxY = y;
      }
    }
  }
  if (maxX < 0) { minX = 0; minY = 0; maxX = W - 1; maxY = H - 1; }
  // 把 alpha 写回像素(若原本是 RGB,扩展为 RGBA,后面裁切/缩放统一用 4 通道)
  const out = Buffer.alloc(W * H * 4);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = (y * W + x) * 4;
      const [r, g, b] = getPx(img, x, y);
      out[i] = r; out[i + 1] = g; out[i + 2] = b; out[i + 3] = alpha[y * W + x];
    }
  }
  return { width: W, height: H, channels: 4, data: out, bbox: { minX, minY, maxX, maxY } };
}

// ─── 3. 方形裁切(留 4% 边) ──────────────────────────────────────────────
function squareCrop(img, bbox) {
  const { minX, minY, maxX, maxY } = bbox;
  const bw = maxX - minX + 1, bh = maxY - minY + 1;
  let side = Math.round(Math.max(bw, bh) * 1.04);
  const cx = minX + Math.floor(bw / 2);
  const cy = minY + Math.floor(bh / 2);
  let sx = Math.max(0, Math.min(img.width - side, cx - Math.floor(side / 2)));
  let sy = Math.max(0, Math.min(img.height - side, cy - Math.floor(side / 2)));
  if (side > img.width) { sx = 0; side = img.width; }
  if (side > img.height) { sy = 0; side = img.height; }
  const out = Buffer.alloc(side * side * 4);
  for (let y = 0; y < side; y++) {
    img.data.copy(out, y * side * 4, (sy + y) * img.width * 4 + sx * 4, (sy + y) * img.width * 4 + (sx + side) * 4);
  }
  return { width: side, height: side, channels: 4, data: out };
}

// ─── 4. 4×4 Catmull-Rom 缩放 ─────────────────────────────────────────────
// 比双线性锐一档,比双三次便宜。挑这个是因为做这种尺寸用不到 Lanczos-3 的精度,
// 却又比双线性少模糊。
function resizeBicubic(src, dstW, dstH) {
  const srcW = src.width, srcH = src.height;
  const out = Buffer.alloc(dstW * dstH * 4);
  // Mitchell-Netravali 二次拟合:bc=0、c=0.5 等价于 Catmull-Rom。
  const kernel = (t) => {
    t = Math.abs(t);
    if (t <= 1) return (1.5 * t - 2.5) * t * t + 1;
    if (t <= 2) return ((-0.5 * t + 2.5) * t - 4) * t + 2;
    return 0;
  };
  const samp = (sx, sy) => {
    const ix = Math.max(0, Math.min(srcW - 1, Math.round(sx)));
    const iy = Math.max(0, Math.min(srcH - 1, Math.round(sy)));
    const i = (iy * srcW + ix) * 4;
    return [src.data[i], src.data[i + 1], src.data[i + 2], src.data[i + 3]];
  };
  for (let y = 0; y < dstH; y++) {
    const sy = (y + 0.5) * srcH / dstH - 0.5;
    const iy = Math.floor(sy), dy = sy - iy;
    for (let x = 0; x < dstW; x++) {
      const sx = (x + 0.5) * srcW / dstW - 0.5;
      const ix = Math.floor(sx), dx = sx - ix;
      let r = 0, g = 0, b = 0, a = 0, wSum = 0;
      for (let j = 0; j < 4; j++) {
        const wy = kernel(dy - j + 1);
        for (let i = 0; i < 4; i++) {
          const wx = kernel(dx - i + 1);
          const w = wy * wx;
          if (w === 0) continue;
          const [pr, pg, pb, pa] = samp(ix + i - 1, iy + j - 1);
          r += pr * w; g += pg * w; b += pb * w; a += pa * w; wSum += w;
        }
      }
      const d = (y * dstW + x) * 4;
      out[d] = Math.max(0, Math.min(255, Math.round(r / wSum)));
      out[d + 1] = Math.max(0, Math.min(255, Math.round(g / wSum)));
      out[d + 2] = Math.max(0, Math.min(255, Math.round(b / wSum)));
      out[d + 3] = Math.max(0, Math.min(255, Math.round(a / wSum)));
    }
  }
  return { width: dstW, height: dstH, channels: 4, data: out };
}

// ─── 5. 提亮 + 描金边(elite 版) ──────────────────────────────────────────
// HSL 提亮:L += 0.18 上限 0.95,同步把 S 削到 0.85 避免"塑料感"。
// 描金边:对 alpha>128 的像素,沿原图外圈(4 邻 a≤64 的像素)覆一层 #ddbb55。
// 这两层在视觉上把"怪"和"精英怪"区分开,与设计文档 §3.1 的描述一致。
function rgbToHsl(r, g, b) {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  let h, s, l = (max + min) / 2;
  if (max === min) { h = 0; s = 0; }
  else {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    switch (max) {
      case r: h = ((g - b) / d + (g < b ? 6 : 0)); break;
      case g: h = ((b - r) / d + 2); break;
      default: h = ((r - g) / d + 4);
    }
    h /= 6;
  }
  return [h, s, l];
}
function hueRgb(p, q, t) {
  if (t < 0) t += 1; if (t > 1) t -= 1;
  if (t < 1/6) return p + (q - p) * 6 * t;
  if (t < 1/2) return q;
  if (t < 2/3) return p + (q - p) * (2/3 - t) * 6;
  return p;
}
function hslToRgb(h, s, l) {
  let r, g, b;
  if (s === 0) { r = g = b = l; }
  else {
    const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
    const p = 2 * l - q;
    r = hueRgb(p, q, h + 1/3); g = hueRgb(p, q, h); b = hueRgb(p, q, h - 1/3);
  }
  return [Math.round(r * 255), Math.round(g * 255), Math.round(b * 255)];
}
function makeElite(img) {
  const W = img.width, H = img.height;
  const brightened = Buffer.alloc(W * H * 4);
  for (let i = 0; i < W * H; i++) {
    const o = i * 4;
    const r = img.data[o], g = img.data[o + 1], b = img.data[o + 2], a = img.data[o + 3];
    const [h, s, l] = rgbToHsl(r, g, b);
    const [r2, g2, b2] = hslToRgb(h, Math.min(0.85, s * 0.95), Math.min(0.95, l + 0.18));
    brightened[o] = r2; brightened[o + 1] = g2; brightened[o + 2] = b2; brightened[o + 3] = a;
  }
  // 描金边:对 alpha>=64 的"内容像素"找"边界"——四邻中至少一个 a<64 的像素覆金。
  // 描金写"不透明金 + 略低于原 alpha",确保原本透明(a=0)的区域不会被"画"出边。
  //
  // 警告:这里用 brightened 的 alpha 来判定"是不是边",**没用尺寸框**。若输入
  // 图本身有漂浮的灰点(AI 图常见,例如人物周围的星点),会绕出一圈金。
  // 那种图要先在抠图阶段把孤点剔掉,这里不动它。
  const G = { r: 0xdd, g: 0xbb, b: 0x55 };
  const elite = Buffer.from(brightened);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const o = (y * W + x) * 4;
      const a = elite[o + 3];
      if (a < 64) continue;
      let edge = false;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nx = x + dx, ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= W || ny >= H) { edge = true; break; }
        if (elite[(ny * W + nx) * 4 + 3] < 64) { edge = true; break; }
      }
      if (!edge) continue;
      // 原色与金混,描金强度 = 0.55,与设计文档"描金边"一致
      elite[o]     = Math.round(elite[o]     * 0.45 + G.r * 0.55);
      elite[o + 1] = Math.round(elite[o + 1] * 0.45 + G.g * 0.55);
      elite[o + 2] = Math.round(elite[o + 2] * 0.45 + G.b * 0.55);
      elite[o + 3] = Math.min(255, Math.round(a * 0.7 + 180));
    }
  }
  return { width: W, height: H, channels: 4, data: elite };
}

// ─── 主管线 ───────────────────────────────────────────────────────────────
function processOne(inputPath, id, outSize) {
  console.log(`\n[${id}] 源: ${inputPath} (${(statSync(inputPath).size / 1024).toFixed(1)} KB)`);
  const raw = decodePng(readFileSync(inputPath));
  console.log(`  解码: ${raw.width}x${raw.height} ${raw.channels === 4 ? 'RGBA' : 'RGB'}`);
  // 顺序:找背景色 → 抠图 → floodfill 去掉浮在主体外的光晕/星点/水印。
  // 抹水印那段代码留着但不再调用 —— floodfill 已经把水印当孤立块清掉了。
  const bg = findBackground(raw);
  console.log(`  背景色: (${bg.r},${bg.g},${bg.b})`);
  const keyed = keyOutAlpha(raw, bg);
  const { minX, minY, maxX, maxY } = keyed.bbox;
  console.log(`  抠图: bbox=(${minX},${minY})-(${maxX},${maxY})`);
  const cropped = squareCrop(keyed, keyed.bbox);
  const sized = resizeBicubic(cropped, outSize, outSize);
  console.log(`  缩放: ${cropped.width}x${cropped.height} -> ${outSize}x${outSize}`);

  // 写普通版
  if (!opts.only || opts.only === 'normal') {
    const out = resolve(ASSET_DIR, `enemy_${id}.png`);
    writeFileSync(out, encodePng(sized.width, sized.height, sized.data));
    console.log(`  ✓ ${out}`);
  }
  // 写精英版
  if (!opts.noElite && (!opts.only || opts.only === 'elite')) {
    const elite = makeElite(sized);
    const out = resolve(ASSET_DIR, `elite_${id}.png`);
    writeFileSync(out, encodePng(elite.width, elite.height, elite.data));
    console.log(`  ✓ ${out}`);
  }
}

if (!existsSync(ASSET_DIR)) mkdirSync(ASSET_DIR, { recursive: true });
for (const id of ids) {
  const outSize = opts.outSize ?? lookupSize(id);
  const inputPath = opts.from ?? resolve(RAW_DIR, `${id}.png`);
  if (!existsSync(inputPath)) {
    console.error(`[${id}] 找不到源图: ${inputPath}\n  放在 src/assets/_raw/${id}.png,或用 --from 指定路径。`);
    process.exit(2);
  }
  if (extname(inputPath).toLowerCase() !== '.png') {
    console.error(`[${id}] 仅支持 PNG 输入(零依赖设计),收到: ${inputPath}`);
    process.exit(2);
  }
  processOne(inputPath, id, outSize);
}
console.log('');
