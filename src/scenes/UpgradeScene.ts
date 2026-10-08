import Phaser from 'phaser';
import { GAME_WIDTH, GAME_HEIGHT } from '../config/GameConfig';
import type { Upgrade } from '../types';

export class UpgradeScene extends Phaser.Scene {
  private level = 1;
  private kind: 'minor' | 'major' = 'minor';
  private realmName = '';
  private onSelect?: (u: Upgrade) => void;
  private cards: Upgrade[] = [];

  constructor() {
    super('UpgradeScene');
  }

  init(data: any): void {
    this.level = data.level || 1;
    this.kind = data.kind === 'major' ? 'major' : 'minor';
    this.realmName = data.realmName || '';
    this.cards = data.cards ?? [];
    this.onSelect = data.onSelect;
  }

  create(): void {
    const w = GAME_WIDTH;
    const h = GAME_HEIGHT;
    const isMajor = this.kind === 'major';

    this.cameras.main.setBackgroundColor('rgba(0,0,0,0.7)');
    this.cameras.main.fadeIn(200, 0, 0, 0);

    // 大境界突破用更醒目的配色与标题
    this.add.text(w / 2, 100, isMajor ? '突破！' : '精进', {
      fontFamily: 'monospace',
      fontSize: '48px',
      color: isMajor ? '#ffcc44' : '#88ddff',
      fontStyle: 'bold',
    }).setOrigin(0.5).setShadow(0, 3, '#000000', 6, false, true);

    const subtitle = isMajor
      ? `境界突破 · ${this.realmName}`
      : `${this.realmName} · 选择一项精进 (Lv ${this.level})`;
    this.add.text(w / 2, 150, subtitle, {
      fontFamily: 'monospace',
      fontSize: '20px',
      color: '#ffffff',
    }).setOrigin(0.5);

    const cardW = 280;
    const cardH = 320;
    const gap = 30;
    const count = Math.max(1, this.cards.length);
    const totalW = cardW * count + gap * (count - 1);
    const startX = (w - totalW) / 2 + cardW / 2;
    const cy = h / 2 + 30;

    this.cards.forEach((up, i) => {
      const cx = startX + i * (cardW + gap);
      this.createUpgradeCard(cx, cy, cardW, cardH, up);
    });
  }

  private createUpgradeCard(cx: number, cy: number, w: number, h: number, upgrade: Upgrade): void {
    const card = this.add.container(cx, cy);
    const bg = this.add.rectangle(0, 0, w, h, 0x222244, 0.95)
      .setStrokeStyle(3, upgrade.iconColor)
      .setInteractive({ useHandCursor: true });

    // 图标(色块)
    const icon = this.add.rectangle(0, -80, 80, 80, upgrade.iconColor, 1).setStrokeStyle(3, 0xffffff);
    const iconText = this.add.text(0, -80, upgrade.type.substring(0, 3).toUpperCase(), {
      fontFamily: 'monospace',
      fontSize: '16px',
      color: '#ffffff',
      fontStyle: 'bold',
    }).setOrigin(0.5);

    // 标题
    const title = this.add.text(0, -10, upgrade.name, {
      fontFamily: 'monospace',
      fontSize: '20px',
      color: '#ffffff',
      fontStyle: 'bold',
      align: 'center',
      wordWrap: { width: w - 30 },
    }).setOrigin(0.5);

    // 描述
    const desc = this.add.text(0, 50, upgrade.description, {
      fontFamily: 'monospace',
      fontSize: '14px',
      color: '#cccccc',
      align: 'center',
      wordWrap: { width: w - 30 },
    }).setOrigin(0.5);

    // 点击
    bg.on('pointerover', () => {
      bg.setScale(1.04);
      bg.setFillStyle(0x333366, 0.98);
    });
    bg.on('pointerout', () => {
      bg.setScale(1);
      bg.setFillStyle(0x222244, 0.95);
    });
    bg.on('pointerdown', () => {
      this.select(upgrade);
    });

    card.add([bg, icon, iconText, title, desc]);
    card.setScale(0.7);
    card.setAlpha(0);
    this.tweens.add({
      targets: card,
      scale: 1,
      alpha: 1,
      duration: 350,
      ease: 'Back.easeOut',
    });
  }

  private select(upgrade: Upgrade): void {
    this.cameras.main.flash(120, 255, 255, 200);
    if (this.onSelect) {
      this.onSelect(upgrade);
    }
  }
}
