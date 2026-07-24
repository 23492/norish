# Extraction schema (the per-step change)

The only change from the live `packages/api/src/ai/schemas/recipe.schema.ts` is that
`recipeInstructions.{metric,us}` becomes an array of STEP OBJECTS instead of an array
of strings. Everything else (the flat `recipeIngredient.{metric,us}` list, nutrition,
categories, etc.) is unchanged. Full runnable zod is in
`../../e2e-harness/src/schema.ts` (zod 4.4.2 — the repo catalog pin).

```ts
const ingredientRef = z.object({
  name: z.string(),                                  // core noun as it appears in the step text
  amount: z.union([z.number(), z.string(), z.null()]), // amount used IN THIS step; null if none
  unit: z.string().nullable(),                        // unit for this step's amount; null if none
});

const timerRef = z.object({
  name: z.string().nullable(),
  amount: z.number(),
  unit: z.string(),
});

const step = z.object({
  text: z.string(),                                  // natural prose; do NOT tokenize
  ingredients: z.array(ingredientRef),               // only what THIS step's text names
  timers: z.array(timerRef).default([]),
});

// recipeInstructions.{metric,us}: z.array(step)
```

## Wiring (real pipeline)

- **Schema:** replace the two `z.array(z.string())` in
  `recipe.schema.ts` → `recipeInstructions.{metric,us}` with `z.array(step)`.
- **Prompt:** append `assets/linkage-fragment.txt` in all three builders
  (`buildRecipeExtractionPrompt` via `parts.push(...)`, and the string-concat
  equivalents in `buildImageExtractionPrompt` / `buildVideoExtractionPrompt`), right
  after the allergy / auto-tagging / language fragments.
- **Serialize:** feed the chosen system's steps to `structuredToCooklang`
  (fork-local in `@norish/shared`, D-4). Run `normalizeUnit` on each per-step unit
  first so the `.cook` carries the canonical unit ID (D-8) — the harness mirrors this
  in `evaluate.ts#normalizeUnit`.

## Unit handling (D-8)

Serialize the canonical unit ID directly into `@x{qty%unit}`. Cooklang treats `%unit`
as an opaque string, so canonical IDs (`gram`, `tablespoon`) round-trip **verbatim**
— BUT ONLY when the recipe is parsed WITHOUT a scale argument (`parse(src)`);
`parse(src, 1)` normalizes them (`gram`→`g`). The harness parses without a scale.
