import Phaser from 'phaser';
import { Player } from '../entities/Player';
import { Enemy } from '../entities/Enemy';
import { Projectile } from '../entities/Projectile';
import { Pickup } from '../entities/Pickup';
import { DamageText } from '../entities/DamageText';
import { InputManager } from '../utils/InputManager';
import { WeaponSystem } from '../systems/WeaponSystem';
import { SpawnSystem } from '../systems/SpawnSystem';
import { XPSystem } from '../systems/XPSystem';
import { ArtifactSystem } from '../systems/ArtifactSystem';
import { RealmSystem } from '../systems/RealmSystem';
import { WORLD_WIDTH, WORLD_HEIGHT } from '../config/GameConfig';
import { STARTING_WEAPON, WEAPONS, getAttainableSpells } from '../config/WeaponConfig';
import { REALMS } from '../config/RealmConfig';
import { STAT_UPGRADES, MAX_BONUS_SPELL_SLOTS } from '../config/CultivationUpgradeConfig';
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
  public xpPool!: Phaser.GameObjects.Group;
  public damageTextPool!: Phaser.GameObjects.Group;

  // 系统
  public inputManager!: InputManager;
  public weaponSystem!: WeaponSystem;
  public spawnSystem!: SpawnSystem;
  public xpSystem!: XPSystem;
  public artifactSystem!: ArtifactSystem;
  public realmSystem!: RealmSystem;

  // 状态
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
    this.setupPools();
    this.setupPlayer();
    this.setupCamera();
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
    this.enemyPool = this.add.group({ runChildUpdate: true, classType: Enemy, maxSize: 80 });
    this.projectilePool = this.add.group({ runChildUpdate: true, classType: Projectile, maxSize: 140 });
    this.xpPool = this.add.group({ runChildUpdate: true, classType: Pickup, maxSize: 160 });
    this.damageTextPool = this.add.group({ runChildUpdate: true, classType: DamageText, maxSize: 60 });

    // 预创建
    for (let i = 0; i < 80; i++) {
      this.createPooledEnemy();
    }
    for (let i = 0; i < 140; i++) {
      this.createPooledProjectile();
    }
    for (let i = 0; i < 160; i++) {
      this.createPooledXP();
    }
    for (let i = 0; i < 60; i++) {
      this.createPooledDamageText();
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

  private setupCamera(): void {
    this.cameras.main.startFollow(this.player, true, 0.15, 0.15);
    this.cameras.main.setBounds(0, 0, WORLD_WIDTH, WORLD_HEIGHT);
    this.cameras.main.setDeadzone(40, 40);
    this.physics.world.setBounds(0, 0, WORLD_WIDTH, WORLD_HEIGHT);
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
    );
    this.weaponSystem.addWeapon(STARTING_WEAPON);

    this.realmSystem = new RealmSystem(
      this,
      this.player,
      this.weaponSystem,
      this.artifactSystem,
    );

    this.spawnSystem = new SpawnSystem(
      this.enemyPool,
      () => ({ x: this.player.x, y: this.player.y }),
      () => this.realmSystem.majorIndex,
    );

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
      (_p, _e) => this.onPlayerHitEnemy(_p as Player, _e as Enemy),
      (_p, _e) => {
        const pl = _p as Player;
        const en = _e as Enemy;
        return pl.active && en.active && !en.isDead && !pl.isDead();
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

    // 敌人追踪玩家
    this.updateEnemies();

    // XP 吸附
    this.updateXPMagnets();

    // 死亡判定
    if (this.player.isDead()) {
      this.onPlayerDeath();
    }
  }

  private updateEnemies(): void {
    const px = this.player.x;
    const py = this.player.y;
    this.enemyPool.children.iterate((c) => {
      if (!c || !c.active) return true;
      const e = c as Enemy;
      if (e.isDead) return true;
      const body = e.body as Phaser.Physics.Arcade.Body;
      const dx = px - e.x;
      const dy = py - e.y;
      const len = Math.sqrt(dx * dx + dy * dy) || 1;
      const sp = e.speed;
      body.setVelocity((dx / len) * sp, (dy / len) * sp);
      e.setFlipX(dx < 0);
      return true;
    });
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
    if (!enemy.active || enemy.isDead) return;
    if (proj.hitSet.has(enemy)) return;
    proj.hitSet.add(enemy);

    const killed = enemy.takeDamage(proj.damage, this.time.now);
    this.spawnDamageText(enemy.x, enemy.y - 8, Math.round(proj.damage), '#ffffff', false);

    if (killed) {
      this.onEnemyKilled(enemy);
    }
    proj.onHitEnemy();
  }

  private onEnemyKilled(enemy: Enemy): void {
    this.kills++;
    // 掉落灵液
    this.spawnPickup(enemy.x, enemy.y, 'xp', enemy.xpValue);

    // 精英额外掉落:法宝 / 突破道具
    for (const d of enemy.drops) {
      this.spawnPickup(enemy.x, enemy.y, d.kind, d.payload);
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

  /** 直接发放(池耗尽时的降级路径) */
  private grantPickup(kind: PickupKind, payload: number | string): void {
    if (kind === 'xp') {
      this.xpSystem.add(typeof payload === 'number' ? payload : 1);
      return;
    }
    if (kind === 'artifact') {
      const taken = this.artifactSystem.equip(String(payload));
      if (!taken) this.spawnPickup(this.player.x, this.player.y, 'keyItem', this.pickNeededKeyItem());
      return;
    }
    this.collectKeyItem(String(payload));
  }

  /** 玩家当前突破所缺的道具 id,没有则返回空串 */
  private pickNeededKeyItem(): string {
    const next = this.realmSystem.next;
    return next ? next.keyItemId : '';
  }

  private onPlayerHitEnemy(player: Player, enemy: Enemy): void {
    const now = this.time.now;
    if (player.takeDamage(enemy.contactDamage, enemy.x, enemy.y, now)) {
      this.spawnDamageText(player.x, player.y - 16, Math.round(enemy.contactDamage), '#ff5555', false);
      this.events.emit(GameEvents.PLAYER_DAMAGED, player.health);
    }
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
    this.grantPickup(kind, payload);
    this.events.emit(GameEvents.XP_COLLECTED, kind === 'xp' ? (payload as number) : 0);
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

    if (dynamic.length > 0) {
      picks.push(dynamic[Math.floor(Math.random() * dynamic.length)]);
    }

    const pool = MathUtils.shuffle(STAT_UPGRADES.slice());
    for (const up of pool) {
      if (picks.length >= 3) break;
      picks.push(up);
    }
    return picks;
  }

  /** 动态卡:法术精进 / 参悟新术 / 开辟法位 */
  private buildDynamicCards(): Upgrade[] {
    const out: Upgrade[] = [];
    const slots = this.realmSystem.getSpellSlots();

    // 1. 法术精进 —— 每个已掌握的法术各一张
    for (const w of this.weaponSystem.getWeapons()) {
      const cfg = WEAPONS[w.id];
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

    // 2. 参悟新术 —— 新池优先,旧池降级;槽位未满时才出现
    const has = (id: string) => this.weaponSystem.hasWeapon(id);
    const attainable = getAttainableSpells(this.realmSystem.current.id, has);
    if (this.weaponSystem.getWeaponCount() < slots && attainable.length > 0) {
      const pick = attainable[Math.floor(Math.random() * attainable.length)];
      // 来自当前境界还是降级的旧池,卡面要说清楚
      const fromCurrent = pick.realmId === this.realmSystem.current.id;
      const realmName = REALMS.find((r) => r.id === pick.realmId)?.name ?? '';
      out.push({
        id: `newSpell_${pick.id}`,
        type: 'newSpell',
        name: `参悟 ${pick.name}`,
        description: fromCurrent
          ? `${realmName}法术,领悟后威力远超旧术`
          : `旧法重修(${realmName}),威力已逊于当前境界`,
        iconColor: pick.color,
        apply: (c: UpgradeContext) => { c.weaponSystem.addWeapon(pick.id); },
      });
    }

    // 3. 开辟法位 —— 硬上限为 境界基础 + 2
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
    this.projectilePool.children.iterate((c) => {
      if (!c) return true;
      const sprite = c as Phaser.Physics.Arcade.Sprite;
      const body = sprite.body as Phaser.Physics.Arcade.Body | null;
      if (body) body.setVelocity(0, 0);
      return true;
    });
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
