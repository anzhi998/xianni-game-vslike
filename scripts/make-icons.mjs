/**
 * 生成 PWA 图标(无第三方依赖)
 *
 * 为什么不放一张 png 进仓库:图标是纯几何图形,而项目里已经有一个「不提交二进制资源」的
 * 约定 —— 全部贴图在运行时由 Phaser.Graphics 画出来。图标同理,用这段脚本现画,
 * 于是仓库里只有 200 行代码而不是 4 个看不清 diff 的二进制。
 *
 *   node scripts/make-icons.mjs
 *
 * 产物写进 public/icons/,vite 会原样拷进 dist/,manifest 按文件名引用。
 * 想改配色只改下面的 PALETTE,重跑一次即可。
 */
import { deflateSync } from 'node:zlib';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const OUT_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '../public/icons');

const PALETTE = {
  bgTop: [26, 22, 54],      // #1a1636 深紫底
  bgBottom: [13, 13, 26],   // #0d0d1a 现有页面底色
  orbCore: [190, 168, 255], // 法力核心
  orbEdge: [106, 63, 214],  // 化魔指的紫
  ring: [126, 231, 135],    // 玉环
  spark: [255, 214, 130],   // 灵光
};

/** 平滑插值 t∈[0,1] */
const mix = (a, b, t) => [
  Math.round(a[0] + (b[0] - a[0]) * t),
  Math.round(a[1] + (b[1] - a[1]) * t),
  Math.round(a[2] + (b[2] - a[2]) * t),
];

/** 单像素着色。u/v ∈[0,1],inset 为内容缩放(maskable 图标要留安全区) */
function shade(u, v, inset) {
  const bg = mix(PALETTE.bgTop, PALETTE.bgBottom, v);

  // 把坐标收回安全区内,再按 inset 放大内容
  const x = (u - 0.5) / inset + 0.5;
  const y = (v - 0.5) / inset + 0.5;
  const dx = x - 0.5;
  const dy = y - 0.5;
  const d = Math.sqrt(dx * dx + dy * dy);

  // 外发光:把球体的紫摊到背景上
  let out = bg;
  const glow = Math.max(0, 1 - d / 0.55);
  out = mix(out, PALETTE.orbEdge, glow ** 2.4 * 0.55);

  // 玉环
  const ringD = Math.abs(d - 0.36);
  const ringA = Math.max(0, 1 - ringD / 0.035);
  if (ringA > 0) out = mix(out, PALETTE.ring, Math.min(1, ringA * 1.4));

  // 核心法球
  if (d < 0.26) {
    const t = Math.min(1, d / 0.26);
    out = mix(PALETTE.orbCore, PALETTE.orbEdge, t ** 0.7);
    // 左上高光,让球看着是体积而不是圆片
    const hx = x - 0.42;
    const hy = y - 0.42;
    const hl = Math.max(0, 1 - Math.sqrt(hx * hx + hy * hy) / 0.14);
    out = mix(out, PALETTE.spark, hl ** 2 * 0.8);
  }

  // 灵光点(右上)
  const px = x - 0.68;
  const py = y - 0.3;
  const pd = Math.sqrt(px * px + py * py);
  const pa = Math.max(0, 1 - pd / 0.05);
  if (pa > 0) out = mix(out, PALETTE.spark, pa ** 1.5);

  return out;
}

/** CRC32(PNG 分块校验) */
const CRC_TABLE = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  return t;
})();

function crc32(buf) {
  let c = -1;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

/** RGBA 像素数组 → PNG 文件 buffer(8 位真彩色,无 alpha) */
function encodePng(width, height, rgb) {
  const raw = Buffer.alloc(height * (1 + width * 3));
  for (let y = 0; y < height; y++) {
    const rowStart = y * (1 + width * 3);
    raw[rowStart] = 0; // filter: None
    rgb.copy(raw, rowStart + 1, y * width * 3, (y + 1) * width * 3);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;  // bit depth
  ihdr[9] = 2;  // colour type: truecolour
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

function render(size, inset) {
  const rgb = Buffer.alloc(size * size * 3);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const [r, g, b] = shade((x + 0.5) / size, (y + 0.5) / size, inset);
      const o = (y * size + x) * 3;
      rgb[o] = r;
      rgb[o + 1] = g;
      rgb[o + 2] = b;
    }
  }
  return encodePng(size, size, rgb);
}

const TARGETS = [
  // maskable 需要留 10% 安全区(Android 会按内容裁切),内容缩到 80%
  { file: 'icon-192.png', size: 192, inset: 1 },
  { file: 'icon-512.png', size: 512, inset: 1 },
  { file: 'icon-maskable-512.png', size: 512, inset: 0.8 },
  { file: 'apple-touch-icon.png', size: 180, inset: 1 },
];

mkdirSync(OUT_DIR, { recursive: true });
for (const { file, size, inset } of TARGETS) {
  const buf = render(size, inset);
  writeFileSync(resolve(OUT_DIR, file), buf);
  console.log(`${file}  ${size}x${size}  ${(buf.length / 1024).toFixed(1)} KB`);
}