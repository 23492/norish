# Phase 27 (COOK-01) — Improved extraction prompt (per-step ingredient linkage)

> Goal (D-3 + D-6): make norish's built-in extraction emit structured JSON where
> **each step declares the ingredient refs + amounts it uses**, so `structuredToCooklang`
> (the `spike/` serializer) produces well-linked `.cook` for every new import — and
> the same instruction drives the AI re-linking backfill of existing recipes.
>
> This is a prompt + schema fragment, NOT wired in this spike.

---

## ⚠️ REVISION (2026-07-24) — hardened & validated against LIVE DeepSeek

The fragment below was the FIRST DRAFT. It has since been built into a skill-creator
skill and **run end-to-end against live `deepseek-v4-pro`** (Camoufox-fallback scrape
→ prompt → DeepSeek → `structuredToCooklang` → real WASM reparse). The live runs
exposed two failure modes a careful stand-in never showed, so the canonical prompt
now lives in **`extraction-skill/assets/linkage-fragment.txt`** and adds:

1. **Name = a word in the step's own text (the anchor rule).** Live DeepSeek first
   used the whole ingredient-list line as `name` (`"100g plain flour"`,
   `"oil or melted butter, for frying"`); those never appear in the prose, so nothing
   anchored and every token was appended. This is now the strongest rule in the
   fragment (rule A) with a COMMON MISTAKES block.
2. **A step lists only what its own text names — never carry ingredients forward.**
   DeepSeek dumped every ingredient-so-far into each later step (the "serve" step
   relisted all 11). Rule B forbids this explicitly.
   Two smaller rules were added after later live runs: **units as written (do not
   convert `2 tbsp`→`30 ml`)** and **`# Heading` steps for recipe sub-sections**.

**Result after 3 iterations:** live DeepSeek scores **6/6 fixtures, 38/38 assertions**
on the failure-mode eval suite, and both real E2E targets (Dutch LeukeRecepten
bolognese + BBC pancakes) round-trip to a fully-anchored `.cook` (0 appended,
confidence = trusted). Harness + evals: `extraction-skill/` + `e2e-harness/`.
One serializer requirement confirmed: parse the `.cook` **without** a scale arg or the
canonical `%unit` IDs (D-8) get normalized (`gram`→`g`).

---

## Where it slots in

Three prompt builders exist (roadmap Phase 7 note; confirmed in
`packages/api/src/ai/prompts/builder.ts`):
`buildRecipeExtractionPrompt` (HTML/text), `buildImageExtractionPrompt` (OCR),
`buildVideoExtractionPrompt` (transcript). All three load the shared base
`packages/api/src/ai/prompts/recipe-extraction.txt` via `loadPrompt("recipe-extraction")`
and append fragments (allergies, auto-tagging, language).

The linkage instruction is a **new shared fragment** appended by all three builders
(exactly like `buildAllergyInstruction` / `buildLanguageInstruction`), so it lands
once for HTML, image and video. Add it as `parts.push(linkageInstruction)` in
`buildRecipeExtractionPrompt` and the string-concat equivalents in the other two.

The **schema change** is in `packages/api/src/ai/schemas/recipe.schema.ts`:
`recipeExtractionSchema.recipeInstructions.{metric,us}` becomes an array of step
objects instead of an array of strings:

```ts
// BEFORE: z.array(z.string())
// AFTER:
z.array(
  z.object({
    text: z.string().describe("The full instruction text for this step, in prose."),
    ingredients: z
      .array(
        z.object({
          name: z.string().describe("Ingredient name EXACTLY as it appears in the recipeIngredient list"),
          amount: z.union([z.number(), z.string(), z.null()]).describe("Quantity used IN THIS STEP; null if 'to taste' / unspecified"),
          unit: z.string().nullable().describe("Unit for this step's amount; null if none"),
        })
      )
      .describe("Ingredients used in THIS step, with the amount used here"),
    timers: z
      .array(z.object({ name: z.string().nullable(), amount: z.number(), unit: z.string() }))
      .default([])
      .describe("Named/anonymous timers mentioned in this step"),
  })
)
```

The flat `recipeIngredient.{metric,us}` list **stays** (it remains the source of
truth for the structured tables and shopping list, D-1); the per-step `ingredients`
are *references into it* plus the per-step amount. Keeping both means the serializer,
`normalizeUnit`, dual-system and repair all keep working (D-3).

---

## The prompt fragment (append to all three builders)

```
STEP↔INGREDIENT LINKING (for "recipeInstructions"):
- Every ingredient in "recipeIngredient" MUST be used in at least one step. Every
  step lists, in its "ingredients" array, the ingredients it uses.
- Attach each ingredient's amount to the step where it is FIRST added to the dish.
  If an ingredient is used across several steps, put its full amount on that first
  step and reference it (name only, amount null) in later steps — never split an
  amount you cannot justify from the text, and never double-count an amount.
- Use the EXACT ingredient name from "recipeIngredient" as the "name" so it can be
  matched back to the structured list. Do not invent ingredients not in that list.
- If the recipe says "salt to taste" / "a pinch" / no amount, set amount = null and
  unit = null — do NOT fabricate a quantity.
- Garnishes and "for serving" ingredients: attach them to the serving/finishing step.
- Timers: when a step says "simmer for 30 minutes" / "bake 12 min", emit a timer
  { amount, unit }; name it when the text names it (e.g. "the pasta timer").
- Keep the step "text" as natural prose — do NOT rewrite it into token syntax; the
  linking is carried in the structured "ingredients"/"timers" arrays, and norish
  serializes the .cook itself.
```

### Rationale for each rule (mapped to observed failure modes)
- *"first step where added" + "full amount on first, name-only later"* — directly
  addresses the **multi-step ingredient** ambiguity (onion/garlic, coconut milk in
  the experiment). It gives the model a deterministic convention so re-runs are
  stable and amounts are never double-counted.
- *"exact name from recipeIngredient"* — lets the serializer's name-matcher anchor
  the token in the prose and lets the structured list stay the source of truth
  (avoids the `lime` vs `lime juice` drift becoming a NEW ingredient).
- *"amount = null for to-taste"* — prevents fabrication (the base prompt already
  forbids fabrication) and produces a clean bare `@salt` token.
- *"garnishes → finishing step"* — turns the otherwise-`appended` garnish failure
  mode into an inline link.
- *"don't rewrite text into tokens"* — keeps prose clean and keeps token emission
  deterministic/in-norish (D-3); the model is bad at emitting spec-perfect
  Cooklang but good at *naming which ingredient a step uses*.

---

## Backfill reuse
The SAME instruction, fed the existing flat `steps[]` + `recipe_ingredients[]` of a
stored recipe (instead of raw webpage text), is the D-6 AI re-linking pass. Output
→ `structuredToCooklang` → `cook_source`, gated by the confidence signals in
`27-EXPERIMENT.md` (fall back to `SmartInstruction` when low-confidence).
