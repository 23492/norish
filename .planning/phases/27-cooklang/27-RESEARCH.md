# Phase 27 (COOK-01) — Cooklang migration: RESEARCH

> Status: RESEARCH ONLY. No executable gsd plan, no code change. Phase 27 is
> **externally blocked** on design coordination with upstream maintainer
> `mikevanes` (issue #470, an empty placeholder). This document maps the
> current state and design space so that #470 conversation is well-informed.
> Repo `/opt/norish-src`, branch `main`, tip `0e03acf9`. DB at migration **41**
> (files `0000`–`0040`; next file would be `0041_*`).

Legend: **[VERIFIED]** = read in code/docs in this session. **[ASSUMPTION]** =
inference not directly confirmed.

---

## 0. TL;DR — the one finding that frames everything

**There is NO ingredient↔step linkage in norish today.** A recipe holds two
*parallel, independent flat lists*: `steps` (free text) and `recipe_ingredients`
(structured qty+unit+name). Nothing in the schema says "ingredient X is used in
step Y." Cooklang's entire value proposition is exactly that linkage. So the
migration is not a re-encoding of existing structure — it is the *creation of
structure that does not currently exist*. That makes it inherently **best-effort
for existing recipes** (the linkage must be inferred) and **native only for new
imports** (where we can emit it at extraction time).

Secondary but important: the fork has **already built a heuristic "Cooklang-lite"
layer** — step text can contain `@ingredient{amount}` tokens which are matched by
name against the flat ingredient list and rendered inline in cooking mode
(`applyIngredientLinkMarkup`, `SmartInstruction`). This is a large head start,
and also the thing a real Cooklang migration would *replace/formalize*.

---

## 1. Current-state map (VERIFIED against schema + contracts)

### 1.1 Steps — free text, no ingredient reference
`packages/db-schema/src/schema/steps.ts`:
```
steps {
  id uuid PK
  recipe_id uuid -> recipes.id (cascade)
  step text NOT NULL          // <- the whole instruction, plain text
  system_used measurement_system NOT NULL default 'metric'
  order numeric
  ... versionColumn
  unique(recipe_id, step, system_used, order)
}
```
The step *is* a text blob. Headings are encoded in-band: a step whose text
starts with `#` is treated as a section heading, not a step
(`cooking-mode-steps.ts` `resolveCookingModeSteps`, line 40:
`if (text.startsWith("#")) { heading = ... }`).

### 1.2 Ingredients — structured, but attached to the RECIPE, not the step
`packages/db-schema/src/schema/recipe-ingredients.ts`:
```
recipe_ingredients {
  id uuid PK
  recipe_id uuid -> recipes.id (cascade)
  ingredient_id uuid -> ingredients.id (cascade)
  amount numeric(10,3)        // structured quantity
  unit text                   // canonical unit ID (see §1.5)
  order numeric
  system_used measurement_system NOT NULL default 'metric'
  ... versionColumn
}
```
`ingredients` (`ingredients.ts`) is just `{ id, name (unique lower), createdAt }`
— a global, deduped name dictionary shared across recipes.

**There is no `step_id` column anywhere on `recipe_ingredients`**, and a repo-wide
search for `stepId`/`step_id` outside `step_images` returns nothing. [VERIFIED]

### 1.3 Relations confirm the two flat lists
`packages/db-schema/src/schema/relations.ts` lines 22–34:
```
recipesRelations: {
  ingredients: many(recipeIngredients),   // flat list A
  steps:       many(steps),               // flat list B
  ...
}
```
`stepsRelations` (lines 95–101) relate a step only to its `recipe` and its
`stepImages` — never to ingredients. So A and B never meet in the data model.

### 1.4 Dual metric/US is modeled as PARALLEL ROWS, not a conversion
`measurement_system` enum = `['metric','us']` (`recipes.ts:18`). A recipe stores
BOTH systems as duplicate rows: every ingredient and every step exists once with
`system_used='metric'` and once with `'us'`. The reader filters by the active
system (`resolveCookingModeSteps` filters `step.systemUsed === systemUsed`;
`createIngredientLinkCandidates` does the same). `recipes.system_used` records the
recipe's "native" system. AI conversion (`unit-converter.ts`) generates the other
system's rows via an LLM pass. **[VERIFIED]** — this is load-bearing for the
Cooklang mapping: a single `.cook` string is inherently one system, so dual-units
needs a decision (§ DESIGN-OPTIONS).

### 1.5 Units — canonical IDs already exist (Phase 19 UNIT-NORM-01)
`packages/shared/src/lib/unit-localization.ts`: units are canonical IDs (`gram`,
`tablespoon`, `dash`) with locale-aware `short`/`plural`/`alternates`.
`normalizeUnit(raw, config)` canonicalizes on save (`gr`→`gram`, `scheutje`→`dash`);
`formatUnit(id, locale, config, qty)` localizes on display. The recipe CREATE and
UPDATE paths both normalize (`syncRecipeIngredientsTx`, Phase 19). Free-text
ingredient strings are parsed to `{amount, unit, name}` via the npm lib
`parse-ingredient@2.2.0` (`packages/shared/package.json:40`) + `normalizeUnit`.
**This is the surface Cooklang's `{amount%unit}` token must reconcile with.**

### 1.6 Nutrition + media already have homes (columns/tables, not text)
- Nutrition: `recipes.calories/fat/carbs/protein` columns (`recipes.ts:46-49`).
- Media: `recipes.image`, `recipes.url`, tables `recipe_images`, `recipe_videos`,
  and per-step `step_images` (`step_id` FK). [VERIFIED]
These do NOT need to move into Cooklang — the question (§6) is only whether they
*round-trip through* Cooklang metadata for export, or stay norish-side.

### 1.7 PRIOR ART — the fork already ships a "Cooklang-lite" inline layer
This is the most important non-schema finding.
`packages/shared-react/src/text/ingredient-links.ts`:
- `applyIngredientLinkMarkup(text, candidates)` scans step text for `@name` and
  `@name{amountLabel}` tokens (Cooklang-shaped) and, when the token name fuzzy-
  matches a candidate from the flat ingredient list, rewrites it to a markdown
  link `[name (amount)](norish-ingredient:key)`.
- `formatIngredientLinkToken(name, amount)` *emits* `@flour{200 g}`-style tokens.
- `createIngredientLinkCandidates(ingredients, systemUsed)` builds the match set
  from the flat `recipe_ingredients` list.
Rendering: `cooking-step-view.tsx` → `SmartInstruction` →
`SmartMarkdownRenderer` (with `ingredientCandidates` + a timer-keyword config).
So cooking mode **already** highlights ingredient mentions inside step text and
can show an amount next to them — but the amount is *recovered by name-matching
the separate list*, NOT stored in the step. It is heuristic and lossy (a step
that says "add the flour" with no `@` token, or two different flours, breaks it).
Cooklang would make this linkage *authoritative* instead of *guessed*.

### 1.8 Import / extraction path (where a serializer would live)
- **AI extraction** (`packages/api/src/ai/schemas/recipe.schema.ts`): the model is
  told to return schema.org-shaped JSON with `recipeIngredient: {metric[], us[]}`
  and `recipeInstructions: {metric[], us[]}` — **arrays of free-text strings**,
  dual-system, NO structured per-step amounts. Prompt bodies live in
  `packages/api/src/ai/prompts/*.txt` + `packages/shared-server/.../prompts/`.
- **JSON-LD importer** (`packages/api/src/parser/jsonld.ts` →
  `parser/normalize.ts` `normalizeRecipeFromJson`): parses schema.org Recipe into
  a `FullRecipeInsertDTO` via `parseIngredients`/`parseSteps` — again two flat
  lists. `parseIngredients` applies `parse-ingredient` + unit config.
- Both converge on `FullRecipeInsertDTO` (`FullRecipeInsertSchema`,
  `contracts/zod/recipe.ts`): `recipeIngredients[]` + `steps[]`, independent.

**A structured→`.cook` serializer would sit here**, converting the DTO (or the
AI's structured output) into a `.cook` string. None exists in JS today
(confirmed: no `cooklang` dep in any `package.json`; spec defines no canonical
serialization — see §3).

---

## 2. Target Cooklang model — how it delivers in-step amounts

### 2.1 The parser output is the mechanism (parser API — from cooklang.org docs)
> **Context7 was UNAVAILABLE this session (server requires OAuth, non-interactive).**
> API below is from cooklang.org spec + docs + the (deprecated) `cooklang-ts`
> README, which share the parser's data model. Exact WASM function signatures
> should be re-confirmed against the installed `@cooklang/cooklang` package at
> build time. **[VERIFIED from docs; exact TS signature = ASSUMPTION]**

`@cooklang/cooklang` (MIT, WASM, the maintained successor to the **deprecated**
`@cooklang/cooklang-ts`) parses a `.cook` string into a Recipe whose shape is,
in essence:
```
Recipe {
  ingredients: { name, quantity, units }[]   // deduped recipe-level list
  cookware:    { name, quantity? }[]
  metadata:    Record<string,string>          // key: value pairs
  steps / sections: Step[]
}
Step = Token[]
Token =
  | { type: "text",       value: string }
  | { type: "ingredient", name, quantity, units }   // <-- INLINE, per step
  | { type: "cookware",   name }
  | { type: "timer",      name?, quantity, units }   // <-- named timers
```
**The `ingredient` token inside a step is the north-star.** Because the parser
returns, for each step, the ordered list of text/ingredient/timer tokens *with
the quantity attached to each ingredient token*, the cooking-mode renderer can
draw `Add [flour 200 g] and [sugar 100 g], whisk` directly from parser output —
no name-matching heuristic. This is a strict upgrade over §1.7.

### 2.2 Cooklang syntax we rely on (spec — [VERIFIED] cooklang.org/docs/spec)
- Ingredient: `@salt` (single word) or `@bacon strips{1%kg}` (multiword + qty%unit).
- Cookware: `#pot` / `#potato masher{}`.
- Timer: `~{25%minutes}` or named `~eggs{3%minutes}` — **native multi-timer**.
- Metadata: YAML front matter (`---` ... `---`) with key/value; also legacy
  `>> key: value` lines in older docs.
- Sections: `== Section ==`. Notes: `> ...`. Comments: `-- ...` / `[- ... -]`.
- Prep shorthand: `@onion{1}(peeled and chopped)`.

### 2.3 Mapping norish → `.cook`
| norish concept | Cooklang home |
|---|---|
| step text | a step line |
| section heading (`#`-prefixed step, §1.1) | `== heading ==` |
| ingredient used in a step | `@name{amount%unit}` token *in that step* |
| ingredient amount/unit (`recipe_ingredients.amount/unit`) | the `{amount%unit}` |
| canonical unit ID | the `%unit` (needs locale render on read, §5/§6) |
| servings, prep/cook/total time | metadata keys |
| nutrition (calories/fat/carbs/protein) | metadata keys (custom) OR stay norish columns |
| media (image/url/step images/videos) | metadata / custom keys OR stay norish tables |
| dual metric+US | **unresolved** — one `.cook` is one system (§ DESIGN-OPTIONS D-2) |

### 2.4 Nutrition / media / dual-units homes
Cooklang metadata is free-form `key: value`, so nutrition and a source URL fit as
custom keys (`nutrition.calories`, `source`). **But** Cooklang has no first-class
media-per-step or dual-system concept, and stuffing norish's structured columns
into metadata strings is lossy and non-idiomatic. Recommended: **keep nutrition,
media and the second measurement system in norish columns/tables; treat Cooklang
as the representation of *steps+ingredients+timers only*, and round-trip the rest
through metadata only when exporting a standalone `.cook` file.** This keeps the
upstream contribution focused (a serializer + a parser integration) rather than
trying to make Cooklang carry norish's whole domain model.

---

## 3. The serializer gap

**Confirmed gap:** there is no structured→`.cook` serializer in JS, and the spec
"does not define a canonical serialization standard" (§WebFetch of the spec). The
roadmap treats *building + contributing* one as part of Phase 27's value.

Two sub-questions:

**(a) Where does structure come from?** Either
- **AI emits Cooklang directly** — change the extraction schema/prompt so the model
  returns `.cook` text (or per-step token arrays). Pro: the model is *best placed*
  to decide which ingredient belongs in which step (it sees the prose). Con: harder
  to validate/repair than JSON; dual-system doubles output; loses the current
  strict zod schema guarantees; every provider must be good at it.
- **AI emits structured JSON (as today) → norish serializes** — keep
  `recipeExtractionSchema`, but extend it so each step carries its ingredient
  references, then a deterministic serializer emits `.cook`. Pro: keeps validation,
  repair, dual-system, and unit normalization; the serializer is pure/testable and
  *is the contributable artifact*. Con: needs the schema to gain per-step
  ingredient linkage (the model still has to produce it).

**Recommendation:** **structured→serialize** (option b), i.e. the AI emits
structured JSON that includes per-step ingredient references, and a pure norish
serializer turns that into `.cook`. Rationale: it preserves every existing
guarantee (zod validation, `parse-ingredient`, `normalizeUnit`, dual-system), it
is the piece that is genuinely missing and genuinely contributable upstream (a
`toCooklang(structured)` function), and it is deterministic/unit-testable — which
matters for a PR that must convince `mikevanes`. The AI's job changes from
"emit two arrays of strings" to "emit steps whose tokens name their ingredients"
— a prompt+schema change, not an architecture change.

The serializer must reuse norish's `formatIngredientLinkToken`-style logic
(`ingredient-links.ts` already emits `@name{amount}` tokens) and `formatUnit` so
the `%unit` is spec-clean.

---

## 4. Migration strategy for existing recipes (DB at 41 → 0041)

### 4.1 Can existing recipes auto-convert with inline amounts? — BEST-EFFORT
Because step↔ingredient linkage does not exist (§0/§1), converting a live recipe
to Cooklang-with-inline-amounts requires *inferring* which ingredient is used in
which step. Options for the inference:
- **Name-match against step text** — reuse the existing `applyIngredientLinkMarkup`
  matcher (§1.7). Deterministic, no AI, but lossy: misses unmentioned/renamed
  ingredients, ambiguous on duplicates, and leaves "leftover" ingredients that
  no step references. Good enough to *seed* a `.cook`, not to trust blindly.
- **AI re-linking pass** — feed the flat step list + flat ingredient list to the
  model and ask it to produce token-linked steps. Higher quality, but costs tokens
  per recipe and is non-deterministic; needs the AI provider enabled.

Neither is lossless. Therefore existing-recipe conversion is **best-effort, not
guaranteed** — this is an inherent property of the source data, and a key point
to raise with the maintainer (§6).

### 4.2 Recommended safe path — DUAL-STORE, parse-on-read, backfill best-effort
1. **Additive, reversible schema.** Add a nullable `cook_source` (text) home for
   the `.cook` representation *without deleting the existing `steps`/
   `recipe_ingredients` tables*. Simplest: a nullable `recipes.cook_source`
   column (one `.cook` per system, or one column per system — see D-2). Existing
   readers keep working; the original structured data remains the source of truth
   until a recipe is confidently migrated.
2. **New/edited recipes** get `cook_source` written by the serializer (§3);
   `steps`/`recipe_ingredients` continue to be derived/kept in sync for
   backward-compatible readers, shopping-list (`groceries.recipe_ingredient_id`
   FKs `recipe_ingredients` — must not break), search, etc.
3. **Existing recipes** are backfilled lazily/best-effort (§4.1) into
   `cook_source`; cooking mode prefers `cook_source` when present and confidence
   is high, else falls back to today's `SmartInstruction` heuristic (§1.7) — which
   already produces the same *visual* result, so there is no UX regression for
   un-migrated recipes.
4. **Reversibility** (success criterion 5): because the original tables stay, the
   change is a superset; dropping `cook_source` reverts cleanly.

### 4.3 DB migration — YES, needed. `0041_*`.
Next migration file is **`0041_*`** (41 migrations applied, `0000`–`0040`). It is
purely additive: add the `.cook` storage column(s) (nullable) + any dual-system
variant. No destructive change; no touch to `groceries`/FK graph. A DB migration
IS required (you cannot store `.cook` without a column) but it is low-risk and
reversible. **Do NOT write it until #470 settles the storage shape** (single vs
per-system column; whether `steps`/`recipe_ingredients` stay authoritative).

### 4.4 Constraints the migration must respect (from STATE.md / CLAUDE.md)
- **HOUSE-06 per-cookbook isolation** — recipe reads are cookbook-scoped via
  `buildViewPolicyCondition`; a new column changes nothing here but any new
  read/query must inherit the same policy.
- **Config-as-code** — unit config, timer keywords already server-config-driven;
  Cooklang unit rendering must reuse the existing units config, not hardcode.
- **Hoisted-linker gotcha** — `node_modules/@norish/*` are hardlinked copies;
  cross-package edits (serializer in `@norish/shared`, consumed by `@norish/api`
  + web) need a re-sync (`cp -a`) or stale builds. Relevant because the serializer
  spans packages.

---

## 5. Cooking-mode UI change (in-step amounts primary; multi-timer secondary)

Today (`cooking-step-view.tsx`): each step renders `step.text` through
`SmartInstruction` with `ingredientCandidates` (heuristic, §1.7).

**Target:** when a recipe has a trusted `.cook` representation, resolve the step
from parser tokens instead of raw text:
- Render each step by walking its token array: `text` tokens verbatim,
  `ingredient` tokens as a styled chip/inline `name + formatUnit(qty,unit)` — the
  amount comes from the token, authoritative. This is a small change to
  `resolveCookingModeSteps` / `cooking-step-view.tsx`: swap "string + candidate
  matcher" for "token list renderer." The existing `norish-ingredient:` press
  handler and ingredient-highlight styling can be reused.
- **Multi-timer (secondary):** Cooklang `timer` tokens (`~pasta{10%minutes}`) give
  named, per-step durations. The existing timer-keyword detection in
  `SmartInstruction`/`SmartMarkdownRenderer` (`useTimerKeywordsQuery`) becomes
  *parser-driven* rather than keyword-scan-driven, and a cooking-mode timer tray
  can run several named timers concurrently (pasta + sauce). This is additive on
  top of the existing timer UI.
- **No regression for un-migrated recipes:** they keep the current heuristic path.

---

## 6. Upstream #470 convergence — what MUST be settled with `mikevanes`

These are the decisions the fork **cannot make alone** if the goal is a PR that
closes #470 rather than fork divergence. Enumerated so the #470 conversation has
an agenda:

1. **Storage model upstream.** Does upstream want `.cook` as the *source of truth*
   (replacing `steps`/`recipe_ingredients`) or as an *additive representation*
   alongside the existing tables? norish's shopping list, search, and dual-system
   all read the structured tables today — a "replace" answer is a much larger,
   riskier PR. (Fork prefers additive/dual-store, §4.2.)
2. **Dual metric/US.** Cooklang is single-system. Does upstream accept
   two `.cook` blobs per recipe, a metadata-flagged single blob, or push units to
   render-time conversion? This shapes the `0041` column count.
3. **Nutrition & media in metadata.** Agree the metadata key conventions (e.g.
   `nutrition.calories`, `source`, image keys) OR agree they stay norish-side and
   Cooklang carries steps only (§2.4). Needs maintainer buy-in for round-trip.
4. **The serializer's home + shape.** Is the structured→`.cook` serializer
   contributed to `@cooklang/cooklang` (Rust/WASM) or lives as a JS package? What
   input schema does upstream want it to accept? (Determines whether norish builds
   it as a fork util or upstream artifact — the whole "contributable" premise.)
5. **Unit vocabulary reconciliation.** norish uses canonical unit IDs with locale
   alternates (§1.5); Cooklang treats `%unit` as an opaque string. Agree how
   canonical IDs map to `%unit` and back without losing locale forms.
6. **Migration expectations.** Confirm upstream accepts that existing-recipe
   conversion is **best-effort** (§4.1) — there is no lossless auto-migration
   because the source lacks step↔ingredient linkage. If upstream demands lossless,
   the scope grows (mandatory AI re-linking or manual review).
7. **Extension policy.** Cooklang has "opt-in extensions"; agree which extensions
   (if any) norish may rely on so the `.cook` stays portable.

**Blocked until #470 answers land:** the `0041` migration shape (Q1/Q2), the
serializer's contract/home (Q4), the metadata conventions (Q3/Q5), and therefore
any executable plan. What the fork CAN prototype unblocked: a spike parsing
`.cook` with `@cooklang/cooklang` in a throwaway, and a proof-of-concept
serializer against norish's `FullRecipeInsertDTO` — as *research spikes*, not
committed plans.

---

## 7. Risks, open questions, rough phasing

### Risks
- **Data-model mismatch (highest).** Adding structure (step↔ingredient) that never
  existed → conversion is best-effort; risk of user-visible wrong/missing amounts
  on migrated recipes if trusted blindly. Mitigation: confidence gate + fall back
  to today's heuristic (§4.2/§5).
- **Moving target upstream.** #470 is an empty placeholder; building before the
  design conversation guarantees rework (roadmap explicitly says don't plan yet).
- **Dual-system explosion.** Every design doubles for metric+US.
- **Shopping list / search coupling.** `groceries.recipe_ingredient_id` FKs the
  structured table; search reads `steps`/`ingredients`. `.cook` must not orphan
  these — keep structured tables authoritative (§4.2).
- **Parser API drift.** WASM package API not verified against source this session
  (Context7 down) — confirm at build time.
- **Hoisted-linker** cross-package staleness for the serializer (§4.4).

### Open questions
- Exact `@cooklang/cooklang` WASM TS surface (parse fn name, token type names) —
  verify against the installed package.
- Does `@cooklang/cooklang` expose *any* reverse/AST-to-string helper? (Docs say
  no canonical serialization; confirm the package truly lacks it before building.)
- Confidence heuristic for "trust the auto-migrated `.cook`" threshold.
- Do we store one `.cook` per system or per-recipe with metadata switch?

### Rough phasing (waves) — ONCE #470 UNBLOCKS. Indicative only.
- **W1 — Parser integration + read path.** Add `@cooklang/cooklang`, a
  `.cook`→cooking-mode-token renderer (§5), behind a flag; no writes yet.
- **W2 — Serializer + write path.** Structured→`.cook` serializer (§3, contributable),
  wired into AI + JSON-LD import; `0041` additive migration to store `cook_source`.
- **W3 — Backfill/migration of existing recipes.** Best-effort converter (§4.1) +
  confidence gate + fallback; keep structured tables in sync.
- **W4 — Multi-timer cooking mode** (secondary) from Cooklang timer tokens (§5).
- **W5 — Upstream PR** closing #470: serializer + integration, per agreed shape.

Estimated ~4–5 plans/waves. Size is dominated by the serializer + migration/
backfill, not the parser read path (which the existing heuristic layer de-risks).

---

## Appendix — evidence index (files read this session)
- Schema: `packages/db-schema/src/schema/{steps,recipe-ingredients,ingredients,recipes,step-images,relations}.ts`
- Contracts: `packages/shared/src/contracts/zod/{recipe,recipe-ingredients,steps}.ts`
- Cooking UI: `apps/web/app/(app)/recipes/[id]/components/cookingmode/{cooking-step-view,cooking-mode-steps,types}.tsx|ts`
- Inline-ingredient prior art: `packages/shared-react/src/text/ingredient-links.ts`;
  `apps/web/components/recipe/smart-instruction.tsx`
- Import/extract: `packages/api/src/parser/{jsonld,normalize}.ts`;
  `packages/api/src/ai/prompts/{builder.ts,recipe-extraction.txt}`;
  `packages/api/src/ai/schemas/recipe.schema.ts`; `packages/shared-server/src/ai/unit-converter.ts`
- Units: `packages/shared/src/lib/unit-localization.ts`; `packages/shared/package.json` (`parse-ingredient@2.2.0`)
- Migrations: `packages/db/src/migrations/` (41 files, `0000`–`0040`) + `meta/_journal.json` (41 entries)
- Roadmap/STATE: `.planning/ROADMAP.md` (Phase 27 block), `.planning/STATE.md`
- External: cooklang.org/docs/spec; cooklang.org parser integration guide;
  `cooklang-ts` README (deprecated → `@cooklang/cooklang`). **Context7 unavailable (OAuth).**
</content>
</invoke>
