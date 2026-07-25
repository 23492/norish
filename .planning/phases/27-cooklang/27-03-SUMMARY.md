---
phase: 27-cooklang
plan: 03
subsystem: security
tags: [cooklang, wasm, dos, input-validation, zod, ai-extraction]

requires:
  - phase: 27-cooklang (W1)
    provides: structuredToCooklang serializer, parseCookSource read model
  - phase: 27-cooklang (W2)
    provides: cook_source column, deriveProjectionTx, the optional `cook` repository argument, buildCookPayload
provides:
  - "@norish/shared-server/cooklang/limits — TEN input caps enforced inside buildCookPayload and parseCookSource (T-27-01 DISCHARGED)"
  - "buildLinkageInstruction — the linkage prompt fragment appended by all three extraction builders as CODE, never a .txt edit (D-27-W3-01)"
  - "buildCookFromExtraction — the first .cook PRODUCER; a newly AI-extracted recipe can now have a non-NULL recipes.cook_source"
  - "ExtractedRecipe { recipe, cook } + CookPayload — the server-side channel from the three AI extractors to createRecipeWithRefs(..., cook)"
  - "countMalformedCookTokens — the cap that actually bounds parse TIME, discovered by measurement"
  - "recipeExtractionSchema.recipeInstructions accepts a per-step OBJECT or a plain STRING (D-27-W3-03)"
  - "coerceExtractionSteps — total, never-throwing coercion of either step branch"
affects: [27-cooklang W3 tasks 3-5, 27-cooklang W4, 27-cooklang W5, phase-31-ingest]

tech-stack:
  added: []
  patterns:
    - "Caps live INSIDE the two doors to the WASM parser, never at call sites"
    - "REJECT, never truncate: a breach costs the `.cook`, never the user's import"
    - "A suite that polices a constant must not derive its inputs from that constant"

key-files:
  created:
    - packages/shared-server/src/cooklang/limits.ts
    - packages/shared-server/__tests__/cooklang/limits.test.ts
  modified:
    - packages/shared-server/src/cooklang/parse.ts
    - packages/shared-server/src/cooklang/build-payload.ts
    - packages/shared-server/package.json
    - packages/api/src/ai/schemas/recipe.schema.ts
    - packages/api/src/ai/features/recipe-extraction/normalizer.ts
    - packages/api/__tests__/ai/features/recipe-extraction/normalizer.test.ts

key-decisions:
  - "D-27-W3-E1: TEN caps, not the planned nine. Measurement proved a byte cap cannot bound parse time; `maxCookMalformedTokens: 8` is the cap that does."
  - "D-27-W3-E2: the hostile corpus is sized against a LITERAL 65_536, not against COOK_LIMITS.maxCookSourceBytes, so a weakening turns assertions red instead of failing collection."

requirements-completed: []  # COOK-01 is NOT complete — tasks 3-5 of this plan remain

duration: ~2h 45m
completed: 2026-07-25
---

# Phase 27 Plan 03: Extraction native + T-27-01 input limits — PARTIAL SUMMARY

> **TWO EXECUTORS WROTE THIS FILE. The record below covers Tasks 1–2; the
> "Tasks 3–4" section at the BOTTOM covers Tasks 3–4 and carries the
> D-27-W3-07 measurement, the refusal rates and the Task 5 handoff.
> As of the second session: 4 of 5 tasks landed, W3 is still NOT code-complete.**

**T-27-01 is DISCHARGED with a tenth cap the plan did not anticipate: measurement proved the
planned 64 KiB byte cap does NOT bound parse time (adversarial input measured up to 18.8 s
INSIDE it), because `@cooklang/cooklang` renders a diagnostic per malformed token quoting the
token's whole line. `maxCookMalformedTokens: 8` attacks that root cause and brings the worst
surviving adversarial input to 622 ms. `recipeExtractionSchema` now accepts per-step linkage as
an object-or-string union with a total, never-throwing normalizer.**

> ## STATUS: PARTIAL — 2 of 5 tasks landed. W3 is NOT code-complete.
>
> **Done:** Task 1 (T-27-01 input limits) · Task 2 (schema union + tolerant normalizer).
> **NOT done:** Task 3 (linkage prompt fragment) · Task 4 (mint the `.cook` and thread it to the
> write path — the wave's actual switch-on) · Task 5 (queue-side isolation suite + weakenings
> W3-W2 / W3-W3).
>
> **Consequence: no `.cook` producer exists yet.** Every recipe in the database still has
> `cook_source IS NULL`, exactly as at the end of W2, and nothing user-visible changed. The
> NEVER-BROKEN GUARANTEE holds trivially — the extraction path is byte-identical to today for a
> string-shaped model response, and no code path yet passes a `cook` argument to the repository.
>
> **Why it stopped here, honestly:** Task 1's acceptance criterion "each hostile-corpus call
> completes in under 2000 ms" turned out to be unsatisfiable with the plan's nine caps. Proving
> that, finding the true cost driver and calibrating the fix took a large share of the executor's
> budget (see "The T-27-01 finding" below — it required ~10 rounds of instrumented measurement
> against the real WASM binary). Rather than leave Tasks 3–5 half-implemented and uncommitted,
> execution stopped at a clean, fully-gated 2-task boundary and spent the remainder on this
> SUMMARY, per the plan's own rule that production commits without a committed SUMMARY are an
> illegal half-state.

## Task Commits

1. **Task 1: T-27-01 — input-size limiting at the two doors to the WASM parser** — `f29254b9` (feat)
2. **Task 2: per-step linkage in `recipeExtractionSchema` + tolerant normalizer** — `65815ec4` (feat)

Base: `faa13d8e` (the W3 plan commit); measurement baseline `f4420104`.

An interrupted earlier attempt at Task 1 left uncommitted WIP in the tree. It was assessed,
kept where correct (the module, the two call-site guards, the export-map entry and most of the
suite were sound), corrected where not, and folded into `f29254b9`. Its scratch probe
(`__tests__/cooklang/zz-probe.test.ts`) was a debug harness and was DELETED rather than
committed — but its output was the thread that led to the finding below, so it earned its keep.

---

## The T-27-01 finding — why there are TEN caps, not nine

This is the substantive discovery of the session and it changes what a verifier should look for.

### What the plan assumed
Nine size caps, `maxCookSourceBytes: 65_536` chief among them, would bound what reaches the
parser; a 12-input hostile corpus sized AT the cap would then each parse in under 2000 ms.

### What measurement showed
A size cap bounds how much text the parser READS. It does not bound how long the parser TAKES.
`@cooklang/cooklang@0.18.7` emits a diagnostic per malformed token, and **each diagnostic quotes
the entire LINE the token sits on**, so report construction costs O(malformed tokens x line
length) and the resulting multi-megabyte string crosses the WASM boundary. Measured on this tree,
every one of these **inside** the planned 64 KiB cap:

| source (64 KiB unless stated) | parse time | report size |
|---|---:|---:|
| `("#" x 8 + " ")` x 128 + one long word | **18 387 ms** | ~250 MB |
| `("~~ ")` x 2048 + one long word | **17 462 ms** | ~134 MB |
| `("~" x 500 + " ")` tiled | **10 116 ms** | — |
| `"#" x 4096` — **a 4 KiB source** | **4 553 ms** | ~17 MB |
| `"@" x 65536` | **4 281 ms** | — |
| the 17 s bytes rewrapped at 8 192/line | 131 ms | — |
| a realistic 64 KiB `.cook` (3 276 tokens) | **90 ms** | 0 |

Three consequences:

1. **Lowering the byte cap cannot fix it.** The worst case is *non-monotonic* in the cap (worst
   observed at caps of 8–16 KiB, because past that the WASM traps early instead of finishing the
   report), and a 4 KiB `#` run already costs 4.5 s while the real fixtures are low single-digit
   KB. There is no byte cap that is both safe and large enough for a real recipe.
2. **The parser has no option to suppress the report.** Checked `index.d.ts` and
   `pkg/cooklang_wasm.d.ts`: `parse`, `parse_full`, `parse_render`, `parse_ast`, `parse_events` —
   the report is always constructed. So the control has to be on the input side.
3. **Timing is memory-state dependent.** The same input measures 15 ms on a fresh
   `CooklangParser` and 16 786 ms on one whose linear memory has grown, because whether the WASM
   finishes the report or traps depends on allocation. A bare "< 2000 ms" assertion over parsed
   pathological input is therefore inherently flaky; the only stable way to satisfy it is to
   REFUSE those inputs before the parser.

### The fix — `maxCookMalformedTokens: 8`
The root cause is malformed TOKENS, not size. And norish **authors** every `.cook` it stores
(D-3), so its own serializer emits exactly zero of them — verified by reading
`packages/shared/src/cooklang/serialize.ts`:

- ingredients are `@name` or `@name{qty%unit}`; `sanitizeTokenName` strips `@{}~#%` from names;
- timers are `~{qty%unit}` or `~name{qty%unit}`;
- section headings are `== Heading ==` (a `#`-prefixed step is REWRITTEN to that form, so the
  in-band `# Heading` convention never reaches the parser as a cookware sigil);
- **cookware (`#`) is never emitted at all.**

A malformed token can therefore only arrive from **unsanitized step prose** — which is precisely
the prompt-injection channel T-27-01 exists for. `countMalformedCookTokens` counts, in a single
pass, every `@`/`#`/`~` not followed by a name character or by a `{` that closes on the same line.
A cap of 8 tolerates an incidental stray `~` or `#` in real prose (e.g. "rest ~ 5 min") while
refusing every pathological family.

**Result: worst surviving adversarial input = 622 ms, a 3.2x margin under the 2 000 ms budget**
(previously 18 811 ms, a 9.4x *breach*). The full 19-input corpus plus the rest of the cooklang
suites now runs in ~3 s of test time; before the fix the probe alone took 205 s.

### The nine + one `COOK_LIMITS` values AS LANDED

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
maxCookMalformedTokens:         8   // NEW (D-27-W3-E1) — the cap that bounds parse TIME
```

The plan's nine landed at their **exact** specified values; nothing was relaxed. The tenth is
additive. The calibration and the measurement table above are recorded in the module docblock so
a later wave raises a cap deliberately rather than by guess.

### Where they are enforced
- `buildCookPayload` — `checkStructuredRecipeLimits` **before** `structuredToCooklang`, and
  `checkCookSourceLimits` **before** handing anything to `parseCookSource`. Breach ⇒ `null` +
  **error**-level log `{ module, reason: "input-too-large", limit, measured, allowed, stepCount,
  ingredientCount }`.
- `parseCookSource` — `checkCookSourceLimits` as its **first statement**, before the parser
  singleton is touched. Breach ⇒ `null` + **warn** log. This is the belt to `buildCookPayload`'s
  braces: `withCookTokens` (W2's read path) also calls it, so a `cook_source` that somehow grew
  past a cap in the database can never reach the parser either.

Neither exported signature changed. **REJECT, never truncate** — a truncated `.cook` parses
cleanly and would store a source that silently omits steps, breaking the invariant W4's renderer
and W6's `0043` stand on.

### Hostile-corpus evidence
19 adversarial inputs (the plan asked for 12), every one sized AT `maxCookSourceBytes`. Each
asserts: no throw, elapsed < 2000 ms by explicit measurement (not a test timeout), and a
`CookTokensSchema`-valid DTO when non-null. Each entry additionally declares whether the cap
regime **refuses** it or parses it, and asserts the parser spy accordingly — 8 of the 19 are
refused with **0** `parse` calls, and those 8 are exactly the inputs measured at 4–19 s if let
through. `%`, `}`, `{`, `>`, astral-plane, combining marks, NUL, lone surrogates, repeated
`== h ==` and repeated `>> a: b` all parse safely (max 637 ms) and are asserted to reach the
parser exactly once, so the suite also proves the cap is not over-broad.

---

## Task 2 — the R1 mitigation

`recipeExtractionSchema.recipeInstructions.{metric,us}` is now
`z.array(z.union([extractionStepSchema, z.string()]))`, **object branch first** (D-27-W3-03).
`ingredients` and `timers` carry `.default([])`. The top level stays `.strict()`.

R1 was the plan's single largest risk: `Output.object` validates the model's response, so a
mandatory step object turns any non-compliant model into a **total import failure**, on a fork
where the provider and model are user-configurable. Proven defused:

- all-strings, all-objects and **mixed** `recipeInstructions` all `parse`;
- `validateExtractionOutput`'s `details` counts are **identical** across all three (it counts
  `.length`, which is branch-agnostic — contract unchanged);
- an all-strings extraction yields a DTO **deep-equal** to the all-objects one with the same text;
- `normalizeRecipeFromJson` is asserted to still receive a plain `string[]` even for object
  steps, so `parseSteps` and every JSON-LD behaviour are untouched.

`coerceExtractionSteps` is **total**: `null`, `undefined`, `[]`, `[null]`, `[{}]`, `[42]`, a
deeply-nested array, a non-array and a bare number all yield an array and never throw; malformed
per-step refs are dropped rather than propagated. A bad model response can cost the `.cook`; it
can never cost the import.

**No upper-bound constraint anywhere in the schema** (T-27-01b) — the caps belong at the parser
door, where a breach costs only the `.cook`. The plan's grep gate is asserted in the suite; the
docblock explaining the decision is worded to avoid containing the literal it forbids, so the
grep genuinely comes back empty.

---

## Adversarial revert-check

Two of the plan's three weakenings were executable at this point (W3-W2 and W3-W3 depend on
Tasks 4 and 5, which did not land). A third, self-directed weakening was added to prove the
*new* cap is not decorative — without it, `maxCookMalformedTokens` would be an unproven claim.

`git status --porcelain` was EMPTY after every revert, md5 back to the committed value, and
`git log -p faa13d8e..HEAD` contains none of these edits.

| # | The exact weakening | Result |
|---|---|---|
| **W3-W1** | `limits.ts`: `maxCookSourceBytes: 65_536` → `Number.MAX_SAFE_INTEGER` | **RED — 7 failed / 52 passed (59).** `declares exactly the ten T-27-01 caps at their calibrated values`; `breaches at 65_537 ASCII bytes`; `REJECTS a multi-byte string whose .length is under the cap but whose UTF-8 byte length is over it`; **`parseCookSource on an oversize source returns null, does not throw, and calls parse 0 times`**; `parseCookSource warns with the limit name and the measured value, and no source text`; **`buildCookPayload on a serialized-source breach returns null and calls parse 0 times`**; `is sized at the cap's baseline value` |
| **W3-W1b** (added) | `limits.ts`: `maxCookMalformedTokens: 8` → `Number.MAX_SAFE_INTEGER` | **RED — 11 failed / 48 passed (59).** `breaches maxCookMalformedTokens at 9 malformed tokens`; `REJECTS the pathological families that the BYTE cap alone lets through`; and **8 hostile-corpus cases blowing the time budget with real measured elapsed times**: `dense cookware sigils` **4626 ms**, `dense ingredient sigils` **4595 ms**, `dense timer sigils` **2767 ms**, `unbalanced opening braces` **1894 ms**, `malformed cookware ahead of one very long line` **1601 ms**, `nested ingredient tokens` **1558 ms**, `malformed timers ahead of one very long line` 641 ms, `mixed sigil soup` 20 ms |
| W3-W2 | `buildCookPayload` returns `{ cookSource, cookTokens: [] }` instead of `null` when `parseCookSource` fails | **NOT EXECUTED** — its second half ("Task 4's non-parsing case") does not exist yet. Deferred to the executor that lands Task 4. |
| W3-W3 | add `cookSource` to the `imported` event payload in `recipe-import/worker.ts` | **NOT EXECUTED** — `cook-source-isolation.test.ts` (Task 5) does not exist yet. Deferred. |

### A test defect the weakening caught (and the plan's rule that caught it)

W3-W1's **first** run went red for the wrong reason: `RangeError: Invalid string length`, at
collection time, 0 tests run. The hostile corpus sized its inputs from
`COOK_LIMITS.maxCookSourceBytes`, so raising that constant made `chunk.repeat(...)` throw and the
file never executed an assertion. That looks red and proves nothing about the boundary.

Per the plan ("if a weakening leaves the suite GREEN, the TEST is wrong — fix the test, then
re-run the weakening"), the corpus was re-based on a **literal** `CORPUS_BYTES = 65_536`, with a
new test asserting it equals the cap at baseline so the two cannot silently diverge. Re-running
W3-W1 then produced the 7 genuine assertion failures tabulated above, including both
parser-never-invoked assertions. **Generalisable lesson, recorded in the file's docblock: a suite
whose job is to police a constant must not derive its inputs from that constant.** The fix was
amended into `f29254b9`.

---

## Gates — baseline `main@f4420104` vs post-plan

| Gate | Baseline `f4420104` | After tasks 1–2 |
|---|---|---|
| `pnpm typecheck` | 17/17 EXIT 0 | **17/17 EXIT 0** |
| `@norish/shared-server` | 275 passed | **333 passed** (+58) |
| `@norish/api` | 350 passed | **361 passed** (+11) |
| `@norish/db` (docker) | 164 passed / **1 failed** | **164 passed / 1 failed** — the same single pre-existing red |
| `@norish/trpc` | 335 passed | **335 passed** |
| `@norish/queue` | 88 passed | **88 passed** |
| `@norish/shared` | 295 passed | **295 passed** |
| `@norish/web` | 424 passed | **424 passed** |
| `@norish/mobile` | 132 passed | **132 passed** |
| lint `@norish/shared-server` | 0 errors, 57 warnings | **0 errors, 57 warnings** — new files contribute 0 |
| lint `@norish/api` | 0 errors, 97 warnings | **0 errors, 97 warnings** — verified by re-running on a stashed tree |
| `check-workspace-imports.mjs` | EXIT 0 | **EXIT 0** |
| `pnpm --filter @norish/web build:server` | EXIT 0 | **EXIT 0** |
| `pnpm i18n:check` | EXIT 1 (`no`-locale gap) | **EXIT 1, ZERO NEW GAPS** — `no` (Norwegian) is the ONLY locale reporting missing keys, and the diff touches no `packages/i18n` file at all (see Issues: the first attempt at this check was invalid) |
| `git diff pnpm-lock.yaml` | — | **EMPTY** — no third-party dependency added (T-27-SC) |

**Net-new tests: +69** — `limits.test.ts` 58 new, `normalizer.test.ts` +11.

**The one red is PRE-EXISTING and unrelated:**
`__tests__/server/db/cleanup/cleanup-workflows.test.ts > reconciles recipe media references and
prunes recipe directories not in recipes.id` — `expected +0 to be 3`, a media/filesystem
reconciliation count. Identical on the untouched tree.

**Baseline correction for the director:** the dispatch brief quoted `trpc 322`. Measured is
**335**, which matches W2-SUMMARY's table. 322 appears to have come from the ROADMAP's Phase 27
entry, which was written before W2's post-review isolation hardening added 13 tests. Future
waves should expect **335**.

### Additive-safety / never-broken checks

- `git diff f4420104 HEAD --stat` touches **9 files**, all within `files_modified` plus this
  plan's own `.md`. No file under `apps/`. No `*.txt` prompt template. No
  `shared-react/src/text/ingredient-links.ts`, no `smart-instruction` / `smart-markdown-renderer`
  / cooking-mode file, no `shared-server/src/ai/unit-converter.ts`.
- `packages/db/src/migrations/` and `meta/_journal.json` **untouched**; no `*_snapshot.json`; the
  DB stays at migration **42**; the planned `0042` / `0043` sequence is unchanged (D-27-W3-10).
- `packages/db/package.json` and `packages/shared/package.json` dependencies **unchanged** — no
  `@cooklang/*` may reach the Expo bundle, and `@norish/db` stays parser-free.
- No `cook_confidence` / `cook_review_needed` write anywhere in the diff (D-27-W3-09).
- No `as any`, `@ts-ignore` or `@ts-expect-error` in the diff (R11).
- No new `emitByPolicy` / `emitter.*` call site; no existing emit payload gained a field.
- No tRPC input schema changed. `grep` over `packages/trpc/src/routers/recipes/` still finds no
  `cook*`/`linkage` key (D-27-W2-01 / D-27-W3-02 hold vacuously — W3 added no `.cook` channel yet).

---

## Refusal rates observed across fixtures

Partial, because the coverage gate (D-27-W3-04) and the parse-failure gate are Task 4's:

- **Size-cap refusal rate on real fixtures: 0/5.** All five committed serializer fixtures pass
  `checkStructuredRecipeLimits` AND `checkCookSourceLimits` on their real serialized output. If a
  fixture had breached, the cap would have been wrong — none did.
- **Malformed-token count on real fixtures: 0/5, exactly zero tokens each**, confirming the
  serializer-emits-none premise the tenth cap rests on.
- **Malformed-token refusal rate on the hostile corpus: 8/19.**
- **Coverage-gate refusal rate: NOT MEASURABLE** — `buildCookFromExtraction` does not exist yet.
- **Parse-failure ("did-not-parse-cleanly") refusal rate: NOT MEASURABLE** for the same reason.
  W1/W2 already established that all five fixtures round-trip with an EMPTY report, so the
  expected rate on well-formed linkage is 0.

## D-27-W3-07's measurement — NOT PERFORMED

The decision itself (keep dual-system extraction, defer single-system to W5) is unchanged and
still stands on W2's finding that W0's unit vocabulary lacks `kilogram`, `fl oz` and `pint`.

**But the plan required Task 4 to MEASURE the quality delta rather than assume it, and that
measurement did not happen** — it compares the AI-emitted US ingredient list against the list
`deriveProjectionTx` derives from the metric `.cook`, and neither `buildCookFromExtraction` nor
the threading exists yet. **The director's exit item #2 (whether to pull the W0 unit-vocabulary
work forward before W5) therefore has NO new evidence from this plan and remains open.** It must
not be closed on the strength of this SUMMARY.

---

## Decisions Made

| # | Decision | Rationale |
|---|---|---|
| **D-27-W3-E1** | **TEN `COOK_LIMITS` caps, not nine.** Added `maxCookMalformedTokens: 8`. | The plan's own acceptance criterion (< 2000 ms per hostile-corpus call at the cap) is UNSATISFIABLE with nine caps: adversarial input inside 64 KiB measures up to 18.8 s, and no byte cap is both safe and large enough for a real recipe. The alternatives were to weaken the assertion (a bandaid, and the exact thing the standing directive forbids) or to fix the root cause. The root cause is malformed tokens driving O(diagnostics x line length) report construction, and norish's serializer emits zero of them, so the cap is tight, cheap and near-zero false-positive. The plan's nine landed at their exact values; nothing was relaxed. |
| **D-27-W3-E2** | The hostile corpus is sized from a **literal** `65_536`, not from `COOK_LIMITS.maxCookSourceBytes`, guarded by a test asserting the two are equal. | Found by W3-W1: sized from the constant, the weakening made the file fail to COLLECT (`RangeError`) instead of failing assertions — red for the wrong reason, proving nothing about the boundary. A suite that polices a constant must not derive its inputs from it. |
| **D-27-W3-E3** | Task 2's new schema tests build their own schema-valid base rather than reusing `createValidOutput()`. | `createValidOutput()` is shaped for `validateExtractionOutput` and was never `parse`-valid (it omits `notes`, sets `categories: null`). Reusing it made six new tests fail on unrelated fields. No existing assertion was edited — the helper is untouched and its existing callers are unaffected. |
| **D-27-W3-E4** | The scratch probe `zz-probe.test.ts` was DELETED, not committed. | It was a debug harness (bare `console.log`, 600 s timeouts, no assertions) and would have added ~205 s to every suite run. Its findings are preserved as the measurement table in `limits.ts`'s docblock, which is the durable form. |

## Deviations from Plan

**1. [Rule 2 — Missing Critical] A tenth cap was required for the plan's own acceptance
criterion to be satisfiable.** Found during Task 1. Documented as D-27-W3-E1 above and called out
loudly here because the plan's `<output>` asks a verifier to look for "the nine `COOK_LIMITS`
values" first — they will find ten, and the tenth is the one doing the security work.

**2. [Rule 1 — Bug] The hostile corpus's own sizing was a latent defect.** Found by executing
W3-W1. Fixed at the root (literal + equality guard) rather than by adjusting the weakening.
Documented as D-27-W3-E2. Amended into `f29254b9`.

**3. [Scope — INCOMPLETE, not auto-fixed] Tasks 3, 4 and 5 were not executed.** This is the
material deviation. It is a budget outcome, not a technical blocker: nothing discovered in Tasks
1–2 obstructs them, and Task 2 deliberately landed the schema half of the producer so Task 4 has
a stable contract to build on. See "For the next executor" below.

**Total deviations:** 2 auto-fixed (1 missing-critical, 1 bug) + 1 scope shortfall.
**Impact:** both auto-fixes strengthen T-27-01 and were necessary for correctness. No scope creep
— nothing outside `files_modified` was touched. The scope shortfall leaves W3 non-functional but
leaves the tree green, coherent and resumable.

## Issues Encountered

- **The WASM parser traps (`RuntimeError: unreachable`, a Rust panic) on several adversarial
  inputs.** `parseCookSource`'s existing try/catch converts this to `null` correctly. Explicitly
  verified that a trap does **not** poison the module-level parser singleton: after a trap, the
  same instance parses a real recipe with 1 ingredient and an empty report. No change needed, but
  worth knowing — and all the trapping inputs are now refused before the parser anyway.
- **Parse timing is not deterministic across parser instances.** The same input measures 15 ms
  on a fresh `CooklangParser` and 16 786 ms on one with a grown heap. This is why the corpus
  asserts *refusal* for the pathological family rather than relying on a timing bound.
- **A `git stash` / `git stash pop` used for a baseline comparison misfired, twice over.** To get a
  baseline `i18n:check` the executor ran `git stash -u` -> check -> `git stash pop`. But tasks 1
  and 2 were already COMMITTED, so the tree was clean and `git stash -u` saved nothing; the
  subsequent `pop` therefore restored an **unrelated pre-existing stash** from an earlier session
  (`WIP chore/remove-dead-workos-admin-path (pre phase-12)`), dumping ~18 foreign files into the
  tree with one unmerged conflict. Two consequences, both handled:
  1. **The comparison was invalid** — it diffed the tree against itself and "byte-identical" was
     unearned. The gate table above now records what was actually verified: `no` (Norwegian) is the
     ONLY locale reporting missing keys, and `git diff f4420104 HEAD --name-only` matches no
     `packages/i18n` file, so ZERO new gaps is a sound claim by a sounder method.
  2. **The foreign stash was NOT lost.** Because the pop conflicted it was never dropped;
     `git stash list` still shows `stash@{0}` intact. The tree was restored surgically
     (`git checkout --` the foreign paths, remove the untracked leftovers) and
     `git diff HEAD -- . ':(exclude).planning'` is EMPTY, so no foreign change reached a commit.

  Recorded rather than quietly fixed, because the same pattern is a trap for the next executor:
  **do not use `git stash` for baseline comparisons on a repo with a pre-existing stash stack** —
  use `git worktree add` at the baseline sha, or assert structurally on `git diff --name-only`.

## User Setup Required

None.

## For the next executor — resume here

Tasks 3, 4 and 5 of `27-03-PLAN.md` are unstarted. Read the plan in full; it is still accurate
except where this SUMMARY overrides it. What has changed under your feet:

1. **`COOK_LIMITS` has ten keys.** If you add a limit, add its breach test AND its at-the-cap
   sibling, and update the `toHaveLength` assertion. `countMalformedCookTokens` is exported from
   `@norish/shared-server/cooklang/limits` if you need it.
2. **Task 2 is done, so Task 4's `coerceExtractionSteps` already exists** and is exported from
   `packages/api/src/ai/features/recipe-extraction/normalizer.ts`, along with `ExtractionStep`,
   `ExtractionIngredientRef` and `ExtractionTimerRef`. Task 4(a) step 2 is a no-op; start at
   step 3.
3. **Task 4 still owes `CookPayload` as a named export on
   `@norish/shared-server/cooklang/build-payload`** — it was not added, since nothing consumed it.
4. **Task 3 is untouched and independent.** `packages/api/src/ai/prompts/fragments/linkage.ts`
   does not exist. Neither `recipe-extraction.txt` has been edited (D-27-W3-01 holds) — confirmed
   by `git diff --stat`, and note the two `.txt` paths are hardlinked in this working tree, which
   makes an accidental edit doubly invisible.
5. **You owe weakenings W3-W2 and W3-W3.** W3-W1 and W3-W1b are done and recorded above; do not
   redo them. Both remaining ones need code that Tasks 4 and 5 create.
6. **You owe D-27-W3-07's five-fixture measurement.** The director is waiting on it for a real
   decision (pull W0's unit vocabulary forward or not). Do not skip it and do not relax its
   "same names, same count" assertion.
7. **The environment is healthy:** `node_modules/@norish/*` `src/` and `package.json` are
   SYMLINKS to the workspace source (W2's fix), so the R10 hoisted-linker trap did not fire for
   the new export-map entry and should not fire for yours. Verify rather than assume.

## Next Phase Readiness

**W3 is NOT ready to deploy and NOT code-complete.** T-27-01 — the wave's security spine, and the
item W3 inherited — is fully discharged and independently valuable: it hardens the parser door
that W2's read path already goes through, so it is safe and useful on live even with no producer.
But the wave's purpose (a first non-NULL `cook_source`) is unmet.

---
*Phase: 27-cooklang, plan 03 — PARTIAL (2/5 tasks)*
*Completed: 2026-07-25*

---
---

# Tasks 3–4 — the producer exists (second executor)

> **This section is ADDITIVE. The T1/T2 record above is the T-27-01 evidence and is
> unchanged.**
>
> ## STATUS: TASKS 3 AND 4 CODE-COMPLETE. **W3 IS STILL NOT CODE-COMPLETE — Task 5 is outstanding.**
>
> **A `.cook` producer now exists.** `buildCookFromExtraction` mints from per-step
> linkage, and `ExtractedRecipe { recipe, cook }` carries it from the three AI
> extractors into `createRecipeWithRefs(..., cook)`. **A newly AI-extracted recipe
> can now get a non-NULL `recipes.cook_source`** — the first time that is true in
> this codebase. Nothing else changed: a string-shaped extraction, a JSON-LD
> import, the python scraper, structured paste and the manual editor all pass no
> `cook` and behave exactly as before.
>
> Not done: **Task 5** (queue-side `cook-source-isolation.test.ts` + weakenings
> W3-W2 and W3-W3).

## Task Commits

3. **Task 3: the linkage prompt fragment, appended by all three builders** — `527a852d` (feat)
4. **Task 4: mint the `.cook` and thread it to the write path** — `49f03139` (feat)

Base for this session: `ca1a06a8` (the PARTIAL summary above). Tree clean, nothing pushed.

---

## Task 3 — the fragment (D-27-W3-01)

`packages/api/src/ai/prompts/fragments/linkage.ts` exports `buildLinkageInstruction()`,
appended by `buildRecipeExtractionPrompt`, `buildImageExtractionPrompt` and
`buildVideoExtractionPrompt` exactly like `buildAllergyInstruction` /
`buildLanguageInstruction`, and re-exported from `fragments/index.ts`.

- The text is ported **in substance verbatim** from
  `extraction-skill/assets/linkage-fragment.txt`, including the `✗`/`✓` COMMON
  MISTAKES block and the WORKED EXAMPLE. Thirteen named assertions, one per rule,
  in `packages/api/__tests__/ai/prompts/linkage-instruction.test.ts`.
- **Two additions, and only two**, as the plan specified: a `SHAPE:` sentence telling
  the model a step may be an object OR a plain string (D-27-W3-03), and rule 4
  upgraded to a hard full-coverage requirement on `recipeIngredient` (D-27-W3-04).
  Rule 4's original sentence is retained verbatim and the requirement is added to
  it, so nothing was dropped.
- **The no-op trap is proven closed:** one test per builder asserts the fragment is
  present *while `loadPrompt` is mocked to return an unrelated base prompt*
  (`"Zqx base template placeholder…"`), so the instruction demonstrably does not
  come from the server-config template.
- **Ordering is asserted for all three builders:** the fragment's index is less than
  the index of `WEBPAGE TEXT:`, `VIDEO TRANSCRIPT:` and `Analyze the provided images`
  respectively, so untrusted content never sits between the base prompt and its
  rules (T-27-08).
- **No `.txt` file is touched.** `git show 527a852d --stat` lists 4 files, none `.txt`.
  Confirming the prior executor's warning: the two `recipe-extraction.txt` paths are
  hardlinked in this tree, so an accidental edit would have been doubly invisible.
- A negative assertion keeps norish internals out of the model's context: the
  fragment contains no `cook_source`, no `.cook`, no `buildCookPayload`.

---

## Task 4 — the switch-on

### (a) `buildCookFromExtraction`

In `packages/api/src/ai/features/recipe-extraction/normalizer.ts`. Picks the NATIVE
system's step array and flat list (D-2), coerces via the existing
`coerceExtractionSteps`, then **four refusals, each of which costs the user nothing**:

| # | Refusal | Log level | `reason` |
|---|---|---|---|
| 1 | no step carries linkage (string-shaped extraction) | **debug** | `no-step-linkage` |
| 2 | a flat ingredient no step references (D-27-W3-04) | **error** | `incomplete-ingredient-coverage` |
| 3 | a size-cap breach — decided inside `buildCookPayload` | **error** | `input-too-large` |
| 4 | output that does not parse with an EMPTY report | **error** | `did-not-parse-cleanly` |

Every log carries counts only. Asserted by scanning the serialized logger payload
for the fixture's recipe name, step prose and each missing ingredient name — all
absent (T-27-05).

**The coverage matcher is loose in exactly two directions and no more:**
1. the ref appears in the flat line as a contiguous run of whole words
   (`"100 g plain flour"` ⊇ `"flour"`);
2. the ref **STARTS WITH** the flat entry (`"salt to taste"` covers `"salt"`).

Direction 2 is a **prefix** rule, not a substring rule, and that is load-bearing:
flat `"sugar"` must NOT be covered by ref `"brown sugar"` alone, because they are
different ingredients (W1's serializer sorts longest-name-first precisely so they do
not collide) and treating the longer as covering the shorter would let the projection
drop the plain-sugar row. All three cases are asserted, plus `"flourish"` is not
covered by `"flour"`.

### (b)–(d) The `ExtractedRecipe` channel

`ExtractedRecipe { recipe, cook }` — an explicit pair travelling ALONGSIDE the DTO,
never inside it. `CookPayload` is now a named export on
`@norish/shared-server/cooklang/build-payload` (the plan's outstanding item #3),
which is how `@norish/queue` names it without importing `@norish/api`.

Threaded: the three extractors → the whole video processor chain → `ParseRecipeResult`
/ `QueueParseRecipeResult` → `createRecipeWithRefs(..., cook ?? undefined)` in
`recipe-import`, `image-import` and `paste-import`. `createStructuredRecipe` passes
nothing. The python-scraper / JSON-LD / legacy branches set `cook: null` (D-27-W3-08).

### (e)/(f) The repository

- **D-27-W3-05:** the `cook` branch of both `createRecipeWithRefs` and
  `updateRecipeWithRefs` writes the opposite system's authored step prose (via the
  existing `createManyRecipeStepsTx` / `syncRecipeStepsTx`) **before**
  `deriveProjectionTx` runs. No overlap — `deriveProjectionTx` owns native steps only.
- **D-27-W3-06:** `updateData.cookSource = cook ? cook.cookSource : null`, so an
  ordinary no-`cook` update NULLs a stale `.cook`.
- **(g) No fourth dedup rule.** Asserted: a `.cook` naming the same ingredient in two
  steps writes ONE row.

---

## THE DEFECT TASK 4 FOUND AND FIXED AT THE ROOT

**`computeCookProjection` silently dropped the AMOUNT of a split-amount ingredient.**

Found by the D-27-W3-07 measurement (it is exactly what the measurement was for).
The `curry` fixture mentions coconut milk bare in step 0 and quantified
(`400 milliliter`) in step 1. The collapse rule was "first occurrence wins", so the
bare mention won and the row was written with `amount: null, unit: null` — **in BOTH
systems**, because `derived` is built from `native`.

On a real import that is an amount the legacy path writes today and the cook path
would not: a **never-broken violation**, dormant only because nothing produced a
`.cook` before this task.

Fixed at the root in `packages/db/src/repositories/cook-projection.ts`: when the
existing row carries no amount and the new token does, adopt the only measure
present. This is not the "two incompatible measures" case the fall-through guards —
there is only one measure. Also narrowed the `mixed-units` flag to genuine
measure-vs-measure disagreement, so a trailing bare mention (which the prompt's own
rule 1 *asks for*) no longer fills W5's confidence signal with noise.

Four new tests in `cook-projection.test.ts`: the bare-then-quantified case, the
reverse order, that two genuinely incompatible measures are still refused and still
flagged, and that two same-unit refs still SUM. `coconut milk` went from
`null null` to `1.690701 cup`.

**This is outside `files_modified` and is recorded as a deviation below.**

---

## D-27-W3-07 MEASUREMENT — the director's decision item

Measured with the real serializer, the real WASM parser and the real
`computeCookProjection`, over the five committed fixtures
(`packages/shared/__tests__/cooklang/fixtures.ts`), each given an AI-style US flat
ingredient list that reuses the metric refs' ingredient WORDS so the comparison
isolates units rather than naming.

**HARD assertion, passing for all five: same ingredient names, same count. NO
ingredient is lost.** 35 ingredients across 5 recipes, 35 derived.

### VERDICT: YES — the derived US output IS worse than the AI's. 18 of 35 differ.

| fixture | ingredients | differences | detail (`AI` → `derived`) |
|---|---:|---:|---|
| pancakes | 5 | 3 | flour `1.667 cup` → `7.054792 ounce`; milk `1.25 cup` → `1.268026 cup`; butter `1 tablespoon` → `0.529109 ounce` |
| bolognese | 9 | 4 | minced beef `1 pound` → `1.102311 pound`; chopped tomatoes `14 ounce` → `14.109585 ounce`; spaghetti `14 ounce` → `14.109585 ounce`; parmesan `0.5 cup` → `1.763698 ounce` |
| guacamole | 6 | 1 | cilantro `0.333 cup` → `0.35274 ounce` |
| cookies | 8 | 5 | butter `0.5 cup` → `4.056506 ounce`; sugar `0.5 cup` → `3.527396 ounce`; brown sugar `0.75 cup` → `5.291094 ounce`; flour `2 cup` → `8.81849 ounce`; chocolate chips `1.25 cup` → `7.054792 ounce` |
| curry | 7 | 5 | coconut milk `1.667 cup` → `1.690701 cup`; chicken `1 pound` → `1.102311 pound`; bamboo shoots `7 ounce` → `7.054792 ounce`; Thai basil `0.5 cup` → `0.529109 ounce`; rice `1.5 cup` → `10.582189 ounce` |

**Three distinct axes of degradation, in priority order:**

1. **UNIT CATEGORY — the serious one. Every dry good the model measures in `cup`
   becomes `ounce`.** 11 of the 18 differences. `2 cup flour` → `8.81849 ounce`;
   `1.25 cup chocolate chips` → `7.054792 ounce`. Numerically defensible, but no US
   home cook measures flour by the ounce, and this is precisely the
   `kilogram` / `fl oz` / `pint` vocabulary gap W2-SUMMARY flagged as "still open".
   **`fl oz` and `pint` are never produced at all.**
2. **PRECISION — cosmetic but user-visible on every single converted row.** The
   derived values are unrounded 6-decimal conversions: `1 pound` → `1.102311 pound`,
   `14 ounce` → `14.109585 ounce`, `1.25 cup` → `1.268026 cup`. A recipe reading
   "14.109585 ounce spaghetti" is worse than one reading "14 oz", even where the unit
   is right. **There is no rounding step in `deriveConversion`'s output path.**
3. Volume→volume conversion does work (`milliliter` → `cup`), so the gap is
   specifically mass↔volume vocabulary, not the converter itself.

### RECOMMENDATION TO THE DIRECTOR

**D-27-W3-07 (keep dual-system extraction; defer single-system to W5) is CONFIRMED by
measurement, not assumed.** Switching to single-system extraction today would ship
visibly worse US output on 18 of 35 ingredients.

**Both the W0 unit-vocabulary work AND a rounding/presentation rule should land before
W5 enables single-system extraction.** The vocabulary alone is not sufficient — axis 2
would survive it.

---

## Refusal rates observed

- **Coverage gate on the five fixtures: 0/5 refused.** All five mint a `.cook` when
  the flat list and the per-step refs use the same ingredient words.
- **Parse-failure (`did-not-parse-cleanly`) rate: 0/5.** All five round-trip with an
  EMPTY diagnostic report, as W1/W2 established.
- **Size-cap (`input-too-large`) rate: 0/5**, unchanged from the T1/T2 record.
- **Synthetic 8-of-11 coverage case: refuses as designed**, with
  `flatCount: 11, missingCount: 3` and no names.
- **A MEASURED REFUSAL DRIVER FOR W5 — singular/plural.** A model that writes
  `"2 eggs"` in `recipeIngredient` and `"egg"` in a step's refs earns **no `.cook`**.
  Found because my own first fixture did exactly that. Nothing is lost when it
  happens (legacy projection, successful import), and I deliberately did **not** add
  morphological matching: an `-s` rule is English-specific in an app whose own
  extraction fragment uses Dutch examples (`gehakt`, `tomatenpuree`), so it would
  behave inconsistently by locale and could newly collide names the way
  `sugar` / `brown sugar` must not. The rule stays exact in W3 and the behaviour is
  pinned by a named test
  (`does NOT bridge a singular/plural mismatch — a known, recorded refusal driver`).
  **This is a prompt/eval item for W5, which owns both the backfill and the harness.**
  Real-world refusal rate cannot be known until the director watches the two
  error-level logs after deploy (W3 exit item #3).

---

## Gates — measured post-T2 baselines vs post-T4

| Gate | Baseline (post-T2) | After tasks 3–4 | |
|---|---|---|---|
| `pnpm typecheck` | 17/17 EXIT 0 | **17/17 EXIT 0** | but see the finding below |
| real `tsc --noEmit`, `packages/api` | not previously run | **CLEAN, 0 errors** | the genuine threading check |
| real `tsc --noEmit`, `packages/queue` | not previously run | **CLEAN, 0 errors** | |
| `@norish/api` | 361 passed | **408 passed** (+47) | +22 Task 3, +25 Task 4 |
| `@norish/queue` | 88 passed | **88 passed** | |
| `@norish/shared-server` | 333 passed | **334 passed** (+1) | see Issues — not attributable to this diff |
| `@norish/db` (docker) | 164 passed / **1 failed** | **178 passed / 0 failed** | +13 mine; the pre-existing red was a STALE-`node_modules` ARTEFACT and now passes |
| `@norish/trpc` | 335 passed | **335 passed** | |
| `@norish/shared` | 295 passed | **295 passed** | |
| `@norish/web` | 424 passed | **424 passed** | |
| `@norish/mobile` | 132 passed | **132 passed** | |
| lint `@norish/api` | 0 errors, 97 warnings | **0 errors, 97 warnings** | new files contribute 0 |
| lint `@norish/queue` | — | **0 errors, 85 warnings** | |
| lint `@norish/shared-server` | 0 errors, 57 warnings | **0 errors, 57 warnings** | |
| lint `@norish/db` | — | **0 errors, 62 warnings** | |
| `check-workspace-imports.mjs` | EXIT 0 | **EXIT 0** | `@norish/db` stays parser-free |
| `pnpm --filter @norish/web build:server` | EXIT 0 | **EXIT 0** | parser still `external` |
| `pnpm i18n:check` | EXIT 1, `no` gap only | **EXIT 1, `no` ONLY, 68 keys, ZERO NEW** | diff touches no `packages/i18n` file |
| `git diff pnpm-lock.yaml` | — | **EMPTY** | no dependency added (T-27-SC) |

**Net-new tests this session: +60** (22 prompt-fragment, 25 cook-payload incl. the
5-fixture measurement, 9 cook-write-path, 4 cook-projection).

### Additive-safety / never-broken checks

- No file under `apps/`. No `*.txt` prompt template. No `packages/db/src/migrations/`,
  no `meta/_journal.json`, no `*_snapshot.json`. **DB stays at migration 42**; the
  planned `0042` / `0043` sequence is untouched (D-27-W3-10).
- `packages/db/package.json` and `packages/shared/package.json` dependencies unchanged.
  `deriveProjectionTx` still takes a `CookTokensDTO`; no call site passes a string.
- **No `as any`, `@ts-ignore` or `@ts-expect-error` in the diff** (R11). Two `as any`
  casts were written first, matching the local pattern in `recipes.ts`, then REMOVED
  once a real `tsc` proved they were unnecessary.
- No `cook_confidence` / `cook_review_needed` write anywhere (D-27-W3-09).
- **No `COOK_LIMITS` value moved**, and **no third door to the parser was opened** —
  `buildCookFromExtraction` reaches the parser only through `buildCookPayload`.
- No tRPC input schema changed; `grep` over `packages/trpc/src/routers/recipes/`
  finds no `cook*`/`linkage` input key.
- No new `emitByPolicy` / `emitter.*` call site; no emit payload gained a field.

---

## Decisions Made

| # | Decision | Rationale |
|---|---|---|
| **D-27-W3-E5** | The coverage matcher's second direction is a **PREFIX** rule, not a substring rule. | `"salt to taste"` must cover `"salt"` while `"brown sugar"` must NOT cover `"sugar"`. A substring rule satisfies the first and breaks the second, and the second is the one that protects a row from being dropped. Implemented as a whole-word token comparison (split on non-alphanumerics) rather than a regex, so it is Unicode-safe for the fork's non-English recipes. |
| **D-27-W3-E6** | **No morphological (singular/plural) matching.** | English-specific in a multilingual app; would risk new name collisions. A refusal costs nothing. Pinned by a named test and handed to W5 as a prompt/eval item. |
| **D-27-W3-E7** | Fix the split-amount projection defect **at the root** in `computeCookProjection` rather than refusing the mint. | The alternative was a fifth refusal reason, which would have disabled the `.cook` for a pattern the extraction fragment's own rule 1 explicitly asks the model to produce. Losing a stated amount is a never-broken violation; the fix is four lines and does not touch the genuine incompatible-measures guard. |
| **D-27-W3-E8** | The video processor chain is threaded in full (9 files), not the 5 the plan listed. | `VideoProcessor.process` returns the payload, so `types.ts`, `base-processor.ts`, `processor.ts` and `processors/facebook.ts` MUST change or nothing compiles. Not scope creep — the plan's file list was incomplete for its own design. |
| **D-27-W3-E9** | `packages/api/src/video/instagram.ts` was threaded even though `processInstagramImagePost` has **no non-test caller** (superseded by `processors/instagram.ts`). | It calls `extractRecipeWithAI`, so it must compile. Flagged as dead code a later wave could delete; NOT deleted here (out of scope). |
| **D-27-W3-E10** | Two test files' MOCKS were updated: `import-flow.test.ts` and `image-import/worker.test.ts`. | Required by the changed return contract, not an assertion relaxation — see Deviations. |

---

## Deviations from Plan

**1. [Rule 2 — Missing Critical] Four extra video files.** D-27-W3-E8. Required by the
plan's own threading design.

**2. [Rule 1 — Bug, fixed at root] `packages/db/src/repositories/cook-projection.ts`
and `cook-projection.test.ts`, outside `files_modified`.** The split-amount amount-loss
defect. Called out loudly above because it is a never-broken issue that only W3's
producer makes reachable.

**3. [Test contract, NOT an assertion relaxation] Two mocked test files had to change.**
The plan's Task 2 criterion asked that `import-flow.test.ts` pass **unedited**; that
held for Task 2 and **cannot** hold for Task 4, because Task 4 changes the return type
of the very producers that file mocks.
- `packages/api/__tests__/server/parser/import-flow.test.ts`: the mocked
  `extractRecipeWithAI` / `processVideoRecipe` now resolve `{ recipe, cook: null }`
  instead of a bare DTO, and the 7 `toEqual` expectations gained `cook: null`.
- `packages/queue/__tests__/image-import/worker.test.ts`: same for the mocked
  extractor, plus the `createRecipeWithRefs` expectation gained the trailing
  `undefined` argument.
**No behavioural assertion was weakened or removed.** Both files caught real
mismatches during this task, which is exactly what they are for.

**4. [Scope — INCOMPLETE] Task 5 was not executed.** By instruction: this executor's
scope was Tasks 3 and 4 only, and a separate agent takes Task 5.

---

## Issues Encountered

### 1. `pnpm typecheck` DOES NOT TYPE-CHECK `packages/api` — verified adversarially

**The plan states "`pnpm typecheck` is the completeness check for (b)/(c)". It is not.**
Proven: a blatant `const blatant: number = "not a number";` appended to
`packages/api/src/startup/register-queue-api-handlers.ts` left `pnpm typecheck` at
**17/17 successful**. So did reverting `QueueApiHandlers.extractRecipeWithAI` to the
old `AIResult<FullRecipeInsertDTO>` return type.

Cause: **six of the seventeen typecheck scripts pass `--noCheck`** —
`packages/api`, `packages/queue`, `packages/shared-server`, `packages/auth`,
`packages/shared-react`, `apps/mobile` (plus `packages/trpc`, which uses
`tsc -p --noCheck`). `--noCheck` disables type checking outright. This is pre-existing
upstream configuration, not something this wave introduced.

**How the threading was actually verified instead:** a genuine
`pnpm exec tsc --noEmit` (no `--noCheck`) inside `packages/api` and
`packages/queue` — **both CLEAN** — and the same command with the `QueueApiHandlers`
weakening reapplied produced **8 real errors** across `image-import/worker.ts` and
`paste-import/worker.ts` (`Property 'recipe' does not exist on type …`). So the
`ExtractedRecipe` thread IS type-verified end to end; just not by the repo's own
`typecheck` script. Both weakenings were reverted;
`git status --porcelain` was EMPTY after each.

**Recommendation for the director:** this is a standing hole in the fork's gates that
made two of this wave's risks (R11 especially) unverifiable by the prescribed command.
Worth its own small plan — the real `tsc --noEmit` is clean for both packages *today*,
so dropping `--noCheck` there may be a one-line change.

### 2. `node_modules` INJECTED-WORKSPACE CORRUPTION — caused by me, diagnosed, repaired

Recorded in full because it cost real time and the next executor must not repeat it.

`node_modules/@norish/{api,queue}` were symlinks to `node_modules/.norish-injected/*`
**hardlink farms** whose directories are root-owned and unwritable by the `claude`
user. The prior executor's handoff note #7 said these were symlinks to the workspace
source — **that was true for `db`, `shared` and `shared-server`, and FALSE for `api`
and `queue`.**

Three separate problems, in order:

1. **The farm was already stale in a way that mattered.** It predated W2:
   `queue/src/recipe-import/progress.ts` did not exist in it at all. It also could
   never contain Task 3's new `api/src/ai/prompts/fragments/linkage.ts`, because new
   files cannot be created there without root.
2. **I destroyed 13 source files.** Trying to refresh the farm I ran
   `cat "$src" > "$dest"`. For hardlinked pairs `$src` and `$dest` are the SAME inode,
   so the shell truncated the file before `cat` read it. 13 files under
   `packages/api/src` and `packages/queue/src` were emptied. **This was invisible to
   `pnpm typecheck` (17/17 green — see Issue 1) and only surfaced as
   `TypeError: parseRecipeFromUrl is not a function` in unrelated suites.** Recovered
   by restoring each from `git show HEAD:<path>` **in place** (`> file`, preserving
   the inode and therefore the hardlink) and replaying the edits, which were scripted
   and therefore reproducible. Verified afterwards: no empty files, and every touched
   file either LINKED or content-identical to its farm copy.
3. **Pushing the current worker into the stale farm broke `@norish/trpc`** —
   `Cannot find module './progress'` made `cook-tokens-isolation.test.ts` and
   `recipes.test.ts` fail to COLLECT (trpc dropped 335 → 279 with 3 files erroring).

**Repair (environment only, nothing tracked by git):** repointed
`node_modules/@norish/api` → `../../packages/api` and
`node_modules/@norish/queue` → `../../packages/queue`, i.e. an ordinary workspace
link instead of an injected hardlink farm. Immediately after: `@norish/trpc` back to
**exactly 335**, the real `tsc` clean for both packages, and **the `@norish/db`
"pre-existing" failure disappeared** — `cleanup-workflows.test.ts` had been failing
against a stale `@norish/api` snapshot, not against a real defect.

**THREE THINGS THE NEXT EXECUTOR MUST KNOW:**
- **NEVER `cat src > dest` (or `cp src dest`) between a workspace file and its
  `node_modules` copy.** They may be the same inode; the redirect truncates the source.
- **You do not need to sync anything.** Because they are hardlinks, an in-place edit is
  already live (CLAUDE.md's own gotcha). The Edit tool and `git checkout` BREAK the
  hardlink; `python write_text` / `> file` preserve it.
- **The `@norish/{api,queue}` links now point at the workspace source.** If someone
  runs `pnpm install` they may revert to the injected farm, at which point Task 3's
  `linkage.ts` becomes invisible to cross-package resolution again. If `@norish/trpc`
  or `@norish/db` suddenly go red with "cannot find module" or "is not a function",
  check the links first.

**The shipped Docker image is NOT affected by any of this.** `docker/Dockerfile` does
`COPY . .` plus its own `pnpm install` inside the image, so it builds from
`packages/`, and Task 3's fragment will be present.

### 3. `@norish/shared-server` measures 334, previously recorded as 333

+1 with no shared-server test added by this diff (only `build-payload.ts` changed, by
adding the `CookPayload` interface). Most plausibly the same stale-`node_modules`
effect as the `@norish/db` red. Flagged rather than explained away; the suite is fully
green either way.

### 4. `format:check` was already red for most of the files this task touches

Verified properly (via `git show HEAD:<path> | prettier --check --stdin-filepath <path>`,
so config resolution uses the real path): `normalizer.ts`, `cook-projection.ts`,
`recipes.ts`, `build-payload.ts` and `cook-projection.test.ts` were **already**
prettier-dirty at `HEAD`, as was `prompts/builder.ts`. I therefore did **not** run
`prettier --write` over them — that would have added large unrelated reformatting
churn to this diff. The two files that were prettier-CLEAN at baseline
(`cook-write-path.test.ts`) plus both NEW test files were formatted, and are clean.
This matches the pre-existing finding already in `STATE.md` that the repo's CI
"Format Check" job is non-functional by construction.

**Note:** `git stash` was NOT used at any point (the prior executor's trap). Baseline
comparisons used `git show <sha>:<path>` and `prettier --stdin-filepath`.

---

## What Task 5 must now pick up

**Files that now exist for you to attack:**
- `packages/api/src/ai/prompts/fragments/linkage.ts` — the fragment.
- `packages/api/src/ai/features/recipe-extraction/normalizer.ts` —
  `buildCookFromExtraction`, `ExtractedRecipe`, `CookPayload` (re-exported).
- `packages/shared-server/src/cooklang/build-payload.ts` — `CookPayload` is now a
  named export.
- `packages/queue/src/api-handlers.ts` — `QueueExtractedRecipe`, and
  `QueueParseRecipeResult.cook`.
- `packages/queue/src/{recipe-import,image-import,paste-import}/worker.ts` — all three
  now pass `cook ?? undefined` to `createRecipeWithRefs`.
- `packages/db/src/repositories/recipes.ts` — the D-27-W3-05 opposite-system step write
  and the D-27-W3-06 `cookSource: null`.

**Task 5's own file does NOT exist yet:**
`packages/queue/__tests__/recipe-import/cook-source-isolation.test.ts`.

**What the isolation suite must attack (all five cases, EACH with a `view: "household"`
AND a `view: "everyone"` sibling — AGENTS.md, and four historical leaks hid behind
suites that only seeded `household`):**
1. an import into cookbook A that mints a `.cook` writes `cook_source` on THAT recipe
   only; a recipe seeded in cookbook B is byte-identical afterwards (row ids,
   `updated_at`, `version`, `cook_source`);
2. a **PERSONAL** import (`householdId: null`) mints and stores for the importing user,
   while a member of cookbook B, a total stranger with no cookbook, and the
   `userId: null` orphan branch all get `NOT_FOUND` — **assert on the ABSENCE OF THE
   RECIPE TEXT**, not merely the error code;
3. the `imported` realtime payload carries **no** `cook*` key and no substring of the
   `.cook`, for a recipe that HAS a `cook_source`;
4. `recipes.list` / the dashboard exposes no `cookSource`/`cookTokens` for a viewer who
   CAN see a recipe that has one;
5. plus the `userId: null` orphan case as its own named test.

Mirror `dedup-isolation.test.ts`'s harness: real `resolveRecipeRealtimeScope` and real
`emitByPolicy`, only their data sources mocked. **Never mock the boundary.**

**Weakenings you still owe** (W3-W1 and W3-W1b are DONE — see the T1/T2 record above;
do not redo them):
- **W3-W2:** make `buildCookPayload` return `{ cookSource, cookTokens: [] }` instead of
  `null` when `parseCookSource` fails. Must turn RED:
  `packages/shared-server/__tests__/cooklang/build-payload.test.ts` **and**
  `packages/api/__tests__/ai/features/recipe-extraction/cook-payload.test.ts`'s
  `returns null with a did-not-parse-cleanly log, and no recipe prose`.
- **W3-W3:** add `cookSource` to the `imported` event payload in
  `recipe-import/worker.ts`. Must turn RED: your new `cook-source-isolation.test.ts`.

**Before you start:** verify `ls -l node_modules/@norish/{api,queue}` still points at
`../../packages/{api,queue}` (Issue 2). And read Issue 1 — do not trust
`pnpm typecheck` to catch a type error in `packages/api`, `packages/queue`,
`packages/shared-server` or `packages/trpc`; run a real `pnpm exec tsc --noEmit`
inside the package.

**Do NOT write `waves/W3-SUMMARY.md` until Task 5 lands.** W3 is not code-complete and
must not be marked so.

---

## T-27-01 root-cause fix

**Status: the tenth cap is GONE.** An independent adversarial verifier FAILED the
`maxCookMalformedTokens: 8` mitigation recorded in the T1/T2 section above, and
refuted both of its load-bearing claims with working repros. This section records
what replaced it. The T1/T2 record is left intact as history; where it and this
section disagree, **this section is current**.

### The root cause

`.cook` is a **syntax-bearing format** and `@ # ~ { } % = > -` are its
metacharacters. `serialize.ts` emitted step prose **verbatim** (`let text =
step.text`) and `normalizer.ts` passed model output through unsanitized, so
untrusted, model-shaped text was being **injected** into that syntax — structurally
identical to SQL or HTML injection. Everything downstream followed from that: the
WASM parser renders a diagnostic per malformed token, each diagnostic quotes the
whole line it sits on, and the resulting report crosses the WASM boundary, so
injected junk buys seconds of CPU and hundreds of megabytes of string.

`countMalformedCookTokens` tried to **predict** which injected prose the parser
would object to — to reimplement the parser's grammar with a regex — which is
necessarily **incomplete** and **over-broad**. The verifier demonstrated both:

| refutation | measured |
|---|---|
| **(a) no time bound.** 16 step texts of 3 996 chars (under `maxStepTextChars`) of `@a{1%} `, 63 966 bytes. The brace closes, so the counter scored it **0 malformed** and both gates returned `null`. | **11 118 ms**, a **150 MB** diagnostic report (re-measured on this tree; the verifier saw 9 852 ms / 143.7 MB) |
| **(b) wrong refusals.** A 536-byte, 9-step `Grandma's Pot Roast` in ordinary US shorthand ("Preheat the oven @ 325", "a 3 # chuck roast", "reduce ~ 10 minutes") scored **12 > 8 → REFUSED**. | the real parser handles it in **13 ms with an EMPTY report** |

Predicting a parser is the bandaid. The boundary is the **serializer**.

### The mechanism chosen

**1. Escape by construction (`packages/shared/src/cooklang/serialize.ts`).**
`escapeCookText` backslash-escapes every Cooklang metacharacter in every piece of
text norish did not author as a token: step prose, section-heading text, ingredient
and timer **names**, **amounts** and **units**. Verified against
`@cooklang/cooklang@0.18.7`: `\X` is a **general** escape — the parser drops the
backslash and keeps `X` as literal text, in prose, in a heading, in a token name and
inside a `{amount%unit}` body alike — so the escaping is **losslessly reversible**.
`sanitizeTokenName`'s old *strip* of `@{}~#%` is gone: stripping silently rewrote the
name the user typed **and**, because the token replaces that name in the prose, the
step they read.

`serializeStepLine` was restructured from one mutable string into a sequence of
`prose` / `token` fragments, because the two halves need opposite treatment (prose
must be escaped, a token must not). That also fixed a latent corruption: with a
single mutable string, a ref named `gram` could match the `%gram}` of an
already-emitted token.

**2. No dialect extensions (`parse.ts`).** The parser singleton now sets
`extensions = 0`. norish writes only CORE Cooklang, so nothing is lost — and it buys
round-trip fidelity: with the default mask (`3818`) the parser lexes **prose numbers**
into `inlineQuantity` items and re-formats them, so `Bake at 180°C` came back as
`Bake at 180 °C` and `Add 1.50 kg` as `Add 1.5 kg`. The W1 read model was silently
rewriting text the user typed; W4 renders from that read model.

**3. Frontmatter is quoted, and quoting is decided by the KEY.** Metadata is YAML,
not Cooklang, so it is quoted rather than escaped. Two defects were closed here:
a value carrying a **newline** (a model-supplied recipe name) broke out of the
frontmatter block and injected arbitrary `.cook` body; and YAML forbids raw
**control characters** even inside quotes. Only `servings` is numeric-typed by
Cooklang, so only `servings` is emitted raw — deciding from the *value* was itself a
bug, since a recipe literally titled `1.50` produced `title: 1.50` and the parser
reported `Unsupported value for key: 'title'`.

**4. `findCookSourceDefect` replaced the tenth cap** (`limits.ts`). It is an
**output-integrity assertion, not an input heuristic**: a strict, single-pass,
no-backtracking recognizer for the serializer's own output grammar (frontmatter
lines, `== heading ==`, and an alternation of escaped prose and well-formed
`@`/`#`/`~` tokens). It does not predict the parser; it asserts the invariant the
escaper establishes. Enforced **inside** `buildCookPayload` (error level — a failure
means the *serializer* regressed) and **inside** `parseCookSource` (warn level), i.e.
still the same two doors. No third door.

### What happened to `maxCookMalformedTokens`

**DELETED.** `COOK_LIMITS` is back to the nine originally planned caps at their
planned values; none was weakened, raised, relaxed or removed. `countMalformedCookTokens`
is deleted with it.

The time bound no longer comes from a signature. It comes from a **checked
precondition**: a source that passes both gates is at most 64 KiB of *provably
serializer-shaped* Cooklang, and a serializer-shaped source has **zero** malformed
tokens, hence zero diagnostics, hence none of the O(malformed x line length) report
construction that is the only reason the parser is ever slow. Soundness in both
directions is a test, not a claim (see below).

### The escaping scheme, and its round-trip proof

Escape set: `\ @ # ~ { } % = > -` (the `\` first — one `String.replace` over a
character class, so inserted backslashes are never re-examined). `--`, `[-`, `-]`,
`==` and `>>` are all neutralized by escaping their single characters.

One deliberate normalization: **CR/LF in step prose folds to a space.** A newline is
not a corrupt character, it is a **structural** injection (`\n\n` starts a new step,
`\n== x ==` a new section), so it cannot be escaped away. Everything else — TAB, NUL,
CJK, accents, emoji, combining marks — survives byte-identically.

`packages/shared-server/__tests__/cooklang/round-trip-fidelity.test.ts` (45 tests) is
the proof, running the REAL serializer and the REAL WASM parser:

- **27 named cases** byte-identical, including all three US-shorthand sigils, the
  `~10 minutes` WASM-trap prose, `180°C`, `1.50 kg`, `1/2`, `50%`, `2-3`, `--`,
  unbalanced `{` and `}`, a whole token as literal prose, `== Dough ==` as literal
  prose, `>> servings: 4`, `[- comment -]`, CJK, accents, emoji, combining marks,
  TAB, NUL and a non-breaking space;
- **an exhaustive sweep**: every one of the 32 ASCII punctuation characters in 9
  construct-starting positions (mid-word, space-delimited, line-start, line-end,
  doubled, alone) — this is what makes the escape set provably **exhaustive** rather
  than guessed, and it is what will go red if a parser upgrade adds a metacharacter;
- **every adjacent PAIR** of the 10 metacharacters (100 combinations);
- prose **around** a real ingredient token, an ingredient **name** carrying `#`/`%`,
  and a section **heading** carrying `==`/`%`, all byte-identical;
- the two normalizations asserted rather than hidden, plus proof that a
  newline-bearing step or recipe **name** cannot inject a step, a section, a token or
  a frontmatter break;
- **the one irreducible loss, documented:** an unpaired UTF-16 surrogate becomes
  U+FFFD crossing into UTF-8 WASM. Nothing at this layer can fix that and no valid
  text contains one.

**Soundness — "no legitimate refusal":** a generative sweep puts each of 40 hostile
strings (every metacharacter, sigil runs, `@a{1%}`, `~{5}`, `== h ==`, `>> k: v`,
`---`, embedded newlines, `180°C`, CJK, emoji, NUL, blank) in turn into step prose, an
ingredient **name**, an **amount**, a **unit**, a **timer**, a **heading** and the
**recipe name**, and asserts `findCookSourceDefect` returns `null` and the parser
returns a read model, in every position.

Two real bugs fell out of that sweep and are fixed: `findNameIndex` **spun forever**
on a blank ingredient name (`indexOf("", 0)` is always 0, so the loop never
advanced), and a timer with an empty amount or unit emitted `~{%min}` / `~{5%}`,
which cost the whole recipe its `cook_source`. A blank-named ingredient ref is now
**refused** rather than dropped — dropping it would drop an ingredient ROW, because
`deriveProjectionTx` builds rows from the tokens.

### Hostile-corpus timings (all families, measured on this tree)

The `limits.test.ts` corpus grew from 19 to **25** entries, now including every
family the heuristic let through. `refused` is asserted per entry, together with a
**0-invocation parser spy** and an explicit elapsed-time check.

| family | bytes | now | before |
|---|---:|---|---|
| **the verifier's exact bypass**: 16 x 3 996 of `@a{1%}` | 63 966 | **refused in 1.3 ms** (`malformed-token`) | 11 118 ms / 150 MB report |
| the same on ONE 64 KiB line | 65 534 | refused, < 1 ms | seconds |
| `~{5}` / `~a{5}` floods (brace-closed, unit-less) | 65 532 | refused, 0.3 ms | scored 0 malformed |
| `~10 minutes` in a 32 KiB line (**the WASM-trap class**) | 32 781 | refused, 7.4 ms | `RuntimeError: unreachable` |
| `~10 minutes` flood | 65 532 | refused, 0.2 ms | WASM trap |
| dense `@` / `#` / `~` / `%`, `@a{`, `}`, `@a{@b{@c{`, `##`+long line, `~~`+long line, sigil soup, `>> a: b` | <= 65 536 | all refused, <= 4.2 ms | 4 s - 35 s |
| ACCEPTED: `@a{1%g} ` x 8 192 — **the worst accepted shape** | 65 536 | **648.8 ms** | — |
| ACCEPTED: `#a ` x 21 845 | 65 535 | 528.3 ms | — |
| ACCEPTED: `~{1%min} ` x 7 281 | 65 529 | 102.1 ms | — |
| ACCEPTED: 64 KiB of escaped prose (every metacharacter) | 65 520 | 5.5 ms | — |
| ACCEPTED: one 60 000-byte token, astral plane, NUL, lone surrogates, 200 steps x 3 refs | <= 65 536 | <= 30.5 ms | — |

**Worst timing across ALL families: 648.8 ms**, a **3.1x** margin under the 2 000 ms
budget. The plan's criterion — "a hostile corpus at the caps neither throws nor
exceeds 2 000 ms" — is satisfied, and satisfied by a checked precondition rather than
by a signature.

### Recomputed refusal rates (the T3/T4 figures were measured under the broken cap)

Re-derived with the real serializer, the real WASM parser, the real caps and the real
`buildCookFromExtraction`, over the five committed fixtures:

| gate | rate | note |
|---|---|---|
| size-cap (`input-too-large`) | **0/5** | fixtures serialize to 225 / 308 / 437 / 452 / 506 bytes — **unchanged by escaping**, because real recipe prose carries no metacharacters |
| **`not-serializer-shaped` (the new gate)** | **0/5** | all five accepted |
| parse-failure (`did-not-parse-cleanly`) | **0/5** | all five round-trip with an EMPTY report |
| coverage gate (D-27-W3-04) | **0/5** | unchanged |

**The verifier's pot roast now earns a `cook_source`.** 488 bytes, no defect,
`buildCookPayload` MINTS, 9 token steps. Its `.cook` reads
`Preheat the oven \@ 325 degrees.` and renders back as `Preheat the oven @ 325 degrees.`

The D-27-W3-07 measurement above is unaffected: it concerns unit conversion, not
serialization, and `packages/api`'s suite is unchanged at 408 passing.

### Adversarial weakening — RED, then reverted byte-identical

Two weakenings, neither committed. Reverted with `git checkout --`; `md5sum -c`
matched both source files and the staged patch compared **byte-identical** with
`cmp` (74 412 bytes before and after). `git stash` was never used.

**W3-W4 — weaken the ESCAPER.** Remove `@` from the escape set:
`const COOK_METACHARACTERS = /[\\@#~{}%=>-]/g;` becomes `/[\\#~{}%=>-]/g`.
**14 tests RED**, in `round-trip-fidelity.test.ts` and `limits.test.ts`:
`US shorthand: at` · `a whole token, as literal prose` · `every metacharacter at
once` · `an already-escaped-looking sequence` · `survives every ASCII punctuation
character in every construct-starting position` · `survives every ADJACENT PAIR of
metacharacters (the two-character constructs)` · `keeps the prose AROUND a real
ingredient token byte-identical` · `escapeCookText is the exact inverse the parser
expects (no double-escaping)` · `survives every hostile string as step PROSE` ·
`... as an ingredient NAME, AMOUNT and UNIT` · `... as a HEADING and as the recipe
NAME` · `folds CR/LF in step prose to a single space` · `a newline-bearing step
cannot inject a step, a section or a token` · `does NOT refuse ordinary US shorthand
once the serializer has escaped it`.

**W3-W5 — weaken the RECOGNIZER.** Insert `if (cookSource) return null;` as the
second statement of `findCookSourceDefect`, so it accepts everything.
**25 tests RED**, and — the point — the elapsed-time assertions blew the budget on
exactly the families the heuristic used to let through: the verifier's bypass at
**3 915 ms**, dense `@` at **4 414 ms**, dense `~` at **3 638 ms**, `@a{` at 2 107 ms,
`@a{@b{@c{` at 1 585 ms, plus 8 `findCookSourceDefect` unit tests and 17 corpus
entries failing their 0-invocation spy assertion.

### Decisions taken, that a later wave must not relitigate blindly

- **`#` cookware tokens are ACCEPTED by the recognizer** although the serializer never
  emits one. They are well-formed, diagnostic-free and fast; `toCookTokens` has a
  branch that keeps cookware readable in the prose; and prose can no longer produce
  one by accident now that `#` is escaped. `parse.test.ts`'s `#oven{}` fixture keeps
  passing unedited.
- **`extensions = 0` is a behaviour change to the READ model**, deliberately: prose
  numbers are no longer lexed into `inlineQuantity`. W4's renderer benefits; nothing
  regressed (all 174 cooklang tests, 389 shared-server, 408 api pass).
- **A `#`-leading step is still norish's in-band heading convention** (W2-E5) and is
  therefore excluded from the prose sweep and covered by its own case.
- **Escaping does not inflate real recipes**, so no cap needs revisiting. A
  pathological all-metacharacter step could double in size and breach
  `maxCookSourceBytes` — which costs only the `.cook`, never the import.
- **Nothing was added to `normalizer.ts`.** Sanitizing there too would be a second
  door for the same invariant; the serializer is where the format is written, so the
  serializer is where the escaping belongs.

### Gates (vs the recorded baselines)

typecheck **17/17** · api **408** · queue **88** · shared-server **389** (334 + 55
new: 45 in `round-trip-fidelity.test.ts`, 10 in `limits.test.ts`) · db **178 passed /
0 failed** · trpc **335** · shared **295** · web **424** · mobile **132** · lint
**0 errors** (warnings at baseline; the one `no-control-regex` error the first draft
introduced was fixed by replacing the regex with a code-point test, not by disabling
the rule) · workspace-imports **EXIT 0** · build:server **EXIT 0** · lockfile diff
**empty** · `pnpm i18n:check` exits 1 on the pre-existing `no` gap only, **zero new
gaps** · no migration, `packages/db/src/migrations/` and `meta/_journal.json`
untouched, DB stays at **42** · a real `tsc --noEmit` in `packages/shared` **and** in
`packages/shared-server` (whose own script passes `--noCheck`), including the
`__tests__/cooklang` tree: **EXIT 0** · no `as any`, no `@ts-ignore`, no
`@ts-expect-error` in the diff.

**Files changed:** `packages/shared/src/cooklang/serialize.ts`,
`packages/shared/src/cooklang/index.ts` (exports `escapeCookText`),
`packages/shared-server/src/cooklang/limits.ts`,
`packages/shared-server/src/cooklang/parse.ts`,
`packages/shared-server/src/cooklang/build-payload.ts`,
`packages/shared-server/__tests__/cooklang/limits.test.ts`, and the new
`packages/shared-server/__tests__/cooklang/round-trip-fidelity.test.ts`.
**Task 5 (the queue isolation suite) is still outstanding and W3 is still NOT
code-complete.**
