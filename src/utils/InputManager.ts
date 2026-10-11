/**
 * 输入管理 (键盘 + 触屏摇杆)
 *
 * 设计:
 * - 键盘输入:基于 window keydown/keyup 事件 + Set<string>,最可靠
 * - 摇杆输入:基于 pointer 事件,单独存储
 * - 合并:每帧 update() 中独立计算键盘/摇杆部分,相加并归一化
 * - 边界:窗口失焦/场景销毁时全部清零,避免按键卡住
 */
import Phaser from 'phaser';

export class InputManager {
  // 最终合并输出(供 GameScene 读取)
  public moveX = 0;
  public moveY = 0;
  public attackTriggered = false;
  public pauseTriggered = false;

  private scene: Phaser.Scene;

  // 键盘 - 当前按下的 code 集合
  private keysDown = new Set<string>();
  // 摇杆 - 当前摇杆值([-1, 1] 已归一化)
  private joystickX = 0;
  private joystickY = 0;
  private joystickActive = false;
  private joystickBase?: Phaser.GameObjects.Arc;
  private joystickThumb?: Phaser.GameObjects.Arc;
  private joystickBaseX = 0;
  private joystickBaseY = 0;
  private joystickPointerId: number | null = null;
  private readonly joystickRadius = 60;

  // Pause 键(JustDown 边沿触发)
  private pauseKey!: Phaser.Input.Keyboard.Key;

  // 资源清理句柄
  private keydownHandler?: (e: KeyboardEvent) => void;
  private keyupHandler?: (e: KeyboardEvent) => void;
  private blurHandler?: () => void;
  private boundOnPointerDown?: (p: Phaser.Input.Pointer) => void;
  private boundOnPointerMove?: (p: Phaser.Input.Pointer) => void;
  private boundOnPointerEnd?: (p: Phaser.Input.Pointer) => void;

  constructor(scene: Phaser.Scene) {
    this.scene = scene;
  }

  setup(): void {
    const kb = this.scene.input.keyboard;
    if (kb) {
      // 浏览器级捕获,防止方向键滚动页面 / 焦点漂移
      kb.addCapture('W,A,S,D,UP,DOWN,LEFT,RIGHT,P,SPACE');

      // 显式注册每个键(便于 JustDown)
      kb.addKey(Phaser.Input.Keyboard.KeyCodes.W);
      kb.addKey(Phaser.Input.Keyboard.KeyCodes.A);
      kb.addKey(Phaser.Input.Keyboard.KeyCodes.S);
      kb.addKey(Phaser.Input.Keyboard.KeyCodes.D);
      kb.addKey(Phaser.Input.Keyboard.KeyCodes.UP);
      kb.addKey(Phaser.Input.Keyboard.KeyCodes.DOWN);
      kb.addKey(Phaser.Input.Keyboard.KeyCodes.LEFT);
      kb.addKey(Phaser.Input.Keyboard.KeyCodes.RIGHT);
      this.pauseKey = kb.addKey(Phaser.Input.Keyboard.KeyCodes.P);

      // 用原生事件追踪按键(最可靠 - 不会被 Phaser 内部状态干扰)
      this.keydownHandler = (e: KeyboardEvent) => {
        // 忽略被修饰键组合(如 Ctrl+R 刷新页面)
        if (e.ctrlKey || e.metaKey || e.altKey) return;
        this.keysDown.add(e.code);
      };
      this.keyupHandler = (e: KeyboardEvent) => {
        this.keysDown.delete(e.code);
      };
      // 用 window 而非 document,确保一定收到
      window.addEventListener('keydown', this.keydownHandler);
      window.addEventListener('keyup', this.keyupHandler);

      // 窗口失焦时清空所有输入(alt-tab 后按键卡住的修复)
      this.blurHandler = () => this.clearAllInput();
      window.addEventListener('blur', this.blurHandler);
      // 可见性变化
      document.addEventListener('visibilitychange', this.blurHandler);

      // 场景销毁时清理
      this.scene.events.once(Phaser.Scenes.Events.SHUTDOWN, () => this.destroy());
    }
    this.setupMobileJoystick();
  }

  destroy(): void {
    if (this.keydownHandler) window.removeEventListener('keydown', this.keydownHandler);
    if (this.keyupHandler) window.removeEventListener('keyup', this.keyupHandler);
    if (this.blurHandler) {
      window.removeEventListener('blur', this.blurHandler);
      document.removeEventListener('visibilitychange', this.blurHandler);
    }
    if (this.boundOnPointerDown) this.scene.input.off('pointerdown', this.boundOnPointerDown);
    if (this.boundOnPointerMove) this.scene.input.off('pointermove', this.boundOnPointerMove);
    if (this.boundOnPointerEnd) {
      this.scene.input.off('pointerup', this.boundOnPointerEnd);
      this.scene.input.off('pointerupoutside', this.boundOnPointerEnd);
    }
    this.clearAllInput();
  }

  private clearAllInput(): void {
    this.keysDown.clear();
    this.joystickX = 0;
    this.joystickY = 0;
    this.joystickActive = false;
    this.moveX = 0;
    this.moveY = 0;
    if (this.joystickBase) { this.joystickBase.destroy(); this.joystickBase = undefined; }
    if (this.joystickThumb) { this.joystickThumb.destroy(); this.joystickThumb = undefined; }
  }

  update(): void {
    // 1) 独立计算键盘输入
    let kx = 0;
    let ky = 0;
    if (this.keysDown.has('KeyA') || this.keysDown.has('ArrowLeft')) kx -= 1;
    if (this.keysDown.has('KeyD') || this.keysDown.has('ArrowRight')) kx += 1;
    if (this.keysDown.has('KeyW') || this.keysDown.has('ArrowUp')) ky -= 1;
    if (this.keysDown.has('KeyS') || this.keysDown.has('ArrowDown')) ky += 1;

    // 2) 合并(键盘 + 摇杆,各自独立)
    let mx = kx + this.joystickX;
    let my = ky + this.joystickY;
    const len = Math.sqrt(mx * mx + my * my);
    if (len > 1) {
      mx /= len;
      my /= len;
    }
    this.moveX = mx;
    this.moveY = my;

    // Pause
    if (Phaser.Input.Keyboard.JustDown(this.pauseKey)) {
      this.pauseTriggered = true;
    }
  }

  consumePause(): boolean {
    const v = this.pauseTriggered;
    this.pauseTriggered = false;
    return v;
  }
  consumeAttack(): boolean {
    const v = this.attackTriggered;
    this.attackTriggered = false;
    return v;
  }

  private setupMobileJoystick(): void {
    if (!this.scene.sys.game.device.input.touch) return;
    const cam = this.scene.cameras.main;

    this.boundOnPointerDown = (pointer: Phaser.Input.Pointer) => {
      if (this.joystickActive) return;
      if (pointer.x > cam.width / 2) return;
      // 悟道 / 融合面板开着的时候物理是停的,但 Phaser 的输入并没有停 ——
      // 不挡这一下,玩家点卡片时屏幕上会凭空浮出一个摇杆(它画在 GameScene 的
      // 相机上,会透过面板的半透明黑底显出来),松手才消失。
      if (this.scene.physics.world.isPaused) return;
      this.joystickActive = true;
      this.joystickPointerId = pointer.id;
      this.joystickBaseX = pointer.x;
      this.joystickBaseY = pointer.y;

      this.joystickBase = this.scene.add.circle(this.joystickBaseX, this.joystickBaseY, this.joystickRadius, 0xffffff, 0.15)
        .setStrokeStyle(2, 0xffffff, 0.4)
        .setScrollFactor(0)
        .setDepth(1000);
      this.joystickThumb = this.scene.add.circle(this.joystickBaseX, this.joystickBaseY, 24, 0xffffff, 0.4)
        .setScrollFactor(0)
        .setDepth(1001);
    };

    this.boundOnPointerMove = (pointer: Phaser.Input.Pointer) => {
      if (!this.joystickActive || pointer.id !== this.joystickPointerId) return;
      const dx = pointer.x - this.joystickBaseX;
      const dy = pointer.y - this.joystickBaseY;
      const len = Math.sqrt(dx * dx + dy * dy);
      const maxLen = this.joystickRadius;
      let nx = dx;
      let ny = dy;
      if (len > maxLen) {
        nx = (dx / len) * maxLen;
        ny = (dy / len) * maxLen;
      }
      this.joystickThumb?.setPosition(this.joystickBaseX + nx, this.joystickBaseY + ny);
      this.joystickX = nx / maxLen;
      this.joystickY = ny / maxLen;
    };

    this.boundOnPointerEnd = (pointer: Phaser.Input.Pointer) => {
      if (pointer.id !== this.joystickPointerId) return;
      this.joystickActive = false;
      this.joystickPointerId = null;
      this.joystickBase?.destroy();
      this.joystickThumb?.destroy();
      this.joystickBase = undefined;
      this.joystickThumb = undefined;
      this.joystickX = 0;
      this.joystickY = 0;
    };

    this.scene.input.on('pointerdown', this.boundOnPointerDown);
    this.scene.input.on('pointermove', this.boundOnPointerMove);
    this.scene.input.on('pointerup', this.boundOnPointerEnd);
    this.scene.input.on('pointerupoutside', this.boundOnPointerEnd);
  }
}
