# Phase 27 (COOK-01) — RESOLVED DECISIONS

> Status: **UNBLOCKED**. Decisions taken by **Kiran, 2026-07-24**. The fork makes
> its own design calls — it has "progressed past the original", so there is **no
> upstream #470 gating** any longer. These supersede the "NEEDS UPSTREAM" flags in
> `27-DESIGN-OPTIONS.md`; that file remains as the option analysis, this file is
> the record of what was chosen. Companion evidence: `27-RESEARCH.md`,
> `27-EXPERIMENT.md`, `27-EXTRACTION-PROMPT.md`, and the working prototype under
> `spike/` (validated against the REAL `@cooklang/cooklang@0.18.7` WASM parser).

Legend for each decision: **CHOICE** — one-line **rationale**.

---

> ## ⚠️ REVERSAL — FULL-NATIVE (Kiran, 2026-07-24, this session)
> Kiran chose **FULL NATIVE Cooklang, NO bandaids**. `.cook` is the SINGLE SOURCE
> OF TRUTH; the old hand-authored `steps`/`recipe_ingredients` STOP being
> authoritative and demote to a **derived projection**; the heuristic
> `SmartInstruction`/`applyIngredientLinkMarkup` layer is **DELETED** (not a
> fallback); metric↔US becomes a **deterministic OSS converter** replacing the AI
> `unit-converter.ts`. This **supersedes D-1 B, D-2's dual-authored rows, D-6's
> heuristic fallback, and D-7's dual renderer** as recorded below. Full plan:
> **`27-PLAN.md`**. The individual entries below are annotated with their reversal.

---

## D-1 — Storage model → ~~ADDITIVE DUAL-STORE~~ → **REPLACED: `.cook` IS SOURCE OF TRUTH** (2026-07-24)
~~Add a nullable `cook_source` alongside the still-authoritative structured
tables.~~ **REVERSED to FULL-NATIVE:** `recipes.cook_source` (`.cook`) is the ONLY
authored representation; `steps`/`recipe_ingredients` demote to a **derived,
materialized projection** regenerated from the `.cook` on every write
(`deriveProjectionTx`, same transaction). *Why the reversal:* shopping-list FKs and
search still need structured rows, so those tables **persist as a projection** (a
cache with one owner, NOT authored) rather than being dropped — the FK is kept safe
by UPSERT-stable derivation on natural key `(recipe_id, system_used, ingredient_id)`
(preserves `recipe_ingredients.id` → grocery FKs survive edits). The safe
expand→migrate→contract phasing to REACH this end state is correct migration
engineering, not a bandaid.

## D-2 — Dual metric/US → ~~SINGLE `.cook` + BOTH authored rows~~ → **REPLACED: ONE native `.cook` + DETERMINISTIC conversion** (2026-07-24)
~~The `.cook` carries one system; structured rows keep BOTH metric + US as today.~~
**REVERSED:** the `.cook` carries ONE **native** system (`recipes.system_used`,
`norish.system` frontmatter); the **other system is DERIVED deterministically** by an
OSS converter at derive-time, not stored as parallel *authored* rows. The projection
still materializes both systems (for search/shopping), but from the single source, not
from an AI round-trip. *Rationale:* single source of truth; kills the AI
`unit-converter.ts` pass (cost/latency/reproducibility win).

## UNITS — **OSS CONVERTER `convert` (MIT) + USDA density glue** (NEW, 2026-07-24)
Metric↔US uses **`convert`** (npm, v7, MIT, TS-native, maintained) for all
same-dimension conversions (fully off-the-shelf). **Volume↔weight is NOT off-the-shelf**
— no maintained JS lib ships an ingredient-density dataset — so it is **converter +
a config-as-code density table** distilled from **USDA FoodData Central** (public
domain / CC0). Unknown-density ingredients are **flag-and-preserved, never fabricated**.
This REPLACES the AI `unit-converter.ts` + `unit-conversion` prompt + `conversion.schema.ts`
(all deleted). *Rationale:* deterministic beats an AI round-trip; the only lost
capability is the AI's occasional density *guess*, deliberately replaced by
flag-and-preserve.

## D-3 — Who produces the structure → **AI emits structured JSON w/ per-step refs → PURE serializer emits `.cook`**
The model returns structured JSON where each step lists its ingredient refs +
amounts; a deterministic norish serializer turns that into `.cook`. NOT
AI-writes-Cooklang-directly. *Rationale:* keeps every existing guarantee (zod
validation, repair, `parse-ingredient`, `normalizeUnit`, dual-system); the
serializer is pure and unit-testable (proven in `spike/`).

## D-4 — Serializer home → **FORK-LOCAL in `@norish/shared`**
`structuredToCooklang(...)` pure fn in `@norish/shared`, reusing
`formatIngredientLinkToken` + `formatUnit` from `@norish/shared-react`. No upstream
contribution constraint. *Rationale:* #470 no longer gates us; keeping it
fork-local removes the coordination dependency and lets the fork ship. (Prototype
vendored those helpers inline only because the spike is a standalone project.)

## D-6 — Backfill → **AI RE-LINKING PASS** (kept) → but **NO permanent fallback; review queue for the tail** (amended 2026-07-24)
Existing recipes are re-linked by an AI pass (map each ingredient to the step(s),
attach amounts) → serializer → `.cook`; new imports emit well-linked structure via
the improved extraction prompt (`27-EXTRACTION-PROMPT.md`). **AMENDED:** because the
old tables lose authority and there is **no permanent heuristic fallback**, every
recipe MUST end with a **valid best-effort `.cook`**; low-confidence recipes (by the
`27-EXPERIMENT.md` confidence signals, stored as `cook_confidence`) are **flagged
`cook_review_needed` and enter a repair queue**, NOT left on a heuristic renderer. A
one-time deterministic name-match **seed** is allowed as *migration glue*, never as a
runtime renderer. Runs against a **restored live dump (dry-run) first**, per Phase
22.4/25 discipline.

## D-7 — Renderer → ~~parser-token + `SmartInstruction` fallback~~ → **REPLACED: parser-token ONLY; heuristic DELETED** (2026-07-24)
~~Keep `SmartInstruction` heuristic as a fallback for un-migrated/low-confidence
recipes.~~ **REVERSED (NO BANDAIDS):** cooking mode + recipe detail render **only**
from parser tokens (shipped as a plain-JSON `cookTokens` projection in the DTO so
clients don't run the WASM parser). `applyIngredientLinkMarkup` /
`createIngredientLinkCandidates` / the `SmartInstruction` markup path are **deleted**
from the runtime. A **transitional** tokens-else-old-path fork is permitted ONLY
during the migration window (until the backfill reaches 100% coverage), then removed
in the contract wave — that transition is expand→contract engineering, not a
permanent dual renderer.

## D-8 — Unit vocabulary → **canonical unit ID serialized as the `%unit` literal; `normalizeUnit` on parse**
Serialize the canonical unit ID (`gram`, `tablespoon`) directly into `@x{qty%unit}`;
on parse, run `normalizeUnit` back to canonical and render with `formatUnit`.
*Rationale:* **CONFIRMED in the spike** — Cooklang treats `%unit` as an opaque
string, so canonical IDs round-trip **verbatim** with zero conversion loss.

---

## Sequencing → **STRAIGHT TO FULL COOKLANG**
No incremental heuristic-only phase. *Rationale:* go directly to the full-native end
state via safe expand→migrate→contract phasing. (Note: the heuristic layer is no
longer a *fallback* — it is deleted; a transitional tokens-else-old-path read fork
holds only until backfill hits 100%, per D-7.)

## NEW follow-on phase → **INGEST-PIPELINE OVERHAUL (post-Cooklang)**
A dedicated later phase to overhaul the extraction/import pipeline end-to-end.
*Rationale:* Phase 27 improves the extraction PROMPT and adds a serializer, but a
deeper rework of the ingest path (schema, provider orchestration, repair, dedupe)
is its own body of work — **recorded here, NOT scoped in Phase 27.** Sketched in
`ROADMAP.md` as the new phase after Phase 30.

---

## Full-build wave breakdown → SEE `27-PLAN.md` §7

The additive-spike wave table (W1 read path → W2 serializer+write → W3 backfill →
W4 timers) is **superseded by the full-native plan**, which adds a units subsystem
(W0), the derived-projection write path + FK stable-key rewire (W2), extraction
rewrite (W3), the token renderer + heuristic deletion (W4), backfill + review tool
(W5) and the contract wave (W6). ~6 waves / ~6–8 plans. The master plan
(`27-PLAN.md`) is now the authoritative wave breakdown.

**Biggest remaining risk:** the existing-recipe backfill tail **with no permanent
fallback** — every recipe must end with a renderable best-effort `.cook`; the
low-confidence tail relies on a **review queue** (D-6 amended), and un-reviewed
recipes carry best-effort amounts. Gate tuned on a restored-dump dry-run before live.

---

## CONFIRMED parser facts (`@cooklang/cooklang@0.18.7`, WASM — checked this session)
- Entry: `import { CooklangParser, getQuantityValue, getQuantityUnit } from "@cooklang/cooklang"`.
  `new CooklangParser().parse(src, scale?)` → `[CooklangRecipe, reportHtmlString]`.
  (No `default` export; the class is `CooklangParser`, not `Parser`.)
- `recipe.sections: Section[]`; `Section = { name: string|null, content: Content[] }`.
- `Content = { type: "step", value: Step }`; `Step = { items: Item[] }`.
- `Item = { type:"text", value:string } | { type:"ingredient"|"cookware"|"timer", index:number }`
  — ingredient/timer items carry an **index into `recipe.ingredients` / `recipe.timers`**,
  NOT inline data; the renderer must dereference.
- `recipe.ingredients[i] = { name, quantity: { value:{type:"number",value:{type:"regular",value:N}}, unit, scalable } }`;
  use `getQuantityValue(q)` / `getQuantityUnit(q)` to extract cleanly.
- **Steps are separated by a BLANK line (`\n\n`)** — single newlines merge into one
  step. The serializer emits `\n\n` between steps.
- `== Heading ==` = section; `~{25%minutes}` / `~name{..}` = timer; `#pot{}` = cookware.
- Metadata = YAML frontmatter (`---`); legacy `>> k: v` is deprecated (emits a warning).
