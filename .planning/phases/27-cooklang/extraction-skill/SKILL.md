---
name: cooklang-recipe-extraction
description: >
  Extract a recipe from scraped webpage text (or a transcript / images) into
  structured JSON where EACH cooking step declares the ingredients it uses WITH the
  amount used in that step, so norish can serialize it to well-linked Cooklang
  (`.cook`). Use this whenever you are extracting or re-linking a recipe for norish
  and need per-step ingredient↔amount linkage — i.e. any time the output must drive
  the Cooklang cooking view, the shopping list, or the D-6 AI re-linking backfill.
  Triggers on: recipe extraction, recipe import, "convert this recipe to Cooklang",
  per-step ingredients, ingredient linking, step timers, `structuredToCooklang`.
---

# Cooklang recipe extraction (per-step ingredient linkage)

## What this skill is for

norish extracts recipes with a DeepSeek model and then serializes the result to
Cooklang (`.cook`), which is the single source of truth (Phase 27 decisions). For the
`.cook` to be useful — amounts on the right step in the cooking view, a correct
shopping list, multi-timer support — the model's JSON must say, for every step, WHICH
ingredients that step uses and HOW MUCH of each is used there. This skill is the
prompt + schema + eval harness that makes that linkage reliable.

The model does NOT write Cooklang syntax. It emits structured JSON; a deterministic
norish serializer (`structuredToCooklang`) turns the linkage into `@ingredient{qty%unit}`
and `~{qty%unit}` tokens by finding each ingredient's name inside the step's prose.
That split is deliberate: models are good at *judging which step uses which
ingredient* and bad at emitting spec-perfect token syntax.

## The output shape

`recipeInstructions.{metric,us}` is an array of step objects (see
`references/schema.md` for the exact zod, which mirrors the real
`packages/api/src/ai/schemas/recipe.schema.ts` with this one change):

```jsonc
{
  "text": "Fry the onion and garlic, then add the minced beef.",
  "ingredients": [
    { "name": "onion", "amount": null, "unit": null },      // named again, amount already spent
    { "name": "garlic", "amount": null, "unit": null },
    { "name": "minced beef", "amount": 500, "unit": "gram" } // first add -> amount here
  ],
  "timers": [{ "name": null, "amount": 30, "unit": "minutes" }]
}
```

The flat `recipeIngredient.{metric,us}` string list stays as the source of truth for
the structured tables; per-step `ingredients` are references into it plus the amount
used in that step.

## How to use it

The linking instructions are in `assets/linkage-fragment.txt`. In the real pipeline
this is appended by all three prompt builders (`buildRecipeExtraction/Image/Video`
Prompt) exactly like the allergy/language fragments — one `parts.push(fragment)`.
Feed the model: base extraction prompt + this fragment + the scraped content, with
`Output.object({ schema })` set to the per-step schema.

The whole thing is exercised end-to-end by the harness in
`../e2e-harness` (scrape → prompt → DeepSeek/stand-in → serialize → reparse → verify).

## The linkage strategy (why it is written the way it is)

The failure modes are catalogued in `references/failure-modes.md` (distilled from
`27-EXPERIMENT.md`). The fragment is built around the two that actually break real
model output, learned by running it against live DeepSeek:

1. **Name must be a word in the step's own text.** Live DeepSeek first used the whole
   ingredient-list line as the name (`"100g plain flour"`, `"oil or melted butter,
   for frying"`); those strings are not in the prose, so the serializer could not
   anchor them and appended everything. The fix is the strongest rule in the
   fragment: `name` is the short core noun as it appears in the sentence.
2. **A step lists only what its own text names; never carry ingredients forward.**
   Live DeepSeek dumped every ingredient-so-far into each later step (the "serve"
   step relisted all 11). The fragment forbids this explicitly and with a COMMON
   MISTAKES block.

The finer conventions handle the rest: amount on FIRST add + name-only later (no
double counting / no invented splits), `null` amount for "to taste" / "for frying",
garnishes anchored in the serving step, timers per step. See the worked example at
the bottom of the fragment — a concrete example moved the model more than any rule.

## Confidence gate (D-7)

Not every recipe linkes cleanly. `references/failure-modes.md` lists cheap,
deterministic signals — `appended > 0`, an amount declared in >1 step (double count),
an unreferenced ingredient (orphan), a known split-amount ingredient — that mark a
`.cook` **low-confidence** and route it to the repair queue instead of being trusted
blindly. The harness computes these; the irreducible split-amount case (coconut milk
used "a little" then "the rest") is correctly flagged, not hidden.

## Evaluating / iterating the skill (skill-creator loop)

Test scenarios live in `evals/evals.json` — one per failure mode, plus a Dutch
recipe (norish is NL-focused). They are implemented as runnable fixtures + assertions
in the harness:

```bash
cd ../e2e-harness && npm install
npm run evals            # grade the Claude stand-in extractions (no key needed)
npm run evals -- --live  # re-extract each scenario with real DeepSeek and grade
npm test                 # same assertions under vitest
```

Each scenario asserts: valid against the schema, serializes to a `.cook` that
reparses with the real `@cooklang/cooklang` WASM parser, per-step inline amounts are
correct (name-tolerant, amount+step strict), and the confidence bucket is as
expected. When you change `assets/linkage-fragment.txt`, re-run `--live`, read the
failures, and tighten the fragment — that is the loop that produced the current
version (2 iterations against live DeepSeek to reach green).
