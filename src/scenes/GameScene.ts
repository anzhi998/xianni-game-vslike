import Phaser from 'phaser';
import { Player } from '../entities/Player';
import { Enemy } from '../entities/Enemy';
import { EnemyShot } from '../entities/EnemyShot';
import type { ShotStyle } from '../entities/EnemyShot';
import { BloodTide } from '../entities/BloodTide';
import { Projectile } from '../entities/Projectile';
import { Pickup } from '../entities/Pickup';
import { Orbiter } from '../entities/attacks/Orbiter';
import { Zone } from '../entities/attacks/Zone';
import { SandWave } from '../entities/attacks/SandWave';
import { Tornado } from '../entities/attacks/Tornado';
import { ChainBolt } from '../entities/attacks/ChainBolt';
import { Barrier } from '../entities/attacks/Barrier';
import { FireVent } from '../entities/Hazards/FireVent';
import { FingerOfFate } from '../entities/Hazards/FingerOfFate';
import { MeteorFall } from '../entities/Hazards/MeteorFall';
import { DamageText, COLOR_IMMUNE } from '../entities/DamageText';
import type { DamageTextOpts } from '../entities/DamageText';
import { InputManager } from '../utils/InputManager';
import { WeaponSystem } from '../systems/WeaponSystem';
import { SpawnSystem } from '../systems/SpawnSystem';
import { EnemyAiSystem } from '../systems/EnemyAiSystem';
import { MechanismSystem } from '../systems/MechanismSystem';
import { XPSystem } from '../systems/XPSystem';
import { RelicSystem } from '../systems/RelicSystem';
import { RealmSystem } from '../systems/RealmSystem';
import { EvolutionSystem } from '../systems/EvolutionSystem';
import { ChestSystem } from '../systems/ChestSystem';
import { HazardSystem } from '../systems/HazardSystem';
import { BossSystem } from '../systems/BossSystem';
import { DamageMeter } from '../systems/DamageMeter';
import { GAME_WIDTH, GAME_HEIGHT, CAMERA_ZOOM } from '../config/GameConfig';
import { getMap, DEFAULT_MAP_ID, HAZARD_FALLBACK_COLOR } from '../config/MapConfig';
import type { MapDef } from '../config/MapConfig';
import { SPELLS, BASE_SPELL_IDS, STARTING_SPELL, MAX_SPELL_SLOTS, resolveSpell,
  validateSpellReachability, validateEvolutionLinks, validateSpellKeys } from '../config/SpellConfig';
import { RELICS, RELIC_IDS, POOL_RELIC_IDS, RELIC_SLOTS, validateRelicReachability } from '../config/RelicConfig';
import { BOSSES, SIGIL_TEXTURE_RADIUS, SWORD_DOMAIN_TEXTURE_RADIUS } from '../config/BossConfig';
import { validateBossSchedule } from '../config/BossConfig';
import { EVOLUTIONS, findEvolution } from '../config/EvolutionConfig';
import { HEAL_PILL_FRACTION, XP_PILL_FRACTION } from '../config/EliteConfig';
import { CONSUMABLES, ALL_CONSUMABLES, CARD_WEIGHTS, consumableCard } from '../config/CultivationUpgradeConfig';
import { META_PROGRESSION_ENABLED } from '../config/FeatureConfig';
import type { ChestQuality } from '../systems/ChestSystem';
import { validateIntros, validateEnemyReachability, validateOpeningDifficulty } from '../config/WaveConfig';
import { ENEMIES } from '../config/EnemyConfig';
import { BAIT, MIMIC_ENEMY_ID } from '../config/MechanismConfig';
import { GameEvents } from '../types';
import { NORMAL_MUTATION } from '../types';
import type { DamageOptions, PickupKind, Upgrade, UpgradeContext } from '../types';
import { SaveManager } from '../utils/SaveManager';
import { MathUtils } from '../utils/MathUtils';

/** 玩家基础最大生命。实际值 = 本值 × 境界倍率 × 遗物倍率 */
const BASE_MAX_HEALTH = 100;

/**
 * 主游戏场景 —— 全部跨系统的接线都在这里
 *
 * 它是 orchestrator:自己不实现玩法,只负责把各个系统接起来,
 * 并提供它们都需要的那几个唯一入口(伤害、掉落、悟道、调试)。
 */
export class GameScene extends Phaser.Scene {
  // 实体池
  public player!: Player;
  public enemyPool!: Phaser.GameObjects.Group;
  public projectilePool!: Phaser.GameObjects.Group;
  public enemyShotPool!: Phaser.GameObjects.Group;
  public bloodTidePool!: Phaser.GameObjects.Group;
  public pickupPool!: Phaser.GameObjects.Group;
  public damageTextPool!: Phaser.GameObjects.Group;
  public orbiterPool!: Phaser.GameObjects.Group;
  public zonePool!: Phaser.GameObjects.Group;
  public sandWavePool!: Phaser.GameObjects.Group;
  public tornadoPool!: Phaser.GameObjects.Group;
  public chainBoltPool!: Phaser.GameObjects.Group;
  public barrierPool!: Phaser.GameObjects.Group;
  public fireVentPool!: Phaser.GameObjects.Group;
  public fingerPool!: Phaser.GameObjects.Group;
  public meteorPool!: Phaser.GameObjects.Group;

  // 系统
  public inputManager!: InputManager;
  public weaponSystem!: WeaponSystem;
  public spawnSystem!: SpawnSystem;
  public enemyAiSystem!: EnemyAiSystem;
  public mechanismSystem!: MechanismSystem;
  public xpSystem!: XPSystem;
  public relicSystem!: RelicSystem;
  public realmSystem!: RealmSystem;
  public evolutionSystem!: EvolutionSystem;
  public chestSystem!: ChestSystem;
  public hazardSystem!: HazardSystem;
  public bossSystem!: BossSystem;
  /** DPS 统计。唯一伤害入口 applyDamageToEnemy 每发都会 record,浮窗在 UIScene 常驻 */
  public readonly damageMeter = new DamageMeter();

  // 状态
  public isPaused = false;
  public elapsed = 0;
  public kills = 0;
  /** 灵石。局外强化树还没做,这里只累计、存取档、展示 */
  public coins = 0;
  /**
   * 修为宝石的小数尾数结转(聚灵珠)。
   *
   * 倍率是百分比,而修为是整数:杂兵的 `xpValue` 就是 1,`1 × 1.06 = 1.06`。
   * 若直接取整,这件遗物对**最常见**的那一类敌人收益恒为 0 —— 配表写 +30%,实发 0%。
   * 若把小数值直接灌进 `XPSystem`,那「修为恒为整数」这条不变量就破了
   * (升级曲线、面板取整、溢出折算全都建立在它上面)。
   * 于是攒零成整:尾数留在这一格,凑满 1 点才发出去 —— 长期频率精确等于配表,
   * 一笔账都不多记、也不少记。
   */
  private xpCarry = 0;
  /** 当前地图 */
  public map: MapDef = getMap(DEFAULT_MAP_ID);
  /** 是否已经结算过死亡 */
  private deathHandled = false;

  private veilOverlay!: Phaser.GameObjects.Graphics;
  /** 首领弹体共用的拖尾发射器。见 setupPools —— 它是共享的,不是每发一个 */
  private shotTrail!: Phaser.GameObjects.Particles.ParticleEmitter;
  /**
   * 首领脚下的「场所」图层(剑阵/法域)。
   *
   * 它只有一个实例,由 update 每帧挪到当前首领脚下 —— 首领同时最多一只,
   * 没必要每帧 find 一个 GameObject,更没必要给它建池。
   * 没有首领时 setVisible(false) 即可。
   */
  private bossDomain?: Phaser.GameObjects.Image;
  /**
   * 杀戮仙诀的四方符印(东/南/西/北各一枚,悬在首领身边的环绕半径上)。
   * 与剑域同构(常驻实例、每帧跟随首领),但层级相反 ——
   * 剑域是**地**,符印是**护体的阵**,画在首领之上,
   * 否则它会变成「脚下又一个圈」,读不出「打不进去」。
   */
  private bossSigils: Phaser.GameObjects.Image[] = [];
  /** 白罩张开的时刻。用于入场淡入 —— 只有截止时刻是算不出「刚张开」的 */
  private shieldStartedAt = 0;
  /** 上一次见过的前摇结束时刻。与前一个值比对即可拿到「刚进入前摇」的上升沿 */
  private lastCastSeen = 0;
  private veilAlpha = 0;
  private debugSpellCursor = 0;
  private debugMechCursor = 0;
  private debugBossCursor = 0;
  private obstacles!: Phaser.Physics.Arcade.StaticGroup;

  constructor() {
    super('GameScene');
  }

  init(data: { mapId?: string }): void {
    this.map = getMap(data?.mapId ?? DEFAULT_MAP_ID);
  }

  create(): void {
    this.isPaused = false;
    this.elapsed = 0;
    this.kills = 0;
    this.coins = 0;
    this.xpCarry = 0;
    this.deathHandled = false;

    this.cameras.main.setBackgroundColor('#1a0f0c');
    this.physics.world.setBounds(0, 0, this.map.worldWidth, this.map.worldHeight);

    this.drawGround();
    this.spawnObstacles();
    this.checkContentTables();
    this.setupPools();
    this.setupPlayer();
    this.setupCamera();
    this.setupVeil();
    this.setupInput();
    this.setupSystems();
    this.setupCollisions();

    // ⚠️ 必须留在最后一行:所有系统都在上面建好了,
    // UIScene 的 create() 会立刻从本场景拉数据(见 CLAUDE.md)
    this.scene.launch('UIScene');
  }

  // ===== 世界 =====

  private drawGround(): void {
    const g = this.add.graphics();
    g.setDepth(-100);
    const W = this.map.worldWidth;
    const H = this.map.worldHeight;
    const gr = this.map.ground;

    g.fillStyle(gr.base, 1);
    g.fillRect(0, 0, W, H);

    // 用种子随机散布地面斑块:同一张图每次长得一模一样,
    // 玩家能靠「我记得那棵树」建立空间感 —— 这是地图作为玩法变量的前提
    const rng = this.createSeededRng(42);
    for (let i = 0; i < 1200; i++) {
      const x = rng() * W;
      const y = rng() * H;
      const t = rng();
      let acc = 0;
      for (const [color, prob, size] of gr.specks) {
        acc += prob;
        if (t < acc) {
          g.fillStyle(color, 1);
          g.fillRect(x, y, size, size);
          break;
        }
      }
    }

    for (const [x, y, w, h] of gr.roads) {
      g.fillStyle(0x6a5a3a, 0.18);
      g.fillRect(x, y, w, h);
    }

    g.lineStyle(4, gr.border, 1);
    g.strokeRect(0, 0, W, H);
  }

  private createSeededRng(seed: number): () => number {
    let s = seed;
    return () => {
      s = (s * 1103515245 + 12345) & 0x7fffffff;
      return s / 0x7fffffff;
    };
  }

  private spawnObstacles(): void {
    this.obstacles = this.physics.add.staticGroup();
    const rng = this.createSeededRng(99);
    const types = [
      { key: 'tree', w: 64, h: 80 },
      { key: 'rock', w: 48, h: 40 },
      { key: 'bush', w: 40, h: 32 },
    ];
    for (let i = 0; i < 80; i++) {
      const t = types[Math.floor(rng() * types.length)];
      const x = 80 + rng() * (this.map.worldWidth - 160);
      const y = 80 + rng() * (this.map.worldHeight - 160);
      if (MathUtils.distanceSq(x, y, this.map.worldWidth / 2, this.map.worldHeight / 2) < 200 * 200) continue;
      const obj = this.add.image(x, y, t.key);
      obj.setOrigin(0.5, 1);
      obj.setDepth(10);
      this.physics.add.existing(obj, true);
      (obj.body as Phaser.Physics.Arcade.Body).setSize(t.w * 0.6, t.h * 0.6);
      this.obstacles.add(obj);
    }
  }

  // ===== 池 =====

  private setupPools(): void {
    // ⚠️ 每个池都必须设有限 maxSize 与 classType(见 CLAUDE.md):
    // Group 默认 maxSize = -1 时 isFull() 恒为 false,池耗尽后 get() 会返回
    // 一个无纹理的新 Sprite 而不是 null,随后的 setup() 抛 TypeError 且永久泄漏。
    // 另外 maxSize 必须与下面的预建循环次数相等,少建一个那只就会凭空消失。
    this.enemyPool = this.add.group({ runChildUpdate: false, classType: Enemy, maxSize: 200 });
    this.projectilePool = this.add.group({ runChildUpdate: false, classType: Projectile, maxSize: 140 });
    this.enemyShotPool = this.add.group({ runChildUpdate: false, classType: EnemyShot, maxSize: 60 });
    this.bloodTidePool = this.add.group({ runChildUpdate: false, classType: BloodTide, maxSize: 2 });
    this.pickupPool = this.add.group({ runChildUpdate: false, classType: Pickup, maxSize: 160 });
    this.damageTextPool = this.add.group({ runChildUpdate: false, classType: DamageText, maxSize: 60 });
    this.orbiterPool = this.add.group({ runChildUpdate: false, classType: Orbiter, maxSize: 24 });
    this.zonePool = this.add.group({ runChildUpdate: false, classType: Zone, maxSize: 20 });
    this.sandWavePool = this.add.group({ runChildUpdate: false, classType: SandWave, maxSize: 12 });
    // 弧带:仙术·呼风一次放 9 道(8 黑龙 + 主龙),冷却 1.70s、存活 0.90s,
    // 所以同一时刻最多 9 只在场。12 是给召唤怪/机制怪叠加留的余量。
    this.tornadoPool = this.add.group({ runChildUpdate: false, classType: Tornado, maxSize: 12 });
    this.chainBoltPool = this.add.group({ runChildUpdate: false, classType: ChainBolt, maxSize: 10 });
    this.barrierPool = this.add.group({ runChildUpdate: false, classType: Barrier, maxSize: 3 });
    // 火柱:预警 1.2s + 喷发 1.6s = 2.8s 一根,8 秒喷 2 根 —— 6 个足够
    this.fireVentPool = this.add.group({ runChildUpdate: false, classType: FireVent, maxSize: 6 });
    // 命数指:单根寿命约 2.3s(1.6 预警 + 0.26 指落 + 0.42 收尾),
    // 天运子终阶最快 8.2s 一次、一次 3 根,同屏最多约 3 根 —— 6 是余量
    this.fingerPool = this.add.group({ runChildUpdate: false, classType: FingerOfFate, maxSize: 6 });
    // 朱雀陨石:单颗寿命 1.0s 坠落 + 0.45s 残烬 ≈ 1.45s,终阶 2.0s 一次、一次 4 颗。
    // 理论峰值 4 颗同时在场,但两波之间会叠(前一波残烬未尽、后一波已入场)—— 8 是余量
    this.meteorPool = this.add.group({ runChildUpdate: false, classType: MeteorFall, maxSize: 8 });

    for (let i = 0; i < 200; i++) {
      const e = new Enemy(this, 0, 0);
      e.setActive(false).setVisible(false);
      this.enemyPool.add(e);
    }
    for (let i = 0; i < 140; i++) {
      const p = new Projectile(this);
      p.setActive(false).setVisible(false);
      this.projectilePool.add(p);
    }
    // 首领弹体的拖尾。**一个共用发射器**,由每发弹在 setup / kill 里挪位置与开关 ——
    // 每发新建一个会让 60 发的弹幕池常驻 60 个空闲发射器。
    // ⚠️ 贴图用一张 4×4 的白点(程序化生成),靠 tint 随弹色变化:
    //    用 fx_hit 那种带形状的图,拖尾会变成一串小太阳
    this.shotTrail = this.add.particles(0, 0, 'fx_spark', {
      lifespan: 300,
      speed: { min: 0, max: 18 },
      scale: { start: 0.55, end: 0 },
      alpha: { start: 0.7, end: 0 },
      quantity: 1,
      frequency: 26,
      blendMode: Phaser.BlendModes.ADD,
      emitting: false,
    });
    this.shotTrail.setDepth(77);

    for (let i = 0; i < 60; i++) {
      const s = new EnemyShot(this);
      s.setActive(false).setVisible(false);
      s.bindTrail(this.shotTrail);
      this.enemyShotPool.add(s);
    }
    for (let i = 0; i < 2; i++) {
      const tide = new BloodTide(this);
      tide.bind(() => this.player, (a, sx, sy) => this.damagePlayer(a, sx, sy));
      this.bloodTidePool.add(tide);
    }
    for (let i = 0; i < 160; i++) {
      const g = new Pickup(this);
      g.setActive(false).setVisible(false);
      this.pickupPool.add(g);
    }
    for (let i = 0; i < 60; i++) {
      const t = new DamageText(this);
      t.setActive(false).setVisible(false);
      this.damageTextPool.add(t);
    }

    // 攻击形态在��池时一次性注入敌人的引用与伤害回调
    const apply = this.applyDamageToEnemy.bind(this);
    for (let i = 0; i < 24; i++) {
      const o = new Orbiter(this);
      o.setActive(false).setVisible(false);
      // 传实时取值函数 —— 环绕体必须跟着玩家走,捕获坐标会把它甩在原地
      o.bind(this.enemyPool, apply, () => ({ x: this.player.x, y: this.player.y }));
      this.orbiterPool.add(o);
    }
    for (let i = 0; i < 20; i++) {
      const z = new Zone(this);
      z.setActive(false).setVisible(false);
      z.bind(this.enemyPool, apply);
      this.zonePool.add(z);
    }
    for (let i = 0; i < 12; i++) {
      const w = new SandWave(this);
      w.setActive(false).setVisible(false);
      w.bind(this.enemyPool, this.enemyShotPool, apply);
      this.sandWavePool.add(w);
    }
    for (let i = 0; i < 12; i++) {
      const t = new Tornado(this);
      t.setActive(false).setVisible(false);
      t.bind(this.enemyPool, apply);
      this.tornadoPool.add(t);
    }
    for (let i = 0; i < 10; i++) {
      const b = new ChainBolt(this);
      b.setActive(false).setVisible(false);
      b.bind(this.enemyPool, apply);
      this.chainBoltPool.add(b);
    }
    for (let i = 0; i < 3; i++) {
      const w = new Barrier(this);
      w.setActive(false).setVisible(false);
      w.bind(this.enemyPool, apply);
      this.barrierPool.add(w);
    }
    for (let i = 0; i < 6; i++) {
      const v = new FireVent(this);
      v.setActive(false).setVisible(false);
      this.fireVentPool.add(v);
    }
    for (let i = 0; i < 6; i++) {
      const f = new FingerOfFate(this);
      f.setActive(false).setVisible(false);
      f.bind(
        () => this.player,
        (amount, sx, sy) => this.damagePlayer(amount, sx, sy),
        (x, y, radius) => this.onFingerSlam(x, y, radius),
      );
      this.fingerPool.add(f);
    }
    for (let i = 0; i < 8; i++) {
      const m = new MeteorFall(this);
      m.setActive(false).setVisible(false);
      m.bind(
        () => this.player,
        (amount, sx, sy) => this.damagePlayer(amount, sx, sy),
        (x, y, radius) => this.onMeteorImpact(x, y, radius),
      );
      this.meteorPool.add(m);
    }
  }

  private setupPlayer(): void {
    this.player = new Player(this, this.map.worldWidth / 2, this.map.worldHeight / 2);
    this.player.maxHealth = BASE_MAX_HEALTH;
    this.player.health = BASE_MAX_HEALTH;
  }

  /** 遮天的暗角。常驻一个 Graphics,由 alpha 淡入淡出 */
  private setupVeil(): void {
    const g = this.add.graphics();
    g.setScrollFactor(0);
    g.setDepth(200);
    for (let i = 0; i < 7; i++) {
      const inset = 10 + i * 26;
      g.lineStyle(26, 0x000000, 0.11 * (1 - i / 8));
      g.strokeRect(inset, inset, GAME_WIDTH - inset * 2, GAME_HEIGHT - inset * 2);
    }
    // ⚠️ **scrollFactor 0 只是「不跟着卷动」,不代表「不跟着缩放」** ——
    //    相机 zoom 会把固定层一起放大,于是这张按 1280×720 画的暗角会被放大
    //    1.35 倍,四边的黑边直接跑出屏幕,遮天看起来像「画面中间发暗」。
    //    反向缩放回去,暗角才重新贴在屏幕边上。
    g.setScale(1 / CAMERA_ZOOM);
    g.setAlpha(0);
    this.veilOverlay = g;
  }

  private setupCamera(): void {
    this.cameras.main.startFollow(this.player, true, 0.15, 0.15);
    this.cameras.main.setBounds(0, 0, this.map.worldWidth, this.map.worldHeight);
    this.cameras.main.setDeadzone(40, 40);
    // 镜头拉近。世界坐标与所有数值不变,只是「一屏能看到多少」变小 ——
    // 刷怪/索敌/精英牵引环都按 viewRadius() 换算过,所以它们跟着一起缩放
    this.cameras.main.setZoom(CAMERA_ZOOM);
  }

  private setupInput(): void {
    this.inputManager = new InputManager(this);
    this.inputManager.setup();
  }

  private setupSystems(): void {
    this.relicSystem = new RelicSystem(this, this.player);
    this.weaponSystem = new WeaponSystem(this, this.player, this.enemyPool, this.relicSystem, {
      projectiles: this.projectilePool,
      orbiters: this.orbiterPool,
      zones: this.zonePool,
      sandWaves: this.sandWavePool,
      tornadoPool: this.tornadoPool,
      chainBolts: this.chainBoltPool,
      barriers: this.barrierPool,
    });
    // 开局自带火球术 —— 设计书第一节:主角王林的起始法术
    this.weaponSystem.addSpell(STARTING_SPELL);

    this.realmSystem = new RealmSystem(this, this.player, this.weaponSystem);
    // 突破横幅由 UIScene 播;这里只保证 HUD 的法位数字当场跟上 ——
    // HUD 是拉取式的,不发事件它要等到下一次升级才发现法位变了
    this.realmSystem.onBreakthrough = () => this.refreshHudAfterDebug();
    this.evolutionSystem = new EvolutionSystem(this, this.weaponSystem, this.relicSystem);
    this.chestSystem = new ChestSystem();

    this.spawnSystem = new SpawnSystem(
      this.enemyPool,
      () => ({ x: this.player.x, y: this.player.y }),
      () => this.realmSystem.majorIndex,
      // map() 每次返回新数组 —— Enemy 是池化实体,不能持有活的列表引用
      () => this.weaponSystem.getSpells().map((s) => s.id),
      () => this.relicSystem.getEquipped().map((r) => r.id),
    );

    this.enemyAiSystem = new EnemyAiSystem(this.enemyPool, this.barrierPool, {
      getPlayer: () => this.player,
      damagePlayer: (amount, sx, sy) => this.damagePlayer(amount, sx, sy),
      spawnShot: (x, y, angle, damage, speed) => this.spawnEnemyShot(x, y, angle, damage, speed),
      killEnemy: (enemy) => this.killEnemy(enemy),
      explodeFx: (x, y, radius) => this.spawnExplosionFx(x, y, radius),
      findPickup: (x, y, radius) => this.findNearestPickup(x, y, radius),
      eatPickup: (p) => this.eatPickup(p),
      damageEnemy: (e, amount, x, y) => this.applyDamageToEnemy(e, amount, x, y),
      bossAction: (e) => this.bossSystem.act(e),
    });

    this.mechanismSystem = new MechanismSystem({
      getPlayer: () => ({ x: this.player.x, y: this.player.y }),
      getRealmIndex: () => this.realmSystem.majorIndex,
      spawnEnemy: (id, x, y) => this.spawnSystem.spawnChild(id, x, y),
      spawnPickup: (kind, x, y) => this.spawnPickup(x, y, kind, 0),
      summonTide: () => this.summonBloodTide(),
    });

    this.hazardSystem = new HazardSystem(
      this, this.fireVentPool, this.map.hazard,
      () => this.player,
      (amount, x, y) => this.damagePlayer(amount, x, y),
    );

    this.bossSystem = new BossSystem(this, {
      spawnBoss: (id) => this.spawnBoss(id),
      spawnShot: (x, y, a, dmg, spd, style) => this.spawnEnemyShot(x, y, a, dmg, spd, true, style),
      spawnVent: (x, y, r, warn, erupt, dmg) => this.spawnFireVent(x, y, r, warn, erupt, dmg),
      spawnMeteor: (x, y, r, warn, dmg, color) => this.spawnMeteor(x, y, r, warn, dmg, color),
      spawnFinger: (x, y, r, warn, dmg, color) => this.spawnFinger(x, y, r, warn, dmg, color),
      buffEnemies: (n, hpMul, spdMul, dmgMul) => this.applyFateBuffToWave(n, hpMul, spdMul, dmgMul),
      novaBurst: (x, y, radius, color) => this.spawnSlamRing(x, y, radius, color),
      domainTick: (x, y, radius, damage) => this.onSwordDomainTick(x, y, radius, damage),
      summon: (type, count, maxAlive) => this.summonSwordDisciples(type, count, maxAlive),
      getPlayer: () => this.player,
      // 命数指的提前量要读玩家「正在往哪跑」。Player 是 Arcade Sprite,
      // body.velocity 由 InputManager 每帧写 —— 直接取它,不额外记一份状态
      getPlayerVelocity: () => {
        const b = this.player.body as Phaser.Physics.Arcade.Body;
        return { x: b.velocity.x, y: b.velocity.y };
      },
    });

    this.xpSystem = new XPSystem(this, this.player);
    this.xpSystem.onLevelUp = () => this.handleLevelUp();

    this.syncPlayerStats();
  }

  /**
   * 把「基础 × 境界 × 遗物」折算进 Player 的几个字段。
   *
   * 是一个**纯函数**而不是到处乘进 player:最大生命、移速、拾取半径都被
   * 两个系统各自持有倍率,任何一处直接改 player.maxHealth 都会让另一处的
   * 乘算在下一次重算时被算两遍。
   */
  private syncPlayerStats(): void {
    const mods = this.relicSystem.getPlayerMods();
    const p = this.player;
    const maxHp = Math.max(1, Math.round(BASE_MAX_HEALTH * this.realmSystem.hpMul * mods.maxHealthMul));
    // 回满:换装带来的血量提升不应该变成「亏血」
    if (maxHp !== p.maxHealth) {
      const delta = maxHp - p.maxHealth;
      p.maxHealth = maxHp;
      p.health = Phaser.Math.Clamp(p.health + Math.max(0, delta), 1, maxHp);
    }
    p.moveSpeedMul = mods.moveSpeedMul;
    p.pickupMul = mods.pickupMul;
    p.healthRegen = mods.healthRegen;
  }

  private setupCollisions(): void {
    this.physics.add.collider(this.player, this.obstacles);

    this.physics.add.overlap(
      this.projectilePool, this.enemyPool,
      (_p, _e) => this.onProjectileHitEnemy(_p as Projectile, _e as Enemy),
      (p, e) => {
        const proj = p as Projectile;
        const enemy = e as Enemy;
        if (!proj.active || proj.isDead) return false;
        if (!enemy.active || enemy.isDead) return false;
        if (proj.hitSet.has(enemy)) return false;
        return true;
      },
    );

    this.physics.add.overlap(
      this.player, this.enemyPool,
      (_p, _e) => this.onPlayerHitEnemy(_e as Enemy),
      (_p, _e) => {
        const pl = _p as Player;
        const en = _e as Enemy;
        return pl.active && en.active && !en.isDead && !pl.isDead();
      },
    );

    this.physics.add.overlap(
      this.player, this.enemyShotPool,
      (_p, _s) => this.onPlayerHitShot(_s as EnemyShot),
      (_p, _s) => {
        const shot = _s as EnemyShot;
        const pl = _p as Player;
        return shot.active && !shot.isDead && pl.active && !pl.isDead();
      },
    );

    this.physics.add.overlap(
      this.player, this.pickupPool,
      (_p, _g) => this.onPlayerPickup(_g as Pickup),
      (_p, _g) => {
        const g = _g as Pickup;
        return g.active && !g.isDead;
      },
    );
  }

  update(time: number, delta: number): void {
    if (this.isPaused) return;
    this.elapsed += delta;

    this.inputManager.update();
    const mx = this.inputManager.moveX;
    const my = this.inputManager.moveY;
    const speed = this.player.getMoveSpeed();
    this.player.setVelocity(mx * speed, my * speed);
    // ⚠️ 不要再在这里 setFlipX。四视图之后,翻转是 `Player.updateFacing` 的一部分
    //    —— 只有**侧向**才翻,上下两向翻了没有意义(还会把「背影」变成正脸的镜像)。
    //    外面每帧无条件翻一次,会把这个判断整个盖掉。
    this.player.updateFacing(mx, my);

    if (this.inputManager.consumePause()) this.pauseGame();

    const seconds = this.elapsed / 1000;
    this.weaponSystem.update(time, delta);
    this.spawnSystem.update(seconds, delta);
    this.enemyAiSystem.update(time, delta);
    this.mechanismSystem.update(seconds);
    this.hazardSystem.update(seconds);
    this.bossSystem.update(seconds);

    const veilWant = this.enemyAiSystem.veilActive ? 1 : 0;
    if (Math.abs(this.veilAlpha - veilWant) > 0.002) {
      this.veilAlpha += (veilWant - this.veilAlpha) * 0.05;
      this.veilOverlay.setAlpha(this.veilAlpha);
    }

    this.updatePickupMagnets();

    // 首领的脚下场所(剑阵/法域)。放在 bossSystem.update 之后 ——
    // 它读的是「这一帧首领在哪」,早一步读到的就是上一帧的位置
    this.updateBossDomain(time);
    this.updateBossShield(time);
    this.updateBossCastFx();

    if (this.player.isDead()) this.onPlayerDeath();
  }

  // ===== 内容表自检 =====

  /**
   * 启动时把配置错误顶到台面上,而不是等试玩时才碰见。
   * 「写进表里却拿不到」这类错误在运行时完全安静 —— 没有异常、没有提示,
   * 玩家只会觉得「这个功能好像没反应」。
   */
  private checkContentTables(): void {
    const warn = (label: string, ids: string[]) => {
      if (ids.length > 0) console.warn(label, ids.join(' / '));
    };
    warn('[登场表] 有未知 id / 时间倒序 / 重复登场,或节奏段未递增:', validateIntros());
    warn('[开局强度] 远程怪不得早于 8:00;开局窗口内的怪都应被起手法术一击必杀:', validateOpeningDifficulty());
    warn('[敌人表] 这些怪没有任何生成路径,永远不会出场:', validateEnemyReachability());
    warn('[法术表] 这些法术没有任何获取路径,永远拿不到:', validateSpellReachability());
    warn('[进化表] 配方两端的法术 id 不存在:', validateEvolutionLinks());
    warn('[法术表] 这些神通没有配专属遗物,融合条件永远凑不齐:', validateSpellKeys());
    warn('[首领表] 时间表或阶段配置有问题:', validateBossSchedule());
    // 每件专属遗物都必须挂在一条进化链上,否则它占着卡池位置却换不到该换的融合
    const keyed = new Set(EVOLUTIONS.map((e) => e.keyRelic));
    warn('[遗物表] 这些专属遗物没有对应的进化配方:', validateRelicReachability(keyed));

    // 被「局外成长没接通」挡在池外的条目 —— 这是**有意的**,所以只印一行 info
    // 而不是 warning(每次启动都喊的警告,喊两天就没人看了)。
    // 印它的理由:将来有人发现「灵石袋怎么抽不到」时,控制台里能直接读到答案,
    // 不用去翻配置表再怀疑是自己改坏了。
    if (!META_PROGRESSION_ENABLED) {
      const gated = [
        ...RELIC_IDS.filter((id) => RELICS[id].metaOnly).map((id) => `遗物·${RELICS[id].name}`),
        ...ALL_CONSUMABLES.filter((c) => c.metaOnly).map((c) => `消耗品·${c.name}`),
      ];
      if (gated.length > 0) {
        console.info(
          `[局外成长] 尚未接通,以下条目已挡在卡池与掉落池外(收益无处结算): ${gated.join(' / ')}`,
        );
      }
    }
  }

  // ===== 伤害 =====

  /**
   * 唯一的伤害结算入口。
   *
   * 直射、扇形、连锁、环绕、火海、清屏符 —— 所有来源都走这里,
   * 因为护甲、暴击、状态附着、定身、击杀掉落都只在这一处发生。
   * 新增攻击形态**必须**走它,直接调 enemy.takeDamage 会跳过上面全部。
   */
  private applyDamageToEnemy(
    enemy: Enemy,
    amount: number,
    textX: number,
    textY: number,
    opts?: DamageOptions,
  ): boolean {
    if (!enemy.active || enemy.isDead) return false;
    const now = this.time.now;

    // 免伤窗口:杀戮仙诀的白罩,或闪现落地的无敌。
    //
    // ⚠️ 必须在这里**提前 return**:`takeDamage` 会静默吞掉伤害,但下面那行
    //    spawnDamageText 不看它 —— 照常走完的话,罩子里会飞出 5 秒的满额伤害数字,
    //    玩家会以为自己正在输出。飘字是这一局里唯一的伤害读数,它可以少,
    //    但不能假。免伤期间改为飘一个「免疫」,并**限频**(每 450ms 一次)——
    //    火海/弧带每帧都在打,不限频会刷成一堵字墙。
    if (now < enemy.invulnerableUntil) {
      if (now - this.lastImmuneTextAt > 450) {
        this.lastImmuneTextAt = now;
        this.spawnDamageText(enemy.x, enemy.y - 10, 0, { text: '免疫', color: COLOR_IMMUNE });
      }
      return false;
    }
    const mods = this.relicSystem.getPlayerMods();

    // 护甲减免。armorPen 来自破魔/破防,是这两条遗物与进化的唯一落点
    const pen = opts?.armorPen ?? 0;
    const afterArmor = amount * (1 - Math.max(0, Math.min(0.9, enemy.armor - pen)));

    // 感电:每层让**雷系**伤害更高。它只强化雷系自身,不与任何遗物争利 ——
    // 所以判定条件是「这一发是不是雷」,而不是「这只怪身上有没有感电」
    let dmg = afterArmor;
    const shockStacks = enemy.shockActive(now);
    if (shockStacks > 0 && opts?.element === 'thunder') {
      const thunder = resolveSpell(this.thunderSpellId(), 8);
      dmg *= 1 + shockStacks * (thunder?.shockAmp ?? 0.06);
    }

    let crit = false;
    if (mods.critChance > 0 && Math.random() < mods.critChance) {
      crit = true;
      dmg *= mods.critMul;
    }

    if (opts?.burn) enemy.applyBurn(opts.burn.dps, opts.burn.ms, now, opts.sourceId);
    if (opts?.slow && opts.slow.ms > 0) enemy.applySlow(opts.slow.mul, opts.slow.ms, now);
    if (opts?.shock) {
      const mods = this.relicSystem.getSpellMods(this.thunderSpellId());
      const base = resolveSpell(this.thunderSpellId(), 8);
      const cap = (base?.shockCap ?? 3) + mods.shockCapAdd;
      enemy.applyShock(opts.shock.stacks, opts.shock.ms, now, cap);
    }

    // 定身术:命中时按概率定住。定住的是**动作**,不只是移动
    if (mods.freezeChance > 0 && Math.random() < mods.freezeChance && !enemy.resistFreeze) {
      const wasFrozen = enemy.frozenUntil > now;
      enemy.frozenUntil = Math.max(enemy.frozenUntil, now + mods.freezeMs);
      // 只有「新定住」才放锁链:连续命中只是续时长,链条仍按上一轮的节奏收紧,
      // 否则会叠出一屏残影
      if (!wasFrozen) this.spawnFreezeChainFx(enemy, mods.freezeMs);
    }

    // DPS 统计:记结算后的真实伤害(护甲/暴击/感电都已折完)。
    // DoT 跳伤也走这里,来源靠 Enemy.burnSource 记下的施加者
    this.damageMeter.record(opts?.sourceId ?? 'other', dmg, now);
    const killed = enemy.takeDamage(dmg, now);
    // 暴击的打击感:白闪拉长(普通 80ms → 暴击 160ms)+ 命中点星芒。
    // 放在 takeDamage 之后 —— 那里面刚把 flashUntil 设成普通档,这里压过去
    if (crit) {
      enemy.flashUntil = Math.max(enemy.flashUntil, now + 160);
      this.spawnCritFx(textX, textY);
    }
    // `afterArmor < amount` 就是「护甲真的削掉了这一发」的判据:
    // 护甲被穿透满了(clamp 到 0)时两边相等,不显示 —— 破防流打不出蓝字是**对的**,
    // 蓝字消失本身就是「我穿透了」的反馈
    this.spawnDamageText(textX, textY, Math.round(dmg), { crit, armored: afterArmor < amount });
    if (killed) this.onEnemyKilled(enemy);
    // 吹熄:这一发带 executeBelow 且把目标压到阈值以下时直接抹除。
    //   走静默击杀入口(与自爆同一条)—— 不再弹一个伤害数字,
    //   掉落与击杀计数照常,因为设计书只说它「不产生额外伤害」,没说它不算击杀。
    //   先判 killed 是为了避免刚被这一发打死的目标再走一次亡语与掉落
    else if (opts?.executeBelow && opts.executeBelow > 0 && enemy.active && !enemy.isDead) {
      const threshold = opts.executeBelow * (1 - enemy.executeResist);
      if (enemy.health / enemy.maxHealth < threshold) this.killEnemy(enemy);
    }
    return true;
  }

  /**
   * 当前持有的雷系神通 id。
   *
   * 感电的层数上限与增伤幅度都写在雷系神通的那一行上,而它在进化后会变成
   * 五雷轰顶(上限 5 层、每层 8%)。所以这里必须问「玩家现在拿的是哪一门」,
   * 而不是硬编码基础形态 —— 硬编码会让融合之后的感电阈值永远停在未进化的数值。
   */
  private thunderSpellId(): string {
    return this.weaponSystem.hasSpell('wulei_hong') ? 'wulei_hong' : 'wulei';
  }

  private onProjectileHitEnemy(proj: Projectile, enemy: Enemy): void {
    if (!proj.active || proj.isDead) return;
    if (proj.hitSet.has(enemy)) return;
    proj.hitSet.add(enemy);
    const applied = this.applyDamageToEnemy(enemy, proj.damage, enemy.x, enemy.y - 8, proj.status);
    if (!applied) return;
    proj.onHitEnemy();
  }

  /** 静默击杀 —— 自爆走这条路。不弹伤害数字,其余(掉落/计数/亡语)照常 */
  private killEnemy(enemy: Enemy): void {
    if (!enemy.active || enemy.isDead) return;
    enemy.isDead = true;
    this.onEnemyKilled(enemy);
  }

  private onEnemyKilled(enemy: Enemy): void {
    this.kills++;
    this.spawnPickup(enemy.x, enemy.y, 'xp', enemy.xpValue);
    this.addCoins(Math.max(1, Math.floor(enemy.xpValue * 0.5)));

    // 精英的掉落来自 Enemy.drops(掷骰结果),首领的掉落写死在 BossConfig ——
    // 首领不是掷出来的,没有「掉不掉」这个问题
    const drops = enemy.bossKey
      ? (BOSSES[enemy.bossKey]?.drops ?? []).map((d) => ({ kind: d.kind as PickupKind, payload: d.payload ?? 0 }))
      : enemy.drops;
    for (const d of drops) {
      this.spawnPickup(enemy.x, enemy.y, d.kind, d.payload);
    }

    if (enemy.bossKey) {
      this.bossSystem.onBossKilled();
      this.events.emit(GameEvents.BOSS_KILLED, enemy.bossKey);
    }

    const blast = ENEMIES[enemy.enemyKey]?.mechanism?.deathBlast;
    if (blast) {
      this.spawnExplosionFx(enemy.x, enemy.y, blast.radius);
      const bdx = this.player.x - enemy.x;
      const bdy = this.player.y - enemy.y;
      if (bdx * bdx + bdy * bdy <= blast.radius * blast.radius) {
        this.damagePlayer(blast.damage, enemy.x, enemy.y);
      }
    }

    const split = ENEMIES[enemy.enemyKey]?.splitInto;
    if (split) {
      for (let i = 0; i < split.count; i++) {
        this.spawnSystem.spawnChild(split.type, enemy.x, enemy.y);
      }
    }

    // 死亡动画。⚠️ 首领与精英不能缩到 0.3 倍 —— 那会让「它死了吗」变得不确定
    const scale = enemy.bossKey ? 1 : 0.3;
    this.tweens.add({
      targets: enemy,
      alpha: { from: 1, to: 0 },
      scale: { from: enemy.scale, to: enemy.scale * scale },
      duration: 200,
      onComplete: () => {
        enemy.setActive(false).setVisible(false);
        const body = enemy.body as Phaser.Physics.Arcade.Body;
        body.enable = false;
        body.setVelocity(0, 0);
        enemy.isDead = false;   // 复位等待复用
      },
    });

    this.events.emit(GameEvents.ENEMY_KILLED, enemy);
  }

  // ===== 掉落与拾取 =====

  private spawnPickup(x: number, y: number, kind: PickupKind, payload: number | string): void {
    const p = this.pickupPool.get() as Pickup;
    if (!p) {
      this.grantPickup(kind, payload);
      return;
    }
    p.setup(x, y, kind, payload);
  }

  private onPlayerPickup(gem: Pickup): void {
    if (!gem.active || gem.isDead) return;
    const kind = gem.kind;
    const payload: number | string = kind === 'xp' ? gem.amount : gem.payloadId;
    gem.kill();
    this.grantPickup(kind, payload);
  }

  private updatePickupMagnets(): void {
    const range = this.player.getPickupRange();
    const rangeSq = range * range;
    this.pickupPool.children.iterate((c) => {
      if (!c || !c.active) return true;
      const g = c as Pickup;
      if (g.isDead) return true;
      const dx = this.player.x - g.x;
      const dy = this.player.y - g.y;
      const d2 = dx * dx + dy * dy;
      const body = g.body as Phaser.Physics.Arcade.Body;
      if (d2 < rangeSq) {
        const len = Math.sqrt(d2) || 1;
        body.setVelocity((dx / len) * 350, (dy / len) * 350);
      } else {
        body.setVelocity(0, 0);
      }
      return true;
    });
  }

  /**
   * 收下掉落物。
   *
   * 溢出的遗物折成修为 —— 正因为这个,才不需要一个遗物丢弃界面。
   * 回血与加修为丹药的数值在**拾取时**才算:掉落时的最大生命可能已经变了。
   */
  private grantPickup(kind: PickupKind, payload: number | string): void {
    switch (kind) {
      case 'xp': {
        const base = typeof payload === 'number' ? payload : 1;
        // 聚灵珠:只放大**宝石本身**的修为量。加修为丹药(xpPill)与遗物槽满时的
        // 溢出折算(addXpOverflow)都不走这里 —— 那两处是补偿机制,见 julingzhu 的注释
        const exact = base * this.relicSystem.getPlayerMods().xpMul;
        let amount = Math.floor(exact);
        this.xpCarry += exact - amount;
        // 攒满一整点就发出去。倍率恒 ≥1,所以 amount 至少等于 base ——
        // 不会出现「倍率生效了、这一颗宝石反而少给」的情况
        if (this.xpCarry >= 1) {
          amount += 1;
          this.xpCarry -= 1;
        }
        this.xpSystem.add(amount);
        this.events.emit(GameEvents.XP_COLLECTED, amount);
        return;
      }

      case 'relic': {
        const taken = this.relicSystem.equip(String(payload));
        if (taken) {
          this.syncPlayerStats();
        } else {
          this.addXpOverflow();
        }
        return;
      }

      case 'heal': {
        const before = this.player.health;
        this.player.heal(Math.round(this.player.maxHealth * HEAL_PILL_FRACTION));
        const actual = Math.round(this.player.health - before);
        if (actual > 0) {
          this.spawnDamageText(this.player.x, this.player.y - 20, actual, { color: '#66ff88' });
          this.player.healed(actual);
        }
        return;
      }

      case 'xpPill': {
        const amount = Math.floor(this.xpSystem.getXpToNext() * XP_PILL_FRACTION);
        this.xpSystem.add(amount);
        this.spawnDamageText(this.player.x, this.player.y - 20, amount, { color: '#88ccff' });
        this.events.emit(GameEvents.XP_COLLECTED, amount);
        return;
      }

      case 'chest': {
        this.openChest(String(payload));
        return;
      }

      case 'bait': {
        this.spawnExplosionFx(this.player.x, this.player.y, BAIT.radius);
        this.damagePlayer(BAIT.damage, this.player.x, this.player.y);
        return;
      }

      case 'mimic': {
        this.spawnExplosionFx(this.player.x, this.player.y, 30);
        this.spawnSystem.spawnChild(MIMIC_ENEMY_ID, this.player.x, this.player.y);
        return;
      }
    }
  }

  /** 遗物槽满 / 满级时的折算:给当前一级所需的 30% 修为 */
  private addXpOverflow(): void {
    const amount = Math.max(1, Math.floor(this.xpSystem.getXpToNext() * 0.3));
    this.xpSystem.add(amount);
    this.spawnDamageText(this.player.x, this.player.y - 20, amount, { color: '#c8b070' });
  }

  public addCoins(amount: number): void {
    const m = this.relicSystem.getPlayerMods().coinMul;
    this.coins += Math.max(1, Math.round(amount * m));
    this.events.emit(GameEvents.COINS_CHANGED, this.coins);
  }

  private findNearestPickup(x: number, y: number, radius: number): Pickup | null {
    const children = this.pickupPool.getChildren();
    let best: Pickup | null = null;
    let bestD2 = radius * radius;
    for (let i = 0; i < children.length; i++) {
      const p = children[i] as Pickup;
      if (!p || !p.active || p.isDead) continue;
      const dx = p.x - x;
      const dy = p.y - y;
      const d2 = dx * dx + dy * dy;
      if (d2 < bestD2) {
        bestD2 = d2;
        best = p;
      }
    }
    return best;
  }

  private eatPickup(p: Pickup): void {
    if (!p.active || p.isDead) return;
    p.kill();
    this.spawnExplosionFx(p.x, p.y, 10);
  }

  // ===== 洞府宝箱 =====

  /**
   * 开一件匣子。
   *
   * 开箱**不弹结算框**,而是把 N 次悟道排进队列:玩家会连着做 N 个决策,
   * 「攒匣子一次性开」的爽感正来自这里。
   */
  private openChest(quality: string): void {
    this.chestSystem.open((quality as ChestQuality) || 'wood');
    this.events.emit(GameEvents.CHEST_OBTAINED, quality);
    this.processPicks();
  }

  /**
   * 把排队的悟道一个个弹出来。
   *
   * ⚠️ 顺序要点:道法融合排在**队列之前**(设计书 3.5 规则 2「箱内第 1 个选项
   * 必定是融合,且不占奖励次数」)。所以它先于 takeOne 判定 ——
   * 开了 3 次的玉盒,玩家会拿到 1 次融合 + 3 次正常悟道,共 4 个决策。
   *
   * 规则 3(「若该局再无宝箱,则击杀下一个精英/Boss 直接触发」)没有实现,
   * 因为**精英必掉木匣**:本作里「下一次开箱」总是比「下一只精英」更近,
   * 那条兜底路径永远排不到。
   */
  private processPicks(): void {
    if (this.isPaused) return;
    if (this.evolutionSystem.hasPendingEvolution()) {
      this.showFusionPanel();
      return;
    }
    if (this.chestSystem.takeOne()) {
      this.showInsightPanel();
      return;
    }
    this.events.emit(GameEvents.CHEST_RESOLVED, 0);
  }

  /** 融合面板:只有一张卡,选完接着走队列 */
  private showFusionPanel(): void {
    const st = this.evolutionSystem.readyEvolutions()[0];
    if (!st) return;
    const card: Upgrade = {
      id: `evolve_${st.def.evolved}`,
      type: 'evolve',
      name: `道法融合 · ${st.def.evolvedName}`,
      description: `${st.def.reason}\n专属遗物「${RELICS[st.def.keyRelic]?.name}」将被吸收,腾出一个遗物槽。`,
      iconColor: 0xffcc44,
      apply: () => { this.evolutionSystem.evolve(st.def.base); },
    };
    this.pauseGame();
    this.scene.launch('UpgradeScene', {
      level: this.xpSystem.level,
      cards: [card],
      onSelect: (upgrade: Upgrade) => {
        this.applyUpgrade(upgrade);
        this.scene.stop('UpgradeScene');
        this.resumeGame();
      },
    });
  }

  // ===== 悟道 =====

  private handleLevelUp(): void {
    if (this.isPaused) return;
    const brokeThrough = this.realmSystem.applyLevelUp();
    if (brokeThrough) this.syncPlayerStats();

    this.events.emit(GameEvents.PLAYER_LEVEL_UP, this.xpSystem.level);
    // 普通升级不重置冷却;冷却重置是大境界突破的奖励,在 RealmSystem.applyLevelUp 里
    this.showInsightPanel();
  }

  private showInsightPanel(): void {
    const cards = this.buildInsightCards();
    this.pauseGame();
    this.scene.launch('UpgradeScene', {
      level: this.xpSystem.level,
      cards,
      onSelect: (upgrade: Upgrade) => {
        // 替换卡不在这里生效:槽满时先让玩家挑「换下哪一件」,挑完才装新遗物。
        // 二级面板走 UpgradeScene.scene.restart —— 对运行中的场景再 launch 是空操作,
        // restart 会带着新数据完整走一遍 init/create。
        if (upgrade.needsReplace && !this.relicSystem.hasFreeSlot()) {
          this.showReplacePanel(upgrade);
          return;
        }
        this.applyUpgrade(upgrade);
        this.scene.stop('UpgradeScene');
        // resumeGame 会把还排着队的悟道接着弹出来(见它的注释)。
        // 攒够的修为也要在面板关掉之后再补 —— 在 onSelect 里递归弹面板
        // 会被「对已运行场景再次 launch 是空操作」吃掉
        this.resumeGame();
        this.processPendingLevelUps();
      },
    });
  }

  /**
   * 替换面板:遗物满时选中替换卡后的第二步 —— 从已装备的遗物里挑一件换下。
   *
   * 每张卡列出旧遗物的等级,因为换下的代价就是它的全部等级;
   * 卡的 apply 直接做 replace(oldId → 新遗物),沿用 applyUpgrade 的统一出口,
   * 保证 stats 重算与 UPGRADE_APPLIED 事件一次不漏。
   *
   * 右上角「放弃」:退出替换流程、**本次悟道作废**(新遗物不要了,旧遗物原样保留)。
   * 悟道已经弹出并被选择过,放弃就是玩家对这张替换卡说「不」 —— 它没有回退到
   * 三选一的说法,也没有补偿;队列照常往下走(宝箱开的余下次数不受影响)。
   */
  private showReplacePanel(pending: Upgrade): void {
    const cards: Upgrade[] = this.relicSystem.getEquipped().map((r) => ({
      id: `relicSwap_${r.id}`,
      type: 'relicSwap',
      name: `换下 ${RELICS[r.id].name}`,
      description: `当前 ${r.level} 级 —— 换下即失去它的全部加成,等级不返还`,
      iconColor: RELICS[r.id].color,
      apply: (c: UpgradeContext) => {
        const newId = pending.id.replace(/^newRelic_/, '');
        if (!c.relicSystem.replace(r.id, newId)) c.relicSystem.equip(newId);
      },
    }));
    (this.scene.get('UpgradeScene') as Phaser.Scene).scene.restart({
      level: this.xpSystem.level,
      title: '遗物已满',
      subtitle: `选择要换下的遗物 —— 换上「${pending.name.replace(/^替换获得 /, '')}」(1 级)`,
      cards,
      onSelect: (chosen: Upgrade) => {
        this.applyUpgrade(chosen);
        this.scene.stop('UpgradeScene');
        this.resumeGame();
        this.processPendingLevelUps();
      },
      onCancel: () => {
        this.scene.stop('UpgradeScene');
        this.resumeGame();
        this.processPendingLevelUps();
      },
    });
  }

  /** XPSystem.add 一次只升一级。选完卡之后把欠下的等级补上 */
  private processPendingLevelUps(): void {
    while (this.xpSystem.getXp() >= this.xpSystem.getXpToNext()) {
      if (this.isPaused) return;
      this.handleLevelUp();
      if (this.isPaused) return;
    }
  }

  /**
   * 悟道三选一。
   *
   * 抽的是**类别**(新法术 / 法术升级 / 新遗物 / 遗物叠层 / 消耗品),
   * 按设计书 3.3 的权重抽一个还有货的类别,再从那一类里随机取具体条目。
   * 抽类别而不是抽条目,是为了让「还没学新法术的玩家」总能拿到法术卡 ——
   * 逐条抽的话,六门法术里已学会五门时,新法术只剩 1/6 概率露面。
   *
   * 保底:还有空槽时,三张卡里至少一张是「未拥有项」。
   */
  private buildInsightCards(): Upgrade[] {
    const buckets: Record<string, Upgrade[]> = {
      newSpell: this.cardsNewSpell(),
      spellLevel: this.cardsSpellLevel(),
      newRelic: this.cardsNewRelic(),
      // 专属 / 通用分桶出卡:桶内均匀抽取,合在一起会让专属祭炼卡
      // 被通用遗物稀释成 1/6 —— 而它是道法融合的门槛。见 CARD_WEIGHTS 注释
      relicLevelKey: this.cardsRelicLevel(true),
      relicLevel: this.cardsRelicLevel(false),
      consumable: CONSUMABLES.map(consumableCard),
    };
    const order = Object.keys(CARD_WEIGHTS) as Array<keyof typeof CARD_WEIGHTS>;

    const picks: Upgrade[] = [];
    while (picks.length < 3) {
      const avail = order.filter((k) => buckets[k] && buckets[k].length > 0);
      if (avail.length === 0) break;
      // 保底:还有空槽时,本次一定要给一张「未拥有项」
      const needNew = picks.length === 0 && (buckets.newSpell.length > 0 || buckets.newRelic.length > 0);
      const pool = needNew ? avail.filter((k) => k === 'newSpell' || k === 'newRelic') : avail;
      const from = this.pickWeighted(pool.length ? pool : avail);
      if (!from) break;
      // ⚠️ 不按类别去重 —— 只把已经抽走的那一张 splice 掉。
      //
      // 曾经这里有一个 usedTypes 集合,每个类别最多出一张。它看起来只是「让三张卡
      // 更不一样」,实际后果是:当某一类(比如「法术升级」)别人满了而空掉时,
      // 这一轮就只能凑出**两张**卡。而面板是按 cards.length 渲染的,
      // 于是玩家会看到一个只有两个选项的三选一 —— 而且完全不知道少了什么。
      // 「两门法术各升一级」本来就是正常的组合,类别内出两张没有坏处。
      const arr = buckets[from];
      picks.push(arr.splice(Math.floor(Math.random() * arr.length), 1)[0]);
    }
    // 永远补齐三张。消耗品是设计里写明的兜底池(「法术与遗物全满后只出消耗品」),
    // 所以缺什么就用它补 —— 一个三选一面板不该因为某一类空了就变成两选一
    if (picks.length < 3) {
      for (const c of MathUtils.shuffle(CONSUMABLES.slice())) {
        if (picks.length >= 3) break;
        picks.push(consumableCard(c));
      }
    }
    return picks;
  }

  /** 未掌握的基础神通。已融合的形态不在池里(它们只能靠融合拿到) */
  private cardsNewSpell(): Upgrade[] {
    if (this.weaponSystem.getSpellCount() >= this.weaponSystem.getSlotCap()) return [];
    return BASE_SPELL_IDS
      // 融合过的不再出现:法术 id 已经变成进化形态,而钥匙被吞掉了
      // (两条都由 WeaponSystem / EvolutionSystem 回答,不在这里各判一次)
      .filter((id) => !this.weaponSystem.hasSpell(id) && !this.weaponSystem.hasEvolvedForm(id))
      .map((id) => {
        const def = SPELLS[id];
        return {
          id: `newSpell_${id}`,
          type: 'newSpell' as const,
          name: `参悟 ${def.name}`,
          description: `${def.desc}`,
          iconColor: def.color,
          apply: (c: UpgradeContext) => { c.weaponSystem.addSpell(id); },
        };
      });
  }

  private cardsSpellLevel(): Upgrade[] {
    return this.weaponSystem.getSpells()
      .filter((s) => this.weaponSystem.canLevelUp(s.id))
      .map((s) => {
        const def = SPELLS[s.id];
        const row = resolveSpell(s.id, s.level + 1);
        return {
          id: `spellLevel_${s.id}`,
          type: 'spellLevel' as const,
          name: `${def.name} 精进至 ${s.level + 1} 级`,
          // 机制节点必须写出来 —— 否则那张卡在玩家眼里与别的升级卡毫无区别
          description: row
            ? (row.note || `本级伤害 ${row.damage}(当前 ${resolveSpell(s.id, s.level)?.damage})`)
            : '',
          iconColor: def.color,
          apply: (c: UpgradeContext) => {
            if (c.weaponSystem.levelUp(s.id)) this.events.emit(GameEvents.SPELL_LEVEL_UP, s.id, s.level + 1);
          },
        };
      });
  }

  /**
   * 未拥有的遗物。
   *
   * 专属遗物只在**已学会对应神通**时进池 —— 抽到「仙剑」却没学剑阵是废牌,
   * 这正是「专属遗物门槛」那条规则的实际收益。
   *
   * 读 `POOL_RELIC_IDS` 而不是 `RELIC_IDS`:后者是「定义了哪些遗物」(贴图枚举用),
   * 前者才是「玩家能拿到哪些」—— 收益还没接上的那件(灵石（财）)在这里被挡掉。
   *
   * 槽满时**不再把这一类整段清空**:六槽已满只意味着「不能白拿」,
   * 不意味着「池子干了」。此时出的是替换卡(needsReplace),选中后
   * 先弹出「换下哪一件」的二级面板再生效 —— 玩家手握取舍权,而不是
   * 遗物一满三选一就退化成纯消耗品轮盘。
   */
  private cardsNewRelic(): Upgrade[] {
    const free = this.relicSystem.hasFreeSlot();
    return POOL_RELIC_IDS
      .filter((id) => !this.relicSystem.has(id) && !this.evolutionSystem.isRelicSpent(id))
      .filter((id) => {
        const ex = RELICS[id].exclusive;
        return !ex || this.weaponSystem.hasSpell(ex);
      })
      .map((id) => {
        const replace = !free;
        return {
          id: `newRelic_${id}`,
          type: 'newRelic' as const,
          name: replace ? `替换获得 ${RELICS[id].name}` : `获得 ${RELICS[id].name}`,
          description: replace
            ? `遗物已满 —— 选中后可选择换下一件已有的遗物(1 级起,原等级不返还)\n${RELICS[id].desc(1)}`
            : RELICS[id].desc(1),
          iconColor: RELICS[id].color,
          needsReplace: replace,
          apply: (c: UpgradeContext) => { c.relicSystem.equip(id); },
        };
      });
  }

  /**
   * 已装备遗物的「祭炼」卡。满级(5 级)的不出现。
   *
   * @param keyOnly 只要**专属**遗物(融合的钥匙)。卡池把它单独当一类摇,
   *   因为桶内是均匀抽取 —— 混在一起时专属卡会被通用遗物按件数稀释,
   *   而它承担的是「解锁道法融合」这个门槛,不是普通数值收益。
   *   (专属遗物必然对应一门已学会的神通:两条入池路径都卡了这个门槛)
   */
  private cardsRelicLevel(keyOnly: boolean): Upgrade[] {
    return this.relicSystem.getEquipped()
      .filter((r) => this.relicSystem.canUpgrade(r.id))
      // ⚠️ 必须是「=== keyOnly」的二分,不能用 `!keyOnly || isExclusive`:
      // 后者在通用桶(keyOnly=false)里放行一切,专属遗物同时落进两个桶,
      // 两桶都被摇中就会出两张一模一样的祭炼卡(实测出现过)。
      .filter((r) => !!RELICS[r.id].exclusive === keyOnly)
      .map((r) => ({
        id: `relicLevel_${r.id}`,
        type: 'relicLevel' as const,
        name: `${RELICS[r.id].name} 祭炼至 ${r.level + 1} 级`,
        description: RELICS[r.id].desc(r.level + 1),
        iconColor: RELICS[r.id].color,
        apply: (c: UpgradeContext) => { c.relicSystem.upgrade(r.id); },
      }));
  }

  public applyUpgrade(upgrade: Upgrade): void {
    upgrade.apply({
      player: this.player,
      weaponSystem: this.weaponSystem,
      relicSystem: this.relicSystem,
      damageAllEnemies: (amount: number) => this.damageAllEnemies(amount),
      addCoins: (amount: number) => this.addCoins(amount),
      level: this.xpSystem.level,
    });
    this.syncPlayerStats();
    this.events.emit(GameEvents.UPGRADE_APPLIED, upgrade);
  }

  /** 清屏符:一次对全场造成伤害。走统一的伤害入口,击杀掉落照常 */
  private damageAllEnemies(amount: number): void {
    const children = this.enemyPool.getChildren();
    for (let i = 0; i < children.length; i++) {
      const e = children[i] as Enemy;
      if (!e || !e.active || e.isDead) continue;
      this.applyDamageToEnemy(e, amount, e.x, e.y - 8);
    }
  }

  /** 按 CARD_WEIGHTS 从候选类别里挑一个 */
  private pickWeighted(avail: string[]): keyof typeof CARD_WEIGHTS | null {
    if (avail.length === 0) return null;
    const total = avail.reduce((s, k) => s + CARD_WEIGHTS[k as keyof typeof CARD_WEIGHTS], 0);
    let r = Math.random() * total;
    for (const k of avail) {
      r -= CARD_WEIGHTS[k as keyof typeof CARD_WEIGHTS];
      if (r <= 0) return k as keyof typeof CARD_WEIGHTS;
    }
    return avail[avail.length - 1] as keyof typeof CARD_WEIGHTS;
  }

  // ===== 敌人 / 危害 =====

  private spawnEnemyShot(
    x: number, y: number, angle: number, damage: number, speed: number,
    fromBoss = false, style?: ShotStyle,
  ): void {
    const shot = this.enemyShotPool.get() as EnemyShot;
    if (!shot) return;
    shot.setup(x, y, angle, damage, speed, 3000, fromBoss, style);
  }

  private summonBloodTide(): void {
    const tide = this.bloodTidePool.get() as BloodTide;
    if (!tide) return;
    tide.setup();
  }

  private spawnExplosionFx(x: number, y: number, radius: number): void {
    const img = this.add.image(x, y, 'fx_hit');
    img.setDepth(90);
    img.setScale((radius * 2) / 16);
    img.setAlpha(0.85);
    this.tweens.add({
      targets: img, alpha: 0, scale: img.scale * 1.4, duration: 220,
      onComplete: () => img.destroy(),
    });
  }

  /**
   * 暴击的打击特效:命中点一枚金色星芒,快速放大淡出。
   *
   * 为什么**不做震屏**:在这个项目里,震屏是首领落点/范围技能的专属语言
   * (见 onFingerSlam / onMeteorImpact)。「脚下在震 = 有东西要躲」——
   * 暴击在怪群里每秒可能发生好几次,它要是也震,玩家就再也分不清
   * 哪次震动意味着威胁。暴击的「重」交给白闪拉长 + 星芒 + 数字弹跳
   * 三层去说,手不参与。星芒颜色与 COLOR_CRIT 同一个金 —— 数字与特效必须说同一种话。
   */
  private spawnCritFx(x: number, y: number): void {
    const star = this.add.image(x, y, 'fx_crit');
    star.setDepth(95);
    star.setTint(0xffd166);
    // 无方向纹理,起始角随机 —— 怪堆里同时几颗暴击不会排成一样的姿势
    star.setRotation(Math.random() * Math.PI);
    star.setScale(0.7);
    star.setAlpha(0.95);
    this.tweens.add({
      targets: star,
      scale: 1.6, alpha: 0, rotation: star.rotation + 0.6,
      duration: 200, ease: 'Cubic.Out',
      onComplete: () => star.destroy(),
    });
  }

  /** 首领出场。走 SpawnSystem 的难度口径,但不吃精英掷骰 */
  private spawnBoss(bossId: string): Enemy | null {
    const enemyKey = Object.keys(ENEMIES).find((id) => ENEMIES[id].boss === bossId);
    if (!enemyKey) return null;
    const e = this.enemyPool.get() as Enemy;
    if (!e) return null;
    e.currentRealmIndex = this.realmSystem.majorIndex;
    e.ownedRelics = this.relicSystem.getEquipped().map((r) => r.id);
    e.ownedSpells = this.weaponSystem.getSpells().map((s) => s.id);
    e.setup(enemyKey as keyof typeof ENEMIES, 1, NORMAL_MUTATION, this.realmSystem.majorIndex);
    const p = this.player;
    const a = Math.random() * Math.PI * 2;
    e.setPosition(p.x + Math.cos(a) * 420, p.y + Math.sin(a) * 420);
    // 登场特效:首领砸进场地。它是最该被看见的一帧,不能只是「多了一只怪」
    this.spawnBossEntranceFx(e.x, e.y, this.bossFxColor(enemyKey));
    return e;
  }

  /**
   * 灵脉地热的地火柱。**只有地图机制走这里** —— 首领的火雨已经改走 spawnMeteor。
   *
   * ⚠️ 颜色是 `MAP_HAZARD_COLOR` 而不是硬编码:三种「火」的色相是玩家判断
   *    「这团火归谁」的唯一线索,而它们必须三者互不相同(见 MapConfig)。
   *    地火从 0xff5522 让位到橙黄 0xff8833,把橙红让给了玩家火海以外的对比空间。
   */
  private spawnFireVent(x: number, y: number, radius: number, warnMs: number, eruptMs: number, damage: number): void {
    const v = this.fireVentPool.get() as FireVent;
    if (!v) return;
    v.setup(x, y, radius, warnMs, eruptMs, 500, damage, this.map.hazard?.color ?? HAZARD_FALLBACK_COLOR);
  }

  /**
   * 朱雀·火雨 —— 一颗从右上斜坠的紫红陨石。
   *
   * 与 `spawnFireVent` 的三条区分线写在 MeteorFall 的头注释里(形态 / 结算 / 色相)。
   * 这里只补一句:**池耗尽就少落一颗**,与火柱/命数指同一口径 ——
   * 压力从来不是伤害承诺,漏一颗只是玩家少躲一次。
   */
  private spawnMeteor(x: number, y: number, radius: number, warnMs: number, damage: number, color: number): void {
    const m = this.meteorPool.get() as MeteorFall;
    if (!m) return;
    m.setup(x, y, radius, warnMs, damage, color);
  }

  /**
   * 陨石触地的一刻。震屏 + 紫红冲击环 + 碎屑。
   *
   * 与 `onFingerSlam` 的差别在克制:命数指是「天命的审判」,震得重、环大;
   * 陨石是一记**快而密**的打击(终阶 2 秒一波、一波 4 颗),每颗都震成那样
   * 会让画面一直抖。所以只留一个短促的轻震,重量交给余烬和冲击环去说。
   */
  private onMeteorImpact(x: number, y: number, radius: number): void {
    this.cameras.main.shake(90, 0.0035);
    this.spawnSlamRing(x, y, radius * 0.85, 0xcc33cc);
    this.spawnFateAshesFx(x, y, radius * 0.8);
  }

  /** 天运·命数指。池耗尽就少落一根 —— 与火柱同一口径:压力不是伤害承诺 */
  private spawnFinger(x: number, y: number, radius: number, warnMs: number, damage: number, color: number): void {
    const f = this.fingerPool.get() as FingerOfFate;
    if (!f) return;
    f.setup(x, y, radius, warnMs, damage, color);
    // 落点预兆:符文框 + 从天垂下的光柱。没有它,玩家只看到地面一个圈在缩,
    // 不知道东西是从哪来的 —— 「从天而降」这件事必须被看见,那是这一招的全部
    this.spawnFingerOmenFx(x, y, radius, warnMs, color);
  }

  /**
   * 命数指触地的一刻。震屏 + 地面冲击环 + 符纸碎屑。
   *
   * 震屏的强度随范围走:它不是装饰,是让「这一下很重」在手上也能感觉到 ——
   * 玩家在密集怪堆里未必看得清落点,但一定感觉得到脚下在震。
   */
  private onFingerSlam(x: number, y: number, radius: number): void {
    this.cameras.main.shake(180, 0.006 + Math.min(0.006, radius / 40000));
    // 地面环是「范围」的收尾陈述 —— 指落之后那个圈仍在,等于把判定区域
    // 又画了一遍给没看清的玩家
    this.spawnSlamRing(x, y, radius, 0xd8b860);
    this.spawnFateAshesFx(x, y, radius);
    this.spawnExplosionFx(x, y, radius * 0.7);
  }

  /**
   * 天运子「命数」的落点:从在场小怪里随机点名镀金。
   *
   * 首领与已镀过的排除在外(规则写在 Enemy.applyFateBuff),
   * 这里先把候选筛出来再洗牌 —— 直接全池洗牌会让「场上只剩 3 只可镀
   * 而 count 是 7」时白白漏掉该镀的那几只。
   */
  private applyFateBuffToWave(count: number, hpMul: number, speedMul: number, damageMul: number): number {
    const candidates = (this.enemyPool.getChildren() as Enemy[])
      .filter((e) => e.active && !e.isDead && !e.bossKey && !e.fateBuffed);
    Phaser.Utils.Array.Shuffle(candidates);
    let n = 0;
    for (const e of candidates.slice(0, count)) {
      if (e.applyFateBuff(hpMul, speedMul, damageMul)) {
        n++;
        // 头上盖一枚命数印记。原先只有「常驻暗金」这一层状态色 ——
        // 玩家看见怪变金了,但不知道是**这一秒**被点的,还是它生来就金
        this.spawnFateMarkFx(e.x, e.y);
      }
    }
    return n;
  }

  private onPlayerHitEnemy(enemy: Enemy): void {
    if (enemy.contactDamage <= 0) return;
    this.damagePlayer(enemy.contactDamage, enemy.x, enemy.y);
  }

  private onPlayerHitShot(shot: EnemyShot): void {
    if (!shot.active || shot.isDead) return;
    // 命中爆焰:用弹体自己的颜色,所以朱雀的火羽炸开是橙金、杂兵的弹是暗红。
    // 这一小片火焰是「这发打中了」唯一的即时反馈 —— 弹体本身一闪就没,
    // 只有一个伤害数字的话,密集弹幕里根本分不清是哪一片打中的你
    //
    // 首领的剑气**额外**补一道顺着飞行方向的斩痕:同是命中,「被剑划了」
    // 与「被火点着了」在体感上不是一件事,只换颜色不足以区分。旋转角直接取
    // 弹体当前的 rotation —— 它已经被拖尾/自转逻辑维护成飞行角了。
    if (shot.fromBoss) {
      this.spawnSwordSlashFx(shot.x, shot.y, Phaser.Math.RadToDeg(shot.rotation), shot.hitColor);
    }
    this.spawnShotBurst(shot.x, shot.y, shot.hitColor);
    shot.kill();
    this.damagePlayer(shot.damage, shot.x, shot.y);
  }

  /** 弹体命中玩家的爆焰。自由图元(不走池),寿命 240ms 后自毁 */
  private spawnShotBurst(x: number, y: number, color: number): void {
    const img = this.add.image(x, y, 'fx_hit');
    img.setDepth(89);
    img.setTint(color);
    img.setScale(0.7);
    img.setAlpha(0.9);
    img.setBlendMode(Phaser.BlendModes.ADD);
    this.tweens.add({
      targets: img, alpha: 0, scale: 2.1, duration: 240,
      onComplete: () => img.destroy(),
    });
  }

  // =======================================================================
  // 首领招式特效
  //
  // 这一组方法的共同约定:
  //   - **自由图元,不走池**。它们寿命都很短(160–420ms),而且频率低
  //     (最快的也是 1.7s 一次),池化省下的那点 GC 抵不上两套生命周期的复杂度。
  //   - **tween 结束后 destroy()**。没有 onComplete 就是泄漏 —— 这是这一组
  //     里最容易犯也最难发现的错(项目对象池约定里专门警告过同一类问题)。
  //   - **一律 ADD 混合**。这些是「光」,不是「贴纸」;不叠加会看起来像 UI。
  //   - 色系由调用侧传入(cfg 里的弹体色),方法本身不写死 Boss 身份 ——
  //     这样加第三只 Boss 时只需要给配置,不需要动这里。
  // =======================================================================

  /**
   * 首领出手阵。前摇期间贴在首领身上的一圈符文。
   *
   * ## 为什么要旋转
   *
   * 前摇只有 0.3 秒,玩家未必盯着首领看。转起来的阵在余光里也是动的 ——
   * 「动」是视野边缘唯一还能被察觉的属性。不转的话它只是首领身上多了个圈,
   * 玩家会以为那是某种状态图标。
   *
   * ## 为什么反向自转一个内层
   *
   * 单层转读起来像「一个转盘」;两层反向转读起来像「一个法阵在运作」。
   * 代价只是多一个 GameObject,而首领出招是每局最该被看清的时刻。
   */
  private spawnBossCastFx(x: number, y: number, color: number): void {
    const outer = this.add.image(x, y, 'fx_boss_cast');
    outer.setDepth(88);
    outer.setTint(color);
    outer.setScale(0.9);
    outer.setAlpha(0.9);
    outer.setBlendMode(Phaser.BlendModes.ADD);
    this.tweens.add({
      targets: outer, angle: 180, scale: 1.25, alpha: 0, duration: 340,
      onComplete: () => outer.destroy(),
    });

    const inner = this.add.image(x, y, 'fx_boss_cast');
    inner.setDepth(88);
    inner.setTint(0xffffff);
    inner.setScale(0.5);
    inner.setAlpha(0.7);
    inner.setBlendMode(Phaser.BlendModes.ADD);
    this.tweens.add({
      targets: inner, angle: -220, scale: 0.8, alpha: 0, duration: 340,
      onComplete: () => inner.destroy(),
    });
  }

  /**
   * 范围招的落点冲击环。
   *
   * `radius` 是游戏的碰撞半径(像素),这张图的环画在 52/64 处,所以
   * 缩放要把「图上的环半径」换算成「真实的碰撞半径」,而不是简单把整图缩到 2r ——
   * 后者会让视觉范围比判定范围大将近 1/4,玩家会觉得自己在环里却没挨打。
   */
  private spawnSlamRing(x: number, y: number, radius: number, color: number): void {
    const ring = this.add.image(x, y, 'fx_ring_slam');
    ring.setDepth(85);
    ring.setTint(color);
    // 52/64 = 图上环半径占整图半径的比例。除它就等于「让环正好等于 radius」
    const base = (radius / (52 / 64)) * 2 / 128;
    ring.setScale(base * 0.55);
    ring.setAlpha(0.95);
    ring.setBlendMode(Phaser.BlendModes.ADD);
    this.tweens.add({
      targets: ring, scale: base, alpha: 0, duration: 320,
      ease: Phaser.Math.Easing.Cubic.Out,
      onComplete: () => ring.destroy(),
    });
  }

  /**
   * 首领登场:一圈符文 + 地面冲击环。
   *
   * 首领是每局的节奏顶点,它出现的那一帧必须「有事发生」。原先 spawnBoss
   * 只是把一只怪摆到玩家 420px 外,没有任何前兆 —— 玩家往往是先挨了一下
   * 剑气球,才反应过来「哦,出 Boss 了」。
   */
  private spawnBossEntranceFx(x: number, y: number, color: number): void {
    // 落地冲击环:大而慢,像有什么东西砸下来了
    const ring = this.add.image(x, y, 'fx_ring_slam');
    ring.setDepth(86);
    ring.setTint(color);
    ring.setScale(0.4);
    ring.setAlpha(0.9);
    ring.setBlendMode(Phaser.BlendModes.ADD);
    this.tweens.add({
      targets: ring, scale: 4.2, alpha: 0, duration: 620,
      ease: Phaser.Math.Easing.Cubic.Out,
      onComplete: () => ring.destroy(),
    });

    // 三重符文,错开一点时间升上去 —— 比一次性全放更「隆」
    for (let i = 0; i < 3; i++) {
      const seal = this.add.image(x, y, 'fx_boss_cast');
      seal.setDepth(87);
      seal.setTint(color);
      seal.setScale(1.2 + i * 0.5);
      seal.setAlpha(0.85 - i * 0.15);
      seal.setBlendMode(Phaser.BlendModes.ADD);
      this.tweens.add({
        targets: seal,
        angle: i % 2 === 0 ? 260 : -260,
        scale: (1.2 + i * 0.5) * 1.7,
        alpha: 0,
        duration: 520 + i * 90,
        delay: i * 70,
        onComplete: () => seal.destroy(),
      });
    }
  }

  /**
   * 剑气命中/剑阵落点:一道斜向斩痕。
   *
   * 与 `spawnShotBurst` 的区别在于**朝向** —— 剑气是有来向的,一道不分方向的
   * 爆炸会把「被剑砍了」和「被火烧了」读成同一件事。这里用 `angle` 让它
   * 顺着剑气的飞行方向划过去。
   */
  private spawnSwordSlashFx(x: number, y: number, angleDeg: number, color: number): void {
    const slash = this.add.image(x, y, 'fx_swordslash');
    slash.setDepth(89);
    slash.setTint(color);
    slash.setRotation(Phaser.Math.DegToRad(angleDeg));
    slash.setScale(0.8);
    slash.setAlpha(0.95);
    slash.setBlendMode(Phaser.BlendModes.ADD);
    this.tweens.add({
      // 沿自身的 +X 再推出去一点 —— 剑光命中后会「切过去」,不是钉在原地
      targets: slash,
      scaleX: 1.5,
      scaleY: 1.05,
      alpha: 0,
      duration: 220,
      ease: Phaser.Math.Easing.Cubic.Out,
      onComplete: () => slash.destroy(),
    });
  }

  /**
   * 命数指的落点柱 + 天启符框。
   *
   * 这两张图都要**活到指落为止**(warnMs,1.5–1.7 秒),不能像其他特效那样
   * 两三百毫秒就散 —— 它们本身就是预告的一部分。所以这里用 tween 的
   * `duration: warnMs` 而不是一个固定短时长,并且**不淡出到底**:
   * 收到 0.55 左右就停,让 OnSlam 那一帧还看得见东西。
   */
  private spawnFingerOmenFx(x: number, y: number, radius: number, warnMs: number, color: number): void {
    // 地面符文框:等比铺到落点直径,随预警缓慢收缩(与圈同步收紧的观感)
    const frame = this.add.image(x, y, 'fx_sigil_frame');
    frame.setDepth(44); // 贴地,在怪之下
    frame.setTint(color);
    const frameScale = (radius * 2.4) / 128;
    frame.setScale(frameScale * 1.25);
    frame.setAlpha(0.0);
    frame.setBlendMode(Phaser.BlendModes.ADD);
    this.tweens.add({
      targets: frame,
      alpha: 0.75,
      scale: frameScale,
      duration: warnMs,
      ease: Phaser.Math.Easing.Quadratic.Out,
      onComplete: () => {
        this.tweens.add({
          targets: frame, alpha: 0, scale: frameScale * 1.15, duration: 280,
          onComplete: () => frame.destroy(),
        });
      },
    });

    // 光柱:从高处垂到落点。锚点在**底部**(与指尖同高),所以 origin.y = 1,
    // 让它往上长 256px 的图正好接住「看不见的高处」
    const pillar = this.add.image(x, y, 'fx_fatepillar');
    pillar.setDepth(45);
    pillar.setOrigin(0.5, 1);
    pillar.setTint(color);
    pillar.setScale((radius * 2) / 48, 1);
    pillar.setAlpha(0.0);
    pillar.setBlendMode(Phaser.BlendModes.ADD);
    this.tweens.add({
      targets: pillar,
      alpha: 0.8,
      duration: warnMs * 0.75,
      ease: Phaser.Math.Easing.Quadratic.In,
      onComplete: () => {
        this.tweens.add({
          targets: pillar, alpha: 0, scaleY: 1.4, duration: 300,
          onComplete: () => pillar.destroy(),
        });
      },
    });
  }

  /**
   * 定身术触发:两条金色锁链呈 X 交叉锁住敌人,持续整个定身时长。
   *
   * 被定身的怪在 EnemyAiSystem 里整帧跳过(不能移动),所以链条钉在触发
   * 位置上就始终「锁」在怪身上,不需要跟随。动画分三段:环从外侧滑入
   * 收紧(140ms)→ 保持 → 末段 260ms 淡出。怪提前死亡时链条原地淡完,
   * 与命数灰烬同为「放出去就不管」的一次性特效。
   */
  private spawnFreezeChainFx(enemy: Enemy, ms: number): void {
    const x = enemy.x;
    const y = enemy.y;
    const span = Math.max(30, enemy.displayWidth * 1.15);
    const linksPerChain = 5;
    for (const chainAngle of [-Math.PI / 4, Math.PI / 4]) {
      const ux = Math.cos(chainAngle);
      const uy = Math.sin(chainAngle);
      for (let i = 0; i < linksPerChain; i++) {
        const t = (i / (linksPerChain - 1) - 0.5) * span;
        const tx = x + ux * t;
        const ty = y + uy * t;
        const link = this.add.image(tx + ux * t * 0.5, ty + uy * t * 0.5, 'fx_chain_link');
        link.setDepth(58); // 在所有怪(50/52)之上、飘字与首领特效之下
        link.setTint(0xffcc44);
        link.setAlpha(0);
        link.setBlendMode(Phaser.BlendModes.ADD);
        // 相邻环互转 90°,读出「环环相扣」
        link.setRotation(chainAngle + (i % 2 === 0 ? 0 : Math.PI / 2));
        this.tweens.add({
          targets: link, x: tx, y: ty, alpha: 1,
          duration: 140, ease: Phaser.Math.Easing.Quadratic.In,
          onComplete: () => {
            this.tweens.add({
              targets: link, alpha: 0,
              delay: Math.max(0, ms - 400), duration: 260,
              onComplete: () => link.destroy(),
            });
          },
        });
      }
    }
  }

  /** 命数指标记(镀金/印记)。贴在小怪头顶 320ms 后自毁 */
  private spawnFateMarkFx(x: number, y: number): void {
    const mark = this.add.image(x, y - 22, 'fx_fatemark');
    mark.setDepth(92);
    mark.setScale(0.6);
    mark.setAlpha(0.95);
    mark.setBlendMode(Phaser.BlendModes.ADD);
    this.tweens.add({
      targets: mark, y: y - 30, scale: 1.15, angle: 90, alpha: 0, duration: 320,
      ease: Phaser.Math.Easing.Quadratic.Out,
      onComplete: () => mark.destroy(),
    });
  }

  /** 命数指落点的碎屑。比通用爆尘多一层「符纸碎了」的语义 */
  private spawnFateAshesFx(x: number, y: number, radius: number): void {
    const n = 5;
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2 + Math.random() * 0.6;
      const d = radius * (0.3 + Math.random() * 0.5);
      const ash = this.add.image(x, y, 'fx_fateashes');
      ash.setDepth(90);
      ash.setScale(0.8 + Math.random() * 0.5);
      ash.setAlpha(0.9);
      ash.setBlendMode(Phaser.BlendModes.ADD);
      this.tweens.add({
        targets: ash,
        x: x + Math.cos(a) * d,
        y: y + Math.sin(a) * d - 10,
        scale: ash.scale * 1.6,
        alpha: 0,
        duration: 380 + Math.random() * 160,
        ease: Phaser.Math.Easing.Quadratic.Out,
        onComplete: () => ash.destroy(),
      });
    }
  }

  /**
   * 剑域 —— 凌天侯脚下那块「万物皆可斩」的地,贴着首领每帧移动。
   *
   * 与原先的「首领场所」共用同一个图层,但**语义升级了**:
   * 以前它只是一个装饰性的地砖(所有 Boss 都有,纯粹为了场面);
   * 现在它是**有判定的危险区** —— 贴图半径必须等于 `domain.radius`,
   * 玩家看到的那条边就是掉血的边。这是硬约束:视觉与实际判定不一致的
   * 危险区会让玩家彻底不信任何地面标记,连带毁掉火雨那套预警圈。
   *
   * 只有带 `domain` 招式的阶段才显示(目前是凌天侯)。其余 Boss 依旧没有 ——
   * 一个没有判定的地砖装饰,不值得在屏幕最拥挤的一层占位置。
   */
  private updateBossDomain(time: number): void {
    const state = this.bossSystem.domainState();
    if (!state.on) {
      if (this.bossDomain) this.bossDomain.setVisible(false);
      return;
    }
    if (!this.bossDomain) {
      this.bossDomain = this.add.image(0, 0, 'fx_sworddomain');
      this.bossDomain.setDepth(42); // 贴地、在怪之下
      this.bossDomain.setBlendMode(Phaser.BlendModes.ADD);
    }
    this.bossDomain.setVisible(true);
    this.bossDomain.setPosition(state.x, state.y);
    // ⚠️ 贴图是按「半径 80」画的(160×160 的内容圈在 76 左右),
    //    这里按实际 radius 反算缩放 —— 改贴图就必须同步改这个分母,
    //    否则玩家看到的圈与实际判定会错开,那比没有圈更糟。
    this.bossDomain.setScale(state.radius / SWORD_DOMAIN_TEXTURE_RADIUS);
    // 呼吸:0.20 ↔ 0.28,周期约 1.6s。够慢,不会读成闪烁。
    // 比原先的装饰地砖亮一档 —— 它现在是会掉血的东西,必须比背景更醒目
    this.bossDomain.setAlpha(0.24 + Math.sin(time / 260) * 0.04);
    // 色系跟着首领走:凌天侯青灰、天运子青金、朱雀橙金
    this.bossDomain.setTint(this.bossFxColor(this.bossSystem.current?.bossKey ?? ''));
  }

  /**
   * 杀戮仙诀的表现层:四方符印护体。
   *
   * 参考图(仙侠剧护体符阵)的口径 —— 不是一整块玻璃罩,而是**四枚白色
   * 半透明圆形符印**悬在首领身边四个方位:
   *   - 阵整体绕首领缓慢公转(四个方位是活的,不是钉死的十字);
   *   - 每枚符印各自自转,相邻两枚方向相反(顺/逆),阵纹才读得出「在运功」;
   *   - alpha 曲线与大罩时代相同:0–180ms 淡入 → 稳定 → 最后 900ms 脉动,
   *     让「免伤还剩多久」是**看得见**的,玩家才知道什么时候可以再开火。
   */
  private updateBossShield(time: number): void {
    const st = this.bossSystem.shieldState();
    if (!st.on) {
      for (const s of this.bossSigils) s.setVisible(false);
      this.shieldStartedAt = 0;
      return;
    }
    if (this.bossSigils.length === 0) {
      for (let i = 0; i < 4; i++) {
        const s = this.add.image(0, 0, 'fx_sigil');
        s.setDepth(54);
        s.setBlendMode(Phaser.BlendModes.ADD);
        this.bossSigils.push(s);
      }
    }
    if (this.shieldStartedAt === 0) this.shieldStartedAt = time;

    // 阵的公转:约 9 秒一圈 —— 慢到能看清纹样,快到知道它活着
    const orbit = time * 0.0007;
    // 每枚符印的自转:相邻反向(0/2 顺,1/3 逆),视觉上才不是同一张贴图转四份
    for (let i = 0; i < 4; i++) {
      const s = this.bossSigils[i];
      const a = orbit + (i * Math.PI) / 2;
      s.setVisible(true);
      s.setPosition(st.x + Math.cos(a) * st.radius, st.y + Math.sin(a) * st.radius);
      // 与剑域同一套规矩:贴图的内容半径对不上就会大小失真(这里只影响观感)
      s.setScale(st.radius / SIGIL_TEXTURE_RADIUS / 2);
      s.rotation += i % 2 === 0 ? 0.005 : -0.005;
    }

    const age = time - this.shieldStartedAt;
    const left = st.until - time;
    let alpha = 0.75;
    if (age < 180) {
      alpha *= age / 180;
    } else if (left < 900) {
      // 脉动: 0.5 ± 0.5 → 0.55~1.0 的呼吸
      alpha *= 0.55 + 0.45 * (Math.sin(time / 90) * 0.5 + 0.5);
    }
    for (const s of this.bossSigils) s.setAlpha(alpha);
  }

  /**
   * 剑域的一次伤害 tick。
   *
   * ⚠️ **绕开 `damagePlayer` 的 600ms 无敌帧,但保留无敌帧本身。**
   *
   *    `Player.takeDamage` 每次受伤给 600ms 无敌 —— 那是为**弹幕**设计的:
   *    密集弹幕下不设无敌帧,玩家会在几帧内被同一波弹片打死。
   *    但剑域的 tick 是 480–500ms,与 600ms 无敌帧几乎同频:
   *    直接调 damagePlayer 会有**一半以上的 tick 被吞掉**,
   *    「每秒 dps」就变成了一个随机数,配表上的 22/30 全是假的。
   *
   *    所以这里自己判断:如果上一次掉血刚发生过(玩家还在无敌里),
   *    就**跳过这一 tick 并把 tick 计时器拨回**,让 tick 跟着无敌帧重新对齐。
   *    结果是一个诚实的、可预期的每秒伤害,而不是一个被吞掉一半的数值。
   *
   *    这不会让剑域变成秒杀:玩家随时可以走出去,而走出去就该立刻安全。
   */
  private onSwordDomainTick(_x: number, _y: number, _radius: number, damage: number): void {
    const player = this.player;
    if (player.isDead()) return;
    // 无敌中 = 刚刚才被烧过一次,这一 tick 不叠 —— 每秒伤害由此变得可预期
    if (this.time.now < player.invincibleUntil) return;
    this.damagePlayer(damage, player.x, player.y);
  }

  /**
   * 剑肖弟子入场:一道剑光从天钉下 + 地面一圈剑痕扩散。
   *
   * 与命数指的光柱同构,但**短促得多**(260ms 而不是 1500ms):命数指是
   * 「看着它落下来」的重击预告,弟子入场只是「他们来了」的一闪 ——
   * 如果每只弟子都配一段长预告,场上三只同时入场就会变成三次小型演出,
   * 把剑域那条真正需要被看见的边界线淹掉。
   */
  private spawnDiscipleArrivalFx(x: number, y: number): void {
    const color = this.bossFxColor(this.bossSystem.current?.bossKey ?? '');
    const bolt = this.add.image(x, y, 'fx_fatepillar');
    bolt.setDepth(45);
    bolt.setOrigin(0.5, 1);
    bolt.setTint(color);
    bolt.setAlpha(0);
    bolt.setBlendMode(Phaser.BlendModes.ADD);
    this.tweens.add({
      targets: bolt, alpha: 0.85, duration: 90,
      onComplete: () => {
        this.tweens.add({
          targets: bolt, alpha: 0, duration: 190,
          onComplete: () => bolt.destroy(),
        });
      },
    });

    const ring = this.add.image(x, y, 'fx_ring_slam');
    ring.setDepth(44);
    ring.setTint(color);
    ring.setBlendMode(Phaser.BlendModes.ADD);
    ring.setAlpha(0.8);
    ring.setScale(0.25);
    this.tweens.add({
      targets: ring, alpha: 0, scale: 0.95, duration: 320,
      ease: Phaser.Math.Easing.Cubic.Out,
      onComplete: () => ring.destroy(),
    });
  }

  /**
   * 点名剑肖十二子。
   *
   * 落点规则:围绕剑尊**环形均分**撒开,而不是随机 ——
   * 随机撒会在同一侧堆成一坨,玩家只要绕到另一侧就没有压力;
   * 环形均分则无论玩家往哪跑,都会有人挡在路上。这正是这一招的用意:
   * 打断「退到域外慢慢磨」的算盘。
   */
  private summonSwordDisciples(type: string, count: number, maxAlive: number): number {
    const boss = this.bossSystem.current;
    if (!boss || !boss.active || boss.isDead) return 0;

    let alive = 0;
    for (const e of this.enemyPool.getChildren() as Enemy[]) {
      if (e.active && !e.isDead && e.enemyKey === type) alive++;
    }
    const room = Math.max(0, maxAlive - alive);
    const n = Math.min(count, room);
    if (n === 0) return 0;

    // 从一个随机起始角开始,避免每次都在同样的四个方位出现
    const base = Math.random() * Math.PI * 2;
    for (let i = 0; i < n; i++) {
      const a = base + (i / n) * Math.PI * 2;
      const d = 220 + Math.random() * 90;
      const x = boss.x + Math.cos(a) * d;
      const y = boss.y + Math.sin(a) * d;
      this.spawnSystem.spawnChild(type, x, y);
      // 弟子入场的那一帧:一道竖向的剑光从天上钉下来。
      // 没有它,弟子就是「突然出现在那里」的一只怪 —— 而这一招的名字是
      // 「剑肖十二子」,重点在那个「剑」字:他们是被师尊的剑气送来的
      this.spawnDiscipleArrivalFx(x, y);
    }
    return n;
  }

  /**
   * 前摇出手阵的触发。BossSystem 只把「正在前摇」写进 Enemy 的
   * `bossCastFlashUntil`,它不碰画面 —— 这里监听那个字段的**上升沿**
   * (从 0/过期 变成 未来时刻),在那一帧放一次阵。
   *
   * 用上升沿而不是「前摇期间每帧都放」:后者会每帧新建两个 GameObject,
   * 0.3 秒就是 36 个 —— 一个临时的粒子风暴,而不是一个阵。
   */
  private updateBossCastFx(): void {
    const boss = this.bossSystem.current;
    if (!boss || !boss.active || boss.isDead) {
      this.lastCastSeen = 0;
      return;
    }
    const until = boss.bossCastFlashUntil;
    if (until > 0 && until !== this.lastCastSeen) {
      this.lastCastSeen = until;
      this.spawnBossCastFx(boss.x, boss.y, this.bossFxColor(boss.bossKey));
    }
  }

  /** 首领的特效色系。跟着它的弹体色走(见 BossConfig),不写死身份 */
  private bossFxColor(bossKey: string): number {
    switch (bossKey) {
      case 'zhuque': return 0xff8822;
      // 凌天侯:青灰的净荡剑气。比原先司徒南的青白(0x88ddff)更冷更灰一档 ——
      // 他要与天运子的青金(0x44ccbb)、朱雀的橙金同时在场时各自可辨
      case 'lingtianhou': return 0x9db4d0;
      case 'tianyunzi': return 0x44ccbb;
      default: return 0xcccccc;
    }
  }

  private damagePlayer(amount: number, sourceX: number, sourceY: number): void {
    const player = this.player;
    if (player.isDead()) return;
    if (!player.takeDamage(amount, sourceX, sourceY, this.time.now)) return;

    this.spawnDamageText(player.x, player.y - 16, Math.round(amount), { color: '#ff5555' });
    this.events.emit(GameEvents.PLAYER_DAMAGED, player.health);

    // 古神之血 5 级:受击回血,有冷却
    const mods = this.relicSystem.getPlayerMods();
    if (mods.lifestealOnHit > 0) {
      const last = this.lastLifestealAt;
      if (this.time.now - last >= mods.lifestealCdMs) {
        this.lastLifestealAt = this.time.now;
        player.heal(Math.round(player.maxHealth * mods.lifestealOnHit));
      }
    }
  }

  private lastLifestealAt = -9999;
  /** 上一次飘「免疫」的时刻。免伤窗口里每一次命中都飘会刷成字墙 */
  private lastImmuneTextAt = -9999;

  private spawnDamageText(x: number, y: number, value: number, opts: DamageTextOpts = {}): void {
    const t = this.damageTextPool.get() as DamageText;
    if (t) t.setup(x, y, value, opts);
  }

  // ===== 调试面板入口 =====

  /**
   * 调试改完东西之后借 UPGRADE_APPLIED 让 UIScene 重刷面板。
   * HUD 是拉取式的(见 CLAUDE.md):它只在事件里刷新,不会自己发现系统变了。
   */
  private refreshHudAfterDebug(): void {
    this.events.emit(GameEvents.UPGRADE_APPLIED, {
      id: 'debug', type: 'consumable', name: 'debug', description: '', iconColor: 0xffffff,
      apply: () => {},
    } as Upgrade);
  }

  public debugNextSpell(): string {
    // ⚠️ 只轮转**基础**法术。进化形态(焚天·火海 / 化魔指 / 斩罗决…)不能从这里发出去 ——
    //    它们只能由「8 级 + 专属遗物 5 级 + 开箱」得到,绕过这条的调试按钮会让人
    //    以为进化链路是通的,而实战里永远拿不到。要看进化请用「凑齐融合」。
    const ids = BASE_SPELL_IDS;
    const id = ids[this.debugSpellCursor % ids.length];
    this.debugSpellCursor++;
    const def = SPELLS[id];
    if (this.weaponSystem.hasSpell(id)) {
      this.weaponSystem.levelUp(id);
      this.refreshHudAfterDebug();
      return `${def.name} → ${this.weaponSystem.getLevel(id)} 级(${def.form})`;
    }
    if (!this.weaponSystem.addSpell(id)) {
      this.refreshHudAfterDebug();
      return `${def.name} 拿不下:法位已满(${this.weaponSystem.getSpellCount()}/${this.weaponSystem.getSlotCap()})`;
    }
    this.refreshHudAfterDebug();
    return `参悟 ${def.name}(${def.form}) · ${def.desc}`;
  }

  /** 直接开一格法位(模拟突破)。用来单独验证「法位不够时该出什么卡」 */
  public debugAddSlot(): string {
    const cap = Math.min(MAX_SPELL_SLOTS, this.weaponSystem.getSlotCap() + 1);
    this.weaponSystem.setSlotCap(cap);
    this.refreshHudAfterDebug();
    return `法位上限 → ${cap}(已带 ${this.weaponSystem.getSpellCount()} 门)`;
  }

  /**
   * 调试用:把法位抬到「装得下全部基础法术」。
   *
   * ⚠️ **不能写 `setSlotCap(MAX_SPELL_SLOTS)`**。收槽到 5 之后,6 门法术在
   *    5 格里必然有一门发不出去,而按 `BASE_SPELL_IDS` 的顺序,发不出去的
   *    恰好是**最后一门**(龙卷)。后果是「装满神通」只给 5 门却不报错,
   *    「凑齐融合」里 longjuan → hufeng 那条链**永远凑不齐** ——
   *    而调试面板点不通的内容,和坏掉的内容在表现上一模一样。
   *    所以上限按**法术门数**取,加第 7 门法术时这里自动跟上。
   */
  private debugUncapSlots(): void {
    this.weaponSystem.setSlotCap(Math.max(MAX_SPELL_SLOTS, BASE_SPELL_IDS.length));
  }

  /**
   * 把六门**基础**法术一次装满(进化形态走「凑齐融合」,不在这里发)。
   *
   * 同样先把法位开到上限:「装满」这个名字承诺的就是装满,
   * 而开局只有 2 格 —— 不抬上限的话这个按钮会静默地只给两门。
   */
  public debugGrantAllSpells(): string {
    this.debugUncapSlots();
    const names: string[] = [];
    for (const id of BASE_SPELL_IDS) {
      if (this.weaponSystem.hasSpell(id)) continue;
      if (this.weaponSystem.addSpell(id)) names.push(SPELLS[id].name);
    }
    this.refreshHudAfterDebug();
    return names.length
      ? `参悟 ${names.join(' · ')}(法位已开到 ${this.weaponSystem.getSlotCap()})`
      : '六门基础法术都已持有';
  }

  /** 把手上每一门神通都拉到满级 —— 一键验证「8 级手感」 */
  public debugMaxSpells(): string {
    for (const s of this.weaponSystem.getSpells()) {
      let guard = 0;
      while (this.weaponSystem.levelUp(s.id) && guard++ < 20) { /* 推到满级 */ }
    }
    this.refreshHudAfterDebug();
    return this.weaponSystem.getSpells().map((s) => `${SPELLS[s.id].name} ${s.level} 级`).join(' · ');
  }

  /** 填满遗物栏并全部祭炼到 5 级 */
  public debugGrantAllRelics(): string {
    for (const id of RELIC_IDS) this.relicSystem.debugEquip(id);
    this.syncPlayerStats();
    this.refreshHudAfterDebug();
    return `${this.relicSystem.getEquipped().length} 件遗物已就位,遗物槽 ${RELIC_SLOTS}`;
  }

  /**
   * 凑齐**每一条**融合链的三条件,并逐条结算。
   *
   * 条件从 EVOLUTIONS 表读,不手写 id 数组 —— 否则加一条链就会忘了改这里。
   */
  public debugFullEvolution(): string {
    // 法位阶梯(凝气只有 2 格)会把「六门一起凑」卡住 —— 这个按钮的用途是
    // **一次看完全部六条进化链**,所以先把法位开到上限再补法术。
    // 想验「法位不够时卡池怎么变」请用「开一格法位」,不要靠这里。
    this.debugUncapSlots();
    for (const def of EVOLUTIONS) {
      if (!this.weaponSystem.hasSpell(def.base)) this.weaponSystem.addSpell(def.base);
      let guard = 0;
      while (this.weaponSystem.levelUp(def.base) && guard++ < 20) { /* 推到 8 级 */ }
      // ⚠️ 必须用 debugEquip,不能用 equip:后者在遗物槽满时返回 null,
      //    于是「凑齐融合」会**静默地**凑不齐钥匙,只回一句「条件不满足」。
      //    而遗物槽满恰恰是最常见的状态 —— 也就是说这条进化链在调试面板里
      //    根本走不通,而「调试不到的内容」与「坏掉的内容」看起来一模一样。
      //    debugEquip 无视槽位、直接给满级,正是为这种场合准备的。
      this.relicSystem.debugEquip(def.keyRelic);
    }
    const names: string[] = [];
    for (const st of this.evolutionSystem.readyEvolutions()) {
      const n = this.evolutionSystem.evolve(st.def.base);
      if (n) names.push(n);
    }
    this.syncPlayerStats();
    this.refreshHudAfterDebug();
    return names.length ? `融合:${names.join(' · ')}` : '条件不满足(需要 8 级 + 专属遗物 5 级)';
  }

  /**
   * 只凑齐「焚天·火海」与「仙术·呼风」两条融合链。
   *
   * 用途是验证**风助火势**:火球落点铺火海,呼风的弧带刮过把火海吹大。
   * 与「凑齐融合」的差别在那一条把六条链全凑齐,六种特效混在一片里,
   * 没法看清「弧带经过时火海有没有变大」。
   */
  public debugFuseWindFire(): string {
    this.debugUncapSlots();
    for (const baseId of ['fireball', 'longjuan']) {
      const def = findEvolution(baseId);
      if (!def) continue;
      if (!this.weaponSystem.hasSpell(baseId)) this.weaponSystem.addSpell(baseId);
      let guard = 0;
      while (this.weaponSystem.levelUp(baseId) && guard++ < 20) { /* 推到 8 级 */ }
      // debugEquip 而不是 equip 的理由见 debugFullEvolution 里的长注释
      this.relicSystem.debugEquip(def.keyRelic);
    }
    const names: string[] = [];
    for (const st of this.evolutionSystem.readyEvolutions()) {
      if (st.def.base !== 'fireball' && st.def.base !== 'longjuan') continue;
      const n = this.evolutionSystem.evolve(st.def.base);
      if (n) names.push(n);
    }
    this.syncPlayerStats();
    this.refreshHudAfterDebug();
    return names.length ? `融合:${names.join(' · ')}` : '条件不满足(需要 8 级 + 专属遗物 5 级)';
  }

  /** 开一次金匮(5 次悟道)。用来验证宝箱队列与融合插队 */
  public debugOpenChest(): string {
    this.openChest('gold');
    return `金匮已开 · 剩余悟道 ${this.chestSystem.remaining} 次`;
  }

  public debugSpawnAllMonsters(): string {
    const ids = Object.keys(ENEMIES).filter((id) => !ENEMIES[id].boss);
    const px = this.player.x;
    const py = this.player.y;
    ids.forEach((id, i) => {
      const a = (i / ids.length) * Math.PI * 2;
      this.spawnSystem.spawnChild(id, px + Math.cos(a) * 220, py + Math.sin(a) * 220);
    });
    return `刷出 ${ids.length} 种怪`;
  }

  public debugSpawnElite(): string {
    this.spawnSystem.spawnChild('stone_puppet', this.player.x + 260, this.player.y, true);
    return '刷出精英 · 石傀(天生牵引抗性 + 35% 护甲)';
  }

  public debugFireMechanism(): string {
    const id = this.mechanismSystem.forceFire();
    return id ? `投放机制怪:${id}` : '当前境界没有可投放的机制怪';
  }

  public debugNextMechanism(): string {
    const ids = Object.keys(ENEMIES).filter((k) => ENEMIES[k].mechanism);
    const id = ids[this.debugMechCursor % ids.length];
    this.debugMechCursor++;
    const a = Math.random() * Math.PI * 2;
    this.spawnSystem.spawnChild(id, this.player.x + Math.cos(a) * 300, this.player.y + Math.sin(a) * 300);
    return `刷出 ${ENEMIES[id].name}(${this.debugMechCursor}/${ids.length})`;
  }

  /** 依次放每只首领 —— 时间表只有一只,但调试要能挨个看 */
  public debugNextBoss(): string {
    const ids = Object.keys(BOSSES);
    const id = ids[this.debugBossCursor % ids.length];
    this.debugBossCursor++;
    return this.bossSystem.forceSpawn(id);
  }

  /**
   * 弧带形态一览:把「单道窄弧 / 3 道分开的弧弹 / 呼风的全周一圈」并排摆开。
   *
   * 形态是「看一眼才知道对不对」的东西。而龙卷的弧角要从脚下慢慢转出来,
   * 基础形态与呼风又**不可能同时出现在同一块地上**(一个是 3 道 50° 的弯弹,
   * 一个是一整圈),所以这里绕开 WeaponSystem 直接按配置把三种弧带摆在
   * 玩家四周,一次性看清「窄弧」与「整圈」的差别。
   *
   * ⚠️ 演示用的这几道**伤害固定 1 点**:一来不会把怪打死(挡着视野),
   *    二来伤害数字正好在画面上把「弧带覆盖到谁」标出来 —— 弧之外不弹字,
   *    这就是「只有碰撞到的敌人才结算」最直接的验收方式。
   */
  public debugArcShapes(): string {
    const cx = this.player.x;
    const cy = this.player.y;
    // [法术 id, 等级, 落点相对玩家的 x/y, 朝向(弧度,向上 = -π/2)]
    const shots: Array<[string, number, number, number, number]> = [
      ['longjuan', 1, -230, 40, -Math.PI / 2],
      ['longjuan', 8, 0, 40, -Math.PI / 2],
      ['hufeng', 1, 230, 40, -Math.PI / 2],
    ];
    let arcs = 0;
    for (const [id, lv, dx, dy, face] of shots) {
      arcs += this.spawnArcPreview(id, lv, cx + dx, cy + dy, face);
    }
    return `弧带形态 ×${shots.length} 次(${arcs} 道):左=龙卷1级单道50° / 中=龙卷8级3道 / 右=呼风8道全周`;
  }

  /** debugArcShapes 的落点实现:按配置摆一次弧带,伤害固定 1 点 */
  private spawnArcPreview(id: string, level: number, x: number, y: number, facing: number): number {
    const sp = resolveSpell(id, level);
    if (!sp) return 0;
    const count = Math.max(1, sp.count);
    const sub = sp.arcSpan / count;
    const start = facing - sp.arcSpan / 2;
    // 与 WeaponSystem.fireArc 同一套算法:arcWidth 有值就是窄弧,没有才是首尾相接
    const perArc = sp.arcWidth > 0 ? sp.arcWidth : sub;
    const hits = new Map<Enemy, number>();
    let n = 0;
    for (let i = 0; i < count; i++) {
      const t = this.tornadoPool.get() as Tornado | null;
      if (!t) break;
      t.setup(x, y, start + sub * (i + 0.5), perArc, sp.arcRadius, 1,
        sp.pullPx / 0.25, 250, sp.lifeMs, sp.color, sp.arcSweep, hits, sp.texture);
      n++;
    }
    return n;
  }

  /** 把当前首领的血量直接压到指定比例,用来快速验证阶段切换(剑域半径突变) */
  public debugBossToPhase(ratio: number): string {
    const e = this.bossSystem.current;
    if (!e || !e.active || e.isDead) return '场上没有首领';
    e.health = Math.max(1, e.maxHealth * ratio);
    return `首领血量压到 ${Math.round(ratio * 100)}%`;
  }

  /** 直接跳到某个时刻,用来验证 Boss 时间表与节奏 */
  public debugSetTime(seconds: number): string {    this.elapsed = seconds * 1000;
    return `时间跳到 ${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, '0')}`;
  }

  // ===== 暂停与结算 =====

  public pauseGame(emitEvent = true): void {
    this.isPaused = true;
    this.physics.world.pause();
    this.enemyPool.children.iterate((c) => {
      if (!c) return true;
      const sprite = c as Phaser.Physics.Arcade.Sprite;
      const body = sprite.body as Phaser.Physics.Arcade.Body | null;
      if (body) body.setVelocity(0, 0);
      return true;
    });
    // 这里**不**清投射物速度:physics.world.pause() 会让物理步整帧早退,
    // 清了之后飞行中的投射物在恢复时速度仍是 0,会原地悬停到寿命结束
    this.tweens.pauseAll();
    if (emitEvent) this.events.emit(GameEvents.GAME_PAUSE);
  }

  public resumeGame(): void {
    this.isPaused = false;
    this.physics.world.resume();
    this.tweens.resumeAll();
    this.events.emit(GameEvents.GAME_RESUME);
    // 恢复时把还排着队的悟道接着弹出来。
    //
    // 为什么必须在这里兜一下:开箱入队时游戏可能正暂停(调试面板点「开金匮」时
    // 就是这种情况),那时 processPicks 会直接返回,队列就静静地烂在那儿 ——
    // 玩家看到的是「点了没反应」。这里的条件是「面板没开着」,
    // 因为悟道面板自己也靠 pauseGame/resumeGame 工作,不加这个判断会重复 launch
    // (对已运行场景 launch 是空操作,队列会卡死)。
    if (!this.scene.isActive('UpgradeScene')) this.processPicks();
  }

  private onPlayerDeath(): void {
    if (this.deathHandled) return;
    this.deathHandled = true;
    const timeSec = Math.floor(this.elapsed / 1000);
    const isNewRecordTime = timeSec > SaveManager.getBestTime();
    const isNewRecordKills = this.kills > SaveManager.getBestKills();
    if (isNewRecordTime) SaveManager.setBestTime(timeSec);
    if (isNewRecordKills) SaveManager.setBestKills(this.kills);
    SaveManager.addCoins(this.coins);
    SaveManager.incTotalRuns();

    // HUD 必须在这里停掉,而不是等到结算页的按钮被点。
    //
    // UIScene 是并行 launch 的独立场景,GameScene 自己 stop 不会带走它 —— 于是
    // 死亡画面上那个暂停按钮(右上角)还活着,点它会在结算面板上再叠一层暂停遮罩。
    // 手机上尤其明显:暂停键本来就小,玩家习惯性地往右上角一按就中招。
    this.scene.stop('UIScene');

    this.scene.launch('GameOverScene', {
      time: timeSec,
      kills: this.kills,
      level: this.xpSystem.level,
      realmName: this.realmSystem.getDisplayName(),
      coins: this.coins,
      relics: this.relicSystem.getEquipped().map((r) => r.id),
      newRecordTime: isNewRecordTime,
      newRecordKills: isNewRecordKills,
    });
    // 用 stop 而不是 pause —— pause 后 GameOverScene 的 scene.start 可能只 resume
    // 不走 SHUTDOWN,旧 InputManager 不销毁、create() 不重调,玩家就无法操作。
    // stop 让 GameScene 彻底关停,再来一局时 scene.start 是全新启动
    this.scene.stop();
  }
}
