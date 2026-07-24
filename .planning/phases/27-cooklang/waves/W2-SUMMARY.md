# Phase 27 — W2 (Write path + `0041`) — SUMMARY

> Status: **CODE-COMPLETE**, gates green. Server half only.
> Scope per `27-ARCHITECTURE.md` §7 (W2) + `27-CONTEXT.md` + plan `27-02-PLAN.md`.
> NO deploy, NO live stack, NO live DB, NO vault change. **`0041` was NOT applied to the
> live database** — it applies at container boot on a future deploy. `pnpm db:generate`
> was NOT run (forbidden, D-27-W2-08). `pnpm docker:build` NOT run (director's job).
> The renderer is untouched: no web or mobile component, page, hook or renderer changed.

**Commits:** `9f548b96` (task 1) → `5e915523` (task 2) → `0f74fb3a` (task 3) →
`3b0d42fc` (task 4) → `f4280a55` (task 5) → `a896dae1` (server-bundle fix).
Base `8d541fb4`.

**THE NEVER-BROKEN GUARANTEE HOLDS.** At the end of W2 there is still no producer of
per-step linkage (that is W3), so every recipe in the database has `cook_source IS NULL`,
every renderer runs the legacy path, and no user-visible behaviour changed. W2 ships the
machinery plus its migration, fully tested through its own entry points.

## What shipped

### 1. `0041_add_cook_source` — the EXPAND migration (task 1)

Hand-written SQL + a `_journal.json` entry (`idx: 41`), **no snapshot file** — the fork
stopped producing them at `0038` and `0039`/`0040` are hand-authored, so `drizzle-kit
generate` would diff against a stale snapshot (D-27-W2-08).

| Change | Kind |
|---|---|
| `recipes.cook_source text` | nullable — NOT NULL is `0043`/W6 |
| `recipes.cook_confidence numeric(4,3)` | nullable — W5's gate populates it |
| `recipes.cook_review_needed boolean NOT NULL DEFAULT false` | W5's review queue |
| `uq_recipe_ingredients_recipe_system_ingredient` on `(recipe_id, system_used, ingredient_id)` | the projection's NATURAL KEY |

**The FK-safe de-dup (D-27-W2-07, T-27-03).** The unique index cannot be created over
duplicates, and `groceries.recipe_ingredient_id` is `ON DELETE SET NULL` — so a naive
de-dup would silently null a household's "from recipe X" shopping-list link (the Phase 25
class of defect). Per group, in this order: pick the survivor (lowest `order` NULLS LAST,
tie-broken by lowest `id`) → **`UPDATE groceries` onto the survivor, BEFORE ANY DELETE** →
sum `amount` only when the merge is lossless (no NULL amount, and every unit equal or
every unit NULL), else keep the survivor verbatim and set `cook_review_needed = true` →
delete the losers → create the index.

The migration is no-op-safe on a database with zero duplicates and does not fail on a NULL
`order`. `ADD COLUMN IF NOT EXISTS` / `CREATE UNIQUE INDEX IF NOT EXISTS` make it
re-runnable.

`packages/db/src/migrations/checks/0041-precheck.sql` — READ ONLY, for the director to run
against a **restored copy of the live dump**: duplicate groups, lossy-merge groups, and
grocery rows that would be re-pointed.

### 2. `deriveProjectionTx` — the derived projection (task 2)

`packages/db/src/repositories/cook-projection.ts`, re-exported from the repositories barrel.
`(tx, { recipeId, systemUsed, cookTokens, units }) → DeriveProjectionReport`. Split into a
PURE part (`computeCookProjection`: tokens → the intended row set for both systems) and the
DB part, so row computation is unit-testable without a container.

- **UPSERT-stable on the natural key** — `ON CONFLICT (recipe_id, system_used,
  ingredient_id) DO UPDATE`, never delete-and-reinsert. This is the keystone: it is the only
  thing keeping `groceries.recipe_ingredient_id` alive across an edit.
- **Step rows matched POSITIONALLY and updated in place**, so `steps.id` — and therefore
  every `step_images.step_id` — survives a re-derive. Surplus trimmed from the tail.
- **Both systems' ingredient rows, native system's steps only** (D-27-W2-05): native
  verbatim, opposite via W0's `deriveConversion`; a converter can convert an amount, it
  cannot rewrite step prose.
- **Flag-and-preserve** — an unconvertible measure is written with the NATIVE amount/unit
  and reported; a density is never invented.
- **Duplicate refs** to one ingredient SUM when their units match, otherwise
  first-occurrence-wins + `mixed-units`, so the new index can never raise.
- **Sections** become `# Heading` step rows at the boundary — norish's in-band convention
  on both the serialize and the read side, so it round-trips.
- **No parser, no ctx.** It takes an already-parsed `CookTokensDTO`; `packages/db/package.json`
  gained **nothing** and `check-workspace-imports.mjs` exits 0 (D-27-W2-09). It takes no
  user id, no household id and no ctx; every statement carries `recipeId`.

### 3. Write path (task 3)

- **`buildCookPayload`** (`@norish/shared-server/cooklang/build-payload`) — the ONLY minter
  of a `.cook`. It serializes, then immediately parses its own output with the real WASM
  parser, and returns `null` if that round trip is not clean. That buys the invariant W4's
  renderer and W6's `0043` depend on: **a non-NULL `cook_source` always parses cleanly.** A
  `null` never costs the user their save — the caller passes no `cook`, the legacy
  projection write runs unchanged, and an **error**-level log carries step count, ingredient
  count and a reason but **never the recipe text** (T-27-05).
- **The optional `cook` argument** on `createRecipeWithRefs` / `updateRecipeWithRefs`, LAST
  and optional so every existing call site keeps compiling (D-27-W2-01). Supplied,
  `cook_source` is stored and `deriveProjectionTx` runs in the SAME transaction. Omitted —
  every call site that exists at the end of W2 — nothing changes.
- **`copyRecipeForSave`** passes the source's `.cook` through, so a saved copy carries it
  and gets a FRESHLY derived projection with brand-new row ids; projection rows are never
  copied raw across recipes.
- **D-27-W2-06** — `convertMeasurements`' short-circuit now requires target-system STEPS as
  well as ingredients, extracted as `hasTargetSystemProjection` so the invariant is named
  and directly testable.

### 4. Read path (task 4)

`getRecipeFull` selects `cook_source` and puts it on the DTO (`cookTokens` stays `null`
there — `@norish/db` must never parse). **`withCookTokens`**
(`@norish/shared-server/cooklang/attach-tokens`) is the read-side parse; clients render the
plain-JSON projection and never run the WASM parser.

It is a **pure projection** — no ctx, no policy, no authorization — so its POSITION is the
boundary. Called from exactly two places, both strictly AFTER the access check:
`findRecipeForViewer` (below the `canAccessResource` guard) and `getEditableProcedure`
(after `assertRecipeAccess(..., "edit")`). `recipes.list`, `autocomplete`,
`getRandomRecipe`, the dinner suggester, `getRecipeByUrl` and every share/public route and
realtime emit site are untouched. A stored source that does not parse degrades to
`cookTokens: null` plus a WARN log; the procedure resolves normally.

## The three planner-identified risks, and how each was defused

### Risk 1 — `createSelectSchema(recipes)` silently breaking the recipe LIST

`RecipeSelectBaseSchema = createSelectSchema(recipes)`, so `0041`'s three columns became
REQUIRED keys on `RecipeDashboardSchema` the moment the drizzle model gained them — and
`listRecipes`/`dashboardRecipe` would have stopped parsing **at runtime with no compile
error**. Fixed with an explicit `.omit` on `RecipeDashboardSchema`, plus `.omit` on the
insert/update bases and explicit defaulted keys on `FullRecipeSchema`.

**A green typecheck is not evidence here, so it is not what was used.** The proof is 9 new
assertions in `packages/shared/__tests__/contracts/cook-tokens.test.ts` that actually PARSE
payloads: `RecipeDashboardSchema.parse(<dashboard payload with no cook* keys>)`,
`z.array(RecipeDashboardSchema).parse([...])`, "exposes NO cook* key on its output", and
"strips a cook* key even when a producer accidentally supplies one". This is not theoretical
— the first run of that test was RED (`Unrecognized key: "cookSource"`), which is how the
stale injected `@norish/db-schema` copy was found.

### Risk 2 — the unique index turning legal saves into 500s

Both writers fixed at the root:

- `attachIngredientsToRecipeByInputTx` used an **untargeted `onConflictDoNothing()`**. With
  the new index that silently DROPS a legitimate row, and then `if (!inserted.length) return
  []` hands an empty list back to a caller that just saved real data. Now targeted at the
  natural key with `DO UPDATE`, so RETURNING yields a row for every input.
- `syncRecipeIngredientsTx` inserted blind. Payload duplicates are now collapsed with the
  same rule `deriveProjectionTx` uses, the fallback insert is an `onConflictDoUpdate`, and
  retention is matched on the **natural key** instead of the surrogate `id`.

**Proving tests** (`cook-write-path.test.ts`): "updateRecipeWithRefs accepts the SAME
ingredient twice and writes ONE row" (amount 3, summed), "createRecipeWithRefs accepts the
SAME ingredient twice", "attachIngredientsToRecipeByInputTx returns the rows it wrote, never
an empty list", and "re-ordering two ingredient lines does not raise a transient unique
violation".

### Risk 3 — the de-dup nulling grocery FKs

Re-point before delete, always. Proven by `0041-cook-source.test.ts`, which builds the
duplicate case by hand (drop the index, insert the duplicate, point a `groceries` row at the
LOSER) and replays the de-dup + index statements **read straight out of the migration file**
via `-- [0041:dedup]` / `-- [0041:unique-index]` markers, so the test cannot drift from the
SQL that will run on live. Asserts one surviving row, the grocery FK NOT NULL and equal to
the SURVIVOR, the lossless sum, and `cook_review_needed = true` on a lossy merge.

## The adversarial revert-check (all executed; never committed)

`git status --porcelain` was empty after every revert, and `git log -p 8d541fb4..HEAD`
contains none of these edits.

| # | The exact weakening | Result |
|---|---|---|
| **W-1** | `findRecipeForViewer`: hoisted `const hoisted = await withCookTokens(recipe)` ABOVE the `if (!canView)` guard | **RED — 3 failed / 19 passed.** `does NOT even PARSE the .cook for a denied viewer` (×2, `household` AND `everyone`), `does not turn the token projection into an unscoped read` |
| **W-1b** | stronger variant: made the `if (!canView)` block stop returning `null` | **RED — 7 failed / 15 passed.** the three above plus `denies a member of an UNRELATED cookbook and leaks neither the .cook nor a token` (×2) and `denies a total stranger with no cookbook at all` (×2) |
| **W-2** | `deriveProjectionTx`: dropped `eq(recipeIngredients.recipeId, recipeId)` from the delete scope | **RED — 2 failed / 3 passed.** `leaves the OTHER cookbook's rows intact when one recipe's ingredients are REMOVED`, `never nulls the OTHER cookbook's grocery FK` |
| **W-3** | `0041`: moved the `DELETE` of the losers ABOVE the `groceries` re-point | **RED — 4 failed / 7 passed.** `re-points the grocery FK onto the SURVIVOR before deleting the loser`, `sums the amounts …LOSSLESS`, `keeps the survivor verbatim and flags cook_review_needed …LOSSY`, `flags a LOSSY merge when an amount is NULL` |

After each revert the suite returned GREEN (22/22, 5/5, 11/11 respectively).

## Gates / evidence — baseline `main@8d541fb4` vs post-plan

**The baseline was re-measured this session with Docker working**, and it differs from
W1-SUMMARY's: the `ECONNREFUSED :5432` reds W1 recorded were an artifact of the sandbox's
docker group not being active, not a real gap. With testcontainers reachable,
`@norish/trpc`'s `router-fan-out-isolation` (7 tests) **passes at baseline**, and `@norish/db`
has exactly ONE pre-existing failure.

| Gate | Baseline `8d541fb4` | After W2 |
|---|---|---|
| `pnpm typecheck` | 17/17 EXIT 0 | **17/17 EXIT 0** |
| `@norish/db` | 116 passed / **1 failed** (19 files) | **164 passed / 1 failed** (23 files) — same single failure |
| `@norish/trpc` | 294 passed (30 files) | **322 passed** (32 files) |
| `@norish/shared` | 284 passed | **295 passed** |
| `@norish/shared-server` | 254 passed | **275 passed** |
| `@norish/queue` | 88 passed | **88 passed** |
| `@norish/web` | 424 passed | **424 passed** |
| `@norish/mobile` | 132 passed | **132 passed** |
| `@norish/api` · `auth` · `config` | 350 · 133 · 712 | **350 · 133 · 712** |
| lint `@norish/db` | 0 errors, 62 warnings | **0 errors, 62 warnings** |
| lint `@norish/db-schema` | 0 errors, 3 warnings | **0 errors, 3 warnings** |
| lint `@norish/shared` | 0 errors, 45 warnings | **0 errors, 45 warnings** |
| lint `@norish/shared-server` | 0 errors, 57 warnings | **0 errors, 57 warnings** |
| lint `@norish/trpc` | 0 errors, 153 warnings | **0 errors, 153 warnings** |
| `check-workspace-imports.mjs` | EXIT 0 | **EXIT 0** |
| `pnpm --filter @norish/web build:server` | EXIT 0 | **EXIT 0** (see deviation 1) |
| `pnpm i18n:check` | EXIT 1, pre-existing `no`-locale gap | **byte-identical to baseline** (`diff` empty) |

**Net-new tests: +139.** New files: `0041-cook-source` (11), `cook-projection` (22),
`cook-write-path` (10), `cook-projection.isolation` (5), `build-payload` (14),
`attach-tokens` (7), `cook-tokens-isolation` (22), `convert-measurements-toggle` (6), plus
11 contract assertions and extensions.

**The one red, PRE-EXISTING and unrelated:**
`__tests__/server/db/cleanup/cleanup-workflows.test.ts > reconciles recipe media references
…` — `expected +0 to be 3`, a media/filesystem reconciliation count. Fails identically on
the untouched tree at `8d541fb4`.

**Isolation suites, all green:** `@norish/db` isolation 25/25 (shopping-list,
dinner-suggester, households, cook-projection), `@norish/trpc` isolation 33/33 (incl.
`router-fan-out-isolation` and the new `cook-tokens-isolation`), `@norish/shared-server`
fan-out 27/27, `@norish/queue` isolation 11/11, `permissions-integration` 23/23,
`move-permissions` 13/13.

**No existing assertion was edited or weakened.** `recipes.test.ts` and
`ingredient-unit-normalization.test.ts` pass unchanged, which is the real gate on the
`syncRecipeIngredientsTx` rewrite.

## Decisions taken during execution

| # | Decision | Rationale |
|---|---|---|
| **W2-E1** | `syncRecipeIngredientsTx` matches retention on the NATURAL KEY `(recipe, system, ingredient)`, not on the client-echoed surrogate `id`. | The correct root-cause fix, not a patch. `0041` declares that tuple to be the identity of a projection row; keeping a second, conflicting identity in the writer is what creates the 500. Because an UPDATE then never changes `ingredient_id`, a re-order or a swap of two lines can never produce a transient violation — and a plain unique index is **not deferrable**, so no ordering trick could have saved a surrogate-key writer from a swap. One identity, two writers. Semantic consequence, stated plainly: renaming an existing line onto a different ingredient now moves the grocery FK to null rather than silently re-pointing it at a different ingredient — which is what "the flour line is gone" should mean. Every existing assertion still passes. |
| **W2-E2** | `attachIngredientsToRecipeByInputTx` collapses within-payload duplicates with the SAME sum/first-wins rule as `deriveProjectionTx`, rather than the plan's "last writer wins". | Postgres refuses an `ON CONFLICT DO UPDATE` that touches one row twice, so collapsing is mandatory either way; using one rule across all three writers removes a real foot-gun. `DO UPDATE` still gives last-writer-wins ACROSS statements, which is what the plan actually needed. |
| **W2-E3** | `hasTargetSystemProjection` extracted into `helpers.ts` instead of leaving the predicate inline. | `convertMeasurements` is a fire-and-forget promise chain; testing the predicate through the router would have been timing-sensitive. Extracting names the invariant, puts D-27-W2-06's reasoning next to it, and makes it directly testable. |
| **W2-E4** | `cookConfidence` uses `z.coerce.number().nullable().default(null)`. | Postgres `numeric` arrives as a string. Nothing in W2 writes it; W5 will. Asserted in both directions. |
| **W2-E5** | Section headings are emitted as `# ${section}`. | Matches `packages/shared/__tests__/cooklang/fixtures.ts` (`"# Dough"`) and the serializer's `^#+\s*` strip, so `.cook` → projection → `.cook` round-trips. |
| **W2-E6** | `getRecipeFull`'s `cookSource` (planned for task 4) landed in the task 3 commit. | `copyRecipeForSave`'s `.cook` pass-through reads `source.cookSource`; without it the SHARE-02 path is dead code and its acceptance test cannot pass. A real dependency, not a re-ordering of convenience. |

## Deviations from the plan (and why)

1. **One file under `apps/` is in the diff: `apps/web/tsdown.config.ts`** (commit `a896dae1`).
   Wiring `withCookTokens` into `@norish/trpc` makes `@cooklang/cooklang` reachable from the
   server entry; `@norish/*` are `noExternal`, so their deps get inlined, and rolldown cannot
   inline a `.wasm` — `pnpm --filter @norish/web build:server` went **EXIT 0 → EXIT 1** with
   `[UNLOADABLE_DEPENDENCY] … stream did not contain valid UTF-8`. `external` is an explicit
   allowlist already carrying every native/binary module (`sharp`, `heic-convert`,
   `ffmpeg-static`, …); the parser belongs there. **D-27-W2-03 fences `apps/` to keep the
   RENDERER in W4** — no component, page, hook or renderer is touched, and the client still
   ignores `cookSource`/`cookTokens` entirely. Leaving the server bundle unbuildable would
   have broken the deploy, which is a far worse violation than a one-line build-config entry.
   Verified: build EXIT 0, bundle carries an `@cooklang/cooklang` import and **zero** inlined
   `cooklang_wasm_bg` bytes. **This is exactly the W1 exit item the director was handed** —
   it has now bitten and is fixed.

2. **Three test files beyond `files_modified`**, all required by acceptance criteria that
   named no file: `packages/db/__tests__/server/db/repositories/cook-write-path.test.ts`
   (task 3's write-path and constraint-fallout proofs),
   `packages/shared-server/__tests__/cooklang/attach-tokens.test.ts` (task 4's read-side
   failure-mode contract), and
   `packages/trpc/__tests__/recipes/convert-measurements-toggle.test.ts` (task 3(d)'s toggle
   regression). `packages/trpc/__tests__/recipes/test-utils.ts` was also touched — the same
   file W1 had to touch, for the same reason: `createMockFullRecipe` must carry the keys the
   `FullRecipeDTO` it claims to be now has.

3. **The plan's "unknown-density volume ⇒ flagged" acceptance criterion is not reachable and
   was replaced by an honest one.** `deriveConversion(..., { system })` routes to
   `convertToSystem`, which by design stays within one physical dimension (250 ml → cups, not
   grams) and therefore never consults the density table. Cross-dimension volume↔weight is
   `convertToUnit`'s job and the projection does not use it — correctly, since a metric
   recipe's "250 ml milk" should read "1 cup milk" in US, not "257 g". The first draft of that
   test passed **vacuously**; it was rewritten into three honest tests: same-dimension volume
   conversion, `no-quantity` flag-and-preserve (the reason that IS reachable), and a
   descriptive/count unit staying system-neutral and unflagged. Flag-and-preserve is fully
   exercised; only the *reason* differs from the plan's prose.

4. **The recorded baseline differs from W1-SUMMARY's** — see the gates table. Not a
   deviation in the work, but W1's "pre-existing `ECONNREFUSED :5432` reds" turn out to have
   been an environment artifact; with Docker reachable they pass. Future waves should expect
   `@norish/trpc` at 0 failures and `@norish/db` at exactly 1.

5. **Environment repair (sandbox only, nothing in the git tree).** The R8 hoisted-linker trap
   fired immediately: `node_modules/@norish/{db,db-schema,trpc}` were stale hardlink COPIES,
   so `createSelectSchema(recipes)` could not see the new columns and the first contract test
   run failed with `Unrecognized key: "cookSource"`. Repaired the way W1 did, and one step
   further: each injected `src/` **and `package.json`** now symlinks to the workspace source
   for `db`, `db-schema`, `trpc`, `shared`, `shared-react` and `shared-server`, so an
   export-map edit can never go stale again. A clean CI/docker `pnpm install` resolves
   everything from the lockfile.

## Security

- **Adversarial revert-check: IN FORCE and executed** — see the table above. Four weakenings,
  each turned its suite RED, each reverted to a byte-identical tree, none committed.
- **T-27-01 (untrusted text → WASM parser):** no new attack surface.
  `grep -rn "cookSource\|cook_source\|cookTokens" packages/trpc/src/routers/recipes/` returns
  **nothing** — no input schema carries a `.cook`, and `RecipeInsertBaseSchema` /
  `RecipeUpdateBaseSchema` explicitly `.omit` all three columns, with tests asserting a
  client-supplied `cookSource` is DROPPED. Input-size limiting is inherited by **W3**, where
  extraction output first becomes the source.
- **T-27-02 (disclosure):** `cookSource`/`cookTokens` ship ONLY from `findRecipeForViewer`
  (post-`canAccessResource`) and `getEditable` (post-`assertRecipeAccess`). The list/search/
  dashboard DTO is byte-for-byte unchanged and carries no `cook*` key. A denied viewer does
  not even cause a PARSE, and the denied response and thrown error are asserted to contain
  neither the `.cook` text nor a token. Every policy-seeded case has its `view: "everyone"`
  sibling — `everyone` is the LIVE policy and all three historical leaks survived a suite
  that only seeded `household`.
- **T-27-03 (de-dup vs grocery FK):** re-point first, delete second; proven, and W-3 proves
  the assertion bites.
- **T-27-05 (prose in logs):** the failure logs carry `recipeId`/counts/reason only, asserted
  with a logger spy that scans the serialized payload for the recipe text.
- **No new realtime emit site** — the diff contains no new `emitByPolicy` / `emitter.*` call,
  and no existing emit payload gained a field beyond what `getRecipeFull` now returns.

## W2 exit items for the DIRECTOR

1. **`pnpm docker:build`** + deploy-image sanity, including an **in-image** confirmation that
   `@cooklang/cooklang` survives `pnpm deploy --filter @norish/web --prod` into
   `/app/deploy/node_modules` and loads its `.wasm` under the production Node runtime. The
   bundler leg is now proven (external, zero inlined wasm); the image leg is still the
   director's.
2. **Run `packages/db/src/migrations/checks/0041-precheck.sql` against a RESTORED COPY of the
   live dump** and record the three counts. A precheck already run against live data reported
   **ZERO duplicate groups and ZERO grocery links at risk** across 164 `recipe_ingredients`
   rows / 7 recipes, so `0041`'s de-dup is expected to be a **no-op** — but re-confirm on the
   dump of the day before deploy. If the lossy-merge count is non-trivial, surface it to Kiran
   before `0041` reaches live; do NOT tune the merge rule to make the number smaller.
3. **Confirm a verified-restorable backup exists before the deploy that carries `0041`.**
   Rollback story: the additive half is fully reversible —
   `DROP INDEX "uq_recipe_ingredients_recipe_system_ingredient";` then
   `ALTER TABLE "recipes" DROP COLUMN "cook_review_needed", DROP COLUMN "cook_confidence",
   DROP COLUMN "cook_source";`. **The de-dup half is NOT reversible**: if it merged rows,
   restore-from-dump is the only rollback.

## What W3 can now assume

- **`buildCookPayload(recipe, units?)`** is importable from
  `@norish/shared-server/cooklang/build-payload` and is the only sanctioned way to mint a
  `.cook`. Hand its result straight to the repository as the `cook` argument. If it returns
  `null`, pass **no** `cook` — the legacy write runs and the save succeeds.
- **`createRecipeWithRefs(id, userId, householdId, input, cook?)`** and
  **`updateRecipeWithRefs(id, userId, input, version?, cook?)`** are ready. Turning W3's
  producers on requires no further repository change.
- **`cook` is a SERVER-SIDE argument.** W3 must not add a `.cook` to any tRPC input.
  T-27-01's input-size limiting is W3's to add, at the point extraction output first becomes
  the source.
- **`deriveProjectionTx` needs `CookTokensDTO`, never a `.cook` string** — `@norish/db` must
  stay parser-free.
- The `.cook` W3 produces must parse with an **EMPTY** report or `buildCookPayload` refuses
  it. The error log (`reason: "did-not-parse-cleanly"`, with counts, never prose) is the
  signal that W3's extraction is producing something the parser dislikes; W5's backfill uses
  the same signal.
- `recipes.get` / `getEditable` already carry `cookSource` + `cookTokens`. The moment W3
  writes a `cook_source`, those responses go live — **W4 owns the client-side
  `cookTokens ? tokenRenderer : legacy` fork**, so until W4 lands the client simply ignores
  them and nothing regresses.
- Still open from W0, still unaddressed: no `kilogram` / `fl oz` / `pint` canonical unit IDs
  (so `convertToSystem` mass-metric collapses to `gram` and US volume never uses fluid ounce),
  and the density table is ~29 ingredients. Neither blocks W3; both matter before W5.
- `recipe_ingredients` now has a **unique natural key**. Any new writer must be
  conflict-aware; use `collapseDuplicateIngredientRows` from
  `@norish/db/repositories/ingredients` rather than inventing a fourth rule.
