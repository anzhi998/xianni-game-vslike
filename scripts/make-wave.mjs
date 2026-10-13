#!/usr/bin/env node
/**
 * 道化黄泉水浪浪头 —— AI 原图 → 游戏贴图
 *
 * 与 make-sprite.mjs 的区别:浪头是**横向长条**(宽 ≈ 3.3 : 1),方形裁切
 * 会把它灌成 N×N 灌满透明区,完全不能用;所以走 --aspect free 那条「按 bbox
 * 自由裁切、按宽度定高」的管线,再额外做两件浪头专属的事:
 *
 *   1. **底边 alpha 渐隐** —— 原图的水线底边是一道硬直线。贴图在游戏里会被
 *      旋转 90°(浪朝右画 → 旋转后浪顶朝推进方向),原图的底边就变成了
 *      「浪头的背缘」,直接盖在 Graphics 画的半透明浪身上会像一张贴纸。
 *      把底部 14% 渐隐掉,背缘就融进浪身里。
 *   2. **下采样用面积平均** —— 原图 1024px 缩到 220px 是 ~4.7 倍缩小,
 *      4 抽头的 Catmull-Rom 会跳采样出锯齿;先用 box average 降到 2 倍目标
 *      再走 bicubic,边缘干净得多。
 *
 * ## 为什么底色是品红而不是绿幕
 *
 * 项目《美术素材规格.md》§6 推荐 #00FF00 绿幕,理由是修仙题材里没有那个绿。
 * 但这张图的主体**就是绿**(碧绿 #39b98a)——绿幕会糊边。所以这张图改用
 * 品红 #FF00FF:主体(绿 / 白 / 深青)离品红都极远,阈值怎么设都不会误伤。
 *
 * ## 尺寸为什么是 220
 *
 * 显示宽度 = 浪前宽 192px(3 格)× 1.15 溢出 ≈ 220px。游戏 pixelArt:true
 * (NEAREST 过滤),**贴图必须一比一显示**才不会抽成噪点(规格 §0 的老坑),
 * 所以按显示尺寸烘焙。
 *
 * 用法:
 *   node scripts/make-wave.mjs [输入] [输出] [--width N] [--no-fade]
 * 默认:
 *   assets-src/raw/daohua_wave_raw.png → src/assets/fx_daohua_wave.png,宽 220
 */

import { readFileSync, writeFileSync, statSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { deflateSync, inflateSync } from 'node:zlib';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..');
const argv = process.argv.slice(2);
/** 取 flag 的值;flag 不在时返回默认值。
 *  不能写 `argv[indexOf('--x') + 1] ?? def` —— flag 缺席时 indexOf 是 -1,
 *  会摸到 argv[0](位置参数),Number() 出 NaN 且不报错。 */
function argValue(name, def) {
  const i = argv.indexOf(name);
  if (i < 0 || i + 1 >= argv.length) return def;
  return argv[i + 1];
}
// 位置参数 = 不跟在 flag 后面的参数(输出/输出路径)
const pos = [];
for (let i = 0; i < argv.length; i++) {
  if (argv[i].startsWith('--')) { i++; continue; }
  pos.push(argv[i]);
}
const IN = resolve(ROOT, pos[0] ?? 'assets-src/raw/daohua_wave_raw.png');
const OUT = resolve(ROOT, pos[1] ?? 'src/assets/fx_daohua_wave.png');
const TARGET_W = Number(argValue('--width', 220));
const NO_FADE = argv.includes('--no-fade');
/** 底边渐隐占高的比例(见文件头说明) */
const FADE_FRAC = 0.14;

// ─── PNG 编解码(与 make-sprite.mjs 同一实现) ────────────────────────────
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
  let p = 8, width, height, depth, color, chunks = [];
  while (p < buf.length) {
    const len = buf.readUInt32BE(p); p += 4;
    const type = buf.slice(p, p + 4).toString('latin1'); p += 4;
    const data = buf.slice(p, p + len); p += len + 4;
    if (type === 'IHDR') { width = data.readUInt32BE(0); height = data.readUInt32BE(4); depth = data[8]; color = data[9]; }
    else if (type === 'IDAT') chunks.push(data);
    else if (type === 'IEND') break;
  }
  if (depth !== 8) throw new Error(`仅支持 8 位色深,收到 ${depth}`);
  if (color !== 2 && color !== 6) throw new Error(`仅支持 RGB(A),color type=${color}`);
  const channels = color === 6 ? 4 : 3;
  const raw = inflateSync(Buffer.concat(chunks));
  const stride = width * channels;
  const px = Buffer.alloc(stride * height);
  let rp = 0, prev = Buffer.alloc(stride);
  for (let y = 0; y < height; y++) {
    const ft = raw[rp++];
    const row = raw.subarray(rp, rp + stride); rp += stride;
    const cur = Buffer.from(row);
    for (let x = 0; x < stride; x++) {
      const a = x >= channels ? cur[x - channels] : 0;
      const b = prev[x];
      const c = x >= channels ? prev[x - channels] : 0;
      let v = cur[x];
      if (ft === 1) v = (v + a) & 255;
      else if (ft === 2) v = (v + b) & 255;
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
  return { width, height, channels, data: px };
}

// ─── 像素访问 ──────────────────────────────────────────────────────────────
const getPx = (img, x, y) => {
  const i = (y * img.width + x) * img.channels;
  return [img.data[i], img.data[i + 1], img.data[i + 2], img.channels === 4 ? img.data[i + 3] : 255];
};

// ─── 1. 抹掉 AI 水印(右下角 24% × 14%) ──────────────────────────────────
// 与 make-sprite 同源:RGB 与 alpha 一起清零,否则留下一层 a=255 的脏块。
function eraseWatermark(img) {
  const W = img.width, H = img.height;
  for (let y = Math.floor(H * 0.86); y < H; y++) {
    for (let x = Math.floor(W * 0.76); x < W; x++) {
      const i = (y * W + x) * img.channels;
      img.data[i] = 0; img.data[i + 1] = 0; img.data[i + 2] = 0;
      if (img.channels === 4) img.data[i + 3] = 0;
    }
  }
}

// ─── 2. 找背景色:全图网格采样取众数 ──────────────────────────────────────
// 不用 make-sprite 的「八点取最暗」:AI 的纯色底常有 vignette 渐变,八点
// 采到的可能与别处差 40+,背景一大片落在抠图阈值里,直接把整张图连成一块。
// 网格众数(背景占绝对多数)对渐变和 vignette 都稳。
function findBackground(img) {
  const W = img.width, H = img.height;
  const counts = new Map();
  const STEP = 24;
  for (let y = 4; y < H; y += STEP) {
    for (let x = 4; x < W; x += STEP) {
      const [r, g, b] = getPx(img, x, y);
      // 量化到 8 步,吸收渐变噪点
      const k = `${r >> 3},${g >> 3},${b >> 3}`;
      counts.set(k, (counts.get(k) ?? 0) + 1);
    }
  }
  let bestK = '', bestN = -1;
  for (const [k, n] of counts) {
    if (n > bestN) { bestN = n; bestK = k; }
  }
  const [r, g, b] = bestK.split(',').map(v => (Number(v) << 3) + 4);
  return { r, g, b };
}

// ─── 3. 抠图 + 最大连通块 ─────────────────────────────────────────────────
// 阈值**不沿用** make-sprite 的 28/90,也不写死 —— 这张图是水彩软边,主体
// 离品红底的色距只到 ~280,而背景噪点几乎都在 20 以内,中间 20~260 是一大段
// 渐变过渡(硬边图那段是空的)。所以:
//   - t0/t1 给 CLI(--t0/--t1),默认 60/150 是按这张图实测直方图定的:
//     背景全在 <60,主体实心区在 >150,60~150 正好是浪的软边过渡带。
//   - 若换成硬边原图(绿幕人形那种),应提到 110/200,否则底色噪点漏进来。
const CHROMA = {
  t0: Number(argValue('--t0', 60)),
  t1: Number(argValue('--t1', 150)),
};

function keepLargestComponent(alpha, W, H, threshold) {
  const visited = new Uint8Array(W * H);
  const comp = new Int32Array(W * H).fill(-1);
  let best = { size: 0, root: -1 };
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
        visited[p] = 1; comp[p] = root; size++;
        const x0 = p % W, y0 = (p - x0) / W;
        if (x0 > 0) { const q = p - 1; if (!visited[q] && alpha[q] >= threshold) stack.push(q); }
        if (x0 < W - 1) { const q = p + 1; if (!visited[q] && alpha[q] >= threshold) stack.push(q); }
        if (y0 > 0) { const q = p - W; if (!visited[q] && alpha[q] >= threshold) stack.push(q); }
        if (y0 < H - 1) { const q = p + W; if (!visited[q] && alpha[q] >= threshold) stack.push(q); }
      }
      if (size > best.size) best = { size, root };
    }
  }
  if (best.root < 0) return;
  // 只保留最大连通块 + 它周围 FRINGE px 的反锯齿边,其余(包括浮在主体外的
  // 星点、水印残余、以及**半透明的底色雾**)一律清零。
  //
  // 与 make-sprite 的差别:那边只清 alpha>=threshold 的非最大块,13~95 的
  // 半透明底色雾会全留下 —— 在绿底人形图上不明显,在品红底上是一整圈
  // 粉雾,会把 bbox 撑大一倍多。所以这里改成「最大块膨胀 FRINGE 圈」。
  const FRINGE = 2;
  const keep = new Uint8Array(W * H);
  for (let i = 0; i < alpha.length; i++) {
    if (comp[i] === best.root) keep[i] = 1;
  }
  for (let pass = 0; pass < FRINGE; pass++) {
    const next = Uint8Array.from(keep);
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const i = y * W + x;
        if (keep[i]) continue;
        if ((x > 0 && keep[i - 1]) || (x < W - 1 && keep[i + 1]) ||
            (y > 0 && keep[i - W]) || (y < H - 1 && keep[i + W])) next[i] = 1;
      }
    }
    keep.set(next);
  }
  for (let i = 0; i < alpha.length; i++) {
    if (!keep[i]) alpha[i] = 0;
  }
}

function keyOutAlpha(img, bg) {
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
    }
  }
  // 连通阈值用 32 而不是 make-sprite 的 96:浪的尾水是**有意做的半透明渐隐**,
  // 按 96 切会把渐隐拦腰砍成一道硬边。降到 32 后整条尾水都在最大连通块里,
  // 远处的底色噪点(不连通)照样被剔掉。
  keepLargestComponent(alpha, W, H, 32);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      if (alpha[y * W + x] > 12) {
        if (x < minX) minX = x; if (x > maxX) maxX = x;
        if (y < minY) minY = y; if (y > maxY) maxY = y;
      }
    }
  }
  if (maxX < 0) { minX = 0; minY = 0; maxX = W - 1; maxY = H - 1; }
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

// ─── 3.5 去边污染(defringe) ──────────────────────────────────────────────
// 抠图的半透明像素 RGB 里还混着品红 —— 在亮底上看不出来,铺到游戏深棕地面
// 上就是一圈粉灰。经典解法:半透明像素的颜色用**附近不透明像素**回填,
// alpha 保留。
//
// 单轮 3px 邻域不够:原图底部的品红渐隐带有几十像素厚,那里方圆几十像素
// 都没有不透明邻居。所以做成**多轮传播** —— 每轮把「已定色像素」的颜色
// 推进 1px 到未定色的半透明像素,直到 maxPass 轮或没有像素可染。
function defringe(img, maxPass = 64) {
  const W = img.width, H = img.height, d = img.data;
  const src = Buffer.from(d);
  // settled:颜色已经可信(原本不透明,或已被传播染过)
  const settled = new Uint8Array(W * H);
  for (let i = 0; i < W * H; i++) if (src[i * 4 + 3] >= 250) settled[i] = 1;
  for (let pass = 0; pass < maxPass; pass++) {
    let changed = 0;
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const i = y * W + x;
        if (settled[i]) continue;
        const a = src[i * 4 + 3];
        if (a === 0) { settled[i] = 1; continue; }   // 全透,没有颜色可修
        let r = 0, g = 0, b = 0, n = 0;
        for (const [ox, oy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          const xx = x + ox, yy = y + oy;
          if (xx < 0 || yy < 0 || xx >= W || yy >= H) continue;
          const j = yy * W + xx;
          if (!settled[j]) continue;
          // 读 d 而不是 src:上一轮染好的像素在 src 里还是污染色
          r += d[j * 4]; g += d[j * 4 + 1]; b += d[j * 4 + 2]; n++;
        }
        if (n === 0) continue;
        d[i * 4] = Math.round(r / n);
        d[i * 4 + 1] = Math.round(g / n);
        d[i * 4 + 2] = Math.round(b / n);
        settled[i] = 1;
        changed++;
      }
    }
    if (changed === 0) break;
  }
}

// ─── 4. bbox 裁切(留 2% 边) ──────────────────────────────────────────────
function cropToBbox(img, bbox) {
  const { minX, minY, maxX, maxY } = bbox;
  const bw = maxX - minX + 1, bh = maxY - minY + 1;
  const px = Math.round(bw * 0.02), py = Math.round(bh * 0.02);
  const sx = Math.max(0, minX - px), sy = Math.max(0, minY - py);
  const w = Math.min(img.width - sx, bw + px * 2);
  const h = Math.min(img.height - sy, bh + py * 2);
  const out = Buffer.alloc(w * h * 4);
  for (let y = 0; y < h; y++) {
    img.data.copy(out, y * w * 4, (sy + y) * img.width * 4 + sx * 4, (sy + y) * img.width * 4 + (sx + w) * 4);
  }
  return { width: w, height: h, channels: 4, data: out };
}

// ─── 4.5 取中段 + 两端渐隐(均匀浪条专用) ─────────────────────────────────
// AI 出的均匀浪条可能比目标长宽比长得多(实测出了 ~6:1)。因为条带沿长度
// 均匀,取中段不损失信息 —— 裁到目标长宽比,浪在游戏里才够「深」。
function cropCenterX(img, ratio) {
  const W = img.width, H = img.height;
  const w = Math.max(1, Math.round(W * ratio));
  const sx = Math.floor((W - w) / 2);
  const out = Buffer.alloc(w * H * 4);
  for (let y = 0; y < H; y++) {
    img.data.copy(out, y * w * 4, (y * W + sx) * 4, (y * W + sx + w) * 4);
  }
  return { width: w, height: H, channels: 4, data: out };
}

/** 左右两端各 fadeX 比例的 alpha 线性渐隐 —— 裁切切口不做软处理会像剪纸 */
function fadeSides(img, frac) {
  const W = img.width, H = img.height, d = img.data;
  const fw = Math.max(1, Math.round(W * frac));
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < fw; x++) {
      const k = x / fw;
      d[(y * W + x) * 4 + 3] = Math.round(d[(y * W + x) * 4 + 3] * k);
      const x2 = W - 1 - x;
      d[(y * W + x2) * 4 + 3] = Math.round(d[(y * W + x2) * 4 + 3] * k);
    }
  }
}

// ─── 5. 底边 alpha 渐隐 ───────────────────────────────────────────────────
// 旋转 90° 后原图底边 = 浪头背缘,渐隐掉才不会像贴纸盖在浪身上。
function fadeBottom(img, frac) {
  const W = img.width, H = img.height;
  const y0 = Math.floor(H * (1 - frac));
  for (let y = y0; y < H; y++) {
    const k = 1 - (y - y0) / (H - y0);        // 1 → 0
    for (let x = 0; x < W; x++) {
      const i = (y * W + x) * 4;
      img.data[i + 3] = Math.round(img.data[i + 3] * k);
    }
  }
}

// ─── 6. 缩放:大幅缩小先走面积平均,再 bicubic ────────────────────────────
function resizeArea(src, dstW, dstH) {
  const out = Buffer.alloc(dstW * dstH * 4);
  for (let y = 0; y < dstH; y++) {
    const sy0 = y * src.height / dstH, sy1 = (y + 1) * src.height / dstH;
    for (let x = 0; x < dstW; x++) {
      const sx0 = x * src.width / dstW, sx1 = (x + 1) * src.width / dstW;
      let r = 0, g = 0, b = 0, a = 0, n = 0;
      for (let sy = Math.floor(sy0); sy < Math.ceil(sy1); sy++) {
        const wy = Math.min(sy + 1, sy1) - Math.max(sy, sy0);
        if (wy <= 0) continue;
        for (let sx = Math.floor(sx0); sx < Math.ceil(sx1); sx++) {
          const wx = Math.min(sx + 1, sx1) - Math.max(sx, sx0);
          if (wx <= 0) continue;
          const i = (sy * src.width + sx) * 4;
          const w = wx * wy;
          r += src.data[i] * w; g += src.data[i + 1] * w;
          b += src.data[i + 2] * w; a += src.data[i + 3] * w;
          n += w;
        }
      }
      const o = (y * dstW + x) * 4;
      out[o] = Math.round(r / n); out[o + 1] = Math.round(g / n);
      out[o + 2] = Math.round(b / n); out[o + 3] = Math.round(a / n);
    }
  }
  return { width: dstW, height: dstH, channels: 4, data: out };
}

function resizeBicubic(src, dstW, dstH) {
  const srcW = src.width, srcH = src.height;
  const out = Buffer.alloc(dstW * dstH * 4);
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

function resizeSmart(src, dstW, dstH) {
  const ratio = Math.max(src.width / dstW, src.height / dstH);
  if (ratio < 1.5) return resizeBicubic(src, dstW, dstH);
  // 先面积平均降到 2 倍目标,消除 4 抽头采样的跳点
  const midW = Math.max(dstW, Math.round(src.width / (ratio / 2)));
  const midH = Math.max(dstH, Math.round(src.height / (ratio / 2)));
  const mid = resizeArea(src, midW, midH);
  return resizeBicubic(mid, dstW, dstH);
}

// ─── 主管线 ───────────────────────────────────────────────────────────────
console.log(`源: ${IN} (${(statSync(IN).size / 1024).toFixed(1)} KB)`);
const raw = decodePng(readFileSync(IN));
console.log(`解码: ${raw.width}x${raw.height} ${raw.channels === 4 ? 'RGBA' : 'RGB'}`);

eraseWatermark(raw);
const bg = findBackground(raw);
console.log(`背景色: (${bg.r},${bg.g},${bg.b})`);
if (bg.g > 200 && bg.r < 120 && bg.b < 120) {
  console.error('  ⚠️ 背景采样出来是绿色 —— 这张图的主体是碧绿,绿幕会糊边,请用品红底重出图。');
}
const keyed = keyOutAlpha(raw, bg);
const { minX, minY, maxX, maxY } = keyed.bbox;
console.log(`抠图: bbox=(${minX},${minY})-(${maxX},${maxY})  内容 ${maxX - minX + 1}x${maxY - minY + 1}`);

let cropped = cropToBbox(keyed, keyed.bbox);
defringe(cropped);

// --take-w:均匀浪条取中段(裁到目标长宽比),两端切口用 --fade-x 软化
const takeW = Number(argValue('--take-w', 1));
if (takeW < 1) {
  cropped = cropCenterX(cropped, takeW);
  console.log(`取中段: 宽度 × ${takeW} -> ${cropped.width}x${cropped.height}`);
}
const fadeX = Number(argValue('--fade-x', 0));
if (fadeX > 0) {
  fadeSides(cropped, fadeX);
  console.log(`两端渐隐: 各 ${Math.round(fadeX * 100)}% 宽`);
}
if (!NO_FADE) fadeBottom(cropped, FADE_FRAC);
console.log(`裁切: ${cropped.width}x${cropped.height}  (defringe${NO_FADE ? '' : ` + 底边 ${Math.round(FADE_FRAC * 100)}% 渐隐`})`);

const outW = TARGET_W;
const outH = Math.max(1, Math.round(TARGET_W * cropped.height / cropped.width));
const sized = resizeSmart(cropped, outW, outH);
console.log(`缩放: ${cropped.width}x${cropped.height} -> ${outW}x${outH} (长宽比 ${(cropped.width / cropped.height).toFixed(2)})`);

// 验收统计:非透明像素 / 平均色 / 平均亮度(游戏地面亮度 45 上下)
let opaque = 0, sr = 0, sg = 0, sb = 0;
for (let i = 0; i < outW * outH; i++) {
  const a = sized.data[i * 4 + 3];
  if (a < 128) continue;
  opaque++;
  sr += sized.data[i * 4]; sg += sized.data[i * 4 + 1]; sb += sized.data[i * 4 + 2];
}
const lum = Math.round(0.299 * sr / opaque + 0.587 * sg / opaque + 0.114 * sb / opaque);
console.log(`验收: 非透明 ${opaque}/${outW * outH} (${(opaque / (outW * outH) * 100).toFixed(1)}%)  平均色 #${[sr, sg, sb].map(v => Math.round(v / opaque).toString(16).padStart(2, '0')).join('')}  平均亮度 ${lum}`);

writeFileSync(OUT, encodePng(outW, outH, sized.data));
console.log(`✓ ${OUT} (${(statSync(OUT).size / 1024).toFixed(1)} KB)`);
