import Phaser from 'phaser';

export class DamageText extends Phaser.GameObjects.Text {
  public isDead = false;
  public bornAt = 0;
  public lifeMs = 900;
  public vy = -40;

  constructor(scene: Phaser.Scene) {
    super(scene, 0, 0, '0', {
      fontFamily: 'monospace',
      fontSize: '14px',
      color: '#ffffff',
      fontStyle: 'bold',
      stroke: '#000000',
      strokeThickness: 3,
    });
    this.setActive(false).setVisible(false);
    this.setDepth(150);
    this.setOrigin(0.5);
  }

  setup(x: number, y: number, value: number, color = '#ffffff', crit = false): void {
    this.setPosition(x, y);
    this.setText(String(value));
    this.setColor(color);
    if (crit) {
      this.setFontSize(20);
    } else {
      this.setFontSize(14);
    }
    this.setActive(true).setVisible(true);
    this.isDead = false;
    this.bornAt = this.scene.time.now;
    this.vy = -40 - (crit ? 20 : 0);
    this.setAlpha(1);
    this.setScale(crit ? 1.4 : 1);
  }

  preUpdate(time: number, delta: number): void {
    if (!this.active) return;
    this.y += this.vy * (delta / 1000);
    this.vy += 30 * (delta / 1000);
    const age = time - this.bornAt;
    if (age > this.lifeMs) {
      this.isDead = true;
      this.setActive(false).setVisible(false);
    } else if (age > this.lifeMs * 0.6) {
      this.setAlpha(1 - (age - this.lifeMs * 0.6) / (this.lifeMs * 0.4));
    }
  }

  kill(): void {
    this.isDead = true;
    this.setActive(false).setVisible(false);
  }
}
