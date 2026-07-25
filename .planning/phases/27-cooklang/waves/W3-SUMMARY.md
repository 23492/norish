# Phase 27 — W3 (Extraction native + T-27-01 input limits) — SUMMARY

> Status: **PARTIAL — 2 of 5 tasks. W3 is NOT code-complete and must NOT be deployed as "W3".**
> Scope per `27-ARCHITECTURE.md` §7 (W3) + plan `27-03-PLAN.md`.
> NO deploy, NO live stack, NO live DB, NO migration, NO vault change. `pnpm db:generate` /
> `db:push` / `migrate` NOT run (D-27-W2-08). `pnpm docker:build` NOT run (director's job).
> The renderer is untouched (W4 owns it): no web or mobile component, page, hook or renderer.

**Commits:** `f29254b9` (task 1 — T-27-01 input limits) → `65815ec4` (task 2 — extraction schema
union + tolerant normalizer). Base `faa13d8e`; measurement baseline `f4420104`.

**Landed:** Task 1 · Task 2.
**NOT landed:** Task 3 (linkage prompt fragment) · Task 4 (mint the `.cook` and thread it — the
wave's actual switch-on) · Task 5 (queue-side isolation suite + weakenings W3-W2/W3-W3).

**THE NEVER-BROKEN GUARANTEE HOLDS, and holds trivially.** No `.cook` producer exists yet, so
every recipe still has `cook_source IS NULL`, every renderer runs the legacy path, and no
user-visible behaviour changed. The extraction path is byte-identical to today for a
string-shaped model response, and no code path passes a `cook` argument to the repository.

Full detail, per-task commits, the gate table and the resume instructions:
[`27-03-SUMMARY.md`](../27-03-SUMMARY.md).

---

## What shipped

### 1. `@norish/shared-server/cooklang/limits` — T-27-01 DISCHARGED (task 1)

TEN caps, enforced **inside** `buildCookPayload` (pre-serialize AND pre-parse) and **inside**
`parseCookSource` (first statement, before the parser singleton is touched) — the two and only two
doors to the WASM parser, never at their call sites. Breach ⇒ **REJECT, never truncate** ⇒ `null`
⇒ no `cook` ⇒ legacy projection ⇒ the user's import still succeeds. Logs carry counts, limit names
and reasons only, **never the recipe text** (T-27-05, asserted with a logger spy scanning the
serialized payload for the fixture's name, prose and ingredient names).

```
maxCookSourceBytes:        65_536    maxTimersPerStep:              10
maxSteps:                     200    maxRefNameChars:              200
maxStepTextChars:           4_000    maxUnitChars:                  40
maxIngredientRefsPerStep:      60    maxRecipeNameChars:           500
maxTotalIngredientRefs:       600    maxCookMalformedTokens:         8   <-- NEW
```

### THE FINDING — a byte cap does NOT bound parse time

**Read this before reviewing anything else in W3.** The plan specified nine size caps and required
each hostile-corpus input, sized AT the cap, to parse in under 2000 ms. Measurement proved that
criterion **unsatisfiable with nine caps**. `@cooklang/cooklang@0.18.7` emits a diagnostic per
malformed token, and each diagnostic quotes the token's **whole line**, so report construction
costs O(malformed tokens x line length) and returns a multi-megabyte string across the WASM
boundary. All of these are **inside** the planned 64 KiB cap:

| source | parse time |
|---|---:|
| `("#" x 8 + " ")` x 128 + one long word | **18 387 ms** |
| `("~~ ")` x 2048 + one long word | **17 462 ms** |
| `"#" x 4096` — a **4 KiB** source | **4 553 ms** |
| `"@" x 65536` | **4 281 ms** |
| a realistic 64 KiB `.cook` (3 276 tokens) | 90 ms |

Lowering the byte cap cannot fix it — the worst case is *non-monotonic* in the cap and a 4 KiB
`#` run already costs 4.5 s, while real fixtures are low single-digit KB. The parser exposes no
way to suppress the report (`parse`, `parse_full`, `parse_render`, `parse_ast`, `parse_events`
all build it). And timing is memory-state dependent: the same input measures 15 ms on a fresh
`CooklangParser` and 16 786 ms on one with a grown heap.

**`maxCookMalformedTokens: 8` attacks the root cause.** norish AUTHORS every `.cook` it stores
(D-3) and `packages/shared/src/cooklang/serialize.ts` emits **zero** malformed tokens —
ingredients are `@name`/`@name{qty%unit}`, timers `~{...}`/`~name{...}`, headings
`== Heading ==` (a `#`-prefixed step is rewritten to that form), `sanitizeTokenName` strips
`@{}~#%` from names, and cookware `#` is never emitted at all. A malformed token can only arrive
from unsanitized step PROSE — exactly the prompt-injection channel. Verified 0 malformed tokens
across all five fixtures' real serialized output.

**Result: worst surviving adversarial input 622 ms** (a 3.2x margin under budget), down from
**18 811 ms** (a 9.4x breach). Full corpus + cooklang suites now ~3 s of test time; the
pre-fix probe alone took 205 s.

**Hostile corpus: 19 inputs** (plan asked 12), each sized at the cap, each asserting no-throw,
explicit elapsed < 2000 ms, and a `CookTokensSchema`-valid DTO when non-null. Each declares
whether it is refused or parsed and asserts the parser spy accordingly: **8 refused with 0
`parse` calls** (exactly the 4–19 s inputs), 11 parsed safely at ≤ 637 ms and asserted to reach
the parser exactly once — so the suite proves the cap is not over-broad either.

### 2. Per-step linkage in `recipeExtractionSchema` + a tolerant normalizer (task 2)

`recipeInstructions.{metric,us}` is `z.array(z.union([<step object>, z.string()]))`, **object
branch first** (D-27-W3-03), `ingredients`/`timers` defaulting to `[]`, top level still `.strict()`.

This is the **R1** mitigation — the plan's single largest risk. `Output.object` validates the
model's response, so a mandatory step object would turn any non-compliant model into a total
import failure on a fork whose provider and model are user-configurable. Proven defused:
all-strings, all-objects and **mixed** all parse; `validateExtractionOutput`'s `details` counts
are identical across all three; an all-strings extraction yields a DTO **deep-equal** to the
all-objects one with the same text; and `normalizeRecipeFromJson` is asserted to still receive a
plain `string[]`, so `parseSteps` and every JSON-LD behaviour are untouched.

`coerceExtractionSteps` is **total** — `null`, `[null]`, `[{}]`, `[42]`, nested arrays and
non-arrays all yield an array and never throw; malformed refs are dropped. A bad model response
costs the `.cook`, never the import. **No upper-bound constraint anywhere in the schema**
(T-27-01b), asserted by a grep test.

---

## The adversarial revert-check

`git status --porcelain` EMPTY after every revert, md5 back to the committed value, and
`git log -p faa13d8e..HEAD` contains none of these edits.

| # | The exact weakening | Result |
|---|---|---|
| **W3-W1** | `maxCookSourceBytes: 65_536` → `Number.MAX_SAFE_INTEGER` | **RED — 7 failed / 52 passed**, including both `…calls parse 0 times` assertions |
| **W3-W1b** (self-directed, proves the NEW cap) | `maxCookMalformedTokens: 8` → `Number.MAX_SAFE_INTEGER` | **RED — 11 failed / 48 passed**, with 8 corpus cases blowing the budget at real measured times: cookware **4626 ms**, ingredient **4595 ms**, timer **2767 ms**, unbalanced braces **1894 ms**, malformed cookware + long line **1601 ms**, nested tokens **1558 ms** |
| W3-W2 | `buildCookPayload` returns `{ cookSource, cookTokens: [] }` on parse failure | **NOT EXECUTED** — needs Task 4 |
| W3-W3 | add `cookSource` to the `imported` event payload | **NOT EXECUTED** — needs Task 5 |

**A test defect the weakening caught.** W3-W1's first run went red for the *wrong* reason —
`RangeError: Invalid string length` at collection, 0 tests run — because the corpus sized its
inputs from the very constant it polices. Per the plan's "if a weakening leaves the suite GREEN,
the TEST is wrong" rule, the corpus was re-based on a literal `CORPUS_BYTES = 65_536` guarded by
an equality test, and W3-W1 then produced 7 genuine assertion failures. **Lesson recorded in the
file: a suite that polices a constant must not derive its inputs from that constant.**

---

## Gates — baseline `main@f4420104` vs post-plan

| Gate | Baseline | After tasks 1–2 |
|---|---|---|
| `pnpm typecheck` | 17/17 EXIT 0 | **17/17 EXIT 0** |
| `@norish/shared-server` | 275 | **333** (+58) |
| `@norish/api` | 350 | **361** (+11) |
| `@norish/db` (docker) | 164 / **1 failed** | **164 / 1 failed** — same pre-existing red |
| `@norish/trpc` | 335 | **335** |
| `@norish/queue` · `shared` · `web` · `mobile` | 88 · 295 · 424 · 132 | **88 · 295 · 424 · 132** |
| lint `shared-server` · `api` | 0 err / 57 · 97 warn | **0 err / 57 · 97 warn**, new files 0 |
| `check-workspace-imports.mjs` | EXIT 0 | **EXIT 0** |
| `build:server` | EXIT 0 | **EXIT 0** |
| `i18n:check` | EXIT 1 (`no` gap) | **EXIT 1, ZERO NEW GAPS** — `no` is the only locale with missing keys; the diff touches no `packages/i18n` file |
| `git diff pnpm-lock.yaml` | — | **EMPTY** (T-27-SC) |

**Net-new tests: +69.** The one red is the pre-existing `cleanup-workflows` recipe-media
reconciliation failure, identical on the untouched tree.

**Baseline correction:** the dispatch brief quoted `trpc 322`; measured is **335**, matching
W2-SUMMARY. The 322 came from the ROADMAP entry, written before W2's post-review isolation
hardening added 13 tests. Future waves: expect **335**.

**Additive safety:** 9 files in the diff, all in `files_modified` plus this plan's `.md`. No file
under `apps/`, no `*.txt` prompt template, no renderer/heuristic/unit-converter file.
`packages/db/src/migrations/` and `meta/_journal.json` untouched, **DB stays at 42**, the
`0042`/`0043` sequence unchanged (D-27-W3-10). `packages/db` and `packages/shared` dependencies
unchanged. No `cook_confidence`/`cook_review_needed` write (D-27-W3-09). No `as any` /
`@ts-ignore` / `@ts-expect-error` (R11). No new emit site; no emit payload gained a field. No
tRPC input changed.

---

## Refusal rates across fixtures

- **Size-cap refusal on real fixtures: 0/5.** All five pass both gates on their real serialized
  output. Had one breached, the CAP would have been wrong — none did.
- **Malformed-token count on real fixtures: 0/5, exactly zero each** — the premise the tenth cap
  rests on, verified rather than assumed.
- **Malformed-token refusal on the hostile corpus: 8/19.**
- **Coverage-gate (D-27-W3-04) and parse-failure refusal rates: NOT MEASURABLE** —
  `buildCookFromExtraction` does not exist yet (Task 4).

## D-27-W3-07 — MEASUREMENT NOT PERFORMED

The decision stands (keep dual-system extraction; defer single-system to W5, on W2's finding that
W0 lacks `kilogram` / `fl oz` / `pint`). **But the plan required Task 4 to MEASURE the delta
rather than assume it, and that did not happen** — it needs `buildCookFromExtraction` and the
threading. **Director exit item #2 therefore has no new evidence and remains OPEN; it must not be
closed on this SUMMARY.**

---

## W3 exit items for the DIRECTOR

1. **Do NOT treat W3 as shippable.** Dispatch a follow-up executor for tasks 3–5 of
   `27-03-PLAN.md`; `27-03-SUMMARY.md`'s "For the next executor" section lists the seven things
   that changed under their feet (chiefly: `COOK_LIMITS` has ten keys, `coerceExtractionSteps`
   already exists so Task 4(a) step 2 is a no-op, `CookPayload` is still not exported, and
   weakenings W3-W2/W3-W3 are still owed).
2. **T-27-01 is independently deployable and worth shipping.** It hardens the parser door that
   W2's read path already goes through and can only ever cause a refusal, never a failure. If a
   deploy is wanted before tasks 3–5 land, `f29254b9` + `65815ec4` are safe: no migration, no
   producer, no user-visible change. Still needs `pnpm docker:build` + the usual in-image
   `@cooklang/cooklang` WASM confirmation.
3. **The W0 unit-vocabulary decision stays OPEN** — see D-27-W3-07 above. No evidence was
   produced. Do not pull the work forward or defer it on the strength of this wave.
4. **Consider whether `27-03-PLAN.md`'s remaining tasks want re-planning rather than resuming.**
   Tasks 3–5 are ~80% of the wave's surface (17 files, a new queue-side isolation suite, two
   weakenings) and were written as one plan with Tasks 1–2. Splitting Task 4 (the threading) from
   Task 5 (the isolation proof) into separate plans would give each its own gate boundary and
   avoid a second partial.
5. **Worth knowing for W5's backfill:** the parser TRAPS (`RuntimeError: unreachable`, a Rust
   panic) on several adversarial inputs. `parseCookSource` catches it and the singleton is
   verified NOT to be poisoned — after a trap the same instance parses a real recipe cleanly. All
   trapping inputs are now refused before the parser, but W5 will run the parser over real live
   data at volume, so the caps' refusal logs are the signal to watch.

---
*Wave: W3 of 7 — PARTIAL (2/5 tasks)*
*Completed: 2026-07-25*
