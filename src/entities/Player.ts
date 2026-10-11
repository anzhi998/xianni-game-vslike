import Phaser from 'phaser';

/**
 * 四个朝向对应的纹理键。
 *
 * ⚠️ **左边不单列** —— `setFlipX` 是像素级镜像,单独画一张左边只会带来
 * 「两张图的手抖」这种差异。所以三个键 = 四个朝向。
 *
 * ⚠️ 与怪物不同:怪永远朝玩家,所以只需要两个朝向(本体 + 镜像);
 *    玩家自己跑四个方向,**朝不上就看不出自己在往哪走**,所以主角值得四视图。
 */
export const PLAYER_FACING_KEYS = {
  down: 'player_down',
  up: 'player_up',
  side: 'player_side',
} as const;

/** 缺图时的兜底键(等同旧的两视图做法:靠 setFlipX 表示左右) */
export const PLAYER_FALLBACK_KEY = 'player';

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
  /** 已解析出来的朝向:上 / 下 / 侧。侧向时靠 setFlipX 区分左右 */
  private facingDir: 'up' | 'down' | 'side' = 'down';
  /**
   * 实际贴上去的纹理键。
   *
   * 单独记一份是因为**降级结果要缓存**:每帧都去问 `textures.exists()`
   * 固然便宜,但更关键的是——四视图素材是逐步替换的,玩家只做了
   * `player_down` 就上线时,另外两个朝向不能变成空白方块。
   * 于是这里「按需解析一次并记住」,之后每帧只比字符串。
   */
  private appliedKey = PLAYER_FALLBACK_KEY;

  // 关联系统(由 GameScene 注入)
  public inputManager: any;

  constructor(scene: Phaser.Scene, x: number, y: number) {
    super(scene, x, y, PLAYER_FALLBACK_KEY);
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

  /**
   * 回血并广播事件。
   *
   * 单独一个方法而不是让调用方自己 emit:HUD 是拉取式的,只在事件里刷新,
   * 漏发一次事件的表现是「血条已经满了但数字还是旧的」。
   */
  healed(amount: number): void {
    if (amount <= 0) return;
    this.scene.events.emit('player-healed', this.health);
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
      // 斜向移动时取绝对值大的那个轴 —— 四个朝向里没有斜的
      const dir = Math.abs(dx) > Math.abs(dy) ? 'side' : dy >= 0 ? 'down' : 'up';
      if (dir !== this.facingDir) {
        this.facingDir = dir;
        this.appliedKey = this.resolveKey(dir);
        this.setTexture(this.appliedKey);
      }
      // 侧向才翻转。上下两向翻它没有意义(而且会让「背影」变成「正脸」的反面)
      this.setFlipX(dir === 'side' && dx < 0);
    }
  }

  /**
   * 取该朝向实际该用的纹理键,缺图就退到单张的 `player`。
   *
   * 退到 `player` 时**仍然要翻转**,那正是旧的两视图行为 —— 也就是说
   * 「只做了一张正面图」这个中间状态是可以玩的,而不是一个坏状态。
   */
  private resolveKey(dir: 'up' | 'down' | 'side'): string {
    const key = PLAYER_FACING_KEYS[dir];
    return this.scene.sys.textures.exists(key) ? key : PLAYER_FALLBACK_KEY;
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
