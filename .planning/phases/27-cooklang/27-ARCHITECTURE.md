# Phase 27 (COOK-01) — MASTER PLAN: FULL-NATIVE Cooklang migration

> Status: **PLANNING**. Supersedes the additive-dual-store design. Decision by
> **Kiran, 2026-07-24**: migrate to **full-native Cooklang, NO bandaids** —
> `.cook` becomes the single source of truth for steps + ingredients + timers;
> the heuristic `SmartInstruction`/`applyIngredientLinkMarkup` layer is **deleted**;
> the structured tables survive **only as a derived projection**; metric↔US becomes
> a **deterministic OSS converter** instead of the AI `unit-converter.ts` round-trip.
> Reversals recorded in `27-DECISIONS.md` (D-1, D-2, D-6, D-7, units). Ground truth:
> `27-RESEARCH.md`, `27-EXPERIMENT.md`, `27-EXTRACTION-PROMPT.md`, the committed
> `spike/` serializer (validated vs the REAL `@cooklang/cooklang@0.18.7` WASM parser).
> Repo `/opt/norish-src`, branch `main`. Live DB at migration **41** (`0000`–`0040`).

---

## 0. The honest framing (read this first)

Two facts shape everything and must not be papered over:

1. **The structured tables do NOT disappear.** Search (`to_tsvector` over
   `recipe_ingredients.name`/`steps.step`), the household shopping list
   (`groceries.recipe_ingredient_id` FK), the dinner suggester (Phase 26) and the
   recipe list all read structured name/qty/unit **rows**. "Full native" therefore
   means: `.cook` is the **only authored/source-of-truth** representation, and
   `steps` + `recipe_ingredients` **demote from authored to a derived, materialized
   projection** regenerated from the `.cook` on every write. A materialized
   projection is **not a bandaid** — it is a cache with a single upstream owner. But
   anyone expecting those tables to be *dropped* should know they persist. See §11.

2. **Per-step amount precision is irreducibly lossy for a minority of recipes**
   (split-amount, multi-step ingredients — `27-EXPERIMENT.md`), and with **no
   permanent heuristic fallback** the low-confidence tail cannot silently fall back
   to name-matching at render time. Every recipe must instead end the migration with
   a **valid, renderable `.cook`** (best-effort for the tail) plus a **review flag**;
   the honest cost of "no bandaids" is a **review queue** that needs human action —
   un-reviewed low-confidence recipes carry best-effort amounts permanently (§8, §11).

---

## 1. Target architecture

### 1.1 Source of truth — one `.cook` per recipe, native system

- **Storage: a nullable `recipes.cook_source TEXT` column** (not a side table — one
  blob per recipe; no join needed on the hot read path). Written by the serializer
  on every create/update/import. During expand it is nullable; after backfill it is
  enforced (§6 — NOT-NULL is a restore-dump-rollback migration per the Phase 25
  lesson).
- **ONE unit system in the `.cook`** — the recipe's **native** `recipes.system_used`
  (as authored/extracted). The `.cook` carries `norish.system: metric|us` in YAML
  frontmatter (spike already emits this). Cooklang is inherently single-system; the
  second system is **derived deterministically** (§3), not stored as a parallel
  authored `.cook`. This reverses D-2's "keep both systems as authored rows."
- Supporting columns on `recipes`: `cook_confidence NUMERIC` (0–1, from the backfill
  gate) and `cook_review_needed BOOLEAN NOT NULL DEFAULT false` (§8).

### 1.2 Derived projection — regenerated transactionally on write

`deriveProjectionTx(tx, recipeId, cookSource)` is the new heart of the write path.
On every recipe write, **inside the same DB transaction** that saves `cook_source`:

1. Parse `cook_source` with `@cooklang/cooklang` → recipe-level `ingredients[]`,
   `timers[]`, `sections[].content[]` step token lists.
2. **Native-system rows:** for each parser ingredient, UPSERT a `recipe_ingredients`
   row (name via `ingredients` dictionary, `amount`/`unit` from the token, canonical
   unit ID round-tripped verbatim — D-8) and rebuild `steps` rows (step prose text,
   headings → `#`-prefixed step per today's convention on read; see §2.1).
3. **Other-system rows:** run the deterministic converter (§3) over the native rows
   to materialize the opposite `system_used` projection. This REPLACES the AI
   `unit-converter.ts` pass.
4. **Stable identity (the FK-safety keystone):** projection UPSERT is keyed on the
   **natural key `(recipe_id, system_used, ingredient_id)`**, NOT delete-and-reinsert,
   so a `recipe_ingredients.id` is **preserved across edits** and
   `groceries.recipe_ingredient_id` FKs survive (§2.5). Cooklang's recipe-level
   ingredient list is inherently deduped, so one row per (recipe, system, ingredient)
   holds; if two amounts of the same ingredient appear, sum into one row.

### 1.3 Read model — parser tokens shipped in the DTO

- The recipe read DTO (`FullRecipeSchema`) gains **`cookSource`** and a
  **`cookTokens`** projection: a per-step ordered token list
  (`text | ingredient{name,amount,unit} | timer{name,amount,unit}`) produced by
  parsing `cook_source` **server-side once** and shipping the plain-JSON token model.
  **Clients (web + mobile) render tokens; they do NOT run the WASM parser.** This
  keeps mobile (Expo/RN) parser-free and keeps one parse per read on the server.
- `recipeIngredients[]` + `steps[]` remain in the DTO for the ingredient list, search
  result rendering, and shopping-list add — sourced from the projection.

```
                       AUTHORED / SOURCE OF TRUTH
                       ┌───────────────────────────┐
   extraction/import → │  recipes.cook_source (.cook)│ ← recipe edit
                       └─────────────┬─────────────┘
                                     │  deriveProjectionTx (same txn)
             ┌───────────────────────┼───────────────────────┐
             ▼                       ▼                        ▼
   steps (projection)   recipe_ingredients (projection,   cookTokens (read-time
   both systems         stable natural key, both systems)  parse → DTO)
             │                       │                        │
             ▼                       ▼                        ▼
      search tsvector       shopping-list FK / dinner    token renderer
                            suggester / ingredient list   (cooking mode + detail)
```

---

## 2. Every consumer re-wire (exhaustive blast radius)

Missing one is how a full-native migration breaks in production. Each entry: file →
change.

### 2.1 Cooking-mode renderer (web) — heuristic DELETED, token renderer in
- `apps/web/app/(app)/recipes/[id]/components/cookingmode/cooking-step-view.tsx`,
  `cooking-mode-steps.ts`, `cooking-mode.tsx`, `types.ts` — stop passing
  `ingredientCandidates`; render each step from `cookTokens[stepIndex]`: `text`
  tokens verbatim, `ingredient` tokens as styled chips with authoritative in-token
  `name + formatUnit(amount,unit)`, `timer` tokens → timer chips. Headings come from
  `== section ==`, replacing the `text.startsWith("#")` in-band convention.
- `apps/web/components/recipe/smart-instruction.tsx` +
  `apps/web/components/shared/smart-markdown-renderer.tsx` — the ingredient-markup
  path is removed; a lean token renderer replaces it. The `norish-ingredient:` press
  handler + highlight styling are **kept** but fed from tokens.

### 2.2 Heuristic markup lib — DELETED
- `packages/shared-react/src/text/ingredient-links.ts`:
  `applyIngredientLinkMarkup`, `createIngredientLinkCandidates`,
  `readBraced/SingleWordIngredientToken`, `IngredientLinkCandidate` — **deleted**
  from the runtime render path (may be reused ONE-TIME as a backfill seeder, §8).
  `formatIngredientLinkToken` + `formatIngredientLinkAmount` + `formatUnit` move to
  serve the **serializer** (§4). Audit all importers (cooking mode, recipe detail,
  mobile) and cut them over.

### 2.3 Timers — parser-driven multi-timer
- `useTimerKeywordsQuery`/`useTimersEnabledQuery` + the keyword scan in
  `smart-markdown-renderer.tsx` → replaced by `timer` tokens (`~name{n%unit}`).
  Cooking mode gains concurrent named timers (pasta + sauce). Keyword config retires
  (or stays only for legacy prose with no tokens during the transition window).

### 2.4 Mobile — token parity
- `apps/mobile/src/lib/recipes/map-recipe-to-steps.ts`,
  `components/recipe-detail/recipe-steps.tsx`,
  `components/recipe-detail/cook-mode/{cook-mode-steps,cook-mode-ingredients,cook-mode-modal}.tsx`,
  `components/recipe-detail/text-renderer` (`SmartText`) — read `cookTokens` from the
  DTO instead of `recipe.steps[].step`; render tokens (no WASM on device).

### 2.5 Shopping list / groceries FK — re-point onto the stable projection
- `packages/db-schema/src/schema/recipe-ingredients.ts` — add
  `uniqueIndex(recipe_id, system_used, ingredient_id)` to support UPSERT-stable
  derivation (the keystone of §1.2). `groceries.recipe_ingredient_id` (onDelete
  `set null`) is **unchanged in shape**; it now points at a row whose **id is
  preserved across recipe edits**, so Phase 25's household list keeps its
  "from recipe X" linkage and aisle grouping. Removing an ingredient from a recipe
  deletes its projection row → FK nulls (identical to today's behavior).
- `packages/db/src/repositories/groceries.ts` (`getRecipeInfoForGroceries`),
  `packages/trpc/src/routers/groceries/{groceries-helpers,recurring}.ts` — no logic
  change **provided** derivation is UPSERT-stable; add a regression test asserting a
  recipe edit does NOT null existing grocery FKs.

### 2.6 Search — UNCHANGED (the projection payoff)
- `packages/db/src/repositories/recipes.ts` tsvector subqueries over
  `recipe_ingredients`/`ingredients`/`steps` keep working because the projection
  keeps those tables populated. **No SQL change.** Add a test that a `.cook`-authored
  recipe is findable by ingredient + step text.

### 2.7 Recipe write path — authored→derived
- `packages/db/src/repositories/recipes.ts`: `updateRecipeWithRefs`,
  `createRecipeWithRefs`, `syncRecipeIngredientsTx`, `syncRecipeStepsTx` — the input
  is now the per-step structured JSON (or `.cook`); these serialize → `cook_source`
  → `deriveProjectionTx`. `syncRecipeIngredientsTx`/`syncRecipeStepsTx` become
  **projection writers** (UPSERT by natural key), not authored-input handlers.

### 2.8 Contracts / tRPC
- `packages/shared/src/contracts/zod/{recipe,recipe-ingredients,steps}.ts` — add
  `cookSource` + `cookTokens` to `FullRecipeSchema`; create/update input accepts the
  per-step linkage shape. `packages/trpc/src/routers/recipes/recipes.ts` — get/list/
  create/update wired to the new shape; list/search DTO unaffected (reads projection).

### 2.9 Extraction + import (see §4)
- `packages/api/src/ai/prompts/builder.ts` (3 builders) + `recipe-extraction.txt` +
  `packages/api/src/ai/schemas/recipe.schema.ts`; `packages/api/src/parser/{jsonld,
  normalize}.ts` (`normalizeRecipeFromJson`, `parseIngredients`, `parseSteps`).

### 2.10 AI unit converter — DELETED (see §3)
- `packages/shared-server/src/ai/unit-converter.ts`, its `unit-conversion` prompt,
  `schemas/conversion.schema.ts`, and callers — removed; replaced by deterministic
  derive-time conversion.

### 2.11 Recipe copy / share / version
- `packages/db/src/repositories/recipe-share-helpers.ts`, `recipe-shares.ts`,
  save-to-account (SHARE-02) and Phase 30 lineage — must copy `cook_source` and
  re-derive the projection for the new recipe id (never copy projection rows raw,
  or grocery FKs would cross recipes).

### 2.12 Export / recipe detail non-cooking views
- Recipe detail page ingredient list + step display (web + mobile) render from
  projection/tokens. `.cook` file export is a **natural new capability** but is
  **out of scope** (§9) beyond noting the column makes it trivial.

---

## 3. Units subsystem — deterministic OSS converter + density glue

### 3.1 The pick
**`convert`** (npm, latest **v7.0.2**, **MIT**, TS-native, actively maintained —
published 2026-07-22; repo `convert-units`/successor lineage). Rationale: smallest/
fastest, fully typed, tree-shakeable, deterministic; covers every **same-dimension**
cooking conversion (mL↔L↔tsp↔tbsp↔cup↔fl-oz; g↔kg↔oz↔lb; °C↔°F). Alternatives
weighed: `convert-units@2.3.4` (npm build stale since 2018), `js-quantities@1.8.0`
(MIT, no density), `unitmath`/`mathjs` (Apache-2.0, powerful but heavy; keep as a
fallback if `convert`'s unit vocabulary proves too narrow for a canonical ID).

### 3.2 Volume↔weight — the honest verdict: **converter + density-dataset glue we write**
No maintained JS library does volume↔weight with a **built-in ingredient density
dataset**. `convert`/`convert-units`/`js-quantities` **refuse cross-dimension**
(cup→gram) by design (dimensional analysis). `@dailykit/food-units-converter`
(MIT, v1.0.2) *does* mass↔volume via bulk density — but it is **unmaintained
(2021)** and **you must supply the density anyway**. So:

- **Same-dimension conversion is fully off-the-shelf** (`convert`).
- **Volume↔weight is glue we own:** a **config-as-code ingredient density table**
  (`g/mL`, or `g/cup` normalized), keyed by canonical ingredient name, distilled
  from **USDA FoodData Central `foodPortions.gramWeight`** (**public domain / CC0**,
  no attribution burden) — the same open source the ingredient dictionary can seed
  from. Delivered as server-config (HOUSE/config-as-code discipline), not hardcoded.
- **When density is unknown for an ingredient, DO NOT convert across dimensions** —
  keep the native unit in the other-system projection and mark it. Never fabricate a
  gram weight. This is the deterministic replacement for the AI pass's occasional
  guess: we prefer "unconverted + flagged" over "confidently wrong."

### 3.3 Integration point + render toggle
- **Derive-time** (not render-time): `deriveProjectionTx` produces both systems'
  projection rows once per write, so search/shopping/list stay cheap and the render
  path is pure. The `.cook` itself stays single-system; the "other system" is a
  projection + (optionally) a render-time re-serialized `.cook` view for cooking mode.
- **Render toggle:** the metric/US switch selects which `system_used` projection (and
  which derived token view) to show — deterministic, no AI, no network.

### 3.4 What norish code is removed
`unit-converter.ts` + `unit-conversion.txt` + `conversion.schema.ts` deleted (§2.10).
**Assessment:** a strict win on cost (no LLM call per import), latency, and
reproducibility (same input → same output). The only capability lost is the AI's
occasional *guess* at an unknown-density volume↔weight conversion — which we
deliberately replace with flag-and-preserve. Net positive.

---

## 4. Extraction rewrite (native emission)

Per `27-EXTRACTION-PROMPT.md` (already designed):
- **Schema** (`recipe.schema.ts`): `recipeInstructions.{metric,us}` becomes an array
  of `{ text, ingredients:[{name,amount,unit}], timers:[{name,amount,unit}] }` step
  objects; the flat `recipeIngredient` list stays as the ingredient dictionary the
  per-step refs point into.
- **Prompt fragment** appended by all **three** builders (`buildRecipeExtractionPrompt`,
  `buildImageExtractionPrompt`, `buildVideoExtractionPrompt`) exactly like the
  allergy/language fragments — the "amount on first add, never split unjustified,
  exact names, null for to-taste, garnish→finishing step, don't rewrite prose into
  tokens" rules.
- **Wiring:** AI/JSON-LD output → zod validate + repair → `structuredToCooklang`
  (§4, moved into `@norish/shared`) → `cook_source` → `deriveProjectionTx`. With
  full-native, we can extract **one native system** and derive the other (§3),
  halving extraction output vs today's dual emission — assess enabling that in W3.
- **Isolation:** extraction is per-recipe, no cross-cookbook reads; HOUSE-06 intact.

**Serializer productionization:** move the spike `structuredToCooklang` into
`@norish/shared`, replacing the vendored helpers with the real
`formatIngredientLinkToken` + `formatUnit`. **Longest-name-first matching is
mandatory** (proven load-bearing in the experiment). Mind the hoisted-linker gotcha
(`node_modules/@norish/*` are hardlinks — re-sync after cross-package edits).

---

## 5. Existing-recipe migration (one-time, data-mutating, live)

- **Job:** for each recipe, feed its flat `steps[]` + `recipe_ingredients[]` to the
  AI re-linking pass (same instruction as extraction) → per-step JSON →
  `structuredToCooklang` → `cook_source`. No permanent heuristic fallback.
- **Confidence score** per `27-EXPERIMENT.md` signals (all cheap/deterministic):
  0 `appended` links; no ingredient named in >1 step unless exactly one carries the
  amount; `Σ per-step amounts == structured total` per ingredient; no orphan
  ingredients. Store as `cook_confidence`; below threshold → `cook_review_needed=true`.
- **The tail (no fallback):** every recipe still gets a **best-effort `.cook`**
  (it renders — it is not broken), but low-confidence ones are **flagged for review**
  and surfaced in a repair tool (§8). Where AI is unavailable, a **one-time
  deterministic seed** (the old name-match logic reused as a *migration seeder*, not
  a runtime renderer) pre-fills, always flagged for review.
- **Safety (Phase 22.4/25 discipline):** dry-run the entire backfill against a
  **restored copy of the live dump**, measure the confidence distribution, **tune the
  gate**, and only then run against live inside the migration window. Back up first;
  rollback = **restore the dump** (§8).

---

## 6. DB migration sequence (from `0041`; live is at 41)

| # | Name | Kind | Mutates live data? |
|---|---|---|---|
| **0041** | `add_cook_source` | **EXPAND** — add nullable `recipes.cook_source`, `cook_confidence`, `cook_review_needed`; add `uniqueIndex(recipe_id, system_used, ingredient_id)` on `recipe_ingredients` (pre-check + de-dup any existing duplicate rows first). | **No** (additive; the unique index build can fail on pre-existing dups → pre-check step). Reversible. |
| **0042** | `backfill_cook_source` | **MIGRATE** — populate `cook_source` + confidence + review flag for all recipes (§5); re-materialize the projection via UPSERT (preserves `recipe_ingredients.id` → grocery FKs survive). | **YES — heavy.** Restore-dump rollback. Dry-run vs restored dump first. |
| **0043** | `enforce_cook_source_not_null` | **CONTRACT (constraint)** — set `recipes.cook_source NOT NULL` once backfill is verified 100%. | **YES (constraint).** Per Phase 25 lesson, image-only rollback is **not** write-safe → **restore-dump rollback**. |
| — | *(no destructive DROP)* | The projection tables **stay** (search/shopping need them). "Contract" is overwhelmingly **code deletion** (heuristic renderer, `unit-converter.ts`, transitional read-fork), not a schema drop. | — |

The **only irreversible-ish step is `0042`'s data mutation** (and `0043`'s
constraint) — there is no risky `DROP TABLE steps`/`recipe_ingredients`, because
those demote to projection rather than disappear. This is deliberate and de-risks the
migration substantially.

---

## 7. Waves (ordered so the app is NEVER broken between waves)

| Wave | Scope | Never-broken guarantee |
|---|---|---|
| **W0 — Units** | Vendor `convert`; build the USDA-seeded density table (config-as-code) + `deriveConversion` util (same-dim via `convert`, cross-dim via density, flag-on-unknown). Pure/testable. | No runtime wiring yet. |
| **W1 — Serializer + parser read-model** | Move `structuredToCooklang` into `@norish/shared` (real `formatUnit`); add `@cooklang/cooklang` parse→`cookTokens` server util; add `cookSource`/`cookTokens` to DTO (nullable). | Additive; renderers still use old path. |
| **W2 — Write path + `0041`** | `0041` expand migration; `deriveProjectionTx` (UPSERT-stable, both systems) wired into create/update/import; new recipes write `cook_source` + projection. Renderer reads tokens **when present, else old path** (transitional fork — allowed only until W6). | Old recipes (no `cook_source`) render via the transitional fork. |
| **W3 — Extraction native** | 3 prompt builders + schema + serializer wiring; JSON-LD importer → per-step linkage → `.cook`. New imports fully native + single-system extraction (§4). | Import output shape validated by zod/repair. |
| **W4 — Token renderer + multi-timer** | Cooking-mode + recipe-detail token renderer (web + mobile); delete heuristic **runtime** path where `cook_source` present; multi-timer from tokens. | Transitional fork still covers un-backfilled recipes. |
| **W5 — Backfill `0042` + review tool** | Dry-run vs restored dump; tune gate; run `0042` live; review queue + repair tool; set flags. After this, 100% of recipes have `cook_source`. | App reads tokens for all; no recipe left on old path. |
| **W6 — Contract** | `0043` NOT-NULL; delete `unit-converter.ts`, heuristic `ingredient-links` markup, the transitional read-fork, timer-keyword scan. Clean single-representation end state. | Safe because W5 guaranteed 100% coverage. |

**Rough size: ~6 waves / ~6–8 plans** — larger than the additive spike's W1–W4
because the projection derivation, the FK stable-key rewire, the units subsystem, and
the backfill+review tooling are net-new versus "just add a nullable column."

---

## 8. Risks, isolation, rollback

- **Biggest risk — the backfill tail with no fallback.** Every recipe MUST end with a
  renderable `.cook`; low-confidence ones render best-effort amounts until a human
  reviews. Mitigation: best-effort `.cook` always generated (never a blank/broken
  recipe) + `cook_review_needed` queue + repair tool + gate tuned on a restored-dump
  dry-run before live. Residual: un-reviewed recipes keep best-effort amounts.
- **Grocery FK re-point (Phase 25).** UPSERT-stable derivation on natural key
  `(recipe_id, system_used, ingredient_id)` preserves `recipe_ingredients.id` so the
  household list's `recipe_ingredient_id` linkage + aisle grouping survive edits.
  Regression test required (§2.5).
- **Volume↔weight density gaps.** Flag-and-preserve unknown-density ingredients;
  never fabricate. Density table is config-as-code, extensible.
- **Irreversible-ish `0042`/`0043`.** Restore-dump rollback (image-only is not
  write-safe once `cook_source` is authored/NOT-NULL — the exact Phase 25 lesson).
  Back up + verify-restorable before the migration deploy.
- **HOUSE-06 isolation** preserved throughout: extraction/backfill are per-recipe;
  the derived projection inherits the recipe's cookbook scope; no new read widens past
  the cookbook; `view:"everyone"` stays clamped (AGENTS.md).
- **Hoisted-linker** cross-package staleness for the serializer in `@norish/shared`.

---

## 9. Out of scope — defer to Phase 31 (ingest overhaul)

Extraction-schema generalization beyond the 3 prompts; provider orchestration/repair
rework; ingredient dedupe/normalization overhaul; JSON-LD↔AI↔image/video convergence;
`.cook` file import/export UX; any upstream contribution. Nutrition + media stay in
columns/tables (round-trip through Cooklang metadata only at export, later).

---

## 10. Sub-docs
- Per-wave detail docs may be added as `27-ARCHITECTURE-W{n}.md` when a wave is scheduled.
  This master doc is the contract; waves are executed under the fork's expand→migrate
  →contract discipline with a restored-dump dry-run before every data-mutating step.

---

## 11. What challenges "full native, no bandaids" (say it plainly)

1. **The structured tables can't be deleted** — search + the household shopping list +
   the dinner suggester genuinely need structured name/qty/unit rows. So the true end
   state is **`.cook` as the single source of truth + a permanent derived structured
   projection**. The projection is a materialized cache (one owner), not a bandaid —
   but it is *not* the "delete steps/recipe_ingredients" some might picture. If that's
   surprising, it should be surfaced now.
2. **No render-time fallback shifts the lossy tail onto humans.** The split-amount /
   multi-step cases are irreducibly lossy from norish's source data. Banning the
   heuristic render fallback means those recipes carry **best-effort** amounts and
   rely on a **review queue**; with no reviewer, the best-effort amounts persist.
   That is the real, accepted cost of "no bandaids" — worth confirming Kiran wants the
   review-queue burden rather than a quietly-degrading heuristic fallback.
</content>
