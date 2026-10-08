import Phaser from 'phaser';

export class XPGem extends Phaser.Physics.Arcade.Sprite {
  public xpAmount = 1;
  public tier = 0;
  public isDead = false;
  public bornAt = 0;
  public baseX = 0;
  public baseY = 0;

  constructor(scene: Phaser.Scene) {
    super(scene, 0, 0, 'xp_gem_0');
    scene.add.existing(this);
    scene.physics.add.existing(this);
    this.setActive(false).setVisible(false);
    this.setDepth(40);
  }

  setup(x: number, y: number, amount: number): void {
    let tier = 0;
    if (amount >= 10) tier = 3;
    else if (amount >= 5) tier = 2;
    else if (amount >= 2) tier = 1;

    this.xpAmount = amount;
    this.tier = tier;
    this.setTexture(`xp_gem_${tier}`);
    this.setPosition(x, y);
    this.baseX = x;
    this.baseY = y;
    this.setActive(true).setVisible(true);
    this.isDead = false;
    this.bornAt = this.scene.time.now;

    const body = this.body as Phaser.Physics.Arcade.Body;
    body.setCircle(4 + tier * 2, -(4 + tier * 2), -(4 + tier * 2));
    // kill() 会禁用 body,复用时必须重新启用。
    // 否则回池的灵液 body 一直是禁用的 —— setActive(false) 并不会禁用物理体,
    // 而 Phaser 会静默忽略对禁用 body 的 setVelocity,这颗灵液就永远不会被吸取。
    body.enable = true;
    body.setVelocity(0, 0);
  }

  kill(): void {
    this.isDead = true;
    this.setActive(false).setVisible(false);
    const body = this.body as Phaser.Physics.Arcade.Body;
    body.enable = false;
    body.setVelocity(0, 0);
  }
}
