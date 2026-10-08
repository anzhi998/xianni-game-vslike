import Phaser from 'phaser';

export class Player extends Phaser.Physics.Arcade.Sprite {
  // 战斗属性
  public maxHealth = 100;
  public health = 100;
  public baseMoveSpeed = 180;
  public pickupRange = 70;
  public damageMul = 1;
  public cooldownMul = 1;
  public projectileAdd = 0;
  public projectileSpeedMul = 1;
  public areaMul = 1;
  public pierceAdd = 0;
  public moveSpeedMul = 1;
  public pickupMul = 1;
  public healthRegen = 0;

  // 状态
  public invincibleUntil = 0;
  public hpRegenAccumulator = 0;
  public flashUntil = 0;
  public lastDamageDir = new Phaser.Math.Vector2(0, 0);
  public facingX = 0;
  public facingY = 1;

  // 关联系统(由 GameScene 注入)
  public inputManager: any;

  constructor(scene: Phaser.Scene, x: number, y: number) {
    super(scene, x, y, 'player');
    scene.add.existing(this);
    scene.physics.add.existing(this);

    this.setOrigin(0.5, 0.75);
    // 只设 body 尺寸,不要手写 setOffset。
    // setSize 的 center 参数默认 true,会把碰撞盒对齐到精灵中心;
    // 再叠一句 setOffset(-5,-6) 会把它推到精灵上方,导致碰撞盒与外观错位。
    this.setBodySize(10, 12, true);
    this.setDepth(100);
  }

  takeDamage(amount: number, sourceX: number, sourceY: number, now: number): boolean {
    if (now < this.invincibleUntil) return false;
    this.health = Math.max(0, this.health - amount);
    this.invincibleUntil = now + 600;
    this.flashUntil = now + 200;
    this.lastDamageDir.set(this.x - sourceX, this.y - sourceY).normalize();
    return true;
  }

  heal(amount: number): void {
    this.health = Math.min(this.maxHealth, this.health + amount);
  }

  isDead(): boolean {
    return this.health <= 0;
  }

  getMoveSpeed(): number {
    return this.baseMoveSpeed * this.moveSpeedMul;
  }

  getPickupRange(): number {
    return this.pickupRange * this.pickupMul;
  }

  updateFacing(dx: number, dy: number): void {
    if (Math.abs(dx) > 0.01 || Math.abs(dy) > 0.01) {
      this.facingX = dx;
      this.facingY = dy;
    }
  }

  preUpdate(time: number, delta: number): void {
    super.preUpdate(time, delta);
    // pauseGame() 只冻结 physics world,而 preUpdate 由 scene 的 UPDATE 事件驱动、
    // 不受 physics 影响。若不拦截,挂着「生机」在升级面板上挂机即可白嫖回血。
    if (this.scene.physics.world.isPaused) return;
    // 闪白
    if (this.scene && this.active) {
      if (time < this.flashUntil) {
        this.setTintFill(0xffffff);
      } else {
        this.clearTint();
      }
    }
    // 生命回复
    if (this.healthRegen > 0 && !this.isDead()) {
      this.hpRegenAccumulator += this.healthRegen * (delta / 1000);
      if (this.hpRegenAccumulator >= 1) {
        const inc = Math.floor(this.hpRegenAccumulator);
        this.heal(inc);
        this.hpRegenAccumulator -= inc;
      }
    }
  }
}
