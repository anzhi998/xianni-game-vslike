#!/usr/bin/env node
/**
 * 竖长贴图处理 —— 把 AI 出的原图抠绿底、裁内容、缩放到游戏尺寸
 *
 * 与 make-sprite.mjs 的区别:那是「怪物」管线(方形裁切 + enemy/elite 成对);
 * 这里处理的图是**竖长或带方向**的(命数指的指身、火雨的陨石),方形裁切会把
 * 它们切成正方形,完全不能用。所以走一条专用的「按宽度缩放、高度自由」管线。
 * PNG 编解码与抠图算法与 make-sprite 同源。
 *
 * ⚠️ 原图放在 `assets-src/raw/`,**不放 `src/assets/`** ——
 *    `AssetLoader` 的 `import.meta.glob('../assets/**\/*.png')` 会 glob **所有层级**
 *    的 png,原图放进去会被打进 dist(命数指原图 871 KB、陨石 503 KB),
 *    而它们是纯粹的中间产物,运行时一次都用不到。
 *
 * 用法:node scripts/make-finger.mjs [输入] [输出] [--width N]
 * 默认:assets-src/raw/finger_of_fate_raw.png → src/assets/fx_finger_of_fate.png,宽 120
 *
 * 两个实际用例:
 *   命数指:node scripts/make-finger.mjs assets-src/raw/finger_of_fate_raw.png src/assets/fx_finger_of_fate.png --width 120
 *   陨石  :node scripts/make-finger.mjs assets-src/raw/meteor_raw.png         src/assets/fx_meteor.png         --width 96
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { deflateSync } from 'node:zlib';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..');
const args = process.argv.slice(2);
const IN = resolve(ROOT, args[0] ?? 'assets-src/raw/finger_of_fate_raw.png');
const OUT = resolve(ROOT, args[1] ?? 'src/assets/fx_finger_of_fate.png');
const TARGET_W = Number(args[args.indexOf('--width') + 1] ?? 120);

// ─── PNG 编解码(与 make-sprite.mjs 同一实现) ────────────────────────────
import { inflateSync } from 'node:zlib';
function decodePng(buf) {
  const sig = [137, 80, 78, 71, 13, 10, 26, 10];
  for (let i = 0; i < 8; i++) if (buf[i] !== sig[i]) throw new Error('不是 PNG');
  let p = 8, width, height, depth, color, chunks = [];
  while (p < buf.length) {
    const len = buf.readUInt32BE(p); p += 4;
    const type = buf.slice(p, p + 4).toString('latin1'); p += 4;
    const data = buf.slice(p, p + len); p += len + 4;
    if (type === 'IHDR') {
      width = data.readUInt32BE(0); height = data.readUInt32BE(4);
      depth = data[8]; color = data[9];
    } else if (type === 'IDAT') chunks.push(data);
    else if (type === 'IEND') break;
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
      if (filter === 1) v = (v + a) & 0xff;
      else if (filter === 2) v = (v + b) & 0xff;
      else if (filter === 3) v = (v + ((a + b) >> 1)) & 0xff;
      else if (filter === 4) {
        const pa2 = a + b - c, pa = Math.abs(pa2 - a), pb = Math.abs(pa2 - b), pc = Math.abs(pa2 - c);
        v = (v + (pa <= pb && pa <= pc ? a : pb <= pc ? b : c)) & 0xff;
      }
      out[x] = v;
    }
    out.copy(px, wp);
    prev = out;
    wp += stride;
  }
  return { width, height, channels, data: px };
}

const CRC_TABLE = new Uint32Array(256);
for (let n = 0; n < 256; n++) {
  let c = n;
  for (let k = 0; k < 8; k++) c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
  CRC_TABLE[n] = c >>> 0;
}
const crc32 = (b2) => {
  let c = 0xffffffff;
  for (let i = 0; i < b2.length; i++) c = CRC_TABLE[(c ^ b2[i]) & 0xff] ^ (c >>> 8);
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

// ─── 处理 ──────────────────────────────────────────────────────────────────
const img = decodePng(readFileSync(IN));
const W = img.width, H = img.height;
const getPx = (x, y) => {
  const i = (y * W + x) * img.channels;
  return [img.data[i], img.data[i + 1], img.data[i + 2], img.channels === 4 ? img.data[i + 3] : 255];
};

// 1. 抠绿底:用「绿色占优度」g - max(r,b),而不是到纯绿的欧氏距离 ——
//    AI 图的辉光是黄绿抖动像素(如 200,230,120),它到纯绿的距离很大,
//    按距离抠会把整圈绿晕当内容留下(实测 bbox 因此铺满全图)。
//    占优度对它们是敏感的:绿底 ≈ 255,绿晕 ≈ 30~90,金手指是负的(r>g)。
const T0 = 45, T1 = 110;
const alpha = new Float32Array(W * H);
for (let y = 0; y < H; y++) {
  for (let x = 0; x < W; x++) {
    const [r, g, b] = getPx(x, y);
    const greenness = g - Math.max(r, b);
    alpha[y * W + x] = greenness > T1 ? 0 : greenness < T0 ? 1 : 1 - (greenness - T0) / (T1 - T0);
  }
}

// 1.5 抖动残留清理:AI 绿幕常用棋盘格抖动做渐变,单独一个像素的绿色度
//    可能低于阈值而以半透明存活,在轮廓外形成一圈「绿色噪点边」。
//    规则:任何与「完全透明像素」4 邻相邻、且仍带一点绿色占优(g > r, g > b)
//    的像素,一律清零 —— 主体是金色的(r > g),这条规则不会伤到它。
{
  const killed = new Uint8Array(W * H);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = y * W + x;
      if (alpha[i] === 0) continue;
      const [r, g, b] = getPx(x, y);
      if (g <= r || g <= b) continue;
      const nb = [[x - 1, y], [x + 1, y], [x, y - 1], [x, y + 1]];
      if (nb.some(([nx, ny]) => nx >= 0 && ny >= 0 && nx < W && ny < H && alpha[ny * W + nx] === 0)) {
        killed[i] = 1;
      }
    }
  }
  for (let i = 0; i < alpha.length; i++) if (killed[i]) alpha[i] = 0;
}

// 2. 找内容包围盒(alpha > 0.5 的区域)
let minX = W, minY = H, maxX = -1, maxY = -1;
for (let y = 0; y < H; y++) {
  for (let x = 0; x < W; x++) {
    if (alpha[y * W + x] > 0.5) {
      if (x < minX) minX = x; if (x > maxX) maxX = x;
      if (y < minY) minY = y; if (y > maxY) maxY = y;
    }
  }
}
if (maxX < 0) throw new Error('没找到内容');
// 水印在右下角,先从 bbox 里排除掉:内容 bbox 的右下 8% 若与主体分离就砍掉
// (指尖朝下,主体下缘是指尖,不能误伤 —— 所以只砍 x 方向右侧 20% 且 y 方向底部 6% 的孤立块)
// 简化:直接在 alpha 上把右下角水印区清零
const wmX0 = Math.floor(W * 0.8), wmY0 = Math.floor(H * 0.94);
for (let y = wmY0; y < H; y++) {
  for (let x = wmX0; x < W; x++) alpha[y * W + x] = 0;
}
// 重新算 bbox(水印清零后)
minX = W; minY = H; maxX = -1; maxY = -1;
for (let y = 0; y < H; y++) {
  for (let x = 0; x < W; x++) {
    if (alpha[y * W + x] > 0.5) {
      if (x < minX) minX = x; if (x > maxX) maxX = x;
      if (y < minY) minY = y; if (y > maxY) maxY = y;
    }
  }
}

// 3. 裁剪 + 双线性缩放到目标宽
const cw = maxX - minX + 1, ch = maxY - minY + 1;
const outW = TARGET_W;
const outH = Math.round(ch * (TARGET_W / cw));
const out = Buffer.alloc(outW * outH * 4);
for (let y = 0; y < outH; y++) {
  for (let x = 0; x < outW; x++) {
    // 双线性采样
    const sx = minX + (x + 0.5) * (cw / outW) - 0.5;
    const sy = minY + (y + 0.5) * (ch / outH) - 0.5;
    const x0 = Math.max(0, Math.floor(sx)), y0 = Math.max(0, Math.floor(sy));
    const x1 = Math.min(W - 1, x0 + 1), y1 = Math.min(H - 1, y0 + 1);
    const fx = sx - x0, fy = sy - y0;
    const i00 = (y0 * W + x0) * img.channels, i10 = (y0 * W + x1) * img.channels;
    const i01 = (y1 * W + x0) * img.channels, i11 = (y1 * W + x1) * img.channels;
    const a00 = alpha[y0 * W + x0], a10 = alpha[y0 * W + x1];
    const a01 = alpha[y1 * W + x0], a11 = alpha[y1 * W + x1];
    const o = (y * outW + x) * 4;
    for (let c = 0; c < 3; c++) {
      const v = (img.data[i00 + c] * (1 - fx) + img.data[i10 + c] * fx) * (1 - fy)
        + (img.data[i01 + c] * (1 - fx) + img.data[i11 + c] * fx) * fy;
      out[o + c] = Math.round(v);
    }
    const av = (a00 * (1 - fx) + a10 * fx) * (1 - fy) + (a01 * (1 - fx) + a11 * fx) * fy;
    out[o + 3] = Math.round(av * 255);
  }
}

writeFileSync(OUT, encodePng(outW, outH, out));
console.log(`${OUT}  ${outW}×${outH}  (源内容 ${cw}×${ch} @ ${W}×${H})`);
