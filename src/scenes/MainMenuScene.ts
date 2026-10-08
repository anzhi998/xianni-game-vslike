import Phaser from 'phaser';
import { SaveManager } from '../utils/SaveManager';

/**
 * 主菜单场景
 */
export class MainMenuScene extends Phaser.Scene {
  constructor() {
    super('MainMenuScene');
  }

  create(): void {
    const cx = this.cameras.main.width / 2;
    const cy = this.cameras.main.height / 2;

    this.cameras.main.setBackgroundColor('#0d0d1a');

    // 标题
    const title = this.add.text(cx, cy - 200, '献祭', {
      fontFamily: 'monospace',
      fontSize: '96px',
      color: '#ff6b6b',
      fontStyle: 'bold',
    });
    title.setOrigin(0.5);

    const subtitle = this.add.text(cx, cy - 120, 'XIANNI - A Vampire Survivors-like', {
      fontFamily: 'monospace',
      fontSize: '18px',
      color: '#888',
    });
    subtitle.setOrigin(0.5);

    // 装饰
    const decor = this.add.text(cx, cy - 70, '★ 抵御无尽的敌人,坚持尽可能长的时间 ★', {
      fontFamily: 'monospace',
      fontSize: '16px',
      color: '#aaa',
    });
    decor.setOrigin(0.5);

    // 最高分
    const bestTime = SaveManager.getBestTime();
    const bestKills = SaveManager.getBestKills();
    this.add.text(cx, cy - 30, `最高记录: ${formatTime(bestTime)}  |  最多击杀: ${bestKills}`, {
      fontFamily: 'monospace',
      fontSize: '16px',
      color: '#ffdd44',
    }).setOrigin(0.5);

    // 开始按钮
    const startBtn = this.add.rectangle(cx, cy + 50, 240, 60, 0x4a4a8a)
      .setStrokeStyle(3, 0x6a6aff)
      .setInteractive({ useHandCursor: true });
    const startText = this.add.text(cx, cy + 50, '开始游戏', {
      fontFamily: 'monospace',
      fontSize: '24px',
      color: '#ffffff',
      fontStyle: 'bold',
    }).setOrigin(0.5);

    startBtn.on('pointerover', () => {
      startBtn.setFillStyle(0x6a6aff);
      startText.setScale(1.05);
    });
    startBtn.on('pointerout', () => {
      startBtn.setFillStyle(0x4a4a8a);
      startText.setScale(1);
    });
    startBtn.on('pointerdown', () => {
      this.scene.start('GameScene');
    });

    // 提示
    const tipLines = [
      'WASD / 方向键 = 移动',
      'P / ESC = 暂停',
      '靠近自动拾取经验',
    ];
    tipLines.forEach((line, i) => {
      this.add.text(cx, cy + 160 + i * 26, line, {
        fontFamily: 'monospace',
        fontSize: '16px',
        color: '#888',
      }).setOrigin(0.5);
    });

    // 飘动装饰
    this.addStarfield();
  }

  private addStarfield(): void {
    for (let i = 0; i < 80; i++) {
      const x = Math.random() * this.cameras.main.width;
      const y = Math.random() * this.cameras.main.height;
      const s = Math.random() * 1.5 + 0.5;
      const a = Math.random() * 0.4 + 0.1;
      const star = this.add.rectangle(x, y, s, s, 0xffffff, a);
      this.tweens.add({
        targets: star,
        alpha: { from: a, to: a * 0.2 },
        duration: 1500 + Math.random() * 2000,
        yoyo: true,
        repeat: -1,
      });
    }
  }
}

function formatTime(seconds: number): string {
  if (!seconds || seconds < 1) return '--:--';
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
}
