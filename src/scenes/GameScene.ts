import Phaser from 'phaser';
import { Player } from '../entities/Player';
import { Enemy } from '../entities/Enemy';
import { EnemyShot } from '../entities/EnemyShot';
import { BloodTide } from '../entities/BloodTide';
import { Projectile } from '../entities/Projectile';
import { Pickup } from '../entities/Pickup';
import { Orbiter } from '../entities/attacks/Orbiter';
import { Zone } from '../entities/attacks/Zone';
import { SandWave } from '../entities/attacks/SandWave';
import { ChainBolt } from '../entities/attacks/ChainBolt';
import { Barrier } from '../entities/attacks/Barrier';
import { FireVent } from '../entities/Hazards/FireVent';
import { DamageText } from '../entities/DamageText';
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
import { GAME_WIDTH, GAME_HEIGHT } from '../config/GameConfig';
import { getMap, DEFAULT_MAP_ID } from '../config/MapConfig';
import type { MapDef } from '../config/MapConfig';
import { SPELLS, BASE_SPELL_IDS, STARTING_SPELL, MAX_SPELL_SLOTS, resolveSpell,
  validateSpellReachability, validateEvolutionLinks, validateSpellKeys } from '../config/SpellConfig';
import { RELICS, RELIC_IDS, RELIC_SLOTS, validateRelicReachability } from '../config/RelicConfig';
import { BOSSES } from '../config/BossConfig';
import { validateBossSchedule } from '../config/BossConfig';
import { EVOLUTIONS } from '../config/EvolutionConfig';
import { HEAL_PILL_FRACTION, XP_PILL_FRACTION } from '../config/EliteConfig';
import { CONSUMABLES, CARD_WEIGHTS, consumableCard } from '../config/CultivationUpgradeConfig';
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
  public chainBoltPool!: Phaser.GameObjects.Group;
  public barrierPool!: Phaser.GameObjects.Group;
  public fireVentPool!: Phaser.GameObjects.Group;

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

  // 状态
  public isPaused = false;
  public elapsed = 0;
  public kills = 0;
  /** 灵石。局外强化树还没做,这里只累计、存取档、展示 */
  public coins = 0;
  /** 当前地图 */
  public map: MapDef = getMap(DEFAULT_MAP_ID);
  /** 是否已经结算过死亡 */
  private deathHandled = false;

  private veilOverlay!: Phaser.GameObjects.Graphics;
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
    this.chainBoltPool = this.add.group({ runChildUpdate: false, classType: ChainBolt, maxSize: 10 });
    this.barrierPool = this.add.group({ runChildUpdate: false, classType: Barrier, maxSize: 3 });
    // 火柱:预警 1.2s + 喷发 1.6s = 2.8s 一根,8 秒喷 2 根 —— 6 个足够
    this.fireVentPool = this.add.group({ runChildUpdate: false, classType: FireVent, maxSize: 6 });

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
    for (let i = 0; i < 60; i++) {
      const s = new EnemyShot(this);
      s.setActive(false).setVisible(false);
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
    g.setAlpha(0);
    this.veilOverlay = g;
  }

  private setupCamera(): void {
    this.cameras.main.startFollow(this.player, true, 0.15, 0.15);
    this.cameras.main.setBounds(0, 0, this.map.worldWidth, this.map.worldHeight);
    this.cameras.main.setDeadzone(40, 40);
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
      spawnShot: (x, y, a, dmg, spd) => this.spawnEnemyShot(x, y, a, dmg, spd, true),
      spawnVent: (x, y, r, warn, erupt, dmg) => this.spawnFireVent(x, y, r, warn, erupt, dmg),
      getPlayer: () => this.player,
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
    p.moveSpeedMul = this.realmSystem.speedMul * mods.moveSpeedMul;
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

    if (opts?.burn) enemy.applyBurn(opts.burn.dps, opts.burn.ms, now);
    if (opts?.slow && opts.slow.ms > 0) enemy.applySlow(opts.slow.mul, opts.slow.ms, now);
    if (opts?.shock) {
      const mods = this.relicSystem.getSpellMods(this.thunderSpellId());
      const base = resolveSpell(this.thunderSpellId(), 8);
      const cap = (base?.shockCap ?? 3) + mods.shockCapAdd;
      enemy.applyShock(opts.shock.stacks, opts.shock.ms, now, cap);
    }

    // 定身术:命中时按概率定住。定住的是**动作**,不只是移动
    if (mods.freezeChance > 0 && Math.random() < mods.freezeChance && !enemy.resistFreeze) {
      enemy.frozenUntil = Math.max(enemy.frozenUntil, now + mods.freezeMs);
    }

    const killed = enemy.takeDamage(dmg, now);
    // `afterArmor < amount` 就是「护甲真的削掉了这一发」的判据:
    // 护甲被穿透满了(clamp 到 0)时两边相等,不显示 —— 破防流打不出蓝字是**对的**,
    // 蓝字消失本身就是「我穿透了」的反馈
    this.spawnDamageText(textX, textY, Math.round(dmg), { crit, armored: afterArmor < amount });
    if (killed) this.onEnemyKilled(enemy);
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
        const amount = typeof payload === 'number' ? payload : 1;
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
    this.weaponSystem.resetCooldowns();
    this.showInsightPanel();
  }

  private showInsightPanel(): void {
    const cards = this.buildInsightCards();
    this.pauseGame();
    this.scene.launch('UpgradeScene', {
      level: this.xpSystem.level,
      cards,
      onSelect: (upgrade: Upgrade) => {
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
   * 逐条抽的话,五门法术里已学会四门时,新法术只剩 1/4 概率露面。
   *
   * 保底:还有空槽时,三张卡里至少一张是「未拥有项」。
   */
  private buildInsightCards(): Upgrade[] {
    const buckets: Record<string, Upgrade[]> = {
      newSpell: this.cardsNewSpell(),
      spellLevel: this.cardsSpellLevel(),
      newRelic: this.cardsNewRelic(),
      relicLevel: this.cardsRelicLevel(),
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
   */
  private cardsNewRelic(): Upgrade[] {
    if (!this.relicSystem.hasFreeSlot()) return [];
    return RELIC_IDS
      .filter((id) => !this.relicSystem.has(id) && !this.evolutionSystem.isRelicSpent(id))
      .filter((id) => {
        const ex = RELICS[id].exclusive;
        return !ex || this.weaponSystem.hasSpell(ex);
      })
      .map((id) => ({
        id: `newRelic_${id}`,
        type: 'newRelic' as const,
        name: `获得 ${RELICS[id].name}`,
        description: RELICS[id].desc(1),
        iconColor: RELICS[id].color,
        apply: (c: UpgradeContext) => { c.relicSystem.equip(id); },
      }));
  }

  private cardsRelicLevel(): Upgrade[] {
    return this.relicSystem.getEquipped()
      .filter((r) => this.relicSystem.canUpgrade(r.id))
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
    fromBoss = false,
  ): void {
    const shot = this.enemyShotPool.get() as EnemyShot;
    if (!shot) return;
    shot.setup(x, y, angle, damage, speed, 3000, fromBoss);
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
    return e;
  }

  /** 火柱。环境机制与首领的火雨共用它 —— 两者要的可视语言完全相同 */
  private spawnFireVent(x: number, y: number, radius: number, warnMs: number, eruptMs: number, damage: number): void {
    const v = this.fireVentPool.get() as FireVent;
    if (!v) return;
    v.setup(x, y, radius, warnMs, eruptMs, 500, damage, 0xff5522);
  }

  private onPlayerHitEnemy(enemy: Enemy): void {
    if (enemy.contactDamage <= 0) return;
    this.damagePlayer(enemy.contactDamage, enemy.x, enemy.y);
  }

  private onPlayerHitShot(shot: EnemyShot): void {
    if (!shot.active || shot.isDead) return;
    shot.kill();
    this.damagePlayer(shot.damage, shot.x, shot.y);
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
   * 把五门**基础**法术一次装满(进化形态走「凑齐融合」,不在这里发)。
   *
   * 同样先把法位开到上限:「装满」这个名字承诺的就是装满,
   * 而开局只有 2 格 —— 不抬上限的话这个按钮会静默地只给两门。
   */
  public debugGrantAllSpells(): string {
    this.weaponSystem.setSlotCap(MAX_SPELL_SLOTS);
    const names: string[] = [];
    for (const id of BASE_SPELL_IDS) {
      if (this.weaponSystem.hasSpell(id)) continue;
      if (this.weaponSystem.addSpell(id)) names.push(SPELLS[id].name);
    }
    this.refreshHudAfterDebug();
    return names.length
      ? `参悟 ${names.join(' · ')}(法位已开到 ${this.weaponSystem.getSlotCap()})`
      : '五门基础法术都已持有';
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
    // 法位阶梯(凝气只有 2 格)会把「五门一起凑」卡住 —— 这个按钮的用途是
    // **一次看完全部五条进化链**,所以先把法位开到上限再补法术。
    // 想验「法位不够时卡池怎么变」请用「开一格法位」,不要靠这里。
    this.weaponSystem.setSlotCap(MAX_SPELL_SLOTS);
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

  public debugFireHazard(): string {
    const n = this.hazardSystem.forceBurst();
    return n ? `灵脉地热喷发 ${n} 处` : '本图没有环境机制';
  }

  /** 直接跳到某个时刻,用来验证 Boss 时间表与节奏 */
  public debugSetTime(seconds: number): string {
    this.elapsed = seconds * 1000;
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
    // UIScene 是并行 launch 的独立场景,GameScene 自己 pause 不会带走它 —— 于是
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
    this.scene.pause();
  }
}
