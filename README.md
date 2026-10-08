# 献祭 (Xianni) — A Vampire Survivors-like Roguelike

使用 **Phaser 3 + Vite + TypeScript** 开发的 Web 端吸血鬼幸存者风格 Roguelike 生存游戏 MVP。

## 玩法

- 操控角色在地图中**自动战斗**不断涌来的怪物群
- 移动 WASD/方向键，靠近自动拾取经验
- 升级时弹出**三选一**强化卡,选一个永久提升
- 坚持越久,敌潮越强。坚持到极限吧!

## 控制

| 操作 | 按键 |
|---|---|
| 移动 | `W A S D` / 方向键 / 触屏摇杆(左半屏) |
| 暂停 | `P` / `ESC` |
| 选择升级 | 鼠标点击 |

## 启动

```bash
# 安装依赖
npm install

# 启动开发服务器(默认端口 5173)
npm run dev

# 类型检查
npm run typecheck

# 生产构建
npm run build

# 本地预览生产构建
npm run preview
```

打开浏览器访问 http://localhost:5173/ 即可。

## 目录结构

```
xianni/
├── index.html                  # HTML 入口
├── package.json
├── tsconfig.json
├── vite.config.ts
├── public/                     # 静态资源目录(占位)
│   └── assets/                 # 真实素材放置位置
│       ├── characters/
│       ├── items/
│       ├── tiles/
│       └── audio/
└── src/
    ├── main.ts                 # 入口
    ├── config/                 # 数据驱动配置
    │   ├── GameConfig.ts       # Phaser.Game 配置 + 世界尺寸
    │   ├── WeaponConfig.ts     # 武器表(飞刀/魔法/回旋斧)
    │   ├── EnemyConfig.ts      # 敌人数表(蝙蝠/骷髅/幽灵)
    │   ├── WaveConfig.ts       # 敌潮时间表 + 难度曲线
    │   └── UpgradeConfig.ts    # 升级池
    ├── scenes/
    │   ├── BootScene.ts        # 启动画面
    │   ├── PreloadScene.ts     # 资源生成与加载
    │   ├── MainMenuScene.ts    # 主菜单
    │   ├── GameScene.ts        # 核心游戏循环
    │   ├── UIScene.ts          # HUD(HP/XP/时间/击杀)
    │   ├── UpgradeScene.ts     # 升级三选一面板
    │   └── GameOverScene.ts    # 死亡结算
    ├── entities/
    │   ├── Player.ts           # 玩家
    │   ├── Enemy.ts            # 敌人
    │   ├── Projectile.ts       # 投射物
    │   ├── XPGem.ts            # 经验宝石
    │   └── DamageText.ts       # 伤害飘字
    ├── systems/
    │   ├── WeaponSystem.ts     # 武器管理 + 自动攻击
    │   ├── SpawnSystem.ts      # 敌潮生成
    │   ├── XPSystem.ts         # 经验/升级
    │   └── ObjectPool.ts       # 对象池(性能)
    ├── utils/
    │   ├── AssetGenerator.ts   # 程序化资源生成(占位)
    │   ├── InputManager.ts     # 输入封装(键位 + 触屏摇杆)
    │   ├── MathUtils.ts        # 工具函数
    │   └── SaveManager.ts      # localStorage 存档
    └── types/
        └── index.ts            # 全局类型
```

## 美术资源

MVP 当前**完全使用程序化生成的精灵**(通过 `src/utils/AssetGenerator.ts` 用 Phaser.Graphics 绘制色块) — 启动即可玩,无需任何外部资源。

后续可放置真实素材到 `public/assets/`,然后在 `PreloadScene` 中改为 `this.load.image(...)` 加载即可。

## 核心循环

1. **生成** — SpawnSystem 按 `WaveConfig` 时间表在屏幕外生成敌人
2. **战斗** — 玩家移动,武器系统自动瞄准最近敌人发射投射物
3. **拾取** — XP 宝石被杀死后掉落,玩家靠近自动吸附
4. **升级** — XP 满时暂停,弹出三选一升级面板
5. **强化** — 升级被应用到玩家属性(伤害/速度/范围/生命等)
6. **死亡** — HP 归零 → GameOverScene 结算 → 重新开始

## 性能

- 全对象池:敌人/投射物/XP/飘字均复用
- 屏幕外 culling:Phaser 内置支持
- 严格类型检查:TypeScript strict + noUnusedLocals/Parameters

## 范围之外(MVP 不包含)

- 武器进化(Weapon Evolutions)
- 多角色/解锁系统
- 多关卡/Boss
- 成就/每日挑战
- 联机
- 真实美术资源(待替换)

## 许可

本项目为个人学习项目,代码可自由使用。
