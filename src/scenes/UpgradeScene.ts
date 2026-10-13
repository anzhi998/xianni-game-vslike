import Phaser from 'phaser';
import { GAME_WIDTH, GAME_HEIGHT } from '../config/GameConfig';
import type { Upgrade } from '../types';

export class UpgradeScene extends Phaser.Scene {
  private level = 1;
  private kind: 'minor' | 'major' = 'minor';
  private realmName = '';
  private title = '';
  private subtitle = '';
  private onSelect?: (u: Upgrade) => void;
  /** 二级流程(替换面板)的放弃出口;不传就不画放弃按钮 */
  private onCancel?: () => void;
  private cards: Upgrade[] = [];

  constructor() {
    super('UpgradeScene');
  }

  init(data: any): void {
    this.level = data.level || 1;
    this.kind = data.kind === 'major' ? 'major' : 'minor';
    this.realmName = data.realmName || '';
    // 替换面板等二级流程自带标题;不传则按 major/minor 走默认
    this.title = data.title || (this.kind === 'major' ? '突破！' : '精进');
    // 副标题:二级流程(替换面板)可自带;默认按 major/minor 走老文案
    this.subtitle = data.subtitle
      ?? (this.kind === 'major'
        ? `境界突破 · ${this.realmName}`
        : this.realmName
          ? `${this.realmName} · 选择一项精进 (Lv ${this.level})`
          : `选择一项精进 (Lv ${this.level})`);
    this.cards = data.cards ?? [];
    this.onSelect = data.onSelect;
    this.onCancel = data.onCancel;
  }

  create(): void {
    const w = GAME_WIDTH;
    const h = GAME_HEIGHT;
    const isMajor = this.kind === 'major';

    this.cameras.main.setBackgroundColor('rgba(0,0,0,0.7)');
    this.cameras.main.fadeIn(200, 0, 0, 0);

    // 大境界突破用更醒目的配色与标题
    this.add.text(w / 2, 100, this.title, {
      fontFamily: 'monospace',
      fontSize: isMajor ? '48px' : '36px',
      color: isMajor ? '#ffcc44' : '#88ddff',
      fontStyle: 'bold',
    }).setOrigin(0.5).setShadow(0, 3, '#000000', 6, false, true);

    this.add.text(w / 2, 150, this.subtitle, {
      fontFamily: 'monospace',
      fontSize: '20px',
      color: '#ffffff',
    }).setOrigin(0.5);

    const count = Math.max(1, this.cards.length);
    // 自适应:三选一的 3 张卡维持 280px;替换面板等 6 张卡的场景按可用宽度
    // 均分收缩(1280 宽下 6 张 → 175px),宁可卡窄一点也不让面板溢出屏幕
    const maxTotal = w - 80;
    let cardW = 280;
    let gap = 30;
    if (cardW * count + gap * (count - 1) > maxTotal) {
      gap = 14;
      cardW = Math.floor((maxTotal - gap * (count - 1)) / count);
    }
    const totalW = cardW * count + gap * (count - 1);
    const startX = (w - totalW) / 2 + cardW / 2;
    const cy = h / 2 + 30;

    this.cards.forEach((up, i) => {
      const cx = startX + i * (cardW + gap);
      this.createUpgradeCard(cx, cy, cardW, 320, up);
    });

    // 放弃按钮:右上角。替换面板等二级流程才有(onCancel 传入才画) ——
    // 主三选一没有放弃,那会让「攒修为升级」变成可以白嫖跳过的选项
    if (this.onCancel) {
      const btn = this.add.container(w - 74, 44);
      const bg = this.add.rectangle(0, 0, 96, 40, 0x332222, 0.9)
        .setStrokeStyle(2, 0xcc6666)
        .setInteractive({ useHandCursor: true });
      const label = this.add.text(0, 0, '放弃', {
        fontFamily: 'monospace',
        fontSize: '20px',
        color: '#dd8888',
        fontStyle: 'bold',
      }).setOrigin(0.5);
      bg.on('pointerover', () => {
        bg.setFillStyle(0x552a2a, 0.95);
        label.setColor('#ffbbbb');
      });
      bg.on('pointerout', () => {
        bg.setFillStyle(0x332222, 0.9);
        label.setColor('#dd8888');
      });
      bg.on('pointerdown', () => this.onCancel!());
      btn.add([bg, label]);
    }
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
