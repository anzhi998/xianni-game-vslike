import Phaser from 'phaser';
import { Enemy } from '../entities/Enemy';
import { ENEMIES } from '../config/EnemyConfig';
import {
  getPace, buildWeights, getDifficultyMultiplier, pickEnemyType, MAX_LIVE_ENEMIES,
} from '../config/WaveConfig';
import { rollEliteMutation, makeEliteMutation, MAX_LIVE_ELITES } from '../config/EliteConfig';
import { NORMAL_MUTATION } from '../types';
import { WORLD_WIDTH, WORLD_HEIGHT, viewRadius } from '../config/GameConfig';
import type { EnemyMutation } from '../types';

/**
 * 刷怪系统
 *
 * 构成按**登场表**取(WaveConfig.ENEMY_INTROS:谁在第几秒第一次出现),
 * 密度按**节奏段**取(WaveConfig.PACE_SEGMENTS:每段的基础间隔与强度)。
 * 两张表互不相干,所以「早一点引出第二种怪」不会顺手改掉密度 —— 反过来也一样。
 * 「哪种怪」与「多密」分开的理由见 WaveConfig 的注释。
 */
export class SpawnSystem {
  private getPlayerPos: () => { x: number; y: number };
  private getPlayerRealmIndex: () => number;
  /** 取玩家已掌握的法术 id。用于把「还没学的法术的专属遗物」排除掉落池 */
  private getSpellIds: () => string[];
  /** 取玩家已装备的遗物 id。用于给「还缺的进化钥匙」加权掉率 */
  private getOwnedRelics: () => string[];
  private enemyPool: Phaser.GameObjects.Group;
  private spawnAccumulator = 0;
  /** 最近一次 update 的时间(秒)。分裂生成的幼虫要沿用当时的难度 */
  private lastSeconds = 0;

  constructor(
    enemyPool: Phaser.GameObjects.Group,
    getPlayerPos: () => { x: number; y: number },
    getPlayerRealmIndex: () => number = () => 0,
    getSpellIds: () => string[] = () => [],
    getOwnedRelics: () => string[] = () => [],
  ) {
    this.enemyPool = enemyPool;
    this.getPlayerPos = getPlayerPos;
    this.getPlayerRealmIndex = getPlayerRealmIndex;
    this.getSpellIds = getSpellIds;
    this.getOwnedRelics = getOwnedRelics;
  }

  /**
   * @param seconds **本局已经过去多少秒**,不是场景时钟。
   *
   * ⚠️ 这里必须收 `elapsed`,不能收 `time`。Phaser 交上来的 `time` 是
   *    「页面打开以来的毫秒数」,而 `GameScene.elapsed` 是「本局开始的毫秒数」——
   *    两者相差一段「玩家在主菜单上停留的时间」。
   *    曾经这里写的是 `time / 1000`:在菜单上待够 8 分钟再开局,第 8 分钟的
   *    怪(第一个远程)会在开局第 1 秒刷到脸上,而 HUD 计时器还显示 00:00 ——
   *    玩家完全无从理解发生了什么。它不报错,只是开局怪得莫名其妙。
   */
  update(seconds: number, delta: number): void {
    this.lastSeconds = seconds;
    const pace = getPace(seconds);
    const difficulty = getDifficultyMultiplier(seconds, pace.difficulty);
    const interval = pace.spawnInterval / Math.sqrt(difficulty);
    this.spawnAccumulator += delta / 1000;
    if (this.spawnAccumulator < interval) return;
    this.spawnAccumulator = 0;

    // 天道承载力:场上存活到顶就不再刷新(文档第八节)。
    // 它不是性能妥协 ——「敌人是有限的资源」是「迎怪而上」这条策略的前提
    if (this.enemyPool.countActive(true) >= MAX_LIVE_ENEMIES) return;

    this.spawnOne(buildWeights(seconds), difficulty, interval);
  }

  /**
   * 衍生体(蛊虫分裂出的幼虫)。
   *
   * 单独一个入口而不是让 GameScene 直接摸池:难度的口径(时间爬坡 × 段基础值)
   * 只有这里知道,分裂产物必须沿用同一套,否则幼虫会比同期的怪弱一档。
   */
  spawnChild(type: string, x: number, y: number, elite = false): void {
    if (!ENEMIES[type]) return;
    const cfg = ENEMIES[type];
    const enemy = this.enemyPool.get() as Enemy;
    if (!enemy) return;

    enemy.currentRealmIndex = this.getPlayerRealmIndex();
    enemy.ownedRelics = this.getOwnedRelics();
    const mutation = elite ? makeEliteMutation(cfg.resist) : NORMAL_MUTATION;
    enemy.setup(type as keyof typeof ENEMIES, this.currentDifficulty(), mutation, this.getPlayerRealmIndex());
    const angle = Math.random() * Math.PI * 2;
    const r = cfg.size;
    enemy.setPosition(
      Phaser.Math.Clamp(x + Math.cos(angle) * r, 20, WORLD_WIDTH - 20),
      Phaser.Math.Clamp(y + Math.sin(angle) * r, 20, WORLD_HEIGHT - 20),
    );
  }

  /** 场上存活的精英数。只在掷出精英时调用一次(每次生成一次 O(n) 可接受) */
  private liveElites(): number {
    let n = 0;
    const children = this.enemyPool.getChildren();
    for (let i = 0; i < children.length; i++) {
      const e = children[i] as Enemy;
      if (e && e.active && !e.isDead && e.isElite) n++;
    }
    return n;
  }

  private currentDifficulty(): number {
    const pace = getPace(this.lastSeconds);
    return getDifficultyMultiplier(this.lastSeconds, pace.difficulty);
  }

  private spawnOne(
    weights: Record<string, number>,
    difficulty: number,
    interval: number,
  ): void {
    const player = this.getPlayerPos();
    const type = pickEnemyType(weights);
    const cfg = ENEMIES[type];

    // 潜行怪走单独的生成规则:它们在**屏内任意角度**现身,而不是从屏外走进来。
    // 这是「穿墙潜行」在代码里的全部含义 ——「后方」这个概念的失效不靠贴图,
    // 靠的是玩家发现它出现在自己身后几百像素处。
    //
    // ⚠️ 两个距离都以 `viewRadius()`(一屏半对角线)为单位:镜头拉近之后
    //    「屏内」本身变小了,写死像素会让潜行怪直接刷到屏幕外去 ——
    //    那正是「穿墙潜行」赖以成立的那一眼消失的地方,而且不报错。
    //    括号里是 zoom = 1 时的等价像素。
    const stealth = cfg?.approach === 'stealth';
    const angle = Math.random() * Math.PI * 2;
    const r = viewRadius();
    const dist = stealth
      ? r * (0.41 + Math.random() * 0.55)   // 300–700px:屏内
      : r * (0.96 + Math.random() * 0.42);  // 700–1000px:屏外一点点
    let x = player.x + Math.cos(angle) * dist;
    let y = player.y + Math.sin(angle) * dist;
    // 限制在世界范围内
    x = Math.max(40, Math.min(WORLD_WIDTH - 40, x));
    y = Math.max(40, Math.min(WORLD_HEIGHT - 40, y));

    // 精英掷骰带上本段怪的天生抗性:铁甲兽即使被掷成精英,它的牵引抗性也还在,
    // 且「基础 + 掷骰」的总数被封在两条以内(文档硬约束)
    let mutation: EnemyMutation = rollEliteMutation(this.lastSeconds, interval, cfg.resist);
    // 精英上限:×30 血 + 不 despawn 意味着打不动的精英会堆成一堵墙
    if (mutation.elite && this.liveElites() >= MAX_LIVE_ELITES) {
      mutation = NORMAL_MUTATION;
    }
    const enemy = this.enemyPool.get() as Enemy;
    // 池耗尽时返回 null(依赖 setupPools 设了有限 maxSize)
    if (!enemy) return;
    // 掉落表需要知道玩家已掌握哪些法术、已持有哪些遗物,
    // 才能把没学的法术的专属遗物排除掉,并给「还缺的那把钥匙」加权
    enemy.currentRealmIndex = this.getPlayerRealmIndex();
    enemy.ownedRelics = this.getOwnedRelics();
    enemy.ownedSpells = this.getSpellIds();
    enemy.setup(type, difficulty, mutation, this.getPlayerRealmIndex());
    enemy.setPosition(x, y);
  }
}
