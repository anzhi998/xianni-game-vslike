import Phaser from 'phaser';
import { BOSSES, BOSS_SCHEDULE } from '../config/BossConfig';
import type { BossDef, BossPhaseDef } from '../config/BossConfig';
import { GameEvents } from '../types';
import type { Enemy } from '../entities/Enemy';

export interface BossDeps {
  /** 从池里生成一只首领。返回 null 表示池已满(不排队,直接放弃这一只) */
  spawnBoss: (bossId: string) => Enemy | null;
  /** 发一发敌方弹丸 */
  spawnShot: (x: number, y: number, angle: number, damage: number, speed: number) => void;
  /** 落点预警圈(火雨)。复用灵脉地热那套:预警 → 喷发 */
  spawnVent: (x: number, y: number, radius: number, warnMs: number, eruptMs: number, damage: number) => void;
  getPlayer: () => { x: number; y: number };
}

interface BossTimers {
  fanAt: number;
  rainAt: number;
}

/**
 * 首领系统 —— 时间表 + 阶段
 *
 * 它**不写敌人的速度**。EnemyAiSystem 是敌人速度唯一的作者(见 CLAUDE.md),
 * 本类只回答「什么时候出什么招」,由 AI 的 boss 分支回调过来。
 * 拆开之后首领的移动手感与普通怪完全一致,不会因为多了一套 AI 而失衡。
 */
export class BossSystem {
  private scene: Phaser.Scene;
  private deps: BossDeps;
  private timers = new Map<Enemy, BossTimers>();

  /** 当前在场的首领。UIScene 的血条直接读它的 health/maxHealth */
  public current: Enemy | null = null;
  private fired = new Set<string>();

  constructor(scene: Phaser.Scene, deps: BossDeps) {
    this.scene = scene;
    this.deps = deps;
  }

  update(seconds: number): void {
    for (const def of BOSS_SCHEDULE) {
      if (this.fired.has(def.id)) continue;
      if (seconds < def.atSeconds) continue;
      this.fired.add(def.id);
      const e = this.deps.spawnBoss(def.id);
      if (e) {
        this.current = e;
        this.scene.events.emit(GameEvents.BOSS_SPAWNED, def.id);
      }
    }
  }

  /** 首领死亡时由 GameScene 叫来:清血条 */
  onBossKilled(): void {
    if (this.current) this.timers.delete(this.current);
    this.current = null;
  }

  /** 立即放某只首领(调试面板用)。清掉已放标记,好让调试能反复看 */
  forceSpawn(bossId: string): string {
    const def = BOSSES[bossId];
    if (!def) return '没有这只首领';
    this.fired.delete(bossId);
    const e = this.deps.spawnBoss(bossId);
    if (!e) return '敌人池已满';
    this.current = e;
    this.scene.events.emit(GameEvents.BOSS_SPAWNED, def.id);
    return `${def.name} 登场`;
  }

  /**
   * 首领的一次行动。由 EnemyAiSystem 的 boss 分支在到点时调用。
   *
   * 两件事按各自独立的计时器走:火羽扇与火雨不必同频,
   * 硬绑在一起会让二阶段的压迫感变成一个规整的节拍器,反而好躲。
   */
  act(enemy: Enemy): void {
    const def = BOSSES[enemy.bossKey];
    if (!def || !enemy.active) return;
    const now = this.scene.time.now;
    const hpRatio = Math.max(0, enemy.health / enemy.maxHealth);

    // 浴火重生:只在跨过阈值的那一刻触发一次。
    // bossRebornUsed 保证只有一次 —— 否则这只 Boss 永远打不死。
    if (def.rebirthAtHp !== undefined && !enemy.bossRebornUsed && hpRatio <= def.rebirthAtHp) {
      enemy.bossRebornUsed = true;
      enemy.health = enemy.maxHealth;
      enemy.bossPhase = def.rebirthPhase ?? def.phases.length - 1;
      this.timers.delete(enemy);
      this.scene.events.emit('boss-reborn', def.id);
      return;                    // 回满当帧不出招,给玩家一眼看清「它变了」
    }

    const p = this.phaseOf(def, hpRatio);
    enemy.bossPhase = def.phases.indexOf(p);

    let t = this.timers.get(enemy);
    if (!t) {
      t = { fanAt: now + 1200, rainAt: now + 2600 };
      this.timers.set(enemy, t);
    }

    if (p.fan && now >= t.fanAt) {
      this.castFan(enemy, p.fan, now);
      t.fanAt = now + p.fan.intervalMs / p.tempo;
    }
    if (p.rain && now >= t.rainAt) {
      this.castRain(enemy, p.rain, now);
      t.rainAt = now + p.rain.intervalMs / p.tempo;
    }
    enemy.bossNextActionAt = Math.min(t.fanAt, t.rainAt);
  }

  private phaseOf(def: BossDef, hpRatio: number): BossPhaseDef {
    for (const p of def.phases) {
      if (hpRatio > p.hpAbove) return p;
    }
    return def.phases[def.phases.length - 1];
  }

  private castFan(enemy: Enemy, fan: NonNullable<BossPhaseDef['fan']>, _now: number): void {
    const player = this.deps.getPlayer();
    const base = Phaser.Math.Angle.Between(enemy.x, enemy.y, player.x, player.y);
    const step = fan.count > 1 ? fan.spread / (fan.count - 1) : 0;
    for (let i = 0; i < fan.count; i++) {
      const a = base - fan.spread / 2 + i * step;
      this.deps.spawnShot(enemy.x, enemy.y, a, fan.damage, fan.speed);
    }
  }

  private castRain(_enemy: Enemy, rain: NonNullable<BossPhaseDef['rain']>, _now: number): void {
    const player = this.deps.getPlayer();
    for (let i = 0; i < rain.count; i++) {
      // 第 0 处必定压在玩家脚下,其余散在四周。
      // 完全随机的落点只会砸空,而「有一半一定会逼近你」才构成压力。
      const a = Math.random() * Math.PI * 2;
      const d = i === 0 ? 0 : 120 + Math.random() * 260;
      this.deps.spawnVent(
        player.x + Math.cos(a) * d,
        player.y + Math.sin(a) * d,
        rain.radius, rain.warnMs, 700, rain.damage,
      );
    }
  }

  /** 血条比例。UIScene 每帧拉取,不在这里发事件 */
  get bossHpRatio(): number {
    const e = this.current;
    if (!e || !e.active || e.isDead) return 0;
    return Math.max(0, Math.min(1, e.health / e.maxHealth));
  }

  /** 血条上的阶段名 */
  get phaseName(): string {
    const e = this.current;
    if (!e) return '';
    const def = BOSSES[e.bossKey];
    if (!def) return '';
    return def.phases[e.bossPhase]?.name ?? '';
  }
}