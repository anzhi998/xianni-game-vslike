import Phaser from 'phaser';
import { ENEMIES, REALM_HP_SCALE } from '../config/EnemyConfig';
import { SPRITE_ART_SCALE } from '../config/GameConfig';
import { rollEliteDrops } from '../config/EliteConfig';
import { showFirstFrame } from '../utils/EnemyFrames';
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
  /** 击退抗性。窥涅修士的「免疫击退」靠它成立 */
  public resistKnockback = false;
  /** 护甲:0~0.5 的伤害减免。傀儡卫的「高减伤」靠它成立 */
  public armor = 0;
  /**
   * 即死抗性:0 = 无,1 = 完全免疫。
   *
   * 吹熄(仙术·呼风)的阈值按 `阈值 × (1 - 本值)` 折算 ——
   * 精英默认 0.5 → 20% 的阈值降成 10%,首领 1 → 直接免疫。
   * ⚠️ 它挂在 Enemy 上而不是每处调用点现判,是因为「这一发能不能直接抹掉它」
   *    只在伤害入口知道该怎么看;各形态各判一次的话,加第二个即死来源时
   *    一定会漏掉其中一个。
   */
  public executeResist = 0;
  /**
   * 精英的默认即死抗性(设计书 ⑦ ⑥)。
   *
   * 吹熄的阈值是「血量低于 20%」,精英抗性 50% → 有效阈值降到 10%,
   * 所以「一记吹熄收掉一整片精英」这种局面不会发生。首领免疫(见 setup)。
   */
  static readonly ELITE_EXECUTE_RESIST = 0.5;

  // ---- 位移与状态(全部是 setup() 必须复位的字段)----
  /**
   * 击退速度偏移(px/s),到期前一直叠加在追猎速度上。
   *
   * 为什么是「速度偏移」而不是冲量:EnemyAiSystem 每帧**整体重写**敌人速度,
   * 一次性冲量在下一帧就被抹掉 —— 引力术当初就是这么变成空操作的。
   * 所以厚土术的推挤、崩墙的撞击都必须写成这一组字段。
   */
  public knockX = 0;
  public knockY = 0;
  public knockUntil = 0;
  /**
   * 牵引速度偏移(px/s),到期前一直叠加在追猎速度上(龙卷)。
   *
   * ⚠️ 它**不写进 knockX/knockY**,而是另开一组字段 —— 因为牵引与推挤
   *    是设计书明写的**反制关系**:厚土术把怪推散、龙卷把怪聚拢,
   *    同时携带时两者应当互相抵消。共用一组字段的话,后写的那一个会直接
   *    覆盖前一个(而不是抵消),于是「一推一拉」会变成「谁后出手谁赢」。
   */
  public pullX = 0;
  public pullY = 0;
  public pullUntil = 0;
  /** 眩晕截止时刻(ms)。定住它的一切动作,是「撞墙 0.6 秒」那种硬控 */
  public stunnedUntil = 0;
  /** 减速强度与截止时刻。速度按 (1 - slowMul) 缩放 */
  public slowMul = 0;
  public slowUntil = 0;
  /** 点燃 / 流血:每秒伤害与截止时刻。累积值由 EnemyAiSystem 每帧取走 */
  public burnDps = 0;
  public burnUntil = 0;
  public burnAccum = 0;
  /** 最强那层点燃/流血的施加者(神通 id)。DoT 跳伤时 opts 早已不在,归账只能靠它 */
  public burnSource = '';
  /** 感电:层数与截止时刻。五雷正法的自我增伤循环靠它 */
  public shockStacks = 0;
  public shockUntil = 0;

  // ---- Boss(全部在 setup 里复位)----
  /** 非空即为首领。首领不参与精英上限、不被寄魂附身、也不会被传回 */
  public bossKey = '';
  public bossPhase = 0;
  /** 首领当前阶段的下一个动作时刻(ms) */
  public bossNextActionAt = 0;
  /** 朱雀「浴火重生」是否已经用过(半血只回满一次) */
  public bossRebornUsed = false;
  /**
   * 出招前摇的结束时刻(ms)。在它之前,Boss 会亮一层蓄力光。
   *
   * 与 `tellOn` 分开:那只管冲锋/引信,是 AI 自己的行为;
   * 这个由 BossSystem 写、由渲染读,是**招式级**的预告 ——
   * 玩家看到光就知道「下一拍它要放招了」,而不是等弹幕出现在脸上。
   */
  public bossCastFlashUntil = 0;
  /** 正在蓄的是哪一招。仅用于前摇的表现(环形羽爆的光应该比扇形更扎眼) */
  public bossCastKind = '';
  /** 无敌截止时刻(ms)。天运子「闪现」用它 —— 伤害只有 takeDamage 一个入口 */
  public invulnerableUntil = 0;
  /** 是否已被天运子「命数」镀金。每只只镀一次,压力靠轮次累积而不是叠倍率 */
  public fateBuffed = false;

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
   * 玩家已装备的遗物 id 列表快照,由 SpawnSystem 注入。
   *
   * 掉落掷骰发生在 setup() 里,而 Enemy 是池化实体、不持有 ArtifactSystem ——
   * 所以这里存的是**值**而不是引用,与 currentRealmIndex 同一套注入模式。
   * 每次生成时刷新一次(不是每次 setup 重读),因为掉率按秒级统计,
   * 逐个敌人去问系统没有意义。
   */
  public ownedRelics: string[] = [];
  /** 玩家已掌握的法术 id 快照。用于把「还没学的法术的专属遗物」排除掉落池 */
  public ownedSpells: string[] = [];

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
    // 怪物不走动,只显示横排素材的第 0 帧。每只怪被借出去时贴图都会换,
    // 所以「显示哪一帧」必须每次 setup 显式写回,而不是靠池子里的残留
    showFirstFrame(this);
    // 文档第七节:血量 × 玩家境界。系数集中在 EnemyConfig.REALM_HP_SCALE
    const realmHpMul = 1 + REALM_HP_SCALE * Math.max(0, realmIndex);
    this.maxHealth = cfg.maxHealth * difficultyMul * m.hpMul * realmHpMul;
    this.health = this.maxHealth;
    this.speed = cfg.speed * m.speedMul;
    this.contactDamage = cfg.contactDamage * difficultyMul * m.damageMul;
    this.xpValue = cfg.xpValue * m.xpMul;
    this.setOrigin(0.5, 0.7);

    // 体型缩放 = 变异倍率(精英 1.6)× 全局精灵放大(GameConfig.SPRITE_ART_SCALE)。
    //
    // ⚠️ **别去改 EnemyConfig.size 来放大怪** —— 它只对程序化贴图有效:
    // `makeTexture` 开头有 `if (textures.exists(key)) return`,`src/assets/` 里有
    // 真实素材时程序化那张根本不生成,于是 size 只改到碰撞圆、贴图纹丝不动,
    // 结果是「看着没碰到却被撞飞」。运行期缩放对真实与程序化素材一视同仁。
    // Phaser 的 Arcade.Body.updateBounds() 从 sprite.frame.realWidth * scaleX
    // 推导源矩形,所以 setScale 单独用就能正确缩放碰撞盒 ——
    // 不要再同时把 cfg.size 乘进 setSize/setCircle,那会双重计算。
    this.setScale(m.scaleMul * SPRITE_ART_SCALE);

    // 死亡补间会改 alpha/scale,复用时必须复位,否则精英的体型/透明度会泄漏到普通怪。
    // 潜行怪常年半透明 —— 那是它「不受地形约束」的视觉提示,不是死亡残留
    this.setAlpha(cfg.approach === 'stealth' ? 0.6 : 1);
    this.setDepth(m.elite ? 52 : 50);

    const body = this.body as Phaser.Physics.Arcade.Body;
    // 注意:不要在这里调 body.setSize —— 它会把 isCircle 置回 false,
    // 把 setCircle 的结果整个覆盖掉(敌人原本就是这个 bug,实际是矩形碰撞体)。
    //
    // ⚠️ `setCircle` 收的是**未缩放的源像素**,不是世界像素:
    //    `setCircle(r)` 存下 `sourceWidth = r * 2`,而 `updateBounds()` 再算
    //    `width = sourceWidth * scaleX`;`updateFromGameObject()` 里连 offset 也是
    //    `transform.x + scaleX * (offset.x - displayOriginX)`。
    //    所以半径**只写 `size / 2`**,体型一律交给 setScale 表达 ——
    //    把 scaleMul / SPRITE_ART_SCALE 也乘进 r 就是平方:精英会拿到
    //    1.6² = 2.56 倍的判定圈(而贴图只有 1.6 倍),表现是
    //    「看着还有一段距离却被撞飞」。这个平方曾经真的存在于代码里。
    const r = cfg.size / 2;
    body.setCircle(r, 0, 0);
    // setCircle 的偏移相对 body 顶点(= 精灵中心 - 贴图尺寸/2),
    // 所以偏移要补上半个贴图尺寸,碰撞圆才会落在精灵中心。
    body.setOffset(this.frame.realWidth / 2 - r, this.frame.realHeight / 2 - r);
    // 同 Projectile.setup:setCircle 用的是上一次缓存的缩放,精英(1.6 倍)与
    // 普通怪交替刷出时第一帧的碰撞圆会算错,这里重算一次。
    // ⚠️ 只能用 updateBounds —— updateFromGameObject 会按旧 offset 污染 position,
    //    随后被 postUpdate 写回精灵,把刚生成的怪挪到别处
    body.updateBounds();
    body.enable = true;
    body.setVelocity(0, 0);

    this.clearTint();
    this.isDead = false;
    this.flashUntil = 0;

    // 抗性 = 天生(配置) ∪ 精英掷骰。用合并而不是覆盖:
    // 坦克的牵引抗性写在配置里,精英再叠一条也不会把它冲掉
    this.resistPull = !!(cfg.resist?.pull || m.resist?.pull);
    this.resistFreeze = !!(cfg.resist?.freeze || m.resist?.freeze);
    this.resistKnockback = !!(cfg.resist?.knockback || m.resist?.knockback);
    this.armor = cfg.armor ?? 0;
    // 即死抗性:首领免疫一切即死(它不该被一次清屏收掉),
    // 精英按设计书的默认 50% 折算阈值,普通怪无抗性
    this.executeResist = cfg.boss ? 1 : (m.elite ? Enemy.ELITE_EXECUTE_RESIST : 0);

    // 行为状态复位 —— 池化实体漏清任何一项都会带上一轮的残留。
    // 两个「下一次」都加了随机延迟:怪刚在屏外生成就开火/冲锋,
    // 玩家连它长什么样都没看见,那不叫压力,叫偷袭
    const now = this.scene.time.now;
    this.knockX = 0;
    this.knockY = 0;
    this.knockUntil = 0;
    this.pullX = 0;
    this.pullY = 0;
    this.pullUntil = 0;
    this.stunnedUntil = 0;
    this.slowMul = 0;
    this.slowUntil = 0;
    this.burnDps = 0;
    this.burnUntil = 0;
    this.burnAccum = 0;
    this.burnSource = '';
    this.shockStacks = 0;
    this.shockUntil = 0;
    this.bossKey = cfg.boss ?? '';
    this.bossPhase = 0;
    this.bossNextActionAt = 0;
    this.bossRebornUsed = false;
    this.bossCastFlashUntil = 0;
    this.bossCastKind = '';
    this.invulnerableUntil = 0;
    this.fateBuffed = false;

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

    this.drops = m.elite ? rollEliteDrops(this.ownedSpells, this.ownedRelics) : [];

    this.setActive(true).setVisible(true);
  }

  takeDamage(amount: number, now: number): boolean {
    if (this.isDead) return false;
    // 无敌(天运子闪现):不掉血也不触发受击加速 —— 无敌期间的「命中」本就无效
    if (now < this.invulnerableUntil) return false;
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
    const body = this.body as Phaser.Physics.Arcade.Body;
    // 半径**不能**再乘 scaleX —— setCircle 收的是源像素,updateBounds 会自己
    // 乘一遍当前缩放(见 setup 里的长篇注释)。写 `baseRadius * scaleX` 就是
    // 平方,附身之后判定圈会比体型大 30%,而不是大 0%。
    const r = this.baseRadius;
    body.setCircle(r, 0, 0);
    body.setOffset(this.frame.realWidth / 2 - r, this.frame.realHeight / 2 - r);
    body.updateBounds();
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

  /**
   * 天运子「命数」的镀金强化:血、速、伤同时抬一档。
   *
   * 与附身的差别在**计费方式**:附身单只翻倍、只发生一次;命数每轮点一片、
   * 每只也只镀一次 —— 压迫感来自「还没点到的怪迟早也被镀上」,
   * 所以倍率刻意压得比附身低。速度按 baseSpeed 封顶,与噬灵虫同一套语言。
   * 血按当前值同比抬而不是回满 —— 回满等于把玩家已打掉的输出白送回去。
   */
  applyFateBuff(hpMul: number, speedMul: number, damageMul: number): boolean {
    if (this.fateBuffed || this.isDead || this.bossKey) return false;
    this.fateBuffed = true;
    this.maxHealth *= hpMul;
    this.health *= hpMul;
    this.speed = Math.min(this.speed * speedMul, this.baseSpeed * 2.5);
    this.contactDamage *= damageMul;
    this.shotDamage *= damageMul;
    this.xpValue *= 1.5;
    return true;
  }

  /** 蓄力/引信提示的开关。由 EnemyAiSystem 每帧维护 */
  setTell(on: boolean): void {
    this.tellOn = on;
  }

  // ---- 状态的施加入口 ----
  //
  // 全部是「取较大者 + 刷新时间」而不是「覆盖」:同类状态同时命中时
  // 应该保留更强的那个,否则一发弱减速就能把一发强减速顶掉。

  applySlow(mul: number, ms: number, now: number): void {
    if (now >= this.slowUntil || mul > this.slowMul) this.slowMul = mul;
    this.slowUntil = Math.max(this.slowUntil, now + ms);
  }

  applyBurn(dps: number, ms: number, now: number, sourceId?: string): void {
    // 来源跟着最强的那个 DoT 走:弱 DoT 只能续时长,不能把账记到自己头上
    if (this.burnDps < dps) {
      this.burnDps = dps;
      this.burnSource = sourceId ?? '';
    }
    this.burnUntil = Math.max(this.burnUntil, now + ms);
  }

  applyShock(stacks: number, ms: number, now: number, cap: number): void {
    this.shockStacks = Math.min(cap, this.shockStacks + stacks);
    this.shockUntil = Math.max(this.shockUntil, now + ms);
  }

  /** 当前感电层数是否仍然生效 */
  shockActive(now: number): number {
    return now < this.shockUntil ? this.shockStacks : 0;
  }

  /**
   * 施加一次击退。
   *
   * @param speed px/s 的偏移速度,不是位移量 —— 持续到 knockUntil 结束
   * @returns 是否真的被推动(免疫击退的目标返回 false,调用方据此跳过撞墙伤害)
   */
  applyKnock(dirX: number, dirY: number, speed: number, ms: number, now: number): boolean {
    if (this.resistKnockback) return false;
    const len = Math.hypot(dirX, dirY) || 1;
    this.knockX = (dirX / len) * speed;
    this.knockY = (dirY / len) * speed;
    this.knockUntil = Math.max(this.knockUntil, now + ms);
    return true;
  }

  /**
   * 施加一次牵引(龙卷)。
   *
   * 与击退的差别有两条,都不是风格问题:
   *   - **免疫条件不同**:击退看 resistKnockback,牵引看 resistPull。
   *     两者各自独立,一只「免疫击退」的怪照样能被搅成一团。
   *   - **不共用字段**:写进 pullX/pullY 而不是 knockX/knockY,
   *     这样同一帧里的推挤与牵引会**相加**,即设计书说的「互相抵消」。
   *
   * @param speed px/s 的偏移速度,不是位移量(同 applyKnock)
   * @returns 是否真的被拉动(牵引免疫的目标返回 false)
   */
  applyPull(dirX: number, dirY: number, speed: number, ms: number, now: number): boolean {
    if (this.resistPull) return false;
    const len = Math.hypot(dirX, dirY) || 1;
    this.pullX = (dirX / len) * speed;
    this.pullY = (dirY / len) * speed;
    this.pullUntil = Math.max(this.pullUntil, now + ms);
    return true;
  }

  /** 眩晕。定身只停动作,眩晕连移动一起停 —— 全体系只有撞墙会给它 */
  stun(ms: number, now: number): void {
    this.stunnedUntil = Math.max(this.stunnedUntil, now + ms);
  }

  isStunned(now: number): boolean {
    return now < this.stunnedUntil;
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
    } else if (time < this.bossCastFlashUntil) {
      // 首领出招前摇。用**脉动的橙红**而不是静态色:
      // 静态色在混战里会被当成「精英的描金边」,而玩家需要的是「它在蓄招」这条
      // 与时间有关的消息 —— 闪一下停一下的节奏本身就传达了「快了」。
      // 环形羽爆比火羽扇更亮(前摇里那两档色差是给玩家的第一次预警)
      const pulse = Math.floor(time / 70) % 2 === 0;
      if (this.bossCastKind === 'nova') this.setTintFill(pulse ? 0xffdd66 : 0xff5511);
      else this.setTint(pulse ? 0xffaa33 : 0xff7722);
    } else if (this.tellOn) {
      // 蓄力/引信:黄色染色而不是白闪,免得和受击反馈混淆
      this.setTint(0xffcc44);
    } else if (this.possessed) {
      // 被附身:常驻一层青紫,让「必须先点掉的那一只」在一堆怪里认得出来
      this.setTint(0xcc88ff);
    } else if (time < this.invulnerableUntil) {
      // 闪现无敌:一层冰蓝,读作「现在打它没用,先走」
      this.setTint(0x99eeff);
    } else if (this.fateBuffed) {
      // 命数镀金:常驻暗金,让「该先清谁」在一堆怪里一眼可辨
      this.setTint(0xddbb55);
    } else {
      this.clearTint();
    }
  }
}