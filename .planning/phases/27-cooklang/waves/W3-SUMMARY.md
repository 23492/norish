# Phase 27 — W3 (Extraction native + T-27-01 input limits) — SUMMARY

> Status: **CODE-COMPLETE**, gates green. Server half only.
> Scope per `27-ARCHITECTURE.md` §7 (W3) + plan `27-03-PLAN.md`.
> NO deploy, NO live stack, NO live DB, **NO migration** (DB stays at **42**), no vault change.
> `pnpm db:generate` / `db:push` / `migrate` NOT run (D-27-W2-08, D-27-W3-10).
> `pnpm docker:build` NOT run (director's job). `pnpm format` NOT run (it reformats 112
> unrelated files). The renderer is untouched: no web or mobile component, page, hook or
> renderer changed — `apps/` is entirely absent from the diff.
>
> *This file REPLACES the interim PARTIAL (2-of-5) revision written after tasks 1–2. Where
> the two disagree, this one is current; the superseded detail survives in
> [`27-03-SUMMARY.md`](../27-03-SUMMARY.md), which keeps all three executors' records.*

**Commits:** `f29254b9` (task 1 — T-27-01 caps) → `65815ec4` (task 2 — schema union) →
`ca1a06a8` (interim summary) → `527a852d` (task 3 — linkage fragment) → `49f03139`
(task 4 — the switch-on) → `0c8562d8` (T3/T4 summary) → `f7bcecb8` (**the T-27-01
root-cause fix — escaping at the serializer**) → `be72cc9b` (task 5 — the queue-side
isolation suite). Base `faa13d8e`; measurement baseline `f4420104`. **Nothing pushed.**

**Three executors and one independent adversarial verifier wrote this wave**, in that
order: tasks 1–2 → tasks 3–4 → the verifier's FAIL on the tenth cap → the root-cause fix →
task 5.

**W3 IS THE WAVE THAT SWITCHES THE FEATURE ON.** A newly AI-extracted recipe can now have a
non-NULL `recipes.cook_source` — the first time that is true in this codebase. Everything
else is byte-identical: a string-shaped model response, a JSON-LD import, the python
scraper, structured paste, a Mealie archive and the manual editor all pass **no** `cook`
argument and behave exactly as before (D-27-W3-08).

---

## What shipped

### 1. `@norish/shared-server/cooklang/limits` — the T-27-01 caps (task 1)

**NINE caps, at exactly the values the plan specified. None was weakened, raised, relaxed
or removed:**

```ts
maxCookSourceBytes:        65_536   // UTF-8 BYTES, not code units
maxSteps:                     200
maxStepTextChars:           4_000
maxIngredientRefsPerStep:      60
maxTotalIngredientRefs:       600
maxTimersPerStep:              10
maxRefNameChars:              200
maxUnitChars:                  40
maxRecipeNameChars:           500
```

**A TENTH cap was added mid-wave and then DELETED** — `maxCookMalformedTokens: 8`, with
`countMalformedCookTokens`. It was the first executor's answer to a real finding (the caps
alone do not bound parse *time*); an independent verifier refuted it with working repros;
the root cause was then fixed at the serializer. The full story is below — it is the central
lesson of the wave and the thing a verifier should read first. Both symbols are gone from
the tree; only explanatory comments remain.

**Enforced at the two, and only two, doors to the WASM parser**, never at a call site:

- `buildCookPayload` — `checkStructuredRecipeLimits` **before** `structuredToCooklang`,
  `checkCookSourceLimits` **before** the parse, and `findCookSourceDefect` third.
  Breach ⇒ `null` + an **error**-level log `{ module, reason, limit, measured, allowed,
  stepCount, ingredientCount }`.
- `parseCookSource` — `checkCookSourceLimits` as its **first statement**, before the parser
  singleton is touched, plus `findCookSourceDefect`. Breach ⇒ `null` + a **warn** log. This
  is the belt to `buildCookPayload`'s braces: W2's read path (`withCookTokens`) also calls
  it, so a `cook_source` that somehow grew past a cap in the database can never reach the
  parser either.

**REJECT, never truncate.** A truncated `.cook` still parses cleanly and would store a
source that silently omits steps, breaking the invariant W4's renderer and W6's `0043` stand
on. Rejecting costs the user nothing: no `cook`, legacy projection, import succeeds.

### 2. `recipeExtractionSchema` accepts a step OBJECT **or** a plain STRING (task 2)

`recipeInstructions.{metric,us}` is now `z.array(z.union([extractionStepSchema, z.string()]))`,
**object branch first** (D-27-W3-03), `ingredients`/`timers` carrying `.default([])`, top
level still `.strict()`. `coerceExtractionSteps` is **total and never throws**.

This is the R1 mitigation and it was the wave's largest risk: `Output.object` validates the
model's response, so a mandatory step object would turn any non-compliant model into a
**total import failure** on a fork where the provider and model are user-configurable.
Proven defused — all-strings, all-objects and MIXED arrays all parse,
`validateExtractionOutput`'s counts are identical across all three, and the all-strings DTO
is deep-equal to the pre-change output. **No upper-bound constraint anywhere in the schema**
(T-27-01b): a cap there would fail the whole import, whereas a cap at the parser door costs
only the `.cook`.

### 3. `buildLinkageInstruction` — the prompt fragment, as CODE (task 3, D-27-W3-01)

`packages/api/src/ai/prompts/fragments/linkage.ts`, appended by all three builders
(`buildRecipeExtractionPrompt`, `buildImageExtractionPrompt`, `buildVideoExtractionPrompt`)
exactly like `buildAllergyInstruction` / `buildLanguageInstruction`.

**Neither `recipe-extraction.txt` was edited** — and the two `.txt` paths are hardlinked in
this working tree, so an accidental edit would have been doubly invisible. This matters
because `loadPrompt` resolves through **server config**, seeded once from the `.txt`: a
`.txt` edit is a silent NO-OP on any existing install, including Kiran's. **The no-op trap
is proven closed** by one test per builder asserting the fragment is present *while
`loadPrompt` is mocked to return an unrelated base prompt*.

Text ported in substance verbatim from the live-validated
`extraction-skill/assets/linkage-fragment.txt` (6/6 fixtures, 38/38 assertions against real
`deepseek-v4-pro`), including the COMMON MISTAKES block and the WORKED EXAMPLE; thirteen
named assertions, one per rule. Two additions and only two: the object-or-string SHAPE
sentence, and rule 4 upgraded to a hard full-coverage requirement. The fragment sits AFTER
the base prompt and BEFORE the untrusted content payload in all three builders (asserted),
so scraped text never sits between the base prompt and its rules (T-27-08).

### 4. `buildCookFromExtraction` + the `ExtractedRecipe` channel (task 4 — the switch-on)

`buildCookFromExtraction(output, normalized, units)` in the extraction normalizer is the
**only new minting call site**, and it reaches the parser only through `buildCookPayload`.
It picks the NATIVE system's steps and flat list (D-2), then **refuses in four ways, each
costing the user nothing**:

| # | Refusal | Log level | `reason` |
|---|---|---|---|
| 1 | no step carries linkage (a string-shaped extraction) | **debug** | `no-step-linkage` |
| 2 | a flat ingredient no step references (D-27-W3-04) | **error** | `incomplete-ingredient-coverage` |
| 3 | a size-cap breach, decided inside `buildCookPayload` | **error** | `input-too-large` |
| 4 | output that does not parse with an EMPTY report | **error** | `did-not-parse-cleanly` |

Every log carries **counts only** — asserted by scanning the serialized logger payload for
the fixture's recipe name, step prose and each missing ingredient name (T-27-05).

**The coverage gate (D-27-W3-04) is what keeps this wave from deleting user data.** With a
`cook` argument, `deriveProjectionTx` OWNS `recipe_ingredients` and builds them from the
per-step refs; a model that links 8 of 11 ingredients would silently drop 3 from the recipe
and from everything the shopping list can add. Proven: the 8-of-11 case yields
`cook === null`, **11** ingredient rows and `cook_source IS NULL`; the 11-of-11 sibling
mints. The matcher is loose in exactly two directions — the ref appears in the flat line as
a whole-word run (`"100 g plain flour"` ⊇ `"flour"`), and the ref STARTS WITH the flat entry
(`"salt to taste"` covers `"salt"`) — and the second is a **prefix** rule, not a substring
rule, because `"brown sugar"` must NOT cover `"sugar"`.

`ExtractedRecipe { recipe, cook }` carries the payload from the three AI extractors, through
the whole video-processor chain, into `ParseRecipeResult` / `QueueParseRecipeResult` and on
to `createRecipeWithRefs(..., cook ?? undefined)` in `recipe-import`, `image-import` and
`paste-import`. It travels **alongside** the DTO, never inside it, so a `.cook` is one
`.extend()` further from ever being client-supplied (D-27-W3-02). `CookPayload` is a named
export on `@norish/shared-server/cooklang/build-payload`, which is how `@norish/queue` names
it without importing `@norish/api`.

Repository (`packages/db/src/repositories/recipes.ts`): **D-27-W3-05** — the `cook` branch
writes the opposite system's authored step prose before `deriveProjectionTx` runs, so the
metric/US toggle does not degrade into an AI conversion call on every new import;
**D-27-W3-06** — `updateData.cookSource = cook ? cook.cookSource : null`, so an ordinary
no-`cook` editor save NULLs a stale `.cook` rather than leaving one that describes the
pre-edit recipe. **No fourth dedup rule** was introduced.

### 5. Isolation at the write and emit end (task 5)

`packages/queue/__tests__/recipe-import/cook-source-isolation.test.ts` — **33 tests**,
driving the REAL (module-private) `processImportJob` against the REAL
`resolveHouseholdRealtimeScope` / `resolveRecipeRealtimeScope` / `emitByPolicy`, with a
`.cook` minted by the REAL `buildCookPayload` (real serializer, real WASM parser) and the
REAL `RecipeDashboardSchema`. Only the boundary's three data sources are fixtures. Cases:
cross-cookbook write, cross-cookbook emit, the dedup-hit emit, the PERSONAL
(`household_id IS NULL`) import, the `userId: null` orphan branch, the `imported` realtime
payload and the list DTO — **each with a `view: "everyone"` sibling** (AGENTS.md). Full case
table in `27-03-SUMMARY.md`'s Task 5 section.

**No real leak was found.** The suite is proven non-vacuous by weakening W3-W3 (below) and
by a harness self-check asserting the mint really happened.

---

## THE T-27-01 STORY, END TO END — the wave's central lesson

### Act 1 — the plan's assumption

Nine size caps would bound what reaches the parser, and a 12-input hostile corpus sized AT
the cap would then each parse in under 2 000 ms.

### Act 2 — measurement refuted it

A size cap bounds how much the parser READS; it does not bound how long it TAKES.
`@cooklang/cooklang@0.18.7` emits a diagnostic per malformed token and **each diagnostic
quotes the entire LINE the token sits on**, so report construction costs O(malformed tokens
× line length) and a multi-megabyte string crosses the WASM boundary. Measured **inside**
the planned 64 KiB cap: 18 387 ms / ~250 MB for tiled `########`; 17 462 ms for a repeated
`~~ `; **4 553 ms for a 4 KiB source** of `#`. Worse, the worst case is *non-monotonic* in
the cap, so no byte cap is both safe and large enough for a real recipe. The parser has no
option to suppress the report (`parse`, `parse_full`, `parse_render`, `parse_ast`,
`parse_events` all construct it), and timing is memory-state dependent (the same input:
15 ms on a fresh parser, 16 786 ms on one with a grown heap).

### Act 3 — the tenth cap, and why it looked right

`maxCookMalformedTokens: 8` + `countMalformedCookTokens`: count every `@`/`#`/`~` not
followed by a name character or a same-line `{…}`, refuse above 8. It brought the worst
surviving input from 18 811 ms to 622 ms, and it rested on a true premise — norish authors
every `.cook` it stores and its serializer emitted zero malformed tokens on all five
fixtures.

### Act 4 — an independent verifier FAILED it, with repros

| refutation | measured |
|---|---|
| **(a) no time bound.** 16 step texts of 3 996 chars (under `maxStepTextChars`) of `@a{1%} `, 63 966 bytes. Every brace closes, so the counter scored **0 malformed** and both gates returned `null`. | **11 118 ms**, a **150 MB** diagnostic report |
| **(b) wrong refusals.** A 536-byte, 9-step `Grandma's Pot Roast` in ordinary US shorthand ("Preheat the oven @ 325", "a 3 # chuck roast", "reduce ~ 10 minutes") scored **12 > 8 → REFUSED**. | the real parser handles it in **13 ms with an EMPTY report** |

A regex that tries to predict a parser's grammar is necessarily both **incomplete** and
**over-broad**. Predicting the parser was the bandaid.

### Act 5 — the root cause, and the fix (`f7bcecb8`)

**`.cook` is a syntax-bearing format and `@ # ~ { } % = > -` are its metacharacters.**
`serialize.ts` emitted step prose **verbatim** (`let text = step.text`), so untrusted,
model-shaped text was being **injected** into that syntax — structurally identical to SQL or
HTML injection. Everything downstream followed from that.

1. **Escape by construction.** `escapeCookText` backslash-escapes every metacharacter in
   every piece of text norish did not author as a token: step prose, heading text, ingredient
   and timer **names**, **amounts** and **units**. `\X` is a *general* escape in this parser —
   verified in prose, in a heading, in a token name and inside a `{amount%unit}` body — so the
   escaping is **losslessly reversible**. `sanitizeTokenName`'s old *strip* of `@{}~#%` is
   gone: stripping silently rewrote the name the user typed and, because the token replaces
   that name in the prose, the step they read. `serializeStepLine` was restructured from one
   mutable string into a sequence of `prose` / `token` fragments, because the two halves need
   opposite treatment — which also fixed a latent corruption where a ref named `gram` could
   match the `%gram}` of an already-emitted token.
2. **`extensions = 0`** on the parser singleton. norish writes only CORE Cooklang, so nothing
   is lost — and it buys round-trip fidelity: with the default mask the parser lexed **prose
   numbers** into `inlineQuantity` items and re-formatted them, so `Bake at 180°C` came back
   as `Bake at 180 °C` and `Add 1.50 kg` as `Add 1.5 kg`. The W1 read model was silently
   rewriting text the user typed, and W4 renders from that read model.
3. **Frontmatter is quoted, and quoting is decided by the KEY.** Metadata is YAML, not
   Cooklang. Two defects closed: a value carrying a **newline** (a model-supplied recipe name)
   broke out of the frontmatter block and could inject arbitrary `.cook` body; and deciding
   numeric-ness from the *value* meant a recipe literally titled `1.50` emitted `title: 1.50`
   and the parser reported `Unsupported value for key: 'title'`. Only `servings` is
   numeric-typed, so only `servings` is emitted raw.
4. **`findCookSourceDefect` replaced the tenth cap** — an **output-integrity assertion, not
   an input heuristic**. A strict, single-pass, no-backtracking recognizer for the
   serializer's OWN output grammar (frontmatter lines, `== heading ==`, and an alternation of
   escaped prose and well-formed `@`/`#`/`~` tokens), enforced inside `buildCookPayload`
   (error level — a failure means the *serializer* regressed) and inside `parseCookSource`
   (warn). Still the same two doors. **No third door.**

**The time bound now comes from a checked precondition, not from a signature:** a source
that passes both gates is at most 64 KiB of *provably serializer-shaped* Cooklang, and
serializer-shaped Cooklang has **zero** malformed tokens, hence zero diagnostics, hence none
of the O(malformed × line length) work that is the only reason the parser is ever slow.

**Evidence.** `round-trip-fidelity.test.ts` (45 tests, real serializer + real WASM parser):
27 named byte-identical cases; an **exhaustive sweep** of all 32 ASCII punctuation characters
in 9 construct-starting positions; every **adjacent pair** of the 10 metacharacters (100
combinations); a **soundness sweep** putting each of 40 hostile strings into step prose, an
ingredient name, an amount, a unit, a timer, a heading and the recipe name and asserting no
refusal. Two normalizations are asserted rather than hidden (CR/LF in prose folds to a space
— a newline is *structural* injection, not a corrupt character; an unpaired UTF-16 surrogate
becomes U+FFFD crossing into UTF-8 WASM).

**Hostile-corpus timings**, 25 entries, each asserting refusal-or-parse, a 0-invocation
parser spy where refused, and an explicit elapsed-time check:

| family | now | before |
|---|---|---|
| the verifier's exact bypass (16 × 3 996 of `@a{1%}`) | **refused in 1.3 ms** | 11 118 ms / 150 MB |
| `~10 minutes` in a 32 KiB line (the WASM-trap class) | refused, 7.4 ms | `RuntimeError: unreachable` |
| dense `@` / `#` / `~` / `%`, `@a{`, `@a{@b{@c{`, sigil soup, `>> a: b` | all refused, ≤ 4.2 ms | 4 s – 35 s |
| **worst ACCEPTED shape** (`@a{1%g} ` × 8 192) | **648.8 ms** | — |
| accepted: `#a ` × 21 845 · `~{1%min} ` × 7 281 · 64 KiB escaped prose · a 60 000-byte token · astral plane · NUL · lone surrogates | ≤ 528 ms | — |

**Worst timing across all families: 648.8 ms — a 3.1× margin under the 2 000 ms budget**,
satisfied by a checked precondition rather than by a signature. **The verifier's pot roast
now earns a `cook_source`** (488 bytes, no defect, 9 token steps): its `.cook` reads
`Preheat the oven \@ 325 degrees.` and renders back as `Preheat the oven @ 325 degrees.`

**The generalisable lesson, in one line: do not predict a parser — constrain what you hand
it, and assert your own output.**

---

## D-27-W3-07 — MEASURED, and a W5 PREREQUISITE for the director

The decision itself (**keep dual-system extraction; defer single-system extraction to W5**)
is **CONFIRMED by measurement, not assumed**. Measured with the real serializer, the real
WASM parser and the real `computeCookProjection` over the five committed fixtures, each
given an AI-style US flat list reusing the metric refs' ingredient words so the comparison
isolates units rather than naming.

**HARD assertion, passing for all five: same ingredient names, same count. 35 ingredients
across 5 recipes, 35 derived. NO ingredient is lost.**

### VERDICT: the derived US output IS worse than the AI's. **18 of 35 ingredients differ.**

| fixture | ingredients | differences | detail (`AI` → `derived`) |
|---|---:|---:|---|
| pancakes | 5 | 3 | flour `1.667 cup` → `7.054792 ounce`; milk `1.25 cup` → `1.268026 cup`; butter `1 tablespoon` → `0.529109 ounce` |
| bolognese | 9 | 4 | minced beef `1 pound` → `1.102311 pound`; chopped tomatoes `14 ounce` → `14.109585 ounce`; spaghetti `14 ounce` → `14.109585 ounce`; parmesan `0.5 cup` → `1.763698 ounce` |
| guacamole | 6 | 1 | cilantro `0.333 cup` → `0.35274 ounce` |
| cookies | 8 | 5 | butter `0.5 cup` → `4.056506 ounce`; sugar `0.5 cup` → `3.527396 ounce`; brown sugar `0.75 cup` → `5.291094 ounce`; flour `2 cup` → `8.81849 ounce`; chocolate chips `1.25 cup` → `7.054792 ounce` |
| curry | 7 | 5 | coconut milk `1.667 cup` → `1.690701 cup`; chicken `1 pound` → `1.102311 pound`; bamboo shoots `7 ounce` → `7.054792 ounce`; Thai basil `0.5 cup` → `0.529109 ounce`; rice `1.5 cup` → `10.582189 ounce` |

**Three axes of degradation, in priority order:**

1. **UNIT CATEGORY — the serious one. Every dry good the model measures in `cup` becomes
   `ounce`** (11 of the 18). `2 cup flour` → `8.81849 ounce`. Numerically defensible, but no
   US home cook measures flour by the ounce. **`fl oz` and `pint` are never produced at all**
   — exactly the W0 vocabulary gap (`kilogram` / `fl oz` / `pint`) that W2-SUMMARY flagged as
   "still open".
2. **PRECISION — cosmetic but user-visible on every converted row.** Unrounded 6-decimal
   conversions: `14 ounce` → `14.109585 ounce`, `1 pound` → `1.102311 pound`. **There is no
   rounding step in `deriveConversion`'s output path.** This axis would SURVIVE a vocabulary
   fix, so the vocabulary alone is not sufficient.
3. Volume→volume conversion works (`milliliter` → `cup`), so the gap is specifically
   mass↔volume vocabulary, not the converter itself.

### W5 PREREQUISITES (both, not either)

1. **The W0 unit vocabulary** — add `kilogram`, `fl oz` and `pint` canonical unit IDs.
2. **A rounding / presentation rule** for derived amounts (round to a sensible fraction or
   two significant decimals at the projection boundary; never emit a 6-decimal value to a
   user).

Switching to single-system extraction before both land would ship visibly worse US output on
18 of 35 ingredients. **This is now evidence, not an assumption — W2's director exit item #2
can be decided.**

---

## Incidental defects found and FIXED AT THE ROOT en route

Each was dormant until this wave made it reachable, and each is a never-broken issue rather
than a cosmetic one.

| # | Defect | Root fix |
|---|---|---|
| 1 | **`computeCookProjection` silently dropped the AMOUNT of a split-amount ingredient.** The `curry` fixture mentions coconut milk bare in step 0 and quantified (`400 milliliter`) in step 1; the collapse rule was first-occurrence-wins, so the bare mention won and the row was written `amount: null, unit: null` — **in BOTH systems**, because `derived` is built from `native`. An amount the legacy path writes today and the cook path would not. | `packages/db/src/repositories/cook-projection.ts`: when the existing row carries no amount and the new token does, adopt the only measure present (this is not the "two incompatible measures" case the fall-through guards). Also narrowed the `mixed-units` flag to genuine measure-vs-measure disagreement, so a trailing bare mention — which the prompt's own rule 1 *asks for* — no longer fills W5's confidence signal with noise. `coconut milk` went from `null null` to `1.690701 cup`. Four new tests. |
| 2 | **The `parser.extensions` default mask corrupted prose numbers.** `Bake at 180°C` → `180 °C`, `Add 1.50 kg` → `1.5 kg`: the read model W4 renders from was silently rewriting the user's text. | `extensions = 0` in `parse.ts` — norish writes only core Cooklang. |
| 3 | **Frontmatter injection via a newline, and a numeric-looking title.** A model-supplied recipe name containing `\n` broke out of the frontmatter block and could inject arbitrary `.cook` body; a recipe titled `1.50` emitted `title: 1.50` and the parser rejected the key. | Quote YAML values, decide quoting from the **key** (only `servings` is numeric-typed), and refuse raw control characters. |
| 4 | **`findNameIndex` spun FOREVER on a blank ingredient name** — `indexOf("", 0)` is always 0, so the loop never advanced. | Fixed, and a blank-named ref is now **refused** rather than dropped: dropping it would drop an ingredient ROW, because `deriveProjectionTx` builds rows from the tokens. |
| 5 | **A timer with an empty amount or unit emitted `~{%min}` / `~{5%}`**, which cost the whole recipe its `cook_source`. | Fixed at the serializer. |
| 6 | **The hostile corpus sized its own inputs from the constant it polices.** Raising `maxCookSourceBytes` made `String.repeat` throw at COLLECTION time — red for the wrong reason, proving nothing about the boundary. | Re-based on a literal `65_536` with a test asserting it equals the cap at baseline. **Generalisable: a suite whose job is to police a constant must not derive its inputs from that constant.** |

---

## ALL FIVE ADVERSARIAL WEAKENINGS (none committed, every revert byte-identical)

`git status --porcelain` was clean after each; `md5sum` back to the committed value; where a
patch was involved it compared **byte-identical** with `cmp`.
`git log -p faa13d8e..HEAD` contains none of these edits. **`git stash` was never used** —
the repo carries unrelated pre-existing stashes and an earlier misfired `pop` dumped ~18
foreign files into the tree.

| # | The exact weakening | Result |
|---|---|---|
| **W3-W1** | `limits.ts`: `maxCookSourceBytes: 65_536` → `Number.MAX_SAFE_INTEGER` | **RED — 7 failed / 52 passed.** Includes **`parseCookSource on an oversize source returns null, does not throw, and calls parse 0 times`** and **`buildCookPayload on a serialized-source breach returns null and calls parse 0 times`** — both parser-never-invoked assertions |
| **W3-W1b** (self-directed) | `limits.ts`: `maxCookMalformedTokens: 8` → `Number.MAX_SAFE_INTEGER` (while the tenth cap still existed) | **RED — 11 failed / 48 passed**, incl. 8 hostile-corpus cases blowing the time budget with real measured elapsed times (dense cookware sigils **4 626 ms**, dense ingredient sigils **4 595 ms**, dense timer sigils **2 767 ms**, unbalanced braces 1 894 ms, …) |
| **W3-W4** | **weaken the ESCAPER** — remove `@` from `COOK_METACHARACTERS` | **14 tests RED** across `round-trip-fidelity.test.ts` + `limits.test.ts`: `US shorthand: at` · `a whole token, as literal prose` · `every metacharacter at once` · `an already-escaped-looking sequence` · `survives every ASCII punctuation character in every construct-starting position` · `survives every ADJACENT PAIR of metacharacters` · `keeps the prose AROUND a real ingredient token byte-identical` · `escapeCookText is the exact inverse the parser expects` · `survives every hostile string as step PROSE` / `as an ingredient NAME, AMOUNT and UNIT` / `as a HEADING and as the recipe NAME` · `folds CR/LF in step prose to a single space` · `a newline-bearing step cannot inject a step, a section or a token` · `does NOT refuse ordinary US shorthand once the serializer has escaped it` |
| **W3-W5** | **weaken the RECOGNIZER** — `if (cookSource) return null;` as the second statement of `findCookSourceDefect` | **25 tests RED**, and the elapsed-time assertions blew the budget on exactly the families the deleted heuristic used to let through: the verifier's bypass at **3 915 ms**, dense `@` at **4 414 ms**, dense `~` at **3 638 ms**, `@a{` at 2 107 ms, plus 8 recognizer unit tests and 17 corpus entries failing their 0-invocation spy assertion |
| **W3-W2** | `buildCookPayload` returns `{ cookSource, cookTokens: [] }` instead of `null` when `parseCookSource` fails | **RED — exactly the two tests the plan predicted:** `build-payload.test.ts` → `returns null instead of throwing when the recipe has no steps` (1 failed / 13 passed); `cook-payload.test.ts` → `returns null with a did-not-parse-cleanly log, and no recipe prose` (1 failed / 24 passed). Recorded honestly: **only two assertions detect this**, and by different routes (a real step-less source vs a stubbed `parseCookSource`), because a diagnostic-producing source is now genuinely hard to construct — the escaping fix working as intended |
| **W3-W3** | add `cookSource: parseResult.cook?.cookSource ?? null` to the `imported` event payload in `recipe-import/worker.ts` | **RED — 4 failed / 40 passed** in `cook-source-isolation.test.ts`: "the `imported` payload carries neither cookSource, cookTokens nor any .cook text" **and** `reaches neither a member of an unrelated cookbook nor a stranger with no cookbook` (the PERSONAL case) — **each under BOTH `view: "household"` and `view: "everyone"`**. That the personal case caught it too proves the leak assertion is not confined to one ownership shape |

---

## Security

- **Adversarial revert-check: IN FORCE and fully executed** — six weakenings (the five the
  plan named plus one self-directed), each turned its suite RED, each reverted to a
  byte-identical tree, **none committed**.
- **T-27-01 (untrusted text → WASM parser): DISCHARGED, at the root cause.** Nine caps plus
  an output-integrity recognizer at the two and only two doors; `@cooklang/cooklang` is still
  imported in **exactly one file** (`parse.ts`) — no third door. A breach REJECTS, never
  truncates, and the parser is provably never invoked (0-invocation spy).
- **T-27-02 (disclosure), now non-vacuous:** `cookSource`/`cookTokens` still ship ONLY from
  `findRecipeForViewer` (post-`canAccessResource`) and `getEditable`
  (post-`assertRecipeAccess`). W3 adds the write/emit-side proof: the `imported` payload and
  the list/dashboard DTO carry no `cook*` key and no `.cook` text **for a recipe that HAS
  one**, under both policies, including the PERSONAL (`household_id IS NULL`) and
  `userId: null` branches.
- **T-27-05 (prose in logs):** every new log carries counts, limit names and reasons only.
  The coverage-gate log reports `missingCount`, never the missing NAMES — an ingredient name
  is per-cookbook data. Asserted with a logger spy scanning the serialized payload.
- **T-27-06 / T-27-07 (data loss, staleness):** the coverage gate (D-27-W3-04) and
  `cook_source = NULL` on a legacy update (D-27-W3-06).
- **T-27-08 (prompt injection):** the fragment sits before the untrusted content in all three
  builders (asserted). The model can only produce data that lands in a `.cook`; that `.cook`
  is now **escaped by construction**, so injected metacharacters are literal text rather than
  syntax.
- **T-27-SC:** `git diff pnpm-lock.yaml` **EMPTY** — W3 adds no third-party dependency.
- **No new `emitByPolicy` / `emitter.*` call site; no existing emit payload gained a field.**
- **No tRPC input schema changed** — `grep` over `packages/trpc/src/routers/recipes/` finds no
  `cook*` / `linkage` input key, and `FullRecipeInsertSchema.parse` still DROPS a
  client-supplied `cookSource` (D-27-W2-01 / D-27-W3-02 hold, now non-vacuously).

---

## Gates / evidence — baseline `main@f4420104` vs post-W3

| Gate | Baseline `f4420104` | After W3 |
|---|---|---|
| `pnpm typecheck` | 17/17 EXIT 0 | **17/17 EXIT 0** (but see finding 1 below) |
| real `tsc --noEmit` in `api` / `queue` / `shared` / `shared-server` | not previously run | **CLEAN, 0 errors** |
| `@norish/api` | 350 passed | **408 passed** |
| `@norish/queue` | 88 passed | **121 passed** |
| `@norish/shared-server` | 275 passed | **389 passed** |
| `@norish/db` (docker) | 164 passed / **1 failed** | **178 passed / 0 failed** — the "pre-existing" red was a STALE-`node_modules` artefact |
| `@norish/trpc` | 335 passed | **335 passed** |
| `@norish/shared` | 295 passed | **295 passed** |
| `@norish/web` · `mobile` · `auth` | 424 · 132 · 133 | **424 · 132 · 133** |
| lint `api` / `queue` / `shared-server` / `db` | 0 errors (97 / 85 / 57 / 62 warnings) | **0 errors, warnings exactly at baseline** — new files contribute 0 |
| `check-workspace-imports.mjs` | EXIT 0 | **EXIT 0** — `@norish/db` stays parser-free |
| `pnpm --filter @norish/web build:server` | EXIT 0 | **EXIT 0** — the parser stays `external` |
| `pnpm i18n:check` | EXIT 1, `no`-locale gap | **EXIT 1, `no` ONLY (68 keys), 10 locales match, ZERO NEW gaps** |
| `git diff pnpm-lock.yaml` | — | **EMPTY** |

**Net-new tests across W3: +192** — +69 (T1/T2), +60 (T3/T4), +55 (the root-cause fix, incl.
the 45-test `round-trip-fidelity.test.ts`), +33 (task 5's `cook-source-isolation.test.ts`).

**Isolation suites, all green:** `@norish/queue` isolation **44** (was 11), `@norish/trpc`
isolation **46**, `@norish/db` isolation **25**, `@norish/shared-server` **389** (incl.
`fan-out-isolation`), `permissions-integration` and `move-permissions` unchanged.

### Additive-safety / never-broken checks

- **NO MIGRATION.** `packages/db/src/migrations/` and `meta/_journal.json` untouched; no
  `*_snapshot.json`; `_journal.json` still has **42 entries, last tag
  `0041_add_cook_source`**; the DB stays at **42** and the planned `0042` (W5) / `0043` (W6)
  sequence is unchanged (D-27-W3-10).
- **No file under `apps/`** — including `apps/web/tsdown.config.ts`. No `*.txt` prompt
  template. No `shared-react/src/text/ingredient-links.ts`, no `smart-instruction` /
  `smart-markdown-renderer` / cooking-mode file, no `shared-server/src/ai/unit-converter.ts`.
- `packages/db/package.json` and `packages/shared/package.json` dependencies unchanged — no
  `@cooklang/*` reaches the Expo bundle, and `deriveProjectionTx` still takes a
  `CookTokensDTO`, never a string.
- **No `cook_confidence` / `cook_review_needed` write anywhere** (D-27-W3-09).
- **No `as any`, `@ts-ignore` or `@ts-expect-error` in the diff.** Two `as any` casts were
  written during task 4 (matching a local pattern in `recipes.ts`) and REMOVED once a real
  `tsc` proved them unnecessary.
- `recipes.create` (manual create) and the recipe editor's update still pass **no** `cook`.

### Refusal rates (re-derived after the root-cause fix; the T3/T4 figures were measured under the broken cap)

| gate | rate on the five real fixtures |
|---|---|
| size-cap (`input-too-large`) | **0/5** — they serialize to 225 / 308 / 437 / 452 / 506 bytes, **unchanged by escaping**, because real recipe prose carries no metacharacters |
| `not-serializer-shaped` (the recognizer) | **0/5** |
| parse-failure (`did-not-parse-cleanly`) | **0/5** — all five round-trip with an EMPTY report |
| coverage gate (D-27-W3-04) | **0/5** |
| malformed-token count on the real fixtures | **0 tokens each** |
| hostile corpus | 17 of 25 refused, all in ≤ 7.4 ms; worst accepted 648.8 ms |

**A measured refusal driver handed to W5 — singular/plural.** A model that writes `"2 eggs"`
in `recipeIngredient` and `"egg"` in a step's refs earns **no `.cook`**. Deliberately NOT
bridged (D-27-W3-E6): an `-s` rule is English-specific in a fork whose own extraction
fragment uses Dutch examples, and it could newly collide names the way `sugar` /
`brown sugar` must not. It costs nothing when it fires (legacy projection, successful
import) and is pinned by a named test. This is a prompt/eval item for W5, which owns both
the backfill and the harness. **The real-world rate cannot be known until the director
watches the two error-level logs after deploy.**

---

## Decisions taken during execution (a later wave must not relitigate these blindly)

| # | Decision | Rationale |
|---|---|---|
| **D-27-W3-E1** | *(SUPERSEDED)* a tenth cap, `maxCookMalformedTokens: 8`. | Correct diagnosis (a byte cap does not bound parse time), wrong mechanism. Refuted by an independent verifier and replaced by escaping + `findCookSourceDefect`. **Both symbols are deleted.** Recorded because the per-plan SUMMARY's history refers to it. |
| **D-27-W3-E2** | The hostile corpus is sized from a **literal** `65_536`, guarded by a test asserting it equals the cap at baseline. | A suite that polices a constant must not derive its inputs from it. |
| **D-27-W3-E5** | The coverage matcher's second direction is a **PREFIX** rule, not a substring rule. | `"salt to taste"` must cover `"salt"` while `"brown sugar"` must NOT cover `"sugar"`; a substring rule satisfies the first and breaks the second, and the second is the one that protects a row from being dropped. Whole-word token comparison, so it is Unicode-safe for non-English recipes. |
| **D-27-W3-E6** | **No morphological (singular/plural) matching.** | English-specific in a multilingual app; risks new name collisions. A refusal costs nothing. Handed to W5. |
| **D-27-W3-E7** | Fix the split-amount projection defect at the ROOT in `computeCookProjection` rather than adding a fifth refusal reason. | A fifth refusal would have disabled the `.cook` for a pattern the extraction fragment's own rule 1 explicitly asks the model to produce. Losing a stated amount is a never-broken violation. |
| **D-27-W3-E8/E9** | The video processor chain is threaded in full (9 files, not the 5 the plan listed); `video/instagram.ts` was threaded although `processInstagramImagePost` has no non-test caller. | `VideoProcessor.process` returns the payload, so `types.ts` / `base-processor.ts` / `processor.ts` / `processors/facebook.ts` MUST change or nothing compiles — the plan's file list was incomplete for its own design. The dead path is FLAGGED for a later wave, not deleted. |
| **E — escape, do not sanitize** | `escapeCookText` lives in the **serializer only**; nothing was added to `normalizer.ts`. | Sanitizing there too would be a second door for the same invariant. The serializer is where the format is written, so it is where the escaping belongs. |
| **E — `#` cookware ACCEPTED** | The recognizer accepts well-formed `#` cookware tokens although the serializer never emits one. | They are diagnostic-free and fast, `toCookTokens` keeps them readable in prose, and prose can no longer produce one by accident now that `#` is escaped. `parse.test.ts`'s `#oven{}` fixture keeps passing unedited. |
| **D-27-W3-E11** | The read-side `NOT_FOUND` half of task 5's case 2 stays in the **trpc** suite; the queue suite proves the PUSH half. | `@norish/auth` (where `canAccessResource` lives) is a FORBIDDEN import edge for `@norish/queue` and is not a declared dependency, so honouring the plan's literal wording would have turned `check-workspace-imports.mjs` red, and re-implementing the predicate in the test would have been *mocking the boundary*. W2's suite already covers the read denial for these exact ownership shapes under both policies, and is re-run green (trpc isolation 46/46). |
| **D-27-W3-E12** | Task 5's `dashboardRecipe` stand-in feeds `RecipeDashboardSchema` MORE than the repository does (both cook columns). | It moves the thing under test from "the repository happens not to select these columns" to "the DTO contract omits them" — the R3 regression the plan actually asks for. A stand-in mirroring the repository exactly would pass even if the `.omit` were deleted. |
| **D-27-W3-E13** | Two extra task-5 cases for the **dedup-hit** emit path. | It is the second place `processImportJob` emits a recipe DTO, it emits one it did not create, and its `recipeExistsByUrlForPolicy` call is a DIFFERENT call site from the producer's that `dedup-isolation.test.ts` covers (IMPORT-DEDUP-ISO-01) — now with a `.cook`-bearing recipe on the other side of it. |

---

## Deviations from the plan (and why)

1. **[Missing critical] The plan's nine caps could not satisfy the plan's own < 2 000 ms
   acceptance criterion.** Resolved in two stages: a tenth cap (wrong mechanism), then the
   root-cause escaping fix. The nine landed at their exact planned values.
2. **[Bug, fixed at root] `packages/shared/src/cooklang/serialize.ts` (+ `index.ts`) is in the
   diff**, outside `files_modified`. It is where the injection was; fixing it anywhere else
   would have been a bandaid.
3. **[Bug, fixed at root] `packages/db/src/repositories/cook-projection.ts` (+ its test) is in
   the diff**, outside `files_modified` — the split-amount amount-loss defect, a never-broken
   issue that only W3's producer makes reachable.
4. **[Test contract, NOT an assertion relaxation] Two mocked test files had to change.**
   `packages/api/__tests__/server/parser/import-flow.test.ts` and
   `packages/queue/__tests__/image-import/worker.test.ts` mock the very producers whose return
   type task 4 changes, so `{ recipe, cook: null }` replaced a bare DTO and the
   `createRecipeWithRefs` expectation gained the trailing `undefined`. **No behavioural
   assertion was weakened or removed** — both files caught real mismatches during the task.
5. **[Scope, clarified] Task 5's `recipes.get` NOT_FOUND wording** — D-27-W3-E11.
6. **[Process] The wave took three executor sessions**, each closing at a committed,
   fully-gated task boundary with a written SUMMARY, per the rule that production commits
   without a SUMMARY are an illegal half-state.

---

## Standing infrastructure findings for the director (both PRE-EXISTING, not introduced here)

1. **`pnpm typecheck` DOES NOT type-check `packages/api`.** Six of the seventeen typecheck
   scripts pass `--noCheck` (`api`, `queue`, `shared-server`, `auth`, `shared-react`,
   `apps/mobile`; `trpc` likewise), which disables type checking outright. Proven
   adversarially: a blatant `const x: number = "str"` in `packages/api/src` left
   `pnpm typecheck` at **17/17 successful**, and so did reverting a handler's return type. The
   `ExtractedRecipe` threading was therefore verified with a real `pnpm exec tsc --noEmit`
   inside each package — **all clean** — and the same command with the contract mismatch
   reapplied produced **8 genuine errors**. **Dropping `--noCheck` for at least `api` and
   `queue` looks like a one-line change and deserves its own small plan.**
2. **`node_modules/@norish/{api,queue}` were injected hardlink FARMS** with root-owned,
   unwritable directories (true symlinks only for `db` / `shared` / `shared-server`). The farm
   predated W2 and could never hold task 3's new `linkage.ts`. Repointed to
   `../../packages/{api,queue}` — **environment only, nothing tracked by git**. Two immediate
   effects: `@norish/trpc` returned to exactly 335, and the long-standing `@norish/db`
   "pre-existing" red (`cleanup-workflows.test.ts`) **disappeared — it was a
   stale-`node_modules` artefact, never a real defect**. If someone runs `pnpm install` the
   farms may be re-injected; check the links first if a suite goes red with "cannot find
   module" or "is not a function". **Never `cat`/`cp` between a workspace file and its
   `node_modules` copy** — hardlinked pairs share an inode and the redirect truncates the
   source before it is read (this destroyed 13 source files mid-wave; fully recovered from
   `git show HEAD:<path>` in place).
3. **`git stash` is a trap in this repo** — it carries unrelated pre-existing stashes, and a
   misfired `pop` dumped ~18 foreign files into the tree. Use `git show <sha>:<path>`,
   `git worktree` or `/tmp` copies for baseline comparisons.
4. **`format:check` was already red for several files this wave touched** (`normalizer.ts`,
   `cook-projection.ts`, `recipes.ts`, `build-payload.ts`, `prompts/builder.ts`), verified via
   `git show HEAD:<path> | prettier --check --stdin-filepath <path>`. They were deliberately
   NOT reformatted — that would have added large unrelated churn. New files are
   prettier-clean. This matches the known finding in `STATE.md` that the repo's CI "Format
   Check" job is non-functional by construction.

---

## W3 exit items for the DIRECTOR

1. **`pnpm docker:build`** + deploy-image sanity. The parser must still resolve as an external
   dependency in `/app/deploy/node_modules`. Unchanged from W2, but **W3 is the first deploy
   where it runs on the WRITE path in production.**
2. **DECIDE, on the evidence above: pull the W0 unit-vocabulary work forward AND add a
   rounding rule, before W5.** D-27-W3-07 is now measured — the derived US output is worse
   than the AI's on 18 of 35 ingredients, on two independent axes. Both are W5 prerequisites;
   the vocabulary alone is not sufficient.
3. **Watch three error-level logs after deploy** — `reason: "incomplete-ingredient-coverage"`,
   `reason: "did-not-parse-cleanly"` and `reason: "not-serializer-shaped"`. The third should be
   **zero**: a non-zero rate means the serializer regressed, not that a user did something
   odd. The first two are the honest measure of how the linkage fragment performs in the field
   and are the same signal W5's backfill uses. **If coverage refusals dominate, that is a
   prompt/eval finding for W5, not a reason to relax the gate.**
4. **Confirm a verified-restorable backup exists before the deploy that carries W3.** W3 adds
   no migration, but it is the first deploy that WRITES `cook_source` on live data.
5. **Live DeepSeek extraction is still unconfigured** (`AI_API_KEY` empty). W3's producer only
   fires on the AI extraction paths, so **until a key is configured no recipe will earn a
   `cook_source` on live** and the W3 deploy is a no-op in practice. Worth deciding
   deliberately rather than discovering it.
6. **Consider a small plan for the `--noCheck` typecheck hole** (finding 1 above). It made two
   of this wave's risks unverifiable by the command the plan prescribed.
7. **Worth knowing for W5:** the parser TRAPS (`RuntimeError: unreachable`, a Rust panic) on
   several adversarial inputs. `parseCookSource` catches it and the singleton is verified NOT
   to be poisoned — after a trap the same instance parses a real recipe cleanly. Every trapping
   input is now refused before the parser, but W5 runs the parser over real live data at
   volume, so the refusal logs are the signal to watch.

---

## What W4 can now assume

- **A recipe can have a non-NULL `cook_source`, and if it does, it parses cleanly AND
  describes the recipe it is attached to.** Both halves are enforced: `buildCookPayload`
  refuses a source that does not round-trip, and D-27-W3-06 NULLs a stale one on an ordinary
  edit. This is the invariant the `cookTokens ? tokenRenderer : legacy` fork rests on.
- **`recipes.get` / `getEditable` already carry `cookSource` + `cookTokens`** (W2), and from
  W3 they carry real data. Until W4 lands the client simply ignores them.
- **The read model no longer rewrites prose.** `extensions = 0` means `180°C` and `1.50 kg`
  come back exactly as typed, and every metacharacter round-trips byte-identically (a 45-test
  fidelity suite, including an exhaustive ASCII-punctuation sweep). **W4's renderer can trust
  the token text.** Two documented normalizations: CR/LF in step prose folds to a space, and
  an unpaired UTF-16 surrogate becomes U+FFFD.
- **The list/dashboard DTO carries no `cook*` key** for a recipe that has one, proven at both
  the read and the emit end. W4 must not widen it.
- **The heuristic runtime path is still live** — deleting it is W4's own scope item, and W6
  owns `unit-converter.ts` / `applyIngredientLinkMarkup` / `SmartInstruction`.
- **Refusals are the ORDINARY case, not an error.** Most existing recipes still have
  `cook_source IS NULL` (W5's backfill is what changes that), so W4's fork must treat the
  legacy branch as the common path, not the exception.

---
*Wave: W3 of 7 — CODE-COMPLETE (5/5 tasks)*
*Completed: 2026-07-25*
