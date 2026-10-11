/**
 * 怪物贴图切帧
 *
 * ## 怪物不走动了,所以这里只剩一件事:把横排素材切开、只露出第 0 帧
 *
 * 曾经这里还建两帧行走循环 + 按速度缩放步频。现在动画整个去掉了,
 * 但**切帧必须留着** —— 真实素材 `enemy_<id>.png` 是**等宽横排的多帧图**。
 * 没切过帧的横排图会**整张铺出来**(一帧一只,并排几只),那副样子和
 * 「素材切错了」几乎一模一样,所以别顺手把这里一起删掉。
 *
 * ## 为什么切完之后还要显式选一次帧
 *
 * Phaser 3.19+ 的 `Texture.add()` 会把 `firstFrame` 从 `__BASE` 改成
 * **第一个被 add 的帧**,所以 `setTexture(key)` 不带 frame 参数时本来就会落到 `_f0`。
 * 也就是说 `showFirstFrame()` 在当前版本里是**幂等的保险**,不是唯一的保险。
 *
 * 留着它的理由:上面那条行为是 Phaser 内部的一个 fallback(源码注释写的是
 * 「别把整张图集糊到屏幕上」),不是切帧契约。我们真正依赖的契约是
 * 「一只怪只显示一格」,把它写成一次显式赋值,而不是靠一处 fallback 撑着。
 * 代价是每次生成一次 `has()` 查表。
 *
 * ⚠️ 反过来的坑:**`getFrameNames()` 默认隐藏 `__BASE`**。
 * 所以「切帧失败」在日志里看起来和「切帧成功」一模一样 ——
 * 区别只在屏幕上是不是并排。只看帧名清单是查不出来的,见 `PreloadScene` 的自检。
 *
 * ## 帧数由实际宽度反推
 *
 * 单帧宽度 = `enemyTextureSize(cfg)` 的 w(只与美术尺寸有关,与碰撞无关)。
 * 帧数 = 贴图实际宽度 / w。所以单帧图算出 1、不切;画了三帧就切三帧,都不用改这里。
 * 宽度差几个像素会静默算成 1 帧 —— **素材是逐步替换的,管线必须能接受半成品**,
 * 帧数对不上不报错,只是切不出来,这比「必须 2 帧否则报错」重要得多。
 *
 * ## 普通与精英各切各的
 *
 * 精英是**提亮 + 描金边**,不是普通帧换个色,所以 `elite_<id>` 必须单独出图。
 */

import type Phaser from 'phaser';
import { ENEMIES } from '../config/EnemyConfig';
import { enemyTextureSize } from './AssetGenerator';

/** 第 0 帧的帧名。切帧与选帧共用这一个约定,写死以免两边漂移 */
export function firstFrameName(key: string): string {
  return `${key}_f0`;
}

/**
 * 把等宽横排的贴图切成帧。
 *
 * 在 `PreloadScene.finishLoad()` 里调用 —— 必须在 `generateAllAssets` 之后,
 * 因为真实素材与程序化图都要在这一刻已经进了 `scene.textures`。
 * 幂等:`Texture.add` 对已存在的帧名直接返回,重复调用不会重复切。
 *
 * @returns 真的切出多帧的贴图数量(单帧图与首领不计入)
 */
export function ensureEnemyFrames(scene: Phaser.Scene): number {
  let sliced = 0;

  for (const id of Object.keys(ENEMIES)) {
    const { w, h } = enemyTextureSize(ENEMIES[id]);
    if (sliceFrames(scene, `enemy_${id}`, w, h)) sliced++;
    if (sliceFrames(scene, `elite_${id}`, w, h)) sliced++;
  }
  return sliced;
}

/**
 * 单个键切帧。
 *
 * @returns 是否真的切出了多帧(源宽 ≥ 2 × w 时)
 */
function sliceFrames(scene: Phaser.Scene, key: string, w: number, h: number): boolean {
  if (!scene.textures.exists(key)) return false;
  const tex = scene.textures.get(key);
  const source = tex.source[0];
  if (!source) return false;

  // 按**实际宽度**反推帧数,而不是相信某个配置常量 ——
  // 真实素材可能是单帧、三帧或者别的数,而我们没有理由拒绝它们
  const frames = Math.floor(source.width / w);
  if (frames < 2) return false;

  for (let i = 0; i < frames; i++) {
    const name = `${key}_f${i}`;
    if (!tex.has(name)) tex.add(name, 0, i * w, 0, w, h);
  }
  return true;
}

/**
 * 让一只怪显示第 0 帧。
 *
 * 每次 `setTexture()` 之后都要调 —— 池化铁律的一部分:一只怪被借出去给别人用,
 * 贴图换了、帧也就换了,不显式写回「第 0 帧」等于把上一只的状态带过来。
 *
 * 查帧是否存在要走 `scene.sys.textures`(全局纹理管理器),并且**必须先 `has()`** ——
 * 对不存在的帧名调用 `setFrame` 会打一条 `has no frame` 警告并让精灵停在原帧,
 * 于是单帧图(切不出 `_f0`)会每次生成都刷一条警告。
 */
export function showFirstFrame(enemy: Phaser.GameObjects.Sprite): void {
  const key = enemy.texture.key;
  const name = firstFrameName(key);
  if (enemy.scene.sys.textures.get(key).has(name)) enemy.setFrame(name);
}