/**
 * Step-to-ingredient linkage prompt fragment.
 *
 * This fragment asks the model to emit, per instruction step, WHICH ingredients
 * that step uses and how much of each — the per-step linkage that
 * `recipeExtractionSchema` accepts (D-27-W3-03) and that
 * `buildCookFromExtraction` serializes into a Cooklang `.cook` source.
 *
 * WHY THIS IS CODE AND NOT A `.txt` TEMPLATE (D-27-W3-01):
 * `loadPrompt("recipe-extraction")` resolves through `getPrompts()` — the server
 * config, which is seeded once from the bundled `.txt` and is thereafter editable
 * by an admin. Editing the `.txt` therefore changes NOTHING on an install whose
 * config row already exists. A linkage instruction that lives in the `.txt` is a
 * silent no-op for every existing deployment. Appending it as a fragment, exactly
 * like `buildAllergyInstruction` / `buildLanguageInstruction`, is the only way it
 * reliably reaches the model.
 *
 * WHY THE TEXT IS NOT A FIRST DRAFT: the rules below are ported from
 * `.planning/phases/27-cooklang/extraction-skill/assets/linkage-fragment.txt`, the
 * revision that scored 6/6 fixtures and 38/38 assertions against live
 * `deepseek-v4-pro` after three iterations. Each rule — including the COMMON
 * MISTAKES block and the WORKED EXAMPLE — maps to an observed live failure mode.
 * Rules A and B in particular exist because a careful stand-in model never
 * reproduced them but the real one did. Do not paraphrase, shorten or reorder
 * them without re-running that evaluation.
 *
 * The fragment is positioned BEFORE the untrusted content payload
 * (`WEBPAGE TEXT:` / `VIDEO TRANSCRIPT:` / the image instruction) in all three
 * builders, so scraped or transcribed text can never sit between the base prompt
 * and the rules that govern it (T-27-08).
 */

/**
 * Build the step-to-ingredient linkage instruction fragment.
 *
 * The fragment is constant: it describes the response SHAPE rather than anything
 * about a particular recipe, so it takes no options. It is returned as a
 * leading-newline-delimited block, matching the other fragments, so builders can
 * concatenate it directly.
 *
 * @returns A prompt fragment to append to the main extraction prompt, before the
 *   content payload.
 *
 * @example
 * ```ts
 * const parts = [basePrompt, allergyInstruction, buildLinkageInstruction()];
 * parts.push(`WEBPAGE TEXT:\n${content}`);
 * ```
 */
export function buildLinkageInstruction(): string {
  return `
STEP↔INGREDIENT LINKING (for the "recipeInstructions" steps)

Each step you emit has a "text" (natural prose) plus two structured arrays,
"ingredients" and "timers", that say which ingredient (and how much) THIS step uses.
norish turns those arrays into a Cooklang recipe by finding each ingredient's "name"
inside the step's own "text" and attaching the amount there. So the single most
important rule is: an ingredient's "name" must be a word that actually appears in
that step's sentence. If the name is not in the text, norish cannot place it and the
amount is lost. Everything below serves that goal.

SHAPE: emit each step EITHER as an object with "text", "ingredients" and "timers"
(always prefer this), OR — only when the linkage for that step genuinely cannot be
determined — as a plain string holding just the prose. A plain string is accepted and
carries no linkage; never omit or reword the step to avoid the object form.

THE TWO RULES THAT MATTER MOST — get these right and the rest follows:

A. NAME = the short core word for the ingredient, exactly as it appears in THIS
   step's text — never the whole ingredient-list line, never with the quantity or
   unit or prep words baked in. The flat "recipeIngredient" list is written like
   "100 g plain flour" or "oil or melted butter, for frying", but your step says
   "sift the flour" or "heat a little butter". Use the word from the SENTENCE:
     list "100 g plain flour"                -> name "flour"      (or "plain flour")
     list "500 gr rundergehakt"              -> name "gehakt"     (the word in the step)
     list "oil or melted butter, for frying" -> name "butter"
     list "1 klein blikje tomatenpuree"      -> name "tomatenpuree"
   Put the number in "amount" and the unit in "unit" — NOT in the name. A name with a
   digit in it is always wrong.

B. A step lists ONLY the ingredients its OWN text mentions. Do NOT carry ingredients
   forward. If step 5 does not name the onion, the onion does not appear in step 5.
   The common failure to avoid is dumping every ingredient used so far into each later
   step — that produces a wall of amount-less tokens at the end of every sentence and
   is never what a cook wants. When in doubt: is this ingredient's word in this
   sentence? If no, leave it out of this step.

Then the finer points:

1. AMOUNT goes on the step where the ingredient is FIRST added. If the same
   ingredient is genuinely named again in a later step ("fry the onion" after "chop
   the onion"), include it there too but with amount = null and unit = null — the
   amount belongs to the first add only. This keeps each amount counted exactly once
   and never split. Never repeat an ingredient's amount in two steps.

2. UNITS AS WRITTEN — use the amount and unit exactly as the source states them for
   that measurement system; do NOT convert. If the recipe says "2 tablespoons olive
   oil", emit amount 2, unit "tablespoon" — do not turn it into 30 ml. The metric
   list stays metric-as-written and the US list stays US-as-written; norish does any
   conversion later, deterministically.

3. NO AMOUNT — "salt to taste", "a pinch of", "for garnish", oil "for frying",
   "peper en zout": set amount = null and unit = null. Do not invent a quantity. A
   bare, amount-less ingredient is correct and expected. (If the source lists two
   seasonings as one item like "peper en zout", keep them as one ingredient with that
   name and null amount.)

4. COVER EVERY INGREDIENT — every ingredient in "recipeIngredient" should be used by
   at least one step, and do not invent ingredients that are not in the list. If you
   truly cannot place one, attach it to the most plausible step (its word should still
   be in that step's text). This is a hard requirement, not a preference: every single
   entry in "recipeIngredient" MUST be referenced by at least one step, so before you
   answer, walk the list and confirm each entry appears in some step's "ingredients" —
   leaving even one unreferenced makes the whole linkage unusable.

5. SECTIONS — if the recipe groups its steps under sub-headings ("For the dough",
   "Sauce", "To serve", "Bake"), emit each heading as its OWN step whose "text" is
   exactly "# Heading" (a leading "# " then the heading words), with empty
   "ingredients" and "timers". norish turns a "# X" step into a Cooklang section so
   the cooking view shows the groups. Do not put ingredients on a heading step.

6. GARNISHES / "for serving" (parmesan, fresh herbs, a squeeze of lime): attach them
   to the finishing step, and make sure that step's text names them so the amount
   anchors inline.

7. TIMERS: when a step says "simmer for 30 minutes" / "bake 12 min" / "rest 1 hour",
   add a timer { name, amount, unit } to that step. Name it only when the text names
   it (e.g. "set the pasta timer" -> name "pasta"); otherwise name null.

8. Keep "text" as natural, readable prose in the source language. Do NOT rewrite it
   into @token or ~timer syntax and do NOT delete the ingredient words from the
   sentence — norish needs them present to anchor the tokens.

COMMON MISTAKES (do not do these)
- ✗ name "100g plain flour"      ✓ name "flour", amount 100, unit "g"
- ✗ name "oil or melted butter, for frying"   ✓ name "butter", amount null, unit null
- ✗ listing onion, garlic, beef, tomatoes, salt all again in the final "serve" step
  ✓ the serve step lists only what its sentence names (e.g. the parmesan garnish)
- ✗ putting "500 g" of beef on step 2 AND step 4   ✓ amount on the first add only,
  amount null wherever it is mentioned again

WORKED EXAMPLE (metric)
recipeIngredient.metric: ["1 onion", "2 cloves garlic", "500 g minced beef",
  "400 g chopped tomatoes", "salt", "50 g parmesan"]
recipeInstructions.metric:
[
  {
    "text": "Finely chop the onion and garlic.",
    "ingredients": [
      { "name": "onion", "amount": 1, "unit": null },
      { "name": "garlic", "amount": 2, "unit": "clove" }
    ],
    "timers": []
  },
  {
    "text": "Fry the onion and garlic, then add the minced beef and brown it.",
    "ingredients": [
      { "name": "onion", "amount": null, "unit": null },
      { "name": "garlic", "amount": null, "unit": null },
      { "name": "minced beef", "amount": 500, "unit": "gram" }
    ],
    "timers": []
  },
  {
    "text": "Stir in the chopped tomatoes, season with salt and simmer for 30 minutes.",
    "ingredients": [
      { "name": "chopped tomatoes", "amount": 400, "unit": "gram" },
      { "name": "salt", "amount": null, "unit": null }
    ],
    "timers": [{ "name": null, "amount": 30, "unit": "minutes" }]
  },
  {
    "text": "Serve topped with grated parmesan.",
    "ingredients": [{ "name": "parmesan", "amount": 50, "unit": "gram" }],
    "timers": []
  }
]

Notice: every "name" is a word in its own step's text; onion and garlic carry their
amount only on the first (chop) step and are name-only afterwards; the serve step
lists ONLY parmesan — not everything used before it; salt has null amount; the timer
sits on the simmer step.
`;
}
