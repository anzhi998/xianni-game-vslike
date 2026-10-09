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
import { ARTIFACTS, MAX_ARTIFACT_LEVEL, artifactTierPow, artifactTierScale } from '../config/ArtifactConfig';
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
      // 重复拾取 = 升一级。槽位满了也不会因为同名法宝而浪费。
      if (found.level >= MAX_ARTIFACT_LEVEL) return null;
      found.level++;
    } else {
      if (this.equipped.length >= this.slotCap) return null;
      this.equipped.push({ id, level: 1 });
    }

    this.cached = null;
    // 带上等级:接收方要能区分「新获得」和「升级」,横幅文案才写得出来。
    // 光给 id 的话 UIScene 只能看到 id,分不清这两种情况。
    this.scene.events.emit(GameEvents.ARTIFACT_EQUIPPED, id, found ? found.level : 1);
    return id;
  }

  /**
   * 提升一件已装备法宝的等级(设计书:法宝满 5 级,线性叠加)。
   *
   * 这是法宝的主要成长途径 —— 升级卡,而非重复拾取。
   * 重复拾取保留为兜底,见 ArtifactConfig 的说明。
   *
   * @returns 是否真的升了(未持有或已满级返回 false —— 卡片据此隐藏)
   */
  upgrade(id: string): boolean {
    const inst = this.equipped.find((a) => a.id === id);
    if (!inst) return false;
    if (inst.level >= MAX_ARTIFACT_LEVEL) return false;
    inst.level++;
    this.cached = null;
    this.scene.events.emit(GameEvents.ARTIFACT_EQUIPPED, id, inst.level);
    return true;
  }

  /** 该法宝是否还能升级 */
  canUpgrade(id: string): boolean {
    const inst = this.equipped.find((a) => a.id === id);
    return !!inst && inst.level < MAX_ARTIFACT_LEVEL;
  }

  getLevel(id: string): number {
    return this.equipped.find((a) => a.id === id)?.level ?? 0;
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
      const s = artifactTierScale(inst.level);

      m.projectileAdd += Math.round(c.mods.projectileAdd * s);
      m.pierceAdd += Math.round(c.mods.pierceAdd * s);
      m.chainCount += Math.round(c.mods.chainCount * s);

      m.spreadRad = Math.max(m.spreadRad, c.mods.spreadRad);
      m.chainRadius = Math.max(m.chainRadius, c.mods.chainRadius);

      m.homingTurn += c.mods.homingTurn * s;

      // 倍率同样吃阶数缩放。此前这五行是原样相乘,导致「重复拾取即升阶」
      // 对纯倍率型法宝(极阴/靠山诀/黄泉升窍)是空操作 —— 乘 1.3 几次都还是 1.3。
      // 用 pow 而非乘 (1+…):一阶时 pow(x,1) === x,行为与无缩放完全一致。
      m.projectileSpeedMul = artifactTierPow(m.projectileSpeedMul * c.mods.projectileSpeedMul, inst.level);
      m.damageMul = artifactTierPow(m.damageMul * c.mods.damageMul, inst.level);
      m.cooldownMul = artifactTierPow(m.cooldownMul * c.mods.cooldownMul, inst.level);
      m.areaMul = artifactTierPow(m.areaMul * c.mods.areaMul, inst.level);
      m.lifeMul = artifactTierPow(m.lifeMul * c.mods.lifeMul, inst.level);
      m.chainFalloff = artifactTierPow(m.chainFalloff * c.mods.chainFalloff, inst.level);
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