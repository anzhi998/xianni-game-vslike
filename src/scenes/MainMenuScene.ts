import Phaser from 'phaser';
import { SaveManager } from '../utils/SaveManager';
import { isStandalone } from '../utils/mobile';
import { MAPS, DEFAULT_MAP_ID } from '../config/MapConfig';

/**
 * 主菜单 —— 水墨仙山。
 *
 * ## 为什么要重画背景
 *
 * 原来是「深蓝底 + 80 个闪星星 + 红色 96px 标题 + Vampire Survivors-like 副标题」。
 * 最后那行等于在开场就自曝「这是哪个游戏的仿作」,而星空和深蓝背景属于
 * 太空题材,和修仙一点关系都没有 —— 玩家在按下开始之前读到的第一眼,
 * 决定了他给这局游戏的类型预期。
 *
 * ## 全部程序化,没有一张图
 *
 * 山、云、雾、灵气都是 `Graphics` 现场画的,和 `AssetGenerator` 的路子一致。
 * 真要换成手绘远山,按 `AssetGenerator.makeTexture` 的约定把图丢进
 * `src/assets/` 并以 `menu_*` 开头即可,本文件不用改。
 *
 * ## 三个程序化约束(菜单不是池化对象,但仍有坑)
 *
 * - **山用固定种子**:`rng(2024)`。山每次刷新都长得一样,玩家能建立「这张图」
 *   的空间记忆;随机会让它变成一张每次都不同的壁纸。
 * - **灵气用 tween + onRepeat 回卷**,不是 `yoyo` —— yoyo 会让灵气走到顶又
 *   折回底边,看起来像呼吸而不是升腾。
 * - **不要给这些对象加深度**:全部按创建顺序叠,菜单没有别的图层要穿插。
 */

/** 版式常量。菜单和 HUD 一样,把数字写死在文件里会散架,所以集中在这里 */
const M = {
  sealY: 176,        // 朱砂印章中心
  mottoY: 286,       // 「逆道而行 · 求长生」
  ridgeY: 420,       // 远山天际线(各层以此为基准上下错开)
  infoY: 396,        // 信息区首行
  btnY: 570,         // 按钮中心
  hintY: 664,        // 操作提示
} as const;

const INK = {
  skyTop: 0x0a0e18,
  skyMid: 0x1b2433,
  skyLow: 0x2f3b4d,
  ridgeFar: 0x3c4759,
  ridgeMid: 0x232c3b,
  ridgeNear: 0x10141c,
  mist: 0x9fb0c4,
  seal: 0xa8342a,
  sealDeep: 0x7d241d,
  jade: 0x2f4a44,
  jadeEdge: 0x8fd0bb,
  spirit: 0xbfd8ff,
  text: 0xdde3ea,
  textDim: 0x8d97a6,
  textGold: 0xe8c46a,
} as const;

export class MainMenuScene extends Phaser.Scene {
  constructor() {
    super('MainMenuScene');
  }

  create(): void {
    const cx = this.cameras.main.width / 2;

    this.drawSky();
    this.drawRidges();
    this.drawMist();
    this.drawSeal(cx, M.sealY);
    this.addSpiritMotes();
    this.buildInfo(cx);
    this.buildButton(cx);
    this.buildHint(cx);
  }

  // ===== 背景 ==========================================================

  /** 淡墨天:上深下浅的竖直渐变。天际线附近提亮,是水墨里「远处比近处淡」那条规律 */
  private drawSky(): void {
    const { width: W, height: H } = this.cameras.main;
    const g = this.add.graphics();
    const bands = 48;
    for (let i = 0; i < bands; i++) {
      const t = i / (bands - 1);
      const c = t < 0.55
        ? Phaser.Display.Color.Interpolate.ColorWithColor(
          Phaser.Display.Color.ValueToColor(INK.skyTop),
          Phaser.Display.Color.ValueToColor(INK.skyMid), 100, Math.round(t / 0.55 * 100),
        )
        : Phaser.Display.Color.Interpolate.ColorWithColor(
          Phaser.Display.Color.ValueToColor(INK.skyMid),
          Phaser.Display.Color.ValueToColor(INK.skyLow), 100, Math.round((t - 0.55) / 0.45 * 100),
        );
      g.fillStyle(Phaser.Display.Color.GetColor(c.r, c.g, c.b), 1);
      g.fillRect(0, (H / bands) * i, W, Math.ceil(H / bands) + 1);
    }
  }

  /**
   * 远山剪影,三层。
   *
   * 三层用**同一个种子**但不同的振幅和基准高度,近层最低最黑 ——
   * 大气透视:越远越淡、越高。层数只给三层,因为四层以上玩家分辨不出层次,
   * 只觉得画面脏。
   */
  private drawRidges(): void {
    const { width: W } = this.cameras.main;
    const layers = [
      { base: M.ridgeY - 66, amp: 46, step: 150, color: INK.ridgeFar, seed: 11 },
      { base: M.ridgeY - 18, amp: 62, step: 118, color: INK.ridgeMid, seed: 77 },
      { base: M.ridgeY + 46, amp: 40, step: 96, color: INK.ridgeNear, seed: 2024 },
    ];
    for (const L of layers) {
      const g = this.add.graphics();
      const rng = lcg(L.seed);
      g.fillStyle(L.color, 1);
      let x = -40;
      // 第一个峰顶直接取中值,避免左边���突兀
      let y = L.base - rng() * L.amp * 0.5;
      g.beginPath();
      g.moveTo(x, y);
      while (x < W + 60) {
        const nx = x + L.step * (0.6 + rng() * 0.8);
        const ny = L.base - rng() * L.amp;
        // 折线而不是曲线:山形要「硬」,圆滑的山看起来像波浪
        g.lineTo(nx, ny);
        x = nx;
        y = ny;
      }
      g.lineTo(W + 60, this.cameras.main.height + 10);
      g.lineTo(-40, this.cameras.main.height + 10);
      g.closePath();
      g.fillPath();
    }
  }

  /** 云雾带。横着糊几条低透明度椭圆,专门盖在山腰 —— 山腰是水墨最容易出彩的位置 */
  private drawMist(): void {
    const { width: W } = this.cameras.main;
    const g = this.add.graphics();
    const rng = lcg(555);
    for (let i = 0; i < 9; i++) {
      const y = M.ridgeY - 30 + rng() * 130;
      const w = 260 + rng() * 520;
      const h = 16 + rng() * 26;
      const x = -80 + rng() * (W + 160);
      g.fillStyle(INK.mist, 0.035 + rng() * 0.045);
      g.fillEllipse(x, y, w, h);
      g.fillEllipse(x + w * 0.3, y + 6, w * 0.5, h * 0.7);
    }
  }

  // ===== 标题 ==========================================================

  /**
   * 朱砂印章。
   *
   * 印章是方形的,所以内部留白比「仙逆」两字宽得多 —— 于是四边各压一道深色,
   * 让它读起来像盖章而不是像一块红色背景板。再点几处斑驳,模拟印泥不匀。
   */
  private drawSeal(cx: number, cy: number): void {
    const w = 168;
    const h = 108;
    const g = this.add.graphics();
    g.fillStyle(INK.seal, 0.92);
    g.fillRect(cx - w / 2, cy - h / 2, w, h);
    g.fillStyle(INK.sealDeep, 1);
    g.fillRect(cx - w / 2, cy - h / 2, w, 5);
    g.fillRect(cx - w / 2, cy + h / 2 - 5, w, 5);
    g.fillRect(cx - w / 2, cy - h / 2, 5, h);
    g.fillRect(cx + w / 2 - 5, cy - h / 2, 5, h);
    // 印泥斑驳
    const rng = lcg(313);
    g.fillStyle(INK.sealDeep, 0.5);
    for (let i = 0; i < 90; i++) {
      g.fillRect(
        cx - w / 2 + rng() * w,
        cy - h / 2 + rng() * h,
        1 + rng() * 3, 1 + rng() * 2,
      );
    }

    const sealText = this.add.text(cx, cy, '仙 逆', {
      fontFamily: 'serif', fontSize: '56px', color: '#f6ece2', fontStyle: 'bold',
    }).setOrigin(0.5);
    sealText.setStroke('#f6ece2', 1);
    sealText.setShadow(0, 3, '#5c1810', 6, false, true);

    this.add.text(cx, M.mottoY, '逆 道 而 行  ·  求 长 生', {
      fontFamily: 'serif', fontSize: '20px', color: '#b9c4d2',
    }).setOrigin(0.5);
  }

  /** 灵气。上浮的微粒,是整个画面唯一的动态元素 */
  private addSpiritMotes(): void {
    const { width: W, height: H } = this.cameras.main;
    const rng = lcg(88);
    for (let i = 0; i < 46; i++) {
      const r = 1 + rng() * 2;
      const a = 0.18 + rng() * 0.34;
      const x = rng() * W;
      const y = H + rng() * 120;
      const mote = this.add.circle(x, y, r, INK.spirit, a);
      const rise = 420 + rng() * 520;
      this.tweens.add({
        targets: mote,
        y: y - rise,
        alpha: { from: a, to: 0 },
        duration: 7000 + rng() * 7000,
        repeat: -1,
        // 回卷而不是 yoyo:yoyo 会让灵气走到顶又折回底边,看起来像呼吸而不是升腾
        onRepeat: () => {
          mote.y = H + 20 + rng() * 80;
          mote.x = rng() * W;
        },
      });
    }
  }

  // ===== 信息 / 按钮 ====================================================

  private buildInfo(cx: number): void {
    const bestTime = SaveManager.getBestTime();
    const bestKills = SaveManager.getBestKills();
    const coins = SaveManager.getCoins();
    const map = MAPS[DEFAULT_MAP_ID];

    this.add.text(cx - 120, M.infoY, `最高 ${formatTime(bestTime)}`, {
      fontFamily: 'serif', fontSize: '16px', color: '#e8c46a',
    }).setOrigin(0.5, 0);
    this.add.text(cx + 120, M.infoY, `击杀 ${bestKills}`, {
      fontFamily: 'serif', fontSize: '16px', color: '#e8c46a',
    }).setOrigin(0.5, 0);
    this.add.text(cx, M.infoY + 28, `灵石 ${coins}`, {
      fontFamily: 'serif', fontSize: '15px', color: '#c9a227',
    }).setOrigin(0.5, 0);

    // 地图 = 玩法变量,所以环境机制必须开局前就印在脸上
    this.add.text(cx, M.infoY + 58, `${map.name} · ${map.hazard ? map.hazard.name : '无环境机制'}`, {
      fontFamily: 'serif', fontSize: '17px', color: '#b98b5e',
    }).setOrigin(0.5, 0);
  }

  private buildButton(cx: number): void {
    // 62 高在手机上只有约 34 个 CSS 像素(整块画布被缩到 0.55 倍),拇指点不准。
    // 80 高 ≈ 44 CSS 像素,是各类移动端规范里的下限。
    const w = 260;
    const h = 80;
    const frame = this.add.container(cx, M.btnY);
    const bg = this.add.rectangle(0, 0, w, h, INK.jade, 0.85)
      .setStrokeStyle(2, INK.jadeEdge, 0.9);
    const label = this.add.text(0, 0, '入 仙 门', {
      fontFamily: 'serif', fontSize: '28px', color: '#eaf7f1', fontStyle: 'bold',
    }).setOrigin(0.5);
    // 文字必须也可点,否则只有中间的色块有反应 —— 玩家会点字
    bg.setInteractive({ useHandCursor: true });
    label.setInteractive({ useHandCursor: true });
    frame.add([bg, label]);

    const enter = (): void => { this.scene.start('GameScene', { mapId: DEFAULT_MAP_ID }); };
    const hover = (on: boolean): void => {
      bg.setFillStyle(on ? 0x3d6158 : INK.jade, on ? 0.95 : 0.85);
      bg.setStrokeStyle(2, INK.jadeEdge, on ? 1 : 0.9);
      label.setScale(on ? 1.06 : 1);
    };
    for (const o of [bg, label]) {
      o.on('pointerover', () => hover(true));
      o.on('pointerout', () => hover(false));
      o.on('pointerdown', enter);
    }
  }

  private buildHint(cx: number): void {
    // 操作提示必须跟着设备走。手机上摇杆是**一按就出现在手指落点**的,
    // 不说一声的话玩家多半会去拖角色本身,发现它纹丝不动。
    const isTouch = this.sys.game.device.input.touch;
    const line = isTouch
      ? '按住屏幕左半边拖动移动    ·    右上角暂停    ·    悟道三选一 → 法术 8 级 + 遗物 5 级 → 宝箱融合'
      : 'WASD / 方向键 移动    ·    P / ESC 暂停    ·    悟道三选一 → 法术 8 级 + 遗物 5 级 → 宝箱融合';
    this.add.text(cx, M.hintY, line, {
      fontFamily: 'serif', fontSize: '14px', color: '#8d97a6',
    }).setOrigin(0.5, 0);

    // 没装到主屏幕时提醒一句:装完之后是全屏、无地址栏、断网也能开。
    // 已经装过了就别占位置。
    if (!isStandalone()) {
      this.add.text(cx, M.hintY + 26, '手机端可「添加到主屏幕」,以全屏游玩、支持离线', {
        fontFamily: 'serif', fontSize: '13px', color: '#6b7480',
      }).setOrigin(0.5, 0);
    }
  }
}

/** 固定种子的线性同余。菜单的山每次刷新必须长得一样,见类注释 */
function lcg(seed: number): () => number {
  let s = seed >>> 0 || 1;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

function formatTime(seconds: number): string {
  if (!seconds || seconds < 1) return '--:--';
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
}

/** 让 INK.text 在别处可用时不必 import */
export const MENU_INK = INK;