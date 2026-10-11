import Phaser from 'phaser';
import { FireVent } from '../entities/Hazards/FireVent';
import type { HazardDef } from '../config/MapConfig';
import type { Player } from '../entities/Player';

/**
 * 环境机制系统 —— 地图给玩家的那个「增益或干扰」
 *
 * 目前只实现「灵脉地热」这一种形态(kind: 'vent'):
 * 定时在玩家附近随机地点喷发火柱,先给预警圈。
 *
 * 落点分布刻意覆盖玩家所在的位置附近而不是四周远处:
 * 环境机制要逼的是**站位选择**(往怪群里走还是往空地走),
 * 如果火柱总落在屏幕边缘,玩家学会的只是「往中间躲」,那不叫机制。
 */
export class HazardSystem {
  private scene: Phaser.Scene;
  private vents: Phaser.GameObjects.Group;
  private def: HazardDef | null;
  private getPlayer: () => Player;

  /** 每轮喷发的火柱数 */
  private static readonly VENTS_PER_BURST = 2;
  /** 落点到玩家的距离区间(像素)。下限小于一屏半径,意味着「可能直接喷在脚下」 */
  private static readonly MIN_DIST = 120;
  private static readonly MAX_DIST = 460;

  private nextAtSec = 3;

  constructor(
    scene: Phaser.Scene,
    pool: Phaser.GameObjects.Group,
    def: HazardDef | null,
    getPlayer: () => Player,
    damagePlayer: (amount: number, x: number, y: number) => void,
  ) {
    this.scene = scene;
    this.vents = pool;
    this.def = def;
    this.getPlayer = getPlayer;
    for (const v of pool.getChildren()) {
      const vent = v as FireVent;
      vent.bind(getPlayer, damagePlayer);
    }
  }

  get hazardName(): string {
    return this.def?.name ?? '无';
  }

  /** 手动喷发一次。调试面板用 —— 与定时器共用同一条路径 */
  forceBurst(): number {
    if (!this.def) return 0;
    return this.burst();
  }

  update(seconds: number): void {
    if (!this.def) return;
    if (seconds < this.nextAtSec) return;
    this.nextAtSec = seconds + this.def.intervalSec;
    this.burst();
  }

  private burst(): number {
    const def = this.def;
    if (!def) return 0;
    const player = this.getPlayer();
    let made = 0;
    for (let i = 0; i < HazardSystem.VENTS_PER_BURST; i++) {
      const vent = this.vents.get() as FireVent;
      // 池耗尽就少喷一根:环境机制是压力,不是伤害承诺
      if (!vent) break;
      const a = Math.random() * Math.PI * 2;
      const d = HazardSystem.MIN_DIST + Math.random() * (HazardSystem.MAX_DIST - HazardSystem.MIN_DIST);
      vent.setup(
        player.x + Math.cos(a) * d,
        player.y + Math.sin(a) * d,
        def.radius, def.warnSec * 1000, def.eruptSec * 1000,
        def.tickMs, def.damage, def.color,
      );
      made++;
    }
    if (made > 0) {
      this.scene.events.emit('hazard-erupted', player.x, player.y);
    }
    return made;
  }
}