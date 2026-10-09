import Phaser from 'phaser';
import { GAME_WIDTH, GAME_HEIGHT } from '../config/GameConfig';
import { WEAPONS } from '../config/WeaponConfig';

/**
 * 法术替换面板
 *
 * 触发路径:法术槽已满时,「参悟新术」卡仍然出现;玩家选中后进入本场景,
 * 从已掌握的法术里挑一门让位给新法术。
 *
 * 提供「放弃」选项 —— 强制玩家牺牲一门法术是不可接受的,
 * 玩家有权看着新法术离开。
 */
export class ReplaceSpellScene extends Phaser.Scene {
  private newSpellId = '';
  private onReplace?: (dropId: string | null) => void;

  constructor() {
    super('ReplaceSpellScene');
  }

  init(data: any): void {
    this.newSpellId = data.newSpellId ?? '';
    this.onReplace = data.onReplace;
  }

  create(): void {
    const w = GAME_WIDTH;
    const h = GAME_HEIGHT;
    const incoming = WEAPONS[this.newSpellId];

    this.cameras.main.setBackgroundColor('rgba(0,0,0,0.82)');
    this.cameras.main.fadeIn(200, 0, 0, 0);

    this.add.text(w / 2, 70, '法位已满', {
      fontFamily: 'monospace',
      fontSize: '40px',
      color: '#ff8844',
      fontStyle: 'bold',
    }).setOrigin(0.5).setShadow(0, 3, '#000000', 6, false, true);

    this.add.text(w / 2, 120, `参悟 ${incoming?.name ?? '新术'} 需让出一处法位`, {
      fontFamily: 'monospace',
      fontSize: '20px',
      color: '#ffffff',
    }).setOrigin(0.5);

    const game = this.scene.get('GameScene') as any;
    const owned = (game?.weaponSystem?.getWeapons() ?? []) as any[];
    const ownedCount = owned.length;

    const cardW = 190;
    const cardH = 230;
    const gap = 18;
    // 弃牌也算一格,保证「放弃」始终可用
    const totalW = cardW * (ownedCount + 1) + gap * ownedCount;
    const startX = (w - totalW) / 2 + cardW / 2;
    const cy = h / 2 + 40;

    owned.forEach((inst, i) => {
      this.createSpellCard(startX + i * (cardW + gap), cy, cardW, cardH, inst.id, inst.level);
    });

    // 放弃选项
    const skipX = startX + ownedCount * (cardW + gap);
    this.createSkipCard(skipX, cy, cardW, cardH, incoming?.name ?? '新术');
  }

  /**
   * 把整张卡片做成可交互对象。
   *
   * 两个必须注意的点:
   *   1. 背景矩形**必须加进容器**。只 setInteractive 却不 add 的话,
   *      它会留在场景显示列表里、停在世界坐标 (0,0),而卡片上没有任何可点区域。
   *   2. 容器的 hitArea 要显式给定。Container 默认尺寸是 0×0,
   *      只 setInteractive() 会得到一个点不到的零面积区域。
   */
  private makeCardInteractive(
    card: Phaser.GameObjects.Container,
    bg: Phaser.GameObjects.Rectangle,
    w: number,
    h: number,
    baseColor: number,
    hoverColor: number,
    onClick: () => void,
  ): void {
    card.setSize(w, h);
    card.setInteractive(
      new Phaser.Geom.Rectangle(-w / 2, -h / 2, w, h),
      Phaser.Geom.Rectangle.Contains,
    );
    card.input!.cursor = 'pointer';

    card.on('pointerover', () => {
      bg.setFillStyle(hoverColor, 0.98);
      card.setScale(1.04);
    });
    card.on('pointerout', () => {
      bg.setFillStyle(baseColor, 0.95);
      card.setScale(1);
    });
    card.on('pointerdown', onClick);
  }

  /** 已掌握的法术 —— 标出当前等级与关键数值,让玩家有得比 */
  private createSpellCard(x: number, y: number, w: number, h: number, id: string, level: number): void {
    const cfg = WEAPONS[id];
    const card = this.add.container(x, y);
    const bg = this.add.rectangle(0, 0, w, h, 0x2a1a1a, 0.95)
      .setStrokeStyle(3, 0xaa5533);

    card.add([
      bg,
      this.add.text(0, -78, '舍弃', {
        fontFamily: 'monospace', fontSize: '13px', color: '#cc8855',
      }).setOrigin(0.5),
      this.add.rectangle(0, -40, 60, 60, cfg?.color ?? 0x888888)
        .setStrokeStyle(2, 0xffffff),
      this.add.text(0, 4, cfg?.name ?? id, {
        fontFamily: 'monospace', fontSize: '17px', color: '#ffffff', fontStyle: 'bold',
        align: 'center', wordWrap: { width: w - 24 },
      }).setOrigin(0.5),
      this.add.text(0, 58, `Lv${level}  伤害 ${cfg?.damage ?? 0}`, {
        fontFamily: 'monospace', fontSize: '13px', color: '#aaaaaa',
      }).setOrigin(0.5),
      this.add.text(0, 80, `穿透 ${cfg?.pierce ?? 0} · 存续 ${cfg?.duration ?? 0}ms`, {
        fontFamily: 'monospace', fontSize: '12px', color: '#888888',
      }).setOrigin(0.5),
    ]);

    this.makeCardInteractive(card, bg, w, h, 0x2a1a1a, 0x4a2a1a, () => this.confirm(id));
    this.animateIn(card);
  }

  /** 放弃替换 —— 玩家有权看着新法术离开 */
  private createSkipCard(x: number, y: number, w: number, h: number, newName: string): void {
    const card = this.add.container(x, y);
    const bg = this.add.rectangle(0, 0, w, h, 0x1a1a2a, 0.95)
      .setStrokeStyle(3, 0x556688);

    card.add([
      bg,
      this.add.text(0, -40, '放弃参悟', {
        fontFamily: 'monospace', fontSize: '18px', color: '#8899bb', fontStyle: 'bold',
      }).setOrigin(0.5),
      this.add.text(0, 20, `保留当前法位`, {
        fontFamily: 'monospace', fontSize: '13px', color: '#667788',
      }).setOrigin(0.5),
      this.add.text(0, 44, `${newName} 离去`, {
        fontFamily: 'monospace', fontSize: '12px', color: '#556677',
      }).setOrigin(0.5),
    ]);

    this.makeCardInteractive(card, bg, w, h, 0x1a1a2a, 0x2a3a5a, () => this.confirm(null));
    this.animateIn(card);
  }

  private animateIn(card: Phaser.GameObjects.Container): void {
    card.setScale(0.8);
    card.setAlpha(0);
    this.tweens.add({
      targets: card, scale: 1, alpha: 1, duration: 280, ease: 'Back.easeOut',
    });
  }

  /** @param dropId 要舍弃的法术 id;null = 放弃参悟 */
  private confirm(dropId: string | null): void {
    if (this.onReplace) this.onReplace(dropId);
  }
}