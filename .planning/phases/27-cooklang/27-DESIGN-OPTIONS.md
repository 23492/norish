# Phase 27 (COOK-01) — DESIGN OPTIONS (decision pick-lists)

Companion to `27-RESEARCH.md`. Each decision lists options, a recommendation, and
whether it needs upstream `mikevanes` buy-in (the #470 external blocker) or the
fork can decide alone. **Nothing here is committed; do not plan until #470 lands.**

---

## D-1 — Storage model  ⟶ NEEDS UPSTREAM
- **A. Replace** `steps`/`recipe_ingredients` with `.cook` as source of truth.
  ✗ Breaks shopping-list FK (`groceries.recipe_ingredient_id`), search, dual-system.
- **B. Additive dual-store** — add `cook_source`, keep structured tables authoritative,
  derive/sync. ✓ Reversible, no reader breakage.
- **Recommend: B.** Fork prefers it; upstream must confirm they'll accept additive.

## D-2 — Dual metric/US in a single-system format  ⟶ NEEDS UPSTREAM
- **A. Two `.cook` blobs** (one per system) → 2 columns / rows in `0041`.
- **B. One `.cook` + metadata flag**, convert at render.
- **C. One `.cook`, drop stored US**, render-time unit conversion only.
- **Recommend: A** short-term (mirrors today's parallel-row model, least behavior
  change); revisit C long-term. Shapes the `0041` column count → upstream input.

## D-3 — Who produces the structure  ⟶ FORK CAN DECIDE (prompt/schema only)
- **A. AI emits `.cook` text directly.** ✗ Harder to validate/repair; loses zod +
  unit-normalization guarantees; per-provider quality risk.
- **B. AI emits structured JSON with per-step ingredient refs → norish serializes.**
  ✓ Keeps validation/repair/dual-system/`normalizeUnit`; serializer is pure,
  testable, and the contributable artifact.
- **Recommend: B** (structured→serialize). This is the §3 recommendation.

## D-4 — Serializer home & contract  ⟶ NEEDS UPSTREAM
- **A. Contribute to `@cooklang/cooklang`** (Rust/WASM) as `toCooklang(structured)`.
- **B. Separate JS package** contributed to the Cooklang org.
- **C. Fork-local util** in `@norish/shared` (diverges — avoid).
- **Recommend: A or B**, agreed with maintainer; input schema = norish's
  `FullRecipeInsertDTO`-shaped structure. Reuse `formatIngredientLinkToken` +
  `formatUnit` internally. Avoid C — it defeats the "drive not diverge" premise.

## D-5 — Nutrition / media / URL  ⟶ NEEDS UPSTREAM (conventions only)
- **A. Into Cooklang metadata** (custom keys) — round-trips in a standalone `.cook`.
- **B. Stay norish columns/tables**; Cooklang carries steps+ingredients+timers only.
- **Recommend: B for the domain model, A only at export time.** Agree metadata key
  names with upstream so export/import round-trips.

## D-6 — Existing-recipe backfill  ⟶ NEEDS UPSTREAM (expectation-setting)
- **A. Deterministic name-match** (reuse `applyIngredientLinkMarkup`). Free, lossy.
- **B. AI re-linking pass.** Higher quality, costs tokens, non-deterministic.
- **C. Hybrid:** deterministic seed + confidence gate; AI/manual only for low-confidence.
- **Recommend: C**, and explicitly tell upstream conversion is **best-effort**
  (source lacks step↔ingredient linkage — §0). Fall back to today's heuristic
  renderer for un-migrated/low-confidence recipes → no UX regression.

## D-7 — Cooking-mode renderer  ⟶ FORK CAN DECIDE
- Swap the string+candidate-matcher path for a parser-token renderer when a trusted
  `.cook` exists; keep the existing `SmartInstruction` heuristic path as fallback.
- Multi-timer (secondary): drive concurrent named timers from Cooklang `timer`
  tokens instead of keyword-scanning.

## D-8 — Unit vocabulary reconciliation  ⟶ NEEDS UPSTREAM
- norish canonical unit IDs (+ locale alternates) vs Cooklang opaque `%unit` string.
- **Recommend:** serialize canonical ID → `%unit`; on parse, run `normalizeUnit`
  back to canonical; render with `formatUnit`. Confirm upstream is fine with
  canonical IDs appearing as the `%unit` literal.

---

### Decision dependency for the `0041` migration
The migration shape is a function of **D-1 + D-2** (and D-5 if metadata is stored).
Until those two are answered with the maintainer, the `0041` file cannot be
written. Everything else (D-3, D-7) the fork can prototype as spikes now.
</content>
