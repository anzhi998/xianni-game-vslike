import Phaser from 'phaser';
import type { PickupKind } from '../types';

/**
 * 地面拾取物 —— 灵液 / 法宝 / 突破道具 三类共用一个池
 *
 * 为什么不新建第二个池:第二个池意味着第二套 overlap 注册和第二套磁吸循环,
 * 而 updatePickupMagnets() 已经能用了。改成一个带 kind 判别式的通用池。
 */
export class Pickup extends Phaser.Physics.Arcade.Sprite {
  public kind: PickupKind = 'xp';
  /** kind==='xp' 时为修为量 */
  public amount = 1;
  /** kind==='artifact' | 'keyItem' 时为 id */
  public payloadId = '';
  public isDead = false;
  public bornAt = 0;
  /** 存活时长(ms)。原 XPGem 永不过期,精英加入后这会致命 */
  public lifeMs = 25000;
  /** 上下浮动动画的基准 y */
  private baseY = 0;
  private bobPhase = 0;

  constructor(scene: Phaser.Scene) {
    super(scene, 0, 0, 'xp_gem_0');
    scene.add.existing(this);
    scene.physics.add.existing(this);
    this.setActive(false).setVisible(false);
    this.setDepth(40);
  }

  setup(x: number, y: number, kind: PickupKind, payload: number | string): void {
    this.kind = kind;

    let tier = 0;
    let radius = 4;

    if (kind === 'xp') {
      const amount = typeof payload === 'number' ? payload : 1;
      this.amount = amount;
      this.payloadId = '';
      if (amount >= 10) tier = 3;
      else if (amount >= 5) tier = 2;
      else if (amount >= 2) tier = 1;
      this.setTexture(`xp_gem_${tier}`);
      this.setDepth(40);
      this.lifeMs = 25000;
    } else if (kind === 'artifact') {
      this.amount = 0;
      this.payloadId = String(payload);
      this.setTexture('pickup_artifact');
      // 法宝比灵液显眼,也更值得玩家特意去捡
      this.setDepth(41);
      this.lifeMs = 40000;
    } else {
      this.amount = 0;
      this.payloadId = String(payload);
      this.setTexture('pickup_key');
      this.setDepth(41);
      this.lifeMs = 40000;
    }

    radius = kind === 'xp' ? 4 + tier * 2 : 9;

    this.setPosition(x, y);
    this.baseY = y;
    this.bobPhase = 0;
    this.setActive(true).setVisible(true);
    this.isDead = false;
    this.bornAt = this.scene.time.now;

    const body = this.body as Phaser.Physics.Arcade.Body;
    body.setCircle(radius, -radius, -radius);
    // kill() 会禁用 body,复用时必须重新启用,否则这颗灵液永远不会被吸取
    body.enable = true;
    body.setVelocity(0, 0);
  }

  preUpdate(time: number, delta: number): void {
    super.preUpdate(time, delta);
    if (!this.active) return;
    // 暂停期间不老化,否则玩家读升级面板时地面掉落会集体消失
    if (this.scene.physics.world.isPaused) return;

    if (time - this.bornAt > this.lifeMs) {
      this.kill();
      return;
    }

    // 非灵液掉落做上下浮动,让它们在乱战中更容易被注意到
    if (this.kind !== 'xp') {
      this.bobPhase += delta / 1000;
      this.y = this.baseY + Math.sin(this.bobPhase * 4) * 2;
    }
  }

  kill(): void {
    this.isDead = true;
    this.setActive(false).setVisible(false);
    const body = this.body as Phaser.Physics.Arcade.Body;
    body.enable = false;
    body.setVelocity(0, 0);
  }
}