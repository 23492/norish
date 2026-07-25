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
