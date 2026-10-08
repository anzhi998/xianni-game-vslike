import Phaser from 'phaser';
import { Enemy } from '../entities/Enemy';
import { getWaveAtTime, getDifficultyMultiplier, pickEnemyType } from '../config/WaveConfig';
import { rollEliteMutation } from '../config/EliteConfig';
import { WORLD_WIDTH, WORLD_HEIGHT } from '../config/GameConfig';

export class SpawnSystem {
  private getPlayerPos: () => { x: number; y: number };
  private getRealmIndex: () => number;
  private enemyPool: Phaser.GameObjects.Group;
  private spawnAccumulator = 0;

  constructor(
    enemyPool: Phaser.GameObjects.Group,
    getPlayerPos: () => { x: number; y: number },
    getRealmIndex: () => number = () => 0,
  ) {
    this.enemyPool = enemyPool;
    this.getPlayerPos = getPlayerPos;
    this.getRealmIndex = getRealmIndex;
  }

  update(time: number, delta: number): void {
    const seconds = time / 1000;
    const wave = getWaveAtTime(seconds);
    const difficulty = getDifficultyMultiplier(seconds, wave.difficulty);
    const interval = wave.spawnInterval / Math.sqrt(difficulty);
    this.spawnAccumulator += delta / 1000;
    if (this.spawnAccumulator >= interval) {
      this.spawnAccumulator = 0;
      this.spawnOne(wave, difficulty, seconds, interval);
    }
  }

  private spawnOne(
    wave: { weights: Record<string, number> },
    difficulty: number,
    seconds: number,
    interval: number,
  ): void {
    const player = this.getPlayerPos();
    // 屏幕外一圈生成(距离玩家 700-1000 px)
    const angle = Math.random() * Math.PI * 2;
    const dist = 700 + Math.random() * 300;
    let x = player.x + Math.cos(angle) * dist;
    let y = player.y + Math.sin(angle) * dist;
    // 限制在世界范围内
    x = Math.max(40, Math.min(WORLD_WIDTH - 40, x));
    y = Math.max(40, Math.min(WORLD_HEIGHT - 40, y));

    const type = pickEnemyType(wave.weights);
    const mutation = rollEliteMutation(seconds, interval);
    const enemy = this.enemyPool.get() as Enemy;
    // 池耗尽时返回 null(依赖 setupPools 设了有限 maxSize)
    if (!enemy) return;
    // 掉落表需要知道玩家当前境界,才能给「正缺的那个丹药」加权
    enemy.currentRealmIndex = this.getRealmIndex();
    enemy.setup(type, difficulty, mutation);
    enemy.setPosition(x, y);
  }
}
