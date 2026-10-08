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
- **Orbiting artifacts are explicitly out of scope** — `Projectile` is a fire-and-forget `bornAt`/`lifeMs` model and cannot host a persistent orbiter.

### Elites and drops

- **Elites are randomly mutated normal enemies**, rolled by *time interval* (`ELITE_PERIOD_START` → `ELITE_PERIOD_END`), not fixed probability. A fixed chance fights the `WaveConfig` spawn-interval curve, which compresses from 1.0s to 0.24s, and would make elites *denser* exactly when the screen is busiest.
- **Three pickup kinds share one pool** (`Pickup` with a `kind` discriminant: `xp | artifact | keyItem`). A second pool would mean a second overlap registration and a second magnet loop; the magnet already works.
- **Overflow conversion means drops are never wasted**: full artifact slots → converted to a key item; duplicate key item → 30% of a level's XP. This is what removes the need for a discard UI.
- `Pickup.lifeMs` despawn is mandatory — the old `XPGem` never expired, which is survivable without elites and fatal with them.

## Assets

There are **no binary assets.** `src/utils/AssetGenerator.ts` draws every sprite at runtime with `Phaser.Graphics` + `generateTexture()`, and `PreloadScene` calls `generateAllAssets(this)`. Keys are convention-based (`enemy_${type}`, `elite_${type}`, `xp_gem_${tier}`, `pickup_artifact`, `pickup_key`, `proj_knife|magic|axe`); an `ENEMIES` key and an `enemy_<key>` texture must share a name. Enemy art is drawn through a shared `drawEnemyShape(g, kind, elite)` so normal and elite variants stay in sync. `public/assets/{tiles,items,audio,characters}/` is an empty placeholder for future real art.

## Rendering / camera

Fixed 1280×720 viewport with `Phaser.Scale.FIT` centered, over a 3200×3200 world. `pixelArt` + `antialias: false` + `roundPixels: true` are set globally. The ground is one `Graphics` object at `depth -100` drawn with a seeded LCG (`GameScene.createSeededRng`) so obstacles scatter deterministically. Camera follows the player with a deadzone, bounded to the world.

## Conventions

- Entity classes extend `Phaser.Physics.Arcade.Sprite` and call `scene.add.existing` / `scene.physics.add.existing` in their constructor.
- All tuning numbers live in `src/config/*.ts`. `RealmConfig.ts` and `XPSystem.computeXpToNext` are the highest-leverage knobs — if pacing feels wrong, change those first.
- `WeaponConfig` exists twice by design: the interface in `src/types/index.ts`, the `WEAPONS` record in `src/config/WeaponConfig.ts`.
- `vite.config.ts` sets `base: './'` and an `@` → `src` alias, but existing code uses relative imports; stay consistent with relative imports.
- Unused constructor params must be `_`-prefixed (`noUnusedParameters`).