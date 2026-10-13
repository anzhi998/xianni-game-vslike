import Phaser from 'phaser';
import { GAME_WIDTH, GAME_HEIGHT } from '../config/GameConfig';
import { SaveManager } from '../utils/SaveManager';
import { RELICS } from '../config/RelicConfig';

export class GameOverScene extends Phaser.Scene {
  private surviveTime = 0;
  private kills = 0;
  private level = 1;
  private newRecordTime = false;
  private newRecordKills = false;
  private realmName = '凝气期·一层';
  private coins = 0;
  private relics: string[] = [];

  constructor() {
    super('GameOverScene');
  }

  init(data: any): void {
    this.surviveTime = data.time || 0;
    this.kills = data.kills || 0;
    this.level = data.level || 1;
    this.realmName = data.realmName || '凝气期·一层';
    this.coins = data.coins ?? 0;
    this.relics = (data.relics ?? []) as string[];
    this.newRecordTime = !!data.newRecordTime;
    this.newRecordKills = !!data.newRecordKills;
  }

  create(): void {
    const w = GAME_WIDTH;
    const h = GAME_HEIGHT;

    this.cameras.main.setBackgroundColor('#0d0d1a');
    this.cameras.main.flash(200, 80, 0, 0);

    this.add.text(w / 2, 100, '你死了', {
      fontFamily: 'monospace',
      fontSize: '72px',
      color: '#ff4444',
      fontStyle: 'bold',
    }).setOrigin(0.5).setShadow(0, 4, '#000000', 8, false, true);

    // 统计
    const statsY = 220;
    const lines: { label: string; value: string; color?: string }[] = [
      { label: '生存时间', value: this.formatTime(this.surviveTime), color: '#ffffff' },
      { label: '击杀数', value: String(this.kills), color: '#ffdd44' },
      { label: '达到等级', value: `Lv ${this.level}`, color: '#aaccff' },
      { label: '最终境界', value: this.realmName, color: '#88ddff' },
      { label: '灵石', value: String(this.coins), color: '#ffd070' },
    ];

    // 本局获得的遗物
    if (this.relics.length > 0) {
      const names = this.relics.map((id) => RELICS[id]?.name ?? id).join('  ');
      lines.push({ label: '所得遗物', value: names, color: '#ffcc44' });
    }
    lines.forEach((line, i) => {
      const y = statsY + i * 50;
      this.add.text(w / 2 - 130, y, line.label, {
        fontFamily: 'monospace',
        fontSize: '22px',
        color: '#888888',
      }).setOrigin(0, 0.5);
      this.add.text(w / 2 + 130, y, line.value, {
        fontFamily: 'monospace',
        fontSize: '28px',
        color: line.color || '#ffffff',
        fontStyle: 'bold',
      }).setOrigin(1, 0.5);
    });

    // 新纪录提示
    const hintY = statsY + lines.length * 50 + 20;
    if (this.newRecordTime) {
      this.add.text(w / 2, hintY, '★ 新的生存时间纪录!', {
        fontFamily: 'monospace',
        fontSize: '20px',
        color: '#ffdd44',
        fontStyle: 'bold',
      }).setOrigin(0.5);
    }
    if (this.newRecordKills) {
      this.add.text(w / 2, hintY + 30, '★ 新的击杀数纪录!', {
        fontFamily: 'monospace',
        fontSize: '20px',
        color: '#ffdd44',
        fontStyle: 'bold',
      }).setOrigin(0.5);
    }

    // 历史最高
    this.add.text(w / 2, h - 200, `最佳: ${this.formatTime(SaveManager.getBestTime())}  |  最强: ${SaveManager.getBestKills()} 击杀`, {
      fontFamily: 'monospace',
      fontSize: '16px',
      color: '#888888',
    }).setOrigin(0.5);

    // 按钮
    //
    // ⚠️ 尺寸与间距是按「手指」定的,不是按鼠标定的:手机横屏时整块画布被缩到
    // 0.55 倍,50px 高的按钮落到屏幕上只有 27 个 CSS 像素,手指按不中。
    // 而且原来两个按钮的中心相距 220、宽度正好 200 —— **它们是贴在一起的**,
    // 想「再来一局」很容易点成「回主菜单」,而后者会丢掉这一局。
    const btnY = h - 110;
    const btnW = 260;
    const btnH = 76;
    const btnGap = 30;
    const restartX = w / 2 - (btnW + btnGap) / 2;
    const menuX = w / 2 + (btnW + btnGap) / 2;

    const restart = this.add.rectangle(restartX, btnY, btnW, btnH, 0x4a4a8a).setStrokeStyle(2, 0x6a6aff).setInteractive({ useHandCursor: true });
    this.add.text(restartX, btnY, '再来一局', { fontFamily: 'monospace', fontSize: '22px', color: '#ffffff' }).setOrigin(0.5);
    restart.on('pointerover', () => restart.setFillStyle(0x6a6aff));
    restart.on('pointerout', () => restart.setFillStyle(0x4a4a8a));
    restart.on('pointerdown', () => {
      this.scene.stop('UIScene');
      this.scene.start('GameScene');
    });

    const menu = this.add.rectangle(menuX, btnY, btnW, btnH, 0x6a4a2a).setStrokeStyle(2, 0xffaa44).setInteractive({ useHandCursor: true });
    this.add.text(menuX, btnY, '回主菜单', { fontFamily: 'monospace', fontSize: '22px', color: '#ffffff' }).setOrigin(0.5);
    menu.on('pointerover', () => menu.setFillStyle(0x8a6a4a));
    menu.on('pointerout', () => menu.setFillStyle(0x6a4a2a));
    menu.on('pointerdown', () => {
      this.scene.stop('UIScene');
      this.scene.start('MainMenuScene');
    });
  }

  private formatTime(seconds: number): string {
    const m = Math.floor(seconds / 60);
    const s = Math.floor(seconds % 60);
    return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
  }
}
