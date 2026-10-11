# 真实美术素材放这里

**文件名 = 纹理键。** `enemy_beast.png` 加载后就是 `scene.textures` 里的 `enemy_beast`。
没有清单文件,也没有编号 —— 少一个映射表就少一处会走偏的地方。

放进 `src/` 而不是 `public/` 的原因:加载列表由 `import.meta.glob` 在构建时枚举,
所以**只有真正存在的文件才会被加载**。放 `public/` 的话每加一张图都必须在代码里
手写一行 `load.image`,少写一个字母就是一次 404,而 404 只在控制台留一行红字,
游戏照跑、贴图照空。

尺寸、命名、配色规则见 `docs/美术素材规格.md`。

## 现状

启动时只有程序化素材(`src/utils/AssetGenerator.ts` 用 `Graphics` 现场画)。
`AssetLoader` 启动时会打印一份「还差哪些」的清单,调试面板上也有同一行。
"""