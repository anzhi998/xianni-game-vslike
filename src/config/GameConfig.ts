/**
 * Phaser Game 主配置
 */
import Phaser from 'phaser';
import { BootScene } from '../scenes/BootScene';
import { PreloadScene } from '../scenes/PreloadScene';
import { MainMenuScene } from '../scenes/MainMenuScene';
import { GameScene } from '../scenes/GameScene';
import { UIScene } from '../scenes/UIScene';
import { UpgradeScene } from '../scenes/UpgradeScene';
import { GameOverScene } from '../scenes/GameOverScene';

export const GAME_WIDTH = 1280;
export const GAME_HEIGHT = 720;
export const WORLD_WIDTH = 3200;
export const WORLD_HEIGHT = 3200;

/**
 * 相机缩放。世界**没有**变大,是镜头拉近了 —— 精灵与法术的距离一个像素都没动,
 * 平衡因此完全不变,变的是「一屏能看到多少」。
 *
 * 1.35 时可视范围从 20×11.25 格缩到约 14.8×8.3 格(1 格 = 64px),
 * 人物从占屏高 3.3% 变成 4.4%(与吸血鬼幸存者同量级)。
 *
 * ⚠️ **改这个数之前先看 viewRadius()**:刷怪距离、索敌半径、精英牵引环、
 *    环境危害的落点全都是以可视范围为单位写的(见各自的注释)。
 *    只改镜头而不改那些,会让潜行怪刷在屏幕外、索敌锁到看不见的敌人。
 */
export const CAMERA_ZOOM = 1.35;

/**
 * 精灵整体放大(人物与怪物),**贴图与碰撞体一起放大**。
 *
 * ## 为什么是运行期 `setScale`,而不是去改 `EnemyConfig.size`
 *
 * `EnemyConfig.size` 看起来就是「体型旋钮」,但它只对**程序化**贴图有效:
 * `enemyTextureSize()` 从它推导贴图尺寸,而 `makeTexture` 开头有一句
 * `if (textures.exists(key)) return` —— 一旦 `src/assets/` 里有同名真实素材,
 * 程序化那张根本不生成,`size` 再大也只改到**碰撞圆**,贴图纹丝不动。
 * 那正是曾经在这个仓库里悄悄发生过的一次:改完 `size` 之后怪看着一点没变,
 * 判定圈却大了 20%,于是「明明没碰到却被撞飞」。
 *
 * 运行期缩放对两条路径同时成立:真实素材与程序化素材都走 `setScale`,
 * 而碰撞圆乘同一个倍数,所以「看起来多大」与「判定多大」永远同源。
 *
 * ## 与 `CAMERA_ZOOM` 的分工
 *
 * 镜头改「一屏看多少格」,这个改「一个身体占多少像素」。两者相乘,
 * 分开调是为了能单独回答「是太小」还是「是太挤」。
 *
 * ⚠️ 玩家的碰撞盒是**另一处字面量**(`Player.setBodySize`),改这里要记得改那里。
 */
export const SPRITE_ART_SCALE = 1.2;

/**
 * 一屏的**半对角线**(世界单位)。
 *
 * 这是「按屏幕调的常数」唯一的单位:凡是说「离玩家 X 像素」的玩法数值
 * ——刷怪距离、自动索敌半径、精英牵引环、危害落点 —— 都在这里换算,
 * 于是调整镜头时它们跟着一起缩放,不会各自漂移。
 *
 * 用对角线而不是半宽/半高:刷怪距离是个**半径**,而屏幕是个 16:9 的矩形,
 * 只有对角线才是「任意角度都在屏幕外」的那个半径。
 */
export function viewRadius(zoom: number = CAMERA_ZOOM): number {
  return Math.hypot(GAME_WIDTH, GAME_HEIGHT) / 2 / zoom;
}

export const gameConfig: Phaser.Types.Core.GameConfig = {
  type: Phaser.AUTO,
  parent: 'game',
  width: GAME_WIDTH,
  height: GAME_HEIGHT,
  backgroundColor: '#0d0d1a',
  pixelArt: true,
  scale: {
    mode: Phaser.Scale.FIT,
    autoCenter: Phaser.Scale.CENTER_BOTH,
  },
  physics: {
    default: 'arcade',
    arcade: {
      gravity: { x: 0, y: 0 },
      debug: false,
    },
  },
  fps: {
    target: 60,
    forceSetTimeOut: false,
  },
  render: {
    pixelArt: true,
    antialias: false,
    roundPixels: true,
  },
  scene: [
    BootScene,
    PreloadScene,
    MainMenuScene,
    GameScene,
    UIScene,
    UpgradeScene,
    GameOverScene,
  ],
};
