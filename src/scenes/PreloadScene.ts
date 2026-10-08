import Phaser from 'phaser';
import { generateAllAssets } from '../utils/AssetGenerator';

/**
 * 资源加载场景
 * - 通过 Phaser.Graphics 程序化生成所有精灵/音效占位
 * - 显示加载进度条
 */
export class PreloadScene extends Phaser.Scene {
  constructor() {
    super('PreloadScene');
  }

  create(): void {
    this.cameras.main.setBackgroundColor('#0d0d1a');

    const cx = this.cameras.main.width / 2;
    const cy = this.cameras.main.height / 2;

    this.add.text(cx, cy - 60, '正在生成世界...', {
      fontFamily: 'monospace',
      fontSize: '24px',
      color: '#e0e0e0',
    }).setOrigin(0.5);

    const barWidth = 400;
    const barHeight = 20;
    const barX = cx - barWidth / 2;
    const barY = cy;

    const bg = this.add.rectangle(barX, barY, barWidth, barHeight, 0x222244).setOrigin(0, 0.5);
    bg.setStrokeStyle(2, 0x4444aa);

    const fill = this.add.rectangle(barX + 2, barY, 0, barHeight - 4, 0x6bff6b).setOrigin(0, 0.5);

    this.load.on('progress', (value: number) => {
      fill.width = (barWidth - 4) * value;
    });

    this.load.on('complete', () => {
      this.time.delayedCall(200, () => {
        this.scene.start('MainMenuScene');
      });
    });

    generateAllAssets(this);

    this.load.start();
  }
}
