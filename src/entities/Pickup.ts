import Phaser from 'phaser';
import type { PickupKind } from '../types';

/** 每类掉落物的外观与寿命。集中一处,加新种类只改这张表 */
interface PickupVisual {
  /** 纹理键;'tier' 表示按修为量分档 */
  texture: string | 'tier';
  /** 碰撞圆半径(px) */
  radius: number;
  depth: number;
  lifeMs: number;
  /** 是否做上下浮动 —— 灵液量大不需要,稀有的东西要显眼 */
  bob: boolean;
}

const VISUALS: Record<PickupKind, PickupVisual> = {
  // 灵液:按量分四档,最小的档位也够显眼
  xp:        { texture: 'tier',            radius: 0, depth: 40, lifeMs: 25000, bob: false },
  // 遗物比灵液显眼,也更值得玩家特意去捡
  relic:     { texture: 'pickup_relic',    radius: 9, depth: 41, lifeMs: 40000, bob: true  },
  // 回血/加修为丹药:精英掉落,数量最多,寿命略短以免地面越堆越多
  heal:      { texture: 'pickup_heal',     radius: 8, depth: 41, lifeMs: 30000, bob: true  },
  xpPill:    { texture: 'pickup_xp_pill',  radius: 8, depth: 41, lifeMs: 30000, bob: true  },
  // 秘境宝匣:全场最稀有的掉落,给最显眼的光柱感与最长寿命 ——
  // 它值得玩家为了捡它而改变走位
  chest:     { texture: 'pickup_chest_wood', radius: 12, depth: 42, lifeMs: 60000, bob: true },
  // 幻饵 / 伪宝匣:机制怪的地面形态。它们的外观**故意**与真货完全一致 ——
  // 那正是它们唯一的武器。给一张不同的贴图等于把机制作废
  bait:      { texture: 'xp_gem_1',        radius: 5,  depth: 40, lifeMs: 45000, bob: false },
  // 伪宝匣抄的是**金匮**的长相 —— 它挑的是件好东西来骗你
  mimic:     { texture: 'pickup_chest_gold', radius: 12, depth: 42, lifeMs: 60000, bob: true },
};

/** 灵液按修为量分档,决定用哪张纹理 */
function xpTier(amount: number): number {
  if (amount >= 10) return 3;
  if (amount >= 5) return 2;
  if (amount >= 2) return 1;
  return 0;
}

/**
 * 地面拾取物 —— 灵液 / 法宝 / 突破道具 / 回血丹药 / 加修为丹药,五类共用一个池
 *
 * 为什么不新建第二个池:第二个池意味着第二套 overlap 注册和第二套磁吸循环,
 * 而 updatePickupMagnets() 已经能用了。改成一个带 kind 判别式的通用池。
 */
export class Pickup extends Phaser.Physics.Arcade.Sprite {
  public kind: PickupKind = 'xp';
  /** kind==='xp' 时为修为量 */
  public amount = 1;
  /** kind==='relic' 时为遗物 id */
  public payloadId = '';
  public isDead = false;
  public bornAt = 0;
  /** 存活时长(ms)。掉落物必须过期 —— 精英遍地走之后,地上的东西会无限堆积 */
  public lifeMs = 25000;
  /** 上下浮动动画的基准 y */
  private baseY = 0;
  private bobPhase = 0;
  /** 本次是否做浮动(由 VISUALS 决定) */
  private bob = false;

  constructor(scene: Phaser.Scene) {
    super(scene, 0, 0, 'xp_gem_0');
    scene.add.existing(this);
    scene.physics.add.existing(this);
    this.setActive(false).setVisible(false);
    this.setDepth(40);
  }

  setup(x: number, y: number, kind: PickupKind, payload: number | string): void {
    this.kind = kind;
    const vis = VISUALS[kind];
    const tier = kind === 'xp' ? xpTier(typeof payload === 'number' ? payload : 1) : 0;
    const radius = kind === 'xp' ? 4 + tier * 2 : vis.radius;

    if (kind === 'xp') {
      this.amount = typeof payload === 'number' ? payload : 1;
      this.payloadId = '';
    } else if (kind === 'relic') {
      this.amount = 0;
      this.payloadId = String(payload);
    } else if (kind === 'chest') {
      // 宝箱的品质(wood/jade/gold)决定开几次悟道 —— 它必须随掉落物一起
      // 躺在地上,而不是在拾取时才决定:木匣与金匮掉在地上是同一个外观,
      // 但玩家该能通过别的方式知道它值多少(见 BossConfig 的掉落表)
      this.amount = 0;
      this.payloadId = typeof payload === 'string' && payload ? payload : 'wood';
    } else {
      // heal / xpPill 的实际数值在拾取时按玩家当时状态计算(见 GameScene.grantPickup)
      this.amount = 0;
      this.payloadId = '';
    }

    this.setTexture(kind === 'xp'
      ? `xp_gem_${tier}`
      : kind === 'relic'
        // 每件遗物一张贴图,按 config 的配色上色 —— 地面掉落物因此可辨。
        // 兜底到通用贴图:配置新增遗物而忘了生成贴图时,不会退化成无贴图的裸 Sprite
        ? this.pickTexture(`pickup_relic_${this.payloadId}`, vis.texture as string)
        // 真宝箱按品质换贴图。伪宝匣走 VISUALS 的固定贴图,不受这条影响 ——
        // 它必须永远长得像金匮,否则它唯一的武器就作废了
        : kind === 'chest'
          ? this.pickTexture(`pickup_chest_${this.payloadId}`, 'pickup_chest')
          : (vis.texture as string));
    this.setDepth(vis.depth);
    this.setAlpha(1);
    this.lifeMs = vis.lifeMs;
    this.bob = vis.bob;

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

  /** 专用贴图不存在时退回通用贴图,避免 setTexture 拿到一个不存在的 key */
  private pickTexture(specific: string, fallback: string): string {
    return this.scene.textures.exists(specific) ? specific : fallback;
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

    // 稀有掉落做上下浮动,让它们在乱战中更容易被注意到
    if (this.bob) {
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