/**
 * 遗物系统 —— 12 件遗物,6 个槽,每件 5 级
 *
 * 为什么合并结果要缓存:开火是每帧每门神通各调一次的路径,
 * 遍历 6 件遗物各跑一遍 mod(level) 在 60fps 下白烧几千次闭包调用。
 * 装备变更时置脏,下次读取时重算 —— 脏标志而不是每帧重算,是因为
 * Player 是一个 Sprite,约定上由 Upgrade.apply() 改它的标量字段,
 * 而 Player 自己没有「装备变更」的概念。
 *
 * 为什么分成 player / spell 两组而不是一个大对象:
 * 专属遗物只强化一门神通,通用遗物只动玩家属性。把它们混在一个对象里,
 * 就得在每处读取时判断「这是全局的还是那门神通的」—— 而这个判断
 * 在整局里只会变一次(学会那门神通时),不值得付在每帧上。
 */
import Phaser from 'phaser';
import type { Player } from '../entities/Player';
import { RELICS, RELIC_SLOTS, MAX_RELIC_LEVEL } from '../config/RelicConfig';
import { GameEvents, NEUTRAL_PLAYER_MODS, neutralSpellMods } from '../types';
import type { PlayerRelicMods, RelicInstance, SpellRelicMods } from '../types';

export class RelicSystem {
  private scene: Phaser.Scene;
  private equipped: RelicInstance[] = [];
  private playerModsCache: PlayerRelicMods | null = null;
  private spellCache = new Map<string, SpellRelicMods>();

  constructor(scene: Phaser.Scene, _player: Player) {
    this.scene = scene;
  }

  getEquipped(): RelicInstance[] {
    return this.equipped;
  }

  /** 遗物槽总数。设计书里它是固定的 6,不随境界变化 */
  getSlotCap(): number {
    return RELIC_SLOTS;
  }

  hasFreeSlot(): boolean {
    return this.equipped.length < RELIC_SLOTS;
  }

  has(id: string): boolean {
    return this.equipped.some((a) => a.id === id);
  }

  getLevel(id: string): number {
    return this.equipped.find((a) => a.id === id)?.level ?? 0;
  }

  /**
   * 拿到一件遗物。
   *
   * 重复拿到 = 升一级;槽满且不是同一件 = 返回 null,由调用方降级处理
   * (转成修为),这样掉落永不浪费,也就**不需要一个丢弃界面**。
   */
  equip(id: string): string | null {
    const cfg = RELICS[id];
    if (!cfg) return null;

    const found = this.equipped.find((a) => a.id === id);
    let level: number;
    if (found) {
      if (found.level >= MAX_RELIC_LEVEL) return null;
      found.level++;
      level = found.level;
    } else {
      if (!this.hasFreeSlot()) return null;
      this.equipped.push({ id, level: 1 });
      level = 1;
    }

    this.invalidate();
    this.scene.events.emit(GameEvents.RELIC_EQUIPPED, id, level);
    return id;
  }

  /** 悟道卡「遗物叠层」走这条路。满级返回 false —— 卡片据此隐藏 */
  upgrade(id: string): boolean {
    const inst = this.equipped.find((a) => a.id === id);
    if (!inst) return false;
    if (inst.level >= MAX_RELIC_LEVEL) return false;
    inst.level++;
    this.invalidate();
    this.scene.events.emit(GameEvents.RELIC_EQUIPPED, id, inst.level);
    return true;
  }

  canUpgrade(id: string): boolean {
    const inst = this.equipped.find((a) => a.id === id);
    return !!inst && inst.level < MAX_RELIC_LEVEL;
  }

  /**
   * 道法融合会**吞掉**专属遗物,腾出一个遗物槽。
   *
   * 这是进化最舒服的一下:两条「成本」同时兑现,玩家立刻多出一个位置去补通用遗物。
   * 返回是否真的吞掉了(没吞 = 这条链不需要吞,不该进这个函数)。
   */
  absorb(id: string): boolean {
    const i = this.equipped.findIndex((a) => a.id === id);
    if (i < 0) return false;
    this.equipped.splice(i, 1);
    this.invalidate();
    return true;
  }

  /** 调试用:无视槽位限制直接装上 */
  debugEquip(id: string): void {
    const found = this.equipped.find((a) => a.id === id);
    if (found) {
      found.level = Math.min(MAX_RELIC_LEVEL, found.level + 1);
    } else {
      this.equipped.push({ id, level: MAX_RELIC_LEVEL });
    }
    this.invalidate();
  }

  getPlayerMods(): PlayerRelicMods {
    if (!this.playerModsCache) this.playerModsCache = this.mergePlayerMods();
    return this.playerModsCache;
  }

  /** 某一门神通当前受到的遗物加成。未装备任何相关遗物时返回全中性 */
  getSpellMods(spellId: string): SpellRelicMods {
    let m = this.spellCache.get(spellId);
    if (!m) {
      m = this.mergeSpellMods(spellId);
      this.spellCache.set(spellId, m);
    }
    return m;
  }

  private invalidate(): void {
    this.playerModsCache = null;
    this.spellCache.clear();
  }

  /**
   * 合成规则(只此一处,写清楚以便后续扩展时统一遵守):
   *   - 计数相加(飞剑、穿透、感电层数、感电时长)
   *   - 倍率相乘(伤害、推距)
   *   - 减法取最小(护甲穿透)
   *
   * 攻速与冷却**共用同一个冷却乘区**:两者最终都作用在
   * 「神通冷却 × 冷却倍率 ÷ 攻速倍率」这一个数上。分开建模只会让
   * 「定身术 + 天逆珠」看起来是两个独立收益,实际却是同一个乘积。
   */
  private mergePlayerMods(): PlayerRelicMods {
    const m: PlayerRelicMods = { ...NEUTRAL_PLAYER_MODS };
    for (const inst of this.equipped) {
      const p = RELICS[inst.id]?.mod(inst.level).player;
      if (!p) continue;
      m.maxHealthMul *= p.maxHealthMul ?? 1;
      m.moveSpeedMul *= p.moveSpeedMul ?? 1;
      m.pickupMul *= p.pickupMul ?? 1;
      m.cooldownMul *= p.cooldownMul ?? 1;
      m.attackSpeedMul *= p.attackSpeedMul ?? 1;
      m.coinMul *= p.coinMul ?? 1;
      m.critChance += p.critChance ?? 0;
      m.freezeChance += p.freezeChance ?? 0;
      m.healthRegen += p.healthRegen ?? 0;
      if (p.lifestealOnHit) {
        m.lifestealOnHit = Math.max(m.lifestealOnHit, p.lifestealOnHit);
        m.lifestealCdMs = Math.max(m.lifestealCdMs, p.lifestealCdMs ?? 0);
      }
    }
    return m;
  }

  private mergeSpellMods(spellId: string): SpellRelicMods {
    const m = neutralSpellMods();
    for (const inst of this.equipped) {
      const cfg = RELICS[inst.id];
      // 专属遗物只对自己的神通生效 —— 散魔铠甲不该给火球术加成
      if (cfg?.exclusive && cfg.exclusive !== spellId) continue;
      const s = cfg?.mod(inst.level).spell;
      if (!s) continue;
      m.damageMul *= s.damageMul ?? 1;
      m.pushMul *= s.pushMul ?? 1;
      m.orbAdd += s.orbAdd ?? 0;
      m.pierceAdd += s.pierceAdd ?? 0;
      m.orbitSpeedMul *= s.orbitSpeedMul ?? 1;
      m.slowAdd += s.slowAdd ?? 0;
      m.shockCapAdd += s.shockCapAdd ?? 0;
      m.shockMsAdd += s.shockMsAdd ?? 0;
      m.armorPen = Math.max(m.armorPen, s.armorPen ?? 0);
    }
    // 飞剑数走「每 2 级 +1,向下取整」—— 0.4 把飞剑在屏幕上分不出来
    m.orbAdd = Math.floor(m.orbAdd);
    return m;
  }

  /**
   * 冷却与攻速的合并乘区。
   *
   * 单独抽出来是因为它同时被「开火」和「卡面文案」用到,两处必须同源,
   * 否则卡上写 −25% 而实际少放 20% 的冷却,玩家只会觉得系统在骗人。
   */
  getCooldownMul(): number {
    const m = this.getPlayerMods();
    return m.cooldownMul / m.attackSpeedMul;
  }
}