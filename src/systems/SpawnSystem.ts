import Phaser from 'phaser';
import { Enemy } from '../entities/Enemy';
import { ENEMIES } from '../config/EnemyConfig';
import {
  getWaveFor, getDifficultyMultiplier, pickEnemyType, MAX_LIVE_ENEMIES,
} from '../config/WaveConfig';
import { rollEliteMutation, makeEliteMutation, MAX_LIVE_ELITES } from '../config/EliteConfig';
import { NORMAL_MUTATION } from '../types';
import { WORLD_WIDTH, WORLD_HEIGHT } from '../config/GameConfig';
import type { EnemyMutation } from '../types';

/**
 * 刷怪系统
 *
 * 构成按**大境界段**取(WaveConfig.SEGMENT_WAVES),密度按时间爬坡。
 * 「哪种怪」与「多密」分开的理由见 WaveConfig 的注释。
 */
export class SpawnSystem {
  private getPlayerPos: () => { x: number; y: number };
  private getRealmIndex: () => number;
  /** 取玩家已装备的法宝 id。用于给「还缺的进化钥匙」加权掉率 */
  private getOwnedArtifacts: () => string[];
  private enemyPool: Phaser.GameObjects.Group;
  private spawnAccumulator = 0;
  /** 最近一次 update 的时间(秒)。分裂生成的幼虫要沿用当时的难度 */
  private lastSeconds = 0;

  constructor(
    enemyPool: Phaser.GameObjects.Group,
    getPlayerPos: () => { x: number; y: number },
    getRealmIndex: () => number = () => 0,
    getOwnedArtifacts: () => string[] = () => [],
  ) {
    this.enemyPool = enemyPool;
    this.getPlayerPos = getPlayerPos;
    this.getRealmIndex = getRealmIndex;
    this.getOwnedArtifacts = getOwnedArtifacts;
  }

  update(time: number, delta: number): void {
    const seconds = time / 1000;
    this.lastSeconds = seconds;
    const wave = getWaveFor(this.getRealmIndex());
    const difficulty = getDifficultyMultiplier(seconds, wave.difficulty);
    const interval = wave.spawnInterval / Math.sqrt(difficulty);
    this.spawnAccumulator += delta / 1000;
    if (this.spawnAccumulator < interval) return;
    this.spawnAccumulator = 0;

    // 天道承载力:场上存活到顶就不再刷新(文档第八节)。
    // 它不是性能妥协 ——「敌人是有限的资源」是「迎怪而上」这条策略的前提
    if (this.enemyPool.countActive(true) >= MAX_LIVE_ENEMIES) return;

    this.spawnOne(wave.weights, difficulty, interval);
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

    enemy.currentRealmIndex = this.getRealmIndex();
    enemy.ownedArtifacts = this.getOwnedArtifacts();
    const mutation = elite ? makeEliteMutation(cfg.resist) : NORMAL_MUTATION;
    enemy.setup(type as keyof typeof ENEMIES, this.currentDifficulty(), mutation, this.getRealmIndex());
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
    const wave = getWaveFor(this.getRealmIndex());
    return getDifficultyMultiplier(this.lastSeconds, wave.difficulty);
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
    // 靠的是玩家发现它出现在自己身后 300 像素处。
    const stealth = cfg?.approach === 'stealth';
    const angle = Math.random() * Math.PI * 2;
    const dist = stealth ? 300 + Math.random() * 400 : 700 + Math.random() * 300;
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
    // 掉落表需要知道玩家当前境界与已持有的法宝,
    // 才能给「正缺的那个丹药」和「还缺的那把钥匙」加权
    enemy.currentRealmIndex = this.getRealmIndex();
    enemy.ownedArtifacts = this.getOwnedArtifacts();
    enemy.setup(type, difficulty, mutation, this.getRealmIndex());
    enemy.setPosition(x, y);
  }
}
