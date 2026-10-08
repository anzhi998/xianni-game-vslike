import Phaser from 'phaser';
import { GAME_WIDTH, GAME_HEIGHT } from '../config/GameConfig';
import { WEAPONS } from '../config/WeaponConfig';
import { ARTIFACTS } from '../config/ArtifactConfig';
import { REALMS } from '../config/RealmConfig';

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
    this.realmText = this.add.text(xpX + xpW + 8, xpY + 26, '炼气期·初期', {
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
      game.events.on('artifact-equipped', () => { this.updateHUD(); this.refreshArtifacts(); });
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
  ): Phaser.GameObjects.Container {
    const container = this.add.container(x, y);

    const bg = this.add.rectangle(0, 0, width, height, bgColor).setStrokeStyle(2, strokeColor);
    const txt = this.add.text(0, 0, label, {
      fontFamily: 'monospace',
      fontSize: '18px',
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
      const lvl = this.add.text(x + 20, 56, cfg?.name ?? w.id, {
        fontFamily: 'monospace', fontSize: '11px', color: '#ffffff', fontStyle: 'bold',
      }).setOrigin(0.5).setWordWrapWidth(52);
      this.weaponPanel.add([rect, icon, lvl]);
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
      const x = i * 70;
      const rect = this.add.rectangle(x, 30, 60, 60, 0x1a1a33).setStrokeStyle(2, cfg?.color ?? 0xffffff);
      // 法宝图标用其 color 填充方块 —— 与掉落物外观同色,便于识别
      const icon = this.add.rectangle(x + 4, 30, 40, 30, cfg?.color ?? 0x888888);
      const lvl = this.add.text(x + 20, 56, `Lv${a.level}`, {
        fontFamily: 'monospace', fontSize: '12px', color: '#ffffff', fontStyle: 'bold',
      }).setOrigin(0.5);
      const name = this.add.text(x + 20, 66, cfg?.name ?? a.id, {
        fontFamily: 'monospace', fontSize: '10px', color: '#cccccc',
      }).setOrigin(0.5);
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
  private showBanner(text: string, color: string, ms = 1600): void {
    const t = this.add.text(GAME_WIDTH / 2, GAME_HEIGHT / 2 - 120, text, {
      fontFamily: 'monospace',
      fontSize: '32px',
      color,
      fontStyle: 'bold',
      stroke: '#000000',
      strokeThickness: 6,
    }).setOrigin(0.5).setDepth(UIScene.DEPTH_OVERLAY);

    this.tweens.add({
      targets: t,
      y: t.y - 40,
      alpha: { from: 1, to: 0 },
      duration: ms,
      ease: 'Quad.easeOut',
      onComplete: () => t.destroy(),
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

    this.pauseOverlay = c;
  }

  private hidePauseOverlay(): void {
    if (this.pauseOverlay) {
      this.pauseOverlay.destroy();
      this.pauseOverlay = undefined;
    }
  }
}
