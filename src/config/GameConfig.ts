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
import { ReplaceSpellScene } from '../scenes/ReplaceSpellScene';
import { GameOverScene } from '../scenes/GameOverScene';

export const GAME_WIDTH = 1280;
export const GAME_HEIGHT = 720;
export const WORLD_WIDTH = 3200;
export const WORLD_HEIGHT = 3200;

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
    ReplaceSpellScene,
    GameOverScene,
  ],
};
