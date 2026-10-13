import Phaser from 'phaser';

/**
 * 三种飘字颜色。**护甲那一档不是装饰,是唯一能让玩家看懂「为什么打不动石傀」的信号。**
 *
 * 护甲没有写在任何 UI 上,也没有图标提示 —— 一只 0.35 护甲的怪和一只 0 护甲的怪
 * 在屏幕上长得一模一样,区别只在 DPS 上手感的差别。玩家只能猜,于是
 * 「堆穿透」和「堆伤害」这两条路线在体感上完全等价,破魔/破防两条设计等于作废。
 * 伤害数字的颜色是这条信息唯一不吵人的载体:不增加任何字符(护甲触发的频率很高 ——
 * 火海的持续伤害、沙波的分段都会重复命中,加后缀会糊成一片),只是换一个颜色。
 */
export const COLOR_NORMAL = '#ffffff';
export const COLOR_CRIT = '#ffd166';
/** 被护甲减伤:冷调且比常态略暗,读作「这一下被削了」而不是「这一下更强」 */
export const COLOR_ARMORED = '#7fa8c9';
/**
 * 免伤(杀戮仙诀白罩 / 闪现无敌):与白罩同一族的冷白。
 *
 * 它出现的场景是「怎么打都不掉血」,所以文案是「免疫」而不是数字 ——
 * 详见 DamageTextOpts.text。
 */
export const COLOR_IMMUNE = '#dff2ff';

/**
 * 飘字的显示档位。
 *
 * 敌人受伤只传 `crit` / `armored`,颜色由本类决定 —— 判定「这一发有没有被护甲削过」
 * 的现场在 GameScene,而「削过就该长什么样」是显示规则,两者不该互相知道对方。
 * 玩家掉血 / 回血这类不是「对怪打出的伤害」的飘字,直接给 `color` 覆盖。
 */
export interface DamageTextOpts {
  /** 暴击:金色 + 放大 1.4 倍 */
  crit?: boolean;
  /**
   * 这一发被目标护甲削过(目标护甲 > 本次穿透)。
   *
   * **颜色上优先于暴击**:一次命中的暴击概率远高于「对高护甲目标出手」的概率,
   * 后者才是需要被看见的那个。但字号/缩放仍然按暴击算 ——
   * 「暴击打不动护甲怪」是个有意义的组合,丢掉尺寸就丢了它。
   */
  armored?: boolean;
  /** 直接指定颜色,盖掉上面两档 */
  color?: string;
  /**
   * 直接指定文案,盖掉数字。
   *
   * 只有「免疫」用它 —— 那一档要表达的恰恰是「没有数字」这件事,
   * 而把 0 画出来会被读成「这一发打了 0 伤害」,那是另一回事(打不穿护甲
   * 已经在蓝字里说过一次了)。
   */
  text?: string;
}

export class DamageText extends Phaser.GameObjects.Text {
  public isDead = false;
  public bornAt = 0;
  public lifeMs = 900;
  public vy = -40;
  /** 落定后的目标缩放。setup 先弹大、preUpdate 再收回 —— 见两处的注释 */
  private targetScale = 1;

  constructor(scene: Phaser.Scene) {
    super(scene, 0, 0, '0', {
      fontFamily: 'monospace',
      fontSize: '14px',
      color: '#ffffff',
      fontStyle: 'bold',
      stroke: '#000000',
      strokeThickness: 3,
    });
    this.setActive(false).setVisible(false);
    this.setDepth(150);
    this.setOrigin(0.5);
  }

  /**
   * 颜色优先级:`opts.color` > 护甲 > 暴击 > 常态。
   *
   * ⚠️ 池化对象必须在这里**重置全部可变字段**。曾经 `color` 是必传的位置参数,
   * 现在改成可选,所以「没传 color」的那条路径必须显式落到 COLOR_NORMAL,
   * 否则上一次借用同一个飘字的暴击金色会留在普通伤害上。
   */
  setup(x: number, y: number, value: number, opts: DamageTextOpts = {}): void {
    const crit = opts.crit ?? false;
    this.setPosition(x, y);
    this.setText(opts.text ?? String(value));
    this.setColor(opts.color ?? (opts.armored ? COLOR_ARMORED : crit ? COLOR_CRIT : COLOR_NORMAL));
    this.setFontSize(crit ? 20 : 14);
    this.setActive(true).setVisible(true);
    this.isDead = false;
    this.bornAt = this.scene.time.now;
    this.vy = -40 - (crit ? 20 : 0);
    this.setAlpha(1);
    // 暴击数字先弹大再收回落定档(1.4)。**不能**用 tweens 做这个弹跳 ——
    // 池化对象 kill 后 tween 还挂在上面,复用时会跟下一次 setup 打架;
    // 衰减自己写在 preUpdate 里,三行,且天然随对象一起停
    this.targetScale = crit ? 1.4 : 1;
    this.setScale(crit ? 1.9 : 1);
  }

  preUpdate(time: number, delta: number): void {
    if (!this.active) return;
    this.y += this.vy * (delta / 1000);
    this.vy += 30 * (delta / 1000);
    if (this.scale !== this.targetScale) {
      const next = this.scale + (this.targetScale - this.scale) * Math.min(1, delta / 1000 * 14);
      this.setScale(Math.abs(next - this.targetScale) < 0.01 ? this.targetScale : next);
    }
    const age = time - this.bornAt;
    if (age > this.lifeMs) {
      this.isDead = true;
      this.setActive(false).setVisible(false);
    } else if (age > this.lifeMs * 0.6) {
      this.setAlpha(1 - (age - this.lifeMs * 0.6) / (this.lifeMs * 0.4));
    }
  }

  kill(): void {
    this.isDead = true;
    this.setActive(false).setVisible(false);
  }
}
