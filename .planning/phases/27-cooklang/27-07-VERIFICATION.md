---
phase: 27-cooklang
plan: 07
scope: Tasks 1-3 (pre-live gate for Task 4)
verified: 2026-07-27T18:05:00Z
verifier: independent (Opus, goal-backward, FORCE stance)
status: gaps_found
score: 8/9 must-have truths verified
overrides_applied: 0
verdict: NO-GO for the live run until G1 is fixed and G2/G3 are dispositioned by the director
working_tree: clean (git status --porcelain empty; git diff empty; cook-backfill.ts md5 == committed blob)

gaps:
  - truth: "SHOPPING-LIST FK SAFETY. ... `steps.id` (and every `step_images.step_id`) likewise survive."
    status: partial
    severity: BLOCKER
    reason: >-
      The grocery half is genuinely guarded and adversarially proven. The `steps` half has NO
      guard at all. `syncProjectedStepsTx` tail-trims surplus step rows and
      `step_images.step_id` is `onDelete: "cascade"`, so trimmed steps take their images with
      them, silently, inside a transaction that then COMMITS. Proven by executing the real
      seeder -> real serializer -> real WASM parser -> `computeCookProjection` chain: three
      realistic legacy step shapes lose rows, and one loses heading CONTENT.
    artifacts:
      - path: packages/db/src/repositories/cook-backfill.ts
        issue: "applyCookBackfill guards `recipe_ingredients` ids only (lines 87-113). No snapshot/recheck for `steps.id`."
      - path: packages/db/src/repositories/cook-projection.ts
        issue: "syncProjectedStepsTx lines 380-384 delete surplus step rows unconditionally; step_images CASCADE."
      - path: packages/db/__tests__/server/db/repositories/cook-backfill.test.ts
        issue: "The steps.id test (line 167) only covers the `step list is unchanged` case, which is the case that cannot fail."
    missing:
      - "A step-row guard mirroring the grocery guard: snapshot `steps.id` (and/or `step_images.step_id`) before deriving, re-check after, throw and roll back on loss."
      - "OR: an explicit, director-accepted override recording that step-row loss is tolerated and that the pre-run pg_dump is the only recovery."

  - truth: "`checks/0042-postcheck.sql` provides the read-only pre/post queries proving grocery-link survival for the live run."
    status: failed
    severity: BLOCKER
    reason: >-
      PRE (2) and POST (2) select the WRONG COLUMN. `SELECT "id" AS recipe_ingredient_id_at_risk
      FROM "groceries"` returns `groceries.id`, not `groceries.recipe_ingredient_id`, despite the
      alias. The POST anti-join (lines 84-87) joins that list against `recipe_ingredients.id`, so
      pasting the PRE list yields ALL rows as `missing` — Task 4's acceptance criterion
      "zero rows returned by the anti-join" is unsatisfiable as written.
    artifacts:
      - path: packages/db/src/migrations/checks/0042-postcheck.sql
        issue: "Lines 30-33 (PRE) and 74-77 (POST): `SELECT \"id\"` should be `SELECT \"recipe_ingredient_id\"`."
    missing:
      - "Change `SELECT \"id\" AS recipe_ingredient_id_at_risk` to `SELECT \"recipe_ingredient_id\" AS recipe_ingredient_id_at_risk` in both the PRE and POST sections."

  - truth: "`backfillCookSource` ... never throws — a backfill failure must never cost a boot (R4)."
    status: failed
    severity: BLOCKER
    reason: >-
      Proven by execution, not by reading. `const units = await getUnits()` (line 136) and
      `const ids = await listRecipeIdsWithoutCookSource()` (line 137) sit OUTSIDE any try/catch.
      A scratch test that made each reject showed `backfillCookSource()` REJECTS. The boot wiring
      (`apps/web/server/index.ts:38`) awaits it unguarded and `main().catch(...)` calls
      `process.exit(1)` — so a backfill setup failure DOES cost the boot, contradicting the plan
      objective, R4, the module's own docstring ("NEVER THROWS") and the SUMMARY's claim
      ("already proven never to throw").
    artifacts:
      - path: packages/api/src/startup/backfill-cook-source.ts
        issue: "Lines 136-137 are outside the try/catch; there is no top-level catch as R4 requires."
      - path: apps/web/server/index.ts
        issue: "Line 38 `await backfillCookSource();` is unguarded; main().catch -> process.exit(1)."
    missing:
      - "Wrap the whole body of `backfillCookSource` in try/catch returning the zeroed outcome on failure, OR wrap the call site in `try { await backfillCookSource(); } catch (err) { log.error(...) }`."
      - "A test asserting `backfillCookSource()` resolves when `getUnits()` / `listRecipeIdsWithoutCookSource()` reject."

warnings:
  - "R3's 'byte-identical step prose' claim is empirically FALSE whenever an ingredient is appended: the projection writes the appended ingredient NAMES into `steps.step` (probe: `Mix the flour.` -> `Mix the flour. olijfolie zout`). On live's Dutch-named, multi-word ingredient set this will affect most recipes' first step, irreversibly. The postcheck compares step COUNTS only, so this change is invisible to the live PRE/POST diff."
  - "`listRecipeIdsWithoutCookSource` has NO real-Postgres test (only a mock in the api suite). It is the sole mechanism behind Task 4's 'second restart reports candidates = 0' idempotence check."
  - "Opposite-system `recipe_ingredients` values are rewritten by `deriveConversion` (flag-and-preserve falls back to the NATIVE amount+unit). D-27-W5-07's own evidence line — 15 of 35 ingredient unit differences today — predicts ~40% of live's opposite-system rows change value. The postcheck compares counts only; this is invisible to it."
  - "The escaping-proof test does not assert the PARSED token text (only the minted source). Verified independently instead — see the Data-Flow Trace section; it does round-trip byte-exactly, including hostile ingredient names."
---

# Phase 27 Plan 07 (Wave W5, Tasks 1-3) — Independent Pre-Live Verification

**Goal under verification:** the code half of migration `0042` — a transactional, guarded,
idempotent, isolation-safe live-data `cook_source` backfill — is correct and safe to apply to
real recipe data.

**Stance:** the executor's SUMMARY is untrusted. Every number below was re-derived in this
session. Every safety claim was falsified by adversarial weakening or independent execution,
not by reading a test name.

---

## A. Gates re-run independently — ACTUAL vs CLAIMED

| Gate | Claimed | ACTUAL (this session) | Verdict |
|---|---|---|---|
| `pnpm --filter @norish/api test` | 430 passed | **430 passed / 31 files**, exit 0 | REPRODUCES |
| `pnpm --filter @norish/db test` | 198 passed | **198 passed / 25 files**, exit 0 | REPRODUCES |
| `pnpm --filter @norish/shared test` | 564 passed | **564 passed / 19 files**, exit 0 | REPRODUCES |
| `pnpm typecheck` | 17/17 exit 0 | **17 successful, 17 total**, exit 0 (FULL TURBO cache) | REPRODUCES |
| real `tsc --noEmit` in `packages/api` | clean | **exit 0, zero output** | REPRODUCES |
| `pnpm --filter @norish/api lint` | 0 err / 97 warn | **0 errors, 97 warnings** | REPRODUCES |
| `pnpm --filter @norish/db lint` | 0 err / 62 warn | **0 errors, 62 warnings** | REPRODUCES |
| `pnpm --filter @norish/shared lint` | 0 err / 45 warn | **0 errors, 45 warnings** | REPRODUCES |
| `check-workspace-imports.mjs` | exit 0 | **exit 0** — "No workspace import issues found." | REPRODUCES |
| `pnpm --filter @norish/web build:server` | exit 0 | **exit 0** — "Build complete in 806ms" | REPRODUCES |
| `pnpm deps:cycles` | pre-existing cycle only | **1 cycle**: `db-schema/auth.ts -> households.ts` (documented in `deferred-items.md`); `packages/db-schema` untouched by this diff | REPRODUCES |

Not a single claimed number failed to reproduce.

**Note on the environment fix.** The SUMMARY's `node_modules/@norish/config/package.json`
re-sync was checked: the injected copy is now byte-identical to `packages/config/package.json`
(`diff` -> IDENTICAL) and the real `tsc --noEmit` is clean. No tracked file is involved.

---

## B. The three things that must be right — adversarial proofs

All three weakenings were applied by truncating the file **in place** (preserving the inode, so
the `node_modules/@norish/db` hardlink stayed in sync — verified by `stat -c %i` and by
grepping the weakening out of the `node_modules` path), then restored byte-identically.

### B1. Grocery-link guard — VERIFIED (adversarially)

Read confirms the ordering is correct and load-bearing
(`packages/db/src/repositories/cook-backfill.ts:86-124`): snapshot at-risk ids **before**
`deriveProjectionTx`, re-check **after**, `throw` to roll back the whole transaction, and only
then the `recipes` UPDATE. The snapshot joins `groceries` to `recipe_ingredients` on
`recipeId` alone — so it also covers a *cross-household* grocery row pointing at this recipe's
ingredients, and both measurement systems.

**W5-W1 weakening** — replaced `throw new GroceryLinkWouldBreakError(...)` with a no-op:

```
× aborts the whole recipe rather than break a shopping-list link   119ms
Tests  1 failed | 9 passed (10)          exit 1
```

Restored -> md5 `bdd3b7af319cd4afcfcb0daf3939f4b3` on both the workspace file and the
`node_modules` hardlink; `git status --porcelain` empty.

### B2. Sticky review flag — VERIFIED (adversarially)

The OR is in SQL, at the statement level, not through a DTO:
`cookReviewNeeded: sql\`${recipes.cookReviewNeeded} OR ${reviewNeeded}\`` (line 122).

**W5-W2 weakening** — replaced with the plain assignment `cookReviewNeeded: reviewNeeded`:

```
× never clears a cook_review_needed already set by 0041   170ms
Tests  1 failed | 9 passed (10)          exit 1
```

Restored byte-identical.

### B3. T-27-01 not bypassed — VERIFIED (by independent execution)

`buildCookPayload` is imported and awaited (line 182); the minted `cookSource` and `cookTokens`
handed to `applyCookBackfill` come from it. `@norish/db` cannot reach the parser at all
(`grep -cE "@norish/shared-server|@cooklang"` on non-comment lines -> **0**), and `0042.sql`
carries no `.cook` construction.

I did **not** rely on the executor's escaping test. I drove the real chain myself
(seeder -> `serializeWithReport` -> `buildCookPayload` -> pooled WASM parse) over hostile prose
**and** a hostile ingredient name:

```
input prose : "Mix @flour #1 ~well {carefully} 50% > done -- now.\r\nRest it."
input name  : "50% cocoa {blend} -- extra @good"

minted      : Mix \@flour \#1 \~well \{carefully\} 50\% \> done \-\- now. Rest it.
              @50\% cocoa \{blend\} \-\- extra \@good{2%gram} @zout
findCookSourceDefect -> null
payload.cookSource === serializeWithReport(structured, units).cook -> true
parsed prose : "Mix @flour #1 ~well {carefully} 50% > done -- now. Rest it. ..."   (CR/LF -> one space)
parsed names : ["50% cocoa {blend} -- extra @good", "zout"]                        (byte-exact)
```

The ingredient-name round-trip matters more than the prose one: the parsed name is the
dictionary key that resolves `recipe_ingredients.ingredient_id`. It survives, so the natural-key
UPSERT hits the existing row and `recipe_ingredients.id` is preserved. The executor's own test
never asserted this; it holds anyway.

The null-amount "to taste" shape (`zout`) also round-trips cleanly as a bare `@zout` — relevant
to live's 32 blank-unit rows.

---

## C. The isolation test the executor says it repaired — VERIFIED (adversarially, both policies)

The SUMMARY's story is that the original isolation test did not go red because it snapshotted
cookbook B's `recipe_ingredients`/`steps`/`groceries` but not B's own `recipes` row, and that
`snapshotOfB()` was extended to cover `cookSource`/`cookConfidence`/`cookReviewNeeded`. The
extension is present at `cook-backfill.test.ts:453`.

**W5-W3 weakening** — dropped `.where(eq(recipes.id, recipeId))` from the final UPDATE:

```
× recipe/cookbook isolation under view: household > leaves cookbook B's rows byte-identical ...  186ms
× recipe/cookbook isolation under view: everyone  > leaves cookbook B's rows byte-identical ...  179ms
Tests  2 failed | 8 passed (10)          exit 1
```

Failure diff on **both** siblings shows A's write landing on B:

```
-  "cookConfidence": null,        +  "cookConfidence": "1.000",
-  "cookSource": null,            +  "cookSource": "Whisk the @flour{200%gram} and @milk{300%milliliter}. ..."
```

Restored byte-identical. Supporting static evidence: `grep -c "everyone"` on non-comment lines
-> **0**; `grep -E "householdId|userId|ctx|permission"` -> **0 matches**;
`applyCookBackfill.length === 1`.

---

## D. `cookConfidenceFromLinks([])` — VERIFIED (executed, not read)

```
D empty = 1  typeof number  isNaN false  === 1 ? true
D threshold = 0.8   flag(empty)? false
D 4/5 = 0.8    D 3/4 = 0.75    D 2/3 = 0.667    D 0/1 = 0    D 3/7 = 0.429
```

Exactly `1`, a `number`, not NaN, not 0. `COOK_REVIEW_CONFIDENCE_THRESHOLD === 0.8`, comparison
is strict `<` so `0.8` is not flagged and `0.75` is. The column write is
`cookConfidence.toFixed(3)` -> `"1.000"`, seen literally in the W5-W3 failure diff, which is
valid for `numeric(4,3)`.

---

## E. Idempotency — VERIFIED with one caveat

`running the backfill TWICE churns no id and re-flags nothing` (line 194) is real: it compares
the full `recipe_ingredients.id` set, the full `steps.id` set and all three cook columns with
`toEqual` across two live writes against real Postgres. It passed in my run.

It proves the happy path *plus* stability of the sticky flag for identical input. The
"flagged on run 1, `reviewNeeded: false` on run 2" direction is covered by the separate
`never clears a cook_review_needed already set by 0041` test, which W5-W2 proved is load-bearing.
So the sticky-across-runs property is genuinely covered between the two tests.

**Caveat (warning, not blocker):** on live, run 2 never reaches `applyCookBackfill` at all —
`listRecipeIdsWithoutCookSource()` filters the recipe out. That function has **no
real-Postgres test**; it is only mocked in the api suite. Its six lines
(`isNull(recipes.cookSource)`, `orderBy(recipes.id)`) are correct by inspection, but Task 4's
"second restart reports `candidates` = 0" check rests on untested code.

---

## F. Migration / boot split — VERIFIED

- `0042_backfill_cook_source.sql` read in full (46 lines): header comment + one `DO $$` block
  marked `-- [0042:precondition]` that `RAISE EXCEPTION`s when
  `uq_recipe_ingredients_recipe_system_ingredient` is absent. **No DML anywhere** — not in a
  function body, not in a DO block, not in a CTE. `grep -ciE "^\s*(update|insert|delete)\b"` -> 0,
  and the full read confirms the grep is not being evaded.
- `_journal.json`: `43 {"idx":42,"version":"7","when":1785369600000,"tag":"0042_backfill_cook_source","breakpoints":true}`. No `0042_snapshot.json`.
- Boot order in `apps/web/server/index.ts`: `runMigrations()` -> `seedServerConfig()` ->
  `migrateGalleryImages()` -> **`backfillCookSource()`** -> `initializeVideoProcessing()` -> ... ->
  `startWorkers()`. Correct.
- **State if the backfill throws midway:** `applyCookBackfill` opens its **own** `withTransaction`
  per recipe, so the unit of atomicity is one recipe. A mid-run failure leaves earlier recipes
  fully committed (`.cook` + projection together) and later recipes untouched with
  `cook_source IS NULL` — consistent, never half-written, and resumable: the next boot's
  candidate query picks up exactly the remainder. This is the right shape.
- **But** see gap G3: a failure of `getUnits()` or `listRecipeIdsWithoutCookSource()` — the two
  awaits *outside* the loop's try/catch — propagates out of `backfillCookSource()`, past the
  unguarded call site, into `main().catch(... process.exit(1))`. Proven by execution.

---

## G. Scope fence — VERIFIED (all clean)

| Check | Result |
|---|---|
| `git diff pnpm-lock.yaml` | **EMPTY** (0 lines) |
| `git diff --stat packages/shared/src/units packages/api/src/ai` | **EMPTY** |
| `git diff --stat apps/` | `apps/web/server/index.ts` **only**, +4 lines |
| `git diff --stat packages/db/src/repositories/cook-projection.ts` | **EMPTY** — projection writer untouched |
| `0043` / `NOT NULL` in `0042.sql` | **0 matches** |
| Dropped `steps` / `recipe_ingredients` column | none |
| `packages/db-schema` touched | no |
| Debt markers (`TODO`/`FIXME`/`XXX`/`TBD`/`HACK`) in the six changed source files | **none** |

---

## H. Live-readiness reasoning (from the code + `27-W5-PREP-DENSITY-MEASUREMENT.md`; live DB NOT queried)

Live: 6 recipes, 136 ingredient rows, 83 distinct names, 32 blank-unit rows, `cook_source`
populated on **0 of 6**, `cook_review_needed` false on all 6, single household, Dutch-language
prose and ingredient names.

**Expected shape of the run.** All 6 are candidates. Each is processed independently; a refusal
costs that recipe its `.cook` and nothing else. Blank-unit "to taste" rows are handled — I
executed that path: they mint as a bare `@zout`, parse back with `amount: null, unit: null`, and
surface only as an informational `no-quantity` projection flag. No unhandled path there.

**Confidence / flag rate — expect most of the 6 flagged, not "derived clean."** `hasNameAnchor`
is a word-boundary match of the *ingredient row's name* against the *step prose*. Live's names
are multi-word Dutch variants (`extra vierge olijfolie`, `gedroogde Italiaanse kruiden`,
`verse slagroom`, `(olijf)olie`) that are unlikely to appear verbatim in prose. Every
non-anchoring ingredient scores `appended`, so with ~11 native ingredients per recipe, a single
non-anchor already costs ~0.09 and two costs the 0.800 threshold. A run where 4-6 of 6 land in
`flagged` would be the *expected* outcome, not a defect — but Task 4's acceptance criteria should
not be read as expecting a clean sweep.

**A recipe that refuses is handled cleanly.** I executed a degenerate shape (a recipe whose only
step is a `#` heading): `buildCookPayload` returned `null` with
`reason: "did-not-parse-cleanly"`, the runner counted it `refused` and moved on. Flag-and-continue
works.

**What I would *not* have predicted from the SUMMARY, and what the director must weigh:**

1. **Step prose is rewritten with appended ingredient names.** Probe:
   `["Mix the flour.", "Bake it.", "Serve."]` came back as
   `["Mix the flour. olijfolie zout", "Bake it.", "Serve."]`. The two non-anchoring ingredients
   were appended into the *stored* `steps.step`. R3 claims the prose round-trip is
   "byte-identical except for two documented normalizations" — that is true only when every
   ingredient anchors. On live's data most will not. This is irreversible and the postcheck
   (which compares step *counts*) cannot see it.
2. **Step rows can be deleted, and their images cascade.** See gap G2 — three shapes lose rows.
3. **Opposite-system amounts get rewritten.** `deriveConversion`'s flag-and-preserve returns the
   *native* amount+unit, so a US row currently reading `1.76 cup` can become `200 gram` tagged
   `system_used = 'us'`. D-27-W5-07's own recorded evidence (15 of 35 unit differences today)
   sizes this at roughly 40% of opposite-system rows. Again invisible to a count-only postcheck.

None of the three errors out; all three flag-and-continue or commit silently. The exposure is
data quality, and the only recovery is the pre-run dump.

---

## Observable Truths

| # | Truth (from PLAN must_haves) | Status | Evidence |
|---|---|---|---|
| 1 | Recipes end with parsing `cook_source`, confidence in [0,1], flag — own rows, no AI, no permanent fallback | VERIFIED (mechanism) | Full chain executed end-to-end; `grep -cE "openai\|generateText\|aiLogger\|@ai-sdk"` -> 0; refusals counted, not faked. Live outcome is Task 4. |
| 2 | `.cook` minted by the REAL path; T-27-01 escaping on the path, not around it | VERIFIED | Section B3 — independent execution through real serializer + real WASM parser over hostile prose and hostile names |
| 3 | Shopping-list FK safety; **`steps.id` and every `step_images.step_id` likewise survive**; abort keeps recipe untouched | **FAILED (partial)** | Grocery half proven by W5-W1. Steps half has no guard; probe shows 3 shapes losing rows, `step_images` CASCADE. **Gap G2.** |
| 4 | Idempotent — candidate query excludes, double write churns nothing | VERIFIED (caveat) | Real-Postgres double-write test passed; `listRecipeIdsWithoutCookSource` itself untested (warning) |
| 5 | Threshold decided here: `inline/total` to 3dp, strict `< 0.800`, constant `= 0.8` | VERIFIED | Executed: 1, 0.8, 0.75, 0.667, 0.429; `toFixed(3)` -> `"1.000"` observed in DB |
| 6 | `cook_review_needed` is STICKY — OR happens in SQL | VERIFIED | W5-W2 turned the named test RED |
| 7 | Per-cookbook isolation unweakened, proven under `household` AND `everyone` | VERIFIED | W5-W3 turned BOTH siblings RED with A's cook columns landing on B |
| 8 | `0042` exists, forward-only, journal 43 entries, no DML | VERIFIED | Full file read; journal query; no snapshot; per-recipe transactions |
| 9 | Scope fence — no `0043`, no NOT NULL, no dropped column, empty lockfile diff | VERIFIED | Section G, all clean |

**Score: 8/9.**

---

## Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
|---|---|---|---|---|
| `packages/db/src/migrations/checks/0042-postcheck.sql` | 30-33, 74-77 | Wrong column selected under a correct-sounding alias | BLOCKER | The live-run's primary safety instrument returns grocery ids where recipe_ingredient ids are required |
| `packages/api/src/startup/backfill-cook-source.ts` | 136-137 | Awaits outside the guard, contradicting the file's own "NEVER THROWS" docstring | BLOCKER | A backfill setup failure exits the boot |
| `packages/db/src/repositories/cook-backfill.ts` | 87-113 | Guard covers one of the two FK families the must-have names | BLOCKER | `step_images` can be cascade-deleted without abort |
| — | — | No `TODO`/`FIXME`/`XXX`/`TBD`/`HACK` in any changed source file | clean | — |

---

## Working-tree integrity

```
git status --porcelain          -> (empty)
git diff | wc -l                -> 0
md5sum packages/db/src/repositories/cook-backfill.ts   -> bdd3b7af319cd4afcfcb0daf3939f4b3
git show HEAD:...cook-backfill.ts | md5sum             -> bdd3b7af319cd4afcfcb0daf3939f4b3
```

All three weakenings restored byte-identically; the `node_modules/@norish/db` hardlink verified
back in sync (same inode, same md5). Two scratch files created during verification
(`verify-scratch.mts`, `verify-scratch2.mts`, and a temporary
`packages/api/__tests__/startup/zz-verifier-scratch.test.ts`) were deleted; the tree is clean.
Nothing was committed. The live stack and live DB were not touched.

---

_Verified: 2026-07-27_
_Verifier: independent goal-backward verification (Opus). SUMMARY.md treated as untrusted throughout._
