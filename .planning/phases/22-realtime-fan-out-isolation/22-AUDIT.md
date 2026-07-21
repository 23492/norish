# 22-AUDIT — every `emitByPolicy` call site

Measured against `main` = `b334fa5f` (tree clean), 2026-07-21.
Reproduce the count with:
`grep -rho "emitByPolicy(" packages/queue/src packages/trpc/src --include=*.ts | wc -l` → **54**

## Legend

- **Policy source** — where the `viewPolicy` argument comes from.
  `SW` = server-wide `getRecipePermissionPolicy()` (**the leak vector**).
  `OWN` = the recipe's own cookbook. There are currently **zero** `OWN` sites.
- **Target key** — the `ctx.householdKey` argument.
  `ACTOR` = the acting user's active cookbook (`household?.id ?? user.id`, `middleware.ts:38`)
  or the job's `householdKey`. `RECIPE` = the recipe's own household. Currently **zero** `RECIPE`.
- **Payload** — `DTO` = a full dashboard/full recipe object; `IDS` = identifiers/keys only.

## Correction to the ROADMAP

ROADMAP Phase 22 records "**34** of 54 resolve their policy from the server-wide
`getRecipePermissionPolicy()`". The full re-audit below shows it is **54 of 54** — every
single emit site. No site consults the recipe's own cookbook, and no site keys on the
recipe's own household. The `34` figure understated the blast radius; it is superseded by
this table.

## Queue — 38 sites

### `packages/queue/src/allergy-detection/worker.ts` — 11
Hoist: `const policy = await getRecipePermissionPolicy()` (L36); `ctx` from job data (ACTOR).

| line | event | payload | policy | target |
|---|---|---|---|---|
| 40 | `allergyDetectionStarted` | IDS | SW | ACTOR |
| 43 | `processingToast` | IDS | SW | ACTOR |
| 57 | `allergyDetectionCompleted` | IDS | SW | ACTOR |
| 58 | `processingToast` | IDS | SW | ACTOR |
| 76 | `allergyDetectionCompleted` | IDS | SW | ACTOR |
| 77 | `processingToast` | IDS | SW | ACTOR |
| 103 | `allergyDetectionCompleted` | IDS | SW | ACTOR |
| 104 | `processingToast` | IDS | SW | ACTOR |
| 125 | `updated` | **DTO** | SW | ACTOR |
| 129 | `allergyDetectionCompleted` | IDS | SW | ACTOR |
| 132 | `processingToast` | IDS | SW | ACTOR |

### `packages/queue/src/auto-tagging/worker.ts` — 9
Hoist: L36. Same shape as allergy-detection.

| line | event | payload | policy | target |
|---|---|---|---|---|
| 40 | `autoTaggingStarted` | IDS | SW | ACTOR |
| 43 | `processingToast` | IDS | SW | ACTOR |
| 57 | `autoTaggingCompleted` | IDS | SW | ACTOR |
| 58 | `processingToast` | IDS | SW | ACTOR |
| 84 | `autoTaggingCompleted` | IDS | SW | ACTOR |
| 85 | `processingToast` | IDS | SW | ACTOR |
| 106 | `updated` | **DTO** | SW | ACTOR |
| 110 | `autoTaggingCompleted` | IDS | SW | ACTOR |
| 113 | `processingToast` | IDS | SW | ACTOR |

### `packages/queue/src/auto-categorization/worker.ts` — 6
Hoist: L27.

| line | event | payload | policy | target |
|---|---|---|---|---|
| 30 | `autoCategorizationStarted` | IDS | SW | ACTOR |
| 40 | `autoCategorizationCompleted` | IDS | SW | ACTOR |
| 47 | `autoCategorizationCompleted` | IDS | SW | ACTOR |
| 68 | `autoCategorizationCompleted` | IDS | SW | ACTOR |
| 83 | `updated` | **DTO** | SW | ACTOR |
| 86 | `autoCategorizationCompleted` | IDS | SW | ACTOR |

### `packages/queue/src/recipe-import/worker.ts` — 4
Hoists: L59 (`viewPolicy`), L217 (failure path).

| line | event | payload | policy | target | note |
|---|---|---|---|---|---|
| 64 | `importStarted` | IDS | SW | ACTOR | fires before the row is guaranteed |
| 86 | `imported` | **DTO** | SW | ACTOR | existing-recipe short-circuit |
| 148 | `imported` | **DTO** | SW | ACTOR | the main import emit |
| 220 | `failed` | IDS | SW | ACTOR | recipe may not exist |

### `packages/queue/src/image-import/worker.ts` — 3
Hoists: L44, L149.

| line | event | payload | policy | target | note |
|---|---|---|---|---|---|
| 49 | `importStarted` | IDS | SW | ACTOR | pre-row |
| 114 | `imported` | **DTO** | SW | ACTOR | |
| 152 | `failed` | IDS | SW | ACTOR | |

### `packages/queue/src/paste-import/worker.ts` — 3
Hoists: L173, L297.

| line | event | payload | policy | target | note |
|---|---|---|---|---|---|
| 178 | `importStarted` | IDS | SW | ACTOR | pre-row |
| 248 | `imported` | **DTO** | SW | ACTOR | |
| 301 | `failed` | IDS | SW | ACTOR | |

### `packages/queue/src/nutrition-estimation/worker.ts` — 2
Hoists: L36, L109.

| line | event | payload | policy | target |
|---|---|---|---|---|
| 81 | `updated` | **DTO** | SW | ACTOR |
| 112 | `failed` | IDS | SW | ACTOR |

## tRPC — 16 sites

Every site passes `{ userId: ctx.user.id, householdKey: ctx.householdKey }` — the ACTOR's
active cookbook, never the recipe's.

### `packages/trpc/src/routers/recipes/recipes.ts` — 9

| line | event | payload | policy | target | note |
|---|---|---|---|---|---|
| 222 | `created` | **DTO** | SW | ACTOR | |
| 258 | `updated` | **DTO** | SW | ACTOR | |
| 303 | `updated` | **DTO** | SW | ACTOR | |
| 336 | `deleted` | IDS | SW | ACTOR | recipe already gone → resolver must fail closed |
| 471 | `converted` | **DTO** | SW | ACTOR | cached-conversion path |
| 527 | `converted` | **DTO** | SW | ACTOR | fresh-conversion path |
| 741 | `nutritionStarted` | IDS | SW | ACTOR | |
| 808 | `autoTaggingStarted` | IDS | SW | ACTOR | |
| 936 | `allergyDetectionStarted` | IDS | SW | ACTOR | |

### `packages/trpc/src/routers/ratings/ratings.ts` — 3

| line | event | payload | policy | target | note |
|---|---|---|---|---|---|
| 30 | `ratingFailed` | IDS | SW | ACTOR | actor-scoped by design |
| 57 | `ratingUpdated` | IDS | SW | ACTOR | `rate` — only `recipeId` in scope |
| 92 | `ratingUpdated` | IDS | SW | ACTOR | `removeRating` |

### `packages/trpc/src/routers/recipes/shares.ts` — 3

| line | event | payload | policy | target | note |
|---|---|---|---|---|---|
| 114 | share lifecycle (`recipeShareEventsByType[type]`) | share DTO | SW | ACTOR | |
| 359 | `updated` | **DTO** | SW | ACTOR | `setVisibility` |
| 423 | `created` | **DTO** | SW | ACTOR | **`saveShared`** — the recipe is NEW, in the SAVER's cookbook. Must resolve against the new id, not the source recipe. Subtlest site in the phase. |

### `packages/trpc/src/routers/recipes/helpers.ts` — 1

| line | event | payload | policy | target | note |
|---|---|---|---|---|---|
| 29 | `failed` | IDS | SW | ACTOR | `emitRecipeFailure` — actor-scoped by design |

## Totals

| group | sites |
|---|---|
| queue | 38 |
| trpc | 16 |
| **TOTAL** | **54** |

| classification | count |
|---|---|
| policy source = SW (server-wide) | **54 / 54** |
| target key = ACTOR (not the recipe's cookbook) | **54 / 54** |
| payload carries a full DTO | **14** |

## Reading

Two independent leak vectors, both present at all 54 sites:

1. **Broadcast.** `SW.view` is `"everyone"` in production → `emitByPolicy` takes
   `emitter.broadcast()` → published to `norish:<ns>:broadcast:<event>`, which every
   authenticated connection subscribes to (`packages/trpc/src/helpers.ts:204-206`).
   14 of those carry a full recipe DTO.
2. **Actor-keyed target.** Even with the broadcast branch closed, the household channel used
   is the *actor's* active cookbook. Wherever the actor's active cookbook differs from the
   recipe's own — `saveShared`, cross-cookbook ratings — the event lands on the wrong
   cookbook's channel.

Closing only (1) leaves (2). The fix must address both, which is why D-22-02 resolves the
target key from the recipe as well as the policy.
