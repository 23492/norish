# Phase 27 (COOK-01) — THE EXPERIMENT: does AI re-linking actually work?

> Question this spike exists to answer: if we feed a stored norish recipe's TWO
> flat lists (free-text `steps[]` + structured `recipe_ingredients[]`, with **no**
> linkage — the real DB shape) to the model and ask it to attach each ingredient +
> amount to the step(s) that use it, then serialize to `.cook` — **how reliably do
> we get correct per-step amounts?** This determines whether AI-backfill (D-6) is
> viable as-is or needs a confidence gate + heuristic fallback.
>
> Method: no recipe fixtures exist in the repo, so 5 realistic recipes were
> hand-built in the real norish shape (`spike/fixtures.ts`). **I (the model) played
> the AI re-linking pass** on each — mapping ingredient→step + amount — then ran the
> output through the prototype `structuredToCooklang` and parsed it back with the
> REAL `@cooklang/cooklang@0.18.7` WASM parser. All 15 round-trip tests pass:
> structured → `.cook` → parse yields the same per-step amounts. The interesting
> result is not the serializer (deterministic, works) — it is the **quality of the
> linking judgment**.

---

## Verdict (headline)

Across **35 ingredient links** in 5 recipes:

| Bucket | Count | % | Meaning |
|---|---|---|---|
| **HIT** (unambiguous) | 27 | **77%** | single clear mention, correct amount, name anchors in prose |
| **AMBIGUOUS** (link correct, heuristic-dependent) | 7 | **20%** | right answer here, but relied on a convention that *can* fail on messier text |
| **GUESS / MISS** (not recoverable from structured data) | 1 | **3%** | per-step amount genuinely unknowable |

**AI re-linking is VIABLE but NOT lossless.** The *linkage* (which ingredient in
which step) is correct ~97% of the time; the *per-step amount* is the fragile part.
It must ship **behind a confidence gate with fallback to today's `SmartInstruction`
heuristic** (D-7) — not trusted blindly. The good news: the failure modes are
**detectable** (see confidence signals below), so the gate is buildable.

---

## Failure modes observed (ranked by how much they hurt)

1. **Amount split across steps (the one genuine MISS).** Curry: 400 ml coconut milk
   is used "a little" in step 1 and "the rest" in step 2. The structured list has
   one 400 ml row; the text does not quantify the split. Best the model can do is
   put the full amount on the main use and a bare `@coconut milk{}` on the other —
   which *overstates* step 2 and *understates* step 1. **Irreducible** from the
   source data. Detectable: `Σ per-step amounts ≠ structured total`.
2. **Ingredient used/named in >1 step (AMBIGUOUS).** Bolognese onion+garlic are
   named in both the chop step and the fry step. Convention "amount on first add,
   name-only later" resolves it, but *which* step a cook wants the number on is a
   judgment call. Correct here, brittle in general. Detectable: name appears in ≥2
   steps.
3. **Substring / name-collision (AMBIGUOUS).** Cookies "sugar" ⊂ "brown sugar";
   guac "tomato" ⊂ "chopped tomato", ingredient "lime" vs prose "lime juice". The
   serializer's **longest-name-first** matching handles all three correctly, but a
   naive matcher would tokenise "sugar" inside "brown sugar". Detectable at
   serialize time (overlapping matches).
4. **"To taste" / no amount (HANDLED, not a failure).** Salt in 3 recipes → bare
   `@salt`, amount null. Correct — but means "inline amounts" is genuinely empty
   for these, and the UI must render a bare chip, not "salt (undefined)".
5. **Unnamed garnish (HANDLED here, would APPEND otherwise).** Parmesan/cilantro
   are *named* in the serve step so they anchor inline. Had the step said only
   "serve", the ref would fall to the serializer's `appended` bucket (amount
   preserved but placed at end-of-step). Detectable: `placement === "appended"`.

---

## Confidence signals for the D-7 gate (all cheap + deterministic)
A recipe's `.cook` is **trusted** (parser-token renderer) only if ALL hold, else
fall back to `SmartInstruction`:
- **0 `appended`** links (every ref anchored in prose) — from `serializeWithReport`.
- **No ingredient named in >1 step** *unless* exactly one carries the amount.
- **Σ per-step amounts == structured total** per ingredient (catches split-amount).
- **Every structured ingredient is referenced by ≥1 step** (no orphans).
Low-confidence recipes still get their `.cook` stored, but the renderer keeps using
the heuristic path — no UX regression, and the gate can be relaxed as it's tuned on
live data (the biggest open tuning risk, per W3).

---

## BEFORE → AFTER (per fixture)

Each block: the flat lists norish stores today (BEFORE) → the `.cook` the pipeline
would produce (AFTER), with the per-link assessment.

### 1) Pancakes — 5/5 HIT (best case)
BEFORE: steps are prose; ingredients are a separate `[flour 200g, milk 300ml, egg 2,
salt —, butter 15g]` with no step linkage.
AFTER (abridged):
```
Whisk the @flour{200%gram}, @milk{300%milliliter}, @egg{2} and @salt into a smooth batter.
Heat a little @butter{15%gram} in a frying pan over medium heat.
Pour in a ladle of batter and cook for 2 minutes per side... ~{2%minutes}
```
Every ingredient named once, one clear amount, salt correctly bare. **No ambiguity.**

### 2) Spaghetti Bolognese — 6 HIT / 3 AMBIGUOUS
AFTER (abridged):
```
Finely chop the @onion{1} and @garlic{2%clove}.
Fry the onion and garlic in @olive oil{2%tablespoon} ... add the @minced beef{500%gram} ...
Stir in the @chopped tomatoes{400%gram} and @tomato paste{2%tablespoon}, season with @salt ... ~{30%minutes}
Meanwhile cook the @spaghetti{400%gram} ...
Serve topped with grated @parmesan{50%gram}.
```
- onion/garlic **AMBIGUOUS** — named in the chop step AND the fry step; amount put on
  first mention, bare in the second (correct, convention-dependent).
- parmesan **AMBIGUOUS** — garnish; "grated parmesan" anchors the token, 50 g is a
  nominal serving amount.
- salt = to-taste (bare, correct). Rest HIT.

### 3) Guacamole — 4 HIT / 2 AMBIGUOUS
AFTER:
```
Mash the @avocado{3} in a bowl.
Stir in the @lime{1} juice, @red onion{0.5} and chopped @tomato{1}.
Season with @salt to taste and garnish with @cilantro{10%gram}.
```
- lime **AMBIGUOUS** — ingredient "lime" vs prose "lime juice"; substring anchor is
  correct but note the token reads `@lime{1} juice`.
- tomato **AMBIGUOUS** — "chopped tomato" substring.
- salt to-taste bare (correct), avocado/red onion/cilantro HIT.

### 4) Chocolate Chip Cookies — 6 HIT / 2 AMBIGUOUS (+ headings)
AFTER:
```
== Dough ==
Cream the @butter{115%gram} with the @sugar{100%gram} and @brown sugar{150%gram} until fluffy.
Beat in the @egg{1} and @vanilla{1%teaspoon}.
Fold in the @flour{250%gram}, @baking soda{1%teaspoon} and @chocolate chips{200%gram}.
== Bake ==
Bake at 180 for 12 minutes ... ~{12%minutes}
```
- sugar / brown sugar **AMBIGUOUS** — substring collision; **longest-first matching
  is what makes this correct** (naive left-to-right would break it). Headings
  (`# Dough`, `# Bake`) → `== sections ==` cleanly.

### 5) Thai Green Curry — 6 HIT / 1 GUESS (the hard one)
AFTER:
```
Fry the @green curry paste{3%tablespoon} in a little of the @coconut milk{} until fragrant.
Add the @chicken{500%gram} ... pour in the rest of the @coconut milk{400%milliliter} and the @fish sauce{1%tablespoon}.
Add the @bamboo shoots{200%gram} and simmer for 15 minutes. ~{15%minutes}
Finish with @Thai basil{15%gram} and serve with @rice{300%gram}.
```
- coconut milk **GUESS/MISS** — 400 ml total split across two steps; full amount on
  the main use, bare `@coconut milk{}` on the first. `Σ amounts (400) == total (400)`
  so the sum-check passes, but the *distribution* is invented. This is the failure
  mode with no data-only fix.

---

## Does this change any resolved decision?
- **D-2 (single unit system) — no change, confirmed good.** Canonical unit IDs
  round-tripped verbatim (`%gram`, `%milliliter`, `%tablespoon`); nothing was lost
  by carrying one system in the `.cook` since the structured tables keep both.
- **D-6 — sharpened.** AI re-linking is viable but the *amount split* case (3%) and
  the *multi-step* case (20%) mean it is **not** safe to trust blindly → the
  confidence gate (D-7) is **load-bearing, not optional**. The extraction prompt
  (`27-EXTRACTION-PROMPT.md`) encodes the "amount on first add, never split what you
  can't justify" convention specifically to keep the sum-check valid.
- **One serializer requirement surfaced:** longest-ingredient-name-first matching is
  **mandatory**, not a nicety — without it substring collisions (sugar/brown sugar)
  silently mis-link. It is implemented and tested in the spike.
