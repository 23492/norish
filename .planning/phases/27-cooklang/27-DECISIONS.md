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

## D-1 — Storage model → **ADDITIVE DUAL-STORE**
Add a nullable `cook_source` (`.cook` text) alongside the existing `steps` /
`recipe_ingredients`, which **stay authoritative**. *Rationale:* shopping-list FKs
(`groceries.recipe_ingredient_id`) and search read the structured tables; a
`.cook` replacement would break them and is irreversible — additive is a superset
that reverts cleanly.

## D-2 — Dual metric/US → **SINGLE unit system inside the `.cook`**
The `.cook` carries ONE unit system (recorded in metadata `norish.system`); the
structured `recipe_ingredients` keep BOTH metric + US rows as today. *Rationale:*
Cooklang is inherently single-system; duplicating both systems into Cooklang is
non-idiomatic and lossy, and the structured tables already hold both — the `.cook`
is a per-system view, not the unit source of truth.

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

## D-6 — Backfill → **AI RE-LINKING PASS + improved built-in extraction prompt**
Existing recipes are re-linked by an AI pass (map each ingredient to the step(s)
using it, attach amounts); new imports emit well-linked structure via an improved
extraction prompt (`27-EXTRACTION-PROMPT.md`). *Rationale:* the source lacks
step↔ingredient linkage, so it must be inferred — the experiment (`27-EXPERIMENT.md`)
shows AI re-linking is good on the majority but **not lossless**, so it ships
**behind a confidence gate with fallback** (see D-7).

## D-7 — Renderer → **PARSER-TOKEN renderer when a trusted `.cook` exists; keep `SmartInstruction` heuristic as fallback**
Cooking mode walks parser tokens (`recipe.sections[].content[].value.items[]`,
dereferencing `recipe.ingredients[index]`) to draw authoritative in-step amounts
when a trusted `.cook` is present; un-migrated / low-confidence recipes keep
today's `SmartInstruction` name-matching path. *Rationale:* no UX regression, and
the confidence gate from D-6 decides which path a recipe takes.

## D-8 — Unit vocabulary → **canonical unit ID serialized as the `%unit` literal; `normalizeUnit` on parse**
Serialize the canonical unit ID (`gram`, `tablespoon`) directly into `@x{qty%unit}`;
on parse, run `normalizeUnit` back to canonical and render with `formatUnit`.
*Rationale:* **CONFIRMED in the spike** — Cooklang treats `%unit` as an opaque
string, so canonical IDs round-trip **verbatim** with zero conversion loss.

---

## Sequencing → **STRAIGHT TO FULL COOKLANG**
No incremental heuristic-only phase. *Rationale:* the "Cooklang-lite" heuristic
layer already exists (`applyIngredientLinkMarkup` / `SmartInstruction`) and serves
as the fallback; there is nothing to gain from an intermediate step.

## NEW follow-on phase → **INGEST-PIPELINE OVERHAUL (post-Cooklang)**
A dedicated later phase to overhaul the extraction/import pipeline end-to-end.
*Rationale:* Phase 27 improves the extraction PROMPT and adds a serializer, but a
deeper rework of the ingest path (schema, provider orchestration, repair, dedupe)
is its own body of work — **recorded here, NOT scoped in Phase 27.** Sketched in
`ROADMAP.md` as the new phase after Phase 30.

---

## Full-build wave breakdown (what this spike de-risked)

| Wave | Scope | De-risked by this spike |
|---|---|---|
| **W1 — Read path** | Add `@cooklang/cooklang`; parser-token cooking-mode renderer (D-7) behind a flag; no writes. | Parser API + token shape **confirmed** (below); renderer walk proven in `extractSteps`. |
| **W2 — Serializer + write path** | `structuredToCooklang` in `@norish/shared` (D-4); `0041_*` additive `cook_source` migration (D-1); wire into AI + JSON-LD import. | Serializer **built + tested** end-to-end; `%unit` round-trip (D-8) proven; step-separation gotcha found. |
| **W3 — AI backfill + improved prompt** | AI re-linking pass (D-6) + confidence gate + `27-EXTRACTION-PROMPT.md` slotted into the 3 prompt builders. | Experiment quantified hit/miss/ambiguous + named the confidence signals (`appended`, multi-step, split-amount). |
| **W4 — Multi-timer cooking mode** (secondary) | Concurrent named timers from Cooklang `timer` tokens. | Timer tokens (`~{n%unit}`) confirmed to round-trip. |

**Biggest remaining risk:** the AI re-linking accuracy on messy real recipes
(split amounts, multi-step ingredients) — mitigated by the D-7 confidence gate +
heuristic fallback, but the gate's threshold needs tuning against live data in W3.

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
