import Phaser from 'phaser';
import { Player } from '../entities/Player';
import { Enemy } from '../entities/Enemy';
import { EnemyShot } from '../entities/EnemyShot';
import { BloodTide } from '../entities/BloodTide';
import { Projectile } from '../entities/Projectile';
import { Pickup } from '../entities/Pickup';
import { Slam } from '../entities/attacks/Slam';
import { ArcSlash } from '../entities/attacks/ArcSlash';
import { Orbiter } from '../entities/attacks/Orbiter';
import { Zone } from '../entities/attacks/Zone';
import { Attractor } from '../entities/attacks/Attractor';
import { ScanField } from '../entities/attacks/ScanField';
import { DamageText } from '../entities/DamageText';
import { InputManager } from '../utils/InputManager';
import { WeaponSystem } from '../systems/WeaponSystem';
import { SpawnSystem } from '../systems/SpawnSystem';
import { EnemyAiSystem } from '../systems/EnemyAiSystem';
import { MechanismSystem } from '../systems/MechanismSystem';
import { XPSystem } from '../systems/XPSystem';
import { ArtifactSystem } from '../systems/ArtifactSystem';
import { RealmSystem } from '../systems/RealmSystem';
import { EvolutionSystem } from '../systems/EvolutionSystem';
import { MAX_RITUAL, ritualDamageMul, EVOLUTIONS } from '../config/EvolutionConfig';
import { WORLD_WIDTH, WORLD_HEIGHT, GAME_WIDTH, GAME_HEIGHT } from '../config/GameConfig';
import {
  STARTING_WEAPON, WEAPONS, validateSpellReachability, validateSlotCandidates, validateEvolvedNotOffered,
} from '../config/WeaponConfig';
import { ARTIFACTS } from '../config/ArtifactConfig';
import { HEAL_PILL_FRACTION, XP_PILL_FRACTION } from '../config/EliteConfig';
import { STAT_UPGRADES, MAX_BONUS_SPELL_SLOTS } from '../config/CultivationUpgradeConfig';
import { SPELL_SLOTS, rollCandidate, defaultSpell } from '../config/SpellSlotConfig';
import { validateSegmentWaves, validateEnemyReachability } from '../config/WaveConfig';
import { ENEMIES } from '../config/EnemyConfig';
import { BAIT, MIMIC_ENEMY_ID } from '../config/MechanismConfig';
import { GEOMETRIES } from '../types/Geometry';
import { GameEvents } from '../types';
import type { Upgrade, UpgradeContext, PickupKind } from '../types';
import { SaveManager } from '../utils/SaveManager';
import { MathUtils } from '../utils/MathUtils';

/**
 * 主游戏场景
 */
export class GameScene extends Phaser.Scene {
  // 实体
  public player!: Player;
  public enemyPool!: Phaser.GameObjects.Group;
  public projectilePool!: Phaser.GameObjects.Group;
  public enemyShotPool!: Phaser.GameObjects.Group;
  public bloodTidePool!: Phaser.GameObjects.Group;
  public xpPool!: Phaser.GameObjects.Group;
  public damageTextPool!: Phaser.GameObjects.Group;
  // 非直射攻击形态的池
  public slamPool!: Phaser.GameObjects.Group;
  public arcPool!: Phaser.GameObjects.Group;
  public orbiterPool!: Phaser.GameObjects.Group;
  public zonePool!: Phaser.GameObjects.Group;
  public attractorPool!: Phaser.GameObjects.Group;
  public scanPool!: Phaser.GameObjects.Group;

  // 系统
  public inputManager!: InputManager;
  public weaponSystem!: WeaponSystem;
  public spawnSystem!: SpawnSystem;
  public enemyAiSystem!: EnemyAiSystem;
  public mechanismSystem!: MechanismSystem;

  /** 遮天的暗角。常驻一个 Graphics,由 alpha 淡入淡出 */
  private veilOverlay!: Phaser.GameObjects.Graphics;
  private veilAlpha = 0;
  public xpSystem!: XPSystem;
  public artifactSystem!: ArtifactSystem;
  public realmSystem!: RealmSystem;
  public evolutionSystem!: EvolutionSystem;

  // 状态
  /** 调试面板「下一个机制怪」的游标 */
  private debugMechCursor = 0;
  /** 调试面板「下一门法术」的游标 */
  private debugSpellCursor = 0;
  public isPaused = false;
  public elapsed = 0;
  public kills = 0;

  // 障碍物(用于地图边缘装饰,简单版本不放障碍碰撞)
  private obstacles!: Phaser.Physics.Arcade.StaticGroup;

  constructor() {
    super('GameScene');
  }

  create(): void {
    this.cameras.main.setBackgroundColor('#1a2a1a');
    this.isPaused = false;
    this.elapsed = 0;
    this.kills = 0;

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
    this.startUiScene();
    this.scene.launch('UIScene');
  }

  private drawGround(): void {
    // 创建一个 Graphics 画一张大地图瓦片底图
    const g = this.add.graphics();
    g.setDepth(-100);

    // 大块背景
    g.fillStyle(0x2d5a2d, 1);
    g.fillRect(0, 0, WORLD_WIDTH, WORLD_HEIGHT);

    // 散布草簇与道路
    const rng = this.createSeededRng(42);
    for (let i = 0; i < 1200; i++) {
      const x = rng() * WORLD_WIDTH;
      const y = rng() * WORLD_HEIGHT;
      const t = rng();
      if (t < 0.5) {
        g.fillStyle(0x3d7a3d, 1);
        g.fillRect(x, y, 2, 2);
      } else if (t < 0.7) {
        g.fillStyle(0x1d4a1d, 1);
        g.fillRect(x, y, 1, 1);
      } else if (t < 0.85) {
        g.fillStyle(0x4d8a4d, 1);
        g.fillRect(x, y, 3, 3);
      } else {
        g.fillStyle(0x2a4a2a, 1);
        g.fillRect(x, y, 4, 4);
      }
    }

    // 几块浅色"路"区域
    g.fillStyle(0x6a5a3a, 0.3);
    g.fillRect(200, 200, 600, 200);
    g.fillRect(WORLD_WIDTH - 800, 400, 700, 200);
    g.fillRect(WORLD_WIDTH / 2 - 300, WORLD_HEIGHT - 600, 600, 250);

    // 边界视觉
    g.lineStyle(4, 0x1a3a1a, 1);
    g.strokeRect(0, 0, WORLD_WIDTH, WORLD_HEIGHT);
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
    const types: Array<{ key: string; w: number; h: number }> = [
      { key: 'tree', w: 64, h: 80 },
      { key: 'rock', w: 48, h: 40 },
      { key: 'bush', w: 40, h: 32 },
    ];
    for (let i = 0; i < 80; i++) {
      const t = types[Math.floor(rng() * types.length)];
      const margin = 80;
      const x = margin + rng() * (WORLD_WIDTH - margin * 2);
      const y = margin + rng() * (WORLD_HEIGHT - margin * 2);
      // 在玩家初始位置 200 内不放
      if (MathUtils.distanceSq(x, y, WORLD_WIDTH / 2, WORLD_HEIGHT / 2) < 200 * 200) continue;
      const obj = this.add.image(x, y, t.key);
      obj.setOrigin(0.5, 1);
      obj.setDepth(10);
      this.physics.add.existing(obj, true);
      (obj.body as Phaser.Physics.Arcade.Body).setSize(t.w * 0.6, t.h * 0.6);
      this.obstacles.add(obj);
    }
  }

  private setupPools(): void {
    // 注意: 必须设置 classType 与有限的 maxSize。
    // Phaser 的 Group 默认 maxSize = -1,此时 isFull() 恒为 false,池耗尽后 get()
    // 会用默认的 Sprite 类新建一个无纹理对象返回(而非返回 null),随后的 setup()
    // 会抛 TypeError,且该对象永久泄漏。设了有限 maxSize 后 get() 才会在耗尽时
    // 正确返回 null,让调用方的 guard 真正生效。
    // 敌人池容量 = WaveConfig.MAX_LIVE_ENEMIES(天道承载力)。
    // ⚠️ 改 maxSize 时必须同步改下面的预建循环 —— 少建一个,
    // 池耗尽时 get() 返回 null,那一只怪就凭空消失
    // runChildUpdate: false —— 这四个类的驱动全是自己重写的 preUpdate(经 scene 的
    // updateList),没有任何一个定义了 update()。开着它只会让 Group 每帧对整池子对象
    // slice 一次再逐个调一个空方法;敌人池涨到 200 之后这笔开销不再可以忽略。
    this.enemyPool = this.add.group({ runChildUpdate: false, classType: Enemy, maxSize: 200 });
    this.projectilePool = this.add.group({ runChildUpdate: false, classType: Projectile, maxSize: 140 });
    // 敌方弹丸:同屏术修数量有限(每 2.2 秒一发、3 秒寿命),60 足够
    this.enemyShotPool = this.add.group({ runChildUpdate: false, classType: EnemyShot, maxSize: 60 });
    // 血海:同一时刻只会有一次上涌,2 个是给「上一次还没退完就再来一次」留的余量
    this.bloodTidePool = this.add.group({ runChildUpdate: false, classType: BloodTide, maxSize: 2 });
    this.xpPool = this.add.group({ runChildUpdate: false, classType: Pickup, maxSize: 160 });
    this.damageTextPool = this.add.group({ runChildUpdate: false, classType: DamageText, maxSize: 60 });

    // 攻击形态各自的池。非直射形态不参与物理碰撞,数量需求远低于投射物。
    //
    // runChildUpdate: false —— 这些实体靠自己重写的 preUpdate 驱动(经 scene 的
    // updateList),不靠 Group 调 update()。开着 runChildUpdate 只会让 Group
    // 每帧对这些子对象做一次无意义的 slice + update() 调用。
    this.slamPool = this.add.group({ runChildUpdate: false, classType: Slam, maxSize: 20 });
    this.arcPool = this.add.group({ runChildUpdate: false, classType: ArcSlash, maxSize: 16 });
    this.orbiterPool = this.add.group({ runChildUpdate: false, classType: Orbiter, maxSize: 24 });
    this.zonePool = this.add.group({ runChildUpdate: false, classType: Zone, maxSize: 20 });
    // 控制类形态(引力/扫描):并发数很低,但它们的 radius 覆盖全屏,
    // 敌人密集时同屏可能有多个,所以给得比 zone 略宽
    this.attractorPool = this.add.group({ runChildUpdate: false, classType: Attractor, maxSize: 12 });
    this.scanPool = this.add.group({ runChildUpdate: false, classType: ScanField, maxSize: 8 });

    // 预创建
    for (let i = 0; i < 200; i++) {
      this.createPooledEnemy();
    }
    for (let i = 0; i < 140; i++) {
      this.createPooledProjectile();
    }
    for (let i = 0; i < 60; i++) {
      this.createPooledEnemyShot();
    }
    // 血海需要玩家引用与伤害入口,建池时一次性注入(与攻击形态的 bind 同一套)
    for (let i = 0; i < 2; i++) {
      const tide = new BloodTide(this);
      tide.bind(() => this.player, (a, sx, sy) => this.damagePlayer(a, sx, sy));
      this.bloodTidePool.add(tide);
    }
    for (let i = 0; i < 160; i++) {
      this.createPooledXP();
    }
    for (let i = 0; i < 60; i++) {
      this.createPooledDamageText();
    }

    // 非直射形态需要敌人的引用与伤害回调,在建池时一次性注入
    const apply = this.applyDamageToEnemy.bind(this);
    for (let i = 0; i < 20; i++) {
      const s = new Slam(this);
      s.setActive(false).setVisible(false);
      s.bind(this.enemyPool, apply);
      this.slamPool.add(s);
    }
    for (let i = 0; i < 16; i++) {
      const a = new ArcSlash(this);
      a.setActive(false).setVisible(false);
      a.bind(this.enemyPool, apply);
      this.arcPool.add(a);
    }
    for (let i = 0; i < 24; i++) {
      const o = new Orbiter(this);
      o.setActive(false).setVisible(false);
      // 传入玩家坐标的实时取值函数 —— 环绕体必须跟着玩家走
      o.bind(this.enemyPool, apply, () => ({ x: this.player.x, y: this.player.y }));
      this.orbiterPool.add(o);
    }
    for (let i = 0; i < 20; i++) {
      const z = new Zone(this);
      z.setActive(false).setVisible(false);
      z.bind(this.enemyPool, apply);
      this.zonePool.add(z);
    }
    // 引力/扫描是零伤害的控制类实体,不需要 applyDamage 回调 ——
    // 它们的 bind 签名就只有一个 enemyGroup,这是刻意的:
    // 让「这个形态不参与伤害链」在类型上就成立,而不是靠调用方记得别传
    for (let i = 0; i < 12; i++) {
      const a = new Attractor(this);
      a.setActive(false).setVisible(false);
      a.bind(this.enemyPool);
      this.attractorPool.add(a);
    }
    for (let i = 0; i < 8; i++) {
      const s = new ScanField(this);
      s.setActive(false).setVisible(false);
      s.bind(this.enemyPool);
      this.scanPool.add(s);
    }
  }

  private createPooledEnemy(): void {
    const e = new Enemy(this, 0, 0);
    e.setActive(false).setVisible(false);
    this.enemyPool.add(e);
  }

  private createPooledProjectile(): void {
    const p = new Projectile(this, this.enemyPool);
    p.setActive(false).setVisible(false);
    this.projectilePool.add(p);
  }

  private createPooledEnemyShot(): void {
    const s = new EnemyShot(this);
    s.setActive(false).setVisible(false);
    this.enemyShotPool.add(s);
  }

  private createPooledXP(): void {
    const g = new Pickup(this);
    g.setActive(false).setVisible(false);
    this.xpPool.add(g);
  }

  private createPooledDamageText(): void {
    const t = new DamageText(this);
    t.setActive(false).setVisible(false);
    this.damageTextPool.add(t);
  }

  private setupPlayer(): void {
    this.player = new Player(this, WORLD_WIDTH / 2, WORLD_HEIGHT / 2);
  }

  /**
   * 遮天的暗角 —— 一圈由外向内减淡的黑色描边。
   *
   * 它不造成任何伤害,却直接吃掉玩家「看盲区」的能力,而那正是十四类几何的运转前提。
   * 常驻一个 Graphics + 每帧 lerp 透明度,而不是出现/消失时建销对象:
   * 遮天可能同时存在好几只,建销会让淡入淡出互相打断
   */
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
    this.cameras.main.setBounds(0, 0, WORLD_WIDTH, WORLD_HEIGHT);
    this.cameras.main.setDeadzone(40, 40);
    this.physics.world.setBounds(0, 0, WORLD_WIDTH, WORLD_HEIGHT);
  }

  // ===== 调试入口 =====
  //
  // 这些方法由暂停菜单里的调试面板调用(见 UIScene.showPauseOverlay),
  // 刻意不再做键盘快捷键:快捷键在任何时候都会触发,包括手滑与输入法切换 ——
  // 一局正常游戏因为误触突然刷出十二只怪,比没有调试手段更糟。
  //
  // 返回值是一句给人看的结果说明,面板把它当横幅显示出来。
  // ⚠️ 发布前把 DebugConfig.DEBUG_PANEL_ENABLED 改成 false。

  /**
   * 凑齐**每一条**进化链的三条件,然后开一次宝匣。
   *
   * 一次点完所有链路而不是只测第一条:进化现在有五条,逐条手动凑
   * 又要装备、又要升重、又要等钥匙,根本没法用来回归。
   * 而且「一件匣子结算多条进化」本来就是设计书的核心体验(攒着一次开),
   * 这个按钮顺带把它也验了
   */
  public debugFullEvolution(): string {
    const chains: string[] = [];
    for (const def of EVOLUTIONS) {
      if (!this.weaponSystem.hasWeapon(def.base)) this.weaponSystem.addWeapon(def.base);
      let guard = 0;
      while (this.weaponSystem.addRitual(def.base) && guard++ < 20) { /* 推到满重 */ }
      for (const key of def.keys) this.artifactSystem.debugEquip(key);
      chains.push(WEAPONS[def.base]?.name ?? def.base);
    }
    this.refreshHudAfterDebug();
    this.openChest();
    return `${chains.length} 条进化链已满 8 重、钥匙就位:${chains.join(' · ')}`;
  }

  /** 所有走「重数」刻度的神通直接拉满 8 重 */
  public debugMaxRitual(): string {
    const done: string[] = [];
    for (const w of this.weaponSystem.getWeapons()) {
      let pushed = false;
      let guard = 0;
      while (this.weaponSystem.addRitual(w.id) && guard++ < 20) pushed = true;
      if (pushed) done.push(`${WEAPONS[w.id]?.name ?? w.id} → 8 重`);
    }
    if (done.length) this.refreshHudAfterDebug();
    return done.length ? done.join(' · ') : '没有可升重数的神通';
  }

  /**
   * 调试改完法术栏之后,借 UPGRADE_APPLIED 让 UIScene 重刷面板。
   *
   * HUD 是拉取式的(见 CLAUDE.md):它只在事件里刷新,不会自己发现
   * weaponSystem 变了。少了这一句,点完「装满法术」屏幕下方的法术栏
   * 会一直停在旧内容上,直到下一次升级 —— 看起来像调试面板没生效
   */
  private refreshHudAfterDebug(): void {
    this.events.emit(GameEvents.UPGRADE_APPLIED, {
      id: 'debug', type: 'newSpell', name: 'debug', description: '', iconColor: 0xffffff,
      apply: () => {},
    } as Upgrade);
  }

  /**
   * 依次参悟法术表里的每一门(循环)。
   *
   * 正常路径下第 3 格要 16 级、第 6 格要 61 级,光是为了看一眼黄泉指长什么样
   * 就得先跑十几分钟 —— 逐个过一遍是唯一实用的验证方式。
   * 横幅里连形态与几何一起报,因为「这门法术是什么形状」比它叫什么更重要
   */
  public debugNextSpell(): string {
    const ids = Object.keys(WEAPONS);
    const id = ids[this.debugSpellCursor % ids.length];
    this.debugSpellCursor++;
    const cfg = WEAPONS[id];
    const geo = cfg.geometry ? GEOMETRIES[cfg.geometry] : null;
    const tag = geo ? `${geo.name} · ${cfg.form}` : cfg.form;
    if (this.weaponSystem.hasWeapon(id)) {
      return `${cfg.name} 已持有(${this.debugSpellCursor}/${ids.length},再点一次看下一门)`;
    }
    this.weaponSystem.addWeapon(id);
    this.refreshHudAfterDebug();
    return `参悟 ${cfg.name}(${tag})`;
  }

  /** 把法术表里的每一门都装上 —— 顺便压一次满屏特效的帧率 */
  public debugGrantAllSpells(): string {
    const names: string[] = [];
    for (const id of Object.keys(WEAPONS)) {
      if (this.weaponSystem.hasWeapon(id)) continue;
      this.weaponSystem.addWeapon(id);
      names.push(WEAPONS[id].name);
    }
    if (names.length) this.refreshHudAfterDebug();
    return names.length ? `参悟 ${names.join(' · ')}` : '法术表里的每一门都已持有';
  }

  /** 法术栏重置为开局那一门 —— 「装满」之后想只测一门时的退路 */
  public debugResetSpells(): string {
    const start = defaultSpell() ?? STARTING_WEAPON;
    this.weaponSystem.debugSetWeapons([start]);
    this.weaponSystem.resetCooldowns();
    this.refreshHudAfterDebug();
    return `法术栏已重置为 ${WEAPONS[start]?.name ?? start}`;
  }

  /** 把图鉴里的怪各刷一只在玩家周围 —— 验证十二种逼近几何 */
  public debugSpawnAllMonsters(): string {
    const ids = Object.keys(ENEMIES);
    const px = this.player.x;
    const py = this.player.y;
    ids.forEach((id, i) => {
      const a = (i / ids.length) * Math.PI * 2;
      this.spawnSystem.spawnChild(id, px + Math.cos(a) * 220, py + Math.sin(a) * 220);
    });
    return `刷出 ${ids.length} 种怪:${ids.join(' ')}`;
  }

  /** 在玩家旁边放一只精英 —— 验证必掉宝匣 / 传回 / 抗性 */
  public debugSpawnElite(): string {
    this.spawnSystem.spawnChild('stone_puppet', this.player.x + 260, this.player.y, true);
    return '刷出精英 · 石傀(天生牵引抗性)';
  }

  /** 立刻投放一只机制怪(不等那 70 秒的投放表) */
  public debugFireMechanism(): string {
    const id = this.mechanismSystem.forceFire();
    return id ? `投放机制怪:${id}` : '当前境界没有可投放的机制怪';
  }

  /** 依次刷出每一种机制怪 —— 连点七次看全八只 */
  public debugNextMechanism(): string {
    const ids = Object.keys(ENEMIES).filter((k) => ENEMIES[k].mechanism);
    const id = ids[this.debugMechCursor % ids.length];
    this.debugMechCursor++;
    const a = Math.random() * Math.PI * 2;
    this.spawnSystem.spawnChild(id, this.player.x + Math.cos(a) * 300, this.player.y + Math.sin(a) * 300);
    return `刷出 ${ENEMIES[id].name}(${this.debugMechCursor}/${ids.length})`;
  }

  private setupInput(): void {
    this.inputManager = new InputManager(this);
    this.inputManager.setup();
  }

  private setupSystems(): void {
    this.artifactSystem = new ArtifactSystem(this, this.player);

    this.weaponSystem = new WeaponSystem(
      this,
      this.player,
      this.projectilePool,
      this.enemyPool,
      this.artifactSystem,
      {
        slams: this.slamPool,
        arcs: this.arcPool,
        orbiters: this.orbiterPool,
        zones: this.zonePool,
        attractors: this.attractorPool,
        scans: this.scanPool,
      },
    );
    // 开局装备格 1 —— 由 SpellSlotConfig 声明的「默认装备位」决定。
    // 刻意不再用 STARTING_WEAPON:那个常量仍指向旧的飞剑(knife),
    // 两处各定一次开局武器必然会走偏 —— 解锁表是唯一事实来源。
    const startId = defaultSpell() ?? STARTING_WEAPON;
    this.weaponSystem.addWeapon(startId);

    this.realmSystem = new RealmSystem(
      this,
      this.player,
      this.weaponSystem,
      this.artifactSystem,
    );

    // 进化系统要在 WeaponSystem 与 ArtifactSystem 之后 —— 它三方都要读。
    // 务必留在 scene.launch('UIScene') 之前,见 CLAUDE.md 的架构约定。
    this.evolutionSystem = new EvolutionSystem(this, this.weaponSystem, this.artifactSystem);

    this.spawnSystem = new SpawnSystem(
      this.enemyPool,
      () => ({ x: this.player.x, y: this.player.y }),
      () => this.realmSystem.majorIndex,
      // map() 每次返回新数组 —— Enemy 是池化实体,不能持有活的列表引用
      () => this.artifactSystem.getEquipped().map((a) => a.id),
    );

    // 逼近行为系统 —— 九种 approach 全在这里,GameScene 只负责把回调接上。
    // 回调而不是直接注入系统:自爆要走统一伤害入口(掉落/击杀数/亡语才一致),
    // 发弹要过池,这两件事只有 GameScene 能拍板
    this.enemyAiSystem = new EnemyAiSystem(this.enemyPool, {
      getPlayer: () => this.player,
      damagePlayer: (amount, sx, sy) => this.damagePlayer(amount, sx, sy),
      spawnShot: (x, y, angle, damage, speed) => this.spawnEnemyShot(x, y, angle, damage, speed),
      killEnemy: (enemy) => this.killEnemy(enemy),
      explodeFx: (x, y, radius) => this.spawnExplosionFx(x, y, radius),
      findPickup: (x, y, radius) => this.findNearestPickup(x, y, radius),
      eatPickup: (p) => this.eatPickup(p),
    });

    // 机制怪投放(八种机制怪与伪宝匣)。它在 SpawnSystem 之后建 ——
    // 敌人体那一类要借它的 spawnChild 走同一套难度口径
    this.mechanismSystem = new MechanismSystem({
      getPlayer: () => ({ x: this.player.x, y: this.player.y }),
      getRealmIndex: () => this.realmSystem.majorIndex,
      spawnEnemy: (id, x, y) => this.spawnSystem.spawnChild(id, x, y),
      spawnPickup: (kind, x, y) => this.spawnPickup(x, y, kind, 0),
      summonTide: () => this.summonBloodTide(),
    });

    // 门控注入:XPSystem 本身仍不知道境界的存在
    this.xpSystem = new XPSystem(this, this.player, () => this.realmSystem.canAdvanceLevel());
    this.xpSystem.onLevelUp = () => {
      this.handleLevelUp();
    };
  }

  private setupCollisions(): void {
    // 玩家与障碍物
    this.physics.add.collider(this.player, this.obstacles);

    // 投射物与敌人
    this.physics.add.overlap(
      this.projectilePool,
      this.enemyPool,
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

    // 玩家与敌人接触
    this.physics.add.overlap(
      this.player,
      this.enemyPool,
      (_p, _e) => this.onPlayerHitEnemy(_e as Enemy),
      (_p, _e) => {
        const pl = _p as Player;
        const en = _e as Enemy;
        return pl.active && en.active && !en.isDead && !pl.isDead();
      },
    );

    // 玩家与敌方弹丸(术修)
    this.physics.add.overlap(
      this.player,
      this.enemyShotPool,
      (_p, _s) => this.onPlayerHitShot(_s as EnemyShot),
      (_p, _s) => {
        const shot = _s as EnemyShot;
        const pl = _p as Player;
        return shot.active && !shot.isDead && pl.active && !pl.isDead();
      },
    );

    // 玩家与 XP
    this.physics.add.overlap(
      this.player,
      this.xpPool,
      (_p, _g) => this.onPlayerPickXP(_g as Pickup),
      (_p, _g) => {
        const g = _g as Pickup;
        return g.active && !g.isDead;
      },
    );
  }

  private startUiScene(): void {
    // 启动 UI 层(由 GameScene 触发,确保数据已就绪)
  }

  update(time: number, delta: number): void {
    if (this.isPaused) return;

    this.elapsed += delta;

    // 玩家移动
    this.inputManager.update();
    const mx = this.inputManager.moveX;
    const my = this.inputManager.moveY;
    const speed = this.player.getMoveSpeed();
    this.player.setVelocity(mx * speed, my * speed);
    this.player.updateFacing(mx, my);
    this.player.setFlipX(this.player.facingX < 0);

    // 暂停
    if (this.inputManager.consumePause()) {
      this.pauseGame();
    }

    // 系统更新
    this.weaponSystem.update(time, delta);
    this.spawnSystem.update(time, delta);

    // 敌人逼近行为(九种几何)+ 远离回收 / 精英传回
    this.enemyAiSystem.update(time, delta);

    // 机制怪投放(按秒计),以及遮天的暗角淡入淡出
    this.mechanismSystem.update(this.elapsed / 1000);
    const veilWant = this.enemyAiSystem.veilActive ? 1 : 0;
    if (Math.abs(this.veilAlpha - veilWant) > 0.002) {
      this.veilAlpha += (veilWant - this.veilAlpha) * 0.05;
      this.veilOverlay.setAlpha(this.veilAlpha);
    }

    // XP 吸附
    this.updateXPMagnets();

    // 死亡判定
    if (this.player.isDead()) {
      this.onPlayerDeath();
    }
  }

  /**
   * 内容表自检 —— 启动时把三类配置错误顶到台面上,而不是等试玩时才碰见:
   *   1. 段表里写了不认识的法术/怪物 id(刷怪时会崩)
   *   2. ENEMIES 里有永远不出场的怪(死数据)
   *   3. WEAPONS 里有永远拿不到的法术(死数据)
   */
  private checkContentTables(): void {
    const segment = validateSegmentWaves();
    if (segment.length > 0) {
      console.warn('[刷怪表] 权重里有未知 id,刷出的怪会没有配置:', segment.join(' / '));
    }
    const enemies = validateEnemyReachability();
    if (enemies.length > 0) {
      console.warn('[敌人表] 这些怪没有任何生成路径,永远不会出场:', enemies.join(' / '));
    }
    const spells = validateSpellReachability();
    if (spells.length > 0) {
      console.warn('[法术表] 这些法术没有任何获取路径,永远拿不到:', spells.join(' / '));
    }
    const leaked = validateEvolvedNotOffered();
    if (leaked.length > 0) {
      console.warn('[法术表] 进化形态出现在了解锁表里,三条件会被绕过:', leaked.join(' / '));
    }
    // 这条是待办清单而不是错误:解锁表按设计书定稿,阶段 2 的神通还没写
    const pending = validateSlotCandidates();
    if (pending.length > 0) {
      console.info('[法术表] 解锁表引用了尚未实现的神通(点那张卡不会有反应):', pending.join(' / '));
    }
  }

  private updateXPMagnets(): void {
    const range = this.player.getPickupRange();
    const rangeSq = range * range;
    this.xpPool.children.iterate((c) => {
      if (!c || !c.active) return true;
      const g = c as Pickup;
      if (g.isDead) return true;
      const dx = this.player.x - g.x;
      const dy = this.player.y - g.y;
      const d2 = dx * dx + dy * dy;
      if (d2 < rangeSq) {
        const body = g.body as Phaser.Physics.Arcade.Body;
        const len = Math.sqrt(d2) || 1;
        const pullSpeed = 350;
        body.setVelocity((dx / len) * pullSpeed, (dy / len) * pullSpeed);
      } else {
        const body = g.body as Phaser.Physics.Arcade.Body;
        body.setVelocity(0, 0);
      }
      return true;
    });
  }

  private onProjectileHitEnemy(proj: Projectile, enemy: Enemy): void {
    if (!proj.active || proj.isDead) return;
    if (proj.hitSet.has(enemy)) return;

    const applied = this.applyDamageToEnemy(enemy, proj.damage, enemy.x, enemy.y - 8);
    // 敌人已死或本次未造成伤害时不必再走连锁/穿透
    if (!applied) return;
    proj.onHitEnemy();
  }

  /**
   * 统一的伤害结算入口。
   *
   * 直射投射物、落印的落点判定、弧斩的扫掠、环绕体的接触、地效的跳伤 ——
   * 五种来源全部走这里,避免伤害数字、击杀掉落、死亡补间各写一遍。
   *
   * @returns 是否实际造成了伤害(敌人已死 / 已失效时返回 false)
   */
  private applyDamageToEnemy(enemy: Enemy, amount: number, textX: number, textY: number): boolean {
    if (!enemy.active || enemy.isDead) return false;

    const killed = enemy.takeDamage(amount, this.time.now);
    this.spawnDamageText(textX, textY, Math.round(amount), '#ffffff', false);
    if (killed) {
      this.onEnemyKilled(enemy);
    }
    return true;
  }

  private onEnemyKilled(enemy: Enemy): void {
    this.kills++;
    // 掉落灵液
    this.spawnPickup(enemy.x, enemy.y, 'xp', enemy.xpValue);

    // 精英额外掉落:法宝 / 突破道具 / 秘境宝匣
    for (const d of enemy.drops) {
      // 宝匣在 10:00 前不落地 —— 设计书把 10:00 定为全局节奏的分水岭,
      // 提前掉会让「铺底盘」阶段就跳过进化这条线。
      // 但精英的宝匣是必掉的,直接吞掉等于 10:00 前杀精英白杀 —— 折成一枚突破道具
      if (d.kind === 'chest' && !this.evolutionSystem.isChestAvailable(this.elapsed)) {
        const key = this.pickNeededKeyItem();
        if (key) this.spawnPickup(enemy.x, enemy.y, 'keyItem', key);
        continue;
      }
      this.spawnPickup(enemy.x, enemy.y, d.kind, d.payload);
    }

    // 伪仙的死亡反噬:以它尸体为圆心的一次爆发。
    // 「被击杀的瞬间才现形」咬的正是无脑清场的玩家 —— 清屏必须留一点观察
    const blast = ENEMIES[enemy.enemyKey]?.mechanism?.deathBlast;
    if (blast) {
      this.spawnExplosionFx(enemy.x, enemy.y, blast.radius);
      const bdx = this.player.x - enemy.x;
      const bdy = this.player.y - enemy.y;
      if (bdx * bdx + bdy * bdy <= blast.radius * blast.radius) {
        this.damagePlayer(blast.damage, enemy.x, enemy.y);
      }
    }

    // 衍体:死后裂成数只小体(蛊虫)——「清屏 ≠ 清干净」。
    // 池满时 spawnChild 自己会放弃,一次分裂不会把池拖崩
    const split = ENEMIES[enemy.enemyKey]?.splitInto;
    if (split) {
      for (let i = 0; i < split.count; i++) {
        this.spawnSystem.spawnChild(split.type, enemy.x, enemy.y);
      }
    }

    // 死亡动画(简单:闪白消失)
    this.tweens.add({
      targets: enemy,
      alpha: { from: 1, to: 0 },
      scale: { from: enemy.scale, to: enemy.scale * 0.3 },
      duration: 200,
      onComplete: () => {
        enemy.setActive(false).setVisible(false);
        const body = enemy.body as Phaser.Physics.Arcade.Body;
        body.enable = false;
        body.setVelocity(0, 0);
        enemy.isDead = false; // 复位等待复用
      },
    });

    this.events.emit(GameEvents.ENEMY_KILLED, enemy);
  }

  /**
   * 生成一件地面掉落物。
   * 池耗尽时降级为「直接发放」,而不是把道具丢在地上。
   */
  private spawnPickup(x: number, y: number, kind: PickupKind, payload: number | string): void {
    const p = this.xpPool.get() as Pickup;
    if (!p) {
      this.grantPickup(kind, payload);
      return;
    }
    p.setup(x, y, kind, payload);
  }

  /**
   * 收下掉落物。
   *
   * heal / xpPill 的数值在这里才计算,而不是在掉落时 ——
   * 精英可能在境界突破前就被击杀,掉落时算好的数值到拾取时就过期了。
   */
  private grantPickup(kind: PickupKind, payload: number | string): void {
    switch (kind) {
      case 'xp': {
        const amount = typeof payload === 'number' ? payload : 1;
        this.xpSystem.add(amount);
        this.events.emit(GameEvents.XP_COLLECTED, amount);
        return;
      }

      case 'artifact': {
        const taken = this.artifactSystem.equip(String(payload));
        if (!taken) {
          // 槽满且这件已满级 —— 转化为突破道具,不浪费掉落。
          // 优先发给「当前正要突破的那个」;已在最高境界则退给修为。
          const key = this.pickNeededKeyItem();
          if (key) this.spawnPickup(this.player.x, this.player.y, 'keyItem', key);
          else this.xpSystem.add(Math.max(1, Math.floor(this.xpSystem.getXpToNext() * 0.3)));
        }
        return;
      }

      case 'heal': {
        const p = this.player;
        const amount = Math.round(p.maxHealth * HEAL_PILL_FRACTION);
        const before = p.health;
        p.heal(amount);
        const actual = Math.round(p.health - before);
        if (actual > 0) {
          this.spawnDamageText(p.x, p.y - 20, actual, '#66ff88', false);
          // 这条事件此前被 UIScene 订阅却从无处 emit,回血丹药补上了它
          this.events.emit(GameEvents.PLAYER_HEALED, p.health);
        }
        return;
      }

      case 'xpPill': {
        const amount = Math.floor(this.xpSystem.getXpToNext() * XP_PILL_FRACTION);
        this.xpSystem.add(amount);
        this.spawnDamageText(this.player.x, this.player.y - 20, amount, '#88ccff', false);
        this.events.emit(GameEvents.XP_COLLECTED, amount);
        return;
      }

      case 'chest': {
        this.openChest();
        return;
      }

      case 'bait': {
        // 幻饵:与真灵石的唯一区别是它会炸。落在你脚边时你已经伸手了
        this.spawnExplosionFx(this.player.x, this.player.y, BAIT.radius);
        this.damagePlayer(BAIT.damage, this.player.x, this.player.y);
        return;
      }

      case 'mimic': {
        // 伪宝匣:靠近后变成敌人,而且不给你反应时间 —— 它趴着的距离
        // 已经近到磁吸会把它拖过来,所以「看见宝箱就冲」的代价是即时的
        this.spawnExplosionFx(this.player.x, this.player.y, 30);
        this.spawnSystem.spawnChild(MIMIC_ENEMY_ID, this.player.x, this.player.y);
        return;
      }

      default:
        this.collectKeyItem(String(payload));
    }
  }

  /** 玩家当前突破所缺的道具 id,没有则返回空串 */
  private pickNeededKeyItem(): string {
    const next = this.realmSystem.next;
    return next ? next.keyItemId : '';
  }

  /**
   * 结算秘境宝匣。
   *
   * 设计书：「宝匣永远优先结算进化而非金币」,并且「攒着一次开 3 件 / 5 件
   * 可以一口气触发多个进化」。所以这里不弹选择框,而是把当前**所有**已满足
   * 条件的进化一次跑完 —— 一件匣子开多门进化,正是这条机制的价值所在。
   *
   * 若当前没有可进化的,给修为作为兜底:玩家捡到了东西就得有反馈,
   * 不然会出现「捡了匣子什么都没发生」,比不掉还糟。
   */
  private openChest(): void {
    this.evolutionSystem.chestsOpened++;
    const ready = this.evolutionSystem.readyEvolutions();
    const names: string[] = [];

    for (const c of ready) {
      const n = this.evolutionSystem.evolve(c.def.base);
      if (n) names.push(n);
    }

    if (names.length > 0) {
      this.events.emit(GameEvents.CHEST_RESOLVED, names);
      return;
    }

    // 无进化可结算 → 折算成当前一级所需修为的 50%,不给 0
    const amount = Math.max(1, Math.floor(this.xpSystem.getXpToNext() * 0.5));
    this.xpSystem.add(amount);
    this.spawnDamageText(this.player.x, this.player.y - 20, amount, '#ffdd66', false);
    this.events.emit(GameEvents.CHEST_RESOLVED, []);
  }

  private onPlayerHitEnemy(enemy: Enemy): void {
    // 自爆型(火灵)的接触伤害是 0 —— 它靠贴脸起爆结算,不靠「蹭到就掉血」
    if (enemy.contactDamage <= 0) return;
    this.damagePlayer(enemy.contactDamage, enemy.x, enemy.y);
  }

  private onPlayerHitShot(shot: EnemyShot): void {
    if (!shot.active || shot.isDead) return;
    shot.kill();
    this.damagePlayer(shot.damage, shot.x, shot.y);
  }

  /**
   * 对玩家结算一次伤害。
   *
   * 接触、敌方弹丸、自爆三条来源共用它 —— 它们唯一的差别只是伤害从哪来。
   * 无敌帧在 Player.takeDamage 里,所以同帧多发不会叠加。
   */
  private damagePlayer(amount: number, sourceX: number, sourceY: number): void {
    const player = this.player;
    if (player.isDead()) return;
    if (player.takeDamage(amount, sourceX, sourceY, this.time.now)) {
      this.spawnDamageText(player.x, player.y - 16, Math.round(amount), '#ff5555', false);
      this.events.emit(GameEvents.PLAYER_DAMAGED, player.health);
    }
  }

  /** 发一颗敌方弹丸(术修)。池耗尽就直接放弃这一发,不降级、不新建 */
  private spawnEnemyShot(x: number, y: number, angle: number, damage: number, speed: number): void {
    const shot = this.enemyShotPool.get() as EnemyShot;
    if (!shot) return;
    shot.setup(x, y, angle, damage, speed);
  }

  /**
   * 静默击杀 —— 自爆走这条路。
   *
   * 与 applyDamageToEnemy 的区别只有一条:不弹伤害数字。
   * 掉落、击杀数、死亡补间、亡语(分裂)全部照常 —— 自爆的怪也是死人。
   */
  private killEnemy(enemy: Enemy): void {
    if (!enemy.active || enemy.isDead) return;
    enemy.isDead = true;
    this.onEnemyKilled(enemy);
  }

  /** 找离 (x,y) 最近的、半径内的地面掉落物(噬灵虫用) */
  private findNearestPickup(x: number, y: number, radius: number): Pickup | null {
    const children = this.xpPool.getChildren();
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

  /** 噬灵虫吃掉一份掉落物:物主消失,玩家拿不到 —— 这正是它的恶意所在 */
  private eatPickup(p: Pickup): void {
    if (!p.active || p.isDead) return;
    p.kill();
    this.spawnExplosionFx(p.x, p.y, 10);
  }

  /** 升起血海(机制怪:血海上涌)。池里已有一次在上涌时直接放弃这一次 */
  private summonBloodTide(): void {
    const tide = this.bloodTidePool.get() as BloodTide;
    if (!tide) return;
    tide.setup();
  }

  /** 爆炸特效。临时对象 + 自毁补间 —— 它不是池化实体,所以补间是安全的 */
  private spawnExplosionFx(x: number, y: number, radius: number): void {
    const img = this.add.image(x, y, 'fx_hit');
    img.setDepth(90);
    img.setScale((radius * 2) / 16);
    img.setAlpha(0.85);
    this.tweens.add({
      targets: img,
      alpha: 0,
      scale: img.scale * 1.4,
      duration: 220,
      onComplete: () => img.destroy(),
    });
  }

  /**
   * 拾取处理。溢出转化保证掉落永不浪费:
   *   法宝槽满 → 转成突破道具;重复的突破道具 → 转成 30% 一级的修为。
   * 正因为这个,才不需要一个法宝替换/丢弃界面。
   */
  private onPlayerPickXP(gem: Pickup): void {
    if (!gem.active || gem.isDead) return;
    const kind = gem.kind;
    const payload: number | string = kind === 'xp' ? gem.amount : gem.payloadId;
    gem.kill();
    // 事件由 grantPickup 统一发出 —— 这里再发一次会造成重复刷新,
    // 且对 heal/xpPill 会发出语义错误的 XP_COLLECTED(0)
    this.grantPickup(kind, payload);
  }

  /** 突破道具的收下逻辑,重复时转化为修为 */
  private collectKeyItem(id: string): void {
    if (!id) return;
    if (this.realmSystem.addKeyItem(id)) return;
    this.xpSystem.add(Math.floor(this.xpSystem.getXpToNext() * 0.3));
  }

  private spawnDamageText(x: number, y: number, value: number, color: string, crit: boolean): void {
    const t = this.damageTextPool.get() as DamageText;
    if (t) {
      t.setup(x, y, value, color, crit);
    }
  }

  private handleLevelUp(): void {
    // 一次拾取可能触发多次 onLevelUp(XPSystem.add 的 while),用 isPaused 兜底
    if (this.isPaused) return;

    // 先结算境界(推进小境界 / 大境界突破),再据此构建卡池
    const brokeThrough = this.realmSystem.applyLevelUp();

    this.events.emit(GameEvents.PLAYER_LEVEL_UP, this.xpSystem.level);
    this.weaponSystem.resetCooldowns();

    const ctx: UpgradeContext = {
      player: this.player,
      weaponSystem: this.weaponSystem,
      artifactSystem: this.artifactSystem,
    };
    const cards = this.buildUpgradeCards();

    this.pauseGame();
    this.scene.launch('UpgradeScene', {
      level: this.xpSystem.level,
      kind: brokeThrough ? 'major' : 'minor',
      realmName: this.realmSystem.getDisplayName(),
      cards,
      onSelect: (upgrade: Upgrade) => {
        // 参悟新术但法位已满 → 转交替换面板,不直接学会
        if (upgrade.type === 'newSpell' && this.weaponSystem.getWeaponCount() >= this.realmSystem.getSpellSlots()) {
          const newId = upgrade.id.replace('newSpell_', '');
          upgrade.apply(ctx);          // 满槽时 apply 是空操作
          this.scene.stop('UpgradeScene');
          this.openReplaceSpell(newId);
          return;
        }
        upgrade.apply(ctx);
        this.events.emit(GameEvents.UPGRADE_APPLIED, upgrade);
        this.scene.stop('UpgradeScene');
        this.resumeGame();
        // 选完卡之后,若之前攒下的修为已够再升一级,立刻补上
        this.processPendingLevelUps();
      },
    });
  }

  /**
   * 打开法术替换面板。
   * @param newId 要参悟的新法术 id
   */
  private openReplaceSpell(newId: string): void {
    this.scene.launch('ReplaceSpellScene', {
      newSpellId: newId,
      onReplace: (dropId: string | null) => {
        // dropId 为 null = 玩家放弃,新法术离去,已有法术原样保留
        if (dropId) {
          this.weaponSystem.replaceWeapon(dropId, newId);
        }
        this.scene.stop('ReplaceSpellScene');
        this.events.emit(GameEvents.UPGRADE_APPLIED, {
          id: `replace_${newId}`, type: 'newSpell',
          name: newId, description: '', iconColor: 0xffffff,
          apply: () => {},
        });
        this.resumeGame();
        this.processPendingLevelUps();
      },
    });
  }

  /**
   * XPSystem.add 的 while 循环只升一级就 break,多余的修为留在 xp 里。
   * 选完卡调用本方法把欠下的等级补上(可能连续补多级)。
   */
  private processPendingLevelUps(): void {
    while (this.xpSystem.getXp() >= this.xpSystem.getXpToNext() && !this.realmSystem.isBlocked) {
      if (this.isPaused) return;
      this.handleLevelUp();
      // handleLevelUp 内部会再次 pauseGame 并 launch 面板
      if (this.isPaused) return;
    }
  }

  /**
   * 构建三选一卡池。
   * 放在 GameScene 是因为只有这里同时握有法术系统与境界系统,
   * 「槽位是否已满 / 这门法术是否已掌握」只有这里能回答。
   *
   * 构成:1 张动态卡 + 2 张静态卡,保证每次选择都有变化。
   */
  private buildUpgradeCards(): Upgrade[] {
    const dynamic = this.buildDynamicCards();
    const picks: Upgrade[] = [];

    // 法位已满时,「参悟新术」(→替换面板)必须出现。
    // 那是玩家换掉旧法术的唯一途径,若混在动态卡里随机抽,
    // 在 4 张动态卡里只有 1/4 概率露面,等于这个功能不存在。
    const slotsFull = this.weaponSystem.getWeaponCount() >= this.realmSystem.getSpellSlots();
    const replaceCard = slotsFull ? dynamic.find((u) => u.type === 'newSpell') : undefined;
    if (replaceCard) picks.push(replaceCard);

    // 其余的动态卡随机抽一张,保证每次选择都有变化
    const rest = dynamic.filter((u) => u !== replaceCard);
    if (rest.length > 0 && picks.length < 3) {
      picks.push(rest[Math.floor(Math.random() * rest.length)]);
    }

    const pool = MathUtils.shuffle(STAT_UPGRADES.slice());
    for (const up of pool) {
      if (picks.length >= 3) break;
      picks.push(up);
    }
    return picks;
  }

  /** 动态卡:法宝精进 / 神通升重 / 神通栏解锁 / 开辟法位 */
  private buildDynamicCards(): Upgrade[] {
    const out: Upgrade[] = [];

    // 0. 法宝精进 —— 设计书:法宝满 5 级,线性叠加。
    //    这是法宝的主要成长途径(重复拾取只是兜底)。满级的不出卡。
    for (const a of this.artifactSystem.getEquipped()) {
      const cfg = ARTIFACTS[a.id];
      if (!cfg) continue;
      if (!this.artifactSystem.canUpgrade(a.id)) continue;
      const next = a.level + 1;
      out.push({
        id: `artifactLevel_${a.id}`,
        type: 'artifactLevel',
        name: `${cfg.name} 祭炼至 ${next} 级`,
        description: `威力持续增强(当前 ${a.level} 级)`,
        iconColor: cfg.color,
        apply: (c: UpgradeContext) => { c.artifactSystem.upgrade(a.id); },
      });
    }

    // 1. 神通升重 —— 走重数刻度的神通用的。
    //    进化三条件之一就是「满 8 重」,没有这张卡玩家永远凑不齐条件,
    //    整套进化机制就成了死代码。满重的神���不出这张卡。
    for (const w of this.weaponSystem.getWeapons()) {
      const cfg = WEAPONS[w.id];
      if (!cfg?.usesRituals) continue;
      if (w.ritual >= MAX_RITUAL) continue;

      const next = w.ritual + 1;
      out.push({
        id: `ritual_${w.id}`,
        type: 'spellLevel',
        name: `${cfg.name} 参悟至 ${next} 重`,
        description: `威力 ×${ritualDamageMul(next).toFixed(2)}(当前 ${w.ritual} 重 ×${ritualDamageMul(w.ritual).toFixed(2)})`,
        iconColor: cfg.color,
        apply: (c: UpgradeContext) => { c.weaponSystem.addRitual(w.id); },
      });
    }

    // 2. 法术精进 —— 每个已掌握的**旧刻度**法术各一张。
    //    走重数的跳过:它们已经有「参悟至 N 重」卡了,再出一张 Lv 卡
    //    会让同一个神通在卡池里占两席,把别的选项稀释掉。
    for (const w of this.weaponSystem.getWeapons()) {
      const cfg = WEAPONS[w.id];
      if (cfg?.usesRituals) continue;
      const nextLevel = w.level + 1;
      // 把实际倍率写进卡面,免得玩家精进了却看不出收益在哪
      const nextMul = Math.pow(1.25, nextLevel - 1);
      out.push({
        id: `spellLevel_${w.id}`,
        type: 'spellLevel',
        name: `${cfg?.name ?? w.id} 精进 Lv${nextLevel}`,
        description: `该法术威力 ×${nextMul.toFixed(2)}(当前 Lv${w.level} ×${Math.pow(1.25, w.level - 1).toFixed(2)})`,
        iconColor: cfg?.color ?? 0xffffff,
        apply: (c: UpgradeContext) => { c.weaponSystem.addWeapon(w.id); },
      });
    }

    // 3. 神通栏解锁 —— 设计书 §4.5 的解锁表。
    //
    //    与「参悟新术」的区别:那张卡从**境界池**里随机抽,按境界解锁;
    //    这张卡按**等级**解锁固定候选,对应设计书「凝气吃 2 格」的节奏。
    //    两套规则并存,所以同一门神通不能同时出现在两边 ——
    //    getAttainableSpells 已排除 usesRituals 的神��。
    const def = SPELL_SLOTS.find(
      (s) => !s.isDefault && s.candidates.length > 0 && this.xpSystem.level >= s.unlockLevel && s.slot > this.weaponSystem.getWeaponCount(),
    );
    if (def) {
      const id = rollCandidate(def.candidates);
      const cfg = id ? WEAPONS[id] : undefined;
      if (cfg) {
        const geo = cfg.geometry ? GEOMETRIES[cfg.geometry] : null;
        out.push({
          id: `unlockSlot_${def.slot}_${cfg.id}`,
          type: 'newSpell',
          name: `参悟 ${cfg.name}`,
          // 把几何写进卡面:玩家要能看出这一件与手上的形状**不同**,
          // 这是设计书「覆盖几何互不重复」规则在 UI 上的落点
          description: geo
            ? `${geo.name} · ${geo.decision}`
            : '解锁第 ' + def.slot + ' 格神通',
          iconColor: cfg.color,
          apply: (c: UpgradeContext) => { c.weaponSystem.addWeapon(cfg.id); },
        });
      }
    }

    // 5. 开辟法位 —— 硬上限为 境界基础 + 2
    //    如果实测这张卡很弱,直接删掉即可,两个门槛会合并成一个,其余不受影响
    if (this.realmSystem.bonusSpellSlots < MAX_BONUS_SPELL_SLOTS) {
      const room = 2 - this.realmSystem.bonusSpellSlots;
      out.push({
        id: 'spellSlot',
        type: 'spellSlot',
        name: '开辟法位',
        description: `额外参悟 ${room} 门法术`,
        iconColor: 0x88ffdd,
        apply: () => { this.realmSystem.bonusSpellSlots += 1; },
      });
    }

    return out;
  }

  public applyUpgrade(upgrade: Upgrade): void {
    upgrade.apply({
      player: this.player,
      weaponSystem: this.weaponSystem,
      artifactSystem: this.artifactSystem,
    });
    this.events.emit(GameEvents.UPGRADE_APPLIED, upgrade);
  }

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
    // 这里曾经顺手把投射物速度清零,那是错的:physics.world.pause() 本身就
    // 会让物理步整帧早退,速度根本不需要清 —— 而清了之后,飞行中的投射物在
    // 玩家选完卡恢复时速度仍是 0,会原地悬停到寿命结束。
    this.tweens.pauseAll();
    if (emitEvent) this.events.emit(GameEvents.GAME_PAUSE);
  }

  public resumeGame(): void {
    this.isPaused = false;
    this.physics.world.resume();
    this.tweens.resumeAll();
    this.events.emit(GameEvents.GAME_RESUME);
  }

  private onPlayerDeath(): void {
    if (this.scene.isActive('GameOverScene')) return;
    const timeSec = Math.floor(this.elapsed / 1000);
    const isNewRecordTime = timeSec > SaveManager.getBestTime();
    const isNewRecordKills = this.kills > SaveManager.getBestKills();
    if (isNewRecordTime) SaveManager.setBestTime(timeSec);
    if (isNewRecordKills) SaveManager.setBestKills(this.kills);
    SaveManager.incTotalRuns();

    this.scene.launch('GameOverScene', {
      time: timeSec,
      kills: this.kills,
      level: this.xpSystem.level,
      realmName: this.realmSystem.getDisplayName(),
      artifacts: this.artifactSystem.getEquipped().map((a) => a.id),
      newRecordTime: isNewRecordTime,
      newRecordKills: isNewRecordKills,
    });
    this.scene.pause();
  }
}
