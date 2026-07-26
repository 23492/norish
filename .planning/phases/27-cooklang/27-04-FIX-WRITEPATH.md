# 27-04 — VERIFY-3 blockers 5 and 6: the two write-path bugs, root-fixed

**Commit:** `ff289ae6` · **Branch:** `main` · **Nothing pushed. Nothing deployed.**
**DB stays at migration 42** — `packages/db/src/migrations/` and `meta/_journal.json`
untouched, no migration written. `git diff pnpm-lock.yaml` **EMPTY**, no
`pnpm install` run. No `as any`, `@ts-ignore`, `@ts-expect-error` or type widening
added. `packages/shared-server/src/cooklang/**` and its tests were **not touched**
(another agent owned them for the whole of this task).

Scope: VERIFY-3 blockers **5** and **6** only. Blockers 1–4, the minor items and the
three gate problems are untouched.

---

## 1. THE REPRODUCTION — both bugs, on a real Postgres, BEFORE the fix

VERIFY-3 confirmed both by reading code paths; it had no Postgres in its worktree
("What VERIFY-3 could not test": *"Anything DB-backed"*). Both are now reproduced
against a real database, in `packages/db`'s testcontainers suite
(`sg docker -c 'pnpm --filter @norish/db …'`).

The red tests were written against the **pre-fix** signature and run first. Verbatim
output of that run (`cook-write-path.test.ts`, **2 failed | 21 passed**):

### Blocker 5 — a nutrition-only update deleted `cook_source`

```
FAIL … > VERIFY-3 blocker 5 … > a nutrition-only update does not delete cook_source
AssertionError: expected null to be '---\ntitle: Cooked Pancakes\nservings…'

- Expected:
"---
title: Cooked Pancakes
servings: 4
norish.system: metric
---
Whisk the @flour{200%gram} and @milk{300%milliliter} into a batter.

Fry in @butter{20%gram} until golden.
"

+ Received:
null
```

The update under test carries **exactly** the four fields
`packages/queue/src/nutrition-estimation/worker.ts` sends — `calories`, `fat`,
`carbs`, `protein` — and nothing else. **Observed wrong value: `cook_source` is
`NULL` where the recipe's stored `.cook` should be.**

### Blocker 6 — a metric→US switch served a metric `.cook`

```
FAIL … > VERIFY-3 blocker 6 … > a metric -> US switch leaves no metric `.cook` on a US recipe
AssertionError: expected { systemUsed: 'us', …(1) } to deeply equal { systemUsed: 'us', cookSystem: null }

- Expected
+ Received

  {
-   "cookSystem": null,
+   "cookSystem": "metric",
    "systemUsed": "us",
  }
```

`cookSystem` is read off the stored source's `norish.system` frontmatter key.
**Observed wrong value: `recipes.system_used = 'us'` while the row's `cook_source`
declares `norish.system: metric`** — the exact state in which `recipes.get` /
`getEditable` ship a metric read model for a recipe the UI calls imperial.

A **third** test was written in the same pass and was **green before the fix**, on
purpose: *"a switch to the system the `.cook` is already written in KEEPS it"*. It is
the guard against an over-broad fix (an unconditional `cook_source = NULL` on the
system-switch path would pass blocker 6's test and fail this one).

### Blocker 5, again at the caller (`packages/queue`)

`packages/queue/__tests__/nutrition-estimation/worker.test.ts` (new, 2 tests) drives
the real `processNutritionJob` through `createLazyWorker` and asserts the intent the
worker states. Proved RED by reverting only the worker's call to its pre-fix shape:

```
AssertionError: expected undefined to deeply equal { mode: 'unaffected' }
+ Received: undefined
```

Reverted by the **reverse edit** (never `git checkout` — `node_modules/@norish/queue`
is a symlink onto the same inode), then `md5sum` `de5a11edd251e8fb93a364a878fcd800`
against a pre-edit copy, `cmp` clean, inode `339524` identical on both paths. **The
weakening was not committed.**

### GREEN after the fix

`cook-write-path.test.ts` **24 passed**; the queue worker suite **2 passed**; full
`@norish/db` **183 passed / 23 files**.

---

## 2. THE ROOT FIX

Both blockers are one defect wearing two hats: **`cook_source` is a projection, and
its freshness is a property of the write that happens beside it — but the write paths
were never made aware of it.** Patching two call sites would leave the third, fourth
and fifth callers free to fall in.

### 2a. `updateRecipeWithRefs` — the ambiguity was in the signature (blocker 5)

Before: `cook?: RecipeCookPayload`, and `updateData.cookSource = cook ? … : null`. An
**omitted** argument meant **"NULL the stale projection"**. That is D-27-W3-06 and it
is correct for the recipe editor. But "omitted" is also what every caller writes when
it has *no opinion about the `.cook` at all*, and those are two genuinely different
statements sharing one representation. Nutrition estimation is the second kind and
got the first behaviour.

After — a **required** discriminated union (`packages/db/src/repositories/recipes.ts`):

```ts
export type RecipeCookWrite =
  | { mode: "replace"; cook: RecipeCookPayload }
  | { mode: "invalidate" }
  | { mode: "unaffected" };
```

Why this makes the class unrepresentable rather than patching two callers:

1. **There is no longer an argument that means both things.** "No opinion" and "NULL
   it" are now different values of different shapes. The bug as written cannot be
   expressed.
2. **The parameter is required, so silence is a compile error.** A new caller — or a
   caller that grows a new field — cannot reach this function without stating what its
   write does to the projection. This is the same device the plan already used for
   `copyRecipeForSave`'s required, caller-proven `cook` (T-27-07, W3B): *"the required
   parameter is what makes forgetting it a type error instead of a silent
   carry-across."* `version` became `number | undefined` because TypeScript forbids a
   required parameter after an optional one — every caller now states both.
3. **`unaffected` is not taken on trust.** A required parameter forces a *decision*;
   `assertCookUnaffected` makes the decision *checkable*. It derives the guarded field
   set from the serializer itself — `buildFrontmatter` emits `title`, `servings`,
   `time.prep`, `time.cook`, `source`, `norish.system`, and the body carries the step
   prose with its `@ingredient{amount%unit}` tokens — and **throws before the
   transaction opens** if a caller claims `unaffected` while writing `name`,
   `servings`, `prepMinutes`, `cookMinutes`, `totalMinutes`, `url`, `systemUsed`,
   `recipeIngredients` or `steps`. Without it, `unaffected` would have been a second,
   quieter door to exactly the staleness D-27-W3-06 exists to prevent.
   `totalMinutes` is guarded conservatively: it is part of `StructuredRecipe` but has
   no frontmatter key today, and a spurious entry costs a caller one honest
   `invalidate` while a missing one costs a user their `.cook` silently.
4. It throws rather than quietly downgrading to `invalidate`. A repository that
   "fixes" a caller's mis-statement is how the original defect stayed invisible for a
   whole wave.

`createRecipeWithRefs` keeps its **optional** `cook?`, deliberately: on an INSERT
there is no prior projection, so an omitted argument has exactly one meaning. The
ambiguity is specific to UPDATE.

### 2b. `setActiveSystemForRecipe` — the invariant was expressible in the statement (blocker 6)

A `.cook` carries exactly ONE unit system (D-2) and is minted for the recipe's
`system_used` at the moment it is written. `system_used` and `cook_source` are two
halves of one fact, and this function moved one of them.

```ts
.set({
  systemUsed: system,
  cookSource: sql`CASE WHEN ${recipes.systemUsed} = ${system} THEN ${recipes.cookSource} ELSE NULL END`,
  version: sql`${recipes.version} + 1`,
})
```

**No parameter here, and that is the stronger fix, not the lazier one.** The other
write path needs a caller-supplied intent because only the caller knows whether its
payload made the projection stale. Here the function has all the information there
is: a source written for the other system cannot describe this one. A parameter would
be a decision a caller could get wrong; a `CASE` cannot be. The predicate is read
against the pre-UPDATE row in the same statement, so there is no window in which
`system_used` and `cook_source` disagree — and a same-system call keeps the source
(the third test above).

`updateRecipeWithRefs` is the only other writer of `recipes.system_used` (verified:
`git grep "update(recipes)"` finds six sites; the other four write `household_id`,
`visibility`, `categories`, `image`, none of which the `.cook` describes), and it is
covered by 2a — `systemUsed` is in the guarded field set.

### 2c. The call sites

| caller | intent | why |
|---|---|---|
| `packages/trpc/src/routers/recipes/recipes.ts` — the recipe editor | `invalidate` | rewrites ingredients and steps from a client payload that carries no linkage and never will (D-27-W2-01). D-27-W3-06, unchanged in behaviour, now said out loud. |
| `packages/shared-server/src/archive/parser.ts` — archive overwrite | `invalidate` | replaces the whole recipe from a `.cook`-less archive DTO. |
| `packages/queue/src/nutrition-estimation/worker.ts` | `unaffected` | writes four nutrition numbers; none of them reaches the serializer. **The fix for blocker 5.** |
| `setActiveSystemForRecipe`'s two call sites (`convertMeasurements`) | — | unchanged; the repository now keeps the two halves consistent itself. |

---

## 3. WHAT I DID **NOT** DO, AND THE EVIDENCE FOR IT

The brief asked that a system switch *"produce a `.cook` that matches the system now
being served — re-serialize from the recipe's data"*. **It does not; it clears the
source instead.** Stating that plainly because it is a deviation.

A `.cook` for the target system needs **per-step ingredient linkage in that system**,
and the recipe does not hold any:

- `deriveProjectionTx` materializes the opposite system's ingredient **rows** (W0's
  `deriveConversion`) but **never its steps** — D-27-W2-05, "a converter can convert an
  amount, it cannot rewrite prose".
- The opposite system's step **prose** comes from the AI: either the extraction
  (D-27-W3-05) or `convertRecipeDataWithAI`. Its output schema
  (`packages/shared-server/src/ai/unit-converter.ts`) is a flat ingredient list plus a
  flat step list — **no per-step refs**. Verified by reading it, not assumed.
- The only linkage that exists anywhere is **inside the native `.cook` itself**.

So a re-mint would have to (a) **re-parse** the stored native source — the thing
§15.5 tells W5 not to lean on — then (b) transplant its refs onto AI-rewritten prose
by name, assuming a 1:1 step-order correspondence nothing in the plan establishes, and
(c) re-implement the serializer's name matcher to check the transplant landed, which
is the "unversioned third copy of a contract" disease §16 was written about. Three
guesses, in a path with **zero live rows**, to avoid a fallback that costs the user no
data.

What the recipe loses is a *projection of rows that are all still there*: it returns
to the legacy render path, which is exactly what D-27-W3-06 already chose for the
editor. Minting a `.cook` for a recipe that lacks one is **W5's scope**. There is one
real cost, recorded honestly: a metric→US→metric round trip now loses the `.cook`
permanently, where before it survived (in a state that was silently wrong in the
middle). See §6, decision D-3.

A read-side alternative — serve `cookTokens` only when the source's `norish.system`
matches `system_used`, keeping the source for the return trip — is arguably the truest
model (`cook_source` is the recipe's NATIVE `.cook`; `system_used` is the ACTIVE
display system, and the schema conflates them). It was **not** taken: it lives in
`withCookTokens`, i.e. `packages/shared-server/src/cooklang/**`, which another agent
owned throughout this task. Handed to W4 as an option in §7.

---

## 4. EXPOSURE OF ALREADY-DAMAGED ROWS

**Zero rows, derived — not measured against live, which I did not touch.**

The derivation, from facts already recorded in `27-04-SUMMARY.md`:

1. `recipes.cook_source` is written **only** by `createRecipeWithRefs` /
   `updateRecipeWithRefs` with a `cook` payload, and the only producer of one is W3's
   extraction path (`buildCookFromExtraction` → `buildCookPayload`).
2. §15.7: **nothing from W3 or W3B is deployed** — live `norish-app` runs image
   `516c52576a5f`, verified with `docker inspect` in an earlier task.
3. §14.7 / §15.5: live data is confirmed clean — **0 rows with a non-NULL
   `cook_source`**.

No deployed code can write a `cook_source`, and none exists ⇒ neither bug can have
deleted or mismatched one. **Both are pre-deploy defects.** The test database is
ephemeral (testcontainers, dropped per file), so it holds no exposure data either.

**Post-deploy blast radius, had this shipped**, stated more precisely than VERIFY-3's
"every recipe that receives nutrition estimation after import": the job has exactly
one producer, `addNutritionEstimationJob` from the `estimateNutrition` tRPC procedure
(`recipes.ts:895`) — a **user-initiated** action, not an automatic post-import step.
So it would have been *every recipe on which a user pressed "estimate nutrition"*, and
for blocker 6 *every recipe a user converted between metric and US*. Both silent.

---

## 5. GATES

Run after the fix, full suites, on LXC 110.

| gate | baseline | result |
|---|---|---|
| `tsc --noEmit -p packages/db` | EXIT 0 | **EXIT 0**, zero output (redirected to a file) |
| `tsc --noEmit -p packages/queue` | EXIT 0 | **EXIT 0**, zero output |
| `tsc --noEmit -p packages/trpc` | EXIT 0 | **EXIT 0**, zero output |
| `tsc --noEmit -p packages/api` | EXIT 0 | **EXIT 0**, zero output |
| `tsc --noEmit -p packages/shared-server` | EXIT 0 | **EXIT 0**, zero output |
| `@norish/db` test (`sg docker`) | 179 / 23 files | **183 passed / 23 files** (+4) |
| `@norish/queue` test | 121 / 17 files | **123 passed / 18 files** (+2, new file) |
| `@norish/trpc` test | 337 | **337 passed / 32 files** |
| `@norish/api` test | 408 | **408 passed / 30 files** |
| `@norish/shared-server` test | 546 | **549 passed / 22 files** (includes another agent's in-flight work) |
| eslint, touched packages | 0 errors | **0 errors** — db 62 / queue 85 / trpc 153 / api 97 / shared-server 57 warnings, all pre-existing `import/order`; the touched files add none |
| `tooling/monorepo/scripts/check-workspace-imports.mjs` | EXIT 0 | **EXIT 0** — "No workspace import issues found." |
| `git diff pnpm-lock.yaml` | empty | **empty** |
| DB migration | 42 | **42**; `migrations/` + `meta/_journal.json` untouched |

Two notes on the numbers, so they are not read as more than they are:

- **`@norish/api` and `@norish/shared-server` were RED mid-task and are not my
  doing.** A run at 20:43 showed api **16 failed / 392 passed** (all 16 in
  `cook-payload.test.ts`, every one `expected null not to be null` from
  `buildCookPayload`) and shared-server **2 failed**. `git status` at that moment
  showed another agent's uncommitted edits to `packages/shared-server/src/cooklang/`
  `limits.ts` and `pool.ts` (VERIFY-3 blocker 1 — the RSS bound, D-27-W3B-14). Both
  packages were green again once that work settled, with no further change from me.
  The one shared-server failure that **was** mine —
  `archive-import-overwrite.test.ts` asserting a 3-argument call — is fixed in this
  commit.
- `prettier --write` on `packages/db/src/repositories/recipes.ts` also reflowed one
  pre-existing over-long line (~1866). The file was **already** prettier-dirty at
  `HEAD` (checked with `prettier --check` on `git show HEAD:…`), so this is a
  pre-existing violation cleaned up in a file the change already touches, not new
  churn.

---

## 6. DECISIONS TAKEN

- **D-1 — a three-mode required union, not a boolean or a second optional
  parameter.** `replace | invalidate | unaffected` names the three things a write can
  truthfully say. A boolean (`preserveCook`) would have been silently defaultable and
  would not distinguish `replace` from `invalidate`; a second optional parameter would
  have reproduced the original defect one argument to the right.
- **D-2 — `unaffected` is validated, not trusted.** `assertCookUnaffected` throws on a
  false claim. Rationale in §2a.3. The guarded field set is derived from the
  serializer's frontmatter keys and body grammar, and is duplicated in
  `packages/db` rather than imported because `@norish/db` must not depend on
  `@norish/shared`'s cooklang module; the queue test asserts the same field set at the
  call site so a widening is caught where a reviewer is looking.
- **D-3 — the system switch CLEARS rather than re-mints.** Evidence in §3. Accepted
  cost: a metric→US→metric round trip loses the `.cook` permanently, and **there is no
  repair path in the tree** — W5's backfill is not started and pauses for Kiran's
  sign-off. Escalation was considered and rejected: the outcome is reversible (W5 will
  re-mint), a safe default exists (the legacy render path, which every recipe used
  until W3), and the alternative is a guess.
- **D-4 — no parameter on `setActiveSystemForRecipe`.** Rationale in §2b: the function
  has all the information the decision needs, so the invariant belongs in the
  statement. A required parameter there would have been a decision a caller could get
  wrong, and one it could only ever answer one way.
- **D-5 — `createRecipeWithRefs` keeps its optional `cook?`.** On an INSERT there is
  no prior projection, so an omitted argument has exactly one meaning.
- **D-6 — comments promising W5 as a recovery path are corrected in place**, per the
  brief: the D-27-W3-06 docblock in `recipes.ts`, the coverage-gate docblock in
  `packages/api/src/ai/features/recipe-extraction/normalizer.ts:408`, and the `cook`
  field docblock in `packages/api/src/parser/index.ts:38` now all say W5 is not
  started and pauses for explicit sign-off. **No backfill and no migration was
  written** — that is W5's pre-scoped work.

---

## 7. HANDED FORWARD (not done here, recorded so it is not lost)

- **W4 should decide whether `cook_source` is the NATIVE source or the SERVED one.**
  The schema conflates them: `norish.system` in the frontmatter is a property of the
  source, `recipes.system_used` is a property of the display. If W4's renderer teaches
  `withCookTokens` to serve tokens only when the two agree, the system switch could
  KEEP the source for the return trip instead of clearing it, and D-3's accepted cost
  disappears. That change lives in
  `packages/shared-server/src/cooklang/attach-tokens.ts`.
- **W5 additionally now owns re-minting a `.cook` after a system switch**, not just
  after an editor save. Its §15.5 prerequisites are unchanged and still binding
  (re-serialize not re-parse; `kilogram`/`fl oz`/`pint` plus a rounding rule first;
  explicit sign-off).
- **No trpc-level test asserts the editor's `invalidate` intent.** The compiler forces
  *an* intent and the db suite proves the semantics, and `packages/trpc`'s
  `recipes.test.ts` has no harness for the `update` procedure today. A `convertMeasurements`
  test at the trpc layer is similarly absent. Both are cheap additions for whoever
  builds that harness next.
- VERIFY-3 blockers **1, 2, 3, 4**, the two minor items and the three gate problems
  are untouched by this task.

---

*Phase 27-cooklang · plan 27-04 · VERIFY-3 blockers 5 and 6 · 2026-07-26*
