# VERIFY-4 — the fourth independent adversarial verification of 27-04

**Verdict at sha `1af9a8ee633792de3d2a89f7dc800a02b635f07c`: PASS — safe to deploy.**
All six VERIFY-3 blockers and all four gate problems are closed at the root, and
re-verified here by my own mutations rather than by reading the executors' records.
**Two test-only defects and four record corrections are recorded below as
follow-ups; none of them blocks the image or the runtime**, and I say exactly why
for each. One area (severe memory pressure) is labelled UNTESTED rather than
guessed at.

Position confirmed independently, not taken from the briefing: branch `main`, tree
clean, **47 commits ahead of `origin/main`**, 0 behind, HEAD `1af9a8ee`. Nothing
pushed, nothing deployed. `_journal.json` still has exactly **42** entries ending
`0041_add_cook_source`, unchanged in the range.

Everything below was executed on LXC 110 against the working tree. Every mutation
was reverted by reverse edit and verified byte-identical with `cmp` + `md5sum` +
`git diff --exit-code`; **no mutation was committed**. The only file this round
creates is this one.

---

## THE GATE NUMBERS, RUN BY ME

| gate | result |
|---|---|
| `pnpm typecheck` (aggregate) | **EXIT 0 — 17 successful, 17 total** |
| full vitest, **idle** | **3 362 passed / 251 files / 11 packages / 0 failed**, EXIT 0 |
| full vitest, **under contention** | 3 362 total, **2 failed** — see §FAIL-1 and §FAIL-2 |
| `pnpm lint` | **EXIT 0 — 14/14 tasks, 0 errors** (warnings only, all pre-existing `import/order`) |
| `check-workspace-imports.mjs` | **EXIT 0** — "No workspace import issues found." |
| `pnpm --filter @norish/web build:server` | **EXIT 0**, `dist-server/parse-worker.mjs` emitted (6 942 B) |

Per-package, idle (all passed): config 712, shared 319, db 183, shared-server 554,
auth 133, queue 123, trpc 337, shared-react 37, api 408, mobile 132, web 424.
**Sum = 3 362 across 251 files / 11 packages — the claimed figures are exact.**

The `db` suites ran against a real Postgres via testcontainers; no `sg docker`
wrapper was needed in this context.

---

## A. THE SECURITY PROPERTY, RE-EARNED FROM SCRATCH — **HOLDS. No bypass found.**

I did not re-run VERIFY-3's sweep. I attacked the *doors*, because blockers 1 and 4
moved them.

**Every deep-import door is closed, tested empirically against Node's resolver**
(resolving as `packages/api`, not by reading `package.json`):

| specifier | result |
|---|---|
| `@norish/shared-server/cooklang/pool` | `ERR_PACKAGE_PATH_NOT_EXPORTED` |
| `@norish/shared-server/cooklang/parse-worker` | `ERR_PACKAGE_PATH_NOT_EXPORTED` |
| `@norish/shared-server/src/cooklang/pool.ts` | `ERR_PACKAGE_PATH_NOT_EXPORTED` |
| `@norish/shared-server/dist/cooklang/pool.js` / `.mjs` | `ERR_PACKAGE_PATH_NOT_EXPORTED` |
| `@norish/shared-server/./cooklang/pool` | `ERR_PACKAGE_PATH_NOT_EXPORTED` |
| `@norish/shared-server/../shared-server/src/cooklang/pool.ts` | `ERR_PACKAGE_PATH_NOT_EXPORTED` |
| `@norish/shared-server/cooklang/parse` | resolves (the intended door) |

**No fourth door.** `parse.ts` re-exports exactly one symbol from `./pool`
(`shutdownCookParsePool`, line 22) — `parseInPoolBelowTheRecognizerForTests` is
**not** re-exported anywhere, so it is unreachable outside the package.
`parseInPool` itself now runs `findCookSourceDefect` before `boundedParse`
(`pool.ts:1022`), and logs `door: "pool"` at ERROR if anything arrives around
`./parse`. There are no `resolve.alias`/`tsconfig.paths` entries in any workspace
that map past the exports map.

**The single-importer property, confirmed empirically in the SHIPPED ARTIFACT** —
not by reading the static assertion. After `build:server`:

- `dist-server/parse-worker.mjs` — the **only** chunk with a real
  `from "@cooklang/cooklang"`.
- `dist-server/index.mjs` — 7 textual occurrences, and I extracted every one with
  context: **all 7 are inside preserved JSDoc comments. Zero import / require /
  dynamic-import statements.**
- The other 7 chunks: 0 occurrences.

**All four static door assertions are non-vacuous — I forced each RED on its own
probe** (then deleted the probes; tree verified clean):

| probe | assertion that went RED |
|---|---|
| new `packages/api/src/v4probe.ts` importing the WASM | `names the importer, so the number cannot drift silently` |
| new `packages/shared-server/src/cooklang/v4probe2.ts` importing `./pool` | `names every PRODUCTION file that imports the pool module` |
| …and calling the below-recognizer entry | `names every caller of the below-the-recognizer entry` |
| re-adding `"./cooklang/pool"` to `exports` | `is NOT an exported subpath of @norish/shared-server` |

### FINDING A-1 (minor, follow-up, does not block) — the one-importer sweep has two blind spots

`repoFiles()` (`pool.test.ts:1221`) filters on `/\.tsx?$/`, and `filesMatching`
matches `/from\s+["']@cooklang\/cooklang["']/`. I probed both gaps:

- `packages/api/src/v4probe.mjs` with a real `import … from "@cooklang/cooklang"` → **assertion stayed GREEN**;
- `packages/api/src/v4probe-dyn.ts` with `await import("@cooklang/cooklang")` → **assertion stayed GREEN**.

No such file exists today (a repo-wide grep over `.ts/.tsx/.mjs/.js` finds only
`parse-worker.ts`, the justified `round-trip.test.ts` oracle, and `.planning/`
spikes that are not built), so this is **not a live bypass**. But the docblock at
`pool.test.ts:1216` claims the walk is done "rather than derived from an import
graph, so nothing can hide behind a dynamic specifier" — **a dynamic specifier is
exactly what hides.** Widening the regex to cover `import(` / `require(` and the
extension filter to `.mjs`/`.js` is a two-line change; recorded, not done.

---

## B. THE NEW RSS GATE — **the false-refusal fear is REFUTED, but the record's headroom number is wrong in the other direction**

### B.1 The warm-child measurement — the director's hypothesis does not hold

I forked the real child exactly as `spawnChild` does
(`execArgv:['--max-old-space-size=256']`, `stdio` ignored, json IPC), sampled
`/proc/<pid>/status` VmRSS at 2 ms, and drove **1 050 heavy parses** to a genuine
plateau before measuring the worst legitimate shapes.

```
FRESH idle RSS                      73.5 MB      (record: 73.5 — reproduced exactly)
worst-legit on a FRESH child       154.2 MB peak, 518 ms CPU   (record: 152.9 / 506 — reproduced)
RSS trace over 1 050 heavy parses  10:167.4  50:177.0  200:186.8  500:188.4  800:188.3  1050:178.9
PLATEAU idle RSS                   178.9 MB     (record: 175.2 — close; mine mixed in a prose family)

--- worst legitimate parse on a FULLY WARMED child ---
  "#p " x 21845 (65 535 B)   peak 191.4 MB   delta over plateau  +12.5 MB   393 ms CPU
  "@a{1%g} " x 8192 (65 536 B) peak 188.5 MB delta over plateau   +9.6 MB   250 ms CPU
  65 000 B of prose          peak 188.5 MB   delta over plateau   +9.6 MB     4 ms CPU
```

**The hypothesis that a warm child gives ~175 + 79 ≈ 300 MB is wrong, and the
reason is the same fact that produces the plateau:** WASM linear memory only ever
grows and is never returned, so the plateau *is* the high-water mark. A later parse
**reuses** the already-grown linear memory instead of growing it again — which is
precisely why RSS plateaus across 1 050 parses rather than climbing. The worst
legitimate parse on a fully warmed child costs **+12.5 MB**, not +79 MB.

**So the real headroom is 512 / 191.4 = 2.67x.** Not the 1.7x feared, and not the
**3.3x claimed** — the record's 3.3x is computed against the *fresh*-child figure
(152.9 MB) and is therefore optimistic. 2.67x is the same order as the CPU gate's
own 2.96x and follows the same headroom rule. **No false-refusal risk. `limits.ts`
line 273's "3.3x over the worst legitimate peak" should read ~2.7x against a warm
child** (record correction, not a defect).

### B.2 Contention-invariance — holds on CPU and on moderate memory pressure; severe pressure UNTESTED

I replicated the gate loop exactly (25 ms poll, 1 500 ms CPU, 512 MB RSS) and ran
the two ballooning families three ways:

| condition | report-explosion | round-1 bypass |
|---|---|---|
| **idle** | `pool-rss` @ 516 MB / **673 ms** CPU, wall 1 072 ms | `pool-rss` @ 516 MB / **754 ms** CPU, wall 1 157 ms |
| **8 spinners on 4 cores** | `pool-rss` @ 513 MB / **631 ms** CPU, wall **3 952 ms** | `pool-rss` @ 513 MB / **673 ms** CPU, wall **2 545 ms** |
| **700 MB memory hog** (available 2 512 → 1 682 MB) | `pool-rss` @ 519 MB / **630 ms** CPU, wall 686 ms | — |

The idle figures reproduce the record's 679/744 ms. Under 8-spinner contention the
gate fires at the **same RSS** and within **6–11 % on CPU**, while **wall clock
inflates 2.2–3.7x**. That is D-27-W3B-03a's thesis, independently confirmed: RSS
and CPU measure the work, wall clock measures the box.

**UNTESTED: severe memory pressure.** A 1 400 MB hog drove the box into swap
thrashing and I aborted the run after 10 minutes rather than risk the host; the
processes were killed and memory verified returned. I will not guess the result.
The structural position, stated rather than hidden: if reclaim makes VmRSS
*under*-report, the RSS gate fires late or not at all — but the CPU gate is
unaffected (schedstat counts CPU actually burned, and these families burn
4 895–12 222 ms against a 1 500 ms budget) and the 8 000 ms wall backstop remains.
The child still dies and the caller still gets `null`; **the exposure is a larger
memory transient, not an unbounded parse.**

### B.3 Both gates still have teeth — measured separately

Baseline: **339 cooklang tests / 7 files, all green.**

| mutation (reverted byte-identically) | RED |
|---|---|
| CPU gate only disabled (`cpuMs > Number.MAX_SAFE_INTEGER`) | **7** |
| RSS gate only disabled (`rssMb > Number.MAX_SAFE_INTEGER`) | **4** |
| **both** disabled | **9** |
| `execArgv: []` | **0** — 339/339 green |

VERIFY-3 measured 8 RED for disabling the CPU gate; I measure **7**. The drop is
real but not a loss of the property: the 7 include
`pins the CPU gate on the H1 artefact with the wall backstop lifted (deterministic)`
— a test built specifically so the RSS gate *cannot* mask it — plus
`limits.test.ts`'s worst-ACCEPTED-shape rows and the `attach-tokens` CPU-gate
degradation case. The RSS gate's 4 include its own deterministic pin. **Neither
gate is masked by the other.**

### B.4 `cookParseOldSpaceMb` — **plainly: it is decoration in the suite**

`execArgv: []` leaves **339/339 green**. It has **zero test coverage and cannot
have any**, because the RSS gate at 512 MB fires before any payload can reach a V8
old-space OOM. `limits.ts:287-294` says this openly and the explanation is correct.
It remains a defensible *design* second line for the one hole the RSS gate has (a
single allocation larger than one 25 ms poll), but it is an **unproven** one. That
is the honest answer to the question.

### B.5 The W6 consequence

Under W6 (`cook_source` NOT NULL) a false refusal becomes a hard import failure. At
the honest warm-child number the gate sits at **2.67x** over the worst legitimate
peak, with the worst legitimate parse consuming only **+12.5 MB** above a plateau
that is itself stable across 1 050 parses. That is a defensible margin for W6 — the
memory axis is *not* the thin one. **The thin one remains the 8 000 ms wall
backstop under >5.3x contention (§15.3), which is already on the W6 prerequisite
list.** See FINDING C-1 for a W6 prerequisite that is *not* yet on that list.

---

## C. BLOCKER 6 — the decision to CLEAR is **correct**; I verified the justification in the code, and the cost is real

I read the three code paths rather than accepting the docblock:

1. **`deriveProjectionTx` (`packages/db/src/repositories/cook-projection.ts:237`)**
   writes ingredient rows for **both** systems (`nativeRows` + `derivedRows`,
   lines 316-320) but calls
   `syncProjectedStepsTx(tx, recipeId, systemUsed, projection.steps)` — and that
   function is scoped throughout to `eq(stepsTable.systemUsed, systemUsed)`
   (line 362). **The opposite system's steps are never derived.** D-27-W2-05 confirmed.
2. **`conversionSchema`
   (`packages/shared-server/src/ai/schemas/conversion.schema.ts`)** — what
   `convertRecipeDataWithAI` returns — is `{ingredients: [{ingredientName, amount,
   unit, systemUsed, order}], steps: [{step, systemUsed, order}]}`. **A flat
   ingredient list and step text with no per-step refs, in either direction.**
3. **`recipe_ingredients`
   (`packages/db-schema/src/schema/recipe-ingredients.ts:9-24`) has no step-linkage
   column** — no `stepId`, no `stepOrder`. I checked, because if linkage were stored
   the re-mint would be possible without a re-parse and clearing *would* be a bandaid.

**It is not stored.** The only per-step linkage that exists anywhere is inside the
native `.cook`'s inline `@ingredient{}` tokens, so a re-mint requires re-parsing a
stored source — against §15.5's "re-serialize, not re-parse" — and then
transplanting refs across AI-rewritten prose by name. **Clearing is the correct call
on the code as it stands. Not a bandaid; not a FAIL.**

**The SQL `CASE` is correct in every path I could construct:**

```sql
cookSource: CASE WHEN recipes.system_used = $system THEN recipes.cook_source ELSE NULL END
```

- In Postgres, `SET` expressions are evaluated against the **pre-update** row, so
  this reads the old `system_used` in the same statement — no window in which the
  two disagree, and no separate `SELECT` to race.
- Same-system call keeps the source — proven: the sibling test
  `a switch to the system the .cook is already written in KEEPS it` stayed **green**
  under my blocker-6 mutation (§D below), so it is a genuine sibling, not a mirror.
- `system_used` NULL → `NULL = $system` is NULL → not TRUE → `ELSE NULL` → clears.
  Fail-safe.
- Concurrent writers serialize on the row lock; the second sees the first's
  committed value. The optional `version` guard is unchanged.

### FINDING C-1 (follow-up, W6 prerequisite, not on the recorded list) — the honest cost

A metric→US→metric round trip **permanently loses the `.cook`** with no repair path,
because W5 does not exist. Today that costs the user nothing (the recipe falls back
to the legacy render; every underlying row is still there). **Under W6's NOT NULL,
`setActiveSystemForRecipe` would attempt to write NULL into a NOT NULL column and
the UPDATE would throw — turning a routine user action (the metric/US toggle) into a
hard failure.** VERIFY-3's W6 prerequisite list records only the 8 000 ms wall
backstop; **this is a second, independent W6 prerequisite and it is not written down
anywhere.** Recorded here so W6 cannot land without resolving it (W5's backfill, or
a re-mint path, or making the toggle refuse rather than clear).

---

## D. BLOCKER 5 — the discriminated union **holds**; I could not defeat it

**(1) The guard really throws.** I neutered `assertCookUnaffected` by replacing its
`COOK_DESCRIBED_FIELDS.filter(...)` with `const touched: string[] = []`. Result:
**exactly 1 RED** — `refuses an "unaffected" claim that rewrites what the .cook DOES
describe`. Not derivable-but-toothless.

**(2) Every caller is classified correctly.** There are exactly three production
`updateRecipeWithRefs` call sites and I read all three:

| call site | mode | correct? |
|---|---|---|
| `packages/queue/src/nutrition-estimation/worker.ts:78` | `unaffected` | ✔ writes only `calories`/`fat`/`carbs`/`protein`, none of which reaches the serializer |
| `packages/trpc/src/routers/recipes/recipes.ts:259` | `invalidate` | ✔ the editor rewrites ingredients + steps from a linkage-free client payload |
| `packages/shared-server/src/archive/parser.ts:335` | `invalidate` | ✔ an archive overwrite replaces the whole recipe from a `.cook`-less DTO |

`COOK_DESCRIBED_FIELDS` is a genuine superset of what the serializer emits: I
checked `buildFrontmatter` (`serialize.ts:335-353`) against it — `title`←`name`,
`servings`, `time.prep`←`prepMinutes`, `time.cook`←`cookMinutes`,
`source`←`url`, `norish.system`←`systemUsed`, plus body `steps`/`recipeIngredients`,
plus the conservative `totalMinutes`. Nothing the serializer reads is missing.

**(4) Reproduced red-then-green on a real Postgres.** Baseline
`cook-write-path.test.ts` = **24/24 passed**. Then:

| mutation (reverted byte-identically) | RED |
|---|---|
| remove the `cookSource: CASE …` from `setActiveSystemForRecipe` | **1** — `a metric -> US switch leaves no metric .cook on a US recipe` |
| neuter `assertCookUnaffected` | **1** — `refuses an "unaffected" claim that rewrites what the .cook DOES describe` |
| restore pre-fix behaviour (`updateData.cookSource = cook ? … : null` unconditionally) | **1** — `a nutrition-only update does not delete cook_source` |

Each mutation reddened **exactly the one test that names it**, and no other. These
are real, targeted assertions.

### FINDING D-1 (follow-up, does not block) — `createRecipeWithRefs`'s `cook?` hole is narrowed, not closed

The stated ground is right as far as it goes: an INSERT has no prior projection, and
when `cook` is supplied the ingredients and native steps are **derived from it**
(`recipes.ts:1046-1052`), so those cannot disagree.

But the **scalar** columns still come from `input`, and nothing cross-checks them
against the `.cook`'s own frontmatter. In particular **nothing asserts that
`cook`'s `norish.system` equals `payload.systemUsed`** — an insert can therefore
store a metric `.cook` on a row marked `us`, which is precisely the blocker-6 defect
arriving through the insert door instead of the switch door.

It is **not reachable today**: all seven `createRecipeWithRefs` call sites mint the
payload from the same DTO via `buildCookPayload`. But that is a convention, and the
update path got a *required discriminated union plus a runtime assertion* for
exactly this class of risk while the insert path got neither — the same asymmetry
("a convention is not a boundary") that made blocker 4 a blocker. A one-line
`assert cook.cookSource's norish.system === payload.systemUsed` would close it.

---

## E. GATE 2's DEDUPE — **YES, it reproduces from the lockfile. The green typecheck is not an artefact of the local surgery.**

This was the biggest doubt and it resolves cleanly, because **the dedupe is
declarative, not manual**: G2 added a **sixth override** to `pnpm-workspace.yaml`.
That file's entire diff against `origin/main` is one line:

```yaml
 overrides:
+  "@tanstack/query-core": 5.100.11
   "@tanstack/react-query": 5.100.11
```

Six independent pieces of evidence:

1. **The lockfile encodes the result.** `origin/main` has **two** `query-core`
   entries (`5.100.10`, `5.100.11`); HEAD has **one** (`5.100.11`).
2. **The exact offending edge is fixed.**
   `@tanstack/query-persist-client-core@5.100.10` → `@tanstack/query-core` was
   `5.100.10` in `origin/main` and is **`5.100.11`** at HEAD. That nested `5.100.10`
   was the mobile typecheck error's root cause.
3. **The lockfile is self-consistent with the manifests.**
   `pnpm install --frozen-lockfile --lockfile-only` → **EXIT 0, lockfile byte-unchanged**
   (run twice). A stale lockfile would have failed the frozen check.
4. **The Docker build performs the identical resolution** —
   `docker/Dockerfile:73` and `:100` are `pnpm install --frozen-lockfile`, from
   copied manifests + `pnpm-lock.yaml` + `pnpm-workspace.yaml` only.
5. **The local surgery cannot reach the image.** `.dockerignore` line 2-3 excludes
   `node_modules` and `**/node_modules`; the Dockerfile never `COPY`s it. The
   quarantine lives at `node_modules/.g2-quarantine-tanstack-with-dup/` (4.2 MB,
   inside gitignored `node_modules`).
6. **The quarantine was stale state, not a load-bearing hack.** I opened it: it is
   the old root `@tanstack` tree, and it contains
   `query-persist-client-core/node_modules/@tanstack/query-core` — **the nested
   duplicate**. The live tree has no nested `query-core` at all, only the hoisted
   `5.100.11`. The surgery removed a tree materialised *before* the override existed.

**The claimed lockfile delta is exactly true.** Computed over all package@version
entries:

- `origin/main` 1 971 → HEAD 1 958, **net −13**
- **13 removed, 0 added, 0 version changes** — every removal is the *older* of two
  versions already present: the whole stale `better-auth@1.5.4` family (9 entries),
  `@tanstack/query-core@5.100.10`, `better-call@1.3.2`, `@better-auth/utils@0.3.1`,
  `defu@6.1.4`.
- Names carrying more than one version: **235 → 222** (= 13 fewer).

The `better-auth` half of gate problem #2 was fixed by the same lockfile refresh
(the 1.5.4 tree was stale residue; the catalog already pinned 1.6.9), not by an
override — and it too reproduces from the frozen lockfile.

**All five pre-existing overrides are present and effective** in both
`pnpm-workspace.yaml` and the lockfile's resolved `overrides:` block:
`@tanstack/react-query 5.100.11`, `@trpc/client 11.17.0`, `@trpc/server 11.17.0`,
`@trpc/tanstack-react-query 11.17.0`, `zod 4.4.2` — plus the new sixth.

### The `onlyBuiltDependencies` question — the suspicion is **inverted**, and it is pre-existing

`pnpm config list` on this tree shows the **effective** list is
`pnpm-workspace.yaml`'s six (`@tailwindcss/oxide`, `@heroui/shared-utils`,
`esbuild`, `ffmpeg-static`, `sharp`, `unrs-resolver`). Root `package.json`'s
`pnpm.onlyBuiltDependencies` (`heroui-pro`, `@heroui-pro/react`,
`heroui-native-pro`) is **not** in the effective config — in pnpm 10.33
`pnpm-workspace.yaml` wins. So it is the **root `package.json` list that is being
silenced, not the workspace one**, and the packages whose build scripts actually
matter for the image (`esbuild`, `sharp`, `@tailwindcss/oxide`, `unrs-resolver`) are
the ones that **are** honoured. `pnpm install` emits no "ignored build scripts"
warning. Root `package.json` is **unchanged in the 47-commit range**, so this
predates the plan and G2 did not touch it. Not a defect introduced here; recorded
because it was asked.

### What I could NOT do, stated plainly

I did not materialise a clean install into a throwaway store, and I did not build
the image. `--lockfile-only` proves **resolution** consistency; it does not prove
**materialisation**. Given (1) exactly one `query-core` snapshot in the lockfile and
(2) the persist-client-core edge pointing at `5.100.11`, pnpm has nothing to nest —
but I did not observe it.

**What the deploy agent must check inside the image** (cheap, three commands):

```sh
# 1. exactly one query-core, hoisted, at 5.100.11 — and NO nested copy anywhere
find /app/node_modules -path '*@tanstack/query-core/package.json' -exec grep -H '"version"' {} +
# 2. the stale better-auth family is really gone
find /app/node_modules -path '*better-auth/package.json' -exec grep -H '"version"' {} +
# 3. the quarantine never shipped
ls -d /app/node_modules/.g2-quarantine-tanstack-with-dup 2>&1   # must be "No such file"
```

Expected: one `query-core` at `5.100.11`, `better-auth` at `1.6.9` only, no
quarantine directory.

---

## F. G1 + G4 — **test isolation was NOT traded for speed**

I diffed both files line by line. **The changes are exclusively: hoist the subject
`await import()` to file scope, drop `vi.resetModules()`, drop the `{ timeout: 15000 }`
override, and (G1) create the temp uploads dir synchronously + move cleanup to
`afterAll`. Not one assertion, mock factory, spy, or `mockResolvedValue` seam was
touched.**

**G4's central claim is true, and I checked the mechanism rather than the prose.**
`import-flow.test.ts:52` declares `const mockServerConfig = {…}`; the subject holds
`parserEnvConfig = SERVER_CONFIG as …` (`packages/api/src/parser/index.ts:24`) — the
**same object**. The only two mutations are `mockServerConfig.LEGACY_RECIPE_PARSER_ROLLBACK = false`
(line 168, in `beforeEach`) and `= true` (line 293) — **mutated in place, never
reassigned**. A live binding therefore sees every later mutation with no re-import,
so `vi.resetModules()` genuinely bought no isolation on this seam; the per-test
`vi.clearAllMocks()` + fresh `mockResolvedValue`/`mockReturnValue` in `beforeEach`
are what isolate these tests, and both are kept verbatim.

**Isolation re-proved by me:** 3 × `--sequence.shuffle` across both files together →
**11/11 passed every time**. Each file also passes alone. The removed 5 000 ms
default and 15 000 ms override are no longer load-bearing: both files now run their
subject at file-collection time, which neither `testTimeout` nor `hookTimeout`
bounds.

**G3** is also clean: the `eslint-disable-next-line no-console` at
`cook-payload.test.ts:619` is gone, replaced by vitest's own
`annotate(...)` channel (line 623), and **no `eslint-disable … no-console` remains
anywhere in the repo's test tree.**

### FINDING F-1 — see §FAIL-2: a **third** instance of the disease G1/G4 cured is still live, and unflagged

---

## G. BLOCKERS 2 & 3 — non-vacuous, confirmed by my own probes

**Blocker 2 — the minted `REALISTIC` really passes the real recognizer.** I ran the
actual serializer and the actual `findCookSourceDefect`:

```
MINTED: '---\ntitle: "Weeknight Tomato Pasta"\nservings: 4\nnorish.system: "metric"\n---\n== Prep ==\n\nBring a large pot…@spaghetti{400%gram}.\n'
findCookSourceDefect -> null
```

The frontmatter is now **quoted**, which is exactly what the stale hand-written
literal was not. Closed.

**Blocker 3 / the "8 192 headings" claim — it is genuine, not a silent failure
reclassified.** This deserved the suspicion, because
`parseCookSource` returns `null` on *both* "parsed cleanly, zero steps" and "the
parser emitted a diagnostic". I resolved it at the child, below both:

```
"== h ==\n" x 8192  (exactly 65 536 B, i.e. atCap)  ->  ok=true  reportEmpty=true  steps=0
a good recipe                                       ->  ok=true  reportEmpty=true  steps=1
```

`reportEmpty=true` means **no diagnostic**. And it is a real parse, not a refusal:
through `parseCookSource` it takes **472 ms** and crosses the process boundary
(a refusal costs ~1 ms — `"#" x 8192` is refused as
`{"defect":"malformed-token","offset":0}` in 1 ms, as recorded). Zero steps is the
semantically correct answer: a Cooklang section heading is not a step. **The
`no-steps` outcome label is honest.**

*(Aside: an earlier probe of mine used `"== Heading ==\n" x 8192` = 114 688 B, which
is over `maxCookSourceBytes` and is refused by the byte cap in 1 ms. The suite's
`atCap()` helper sizes it correctly at 65 536 B. Recording this so a fifth round
does not repeat my mistake.)*

**Blocker 3's assertions have real teeth, proven by mutation.** With the child
entry made unspawnable (`NORISH_COOK_PARSE_WORKER_PATH=/nonexistent/…`, an
env-only mutation touching no file), `limits.test.ts` goes **28 RED / 122 passed**.
Under the old vacuous form — `if (result !== null)` plus "poolSpy was called" — the
ten accepted-hostile rows would all have passed in silence. The new
`expect(loggedReasons().filter(r => POOL_DEGRADED.includes(r))).toEqual([])` plus the
unconditional structural checks catch it.

The `attach-tokens.test.ts` half is likewise specific now: it pins
`errorReasons).toContain("pool-spawn-failed")` **by name** and asserts the four bound
reasons are absent. It is also self-protecting — `VALID_COOK` is still a
hand-written literal, but if the recognizer ever refused it the source would never
reach the pool, no `pool-spawn-failed` would be logged, and the test would go RED
rather than pass for the wrong reason.

---

## H. INTEGRITY AUDIT over the 47-commit range

| check | result |
|---|---|
| migration files changed | **none** (`packages/db/src/migrations`, `packages/db-schema` — empty diffstat) |
| `_journal.json` | **42 entries**, last `0041_add_cook_source`, **unchanged in the range** |
| any `.sql` touched | **none** |
| `.skip` / `.only` / `.todo` / `.fails` / `xit` / `xdescribe` added | **none** |
| disabled-gate residue (`MAX_SAFE_INTEGER`) in `src/cooklang/` | **none** |
| `eslint-disable` added in production `src` | **none** |
| `as any[]` in `recipes.ts` | **5 in `origin/main`, 5 at HEAD — no net addition** (the `+` lines in the diff are relocations) |
| `tx: any` in `cook-projection.ts` | **pre-existing** — present at `origin/main:216,332` |
| production importers of `@cooklang/cooklang` | **exactly one**, `parse-worker.ts` (and 0 real imports in the shipped `index.mjs`) |
| `pnpm-lock.yaml` change | **only** G2's dedupe — 13 removed, 0 added, 0 version changes |
| `pnpm-workspace.yaml` change | **one line**, the `@tanstack/query-core` override |

**`pnpm-workspace.yaml` ownership (root→claude, 0644) breaks nothing** — verified by
consequence, not assumption: `pnpm install --frozen-lockfile --lockfile-only`
EXIT 0, `pnpm typecheck` 17/17 EXIT 0, `pnpm lint` 14/14 EXIT 0, `build:server`
EXIT 0. pnpm reads it fine at 0644.

`boundFromEnv` (`limits.ts:163-171`) correctly rejects `0`, negatives and
non-integers via `Number.isSafeInteger(parsed) && parsed > 0`, so **no env override
can silently disable a gate.**

Protocol note: for the two files I mutated,
`node_modules/@norish/{db,shared-server}/src` are **symlinks** to the workspace
(same inode — verified `314874` for `recipes.ts`), not hardlink farms, so the
injected-twin trap §15.1 warns about did not apply here. I used reverse edits
regardless and verified twin md5 equality.

### FINDING H-1 (record correction) — VERIFY-3 mis-attributed the `TRPCLink<any>` widening

VERIFY-3 lists `createHttpTransportLink` returning `TRPCLink<any>` under "**pre-existing**
widening". **It is not pre-existing — it was added inside this 47-commit range.**

```diff
-function createHttpTransportLink<TRouter extends AnyTRPCRouter>(
+function createHttpTransportLink(
   getBaseUrl: () => string,
   getHeaders: () => HTTPHeaders
-): TRPCLink<TRouter> {
+): TRPCLink<any> {
```

Occurrence count `TRPCLink<any>`: **4 at `origin/main` → 5 at HEAD**. Introduced by
`bba2943e fix(shared-react): resolve generic-inference errors in trpc/query plumbing`
— i.e. part of the price paid for removing `--noCheck` from `shared-react`. Minor, a
link factory's router type, unrelated to T-27-01, **does not block the deploy** —
but the range is not "no type widening added", and a fifth round should not inherit
that claim. (`.planning/quick/typecheck-gate-restore.md`'s blanket "no type-widening"
claim is separately known-wrong and already annotated in place.)

---

## I. STILL-OPEN MINORS — confirmed present, **not made worse**, not fixed

**The zero-denominator WASM panic is unchanged and still contained.** Driven
straight at the child:

```
"@a{1/0%g}"  -> ok=false  "RuntimeError: unreachable"
"@a{0/0%g}"  -> ok=false  "RuntimeError: unreachable"
"@a{1/2%g}"  -> ok=true, parses (amount null, unit "g")
```

The trap is caught by `handle()`'s try/catch, so the **child survives and answers**;
the pool then retires it and the caller gets `null`. Parent unaffected, cost ~0 ms.
Still a gap in the H2 fix (which closed the whitespace-shaped traps), and still
**not recorded or tested anywhere in `packages/shared-server`** — a grep for
`1/0` / `0/0` / "zero-denom" finds nothing. Unchanged from VERIFY-3.

**`shared-react`'s `TRPCLink<any>`** — present, and see FINDING H-1 for the
correction to its provenance.

---

## THE TWO CONTENTION-ONLY FAILURES

Both are **test-only**. Neither can fail the deploy: `docker/Dockerfile:109` runs
`pnpm run build`, and `turbo.json`'s `build` task declares `dependsOn: ["^build"]`
only — **the image build runs no tests and no typecheck.**

### FAIL-1 — `pool.test.ts:419`, a bare wall-clock assertion in **this plan's own new file**

```
FAIL __tests__/cooklang/pool.test.ts > a real recipe round-trips through the process
     boundary > each committed fixture completes in under 50 ms once the pool is warm
AssertionError: expected 50.03161200000068 to be less than 50
```

```ts
// packages/shared-server/__tests__/cooklang/pool.test.ts:419-431
it("each committed fixture completes in under 50 ms once the pool is warm", async () => {
  await parseInPool(REALISTIC, units);
  for (const fixture of fixtures) {
    const startedAt = performance.now();
    await parseInPool(structuredToCooklang(fixture.recipe, units), units);
    expect(performance.now() - startedAt).toBeLessThan(50);   // <-- wall clock
  }
});
```

**Reproduction:** it failed in my full `pnpm test` run while an unrelated
CPU-heavy process was running. Green **3/3 in isolation**, green **3/3 under 8
spinners in isolation**; the trigger is full-suite vitest worker load plus external
CPU pressure. `@norish/shared-server` alone is 554/554 green, twice.

**Why this matters more than a 0.03 ms overshoot:** the docblock **14 lines below
it** (lines 433-467) is a long, correct explanation of why a wall-clock latency
assertion is the wrong instrument, and moves its sibling onto CPU + a
minimum-of-100 floor — "*Raising it to 25 ms would have been the wall-clock retune
this phase already rejected once*". And §15.2's W3B-W10 row records this very test
measuring **303 ms** under a mutation, i.e. its inflation was *observed and used as
evidence* — yet it was never recognised as the same disease. It is the exact defect
class D-27-W3B-03a, §15.3, G1 and G4 were all written to cure, sitting in the file
those fixes were written around.

**Blocks deploy?** No — test-only, no production path. **Follow-up:** apply the cure
already used 14 lines below (assert on child CPU via `cookParseChildCpuMsForTests`,
or on the minimum of N round trips), not a bigger constant.

### FAIL-2 — `packages/auth/__tests__/auth/workos-provider.test.ts:76`, a third instance of the G1/G4 disease

```
FAIL __tests__/auth/workos-provider.test.ts > buildWorkOSProviders >
     returns no provider when WorkOS is not configured
Error: Test timed out in 5000ms.   (measured 5 660 ms)
  ❯ __tests__/auth/workos-provider.test.ts:76:3
     77|  workosCacheValue = null;
     78|  const { buildWorkOSProviders } = await import("@norish/auth");
```

The file has **8** in-test `await import("@norish/auth")` calls behind a
`vi.resetModules()` (line 73) — **structurally identical** to what G1 fixed in
`migrate-gallery-images.test.ts` and G4 in `import-flow.test.ts`. `packages/auth` is
**untouched by the 47-commit range** (empty diffstat), so this is **pre-existing and
out of scope** — but G1's commit message flagged only `import-flow.test.ts` as the
remaining instance, and G4 then closed that one, leaving the impression the class was
exhausted. It was not.

**Blocks deploy?** No — pre-existing, test-only. **Follow-up:** same cure, or accept
it as known.

**Net effect on the gate claim:** `3 362 passed / 0 failed` is **true on an idle
box** and I reproduced it exactly. It is **not** unconditional — under contention I
saw 2 failures, both listed above. `27-04-FIX-GATES.md:36` states
"3 362 passed, 251 files, 11 packages, 0 failed" without that qualifier.

---

## SUMMARY OF FINDINGS

| # | belongs to | file:line | blocks deploy? |
|---|---|---|---|
| **FAIL-1** | gates / D-27-W3B-03a class | `packages/shared-server/__tests__/cooklang/pool.test.ts:419` (assert at :429) | **No** — test-only; image build runs no tests |
| **FAIL-2** | G1/G4 class (pre-existing) | `packages/auth/__tests__/auth/workos-provider.test.ts:76` | **No** — pre-existing, test-only |
| **A-1** | blocker 4 | `packages/shared-server/__tests__/cooklang/pool.test.ts:1221,1252` | No — follow-up; no live importer exists |
| **B-1** | blocker 1 (record correction) | `packages/shared-server/src/cooklang/limits.ts:273` | No — headroom is **2.67x**, not 3.3x; still safe |
| **B-4** | blocker 1 | `cookParseOldSpaceMb` — 0 test coverage, by construction | No — documented, defensible, unproven |
| **C-1** | blocker 6 → **W6 prerequisite, unrecorded** | `packages/db/src/repositories/recipes.ts:1156` | No today — **hard failure under W6 NOT NULL** |
| **D-1** | blocker 5 | `packages/db/src/repositories/recipes.ts:951` (`cook?`) | No — unreachable today, unenforced |
| **H-1** | integrity (record correction) | `packages/shared-react/src/providers/trpc-links.ts:213-216`, added by `bba2943e` | No — but the range is not "no widening added" |
| **UNTESTED** | blocker 1 / D-27-W3B-03a | RSS behaviour under **severe** memory pressure | — aborted to protect the host; redundancy argument in §B.2 |

---

## VERDICT

**PASS. Safe to deploy.**

All six VERIFY-3 blockers are closed **at the root**, and I proved each one rather
than reading it: the pool's third door is gone from the exports map and every
deep-import variant I could construct returns `ERR_PACKAGE_PATH_NOT_EXPORTED`; the
single-importer property holds in the **shipped bundle**; all four static door
assertions and both write-path fixes go RED under targeted mutation and green when
restored; the RSS gate has **2.67x** real headroom on a *fully warmed* child and is
contention-invariant where I could measure it; both resource gates independently
retain teeth (7 / 4 / 9 RED); and G2's dedupe is **declarative and reproduces from
`pnpm-lock.yaml` + `pnpm-workspace.yaml`**, with the local `node_modules` surgery
provably unable to reach the image.

I found **no bypass of T-27-01** — the second consecutive round with none — and no
defect that reaches production. The two failures I did find are wall-clock test
flakes that appear only under contention, cannot fail the image build, and have no
runtime path.

**Two things I want on the record before anyone reads this as unqualified green:**

1. **FAIL-1 is in this plan's own file and is the exact defect class the plan
   exists to cure.** It does not block the deploy, but leaving it fixes nothing and
   the next round will find it again.
2. **C-1 is a W6 prerequisite that nobody has written down.** Under W6's NOT NULL,
   `setActiveSystemForRecipe` clearing `cook_source` turns the metric/US toggle into
   a hard failure. W6 must not be planned without resolving it.

And one honest gap: **severe memory pressure is UNTESTED**, not passed.
