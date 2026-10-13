import Phaser from 'phaser';
import { GAME_WIDTH, GAME_HEIGHT } from '../config/GameConfig';
import { SPELLS } from '../config/SpellConfig';
import { RELICS, MAX_RELIC_LEVEL } from '../config/RelicConfig';
import { EVOLUTIONS } from '../config/EvolutionConfig';
import { BOSSES } from '../config/BossConfig';
import { DEBUG_PANEL_ENABLED } from '../config/DebugConfig';
import { COLOR_NORMAL, COLOR_CRIT, COLOR_ARMORED } from '../entities/DamageText';
// 只作类型引用 —— 调试面板要按名字调 GameScene 上的 debug* 方法。
// type-only import 在编译后不存在,所以不会构成运行时循环依赖
import type { GameScene } from './GameScene';
import type { PreloadScene } from './PreloadScene';

/**
 * HUD 场景 - 与 GameScene 并行运行
 * 所有按钮使用 Container(底图+文字 都在容器里),确保点击区域稳定
 */
export class UIScene extends Phaser.Scene {
  // 固定 depth 值,确保 UI 始终在 GameScene 之上
  private static readonly DEPTH_HUD = 1000;
  private static readonly DEPTH_OVERLAY = 2000;

  private hpBarFill!: Phaser.GameObjects.Rectangle;
  private hpText!: Phaser.GameObjects.Text;
  private xpBarFill!: Phaser.GameObjects.Rectangle;
  private xpText!: Phaser.GameObjects.Text;
  private timerText!: Phaser.GameObjects.Text;
  private killText!: Phaser.GameObjects.Text;
  private levelText!: Phaser.GameObjects.Text;
  private realmText!: Phaser.GameObjects.Text;
  private spellPanel!: Phaser.GameObjects.Container;
  private relicPanel!: Phaser.GameObjects.Container;
  private coinsText!: Phaser.GameObjects.Text;
  private bossBar!: Phaser.GameObjects.Container;
  private bossBarFill!: Phaser.GameObjects.Rectangle;
  private bossBarText!: Phaser.GameObjects.Text;
  private pauseBtn!: Phaser.GameObjects.Container;
  private pauseOverlay?: Phaser.GameObjects.Container;
  private pauseKeyHandler?: (e: KeyboardEvent) => void;
  private dpsPanel?: Phaser.GameObjects.Container;
  private dpsBg?: Phaser.GameObjects.Rectangle;
  private dpsText?: Phaser.GameObjects.Text;

  constructor() {
    super('UIScene');
  }

  create(): void {
    const w = GAME_WIDTH;
    const h = GAME_HEIGHT;
    this.cameras.main.setBackgroundColor('rgba(0,0,0,0)');

    // ====== HUD 元素 ======
    const hpX = 20, hpY = 20, hpW = 240, hpH = 18;
    this.add.text(hpX, hpY - 4, 'HP', { fontFamily: 'monospace', fontSize: '12px', color: '#ffaaaa' })
      .setDepth(UIScene.DEPTH_HUD);
    this.add.rectangle(hpX, hpY + 14, hpW, hpH, 0x330000).setOrigin(0, 0).setStrokeStyle(2, 0x880000)
      .setDepth(UIScene.DEPTH_HUD);
    this.hpBarFill = this.add.rectangle(hpX + 2, hpY + 16, hpW - 4, hpH - 4, 0xee3333).setOrigin(0, 0)
      .setDepth(UIScene.DEPTH_HUD);
    this.hpText = this.add.text(hpX + hpW + 8, hpY + 8, '100/100', { fontFamily: 'monospace', fontSize: '14px', color: '#ffffff' }).setOrigin(0, 0.5)
      .setDepth(UIScene.DEPTH_HUD);

    const xpX = 20, xpY = 60, xpW = 240, xpH = 14;
    this.add.text(xpX, xpY - 4, 'LV', { fontFamily: 'monospace', fontSize: '12px', color: '#aaaaff' })
      .setDepth(UIScene.DEPTH_HUD);
    this.add.rectangle(xpX, xpY + 14, xpW, xpH, 0x000033).setOrigin(0, 0).setStrokeStyle(2, 0x333388)
      .setDepth(UIScene.DEPTH_HUD);
    this.xpBarFill = this.add.rectangle(xpX + 2, xpY + 16, 0, xpH - 4, 0x44aaff).setOrigin(0, 0)
      .setDepth(UIScene.DEPTH_HUD);
    this.xpText = this.add.text(xpX + xpW + 8, xpY + 8, '1', { fontFamily: 'monospace', fontSize: '14px', color: '#ffffff' }).setOrigin(0, 0.5)
      .setDepth(UIScene.DEPTH_HUD);
    this.levelText = this.add.text(xpX + xpW / 2, xpY + 22, '1', { fontFamily: 'monospace', fontSize: '12px', color: '#ffffff', fontStyle: 'bold' }).setOrigin(0.5)
      .setDepth(UIScene.DEPTH_HUD);

    // 境界名 —— 它是《仙逆》的身份感,不是等级条的第二份显示
    this.realmText = this.add.text(xpX + xpW + 8, xpY + 26, '凝气期·一层', {
      fontFamily: 'monospace', fontSize: '14px', color: '#aaffff',
    }).setOrigin(0, 0.5).setDepth(UIScene.DEPTH_HUD);

    this.timerText = this.add.text(w / 2, 16, '00:00', { fontFamily: 'monospace', fontSize: '24px', color: '#ffffff', fontStyle: 'bold' }).setOrigin(0.5, 0)
      .setDepth(UIScene.DEPTH_HUD);
    this.timerText.setShadow(0, 2, '#000000', 4, false, true);

    // 右边留出暂停按钮的位置(w - 120)。按钮在手机上必须够大才点得中,
    // 于是它往左吃掉了原来这两行文字的地盘 —— 文字压在按钮上不只是难看,
    // 还让玩家误以为那里也是可点的。
    this.killText = this.add.text(w - 120, 16, '击杀: 0', { fontFamily: 'monospace', fontSize: '18px', color: '#ffdd44' }).setOrigin(1, 0)
      .setDepth(UIScene.DEPTH_HUD);
    this.killText.setShadow(0, 2, '#000000', 4, false, true);

    this.coinsText = this.add.text(w - 120, 44, '灵石: 0', {
      fontFamily: 'monospace', fontSize: '16px', color: '#ffd070',
    }).setOrigin(1, 0).setDepth(UIScene.DEPTH_HUD);

    // Boss 血条。没有它的话玩家在 76px 的大体型怪身上完全读不出「还剩多少」
    this.bossBar = this.add.container(w / 2, h / 2 - 170).setDepth(UIScene.DEPTH_HUD).setVisible(false);
    const bossBg = this.add.rectangle(0, 0, 420, 20, 0x220000).setStrokeStyle(2, 0xcc4422);
    this.bossBarFill = this.add.rectangle(-208, 0, 416, 16, 0xff5522).setOrigin(0, 0.5);
    this.bossBarText = this.add.text(0, -22, '', {
      fontFamily: 'monospace', fontSize: '15px', color: '#ffffff', fontStyle: 'bold',
    }).setOrigin(0.5);
    this.bossBar.add([bossBg, this.bossBarFill, this.bossBarText]);

    // ====== 暂停按钮 (Container 模式) ======
    // 96x64 是按「手指」定的:手机横屏整块画布缩到约 0.55 倍,44px 的按钮落到
    // 屏幕上只剩 24 个 CSS 像素,拇指几乎点不中。放到 64 仍有 35px,加上它贴在
    // 屏幕角落(不容易误触、也没有别的按钮跟它抢),实际是够用的。
    this.pauseBtn = this.createButton(w - 58, 78, 96, 64, '暂停', 0x333355, 0x6a6aff, 0x4a4a88, () => this.togglePause());
    this.pauseBtn.setDepth(UIScene.DEPTH_HUD);

    // ====== 神通面板(5 格,右下角)======
    // ⚠️ 148 不是 140:标题要画在格子上方(UIScene.HEADER_Y = -18),
    //    而法宝面板在 h-72、它的标题在 630。神通格子底边必须留在 630 之上,
    //    否则**两个面板的标题和格子会互相压**。
    //    面板锚在右下:x 由 refresh*() 按当前格数右对齐(右留 20 边距),
    //    格子变多时面板向左生长,右边缘不动。这里的 20 只是初始值。
    this.spellPanel = this.add.container(20, h - 152);
    this.spellPanel.setDepth(UIScene.DEPTH_HUD);
    this.refreshSpells();

    // ====== 遗物面板(6 格,位于神通面板下方)======
    this.relicPanel = this.add.container(20, h - 72);
    this.relicPanel.setDepth(UIScene.DEPTH_HUD);
    this.refreshRelics();

    // ====== 备用:键盘 P/ESC 暂停 (HUD 层响应) ======
    this.pauseKeyHandler = (e: KeyboardEvent) => {
      if (e.code === 'KeyP' || e.code === 'Escape') {
        e.preventDefault();
        this.togglePause();
      }
    };
    window.addEventListener('keydown', this.pauseKeyHandler);

    // 点到浮层以外的任何地方就把它收起来(触屏的「移开鼠标」)。
    //
    // 顺序很关键:Phaser 先发 GAMEOBJECT_POINTER_DOWN(格子自己处理,标记 tapped),
    // 再发这个场景级的 POINTER_DOWN。所以「这次按下是自己人弹的」能被认出来,
    // 下一次点到别处才真的关掉 —— 否则点格子会先展开再被立刻收起,等于没点。
    this.input.on('pointerdown', () => {
      if (this.relicTipTappedBySlot) this.relicTipTappedBySlot = undefined;
      else this.hideRelicTip();
    });

    // ====== 监听 GameScene 事件 ======
    const game = this.scene.get('GameScene');
    if (game) {
      game.events.on('player-damaged', () => this.updateHUD());
      game.events.on('player-healed', () => this.updateHUD());
      game.events.on('player-level-up', () => this.updateHUD());
      game.events.on('xp-collected', () => this.updateHUD());
      game.events.on('enemy-killed', () => this.updateHUD());
      game.events.on('upgrade-applied', () => { this.updateHUD(); this.refreshSpells(); this.refreshRelics(); });
      game.events.on('relic-equipped', (id: string, level: number) => {
        this.updateHUD();
        this.refreshRelics();
        const cfg = RELICS[id];
        if (!cfg) return;
        const color = '#' + cfg.color.toString(16).padStart(6, '0');
        const head = level > 1 ? `${cfg.name} 祭炼至 ${level} 级` : `获得遗物 ${cfg.name}`;
        this.showBanner(head, color, 2000, cfg.desc(level));
      });
      game.events.on('coins-changed', () => this.updateHUD());
      game.events.on('breakthrough', (realm: string) => {
        this.updateHUD();
        this.refreshSpells();
        // 突破最直接的一次收益是法位(筑基/结丹/元婴各开一格)——
        // 不写出来玩家只会觉得「数字变了」,不知道自己刚被允许多带一门法术。
        // ⚠️ 化神之后法位不再增长(收槽到 5),所以这句话**只在一格真的空着时**才说:
        //    否则化神会弹出「可参悟第 5 门法术」,而悟道池此时根本不会再出新法术卡
        const gs = this.scene.get('GameScene') as any;
        const cap = gs?.weaponSystem?.getSlotCap?.() ?? 0;
        const held = gs?.weaponSystem?.getSpellCount?.() ?? 0;
        const free = cap - held;
        const sub = free > 0 ? `法位 ${cap} · 可参悟第 ${cap} 门法术` : '';
        this.showBanner(`突破至 ${realm}期!`, '#ffcc44', 2400, sub);
      });
      game.events.on('boss-spawned', (id: string) => {
        this.showBanner(`${BOSSES[id]?.name ?? id} 登场`, '#ff8844', 2400);
      });
      game.events.on('boss-reborn', () => {
        this.showBanner('浴火重生!', '#ff4422', 2000, '它的血量回到了满值');
      });
      game.events.on('game-pause', () => this.onGamePause());
      game.events.on('game-resume', () => this.onGameResume());
      game.events.on('spell-evolved', (_id: string, name: string) => {
        this.updateHUD();
        this.refreshSpells();
        this.refreshRelics();
        this.showBanner(`道法融合 · ${name}`, '#ffdd66', 2800, '专属遗物已被吸收,腾出一个遗物槽');
      });
      game.events.on('chest-obtained', (quality: string) => {
        const names: Record<string, string> = { wood: '木匣', jade: '玉盒', gold: '金匮' };
        this.showBanner(`获得洞府${names[quality] ?? '木匣'}`, '#ffdd66', 1600);
      });
    }

    // ====== DPS 统计浮窗(调试面板开关,默认关)======
    // 半秒刷一次足够:它是调参读数,不是动作反馈。读 DamageMeter 的滚动窗口,
    // 游戏暂停时没有新伤害入账,窗口和不变,读数自然冻结。
    this.time.addEvent({ delay: 500, loop: true, callback: () => this.refreshDpsPanel() });

    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      if (this.pauseKeyHandler) window.removeEventListener('keydown', this.pauseKeyHandler);
    });
  }

  /**
   * DPS 浮窗:右上角、半透明黑底,每 0.5s 从 DamageMeter 拉一次快照。
   *
   * 开关状态在 GameScene.dpsMeterOn(调试面板「DPS 统计」切换),这里只读。
   * 位置刻意避开右上角的暂停按钮(y 110 以下)与左上角的血条/经验条;
   * 行数按当前有过伤害的来源数自适应,最多列 8 行(5 法位 + 其他,有余量)。
   */
  private refreshDpsPanel(): void {
    const g = this.scene.get('GameScene') as GameScene | null;
    if (!g || !g.dpsMeterOn) {
      this.dpsPanel?.setVisible(false);
      return;
    }
    if (!this.dpsPanel) {
      this.dpsBg = this.add.rectangle(0, 0, 10, 10, 0x000000, 0.45).setOrigin(1, 0);
      this.dpsText = this.add.text(-8, 6, '', {
        fontFamily: 'monospace', fontSize: '13px', color: '#aaffff', lineSpacing: 3,
      }).setOrigin(1, 0);
      this.dpsPanel = this.add.container(GAME_WIDTH - 16, 120, [this.dpsBg, this.dpsText]);
      this.dpsPanel.setDepth(UIScene.DEPTH_HUD);
    }
    const rows = g.damageMeter.snapshot();
    let totalDps = 0;
    for (const r of rows) totalDps += r.dps;
    const lines = [`DPS(10s) 总 ${Math.round(totalDps)}`];
    for (const r of rows.slice(0, 8)) {
      const name = r.id === 'other' ? '其他' : (SPELLS[r.id]?.name ?? r.id);
      lines.push(`${name}  ${Math.round(r.dps)}/s  ${Math.round(r.share * 100)}%`);
    }
    this.dpsText!.setText(lines.join('\n'));
    this.dpsBg!.setSize(this.dpsText!.width + 16, this.dpsText!.height + 12);
    this.dpsPanel.setVisible(true);
  }

  /**
   * HUD 的计时器读 game.elapsed,但只在伤害/升级/拾取/击杀事件里刷新,
   * 屏幕上没怪时时钟会整个冻住。所以这里每帧主动刷一次。
   */
  update(): void {
    this.updateHUD();
  }

  /**
   * 创建可交互按钮 (Container 包装,统一 hit area)
   */
  private createButton(
    x: number,
    y: number,
    width: number,
    height: number,
    label: string,
    bgColor: number,
    strokeColor: number,
    hoverColor: number,
    onClick: () => void,
    fontSize = 18,
  ): Phaser.GameObjects.Container {
    const container = this.add.container(x, y);

    const bg = this.add.rectangle(0, 0, width, height, bgColor).setStrokeStyle(2, strokeColor);
    const txt = this.add.text(0, 0, label, {
      fontFamily: 'monospace',
      fontSize: `${fontSize}px`,
      color: '#ffffff',
      fontStyle: 'bold',
    }).setOrigin(0.5);

    container.add([bg, txt]);
    container.setSize(width, height);
    // 把整个容器设为可交互,使用矩形 hit area
    container.setInteractive(
      new Phaser.Geom.Rectangle(-width / 2, -height / 2, width, height),
      Phaser.Geom.Rectangle.Contains,
    );

    bg.setInteractive({ useHandCursor: true });
    bg.on('pointerover', () => {
      bg.setFillStyle(hoverColor);
      container.setScale(1.05);
    });
    bg.on('pointerout', () => {
      bg.setFillStyle(bgColor);
      container.setScale(1);
    });
    bg.on('pointerdown', (_pointer: Phaser.Input.Pointer, _lx: number, _ly: number, event: any) => {
      if (event) event.stopPropagation?.();
      onClick();
    });
    // 文字也设为可交互(点击区域在容器内透明,实际由容器接收)
    txt.setInteractive({ useHandCursor: true });
    txt.on('pointerdown', (_pointer: Phaser.Input.Pointer, _lx: number, _ly: number, event: any) => {
      if (event) event.stopPropagation?.();
      onClick();
    });

    return container;
  }

  /**
   * 一格的版式常量。
   *
   * ⚠️ **格子坐标一律按「左上角」算,画的时候再补半个尺寸。**
   *
   * 原因:`this.add.rectangle()` 的默认原点是 **(0.5, 0.5)**,不是左上角。
   * 之前两段面板都把 `x` 当成左边缘直接传进去,于是:
   *   - 60 宽的格子实际展开在 `x-30 ~ x+30`,而不是 `x ~ x+60`
   *   - `x+50` 的等级数字其实落在**格子右边缘之外 10px**
   *   - `x+4` 的图标色块向左**突出 16px**,压到上一格
   * 截图上「法术栏挤在一起、看不到等级」就是这三条叠在一起。
   */
  private static readonly SLOT_SIZE = 60;
  private static readonly SLOT_PITCH = 70;
  /**
   * 图标区的边长。
   *
   * 32 见方是**为了让图标是正方形**:法术图标 `icon_spell_*` 与遗物图标
   * `pickup_relic_*` 都是正方形的贴图,放进一个 40×26 的横条里要么被压扁,
   * 要么上下留黑边。详见 `docs/美术素材规格.md` §3.4。
   */
  private static readonly ICON_SIZE = 32;
  /** 图标区中心相对格子的 y。靠上,给下面的名字留位置 */
  private static readonly ICON_Y = 26;

  /**
   * 造一个格子里��图标:**有图用图,没图退回色块**。
   *
   * 退回色块不是过渡态,是**常态**:美术是逐步替换的,十门法术里先做了
   * 三张图标是很正常的事。没有它,缺图会变成空白方块。
   *
   * @param key 纹理键;不存在时退回色块。尺寸统一用 `setDisplaySize` 拉伸,
   *             所以 16px 的遗物图标和 32px 的法术图标落在同一个格子里一样大。
   */
  private makeSlotIcon(
    cx: number, key: string, color: number,
  ): Phaser.GameObjects.GameObject {
    const box = UIScene.ICON_SIZE;
    const tex = this.textures;
    if (tex.exists(key)) {
      return this.add.image(cx, UIScene.ICON_Y, key)
        .setDisplaySize(box, box);
    }
    return this.add.rectangle(cx, UIScene.ICON_Y, box, box, color, 0.85)
      .setStrokeStyle(1, color, 1);
  }
  /** 标题的行高。标题画在格子**上方**,否则会被后加的格子盖住下半截 */
  private static readonly HEADER_Y = -18;

  /** 神通面板。显示名称与 1–8 级,满级标金 —— 满级 + 专属遗物 5 级就是融合的三个条件之二 */
  private refreshSpells(): void {
    this.spellPanel.removeAll(true);
    const game = this.scene.get('GameScene') as any;
    if (!game?.weaponSystem) return;
    const spells = game.weaponSystem.getSpells();
    const cap = game.weaponSystem.getSlotCap();
    const S = UIScene.SLOT_SIZE;

    // 法位未满时把「还能再带几门」写出来 —— 开局只有 2 格,
    // 「我还能再参悟一门」是早期最重要的一个信息
    const room = cap - spells.length;
    // 面板贴右缘:右边缘 = 最后一格的右边,标题也右对齐到同一条线上,
    // 否则格子少时标题会伸到屏幕外
    const rightEdge = (Math.max(spells.length, 1) - 1) * UIScene.SLOT_PITCH + S;
    this.spellPanel.add([
      this.add.text(rightEdge - 2, UIScene.HEADER_Y, `法位 ${spells.length}/${cap}${room > 0 ? ` · 空 ${room}` : ''}`, {
        fontFamily: 'monospace', fontSize: '12px',
        color: room > 0 ? '#88ddff' : '#ff9966',
      }).setOrigin(1, 0),
    ]);
    this.spellPanel.x = GAME_WIDTH - 20 - rightEdge;

    spells.forEach((s: any, i: number) => {
      const cfg = SPELLS[s.id];
      const x = i * UIScene.SLOT_PITCH;          // 格子左边缘
      const cx = x + S / 2;                       // 格子中心
      const color = cfg?.color ?? 0xffffff;
      const maxLv = game.weaponSystem.getMaxLevel(s.id);
      const isMax = s.level >= maxLv;

      const rect = this.add.rectangle(cx, 30, S, S, 0x222244)
        .setStrokeStyle(2, isMax ? 0xffdd66 : 0x6a6aff);
      // 图标:`icon_spell_<id>` 有图用图,没有退回色块(色块的颜色与弹体同源)
      const icon = this.makeSlotIcon(cx, `icon_spell_${s.id}`, color);
      // 等级贴在右上角,**必须在格子里面**
      const lv = this.add.text(x + S - 8, 11, maxLv > 1 ? `${s.level}/${maxLv}` : '融', {
        fontFamily: 'monospace', fontSize: '11px',
        color: isMax ? '#ffdd66' : '#aaaaff',
        fontStyle: 'bold',
      }).setOrigin(1, 0.5);
      // 名字在格子底部。换行宽度按**格子内宽**给,而不是拍一个数 ——
      // 最长的「焚天·火海」约 55px,给 58 才不会折成两行顶出格子
      const name = this.add.text(cx, 50, cfg?.name ?? s.id, {
        fontFamily: 'monospace', fontSize: '11px', color: '#ffffff', fontStyle: 'bold',
      }).setOrigin(0.5, 0.5).setWordWrapWidth(S - 2);

      this.spellPanel.add([rect, icon, lv, name]);
    });
  }

  /** 遗物面板。悬停展开实际生效数值与它开哪把锁 */
  private refreshRelics(): void {
    this.relicPanel.removeAll(true);
    this.hideRelicTip();
    const game = this.scene.get('GameScene') as any;
    if (!game?.relicSystem) return;
    const equipped = game.relicSystem.getEquipped();
    const cap = game.relicSystem.getSlotCap();
    const S = UIScene.SLOT_SIZE;

    // 面板贴右缘(与法术栏同一条右边缘)。格子数含末尾的「空」占位格
    const shown = Math.max(equipped.length + (equipped.length < cap ? 1 : 0), 1);
    const rightEdge = (shown - 1) * UIScene.SLOT_PITCH + S;
    this.relicPanel.add([
      this.add.text(rightEdge - 2, UIScene.HEADER_Y, `遗物 ${equipped.length}/${cap}`, {
        fontFamily: 'monospace', fontSize: '12px',
        color: equipped.length >= cap ? '#ff9966' : '#8899bb',
      }).setOrigin(1, 0),
    ]);
    this.relicPanel.x = GAME_WIDTH - 20 - rightEdge;

    equipped.forEach((a: any, i: number) => {
      const cfg = RELICS[a.id];
      const color = cfg?.color ?? 0xffffff;
      const x = i * UIScene.SLOT_PITCH;
      const cx = x + S / 2;
      const rect = this.add.rectangle(cx, 30, S, S, 0x1a1a33).setStrokeStyle(2, color);
      // 复用地面掉落物那张 `pickup_relic_<id>` —— 同一个形状在两处出现,
      // 玩家只学一次「这个形状 = 这件遗物」。它只有 16px,所以走 setDisplaySize。
      const icon = this.makeSlotIcon(cx, `pickup_relic_${a.id}`, color);
      const lvl = this.add.text(cx, 41, `${a.level}级`, {
        fontFamily: 'monospace', fontSize: '12px',
        color: a.level >= MAX_RELIC_LEVEL ? '#ffdd66' : '#ffffff',
        fontStyle: 'bold',
      }).setOrigin(0.5, 0.5);
      const name = this.add.text(cx, 53, cfg?.name ?? a.id, {
        fontFamily: 'monospace', fontSize: '11px', color: '#cccccc',
      }).setOrigin(0.5, 0.5).setWordWrapWidth(S - 2);

      // 悬停展开详情。60x60 的格子装不下 desc,而常驻多行文本会把面板挤到画面外
      rect.setInteractive({ useHandCursor: true });
      rect.on('pointerover', () => this.showRelicTip(a.id, a.level, color, i));
      rect.on('pointerout', () => this.hideRelicTip());
      // 触屏没有「悬停」:pointFinger 上唯一的 pointerover 是「手指落下的那一瞬间」,
      // 而抬起来时 Phaser 不发 POINTER_OUT(processUpEvents 只发 UP / UP_OUTSIDE),
      // 于是只有 pointerout 的浮层在手机上会**永久留在屏幕上**。所以点一下也要能展开。
      rect.on('pointerdown', () => {
        this.relicTipTappedBySlot = rect;
        this.showRelicTip(a.id, a.level, color, i);
      });

      this.relicPanel.add([rect, icon, lvl, name]);
    });

    // 第一个空格画成占位格,而不是一句浮在旁边的文字 ——
    // 「还能再拿几件」靠数格子比靠读字快,而格子数量就是 6。
    if (equipped.length < cap) {
      const x = equipped.length * UIScene.SLOT_PITCH;
      const cx = x + S / 2;
      this.relicPanel.add([
        this.add.rectangle(cx, 30, S, S, 0x14141f).setStrokeStyle(1, 0x333355),
        this.add.text(cx, 30, '空', {
          fontFamily: 'monospace', fontSize: '12px', color: '#555577',
        }).setOrigin(0.5, 0.5),
      ]);
    }
  }

  /** 遗物详情浮层。惰性创建、复用同一个 Container —— 悬停是高频事件 */
  private relicTip?: Phaser.GameObjects.Container;

  /**
   * 「刚才这一次按下是遗物格子自己处理的」标记。见 create() 里那条 pointerdown:
   * 靠它在场景级事件里区分「点格子展开」与「点别处收起」。
   */
  private relicTipTappedBySlot?: Phaser.GameObjects.Rectangle;

  private showRelicTip(id: string, level: number, color: number, index: number): void {
    const cfg = RELICS[id];
    if (!cfg) return;
    if (!this.relicTip) {
      this.relicTip = this.add.container(0, 0).setDepth(UIScene.DEPTH_OVERLAY).setVisible(false);
    }

    // 钥匙提示:钥匙与锁必须能一句话说清同源逻辑,否则
    // 「占这一格值不值」这个问题没人能回答
    const unlocks = EVOLUTIONS.filter((e) => e.keyRelic === id);
    const keyLine = unlocks.length === 0
      ? ''
      : `\n开锁: ${unlocks.map((e) => `${e.evolvedName}`).join(' ')}\n      ${unlocks[0].reason}`;

    const text = this.add.text(12, 10, `${cfg.name} · ${level} 级\n${cfg.desc(level)}${keyLine}`, {
      fontFamily: 'monospace',
      fontSize: '13px',
      color: '#ffffff',
      lineSpacing: 4,
      wordWrap: { width: 260 },
    });
    const bg = this.add.rectangle(0, 0, text.width + 24, text.height + 20, 0x0a0a1a, 0.94)
      .setStrokeStyle(2, color)
      .setOrigin(0, 0);

    const anchorX = this.relicPanel.x + (index * UIScene.SLOT_PITCH + UIScene.SLOT_SIZE);
    const anchorY = this.relicPanel.y - text.height - 24;

    this.relicTip.removeAll(true);
    this.relicTip.add([bg, text]);
    this.relicTip.setPosition(Math.min(anchorX, GAME_WIDTH - text.width - 40), Math.max(10, anchorY));
    this.relicTip.setVisible(true);
  }

  private hideRelicTip(): void {
    this.relicTip?.setVisible(false);
  }

  private updateHUD(): void {
    const game = this.scene.get('GameScene') as any;
    if (!game?.player) return;
    const p = game.player;
    const ratio = Math.max(0, p.health / p.maxHealth);
    this.hpBarFill.width = (240 - 4) * ratio;
    this.hpText.setText(`${Math.ceil(p.health)}/${p.maxHealth}`);
    this.hpText.setColor(ratio < 0.3 ? '#ff6666' : '#ffffff');

    const xp = game.xpSystem;
    const xpRatio = xp.getProgress();
    this.xpBarFill.width = (240 - 4) * Math.min(1, xpRatio);
    this.xpText.setText(`${Math.floor(xp.getXp())}/${xp.getXpToNext()}`);
    this.levelText.setText(`Lv ${xp.level}`);

    // 等级旁边显示境界 —— 它比裸等级更有身份感
    if (game.realmSystem) this.realmText.setText(game.realmSystem.getDisplayName());

    this.timerText.setText(this.formatTime(game.elapsed / 1000));
    this.killText.setText(`击杀: ${game.kills}`);
    this.coinsText.setText(`灵石: ${game.coins ?? 0}`);

    // Boss 血条。没有它的话玩家在 76px 的大体型怪身上完全读不出「还剩多少」
    const boss = game.bossSystem;
    const bossRatio = boss ? boss.bossHpRatio : 0;
    if (boss && boss.current && bossRatio > 0) {
      this.bossBar.setVisible(true);
      this.bossBarFill.width = 416 * bossRatio;
      const phase = boss.phaseName ? ` · ${boss.phaseName}` : '';
      this.bossBarText.setText(`${BOSSES[boss.current.bossKey]?.name ?? ''}${phase}`);
    } else {
      this.bossBar.setVisible(false);
    }
  }

  /**
   * 屏幕中央的横幅提示。
   *
   * 用 UIScene 自己的 tween manager(GameScene 与之相互独立),
   * 所以在 GameScene.tweens.pauseAll() 生效期间横幅依然会动 ——
   * 这正是「需要筑基丹」这类提示所需要的:它要在暂停之前显示。
   */
  private showBanner(text: string, color: string, ms = 1600, sub?: string, startY = GAME_HEIGHT / 2 - 120): void {
    const box = this.add.container(GAME_WIDTH / 2, startY).setDepth(UIScene.DEPTH_OVERLAY);

    const t = this.add.text(0, 0, text, {
      fontFamily: 'monospace',
      fontSize: '32px',
      color,
      fontStyle: 'bold',
      stroke: '#000000',
      strokeThickness: 6,
    }).setOrigin(0.5);

    // 副标题(法宝的描述 / 实际生效数值)。没有它时横幅只有一行,
    // 玩家知道「拿到了极阴」但不知道极阴究竟做了什么。
    const subText = sub
      ? this.add.text(0, 26, sub, {
          fontFamily: 'monospace',
          fontSize: '15px',
          color: '#ddddff',
          stroke: '#000000',
          strokeThickness: 4,
        }).setOrigin(0.5)
      : null;

    box.add(subText ? [t, subText] : [t]);

    this.tweens.add({
      targets: box,
      y: box.y - 40,
      alpha: { from: 1, to: 0 },
      duration: ms,
      ease: 'Quad.easeOut',
      onComplete: () => box.destroy(),
    });
  }

  private formatTime(seconds: number): string {
    const total = Math.floor(seconds);
    const m = Math.floor(total / 60);
    const s = total % 60;
    return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
  }

  private togglePause(): void {
    const game = this.scene.get('GameScene') as any;
    if (!game) return;
    if (game.isPaused) {
      game.resumeGame();
    } else {
      game.pauseGame();
    }
  }

  private onGamePause(): void {
    this.showPauseOverlay();
  }
  private onGameResume(): void {
    this.hidePauseOverlay();
  }

  private showPauseOverlay(): void {
    if (this.pauseOverlay) return;
    const w = GAME_WIDTH, h = GAME_HEIGHT;
    const c = this.add.container(0, 0);
    c.setDepth(UIScene.DEPTH_OVERLAY);
    c.setInteractive(
      new Phaser.Geom.Rectangle(0, 0, w, h),
      Phaser.Geom.Rectangle.Contains,
    );

    const bg = this.add.rectangle(w / 2, h / 2, w, h, 0x000000, 0.5);
    const title = this.add.text(w / 2, h / 2 - 100, '已暂停', {
      fontFamily: 'monospace',
      fontSize: '48px',
      color: '#ffffff',
      fontStyle: 'bold',
    }).setOrigin(0.5);
    const hint = this.add.text(w / 2, h / 2 - 50, '按 P / ESC / 点击按钮继续', {
      fontFamily: 'monospace',
      fontSize: '16px',
      color: '#aaaaaa',
    }).setOrigin(0.5);

    c.add([bg, title, hint]);

    // 属性一览:暂停时拉一次遗物合并结果。
    // 为什么必须有这一行:全局暴击率**只**来自「气运」一件遗物(基础 0),
    // 而它没有写进任何常驻 UI —— 玩家没装气运时,暴击就是字面意义的从不触发,
    // 却无从分辨「系统坏了」和「我没这件遗物」。显示出来,两者一眼可分。
    // showPauseOverlay 每次暂停都重建,这里读到的永远是当下值,不需要事件驱动。
    const gameStats = this.scene.get('GameScene') as any;
    if (gameStats?.relicSystem) {
      const m = gameStats.relicSystem.getPlayerMods();
      const statsLine = [
        `暴击率 ${Math.round(m.critChance * 100)}%`,
        `定身率 ${Math.round(m.freezeChance * 100)}%`,
        `冷却 ×${gameStats.relicSystem.getCooldownMul().toFixed(2)}`,
        `移速 ×${m.moveSpeedMul.toFixed(2)}`,
        `拾取 +${Math.round((m.pickupMul - 1) * 100)}%`,
      ].join('   ');
      // ⚠️ 必须进容器 c:hidePauseOverlay 只销毁容器,散落在场景里的
      // 文本不会跟着走 —— 暂停面板关掉了,属性行却永远留在 HUD 上
      c.add(this.add.text(w / 2, h / 2 - 142, statsLine, {
        fontFamily: 'monospace',
        fontSize: '15px',
        color: '#88ddff',
      }).setOrigin(0.5));
    }

    // 伤害飘字的颜色图例。
    //
    // 为什么必须写在这里:冷蓝那一档是「这一发被护甲削过」的唯一提示,游戏里
    // 没有别的任何地方出现护甲二字。不给图例的话玩家只能把蓝字当成随机配色 ——
    // 而这条信息看不见,破魔 / 破防两条路线就完全没有反馈,只剩「我好像打得慢一点」。
    // 配色直接复用 DamageText 的常量,避免图例和实际渲染各写一份。
    // 用三个独立 Text 而不是一行富文本:Phaser 的 setText 类型只收 string[],
    // 富文本得走 as any 强转,而这一行不值得赌一个运行期才发现的坑。
    const legend = (dx: number, s: string, color: string): Phaser.GameObjects.Text =>
      this.add.text(w / 2 + dx, h / 2 - 80, s, {
        fontFamily: 'monospace',
        fontSize: '15px',
        color,
      }).setOrigin(0, 0.5);
    c.add([
      legend(-210, '伤害数字:', '#aaaaaa'),
      legend(-132, '12', COLOR_NORMAL),
      legend(-108, '常态', '#aaaaaa'),
      legend(-62, '24', COLOR_CRIT),
      legend(-38, '暴击', '#aaaaaa'),
      legend(8, '12', COLOR_ARMORED),
      legend(32, '被护甲削(石傀 / 铁甲兽 / 朱雀)', '#aaaaaa'),
    ]);

    c.setDepth(UIScene.DEPTH_OVERLAY);

    // 继续按钮(Container)
    const resumeBtn = this.createButton(w / 2, h / 2 + 20, 220, 56, '继续', 0x4a4a8a, 0x6a6aff, 0x6a6aff, () => this.togglePause());
    resumeBtn.setDepth(UIScene.DEPTH_OVERLAY + 1);
    c.add(resumeBtn);

    // 回主菜单按钮(Container)
    const menuBtn = this.createButton(w / 2, h / 2 + 100, 220, 56, '回主菜单', 0x6a4a2a, 0xffaa44, 0x8a6a4a, () => {
      this.scene.stop('GameScene');
      this.scene.stop('UIScene');
      this.scene.start('MainMenuScene');
    });
    menuBtn.setDepth(UIScene.DEPTH_OVERLAY + 1);
    c.add(menuBtn);

    if (DEBUG_PANEL_ENABLED) this.addDebugPanel(c);

    this.pauseOverlay = c;
  }

  /**
   * 开发期调试面板
   *
   * 入口放在暂停菜单里而不是键盘快捷键上:快捷键能在任何时候触发,包括手滑,
   * 而「暂停 → 点按钮」把误触成本降到零,也不需要记住键位。
   *
   * 点完自动继续 —— 刷出来的怪、进化横幅都在世界层与 HUD 层,
   * 不恢复的话你只能透过半透明遮罩看个影子。
   * ⚠️ 发布前把 DebugConfig.DEBUG_PANEL_ENABLED 改成 false。
   */
  private addDebugPanel(c: Phaser.GameObjects.Container): void {
    const w = GAME_WIDTH;
    const h = GAME_HEIGHT;

    const caption = this.add.text(w / 2, h / 2 + 150, '调试 · 点击后自动继续', {
      fontFamily: 'monospace',
      fontSize: '13px',
      color: '#8899aa',
    }).setOrigin(0.5);
    c.add(caption);

    // 真实素材接入进度。
    //
    // 它必须是**常驻的一行**而不是出错时才弹的东西:`src/assets` 下文件名拼错时
    // 没有任何报错,游戏照跑、那只怪照旧是程序化画的 —— 唯一能发现的办法就是
    // 在一个每次都会看到的地方写着「还差多少」。
    const assetLine = this.scene.get('PreloadScene') as PreloadScene | null;
    const assetText = this.add.text(
      w / 2, h / 2 + 172,
      assetLine ? `${assetLine.assetSummary} · 横排切帧 ${assetLine.enemyFrameCount}` : '',
      { fontFamily: 'monospace', fontSize: '12px', color: '#667788' },
    ).setOrigin(0.5);
    c.add(assetText);

    // 顺序按主题分组:法术 / 进化 / 刷怪。三列三行,刚好铺满且不越界
    //
    // ⚠️ 列表必须覆盖**每一件新增内容**,且全部由 GameScene 从配置表推导 ——
    //    在这里手写 id 数组的话,加一门法术就会忘了加按钮,而
    //    「调试不到的内容」与「坏掉的内容」在试玩里长得一模一样。
    const actions: { label: string; run: (g: GameScene) => string }[] = [
      { label: '下一门神通', run: (g) => g.debugNextSpell() },
      { label: '装满神通', run: (g) => g.debugGrantAllSpells() },
      { label: '开一格法位', run: (g) => g.debugAddSlot() },
      { label: '全部满级', run: (g) => g.debugMaxSpells() },
      { label: '凑齐融合', run: (g) => g.debugFullEvolution() },
      { label: '凑齐风火融合', run: (g) => g.debugFuseWindFire() },
      { label: '开金匮', run: (g) => g.debugOpenChest() },
      { label: '填满遗物', run: (g) => g.debugGrantAllRelics() },
      { label: '下一只首领', run: (g) => g.debugNextBoss() },
      { label: 'DPS 统计', run: (g) => g.debugToggleDps() },
      { label: '首领血压到 20%', run: (g) => g.debugBossToPhase(0.2) },
      { label: '跳到 10:00', run: (g) => g.debugSetTime(600) },
      { label: '弧带形态对比', run: (g) => g.debugArcShapes() },
      { label: '刷全部怪', run: (g) => g.debugSpawnAllMonsters() },
      { label: '刷精英', run: (g) => g.debugSpawnElite() },
      { label: '投放机制怪', run: (g) => g.debugFireMechanism() },
      { label: '下一个机制怪', run: (g) => g.debugNextMechanism() },
      { label: '跳到 20:00', run: (g) => g.debugSetTime(1200) },
    ];

    // ⚠️ 排布是 5 列 × 3 行,不是 3 列 × 5 行。
    //
    // 三列五行时第 5 行的中心落在 y = 360 + 186 + 4×44 = 722,已经**在 720 的
    // 画面外面**:底部三个按钮(投放机制怪 / 下一个机制怪 / 跳到 20:00)各有 21px
    // 被切掉,而且点不到。改列数比重排列省事,也顺便给手指留出更大的命中高度。
    const COLS = 5;
    const COL_X = [-380, -190, 0, 190, 380];
    actions.forEach((action, i) => {
      const col = i % COLS;
      const row = Math.floor(i / COLS);
      const btn = this.createButton(
        w / 2 + COL_X[col],
        h / 2 + 186 + row * 58,
        172, 52, action.label,
        0x2a2a3a, 0x5566aa, 0x3f3f58,
        () => {
          const game = this.scene.get('GameScene') as unknown as GameScene;
          const msg = action.run(game);
          this.togglePause();
          // 往上挪一格:像「凑齐进化」这类动作自己也会发横幅(进化/宝匣结算),
          // 同在屏幕中央会叠成一团 —— 调试的那条让位到上面
          this.showBanner(`调试 · ${action.label}`, '#88ffdd', 2000, msg, GAME_HEIGHT / 2 - 190);
        },
        14,
      );
      btn.setDepth(UIScene.DEPTH_OVERLAY + 1);
      c.add(btn);
    });
  }

  private hidePauseOverlay(): void {
    if (this.pauseOverlay) {
      this.pauseOverlay.destroy();
      this.pauseOverlay = undefined;
    }
  }
}
