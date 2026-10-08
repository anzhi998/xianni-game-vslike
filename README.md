# 献祭 (Xianni) — 修仙版吸血鬼幸存者

使用 **Phaser 3 + Vite + TypeScript** 开发的 Web 端 roguelike 生存游戏。
以小说《仙逆》为题材:**法术是攻击手段,法宝改写攻击规则,经验化作修为用于突破境界。**

> 详细数值与设计规则见 **[docs/法术与法宝.md](docs/法术与法宝.md)** —— 该文档是设计基准,
> 与代码冲突时以文档为准。

## 启动

```bash
npm install
npm run dev        # 开发服务器 http://localhost:5173
npm run typecheck  # 类型检查(本项目唯一的正确性保障)
npm run build      # 类型检查 + 生产构建
npm run preview    # 本地预览生产构建
```

本项目**没有测试框架和 lint**,`npm run typecheck` 是唯一的自动化关卡。
`tsconfig.json` 开启了 `strict` + `noUnusedLocals` + `noUnusedParameters`。

## 玩法

操控角色自动战斗,击杀妖物获取**灵液**,灵液转为**修为**推进境界。
修为满了会弹出**三选一**精进卡。突破大境界需要特定**丹药**——
丹药只能从精英妖物身上掉落,所以中后期会被「卡在门口等一件东西」牵着走。

### 核心循环

1. **索敌开火** — 已装备的法术自动瞄准最近敌人齐射
2. **拾取灵液** — 靠近自动吸附,化为修为
3. **精进** — 修为满时暂停,三选一(法术精进 / 参悟新术 / 开辟法位 / 属性强化)
4. **突破** — 小境界自动推进;大境界需要「修为满 + 持有丹药」双条件
5. **换法术** — 法位满时,参悟新术需舍弃一门旧法(可选择放弃参悟)
6. **陨落** — 气血归零 → 结算 → 重新开始

### 境界体系

六个大境界,越往后小境界越多:

| 境界 | 层数 | 命名 | 法位 | 法宝位 | 突破丹 |
|---|---|---|---|---|---|
| 炼气 | **10** | 一层 ~ 十层 | 2 | 1 | — |
| 筑基 | 4 | 初期 ~ 圆满 | 3 | 2 | 筑基丹 |
| 结丹 | 5 | 初期 ~ 圆满 | 4 | 3 | 结丹丹 |
| 元婴 | 5 | 初期 ~ 圆满 | 5 | 3 | 凝婴丹 |
| 化神 | 6 | 初期 ~ 圆满 | 6 | 3 | 化神丹 |
| 炼虚 | 6 | 初期 ~ 圆满 | 7 | 3 | 太虚丹 |

炼气期沿用原作的十层命名,占全程约 3.8 分钟,是停留最久的一段。

### 法术与法宝

- **法术**:18 门,每个大境界独立的 3 门池子。突破后新池优先,
  旧池学完才降级回退。法术**不随境界自动变强** —— 法宝才是跨境界通用的成长线。
- **法宝**:6 件,不改写伤害数值而**改写开火行为** —— 散射、追踪、连锁、穿透。
  不占法位,重复拾取升阶(最高 3 阶)。法宝槽满时掉落自动转化为突破丹,
  所以掉落永不浪费,也不需要丢弃界面。

完整数值见 [docs/法术与法宝.md](docs/法术与法宝.md)。

## 操作

| 操作 | 按键 |
|---|---|
| 移动 | `W A S D` / 方向键 / 触屏摇杆(左半屏) |
| 暂停 | `P` / `ESC` / 右下角按钮 |
| 选择精进 | 鼠标点击 |

## 项目结构

```
├── index.html
├── vite.config.ts
├── docs/法术与法宝.md      # 设计基准(数值/规则/已知缺口)
└── src/
    ├── main.ts
    ├── config/             # 全部数值都在这里,不要散落到逻辑里
    │   ├── GameConfig.ts           # Phaser.Game 配置 + 世界尺寸
    │   ├── WeaponConfig.ts         # 18 门法术表(按境界分池)
    │   ├── ArtifactConfig.ts       # 6 件法宝表
    │   ├── RealmConfig.ts          # 六境界体系
    │   ├── EnemyConfig.ts          # 敌人数表
    │   ├── WaveConfig.ts           # 敌潮时间表 + 难度曲线
    │   ├── EliteConfig.ts          # 精英掷出频率 + 掉落表
    │   └── CultivationUpgradeConfig.ts  # 精进卡池(静态部分)
    ├── scenes/
    │   ├── BootScene.ts / PreloadScene.ts / MainMenuScene.ts
    │   ├── GameScene.ts            # 编排中心:装配全部系统
    │   ├── UIScene.ts              # HUD(拉取式,直接读 GameScene)
    │   ├── UpgradeScene.ts         # 三选一精进面板
    │   ├── ReplaceSpellScene.ts    # 法位满时的法术替换面板
    │   └── GameOverScene.ts
    ├── entities/           # Player / Enemy / Projectile / Pickup / DamageText
    ├── systems/            # XPSystem / RealmSystem / WeaponSystem / ArtifactSystem / SpawnSystem
    └── utils/              # AssetGenerator / InputManager / Targeting / SaveManager / MathUtils
```

场景流转:`Boot → Preload → MainMenu → Game`(并行启动 `UIScene`;
升级时 `UpgradeScene`;法位满时 `ReplaceSpellScene`;死亡时 `GameOverScene`)。

## 美术

MVP **完全使用程序化生成的精灵** —— `src/utils/AssetGenerator.ts` 用
`Phaser.Graphics` 绘制后 `generateTexture()`,没有任何二进制素材依赖,启动即可玩。

后续可把真实素材放到 `public/assets/{tiles,items,audio,characters}/`,
再在 `AssetGenerator` 里改为加载对应纹理。

## 已知缺口

详见 [docs/法术与法宝.md](docs/法术与法宝.md) 第五节。当前主要有:

- 法宝顶阶因 `Math.round` 浪费一档效果
- 投射物池(140)在高阶法宝多法术叠加下可能偏紧
- 环绕护体类法宝未实现(现有投射物模型装不下持续存在的环绕体)
- 投射物射程普遍短于索敌半径,远程目标可能打空

## 范围之外

法宝进化、多角色解锁、多关卡/Boss、成就系统、联机、真实美术素材。

## 许可

个人学习项目,代码可自由使用。