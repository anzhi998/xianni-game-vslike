# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

献祭 (Xianni) — a Vampire Survivors-style roguelike survival game (MVP). Phaser 3 + Vite + TypeScript, entirely client-side. UI text and code comments are in Chinese; match that when adding user-facing strings or comments.

Theme: a cultivation (修仙) reskin based on the novel 《仙逆》. Spells (法术) are the attacks, artifacts (法宝) rewrite firing behavior, and XP is cultivation (修为) spent on breaking through realms (境界).

## Commands

```bash
npm run dev        # dev server on http://localhost:5173 (open=false, browser not auto-launched)
npm run typecheck  # tsc --noEmit — the only real correctness gate
npm run build      # typecheck + vite build to dist/
npm run preview    # serve the production build
```

There is no test suite, linter, or formatter configured. `tsconfig.json` is strict with `noUnusedLocals`/`noUnusedParameters`, so unused variables/imports fail the build.

## Architecture

Scene flow (each scene registered in the `scene` array in `src/config/GameConfig.ts`):

`BootScene` → `PreloadScene` → `MainMenuScene` → `GameScene` (launches `UIScene` in parallel; `UpgradeScene` on level-up; `GameOverScene` on death)

`GameScene` is the orchestrator and owns all cross-system wiring. Systems are plain classes constructed with explicit dependencies — they never reach for globals.

Key conventions:

- **Pooling is Phaser Groups with a finite `maxSize` and explicit `classType`.** This is not optional. Phaser's `Group` defaults to `maxSize: -1`, and `isFull()` returns `false` unconditionally in that case — so an exhausted pool's `get()` does *not* return null, it constructs a bare `Sprite` with a null texture. The subsequent `setup()` throws a `TypeError` and the object leaks permanently. With a finite `maxSize`, `get()` correctly returns null and the existing `if (!e) return;` guards work. Pool sizes and prewarm counts live together in `GameScene.setupPools()`.
- **Pooling return is inconsistent by entity type.** `Projectile.kill()` and `Pickup.kill()` deactivate themselves; enemies are only deactivated in the death tween's `onComplete`. New pooled entities should follow the `kill()` + `isDead` flag pattern (`isDead` guards both overlap callbacks and enemy-iteration loops).
- **Reuse requires total state reset.** Every pooled entity's `setup()` resets all mutable fields. Missing resets show up as a projectile keeping a stale `hitSet`, or an elite's `scale`/`alpha` bleeding onto the next normal enemy.
- **Physics bodies must be toggled explicitly.** `setActive(false)` does not disable an Arcade body. Every `kill()` must set `body.enable = false` + zero velocity, and every `setup()` must set `body.enable = true` — otherwise a recycled pickup silently never gets collected.
- **Never tween a pooled object.** `pauseGame()` calls `tweens.pauseAll()`, and a tween still in flight when the object is recycled will fire on whoever owns it next. Use a numeric field decayed in `preUpdate()` instead (see `Projectile.chainGlowMs`).
- **Guard all `preUpdate()` methods with `this.scene.physics.world.isPaused`.** `preUpdate` is driven by the scene UPDATE event, not physics, so pausing physics does *not* stop it — without the guard, HP regen ticks during the upgrade panel and in-flight projectiles expire.
- **The UI is pull-based, not event-driven.** `UIScene` receives no event payloads; events are only refresh signals. Real data comes from `this.scene.get('GameScene') as any` reading public fields. So a new system just needs public fields on GameScene plus an event for HUD refresh. `UIScene.update()` refreshes the HUD every frame (the timer otherwise freezes between events).
- **`GameScene.create()`'s last line is `scene.launch('UIScene')`.** UIScene's `create()` runs after GameScene constructs its systems, so **every new system must be built in `setupSystems()`, never below that line**, or the HUD reads `undefined`.

### Cultivation systems

- **Realm state is split, not merged into `XPSystem`.** `XPSystem` owns only `xp`/`level`/`xpToNext` and knows nothing about realms; it receives a `canLevelUp: () => boolean` predicate from `RealmSystem`. This keeps the gate out of XPSystem's internals while `GameOverScene`/HUD keep reading the same XP fields.
- **Minor realms** advance the XP bar freely. **Major realms** additionally require a key item (丹药) — `RealmSystem.canAdvanceLevel()` blocks the level-up, XP stays at/above `xpToNext`, and `getProgress()` returns > 1 so the HUD can render a full bar with a "需要 X 丹" prompt. Key items drop from elites.
- **`XPSystem.add()` breaks out of its loop after one level.** `onLevelUp` pauses and launches `UpgradeScene`; a second `launch()` on a running scene is a no-op, so continuing the loop would silently swallow surplus levels. `GameScene.processPendingLevelUps()` drains the remainder after the card is chosen.
- **The upgrade card pool is built by `GameScene`, not by a config file** (`buildUpgradeCards` / `buildDynamicCards`). Only GameScene holds all systems and knows whether a spell slot is free. `UpgradeScene` stays a dumb renderer over `data.cards`.
- **`Upgrade.apply` takes an `UpgradeContext`, not a `Player`.** The old `(player) => void` signature cannot express "level up spell X" or "add a spell slot". `src/config/UpgradeConfig.ts` is a deprecated re-export shim of `CultivationUpgradeConfig.ts`.
- **Slot cap conflict is resolved explicitly**: base slots from the realm, plus a card bonus hard-capped at `realm + 2`. If the slot card proves weak in playtest, delete it — the two gates collapse into one and nothing else breaks.

### Artifacts

`ArtifactSystem` owns equipped artifacts and merges their modifiers into a cached `FireModifiers` object. `NEUTRAL_MODS` is the identity — with no artifacts equipped, `WeaponSystem.fire()` is behaviorally identical to before the system existed.

- **Modifiers are deliberately isomorphic to Player's stat fields**, so `fire()` composes `weapon base × Player × artifact` once and does zero per-artifact branching in the loop. Counts add, multipliers multiply, angular/positional knobs take max then clamp.
- **Artifacts do not occupy spell slots**, and re-picking an owned one raises its tier rather than opening a swap UI. That single choice is why v1 needs no inventory/discard screen.
- **Chain lightning redirects the projectile in place**, it does not fork a new one — forking would require injecting the projectile pool into the projectile, multiply concurrent projectiles against the pool's sizing, and make `hitSet` bookkeeping two-sided.
- **Chain + homing compose for free**: the redirect sets `nextRetargetAt = 0`, so equipping both 引魂铃 and 万血幡 makes each chain hop home to its new target with no special-casing.
- **Trait modifiers split into two classes:** ballistic (`spreadRad`/`homingTurn`/`chainCount`) apply **only to the `projectile` form** — those three all rewrite a trajectory, and slams/arcs/orbiters/zones have no trajectory. Numeric modifiers (`damageMul`/`areaMul`/`cooldownMul`/`lifeMul`) flow through `WeaponSystem.compose()` and apply to every form. A user equipping the spread artifact with a slam spell gets no benefit; that is intended.
- **Orbiting *artifacts* remain out of scope**, but orbiting is now available as a spell *form* (`Orbiter`). The distinction matters: artifacts rewrite how an equipped spell fires, while orbiting is a way of casting — different concerns.

### Attack forms

`WeaponConfig.form` selects one of seven forms, each with its own entity class in `src/entities/attacks/`:

| form | entity | hit resolution |
|---|---|---|
| `projectile` | `Projectile` (physics sprite) | Arcade overlap |
| `slam` | `Slam` (container) | one circular query on impact |
| `arc` | `ArcSlash` (container) | one sector query mid-sweep |
| `orbiter` | `Orbiter` (image) | proximity + cooldown throttle |
| `zone` | `Zone` (container) | periodic circular queries |
| `attractor` | `Attractor` (container) | none — zero damage, pulls enemies in |
| `scan` | `ScanField` (container) | none — zero damage, freezes (writes `enemy.frozenUntil` so it stops *actions*, not just movement) |

- **Every damaging form deals damage through `GameScene.applyDamageToEnemy`.** It is the single place that calls `enemy.takeDamage`, spawns the damage number, and triggers `onEnemyKilled`. Never call `enemy.takeDamage` directly from a new form. The two control forms are the exception by design: their `bind()` takes only the enemy group, so "this form is outside the damage chain" holds in the type signature.
- **Non-projectile forms are non-physics.** They're pure `GameObject`s driven by their own `preUpdate`, which works because `scene.add.existing()` adds any object defining `preUpdate` to the scene's update list (`GameObjectFactory.js:140`). Their pools use `runChildUpdate: false` — the `Group` calling `update()` would be pure overhead since these classes deliberately have no `update()`.
- **Their pool sizes equal their prewarm counts** so `Group.get()` can never construct an un-`bind()`ed instance. If you raise `maxSize`, raise the prewarm loop in the same edit, or a fired slam will crash on undefined `enemyGroup`.
- **`Orbiter` reads the player position through a `getPivot()` callback injected at `bind()` time**, not a captured coordinate. Capturing `player.x/y` in `setup()` looks correct and silently strands every orb behind a moving player — the whole point of the form is that it travels with you. `GameScene` supplies `() => ({ x: this.player.x, y: this.player.y })`.
- **Names that collide with Phaser base classes got renamed, not fought.** `originX`/`originY` → `pivotX`/`pivotY` (on `Container`/`Image`), `angle` → `orbitAngle` (on `Image`), `body` → `seal` (on `Container`, which reserves `body` for physics).

### Container-based clickable cards (a bug we shipped once)

Menu cards in `UpgradeScene` / `ReplaceSpellScene` are `Container`s holding a background rectangle plus text. Two ways to end up with a card that renders but cannot be clicked:

1. **Creating the background with `.setInteractive()` but never adding it to the container.** The rectangle stays on the scene's display list at world (0,0) — the *hit area strands in the corner* while the card shows nothing clickable. `UpgradeScene.createUpgradeCard` does `card.add([bg, ...])` correctly; `ReplaceSpellScene` originally omitted `bg` and the whole panel was dead. Whenever you build a card, verify the interactive object is in the `add([...])` list.
2. **Calling `container.setInteractive()` without `setSize()` + an explicit hit area.** A `Container` is 0×0, so the default hit area is a zero-area rect and nothing is clickable. Use `card.setSize(w, h)` then `card.setInteractive(new Phaser.Geom.Rectangle(-w/2, -h/2, w, h), Phaser.Geom.Rectangle.Contains)` — see `ReplaceSpellScene.makeCardInteractive`.

Also note: a card that exists but is *rarely offered* is indistinguishable from a broken feature. `buildUpgradeCards()` force-includes the spell-replacement card whenever slots are full, because leaving it to a 1-in-4 random roll made the only route to swapping spells effectively invisible.

### Monsters (enemy-side design)

The enemy side is specified by `docs/仙逆幸存者_怪物设计.html`, and its spine is that **each monster's approach geometry must differ from the others** — weapons have coverage shapes, enemies have approach shapes, and the gap between them is where positioning becomes a decision. All of it lives in `EnemyConfig.approach` (9 values) and is executed by `src/systems/EnemyAiSystem.ts`.

- **`EnemyAiSystem` owns every enemy's velocity**, called from `GameScene.update()` where `updateEnemies()` used to be. Frame order is `UpdateList` (all `preUpdate`s, inside UPDATE) → `World.update` (integration + overlaps) → `GameScene.update()`. So control entities (`Attractor`, `ScanField`) write velocity in their `preUpdate` and are integrated the *same* frame, while the AI writes the next frame's velocity — the two never fight. Do not move steering into `Enemy.preUpdate`: which one wins would then depend on update-list insertion order.
- **The spawn table is keyed by major realm** (`SEGMENT_WAVES[realmIndex]`), not by elapsed time — each segment introduces one previously-unseen approach geometry. Density/damage still ramp with time via `getDifficultyMultiplier`. Keying off the realm is also what makes 压级流 (stage 3's 极境) coherent: freeze the realm and the enemy side freezes with it. Do **not** add a time-based floor on the realm index.
- **Stealth (穿墙潜行) is a spawn rule, not a collision rule**: enemies have no terrain collision at all (obstacles only collide with the player), so the geometry only reads if the monster appears *inside* the screen (300–700px) at a random angle, semi-transparent. See `SpawnSystem.spawnOne`.
- **Resistances are merged, not overwritten**: `Enemy.setup` ORs `cfg.resist` (innate, e.g. a tank's 牵引抗性) with the elite roll. `rollEliteResists(base)` fills *up to* two total, so the doc's hard rule (never all three) holds even for a tank that already carries one.
- **`kill()` is the silent return path** (despawn at 1600px): no drops, no death tween, no damage number — the `Projectile`/`Pickup` pattern. `GameScene.killEnemy()` is the other one: full death funnel (drops, splits, kill count) but no damage number, used by 自爆.
- **HP × player realm** (`REALM_HP_SCALE`, 凝气 ×1 → 问鼎 ×4) is applied in `Enemy.setup`, the one place that sees realm index + difficulty + elite multipliers together.
- All behavior params (`attackRange`, `explodeRadius`, `splitInto`, `charge`, `pullAccel`, …) are optional fields on `EnemyConfig`; only the matching approach reads them. Adding a monster = one row in `ENEMIES` — `AssetGenerator.generateEnemies` draws `enemy_${id}`/`elite_${id}` from `archetype` × the config's palette.
- Eight "mechanism monsters" (追命者/血海上涌/伪仙/幻饵/遮天/噬灵虫/寄魂/引路尸) and 伪宝匣 are implemented on top of this (see below). 秘境守 and 天运子 are **not**: the first needs 五行秘境, the second needs 阶段 4's two endgame solutions — they are missing dependencies, not missing code.

### Mechanism monsters (八只机制怪 + 伪宝匣)

Prototype monsters provide daily pressure; mechanism monsters provide the **exception** — each one invalidates a rule the player has been relying on. They are event spawns, not part of the wave table.

- **`MechanismSystem`** owns only the schedule (first at 70s, interval 85s→45s) and the roll (weighted, unlocked by realm, never the same one twice in a row). It dispatches through three injected callbacks because the three forms live in different places: `enemy` → `SpawnSystem.spawnChild`, `bait`/`mimic` → a `Pickup` on the ground, `tide` → a screen-level `BloodTide`. A screen hazard is not a monster and should not be forced into one.
- **Capabilities live in `EnemyConfig.mechanism`**, not in the AI: 追命者's `speedPerHit` is applied inside `Enemy.takeDamage` (that method is the only place that knows "damage happened" — a new attack form must not have to remember to notify it), 伪仙's `deathBlast` fires from `onEnemyKilled`, 遮天's `vignette` is read out of `EnemyAiSystem.veilActive` each frame so `GameScene` never has to scan the pool just to ask one question.
- **Field effects run in a second pass** (`EnemyAiSystem.applyDrag`). The shepherd's drag *adds* to neighbours' velocity, so it must land after every `chase()` — interleaved in the first pass, a neighbour that happens to sort later would have its drag overwritten, producing an "sometimes it works" bug that is miserable to find.
- **Additive pulls are velocity offsets (px/s), never `accel × dt`.** Enemy velocity is rewritten in full every frame, so an acceleration only ever acts for one frame (`accel × dt²` ≈ 0.1px) — that is why 引力术 used to be a no-op. `Attractor.pull`, `pullSpeed` (界外之魂) and the drag all add a velocity, and `ScanField` multiplies by `1 - freeze` (multiplicative, so it works either way).
- 幻饵 (`bait`) and 伪宝匣 (`mimic`) are `Pickup` kinds that look identical to the real drop — that is their entire weapon, so they share the real textures. They trigger through the normal magnet+overlap path: you pull them in yourself.

### Debug panel (调试面板)

All developer tools live in the **pause menu** (`UIScene.addDebugPanel`), not on hotkeys. Keys fire at any time — including a mis-tap or an IME switch — and a run ruined by a stray F3 is worse than having no debug tool at all. The panel sits behind `DEBUG_PANEL_ENABLED` (`src/config/DebugConfig.ts`); the actions themselves are public `GameScene.debug*()` methods that return a one-line report, which the panel shows as a banner.

**Every new spell and every new monster must be reachable from this panel.** The rule, concretely:

- **Adding content is normally one config row, and that is enough** — the panel derives its lists from the tables, never from hand-written id arrays: `下一门法术` / `装满法术` iterate `Object.keys(WEAPONS)`, `刷全部怪` iterates `Object.keys(ENEMIES)`, `下一个机制怪` filters `ENEMIES[*].mechanism`. Do not enumerate ids in the panel; if you find yourself needing to, the config is missing a field, not the panel a branch.
- **If a new thing is NOT one config row away, it needs its own button.** A new pickup kind, a new world event, a new gating condition (e.g. an evolution, a realm gate) — anything you cannot reach by clicking the existing buttons gets an explicit action. *Content you cannot debug is content you cannot verify*, and unverified content is indistinguishable from broken content.
- **Reachability is checked at boot.** `validateEnemyReachability()` (segment table / mechanism roll / `splitInto` / mimic target) and `validateSpellReachability()` (slot table / 问鼎 candidates / `EVOLUTIONS`) run in `GameScene.checkContentTables()` and `console.warn` about anything that could never spawn or be obtained. Adding a row to `ENEMIES` or `WEAPONS` without a way to reach it therefore fails loudly on the first run.
- New debug actions must refresh the HUD through `refreshHudAfterDebug()` — the UI is pull-based and only re-reads the systems on events.

### Elites and drops

- **Elites are randomly mutated normal enemies** (同阶修士), rolled by *time interval* (`ELITE_PERIOD_START` → `ELITE_PERIOD_END`), not fixed probability. A fixed chance fights the `SEGMENT_WAVES` spawn-interval curve, which compresses from 1.0s to 0.24s, and would make elites *denser* exactly when the screen is busiest.
- **An elite is ×30 HP, drops a 秘境宝匣 unconditionally, and never despawns** — instead `EnemyAiSystem` teleports it back to a 600px ring when it gets further than 1200px (so "run away from it" is not a strategy), and `MAX_LIVE_ELITES` caps how many can coexist (×30 HP + immortal-until-killed would otherwise pile into a wall). Pre-10:00 the guaranteed chest is converted to a key item rather than silently dropped.
- **Three pickup kinds share one pool** (`Pickup` with a `kind` discriminant: `xp | artifact | keyItem`). A second pool would mean a second overlap registration and a second magnet loop; the magnet already works.
- **Overflow conversion means drops are never wasted**: full artifact slots → converted to a key item; duplicate key item → 30% of a level's XP. This is what removes the need for a discard UI.
- `Pickup.lifeMs` despawn is mandatory — the old `XPGem` never expired, which is survivable without elites and fatal with them.

## Assets

There are **no binary assets.** `src/utils/AssetGenerator.ts` draws every sprite at runtime with `Phaser.Graphics` + `generateTexture()`, and `PreloadScene` calls `generateAllAssets(this)`. Keys are convention-based (`enemy_${type}`, `elite_${type}`, `xp_gem_${tier}`, `pickup_artifact`, `pickup_key`, `proj_knife|magic|fireball|nine_nether_fire|huangquan|third_eye|enemy_shot`); an `ENEMIES` key and an `enemy_<key>` texture must share a name. **A spell's `texture` and its `color` must tell the same story** — the projectile art is how a player reads which spell is coming at them, so a fire spell must not fire a purple orb (both 九幽火海 and 黄泉指 shipped that way once; `proj_knife` survives only as the `Projectile`/`Orbiter` fallback). Enemy art is parameterized the way `generateRealmProjectiles` is: `generateEnemies` walks the `ENEMIES` table and draws each id from its `archetype` shape × the config's palette, so a new monster needs one config row and zero art code. `public/assets/{tiles,items,audio,characters}/` is an empty placeholder for future real art.

## Rendering / camera

Fixed 1280×720 viewport with `Phaser.Scale.FIT` centered, over a 3200×3200 world. `pixelArt` + `antialias: false` + `roundPixels: true` are set globally. The ground is one `Graphics` object at `depth -100` drawn with a seeded LCG (`GameScene.createSeededRng`) so obstacles scatter deterministically. Camera follows the player with a deadzone, bounded to the world.

## Conventions

- Entity classes extend `Phaser.Physics.Arcade.Sprite` and call `scene.add.existing` / `scene.physics.add.existing` in their constructor.
- All tuning numbers live in `src/config/*.ts`. `RealmConfig.ts` and `XPSystem.computeXpToNext` are the highest-leverage knobs — if pacing feels wrong, change those first.
- `WeaponConfig` exists twice by design: the interface in `src/types/index.ts`, the `WEAPONS` record in `src/config/WeaponConfig.ts`.
- `vite.config.ts` sets `base: './'` and an `@` → `src` alias, but existing code uses relative imports; stay consistent with relative imports.
- Unused constructor params must be `_`-prefixed (`noUnusedParameters`).