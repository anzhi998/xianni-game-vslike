import Phaser from 'phaser';
import { Enemy } from '../entities/Enemy';
import type { Player } from '../entities/Player';
import type { Pickup } from '../entities/Pickup';
import { ENEMIES } from '../config/EnemyConfig';
import type { Barrier } from '../entities/attacks/Barrier';
import type { DamageOptions } from '../types';
import { WORLD_WIDTH, WORLD_HEIGHT, viewRadius } from '../config/GameConfig';

/**
 * 逼近行为系统 ——《怪物设计》文档的脊椎
 *
 * 旧版把所有怪写成同一句话:「朝玩家直线飞」。文档的第一节说得很清楚:
 * 武器有覆盖形状,敌人有逼近形状,**两者错开的地方才是玩法** ——
 * 如果全场怪物只会直线冲脸,十四类神通立刻退化成「谁数字大」的算术题。
 * 所以这里有九种 approach,每种只负责一件事。
 *
 * 为什么是系统而不是 Enemy.preUpdate():
 * 物理步夹在 PRE_UPDATE 与 scene.update 之间。控制类实体(ScanField 冻结、
 * Attractor 牵引)在 PRE_UPDATE 写速度,本系统在 scene.update 里写速度给
 * 下一物理步 —— 两者各写各的、互不覆盖。把转向塞进 Enemy.preUpdate 会让
 * 「冻结/牵引是否生效」取决于更新列表里的插入顺序,太脆。
 *
 * 本系统还顺带管两件全局事务:
 *   - 普通怪远离即回收(文档:对齐原版),精英改为传回屏幕
 *   - 精英不可回收 ——「绕开精英继续跑」不成立
 */

/**
 * 下面三个半径都是**按屏幕调的**,所以它们以 `viewRadius()`(一屏的半对角线)
 * 为单位写,而不是写死像素 —— 镜头拉近(`CAMERA_ZOOM`)时必须跟着缩放,
 * 否则会出现「精英飘到屏幕外三倍远才被拽回来」这种只在画面边缘才看得见的偏差。
 *
 * 括号里是 zoom = 1 时的等价像素,留着是为了让配表的人认得出原来的手感。
 */
export const DESPAWN_RADIUS = (): number => viewRadius() * 2.20;      // 1600px
/** 精英超过这个距离不再追,改为传回屏幕 */
export const ELITE_LEASH_RADIUS = (): number => viewRadius() * 1.65;  // 1200px
/** 精英传回时落在玩家周围的环半径 */
const ELITE_RETURN_RADIUS = (): number => viewRadius() * 0.83;        // 600px
/** 引路尸把周围的怪拖到它身后的速度(px/s) */
const DRAG_SPEED = 130;

export interface EnemyAiDeps {
  getPlayer: () => Player;
  /** 对玩家结算一次伤害(内部走无敌帧,接触/敌弹/自爆共用) */
  damagePlayer: (amount: number, sx: number, sy: number) => void;
  /** 发一颗敌弹 */
  spawnShot: (x: number, y: number, angle: number, damage: number, speed: number) => void;
  /** 静默击杀(自爆用):不走伤害数字,但掉落/击杀数/亡语照常 */
  killEnemy: (enemy: Enemy) => void;
  /** 找离 (x,y) 最近的、半径内的地面掉落物(噬灵虫用) */
  findPickup: (x: number, y: number, radius: number) => Pickup | null;
  /** 吃掉一份掉落物:物主自己消失,玩家拿不到 —— 这正是噬灵虫的恶意 */
  eatPickup: (p: Pickup) => void;
  /** 爆炸特效(可选) */
  explodeFx?: (x: number, y: number, radius: number) => void;
  /** 对一只敌人结算伤害(点燃/流血的跳伤走这里,与其他伤害同一条链) */
  damageEnemy: (enemy: Enemy, amount: number, x: number, y: number, opts?: DamageOptions) => void;
  /** 首领的一次行动。由本系统在 boss 分支到点时回调 —— 它不掌握速度 */
  bossAction: (enemy: Enemy) => void;
}

export class EnemyAiSystem {
  private deps: EnemyAiDeps;
  private enemyPool: Phaser.GameObjects.Group;
  /** 崩墙。阻挡要在所有转向写完之后统一处理,所以由本系统代管 */
  private barriers: Phaser.GameObjects.Group;
  /**
   * 场上是否有遮天。
   * 每帧在遍历敌人时顺带算出来,交给 GameScene 决定暗角要不要亮 ——
   * 让 GameScene 自己去扫一遍全场敌人只为问这一个问题,是浪费
   */
  public veilActive = false;

  constructor(
    enemyPool: Phaser.GameObjects.Group,
    barriers: Phaser.GameObjects.Group,
    deps: EnemyAiDeps,
  ) {
    this.enemyPool = enemyPool;
    this.barriers = barriers;
    this.deps = deps;
  }

  update(time: number, delta: number): void {
    const player = this.deps.getPlayer();
    const px = player.x;
    const py = player.y;
    const children = this.enemyPool.getChildren();
    this.veilActive = false;

    // 第一遍:个体移动与动作。
    // 索引循环而不是 for..of:自爆/分裂会在遍历途中往池里补对象,
    // 索引循环不会因为数组变长而抛错,也不会跳过任何一只
    for (let i = 0; i < children.length; i++) {
      const e = children[i] as Enemy;
      if (!e || !e.active || e.isDead) continue;
      if (ENEMIES[e.enemyKey]?.mechanism?.vignette) this.veilActive = true;

      this.cullOrReturn(e, px, py);
      if (!e.active || e.isDead) continue;

      this.steer(e, player, px, py, time);
      // 状态覆写在 steer 之后统一做,而不是塞进每个 approach:
      // 减速乘的是「它自己想往哪走」,击退加在「它实际去哪」——
      // 两者的顺序反了就会出现「被推着走却因为减速而推不动」
      this.applyStatusMotion(e, time);
    }

    // 第二遍:场效应(引路尸的拖拽、崩墙的阻挡、点燃的跳伤)。
    // ⚠️ 必须单独一遍、且在所有转向写完之后 —— 拖拽与击退都是**叠加**而不是覆盖。
    // 混在第一遍里的话,只要被拖的邻居排在数组后面,它的 chase() 就会把
    // 拖拽量整份盖掉,表现成「引路尸有时灵有时不灵」这种极难查的 bug
    for (let i = 0; i < children.length; i++) {
      const e = children[i] as Enemy;
      if (!e || !e.active || e.isDead) continue;
      this.applyDrag(e, px, py);
      this.tickBurn(e, time, delta);
      this.applyBarriers(e, time);
    }
  }

  /**
   * 减速 / 击退 / 眩晕的统一结算。
   *
   * 顺序是 v = 转向 ×(1-减速) + 击退偏移 + 牵引偏移,眩晕则整份清零。
   * 这个顺序不能改:击退是「外力」,应该跑在减速后面 —— 否则一只被推的怪
   * 会在推力最大时因为减速而几乎不动,厚土术看起来就成了无伤害。
   *
   * ⚠️ 击退与牵引**必须分开两组字段、相加**:设计书把这两条路线写成
   *    互相反制(一个聚一个散),相加才是「抵消」,共用字段就是「谁后出手谁赢」。
   */
  private applyStatusMotion(e: Enemy, now: number): void {
    const body = e.body as Phaser.Physics.Arcade.Body;
    let vx = body.velocity.x;
    let vy = body.velocity.y;

    if (now < e.slowUntil) vx *= 1 - Math.min(0.6, e.slowMul);
    if (now < e.slowUntil) vy *= 1 - Math.min(0.6, e.slowMul);

    if (now < e.stunnedUntil) {
      vx = 0;
      vy = 0;
    } else {
      if (now < e.knockUntil) {
        vx += e.knockX;
        vy += e.knockY;
      } else {
        // 到期就清零。留着不清会让一次旧击退在下次 applyKnock 之前一直挂着
        e.knockX = 0;
        e.knockY = 0;
      }
      if (now < e.pullUntil) {
        vx += e.pullX;
        vy += e.pullY;
      } else {
        e.pullX = 0;
        e.pullY = 0;
      }
    }
    body.setVelocity(vx, vy);
  }

  /** 点燃 / 流血的跳伤。累积后整点扣血,避免每帧调用伤害入口 */
  private tickBurn(e: Enemy, now: number, delta: number): void {
    if (now >= e.burnUntil || e.burnDps <= 0) {
      e.burnDps = 0;
      e.burnAccum = 0;
      return;
    }
    e.burnAccum += e.burnDps * (delta / 1000);
    while (e.burnAccum >= 1) {
      e.burnAccum -= 1;
      if (!e.active || e.isDead) return;
      this.deps.damageEnemy(e, 1, e.x, e.y - 8, { sourceId: e.burnSource || undefined });
    }
  }

  /** 崩墙阻挡。逐面墙试,墙池很小(3 个)所以不必建空间索引 */
  private applyBarriers(e: Enemy, now: number): void {
    const walls = this.barriers.getChildren();
    for (let i = 0; i < walls.length; i++) {
      const w = walls[i] as Barrier;
      if (!w.active || w.isDead) continue;
      if (w.block(e, now)) return;
    }
  }

  /**
   * 远离回收 / 精英传回。
   *
   * 文档对齐了原版的两条:普通怪离远即 despawn(敌人是有限资源,
   * 否则玩家一路后退就能赢)、精英不 despawn 而是传回屏幕
   * (「绕开精英继续跑」因此不成立)。
   */
  private cullOrReturn(e: Enemy, px: number, py: number): void {
    const dx = e.x - px;
    const dy = e.y - py;
    const d2 = dx * dx + dy * dy;

    // 首领与精英同样不回收:玩家可以绕着 Boss 跑圈拉扯,那正是战斗的一部分
    if (e.isElite || e.bossKey) {
      const leash = ELITE_LEASH_RADIUS();
      if (d2 <= leash * leash) return;
      // 沿「玩家 → 精英」的方向放到玩家周围的一圈处,并钳进世界边界。
      // 用当前方向而不是随机角度:玩家能预期它从原来那一侧回来
      const len = Math.sqrt(d2) || 1;
      const ring = ELITE_RETURN_RADIUS();
      const nx = Phaser.Math.Clamp(px + (dx / len) * ring, 40, WORLD_WIDTH - 40);
      const ny = Phaser.Math.Clamp(py + (dy / len) * ring, 40, WORLD_HEIGHT - 40);
      // body.reset 而不是 setPosition:前者同时同步刚体位置并清掉位移增量,
      // 后者只动精灵,刚体要等 postUpdate 才跟上 —— 那一帧的重叠判定会用旧坐标
      (e.body as Phaser.Physics.Arcade.Body).reset(nx, ny);
      return;
    }

    const despawn = DESPAWN_RADIUS();
    if (d2 > despawn * despawn) {
      e.kill();
    }
  }

  private steer(e: Enemy, player: Player, px: number, py: number, time: number): void {
    switch (e.approach) {
      case 'ranged':
        this.ranged(e, px, py, time);
        break;
      // 首领的召唤物(剑肖十二子)—— 行为就是「远程点射」,与 ranged 完全一致。
      // 单列一个 approach 不是为了给它不同的 AI,而是为了把它**排除在常规刷怪表外**
      // (见 WaveConfig 的可达性自检):它只该由 boss 的 summon 招召出,
      // 平时波次里刷出来就变成了一只没有来历的普通怪。
      case 'summon':
        this.ranged(e, px, py, time);
        break;
      case 'flank':
        this.flank(e, px, py, time);
        break;
      case 'charger':
        this.charger(e, px, py, time);
        break;
      case 'puller':
        this.puller(e, player, px, py);
        break;
      case 'bomber':
        this.bomber(e, px, py, time);
        break;
      case 'gemEater':
        this.gemEater(e, px, py);
        break;
      case 'hexer':
        this.hexer(e, px, py, time);
        break;
      case 'boss':
        this.bossSteer(e, px, py, time);
        break;
      case 'shepherd':
        // 引路尸的移动就是「缓慢靠近」,它的本事在第二遍的拖拽里
        this.chase(e, px, py);
        break;
      // chase / advance / stealth / splitter:都是直线追。
      // 它们的差别不在移动逻辑,而在数值(坦克慢而厚)、生成方式(潜行)
      // 与死亡后果(衍体)—— 硬给它们编不同的转向只会让手感变脏
      default:
        this.chase(e, px, py);
        break;
    }
  }

  /**
   * 首领 —— 移动与普通怪无异,只是到了出招时刻就把决策交给 BossSystem。
   *
   * 刻意不写「首领专属移动」:它一旦有了自己的转向,平衡就会分裂成两套,
   * 而 Boss 的压迫感本来就该来自**招式**,不是来自它跑得更快。
   */
  private bossSteer(e: Enemy, px: number, py: number, time: number): void {
    this.chase(e, px, py);
    if (time >= e.bossNextActionAt) this.deps.bossAction(e);
  }

  /** 直线冲脸 —— 群怪、坦克、潜行、衍体的共同底座 */
  private chase(e: Enemy, px: number, py: number): void {
    const dx = px - e.x;
    const dy = py - e.y;
    const len = Math.sqrt(dx * dx + dy * dy) || 1;
    const body = e.body as Phaser.Physics.Arcade.Body;
    body.setVelocity((dx / len) * e.speed, (dy / len) * e.speed);
    e.setFlipX(dx < 0);
  }

  /** 该开火了吗?开火间隔做 ±20% 抖动,免得整群术修齐射成一面弹幕墙 */
  private tryFire(e: Enemy, px: number, py: number, time: number): void {
    if (time < e.frozenUntil) return; // 定身也定住动作,不只是移动
    const cfg = ENEMIES[e.enemyKey];
    const interval = cfg.fireIntervalMs ?? 2200;
    if (time < e.nextShotAt) return;
    e.nextShotAt = time + interval * (0.8 + Math.random() * 0.4);

    const dx = px - e.x;
    const dy = py - e.y;
    const angle = Math.atan2(dy, dx);
    // 弹伤取 Enemy.shotDamage —— 它已经在 setup 里乘过时间难度与精英倍率
    this.deps.spawnShot(e.x, e.y, angle, e.shotDamage, cfg.shotSpeed ?? 220);
  }

  /**
   * 远程驻停 —— 术修。
   * 「保持距离,隔空放法」:太近就退,太远就进,窗口内停住开火。
   * 它制造的是方向 —— 玩家必须朝它前进,不能原地磨。
   */
  private ranged(e: Enemy, px: number, py: number, time: number): void {
    const cfg = ENEMIES[e.enemyKey];
    const range = cfg.attackRange ?? 260;
    const dx = px - e.x;
    const dy = py - e.y;
    const dist = Math.sqrt(dx * dx + dy * dy) || 1;
    const body = e.body as Phaser.Physics.Arcade.Body;

    if (dist > range) {
      body.setVelocity((dx / dist) * e.speed, (dy / dist) * e.speed);
    } else if (dist < range * 0.62) {
      // 后撤比前进慢一点,否则玩家永远追不上它
      body.setVelocity((-dx / dist) * e.speed * 0.8, (-dy / dist) * e.speed * 0.8);
    } else {
      body.setVelocity(0, 0);
    }
    e.setFlipX(dx < 0);

    if (dist <= range * 1.2) {
      this.tryFire(e, px, py, time);
    }
  }

  /**
   * 环绕包抄 —— 魔道修士阵。
   * 先接近到 flankRadius,然后沿切向绕行,从侧后合围。
   * 「单方向输出不够用了」是这一段要教的事。
   */
  private flank(e: Enemy, px: number, py: number, time: number): void {
    const cfg = ENEMIES[e.enemyKey];
    const r = cfg.flankRadius ?? 240;
    const dx = px - e.x;
    const dy = py - e.y;
    const dist = Math.sqrt(dx * dx + dy * dy) || 1;
    const body = e.body as Phaser.Physics.Arcade.Body;

    if (dist > r * 1.2) {
      body.setVelocity((dx / dist) * e.speed, (dy / dist) * e.speed);
    } else {
      // 切向 + 径向修正:切向负责「绕」,径向负责「维持半径」
      const tx = -dy / dist;
      const ty = dx / dist;
      const radial = (dist - r) / r; // >0 太远、<0 太近
      const vx = tx * e.flankDir + (dx / dist) * Phaser.Math.Clamp(radial, -1, 1);
      const vy = ty * e.flankDir + (dy / dist) * Phaser.Math.Clamp(radial, -1, 1);
      const len = Math.sqrt(vx * vx + vy * vy) || 1;
      body.setVelocity((vx / len) * e.speed, (vy / len) * e.speed);
    }
    e.setFlipX(dx < 0);

    if (dist <= r * 1.6) {
      this.tryFire(e, px, py, time);
    }
  }

  /**
   * 冲锋突刺 —— 上古凶兽。
   *
   * 状态机:approach → windup(停住蓄力,闪黄 = 玩家唯一的反应窗口)
   * → dash(锁定方向突进,期间不转向,所以走位能躲) → recover(冷却)。
   * 全部是时间戳字段,不用 tween —— 池化对象带 tween 会跨存活期。
   */
  private charger(e: Enemy, px: number, py: number, time: number): void {
    const cfg = ENEMIES[e.enemyKey];
    const charge = cfg.charge;
    const body = e.body as Phaser.Physics.Arcade.Body;
    if (!charge) {
      this.chase(e, px, py);
      return;
    }

    const dx = px - e.x;
    const dy = py - e.y;
    e.setFlipX(dx < 0);

    // 被定身时整个状态机停摆 —— 否则一只被冻住的凶兽仍会冲出去
    if (time < e.frozenUntil) {
      body.setVelocity(0, 0);
      return;
    }

    switch (e.chargeState) {
      case 'approach':
        if (time >= e.nextChargeAt) {
          e.chargeState = 'windup';
          e.chargePhaseEndsAt = time + charge.windupMs;
          e.setTell(true);
          body.setVelocity(0, 0);
          return;
        }
        this.chase(e, px, py);
        return;

      case 'windup':
        body.setVelocity(0, 0);
        if (time >= e.chargePhaseEndsAt) {
          // 方向在这一刻锁定 —— 之后玩家横向拉开就能躲,这是「可被走位破解」的关键
          e.dashAngle = Math.atan2(dy, dx);
          e.chargeState = 'dash';
          e.chargePhaseEndsAt = time + charge.dashMs;
          e.setTell(false);
        }
        return;

      case 'dash':
        body.setVelocity(
          Math.cos(e.dashAngle) * e.speed * charge.dashSpeedMul,
          Math.sin(e.dashAngle) * e.speed * charge.dashSpeedMul,
        );
        if (time >= e.chargePhaseEndsAt) {
          e.chargeState = 'recover';
          e.chargePhaseEndsAt = time + 320;
        }
        return;

      case 'recover':
        body.setVelocity(0, 0);
        if (time >= e.chargePhaseEndsAt) {
          e.chargeState = 'approach';
          e.nextChargeAt = time + charge.cooldownMs;
        }
        return;
    }
  }

  /**
   * 拉拽牵引 —— 界外之魂。
   * 把玩家往外拖,夺走站位的主动权。写在 scene.update 里意味着
   * GameScene 刚写完玩家速度,这里的叠加立刻生效。
   */
  private puller(e: Enemy, player: Player, px: number, py: number): void {
    this.chase(e, px, py);

    const cfg = ENEMIES[e.enemyKey];
    const radius = cfg.pullRadius ?? 240;
    const pullSpeed = cfg.pullSpeed ?? 240;
    const dx = e.x - px;
    const dy = e.y - py;
    const dist = Math.sqrt(dx * dx + dy * dy) || 1;
    if (dist > radius) return;

    // 线性衰减:边缘几乎无感,越近拖得越狠 —— 与引力术同一套手感。
    // 叠加的是速度偏移(px/s)而不是加速度×dt:玩家速度在本帧早些时候刚被
    // GameScene 写死,这里的叠加会随下一次物理步整体生效,不需要再乘 dt
    const falloff = 1 - dist / radius;
    const body = player.body as Phaser.Physics.Arcade.Body;
    body.velocity.x += (dx / dist) * pullSpeed * falloff;
    body.velocity.y += (dy / dist) * pullSpeed * falloff;
  }

  /**
   * 逼近自爆 —— 火灵。
   * 「贴近即爆、不需要出手」:它把「不让它靠近」变成一种输出需求。
   * 自爆走静默击杀入口,所以掉落、击杀数、亡语(如果它有)全都照常结算 ——
   * 只是不弹一个「自己掉多少血」的伤害数字。
   */
  private bomber(e: Enemy, px: number, py: number, time: number): void {
    const cfg = ENEMIES[e.enemyKey];
    const radius = cfg.explodeRadius ?? 40;
    const dx = px - e.x;
    const dy = py - e.y;
    const dist = Math.sqrt(dx * dx + dy * dy) || 1;

    // 被定身的火灵仍会靠近,但引信点不着 —— 定身是它唯一的解法之一
    if (dist > radius || time < e.frozenUntil) {
      this.chase(e, px, py);
      // 引信提示:进入两倍起爆半径就开始闪,给玩家一个「别让它贴上来」的读数
      e.setTell(dist <= radius * 2);
      return;
    }

    e.setTell(false);
    this.deps.damagePlayer(cfg.explodeDamage ?? 20, e.x, e.y);
    this.deps.explodeFx?.(e.x, e.y, radius);
    this.deps.killEnemy(e);
  }

  /**
   * 噬灵虫 —— 爬向地上的灵石并吃掉,每吃一份永久强化自身。
   *
   * 它给「攒着不捡、等磁铁成型再扫图」这条技巧加上对价:
   * 你把修为攒在地上,它替你收,而且收进自己肚子里。
   */
  private gemEater(e: Enemy, px: number, py: number): void {
    const mech = ENEMIES[e.enemyKey].mechanism;
    const radius = mech?.eatRadius ?? 380;
    const target = this.deps.findPickup(e.x, e.y, radius);
    if (!target) {
      this.chase(e, px, py);
      return;
    }

    const dx = target.x - e.x;
    const dy = target.y - e.y;
    const dist = Math.sqrt(dx * dx + dy * dy) || 1;
    if (dist < 14) {
      this.deps.eatPickup(target);
      e.eatGrow(mech?.eatHpGain ?? 0.25, mech?.eatSpeedGain ?? 6);
      return;
    }
    const body = e.body as Phaser.Physics.Arcade.Body;
    body.setVelocity((dx / dist) * e.speed, (dy / dist) * e.speed);
    e.setFlipX(dx < 0);
  }

  /**
   * 寄魂 —— 定期附身附近一只普通怪,使其等级与体型同时翻倍。
   *
   * 它制造的是「必须先点掉的那一只」:在密集怪堆里给单体输出一个存在理由。
   * 附身对象刻意排除精英与其它机制怪 —— 文档说的是「附身到普通怪身上」,
   * 而且让精英再翻倍会直接构成必死局
   */
  private hexer(e: Enemy, px: number, py: number, time: number): void {
    this.chase(e, px, py);

    const mech = ENEMIES[e.enemyKey].mechanism;
    if (time < e.nextHexAt) return;
    e.nextHexAt = time + (mech?.hexIntervalMs ?? 3200);

    const radius = mech?.hexRadius ?? 320;
    const children = this.enemyPool.getChildren();
    let best: Enemy | null = null;
    let bestD2 = radius * radius;
    for (let i = 0; i < children.length; i++) {
      const t = children[i] as Enemy;
      if (!t || !t.active || t.isDead || t === e) continue;
      if (t.isElite || t.possessed) continue;
      // 首领绝不被附身 —— 倍血倍速的首领会直接把一场设计好的 Boss 战变成数值题
      if (t.bossKey) continue;
      if (ENEMIES[t.enemyKey]?.mechanism) continue;
      const dx = t.x - e.x;
      const dy = t.y - e.y;
      const d2 = dx * dx + dy * dy;
      if (d2 < bestD2) { bestD2 = d2; best = t; }
    }
    best?.applyPossession();
  }

  /**
   * 引路尸的拖拽(第二遍)。
   *
   * 目标点是**它身后**(远离玩家的一侧):怪堆在它后面排成一堵墙,
   * 本来开阔的地图会突然只剩一个方向可走。拖拽量是速度偏移,不是加速度,
   * 理由同 puller —— 每个敌人的速度下一帧都会被整份重写
   */
  private applyDrag(e: Enemy, px: number, py: number): void {
    const radius = ENEMIES[e.enemyKey]?.mechanism?.dragRadius;
    if (!radius) return;

    const dx = e.x - px;
    const dy = e.y - py;
    const len = Math.sqrt(dx * dx + dy * dy) || 1;
    const behindX = e.x + (dx / len) * 44;
    const behindY = e.y + (dy / len) * 44;

    const children = this.enemyPool.getChildren();
    for (let i = 0; i < children.length; i++) {
      const other = children[i] as Enemy;
      if (!other || !other.active || other.isDead || other === e) continue;
      // 机制怪之间互不拖拽:两只引路尸互相拉扯会原地打转,看起来像卡住了
      if (ENEMIES[other.enemyKey]?.mechanism) continue;
      if (other.isElite) continue; // 精英不受走廊调度

      const ox = behindX - other.x;
      const oy = behindY - other.y;
      const d2 = ox * ox + oy * oy;
      if (d2 > radius * radius) continue;
      const d = Math.sqrt(d2) || 1;

      const body = other.body as Phaser.Physics.Arcade.Body;
      body.velocity.x += (ox / d) * DRAG_SPEED;
      body.velocity.y += (oy / d) * DRAG_SPEED;
    }
  }
}
