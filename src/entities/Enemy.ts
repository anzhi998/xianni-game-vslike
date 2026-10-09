import Phaser from 'phaser';
import { ENEMIES, REALM_HP_SCALE } from '../config/EnemyConfig';
import { rollEliteDrops } from '../config/EliteConfig';
import { NORMAL_MUTATION } from '../types';
import type { Approach, DropEntry, EnemyArchetype, EnemyMutation } from '../types';

export class Enemy extends Phaser.Physics.Arcade.Sprite {
  public maxHealth = 10;
  public health = 10;
  public speed = 60;
  public contactDamage = 5;
  public xpValue = 1;
  public enemyKey = 'beast';
  public flashUntil = 0;
  public isDead = false;

  // ---- 逼近几何(怪物设计文档第一节)----
  public approach: Approach = 'chase';
  public archetype: EnemyArchetype = 'horde';
  /** 抗性:天生(配置)与精英掷骰合并后的结果 */
  public resistPull = false;
  public resistFreeze = false;

  // ---- 行为状态:全部是 setup() 必须复位的数值字段 ----
  /** 冲锋状态机(charger 专用) */
  public chargeState: 'approach' | 'windup' | 'dash' | 'recover' = 'approach';
  public chargePhaseEndsAt = 0;
  public nextChargeAt = 0;
  /** 蓄力结束时锁定的突进方向 */
  public dashAngle = 0;
  /** 下一次开火时刻(ms),ranged / flank 共用 */
  public nextShotAt = 0;
  /** 下一次附身时刻(ms),寄魂专用 */
  public nextHexAt = 0;
  /** 环绕方向(+1 / -1),flank 用 —— 每只怪自己定,免得整群同向转成一圈 */
  public flankDir = 1;
  /**
   * 定身截止时刻(ms)。由 ScanField 每帧刷新。
   *
   * 移动的定身靠速度覆盖就够了,这个字段管的是**动作**:开火、引信、冲锋起手 ——
   * 定住一只术修却让它继续放法,「定身」这个词就只剩一半
   */
  public frozenUntil = 0;
  /**
   * 蓄力/引信提示(charger 的前摇、bomber 的引信)。
   *
   * 用布尔字段 + preUpdate 上色,而不是 tween —— 池化对象带 tween 会跨存活期,
   * 而染色在复用时会被 clearTint 自然地复位。
   */
  public tellOn = false;
  /** 本怪的单发弹伤,在 setup 里随难度一起缩放(术修的弹也吃时间难度) */
  public shotDamage = 8;

  // ---- 机制怪状态(全部在 setup 里复位)----
  /** 追命者:受击永久加速的档位与封顶,setup 时从配置缓存 */
  public speedPerHit = 0;
  public speedCap = 9999;
  /** 是否已被寄魂附身。附身只生效一次 —— 否则怪堆会被反复叠成怪物 */
  public possessed = false;
  /** 碰撞圆基准半径(未乘 scale)。附身改体型时要按它重算 */
  public baseRadius = 7;
  /** setup 时的速度基准。噬灵虫的成长以此封顶 */
  public baseSpeed = 60;
  /** setup 时的血量基准,同样是成长的封顶线 */
  public baseMaxHealth = 10;

  // ---- 精英变异 ----
  public isElite = false;
  public eliteTier = 0;
  public drops: DropEntry[] = [];
  /** 玩家当前所处的大境界下标,用于掉落加权。由 SpawnSystem 注入 */
  public currentRealmIndex = 0;
  /**
   * 玩家已装备的法宝 id 列表快照,由 SpawnSystem 注入。
   *
   * 掉落掷骰发生在 setup() 里,而 Enemy 是池化实体、不持有 ArtifactSystem ——
   * 所以这里存的是**值**而不是引用,与 currentRealmIndex 同一套注入模式。
   * 每次生成时刷新一次(不是每次 setup 重读),因为掉率按秒级统计,
   * 逐个敌人去问系统没有意义。
   */
  public ownedArtifacts: string[] = [];

  constructor(scene: Phaser.Scene, x: number, y: number) {
    super(scene, x, y, 'enemy_beast');
    scene.add.existing(this);
    scene.physics.add.existing(this);
    this.setDepth(50);
  }

  setup(
    type: keyof typeof ENEMIES,
    difficultyMul: number,
    m: EnemyMutation = NORMAL_MUTATION,
    realmIndex = 0,
  ): void {
    const cfg = ENEMIES[type];
    this.enemyKey = type;
    this.isElite = m.elite;
    this.eliteTier = m.tier;
    this.approach = cfg.approach;
    this.archetype = cfg.archetype;

    this.setTexture(m.elite ? `elite_${type}` : `enemy_${type}`);
    // 文档第七节:血量 × 玩家境界。系数集中在 EnemyConfig.REALM_HP_SCALE
    const realmHpMul = 1 + REALM_HP_SCALE * Math.max(0, realmIndex);
    this.maxHealth = cfg.maxHealth * difficultyMul * m.hpMul * realmHpMul;
    this.health = this.maxHealth;
    this.speed = cfg.speed * m.speedMul;
    this.contactDamage = cfg.contactDamage * difficultyMul * m.damageMul;
    this.xpValue = cfg.xpValue * m.xpMul;
    this.setOrigin(0.5, 0.7);

    // 体型缩放。
    // Phaser 的 Arcade.Body.updateBounds() 从 sprite.frame.realWidth * scaleX
    // 推导源矩形,所以 setScale 单独用就能正确缩放碰撞盒 ——
    // 不要再同时把 cfg.size 乘进 setSize/setCircle,那会双重计算。
    this.setScale(m.scaleMul);

    // 死亡补间会改 alpha/scale,复用时必须复位,否则精英的体型/透明度会泄漏到普通怪。
    // 潜行怪常年半透明 —— 那是它「不受地形约束」的视觉提示,不是死亡残留
    this.setAlpha(cfg.approach === 'stealth' ? 0.6 : 1);
    this.setDepth(m.elite ? 52 : 50);

    const body = this.body as Phaser.Physics.Arcade.Body;
    // 注意:不要在这里调 body.setSize —— 它会把 isCircle 置回 false,
    // 把 setCircle 的结果整个覆盖掉(敌人原本就是这个 bug,实际是矩形碰撞体)。
    // 体型交给 setScale:Body.updateBounds 从 frame.realWidth * scale 推导碰撞盒,
    // 圆形碰撞体会自动跟着缩放。
    const r = (cfg.size / 2) * m.scaleMul;
    body.setCircle(r, 0, 0);
    // setCircle 的偏移相对 body 顶点(= 精灵中心 - 贴图尺寸/2),
    // 所以偏移要补上半个贴图尺寸,碰撞圆才会落在精灵中心。
    body.setOffset(this.frame.realWidth / 2 - r, this.frame.realHeight / 2 - r);
    body.enable = true;
    body.setVelocity(0, 0);

    this.clearTint();
    this.isDead = false;
    this.flashUntil = 0;

    // 抗性 = 天生(配置) ∪ 精英掷骰。用合并而不是覆盖:
    // 坦克的牵引抗性写在配置里,精英再叠一条也不会把它冲掉
    this.resistPull = !!(cfg.resist?.pull || m.resist?.pull);
    this.resistFreeze = !!(cfg.resist?.freeze || m.resist?.freeze);

    // 行为状态复位 —— 池化实体漏清任何一项都会带上一轮的残留。
    // 两个「下一次」都加了随机延迟:怪刚在屏外生成就开火/冲锋,
    // 玩家连它长什么样都没看见,那不叫压力,叫偷袭
    const now = this.scene.time.now;
    this.chargeState = 'approach';
    this.chargePhaseEndsAt = 0;
    this.nextChargeAt = now + 1200 + Math.random() * 1500;
    this.dashAngle = 0;
    this.nextShotAt = now + 800 + Math.random() * 1200;
    this.nextHexAt = now + 800 + Math.random() * 1200;
    this.flankDir = Math.random() < 0.5 ? -1 : 1;
    this.tellOn = false;
    this.frozenUntil = 0;
    this.shotDamage = (cfg.shotDamage ?? 8) * difficultyMul * m.damageMul;
    this.speedPerHit = cfg.mechanism?.speedPerHit ?? 0;
    this.speedCap = cfg.mechanism?.speedCap ?? 9999;
    this.possessed = false;
    this.baseRadius = cfg.size / 2;
    this.baseSpeed = this.speed;
    this.baseMaxHealth = this.maxHealth;

    this.drops = m.elite ? rollEliteDrops(this.currentRealmIndex, this.ownedArtifacts) : [];

    this.setActive(true).setVisible(true);
  }

  takeDamage(amount: number, now: number): boolean {
    if (this.isDead) return false;
    this.health -= amount;
    this.flashUntil = now + 80;
    if (this.health <= 0) {
      this.isDead = true;
      return true;
    }
    // 追命者:每受一次伤害永久加速一档。放在 takeDamage 而不是 AI 里,
    // 是因为「受到伤害」这个事件只有这里知道 —— 各种攻击形态不该各自记得通知它
    if (this.speedPerHit > 0) {
      this.speed = Math.min(this.speedCap, this.speed + this.speedPerHit);
    }
    return false;
  }

  /**
   * 被寄魂附身:等级与体型同时翻倍,并直冲玩家(冲锋的转向由 AI 负责)。
   *
   * 体型改的是 scale,所以碰撞圆必须跟着重算 —— 与 setup 里同一套算法,
   * 漏掉这一步会让变大后的怪「看着碰到了却不判定」。
   */
  applyPossession(): void {
    if (this.possessed) return;
    this.possessed = true;
    this.maxHealth *= 2;
    this.health = this.maxHealth;
    this.speed *= 1.4;
    this.xpValue *= 2;

    this.setScale(this.scaleX * 1.3);
    const r = this.baseRadius * this.scaleX;
    const body = this.body as Phaser.Physics.Arcade.Body;
    body.setCircle(r, 0, 0);
    body.setOffset(this.frame.realWidth / 2 - r, this.frame.realHeight / 2 - r);
  }

  /**
   * 噬灵虫吃掉一份修为后的永久成长。
   *
   * 两条都封顶:不封顶的话,一只吃了二十份的虫子会同时变成血牛与飞毛腿,
   * 既杀不掉也甩不掉 —— 那就不再是「给你攒物资的习惯定价」,而是必死局。
   */
  eatGrow(hpGain: number, speedGain: number): void {
    this.maxHealth = Math.min(this.maxHealth * (1 + hpGain), this.baseMaxHealth * 8);
    this.health = this.maxHealth;
    this.speed = Math.min(this.speed + speedGain, this.baseSpeed * 2.5);
  }

  /** 蓄力/引信提示的开关。由 EnemyAiSystem 每帧维护 */
  setTell(on: boolean): void {
    this.tellOn = on;
  }

  /**
   * 静默回收 —— 远离玩家时用(怪物设计:普通怪离远即 despawn)。
   *
   * 与死亡的区别:不触发死亡补间、不掉落、不计击杀。走 Projectile/Pickup
   * 同一套「kill() 自己关物理体」的约定 —— setActive(false) 不会禁用 Arcade body,
   * 漏掉这一步会让一个不可见的敌人永远留在池里参与重叠检测。
   */
  kill(): void {
    this.isDead = true;
    this.setActive(false).setVisible(false);
    this.clearTint();
    const body = this.body as Phaser.Physics.Arcade.Body;
    body.enable = false;
    body.setVelocity(0, 0);
  }

  preUpdate(time: number, delta: number): void {
    super.preUpdate(time, delta);
    if (!this.active) return;
    if (this.scene.physics.world.isPaused) return;
    if (time < this.flashUntil) {
      this.setTintFill(0xffffff);
    } else if (this.tellOn) {
      // 蓄力/引信:黄色染色而不是白闪,免得和受击反馈混淆
      this.setTint(0xffcc44);
    } else if (this.possessed) {
      // 被附身:常驻一层青紫,让「必须先点掉的那一只」在一堆怪里认得出来
      this.setTint(0xcc88ff);
    } else {
      this.clearTint();
    }
  }
}