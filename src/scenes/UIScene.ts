import Phaser from 'phaser';
import { GAME_WIDTH, GAME_HEIGHT } from '../config/GameConfig';
import { WEAPONS } from '../config/WeaponConfig';
import { ARTIFACTS, describeArtifact, MAX_ARTIFACT_LEVEL } from '../config/ArtifactConfig';
import { EVOLUTIONS } from '../config/EvolutionConfig';
import { REALMS } from '../config/RealmConfig';
import { DEBUG_PANEL_ENABLED } from '../config/DebugConfig';
// 只作类型引用 —— 调试面板要按名字调 GameScene 上的 debug* 方法。
// type-only import 在编译后不存在,所以不会构成运行时循环依赖
import type { GameScene } from './GameScene';

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
  private weaponPanel!: Phaser.GameObjects.Container;
  private artifactPanel!: Phaser.GameObjects.Container;
  private pauseBtn!: Phaser.GameObjects.Container;
  private pauseOverlay?: Phaser.GameObjects.Container;
  private pauseKeyHandler?: (e: KeyboardEvent) => void;

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

    // 境界名(取代裸等级)。卡在大境界道具门槛上时会变为橙色提示所需道具
    this.realmText = this.add.text(xpX + xpW + 8, xpY + 26, '凝气期·一层', {
      fontFamily: 'monospace', fontSize: '14px', color: '#aaffff',
    }).setOrigin(0, 0.5).setDepth(UIScene.DEPTH_HUD);

    this.timerText = this.add.text(w / 2, 16, '00:00', { fontFamily: 'monospace', fontSize: '24px', color: '#ffffff', fontStyle: 'bold' }).setOrigin(0.5, 0)
      .setDepth(UIScene.DEPTH_HUD);
    this.timerText.setShadow(0, 2, '#000000', 4, false, true);

    this.killText = this.add.text(w - 20, 16, '击杀: 0', { fontFamily: 'monospace', fontSize: '18px', color: '#ffdd44' }).setOrigin(1, 0)
      .setDepth(UIScene.DEPTH_HUD);
    this.killText.setShadow(0, 2, '#000000', 4, false, true);

    // ====== 暂停按钮 (Container 模式) ======
    this.pauseBtn = this.createButton(w - 50, 60, 80, 44, '暂停', 0x333355, 0x6a6aff, 0x4a4a88, () => this.togglePause());
    this.pauseBtn.setDepth(UIScene.DEPTH_HUD);

    // ====== 法术信息面板 ======
    this.weaponPanel = this.add.container(20, h - 140);
    this.weaponPanel.setDepth(UIScene.DEPTH_HUD);
    this.refreshWeapons();

    // ====== 法宝信息面板(位于法术面板下方)======
    this.artifactPanel = this.add.container(20, h - 72);
    this.artifactPanel.setDepth(UIScene.DEPTH_HUD);
    this.refreshArtifacts();

    // ====== 备用:键盘 P/ESC 暂停 (HUD 层响应) ======
    this.pauseKeyHandler = (e: KeyboardEvent) => {
      if (e.code === 'KeyP' || e.code === 'Escape') {
        e.preventDefault();
        this.togglePause();
      }
    };
    window.addEventListener('keydown', this.pauseKeyHandler);

    // ====== 监听 GameScene 事件 ======
    const game = this.scene.get('GameScene');
    if (game) {
      game.events.on('player-damaged', () => this.updateHUD());
      game.events.on('player-healed', () => this.updateHUD());
      game.events.on('player-level-up', () => this.updateHUD());
      game.events.on('xp-collected', () => this.updateHUD());
      game.events.on('enemy-killed', () => this.updateHUD());
      game.events.on('upgrade-applied', () => { this.updateHUD(); this.refreshWeapons(); });
      game.events.on('artifact-equipped', (id: string, level: number) => {
        this.updateHUD();
        this.refreshArtifacts();
        // 此前这里只刷新面板,捡到法宝屏幕上一片死寂 —— 玩家既不知道捡到了什么,
        // 也不知道它改变了什么。现在把名字、等级、实际生效的数值都摆出来。
        const cfg = ARTIFACTS[id];
        if (!cfg) return;
        const color = '#' + cfg.color.toString(16).padStart(6, '0');
        const head = level > 1 ? `${cfg.name} 祭炼至 ${level} 级` : `获得法宝 ${cfg.name}`;
        const effect = describeArtifact(id, level);
        this.showBanner(head, color, 2000, effect || cfg.desc);
      });
      game.events.on('keyitem-obtained', (id: string) => {
        this.updateHUD();
        const name = REALMS.find((r) => r.keyItemId === id)?.keyItemName ?? id;
        this.showBanner(`获得 ${name}`, '#ffcc44');
      });
      game.events.on('breakthrough', (realm: string) => {
        this.updateHUD();
        this.refreshArtifacts();
        this.showBanner(`突破至 ${realm}期！`, '#ffcc44', 2200);
      });
      game.events.on('game-pause', () => this.onGamePause());
      game.events.on('game-resume', () => this.onGameResume());
      game.events.on('spell-evolved', (_id: string, name: string) => {
        this.updateHUD();
        this.refreshWeapons();
        this.showBanner(`神通进化 · ${name}`, '#ffdd66', 2600, '威力大幅跃升');
      });
      // 宝匣结算。一件匣子可能一次触发多个进化,所以载荷是数组
      game.events.on('chest-resolved', (names: string[]) => {
        if (names.length === 0) {
          this.showBanner('秘境宝匣', '#ffdd66', 1400, '三条件未齐,折为修为');
          return;
        }
        this.showBanner(
          `秘境宝匣 · ${names.length > 1 ? '连环进化' : '进化'}`,
          '#ffdd66', 2800,
          names.join('  ·  '),
        );
      });
    }

    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      if (this.pauseKeyHandler) window.removeEventListener('keydown', this.pauseKeyHandler);
    });
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

  private refreshWeapons(): void {
    this.weaponPanel.removeAll(true);
    const game = this.scene.get('GameScene') as any;
    if (!game?.weaponSystem) return;
    const weapons = game.weaponSystem.getWeapons();
    const cap = game.realmSystem?.getSpellSlots?.() ?? weapons.length;

    // 法位标题 —— 让玩家随时知道还剩几个空位
    this.weaponPanel.add([
      this.add.text(4, -4, `法位 ${weapons.length}/${cap}`, {
        fontFamily: 'monospace', fontSize: '12px',
        color: weapons.length >= cap ? '#ff9966' : '#8899bb',
      }),
    ]);

    weapons.forEach((w: any, i: number) => {
      const cfg = WEAPONS[w.id];
      const x = i * 70;
      const rect = this.add.rectangle(x, 30, 60, 60, 0x222244).setStrokeStyle(2, 0x6a6aff);
      // 颜色与名称读配置,不再硬编码三元表达式
      const icon = this.add.rectangle(x + 4, 30, 40, 30, cfg?.color ?? 0xdddddd);
      // 重数神通显示「N 重」并标出是否满重(满重才能进化),旧法术仍显示 Lv
      const isRitual = !!cfg?.usesRituals;
      const label = isRitual
        ? `${w.ritual}重`
        : `Lv${w.level}`;
      const sub = this.add.text(x + 20, 56, cfg?.name ?? w.id, {
        fontFamily: 'monospace', fontSize: '11px', color: '#ffffff', fontStyle: 'bold',
      }).setOrigin(0.5).setWordWrapWidth(52);
      const lv = this.add.text(x + 50, 8, label, {
        fontFamily: 'monospace', fontSize: '11px',
        color: isRitual && w.ritual >= 8 ? '#ffdd66' : '#aaaaff',
        fontStyle: 'bold',
      }).setOrigin(0.5);
      this.weaponPanel.add([rect, icon, sub, lv]);
    });
  }

  private refreshArtifacts(): void {
    this.artifactPanel.removeAll(true);
    const game = this.scene.get('GameScene') as any;
    if (!game?.artifactSystem) return;
    const equipped = game.artifactSystem.getEquipped();
    const cap = game.artifactSystem.getSlotCap();

    if (equipped.length === 0) {
      this.artifactPanel.add([
        this.add.text(4, 26, '法宝: 无', {
          fontFamily: 'monospace', fontSize: '12px', color: '#666688',
        }),
      ]);
      return;
    }

    equipped.forEach((a: any, i: number) => {
      const cfg = ARTIFACTS[a.id];
      const color = cfg?.color ?? 0xffffff;
      const x = i * 70;
      const rect = this.add.rectangle(x, 30, 60, 60, 0x1a1a33).setStrokeStyle(2, color);
      // 法宝图标用其 color 填充方块 —— 与掉落物外观同色,便于识别
      const icon = this.add.rectangle(x + 4, 30, 40, 30, color);
      const lvl = this.add.text(x + 20, 56, `${a.level}级`, {
        fontFamily: 'monospace', fontSize: '12px',
        color: a.level >= MAX_ARTIFACT_LEVEL ? '#ffdd66' : '#ffffff',
        fontStyle: 'bold',
      }).setOrigin(0.5);
      const name = this.add.text(x + 20, 66, cfg?.name ?? a.id, {
        fontFamily: 'monospace', fontSize: '10px', color: '#cccccc',
      }).setOrigin(0.5);

      // 悬停展开详情。
      //
      // 60x60 的格子装不下 desc —— 法宝面板在屏幕左下角,横向有的是空间,
      // 但常驻多行文本会把法术面板挤到画面外。悬停是这里唯一不破坏布局的选择。
      // 交互对象是 rect 本身(已在 add 列表里,见 CLAUDE.md 的 Container 卡片坑),
      // 并且用 setInteractive 显式给了矩形命中区 —— Container 本身是 0x0。
      rect.setInteractive({ useHandCursor: true });
      rect.on('pointerover', () => this.showArtifactTip(a.id, a.level, color, i));
      rect.on('pointerout', () => this.hideArtifactTip());

      this.artifactPanel.add([rect, icon, lvl, name]);
    });

    // 剩余空位提示
    const used = equipped.length;
    if (used < cap) {
      this.artifactPanel.add([
        this.add.text(used * 70 + 4, 26, `空 ${cap - used}`, {
          fontFamily: 'monospace', fontSize: '12px', color: '#666688',
        }),
      ]);
    }
  }

  /**
   * 法宝详情浮层。惰性创建、复用同一个 Container —— 悬停是高频事件,
   * 每次新建会持续分配 Text 对象。
   */
  private artifactTip?: Phaser.GameObjects.Container;

  private showArtifactTip(id: string, level: number, color: number, index: number): void {
    const cfg = ARTIFACTS[id];
    if (!cfg) return;

    if (!this.artifactTip) {
      this.artifactTip = this.add.container(0, 0).setDepth(UIScene.DEPTH_OVERLAY).setVisible(false);
    }

    // 钥匙提示 —— 设计书铁律三:钥匙与锁必须能一句话说清同源逻辑。
    // 法宝挂着双重职责(属性 + 钥匙),不给玩家看它开哪把锁,
    // 「占这一格值不值」这个问题就没人能回答。
    const unlocks = EVOLUTIONS.filter((e) => e.keys.includes(id));
    const keyLine = unlocks.length === 0
      ? ''
      : `\n钥匙: ${unlocks.map((e) => `${e.evolvedName}(${e.reason})`).join('\n      ')}`;

    const body = `${cfg.desc}\n生效: ${describeArtifact(id, level) || '无'}${keyLine}`;
    const text = this.add.text(12, 10, `${cfg.name} · ${level} 级\n${body}`, {
      fontFamily: 'monospace',
      fontSize: '13px',
      color: '#ffffff',
      lineSpacing: 4,
      wordWrap: { width: 260 },
    });
    // 边框色跟着法宝走,和面板图标、地面掉落物同一套配色
    const bg = this.add.rectangle(0, 0, text.width + 24, text.height + 20, 0x0a0a1a, 0.94)
      .setStrokeStyle(2, color)
      .setOrigin(0, 0);

    // 位置用面板锚点算(UIScene 是固定 1280x720 视口,不需要缩放换算):
    // 锚在该法宝格子的右上角并向上展开 —— 底部面板向上弹不会跑出画面。
    const anchorX = this.artifactPanel.x + (index * 70 + 60);
    const anchorY = this.artifactPanel.y - text.height - 24;

    this.artifactTip.removeAll(true);
    this.artifactTip.add([bg, text]);
    this.artifactTip.setPosition(Math.min(anchorX, GAME_WIDTH - text.width - 40), Math.max(10, anchorY));
    this.artifactTip.setVisible(true);
  }

  private hideArtifactTip(): void {
    this.artifactTip?.setVisible(false);
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

    // 修为这一栏改成显示境界 —— 它比裸等级更有意义
    const realm = game.realmSystem;
    if (realm) {
      const blocked = realm.isBlocked;
      this.realmText.setText(blocked ? `需 ${realm.getRequiredKeyItemName()}` : realm.getDisplayName());
      this.realmText.setColor(blocked ? '#ffaa44' : '#aaffff');
      this.xpBarFill.setFillStyle(blocked ? 0xffaa44 : 0x44aaff);
    }

    this.timerText.setText(this.formatTime(game.elapsed / 1000));
    this.killText.setText(`击杀: ${game.kills}`);
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

    // 顺序按主题分组:法术 / 进化 / 刷怪。三列三行,刚好铺满且不越界
    const actions: { label: string; run: (g: GameScene) => string }[] = [
      { label: '下一门法术', run: (g) => g.debugNextSpell() },
      { label: '装满法术', run: (g) => g.debugGrantAllSpells() },
      { label: '重置法术', run: (g) => g.debugResetSpells() },
      { label: '凑齐进化', run: (g) => g.debugFullEvolution() },
      { label: '满 8 重', run: (g) => g.debugMaxRitual() },
      { label: '刷全部怪', run: (g) => g.debugSpawnAllMonsters() },
      { label: '刷精英', run: (g) => g.debugSpawnElite() },
      { label: '投放机制怪', run: (g) => g.debugFireMechanism() },
      { label: '下一个机制怪', run: (g) => g.debugNextMechanism() },
    ];

    const COLS = 3;
    const COL_X = [-190, 0, 190];
    actions.forEach((action, i) => {
      const col = i % COLS;
      const row = Math.floor(i / COLS);
      const btn = this.createButton(
        w / 2 + COL_X[col],
        h / 2 + 186 + row * 44,
        176, 38, action.label,
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
