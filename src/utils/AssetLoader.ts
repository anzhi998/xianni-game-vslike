/**
 * 真实美术素材的接线
 *
 * ## 为什么是「文件名 = 键名」而不是一份清单文件
 *
 * 一份 `{ 键: 路径 }` 的映射表会带来两个必然的漂移:配置文件加了新怪,清单忘了加;
 * 清单写了新图,配置文件还没加。两者都要靠人去同步。
 *
 * 所以这里让 `import.meta.glob` 在**构建时**枚举 `src/assets` 下所有层级的 png ——
 * 映射关系由文件名本身决定,不存在第二份需要维护的东西。
 * 副作用同样重要:**只有真正存在的文件才会进加载队列**。
 * 显式清单的写法是每加一张图补一行 `load.image`,少写一个字母就是一次 404,
 * 而 404 只在控制台留一行红字,游戏照跑、贴图照空 —— 这个失败模式没有任何报警。
 *
 * ## 拼错文件名会怎样
 *
 * `enemy_beat.png` 会被 glob 捡到,但键名对不上任何预期键,于是它只是一张没人引用的图。
 * 屏幕上不会报错,只会「那只怪怎么还是老样子」。
 * 这就是 `reportMissingAssets` 存在的理由:把预期键与实际加载到的键一减,
 * 差集就是「你以为做了但其实没生效」的全部素材。启动时打一次,调试面板上常驻一行。
 */

import { ENEMIES } from '../config/EnemyConfig';
import { SPELLS } from '../config/SpellConfig';
import { RELIC_IDS } from '../config/RelicConfig';

/**
 * 构建时枚举素材文件。**键是文件名(去扩展名)**,值是 Vite 生成的资源 URL。
 *
 * `eager: true` 让它在模块求值时就拿到全部 URL —— 这里不需要真的 import 图片二进制,
 * 只要路径,所以用 `?url` query 而不是默认的资源转换。
 */
const FILES = import.meta.glob('../assets/**/*.png', {
  query: '?url',
  import: 'default',
  eager: true,
}) as Record<string, string>;

/** 文件路径 → 纹理键。`../assets/characters/enemy_beast.png` → `enemy_beast` */
const KEY_BY_URL = new Map<string, string>();
for (const [path, url] of Object.entries(FILES)) {
  KEY_BY_URL.set(url, path.slice(path.lastIndexOf('/') + 1, -'.png'.length));
}

/**
 * 程序化生成器会画、但**游戏里没有任何代码引用**的键。
 *
 * 它们在这里只是为了在缺失报告里被排除掉 —— 否则每次启动都要为 10 张永远不会
 * 用到的图报「缺失」,几轮之后报告就没人看了(告警被习惯性忽略,比没有告警更糟)。
 * `AssetGenerator` 里的这些图可以顺手删掉,但删不删都不影响任何东西。
 *
 * ⚠️ 往这里加一个键之前先确认它真的没被引用:`expectedTextureKeys()` 末尾的
 * `filter((k) => !DEAD_KEYS.has(k))` 会让它**从缺失报告里消失**,于是
 * 「已接入 n/m」的分母也跟着变小 —— 看起来像是有进展,其实那张图没人画。
 */
export const DEAD_KEYS: ReadonlySet<string> = new Set([
  'tile_grass_0', 'tile_grass_1', 'tile_grass_2', 'tile_grass_3', 'tile_grass_4', 'tile_grass_5',
  'tree', 'rock', 'bush',
  'player_glow',
  'proj_knife', 'proj_magic',
  // 厚土术 / 五雷正法。`cone`(SandWave)和 `chain`(ChainBolt)两种形态是
  // Container + Graphics 现场画的,`SpellConfig.texture` 在这两行上没有消费者。
  // ⚠️ 它们曾经被当成正式素材表的一部分,于是「做了图 → 加载成功 → 算已接入
  // → 永远不被画出来」这条三重静默路径是通的。
  'proj_sand', 'proj_bolt',
  'coin', 'pickup_stone',
]);

/**
 * 全部「值得做真实素材」的纹理键。
 *
 * 怪物与遗物从配置表推导,与 `AssetGenerator` 取数据的方式保持一致 ——
 * 加一只怪自动进这张表,不用在这里补一行。
 * 投射物与掉落物是手写常量:它们不是配置驱动的(法术换了 id 但投射物可能复用同一张图),
 * 写死反而比推导更容易看出「这一张还没做」。
 */
export function expectedTextureKeys(): string[] {
  // 地面持续特效。`fx_fire_sea` = 焚天·火海的火海(Zone),
  // 画布边界必须等于灼烧半径,规则见 docs/美术素材规格.md 的「地面持续特效」
  const keys: string[] = ['fx_hit', 'fx_fire_sea'];
  // 首领招式特效(非弹体)。弹体走 `proj_boss_*`,这些是出手阵 / 落点环 /
  // 斩痕 / 场所 / 命数符 / 光柱 / 印记 / 碎屑 —— 规则见 AssetGenerator.bossFx
  keys.push(
    'fx_boss_cast', 'fx_ring_slam', 'fx_sigil_frame',
    'fx_sworddomain', 'fx_swordslash', 'fx_afterimage',
    'fx_fateseal', 'fx_fatepillar', 'fx_fatemark', 'fx_fateashes',
  );
  // 主角四视图。左边由 setFlipX 镜像,不单列 —— 三个键四个朝向。
  // `player` 是缺图兜底,排在最后
  keys.push('player_down', 'player_up', 'player_side', 'player');
  // 法术面板图标。遗物面板**复用** `pickup_relic_<id>`(地面掉落物),不另开键
  for (const id of Object.keys(SPELLS)) keys.push(`icon_spell_${id}`);

  // 怪物的普通态与精英态**必须成对**:精英是同一形状提亮描金,
  // 只给一张的话精英在屏幕上就是空白方块
  for (const id of Object.keys(ENEMIES)) {
    keys.push(`enemy_${id}`, `elite_${id}`);
  }

  keys.push(
    // 法术投射物。⚠️ proj_sand / proj_bolt 在 DEAD_KEYS 里,列在这里只为留个位置
    'proj_fireball', 'proj_nine_nether_fire', 'proj_jimie', 'proj_huamo',
    'proj_zhanluo', 'proj_sand', 'proj_bolt', 'proj_sword_array', 'proj_enemy_shot',
    // 弧带前缘的龙头。**不是死键**:Tornado.prepareHead 会读它(见 SpellConfig)
    'proj_longjuan', 'proj_hufeng',
    // 掉落物
    'xp_gem_0', 'xp_gem_1', 'xp_gem_2', 'xp_gem_3',
    'pickup_chest_wood', 'pickup_chest_jade', 'pickup_chest_gold',
    'pickup_heal', 'pickup_xp_pill',
    // 兜底键:`Pickup.pickTexture` 在具体贴图缺失时退到这两个。
    // 它们不是死代码,但只有「忘了做具体那张」时才会显形,所以排在最后
    'pickup_relic', 'pickup_chest',
  );

  for (const id of RELIC_IDS) keys.push(`pickup_relic_${id}`);

  return keys.filter((k) => !DEAD_KEYS.has(k));
}

/**
 * 把所有真实素材排进加载队列。
 *
 * 在 `PreloadScene.preload()` 里调用 —— 加载器在 `preload()` 返回后才开跑,
 * 所以这一句只是登记,不会阻塞。加载完成的每个键都会让
 * `AssetGenerator.makeTexture` 的 `textures.exists(key)` 守卫成立,
 * 于是同名键**自动不再被程序化生成**。
 */
export function loadRealAssets(scene: Phaser.Scene): void {
  for (const [url, key] of KEY_BY_URL) {
    scene.load.image(key, url);
  }
}

/** 已经加载到 scene.textures 里的真实素材键 */
export function loadedAssetKeys(scene: Phaser.Scene): string[] {
  const out: string[] = [];
  for (const key of KEY_BY_URL.values()) {
    if (scene.textures.exists(key)) out.push(key);
  }
  return out;
}

/**
 * 缺失报告 —— 「我以为做了但其实没生效」的那批素材。
 *
 * 在 `PreloadScene.finishLoad()` 里调用(此时加载已完成)。
 * 返回一行摘要给调试面板,并在控制台打出**已接入**与**仍缺**两份清单。
 *
 * ⚠️ 为什么两份都要打:「贴图没生效」有两种完全不同的原因,
 *    而它们在屏幕上是**一模一样**的 —— 看到的都是程序化那张图:
 *      1. 文件名/键名对不上,图根本没加载
 *      2. 图加载得好好的,但你看的那只怪**恰好不在已接入名单里**
 *    只打缺失清单的话,「我做了 6 只,缺 12 只」看起来像是前 6 只也失败了。
 *    打印已接入名单之后,一眼就能分清这两种情况。
 *
 * 缺失清单里同时包含两种东西,而它们需要不同的修法:
 *   - 文件名拼错了(`enemy_beat.png`):改文件名,或者它本来就该被删掉
 *   - 压根没做:那才是正常的「程序化素材还没被替换」
 * 第一种是这个函数真正要抓的东西,而它和第二种在报告里长得一模一样 ——
 * 所以报告是**分组**的:一次做完一批怪,报告就只剩几行,拼错的那一行很容易被看见。
 */
export function reportMissingAssets(scene: Phaser.Scene): string {
  const loaded = new Set(loadedAssetKeys(scene));
  const expected = expectedTextureKeys();
  const missing = expected.filter((k) => !loaded.has(k));
  const active = expected.filter((k) => loaded.has(k));

  const group = (keys: string[]): Record<string, string> => ({
    怪: keys.filter((k) => k.startsWith('enemy_')).join(', ') || '无',
    精英: keys.filter((k) => k.startsWith('elite_')).join(', ') || '无',
    遗物: keys.filter((k) => k.startsWith('pickup_relic_')).join(', ') || '无',
    其他: keys.filter(
      (k) => !k.startsWith('enemy_') && !k.startsWith('elite_') && !k.startsWith('pickup_relic_'),
    ).join(', ') || '无',
  });

  const m = group(missing);
  const a = group(active);
  const summary = `素材 ${active.length}/${expected.length}`;

  if (missing.length > 0) {
    // eslint-disable-next-line no-console
    console.warn(
      `[素材] 已接入 ${active.length}/${expected.length} 项,其余仍由程序化生成器代画。\n` +
      `\n  ✅ 已接入(屏幕上这些是真图)\n` +
      `    怪   : ${a.怪}\n` +
      `    精英 : ${a.精英}\n` +
      `    遗物 : ${a.遗物}\n` +
      `    其他 : ${a.其他}\n` +
      `\n  ⬜ 仍缺\n` +
      `    怪   : ${m.怪}\n` +
      `    精英 : ${m.精英}\n` +
      `    遗物 : ${m.遗物}\n` +
      `    其他 : ${m.其他}\n` +
      `\n  若「仍缺」里出现了你**已经放了文件**的项,说明文件名与纹理键对不上 —— ` +
      `文件名必须与 docs/美术素材规格.md 第 3 节的键名完全一致。`,
    );
  } else {
    // eslint-disable-next-line no-console
    console.info(`[素材] ${expected.length} 项全部已接入,没有任何程序化素材。`);
  }
  return summary;
}