import Phaser from 'phaser';

/**
 * 启动场景 - 显示 logo / 初始资源
 */
export class BootScene extends Phaser.Scene {
  constructor() {
    super('BootScene');
  }

  create(): void {
    this.cameras.main.setBackgroundColor('#0d0d1a');

    const cx = this.cameras.main.width / 2;
    const cy = this.cameras.main.height / 2;

    const title = this.add.text(cx, cy - 40, '献祭', {
      fontFamily: 'monospace',
      fontSize: '72px',
      color: '#ff6b6b',
      fontStyle: 'bold',
    });
    title.setOrigin(0.5);

    const sub = this.add.text(cx, cy + 30, 'XIANNI', {
      fontFamily: 'monospace',
      fontSize: '20px',
      color: '#888',
    });
    sub.setOrigin(0.5);

    this.time.delayedCall(800, () => {
      this.scene.start('PreloadScene');
    });
  }
}
