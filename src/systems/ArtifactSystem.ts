/**
 * 法宝系统 —— 改写已装备法术的开火行为
 *
 * 为什么不把法宝做成 Player 上的字段:
 * 1. 法宝是「掉落」来的,不是「升级」来的,它的生命周期不经过任何现有系统;
 * 2. UIScene 是拉取式的,暴露 getEquipped() 就能零新事件接入;
 * 3. 合并结果必须缓存(脏标志),不能每发重算,而 Player 没有「装备变更」的概念;
 * 4. Player 是一个 Sprite,现有约定是 Upgrade.apply() 改它的标量属性。
 */
import Phaser from 'phaser';
import type { Player } from '../entities/Player';
import { ARTIFACTS, MAX_ARTIFACT_TIER } from '../config/ArtifactConfig';
import { GameEvents, NEUTRAL_MODS } from '../types';
import type { ArtifactInstance, FireModifiers } from '../types';

export class ArtifactSystem {
  private scene: Phaser.Scene;
  private equipped: ArtifactInstance[] = [];
  /** 合并结果缓存。装备变更时置 null,getModifiers() 惰性重算 */
  private cached: FireModifiers | null = null;
  private slotCap = 1;

  constructor(scene: Phaser.Scene, _player: Player) {
    this.scene = scene;
  }

  /** 由 RealmSystem 在大境界突破时调用 */
  setSlotCap(n: number): void {
    this.slotCap = Math.max(0, n);
  }

  getSlotCap(): number {
    return this.slotCap;
  }

  getEquipped(): ArtifactInstance[] {
    return this.equipped;
  }

  hasFreeSlot(): boolean {
    return this.equipped.length < this.slotCap;
  }

  has(id: string): boolean {
    return this.equipped.some((a) => a.id === id);
  }

  /**
   * 装备一件法宝。
   * @returns 实际获得的法宝 id;若法宝槽已满且没有同种法宝可升阶,返回 null
   *          (由调用方降级处理,例如转化为突破道具)
   */
  equip(id: string): string | null {
    if (!ARTIFACTS[id]) return null;

    const found = this.equipped.find((a) => a.id === id);
    if (found) {
      // 重复拾取 = 升阶。槽位满了也不会因为同名法宝而浪费。
      if (found.level >= MAX_ARTIFACT_TIER) return null;
      found.level++;
    } else {
      if (this.equipped.length >= this.slotCap) return null;
      this.equipped.push({ id, level: 1 });
    }

    this.cached = null;
    this.scene.events.emit(GameEvents.ARTIFACT_EQUIPPED, id);
    return id;
  }

  getModifiers(): FireModifiers {
    if (!this.cached) this.cached = this.merge();
    return this.cached;
  }

  /**
   * 合成规则(只此一处,写清楚以便后续扩展时统一遵守):
   *   - 计数相加(弹数、穿透、连锁次数)
   *   - 倍率相乘(伤害、冷却、范围、弹速、存在时间)
   *   - 角度/半径取 max 后 clamp
   *     散射用 max 而非相加:两个散射法宝叠加会形成 360° 墙式弹幕,一发都打不中。
   */
  private merge(): FireModifiers {
    const m: FireModifiers = { ...NEUTRAL_MODS };

    for (const inst of this.equipped) {
      const c = ARTIFACTS[inst.id];
      // 阶数缩放:每升一阶效果 +50%
      const s = 1 + (inst.level - 1) * 0.5;

      m.projectileAdd += Math.round(c.mods.projectileAdd * s);
      m.pierceAdd += Math.round(c.mods.pierceAdd * s);
      m.chainCount += Math.round(c.mods.chainCount * s);

      m.spreadRad = Math.max(m.spreadRad, c.mods.spreadRad);
      m.chainRadius = Math.max(m.chainRadius, c.mods.chainRadius);

      m.homingTurn += c.mods.homingTurn * s;

      m.projectileSpeedMul *= c.mods.projectileSpeedMul;
      m.damageMul *= c.mods.damageMul;
      m.cooldownMul *= c.mods.cooldownMul;
      m.areaMul *= c.mods.areaMul;
      m.lifeMul *= c.mods.lifeMul;
      m.chainFalloff *= c.mods.chainFalloff;
    }

    // 上限钳制:转向过快会产生抖动,冷却过低会让攻速失控
    m.homingTurn = Math.min(m.homingTurn, 9);      // ~515 度/秒
    m.cooldownMul = Math.max(m.cooldownMul, 0.35);
    return m;
  }

  /** 调试/测试用:直接给玩家装上法宝 */
  debugEquip(id: string): void {
    const cap = this.slotCap;
    this.slotCap = Math.max(cap, this.equipped.length + 1);
    this.equip(id);
    this.slotCap = cap;
  }
}