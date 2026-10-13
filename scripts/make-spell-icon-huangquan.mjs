/**
 * 生成两张法术面板图标(32×32,带 alpha 通道)
 *
 * - icon_spell_huangquan.png  黄泉升窍诀(冰锥)
 * - icon_spell_daohua.png     道化黄泉(开闸放水)
 *
 * 约定(与 `docs/美术素材规格.md` §3.4 一致):
 *   - 32×32,PNG RGBA,透明背景
 *   - **不能带烘焙的方形底板**(代码会用 SpellConfig.color 当底,叠两层会双重边框)
 *   - 配色必须等于 `SpellConfig.color`:
 *       huangquan = 0x59d9a0  浅碧
 *       daohua    = 0x39b98a  深碧(同色,靠剪影区分)
 *   - 进化对必须剪影不同
 *   - 主体居中,不要画得太满,留 1~2px 安全边
 *
 *   node scripts/make-spell-icon-huangquan.mjs
 */

import { deflateSync } from 'node:zlib';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const OUT_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '../src/assets');

const SIZE = 32;

/* ---------- 黄泉升窍诀专用配色(冰锥) ----------
 *
 * 冰属冷。SpellConfig.color = #59d9a0 已是浅碧,这里往
 * 冷青(Cyan 200°)再走一档,把"冰"的质感和同门龙卷/呼风分开。
 */
const HQ = {
  spine:   [224, 250, 255], // 亮芯,接近白
  core:    [89,  217, 160], // SpellConfig.color = #59d9a0
  body:    [56,  176, 138], // 中段
  shadow:  [22,  100, 82],  // 深影
  deep:    [12,  54,  46],  // 描边
  frost:   [206, 240, 248], // 冰花高光
  shard:   [138, 218, 198], // 冰晶碎屑
};

/* ---------- 道化黄泉专用配色(开闸放水) ----------
 *
 * 同色 #39b98a。但剪影完全不同:一扇横向闸门,门顶大开口三股水流喷涌。
 * 与 huangquan 同色但**完全不同剪影**(锥 vs 闸)。
 */
const DH = {
  light:   [225, 251, 240], // 浪头高光
  foam:    [180, 240, 215], // 白色水沫
  core:    [57,  185, 138], // #39b98a
  body:    [22,  120, 90],  // 浪身
  shadow:  [10,  56,  42],  // 暗部
  gate:    [78,  60,  42],  // 闸门木色
  gateHi:  [128, 96, 64],   // 闸门高光
  rust:    [200, 145, 70],  // 闸门锈/铜
};

/* ===================== 共用:PNG RGBA 编码 ===================== */

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

/** RGBA 像素数组(每像素 4 字节) → PNG buffer */
function encodePngRGBA(width, height, rgba) {
  const bpp = 4;
  const stride = width * bpp;
  const raw = Buffer.alloc(height * (1 + stride));
  for (let y = 0; y < height; y++) {
    raw[y * (1 + stride)] = 0; // filter: None
    rgba.copy(raw, y * (1 + stride) + 1, y * stride, (y + 1) * stride);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // colour type: truecolour + alpha
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

/** 在画布上以 alpha over 合成一个像素 */
function setPx(buf, x, y, r, g, b, a) {
  if (x < 0 || y < 0 || x >= SIZE || y >= SIZE || a <= 0) return;
  const idx = (y * SIZE + x) * 4;
  if (a >= 255) {
    buf[idx] = r; buf[idx + 1] = g; buf[idx + 2] = b; buf[idx + 3] = 255;
    return;
  }
  const dstA = buf[idx + 3];
  if (dstA === 0) {
    buf[idx] = r; buf[idx + 1] = g; buf[idx + 2] = b; buf[idx + 3] = a;
    return;
  }
  const sa = a / 255, da = dstA / 255;
  const out = sa + da * (1 - sa);
  if (out <= 0) return;
  buf[idx]     = Math.round((r * sa + buf[idx]     * da * (1 - sa)) / out);
  buf[idx + 1] = Math.round((g * sa + buf[idx + 1] * da * (1 - sa)) / out);
  buf[idx + 2] = Math.round((b * sa + buf[idx + 2] * da * (1 - sa)) / out);
  buf[idx + 3] = Math.round(out * 255);
}

/** 软边实心圆:r 半径处 alpha=255,外缘衰减到 0 */
function stampDot(buf, cx, cy, r, rgb) {
  for (let y = Math.floor(cy - r); y <= Math.ceil(cy + r); y++) {
    for (let x = Math.floor(cx - r); x <= Math.ceil(cx + r); x++) {
      if (x < 0 || y < 0 || x >= SIZE || y >= SIZE) continue;
      const d = Math.hypot(x + 0.5 - cx, y + 0.5 - cy);
      const edge = Math.max(0, 1 - (d - (r - 1)) / 1);
      const a = Math.round(Math.max(0, Math.min(1, edge)) * 255);
      if (a > 0) setPx(buf, x, y, rgb[0], rgb[1], rgb[2], a);
    }
  }
}

/* ---- 三角形 + 边缘羽化 ---- */
function stampTri(buf, p1, p2, p3, rgb, edgeA = 100) {
  const minX = Math.floor(Math.min(p1[0], p2[0], p3[0]));
  const maxX = Math.ceil(Math.max(p1[0], p2[0], p3[0]));
  const minY = Math.floor(Math.min(p1[1], p2[1], p3[1]));
  const maxY = Math.ceil(Math.max(p1[1], p2[1], p3[1]));
  const sign = (a, b, c) =>
    (a[0] - c[0]) * (b[1] - c[1]) - (b[0] - c[0]) * (a[1] - c[1]);
  const inside = (px, py, a, b, c) => {
    const p = [px, py];
    const s1 = sign(p, a, b);
    const s2 = sign(p, b, c);
    const s3 = sign(p, c, a);
    return (s1 >= -0.5 && s2 >= -0.5 && s3 >= -0.5) ||
           (s1 <= 0.5 && s2 <= 0.5 && s3 <= 0.5);
  };
  for (let y = minY; y <= maxY; y++) {
    for (let x = minX; x <= maxX; x++) {
      if (x < 0 || y < 0 || x >= SIZE || y >= SIZE) continue;
      if (inside(x + 0.5, y + 0.5, p1, p2, p3)) {
        setPx(buf, x, y, rgb[0], rgb[1], rgb[2], 255);
      }
    }
  }
  // 1px 边缘羽化:扫描外扩一圈,看 4 邻是否有内部点
  for (let y = minY - 1; y <= maxY + 1; y++) {
    for (let x = minX - 1; x <= maxX + 1; x++) {
      if (x < 0 || y < 0 || x >= SIZE || y >= SIZE) continue;
      if (inside(x + 0.5, y + 0.5, p1, p2, p3)) continue;
      const neigh = [[x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]];
      let touched = false;
      for (const [nx, ny] of neigh) {
        if (nx < 0 || ny < 0 || nx >= SIZE || ny >= SIZE) continue;
        if (inside(nx + 0.5, ny + 0.5, p1, p2, p3)) {
          touched = true;
          break;
        }
      }
      if (touched) setPx(buf, x, y, rgb[0], rgb[1], rgb[2], edgeA);
    }
  }
}

/* ---- 实心矩形 + 1px 边缘羽化 ---- */
function stampRect(buf, x0, y0, x1, y1, rgb) {
  for (let y = y0 - 1; y <= y1 + 1; y++) {
    for (let x = x0 - 1; x <= x1 + 1; x++) {
      if (x < 0 || y < 0 || x >= SIZE || y >= SIZE) continue;
      let a = 255;
      if (x === x0 - 1 || x === x1 + 1 || y === y0 - 1 || y === y1 + 1) a = 200;
      setPx(buf, x, y, rgb[0], rgb[1], rgb[2], a);
    }
  }
}

/* ---- 线段 ---- */
function stampLine(buf, x1, y1, x2, y2, rgb, w = 1) {
  const dx = x2 - x1, dy = y2 - y1;
  const steps = Math.ceil(Math.max(Math.abs(dx), Math.abs(dy)) * 2) + 1;
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const x = x1 + dx * t;
    const y = y1 + dy * t;
    stampDot(buf, x, y, w, rgb);
  }
}

/* ============================== 黄泉升窍诀 ==============================
 *
 * 冰锥:更宽(8w)、更长、带齿、带棱,且**菱形尖朝下**。
 *  - 上端宽扁 (粗端) + 4 颗朝上的"笋状齿"
 *  - 锥身从 8w 渐收到 2w(更短更长)
 *  - **菱形尖头**(两端都是尖)朝下落
 *  - 两侧带"冰锥侧刃"小刺,读起来像"凿"而不是"管"
 *  - 四角各一颗细碎屑,圆点感比之前多
 */
function drawHuangquan() {
  const buf = Buffer.alloc(SIZE * SIZE * 4);

  // 中轴 x=16。留 2px 安全边,y 范围 [3, 30]
  const xc = 16;

  /* 1. 锥底粗端(顶部 y=3..6) */
  // 4 颗上向笋齿齿 y=3..5
  for (let i = 0; i < 4; i++) {
    const x0 = 12 + i * 2;
    stampRect(buf, x0, 3, x0 + 2, 5, HQ.deep);
    stampRect(buf, x0, 3, x0 + 1, 5, HQ.spine);
  }
  // 齿底横带 y=6
  stampRect(buf, 11, 6, 21, 7, HQ.shadow);
  stampRect(buf, 12, 6, 20, 6, HQ.body);

  /* 2. 锥身 —— 由 8w 渐收到 2w,y=7..20 */
  // 用一个梯形包络(外侧)
  stampTri(
    buf,
    [11.4, 7.5],
    [20.6, 7.5],
    [xc + 1.5, 20.5],
    [xc - 1.5, 20.5],
    HQ.body,
    90,
  );

  // 锥身高亮带(偏左 1/3,让光感一致)
  stampTri(
    buf,
    [13.2, 7.5],
    [15.2, 7.5],
    [xc - 0.5, 20.5],
    [xc - 1.5, 20.5],
    HQ.core,
    60,
  );
  // 亮芯
  stampTri(
    buf,
    [13.8, 7.5],
    [14.4, 7.5],
    [xc - 0.9, 20.5],
    [xc - 1.1, 20.5],
    HQ.spine,
    40,
  );

  // 两侧棱
  stampTri(
    buf,
    [11.4, 7.5],
    [12.2, 7.5],
    [15.3, 21.0],
    [14.8, 21.0],
    HQ.deep,
    60,
  );
  stampTri(
    buf,
    [19.8, 7.5],
    [20.6, 7.5],
    [17.2, 21.0],
    [16.7, 21.0],
    HQ.deep,
    60,
  );

  // 三道斜裂缝(冰的解理面)
  stampLine(buf, 12.5, 9.5, 18.5, 11.5, HQ.spine, 0.7);
  stampLine(buf, 13, 13, 18, 15, HQ.spine, 0.7);
  stampLine(buf, 13.5, 17, 17.5, 18.5, HQ.frost, 0.5);

  /* 3. 锥尖(y=21..28)—— **菱形尖头**,朝下落 */
  // 上半(从锥身末端往外张的肩部)
  stampTri(
    buf,
    [14.7, 20.5],
    [17.3, 20.5],
    [18.2, 22.0],
    [13.8, 22.0],
    HQ.core,
    60,
  );
  // 下半(收尖)
  stampTri(
    buf,
    [13.8, 22.0],
    [18.2, 22.0],
    [xc, 28.6],
    HQ.spine,
    60,
  );
  // 菱形描边(深色)
  stampTri(
    buf,
    [14.3, 20.3],
    [17.7, 20.3],
    [18.5, 22.0],
    [13.5, 22.0],
    HQ.deep,
    60,
  );
  stampTri(
    buf,
    [13.5, 22.0],
    [18.5, 22.0],
    [xc + 0.4, 28.8],
    [xc - 0.4, 28.8],
    HQ.deep,
    60,
  );

  /* 4. 锥尖侧刃的小刺(2 颗小冰刺,凿体感) */
  stampTri(
    buf,
    [13.8, 22.0],
    [14.6, 22.0],
    [12.4, 24.0],
    [12.0, 24.0],
    HQ.body,
    60,
  );
  stampTri(
    buf,
    [17.4, 22.0],
    [18.2, 22.0],
    [20.0, 24.0],
    [19.6, 24.0],
    HQ.body,
    60,
  );

  /* 5. 冰花碎屑 */
  stampDot(buf, 6.5, 9.5, 1.2, HQ.frost);
  stampDot(buf, 25.5, 9.5, 1.2, HQ.frost);
  stampDot(buf, 4.5, 17, 0.9, HQ.shard);
  stampDot(buf, 27.5, 17, 0.9, HQ.shard);
  stampDot(buf, 9, 27, 0.9, HQ.shard);
  stampDot(buf, 23, 27, 0.9, HQ.shard);
  stampDot(buf, xc, 30, 1.4, HQ.frost);

  // 锥尖落点的小圈(冰在地板上的圆震,与冰锥本身的尖区分)
  stampDot(buf, xc, 29, 1.0, HQ.shard);

  return buf;
}

/* ============================== 道化黄泉 ==============================
 *
 * 一道闸门 + 一道水浪朝画面下方涌出。
 *   - 闸门在上半部(y=4..16):横梁 + 闸墩 + 闸口 + 吊环
 *   - 闸口下方(y=17..18):水的出口(一道亮水光)
 *   - 主浪:从闸口底 y=18 **朝画面下方**铺到 y=29,矩形 + 浪前 + 浪花。
 *     关键纠偏:水是**朝下流的**,不是往天上喷 —— 与 in-game UnderworldWave
 *     视觉同源(矩形 + 浪前亮边 + 浪花),看一眼就读得出"放水了"。
 *
 * 与 huangquan 同色但剪影完全不同:锥是「竖直一根尖」,这里是一扇门 + 一道横水。
 */
function drawDaohua() {
  const buf = Buffer.alloc(SIZE * SIZE * 4);

  /* 1. 闸门整体(上半部,y=4..18) */
  // 1.1 闸顶横梁(y=4..9,横跨 x=3..28)
  stampRect(buf, 3, 4, 28, 9, DH.gate);
  stampRect(buf, 4, 4, 27, 4, DH.gateHi);
  stampRect(buf, 3, 9, 28, 9, DH.shadow);

  // 1.2 吊环 + 吊索(横梁中央)
  stampDot(buf, 16, 2.5, 1.6, DH.rust);
  stampDot(buf, 16, 2.5, 0.8, DH.gateHi);
  stampLine(buf, 13.5, 4, 13.5, 9, DH.shadow, 0.7);
  stampLine(buf, 18.5, 4, 18.5, 9, DH.shadow, 0.7);

  // 1.3 横梁门钉
  for (let i = 0; i < 3; i++) {
    const x = 6 + i * 9;
    stampDot(buf, x, 6, 0.8, DH.rust);
  }

  // 1.4 闸墩(立柱,y=9..18)
  stampRect(buf, 3, 9, 9, 18, DH.gate);
  stampRect(buf, 22, 9, 28, 18, DH.gate);
  // 立柱高光(左亮右暗,模拟侧光)
  stampRect(buf, 3, 9, 4, 18, DH.gateHi);
  stampRect(buf, 27, 9, 28, 18, DH.shadow);
  // 立柱门钉
  stampDot(buf, 6.5, 12, 1.0, DH.rust);
  stampDot(buf, 6.5, 15, 1.0, DH.rust);
  stampDot(buf, 25.5, 12, 1.0, DH.rust);
  stampDot(buf, 25.5, 15, 1.0, DH.rust);

  // 1.5 闸口(y=9..18,x=9..22,深色矩形) + 底边一道亮水光
  stampRect(buf, 9, 9, 22, 18, DH.shadow);
  // 闸口底边(刚涌出来的水在反光)
  stampRect(buf, 10, 18, 21, 18, DH.body);
  stampRect(buf, 11, 18, 20, 18, DH.core);

  /* 2. 主浪:从闸口底 y=18 朝画面下方铺到 y=29。
   *    矩形主体(同 UnderworldWave 推进段),用 fillRect 一层一层堆:
   *    底色 + 顶面反光 + 上下边 + 波前 + 浪花。
   *    方向:**朝下** —— 关键纠偏点。
   */

  // 2.1 浪体实体(底色)
  stampRect(buf, 9, 19, 22, 29, DH.body);

  // 2.2 顶面反光带(浪体最上沿 1~2 行,让水面读出"流")
  stampRect(buf, 9, 19, 22, 20, DH.core);
  stampRect(buf, 10, 19, 21, 19, DH.light);

  // 2.3 两侧高光 / 暗线(让矩形像水)
  stampRect(buf, 9, 19, 9, 29, DH.core);
  stampRect(buf, 22, 19, 22, 29, DH.shadow);

  // 2.4 水流中段的"水纹" —— 几道短横线,给水面读出"流动感"
  //    沿 y 方向每两行一条,长度短一点表示"波纹"
  stampLine(buf, 11, 22, 20, 22, DH.light, 0.6);
  stampLine(buf, 11, 25, 20, 25, DH.light, 0.6);
  stampLine(buf, 12, 24, 19, 24, DH.core, 0.5);
  stampLine(buf, 12, 27, 19, 27, DH.core, 0.5);

  // 2.5 **波前**(y=29 那一道亮 capstone)—— UnderworldWave 的核心信号
  stampRect(buf, 9, 29, 22, 29, DH.light);
  stampRect(buf, 9, 28, 22, 28, DH.core);
  // 波前中央一颗更亮的水珠(浪尖)
  stampDot(buf, 15.5, 30.5, 0.8, DH.foam);

  // 2.6 **浪花** —— 波前下方(更靠画面下沿)一对泪滴,模拟水头拍出的小浪
  //    位置:略低于 y=29,左右各一
  stampTri(
    buf,
    [11, 30],
    [13, 30],
    [12, 30.6],
    DH.foam,
    80,
  );
  stampTri(
    buf,
    [18, 30],
    [20, 30],
    [19, 30.6],
    DH.foam,
    80,
  );
  // 浪花碎点
  stampDot(buf, 14, 30.4, 0.6, DH.light);
  stampDot(buf, 17, 30.4, 0.6, DH.light);
  stampDot(buf, 15.5, 30.9, 0.5, DH.foam);

  // 2.7 闸口两侧的溅起小水珠(从闸口外侧 y=20 处甩出来,模拟水从口里蹦出)
  stampDot(buf, 8, 20, 0.6, DH.foam);
  stampDot(buf, 23, 20, 0.6, DH.foam);
  stampDot(buf, 7, 22, 0.5, DH.core);
  stampDot(buf, 24, 22, 0.5, DH.core);

  return buf;
}

/* ============================== 写盘 ============================== */

mkdirSync(OUT_DIR, { recursive: true });

const hqBuf = drawHuangquan();
const hqPng = encodePngRGBA(SIZE, SIZE, hqBuf);
writeFileSync(resolve(OUT_DIR, 'icon_spell_huangquan.png'), hqPng);
console.log(`icon_spell_huangquan.png  32x32  RGBA  ${(hqPng.length / 1024).toFixed(1)} KB`);

const dhBuf = drawDaohua();
const dhPng = encodePngRGBA(SIZE, SIZE, dhBuf);
writeFileSync(resolve(OUT_DIR, 'icon_spell_daohua.png'), dhPng);
console.log(`icon_spell_daohua.png     32x32  RGBA  ${(dhPng.length / 1024).toFixed(1)} KB`);
