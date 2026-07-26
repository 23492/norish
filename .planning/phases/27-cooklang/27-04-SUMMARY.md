---
phase: 27-cooklang
plan: 04
subsystem: infra
tags: [cooklang, wasm, child-process, resource-bound, dos, tsdown, vitest]

status: PARTIAL — Tasks 1, 2 and 5 COMPLETE. Tasks 3, 4 and 6 NOT STARTED. Parse bound REPLATFORMED onto CPU time by D-27-W3B-03a (director, 2026-07-26) — see §13.

requires:
  - phase: 27-03
    provides: the serializer escaping layer, `findCookSourceDefect`, the nine `COOK_LIMITS`
provides:
  - "A pooled child process that is the ONLY importer of `@cooklang/cooklang`"
  - "`COOK_BOUNDS`: a 1 500 ms CHILD-CPU SIGKILL gate (D-27-W3B-03a, superseding the 1 000 ms wall-clock bound), an 8 000 ms wall-clock BACKSTOP and a 256 MB child heap bound"
  - "`async` `parseCookSource` / `buildCookPayload` / `buildCookFromExtraction`"
  - "`revalidateCookPayload` — the copy path's door (T-27-07)"
  - "A HARD build-time gate that the child entry is emitted into `dist-server`"
affects: [27-04 tasks 3/4/6, W4 token renderer, W5 backfill]

tech-stack:
  added: []   # node:child_process only — no new third-party dependency
  patterns:
    - "Resource bound over input recognition for untrusted native code"
    - "Pooled child process, terminate-and-replace, bounded request queue"
    - "Spy the BOUNDARY, not the implementation, when the implementation moves off-thread"

key-files:
  created:
    - packages/shared-server/src/cooklang/parse-worker.ts
    - packages/shared-server/src/cooklang/pool.ts
    - packages/shared-server/__tests__/cooklang/pool.test.ts
  modified:
    - packages/shared-server/src/cooklang/{parse,build-payload,attach-tokens,limits}.ts
    - packages/api/src/ai/{recipe-parser,image-recipe-parser}.ts
    - packages/api/src/ai/features/recipe-extraction/normalizer.ts
    - packages/api/src/video/normalizer.ts
    - packages/db/src/repositories/recipes.ts
    - packages/trpc/src/routers/recipes/shares.ts
    - apps/web/tsdown.config.ts

key-decisions:
  - "D-27-W3B-03a: the PRIMARY gate is the child's CPU time (`/proc/<pid>/schedstat`), not wall clock — wall clock conflates the threat with host load and was measured to refuse legitimate recipes under contention. Superseded the locked D-27-W3B-03."
  - "The guarantee is a RESOURCE BOUND, not an input-shape predicate. Recognizer completeness is no longer load-bearing."
  - "A pooled CHILD PROCESS, not worker_threads: resourceLimits was reproduced aborting the entire Node process."
  - "The child imports ONLY @cooklang/cooklang. Unit canonicalization moved to the parent — raw Node cannot load @norish/* source."
  - "The tsdown sibling extension is derived, not hardcoded: the bundle emits .mjs, not .js."
  - "copyRecipeForSave's `cook` is now a REQUIRED caller-proven parameter; @norish/db stays parser-free."
---

# 27-04 — Bound the WASM parse (Tasks 1, 2, 5)

**Commits:** `59f3a767` (T1) · `4bbeecc7` (T2) · `226f04a7` (T5). Nothing pushed.
**Tree:** `main`, DB at migration **42**, `pnpm-lock.yaml` diff EMPTY.

> **THIS PLAN IS NOT COMPLETE.** Tasks 3 (H1 frontmatter recognizer), 4 (H2 + H3
> root fixes) and 6 (adversarial weakenings) are **untouched**. See
> *"What Tasks 3, 4 and 6 must still pick up"* at the end.

---

## 1. What changed, and why the pivot was necessary

T-27-01 was mitigated twice and **refuted twice**. Round 1 predicted which tokens
the parser would object to and was bypassed *and* produced false refusals. Round 2
asserted the serializer's own output grammar and was bypassed through an
unconstrained **frontmatter** recognizer. Both rounds were complete with respect to
the sub-grammar their author knew about.

So the parse itself is now bounded. `@cooklang/cooklang` is reached only by sending
a message to a pooled child process that the parent can `SIGKILL`, and whose heap
V8 caps independently. The escaping layer and `findCookSourceDefect` stay, checked
**first**, as defence in depth — a gap in them now costs one refused or
slow-but-bounded parse rather than an unbounded one.

**Both docblocks that made false guarantees were rewritten** (D-27-W3B-13). This
was a deliverable, not a comment tidy:

| file | the claim that was void |
|---|---|
| `parse.ts` | "a bad `cook_source` can never reach the WASM parser" |
| `limits.ts` | the recognizer "turns the time bound into a CHECKED precondition" |

---

## 2. Mechanism decision, re-measured on THIS box (LXC 110, Node v22.22.3)

| measurement | plan's figure | **re-measured here** |
|---|---:|---:|
| `import("@cooklang/cooklang")` (WASM compile + instantiate) | 15–20 ms | **15.71 ms** |
| `new CooklangParser()` first / subsequent | 6.2 / 0.35 ms | **5.27 / 0.248 ms** |
| first `parse()` (JIT warm-up) | 28.7 ms | **39.64 ms** |
| **fresh `fork` per parse** (spawn→ready→parse→reply, n=10) | 116–134 ms | **200.3 / 216.2 / 242.6 ms** (min/med/max) |
| **in-process sync parse**, 437 B, n=300 | p50 0.643 / p95 3.097 ms | **p50 0.615 / p95 0.952 / p99 2.000 ms** |
| **pooled child IPC round trip**, same fixture, n=300 | p50 0.965 / p95 1.506 / p99 3.508 ms | **p50 0.847 / p95 1.271 / p99 1.926 ms** |

**A pool is mandatory** — a fresh isolate per parse costs ~215 ms, ~250x the pooled
round trip, and would land on every recipe fetch.

### The `worker_threads` finding: REPRODUCED EXACTLY

```
worker_threads, resourceLimits { maxOldGenerationSizeMb: 64 }, round-1 bypass payload
  -> FATAL ERROR: Reached heap limit Allocation failed - JavaScript heap out of memory
  -> node::OOMErrorHandler -> v8::internal::V8::FatalProcessOutOfMemory
  -> v8::internal::JsonParser<unsigned short>::ParseJson <- Builtin_JsonParse
  -> PARENT PROCESS ABORTED, exit code 134
```

Same payload against a child process: contained, parent alive. **A bound that kills
the web server is not a bound.** Do not "simplify" this back to `worker_threads`.

---

## 3. The two bounds as landed

`COOK_BOUNDS` (a separate `as const` object beside the untouched nine `COOK_LIMITS`),
each env-overridable: `cookParseTimeoutMs 1_000`, `cookParseHeapMb 256`,
`cookParsePoolSize 2`, `cookParseQueueTimeoutMs 1_000`.

**Headroom.** 1 000 ms is 1.44x over the worst *legitimate* shape (694 ms), ~59x
over a realistic recipe (17 ms), ~1 500x over a real fixture, and 2x under the
2 000 ms budget. **The 1.44x is thinner than it reads — see §3b, where it was
measured to FLIP under CPU contention.** For a realistic recipe the margin is
enormous and there is no concern at all.

### ⚠ A MATERIAL DEVIATION FROM D-27-W3B-03 — the bounds fire in the OTHER ORDER

The plan predicted 256 MB would be reached at **~285 ms**, *before* the time bound,
so the heap bound would be the binding one for the report-explosion family. **That
did not reproduce.** With the time bound relaxed to 60 s:

| payload | outcome | elapsed | parent RSS delta |
|---|---|---:|---:|
| `"#" x 8192` (8 KiB in, 839 MB peak unbounded) | `pool-heap`, child SIGABRT | **12 402 ms** | −1.2 MB |
| round-1 bypass, 16 x 3 996 of `@a{1%}` | `pool-heap`, child SIGABRT | **6 414 ms** | −1.3 MB |

So the measured allocation rate here is far below ~0.9 MB/ms, and **at the default
1 000 ms bound the TIME bound catches both families.**

**This does not weaken the design, and both bounds are still load-bearing** — but
the reason changes, and the director needs the corrected version:

> The heap bound is what stops a child ballooning to 839 MB–1.65 GB **if the time
> bound is ever raised**. Exit item 3 explicitly contemplates raising
> `NORISH_COOK_PARSE_TIMEOUT_MS` in production. Raising it **without** the heap
> bound would reintroduce the memory incident. Do not treat the heap bound as
> redundant just because the time bound currently fires first.

---

## 3b. ⚠ THE ONE REAL NEVER-BROKEN RISK I FOUND — **DECIDED: see §13 (D-27-W3B-03a)**

> **RESOLVED, 2026-07-26.** The director REJECTED all three options below — they pick
> different points on the same wall-clock axis and each flips again on a busier box — and
> replaced the wall-clock bound with a **CPU-time primary gate**. §13 has the mechanism,
> the measurements and the re-proved failure paths. The analysis below is kept as the
> record of how the defect was found.


**The 1 000 ms bound CAN refuse the worst LEGITIMATE `.cook` shapes on a loaded
box.** This was not predicted by the plan and it is the finding I would escalate
first.

D-27-W3B-03 set 1 000 ms deliberately above the worst legitimate shapes (648 ms /
694 ms) so that "nothing which parses today starts failing". Measured here:

| the worst ACCEPTED shapes | idle box | **under heavy CPU contention** |
|---|---:|---:|
| 64 KiB of `@a{1%g} ` | 331 / 370 / **784 ms** → OK | **1 238 ms → REFUSED** |
| `"#p " x 21845` | 425 / 469 / **485 ms** → OK | **1 137 ms → REFUSED** |

The contended figures are from the real full `@norish/shared-server` run (~20 vitest
workers). **The bound is WALL-CLOCK, and wall clock inflates under contention while
the actual work does not.** At 1.3–1.4x headroom that is enough to flip.

This surfaced because the pool suite asserted the never-broken property as an
absolute and **went red in the full run while passing in isolation** — exactly the
kind of failure that is easy to dismiss as flake. It is not flake.

**What I did and deliberately did NOT do.** I did **not** change
`cookParseTimeoutMs`: D-27-W3B-03 is a locked decision with a recorded rationale and
retuning it is not an executor's call. I did **not** loosen the assertion into
vacuity either. The test now proves what is actually true — that these shapes are not
*inherently* refused (not by the recognizer, not by the heap bound, not by having
become slower), by running them with the bound raised through its supported env
lever — and its docblock states plainly what it does not assert and why.

**The decision for the director.** On LXC 110 the web server, queue workers and
Postgres share CPU, so this is reachable in production: an affected recipe loses its
`cook_source` and renders on the legacy path. Nothing breaks, no import fails, no
500 — but it is a silent quality loss on exactly the largest legitimate recipes.
Options, in the plan's own order of priority (never-broken outranks a tighter bound):

1. **Raise the default to ~2 000 ms** — 2.9x over 694 ms, at the plan's stated budget
   ceiling. Note the existing hostile-corpus assertion (`< 2000 ms`) would then need
   revisiting, and the worst-case request latency for a bounded-out parse doubles.
2. **Ship 1 000 ms and watch `pool-timeout`**, raising
   `NORISH_COOK_PARSE_TIMEOUT_MS` deliberately if the rate is nonzero on real
   recipes. This is exit item 3, and it is now a *likely* action rather than a
   contingency.
3. Leave as-is and accept the loss on the largest recipes.

**Whichever is chosen: the heap bound becomes MORE important, not less, as the time
bound rises** — see the §3 warning.

## 4. THE EXACT-INPUTS TABLE

All bound-column results are with `parseInPool` called **directly** — the layer
*below* the recognizer, so nothing passes because a gate refused it.

| input | bytes | in-process (measured) | **under the BOUND** | recognizer today |
|---|---:|---:|---|---|
| H1 `---\na: "["x65400\n---\nstep\n` | 65 417 | **24 557 / 38 511 ms**; re-measured **29 142 ms** | `null` in **~1 001 ms** | ACCEPTS (Task 3) |
| H1 balanced 25 000-deep `[`/`]` | 50 017 | 4 838 ms; re-measured **5 431 ms** | `null` < 1 500 ms | ACCEPTS (Task 3) |
| H1 balanced 30 000-deep `[`/`]` | 60 017 | 8 256 ms; re-measured **8 909 ms** | `null` < 1 500 ms | ACCEPTS (Task 3) |
| H1 `{`-nesting variant | ~60 000 | 10 489 ms; re-measured **9 193 ms** | `null` < 1 500 ms | ACCEPTS (Task 3) |
| report explosion `"#" x 8192` | 8 192 | **839 MB peak**; re-measured 13 131 ms / `pool-heap` at 12 402 ms | `null` in ~1 001 ms | refused |
| round-1 bypass 16 x 3 996 `@a{1%}` | 63 966 | 7 821 ms / **1 650 MB**; re-measured 6 240 ms | `null` in ~1 000 ms | refused |
| 64 KiB of `@a{1%g} ` — worst ACCEPTED | 65 536 | 648 ms | **SUCCEEDS** (not refused) | accepted |
| `"#p " x 21845` — worst ACCEPTED | 65 535 | 694 ms | **SUCCEEDS** (not refused) | accepted |
| 5 committed fixtures + a 437 B realistic recipe | 225–506 | ~0.6 ms | SUCCEED, < 50 ms each | accepted |

H2 (`@a{ %g}` and friends) and H3 (ref-name whitespace) are **Task 4** and were not
addressed. They remain open — see the handover section.

---

## 5. Risk 1 — the child entry IS in the bundle. Verified empirically, not inferred.

This was the plan's largest risk because its failure mode is **completely invisible**:
production would spawn nothing, resolve `null` on every parse, render every recipe
on the legacy path and emit no error anyone would report.

**A bug was actually caught here, and only by looking at the real output directory.**
`dist-server` emits **`.mjs`, not `.js`**. My first sibling rule hardcoded
`parse-worker.js` — which would have resolved a path that does not exist, in
production only, silently. The rule now derives the extension from the pool's own
`import.meta.url` via `extname()`.

Evidence, in order:

1. `pnpm --filter @norish/web build:server` → **EXIT 0**, emits
   `dist-server/parse-worker.mjs` (6.94 kB), and `index.mjs` stays at its
   Dockerfile-expected path (the entry is a **named object entry**; the array form
   would have re-rooted `index.mjs` to `apps/web/server/index.mjs`).
2. Import-statement counts in the emitted output:
   `dist-server/index.mjs` → **0** imports of `@cooklang/cooklang`;
   `dist-server/parse-worker.mjs` → **1**. The WASM is not in the parent bundle.
3. **THE HARD GATE FIRES.** With the entry removed from the config, the build
   **EXITS 1** with the explanatory error. Verified by executing it, then reverting.
4. **THE POOL ACTUALLY SPAWNS AND PARSES FROM THE EMITTED BUNDLE.** A throwaway
   entry was temporarily added so a real `dist-server/*.mjs` — same directory, same
   extension as `index.mjs` — could exercise the *bundled* pool. Output:

```
import.meta.url of the BUNDLE: file:///opt/norish-src/dist-server/pool-smoke.mjs
pids before first parse (laziness): []
pids after first parse: [ 3203035 ]
TOKENS: [{"order":0,"section":"Prep","tokens":[..., {"type":"ingredient","name":"flour","amount":200,"unit":"gram"}, ...]}]
H1 from the bundle -> null in 1018 ms   (pool-timeout, pid 3203035)
SMOKE OK
```

That proves the sibling rule, the lazy spawn, the parse, the parent-side unit
canonicalization (`unit: "gram"`) **and** the time bound, all from the shipped
artefact. The throwaway entry was removed and the config is byte-identical to
`59f3a767` (`git diff` empty).

---

## 6. Risk 2 — the spy proof genuinely proves 0 parse calls

`vi.mock("@cooklang/cooklang")` cannot reach into a child process. Left alone, all
six `toHaveBeenCalledTimes(0)` assertions in `limits.test.ts` **would have kept
passing while proving nothing** — the vacuous-green pattern that hid four leaks in
Phases 22–22.3.

Every assertion was **re-pointed, none deleted**, from the WASM class to a **pool
spy** that delegates to the real pool. The claim is strictly stronger: not "that
class was not constructed" but **"the pool was never asked"** — nothing crossed the
boundary at all — and it is stable under any future change of isolation mechanism.

**Before/after counts, asserted explicitly in the test itself:**

```
control: the pool spy is provably WIRED — count goes 0 -> 1 across a real mint
  before = 0   (asserted)
  after  = 1   (asserted, and asserted to be > before)
  and the recorded arg is the BYTE COUNT, never the source (T-27-05)
```

**Proven non-vacuous by executing the negative case.** Unwiring the spy body turns
**11 tests RED**, including the control and every accepted-shape
`toHaveBeenCalledTimes(1)`. Because an unwired spy reports `0` everywhere, those
`(1)` assertions are what hold the `(0)` assertions honest. Reverted, not committed.

**Spy-assertion count across the cooklang suites: 30 before → 32 after.** None
dropped. Companion static assertion in `pool.test.ts` walks the real tree and
requires the `@cooklang/cooklang` importer list to equal exactly
`["packages/shared-server/src/cooklang/parse-worker.ts"]`, plus a second assertion
that the child's only **value** import is `@cooklang/cooklang`.

---

## 7. A timeout and a child crash each cost the user NOTHING — proven

| path | proof |
|---|---|
| time bound | `withCookTokens` on the H1 row → `cookTokens: null`, warn, **no throw, no hang**. Includes an **anti-vacuity floor** asserting ~1 000 ms actually elapsed, with `findCookSourceDefect` stubbed to `null` — so the test cannot pass by being refused at the door |
| heap bound | bypass payload and `"#" x 8192` → `null`, child SIGABRT, **parent RSS unchanged** (−1.2 MB) |
| child crash mid-flight | a child `SIGKILL`ed externally 150 ms into a 24 s parse → request resolves `null`; the killed pid is gone from the pool; the next call succeeds |
| terminate-and-replace | deterministic: pool torn down, warmed to **exactly one** child, so the doomed pid is *known*. After the bound hit that pid is absent and the next call is served by a different one, correctly |
| no child spawnable | entry path forced to a nonexistent file → `null`, error log `pool-spawn-failed`, no throw |
| saturation | `poolSize + 4` concurrent bound-hitting requests all resolve, none hangs |
| copy path | poisoned source → copy lands `cook_source` NULL with **not one ingredient row lost** |

**A real defect was found and root-caused here, not papered over.** The full
shared-server run (not the isolated file) intermittently failed
`recovered → not.toBeNull()`. Cause: I had **not** implemented D-27-W3B-10's eager
replacement, so the ~200 ms respawn landed *inside the next request's* budget and
under load that request lost its tokens. Two fixes: (a) retire now spawns the
replacement immediately, off the request path, gated on `target.ready` as a circuit
breaker so a permanently broken entry cannot spin-spawn forever; (b) the cold-spawn
wait got its own honest budget (`queueTimeout + parseTimeout`) instead of being
conflated with the contention budget. Three consecutive full runs green afterwards.

---

## 8. The async ripple as landed vs the plan's 7 edits

**Exactly the 7 the plan enumerated, and no others.** A real `tsc --noEmit -p` in
all six packages found **no unpredicted production call site**, and
`packages/trpc` needed **zero** changes to the ripple, as predicted.

1. `attach-tokens.ts:39` — `await`
2. `build-payload.ts:48` — `async` / `Promise<CookPayload | null>`
3. `build-payload.ts:135` — `await`
4. `normalizer.ts:422` — `async` (body needed none; `:493` is a bare return)
5. `recipe-parser.ts:129` — `await`
6. `image-recipe-parser.ts:144` — `await`
7. `video/normalizer.ts:144` — `await`

**R13 is caught by the compiler.** Removing one `await` deliberately produces
`Type 'AIResult<{... cook: Promise<...>}>' is not assignable to type
'AIResult<ExtractedRecipe>'` — a floating promise cannot silently turn `if (!cook)`
into an always-truthy check.

**⚠ `tsc` exit codes are unreliable behind a pipe.** `tsc ... | head` reports
`PIPESTATUS[0]=0` even with errors. All six were re-run redirecting to a file:
`shared-server, shared, api, queue, trpc, db` → **EXIT 0, zero output**.

### Test call sites: 75, exactly as counted

`parse.test.ts` 26 · `round-trip-fidelity.test.ts` 12 · `limits.test.ts` 4+4 ·
`build-payload.test.ts` 1+11 · `round-trip.test.ts` 1 · `cook-payload.test.ts` 15 ·
`cook-source-isolation.test.ts` 1.

Structural conversions beyond `await`:
- the **4** `expect(() => { result = f(...) }).not.toThrow()` blocks became
  `resolves`-based (vacuous against a promise, R6) — grep confirms none remain;
- 4 `ReturnType<typeof f>` → `Awaited<...>` (then mostly removed with the blocks);
- `roundTrip(prose): string` → `async`, all 11 call sites awaited;
- **12 postfix-precedence bugs** my migration introduced and then fixed:
  `await f(x)![0]` parses as `await (f(x)![0])`, which threw. All wrapped as
  `(await f(x))!`.

**Two findings the plan did not predict:**
1. **`coverageOf` in `cook-payload.test.ts:361`** — an undeclared-async helper with
   **8** call sites of the form `expect(coverageOf(...)).not.toBeNull()`. A Promise
   is never null, so all 8 would have passed **vacuously**. Made async and awaited.
2. `cook-source-isolation.test.ts:198`'s top-level `MINTED` needed **no** move — no
   hoisted factory closes over it, so top-level `await` was sufficient.

---

## 9. Which single file imports `@cooklang/cooklang`

**`packages/shared-server/src/cooklang/parse-worker.ts`** — the child entry. Nothing
else in `packages/` or `apps/`.

**Test-file importers: exactly ONE, and it is justified.**
`packages/shared-server/__tests__/cooklang/round-trip.test.ts` constructs the real
`CooklangParser` itself, deliberately — it is the **independent oracle** for the
serializer → parser → projection contract, and routing it through `parseCookSource`
would have it checking our own pool against itself. Its inputs are the five committed
fixtures. `limits.test.ts`'s WASM mock is gone (replaced by the pool mock).
`pool.test.ts` reads the child source as *text*; it does not import it.

Both lists are pinned by static assertions that walk the real tree — production
files **and**, in a separate assertion, test files. Excluding `__tests__` from the
sweep (which my first version did) would have let a second importer appear in a test
unnoticed.

### ⚠ A hard constraint discovered empirically — READ BEFORE EDITING THE CHILD

The child may **only** value-import `@cooklang/cooklang` and `node:` builtins.
Raw Node cannot load `@norish/*` source, because those packages use **extensionless
relative imports** (`./unit-form-selector`) which ESM refuses
(`ERR_MODULE_NOT_FOUND`, reproduced). `import type` is erased and is safe.

**Consequence:** the child cannot call `normalizeUnit`, so it emits an ingredient's
unit under the deliberately different key **`rawUnit`**, and the pool canonicalizes
it in the parent. The distinct key is not cosmetic — it makes a forgotten
canonicalization pass a **type error** rather than an un-normalized unit reaching a
client (D-8). This is a deviation from the plan's `{ id, src, scale?, units? }`
envelope: **`units` does not cross the boundary at all.**

---

## 10. Gates — all green, per package

| gate | baseline | result |
|---|---|---|
| `tsc --noEmit -p` shared-server / shared / api / queue / trpc / db | — | **EXIT 0** all six (real, no `--noCheck`; verified non-vacuous) |
| shared-server test | 389 | **419** (+30 pool) |
| shared test | 295 | **295** |
| api test | 408 | **408** |
| queue test | 121 | **121** |
| trpc test | 335 | **337** (+2 copy path) |
| db test (`sg docker`) | 178/0 | **179** (+1 poisoned copy) |
| web test | 424 | **424** |
| mobile test | 132 | **132** |
| auth test | 133 | **133** |
| lint shared-server / api / queue / db / trpc | 0 errors | **0 errors**; new files contribute **0 warnings** |
| `check-workspace-imports.mjs` | EXIT 0 | **EXIT 0** |
| `build:server` | EXIT 0 | **EXIT 0** + `parse-worker.mjs` emitted + bundle smoke passed |
| `git diff pnpm-lock.yaml` | empty | **empty** (no new third-party dep; `node:child_process` only) |
| `pnpm i18n:check` | EXIT 1, pre-existing gap | **EXIT 1, unchanged** — diff touches **0** i18n files, adds no user-facing strings |
| DB migration | 42 | **42**; `migrations/` and `_journal.json` untouched |

`apps/web/tsdown.config.ts` is the **only** file under `apps/`. No `as any`,
`@ts-ignore` or `@ts-expect-error` in the diff. No `cook_confidence`, no `0042`/`0043`,
no W4/W5/W6 file touched.

**Files outside the plan's `files_modified`** (all forced by Task 5's copy-path fix,
which the plan explicitly authorised): `packages/trpc/src/routers/recipes/shares.ts`,
`packages/trpc/__tests__/recipes/shares.test.ts`,
`packages/db/__tests__/server/db/repositories/recipe-shares.test.ts`.
Note the plan's "`packages/trpc` needs zero changes" was about the **async ripple**,
and that held.

---

## 11. Operational numbers for LXC 110 (R11)

| | measured |
|---|---:|
| child **idle** RSS | **74.0 / 74.2 MB** (two children ≈ **148 MB**) |
| child **peak** RSS during 1 000 ms of the report-explosion payload | **313.6 MB** |
| worst-case transient, 2 children both bounded-out | **≈ 628 MB** |

**Note the peak is 314 MB, not 256 MB:** `--max-old-space-size` caps V8's old space,
while RSS additionally carries the ~2 MB WASM binary, code, stacks and off-heap
buffers. **Size swap against ~628 MB, not 512 MB.**

New log reasons to watch: `pool-timeout`, `pool-heap`, `pool-crash`,
`pool-saturated`, `pool-spawn-failed`, `stored-source-did-not-revalidate`.

---

## 12. Known and accepted / self-verification

- **CR/LF folding stays as documented.** A raw newline in prose folds to a space, so
  a two-paragraph step becomes a run-on line. Cooklang has no in-step line break, so
  a raw newline is structural injection. Kiran is aware; unchanged.
- **The child's stdout and stderr are DISCARDED, not piped** (`stdio: ["ignore",
  "ignore", "ignore", "ipc"]`). A WASM panic writes to stderr and nothing the child
  prints may reach a shared log stream (T-27-05). Debugging a child therefore needs
  the stdio temporarily re-pointed.
- **Task 6 is NOT done**, but I self-verified my own bound tests rather than trust
  them. Disabling the parent-side timer turned **11 tests RED** with the real
  in-process costs surfacing (H1 **29 142 ms**, `"#" x 8192` **13 131 ms**, bypass
  **6 240 ms**). Reverted byte-identically, **never committed**. This is *not* a
  substitute for Task 6's recorded W3B-W1/W2/W3.

---

## What Tasks 3, 4 and 6 must still pick up

**The bound is in place, so these are now quality-and-depth work rather than the
guarantee.** Nothing below is load-bearing for T-27-01 any more — that is the point
of the pivot — but all three are still required to call plan 27-04 complete.

### Task 3 — H1 root fix (frontmatter recognizer)
`FRONTMATTER_LINE` (`limits.ts`) still constrains neither key nor value, so
**arbitrary YAML still passes `findCookSourceDefect`**. Every H1 artefact in §4 is
still ACCEPTED by the recognizer and is stopped only by the time bound (1 000 ms
each). Implement D-27-W3B-06: a closed `COOK_FRONTMATTER_KEYS` set **exported from
the serializer** with a quoted-or-numeric value grammar, structural caps, named
defect codes, and the **two-way** assertion. Useful observed fact: the serializer
emits `title: Spaghetti Bolognese` **unquoted** when the value has no
metacharacters, and `time.cook: "45 min"` quoted — the value grammar must accept
both, or every real recipe is refused (R8, the round-1 failure mode).

### Task 4 — H2 + H3 root fixes
Untouched. `@a{ %g}` (8 bytes) still traps the WASM, though the trap is now
**contained to a child that is then discarded**. H3 (`splitFragment` slicing by
`ref.name.length`) still **deletes user text** — `"Add flour now."` with an
ingredient named `"flour "` still renders `"Add flournow."`. H3 is a **pre-existing
fidelity defect affecting the parent commit too**, and it feeds **director exit item
4**: rows already written may carry the damage.

### Task 6 — adversarial verification
W3B-W1 / W3B-W2 (+W3B-W3) must be **executed, proven RED, reverted byte-identically
and never committed**, with the exact edits and RED test names recorded. My
self-check above covers only W3B-W1's shape and is not a substitute. Note for W3B-W2
(remove `--max-old-space-size`): per §3 the heap bound fires at **6–12 s**, not
~285 ms, so that weakening must relax the TIME bound too or it will not be observable.

### Exit items handed to the DIRECTOR
1. `pnpm docker:build` + confirm `dist-server/parse-worker.mjs` is present **in the
   image** and the pool spawns **inside the container** — R1's failure mode is
   silent, so the build host is not sufficient evidence.
2. **Size the container against ~628 MB transient**, not 512 MB (§11).
3. Watch `pool-timeout` / `pool-heap` / `pool-crash` / `pool-saturated` rates. A
   nonzero `pool-timeout` on real recipes means 1 000 ms is wrong for production and
   should be raised **deliberately, with the number recorded** — and **§3's warning
   applies: raising the time bound makes the heap bound the only thing standing
   between a hostile row and ~1.6 GB.**
4. Decide whether H3 warrants a **data audit** of already-written `cook_source` rows.
5. Confirm a verified-restorable backup before the deploy carrying this plan.

---

# 13. D-27-W3B-03a — THE PRIMARY GATE IS CPU TIME, NOT WALL CLOCK

**Commits:** `cffaa5d8` (code + tests) · this commit (the record). Nothing pushed. Tree `main`, DB at migration **42**,
`pnpm-lock.yaml` diff EMPTY. **Tasks 3, 4 and 6 remain NOT STARTED** — this section
changes the parse bound only.

**Director decision, 2026-07-26, superseding the locked D-27-W3B-03.** §3b's three
options (raise to 2 000 ms · ship 1 000 ms and watch · accept the loss) were all
**REJECTED**: they pick different points on the same wall-clock axis and each flips
again on a busier box. Kiran's standing directive is no bandaids, root cause only.

**Rationale, as given.** Wall clock **conflates the threat (unbounded computation) with
unrelated host load**. And **W6 makes `cook_source` NOT NULL, so a refusal that is free
today becomes an IMPORT FAILURE then** — a contention-flaky bound is a latent W6 defect
and had to be fixed, not tuned.

## 13.1 THE NUMBER THAT JUSTIFIES THE WHOLE CHANGE

Contention manufactured by pinning the parse child and ten spinners to a single core.
13 runs per shape per condition.

| worst ACCEPTED shape | **wall idle** | **wall starved** | inflation | **CPU idle** | **CPU starved** | drift |
|---|---:|---:|---:|---:|---:|---:|
| 64 KiB of `@a{1%g} ` (65 536 B) | 351-449 ms | **4 096-5 085 ms** | **11.6x** | 328-373 ms | **328-373 ms** | **0%** |
| `"#p " x 21845` (65 535 B) | 483-830 ms | **5 537-6 264 ms** | **7.5x** | 453-506 ms | **452-506 ms** | **±1%** |
| a realistic 437 B recipe | 13-15 ms | 154-194 ms | 11.4x | 10-30 ms | 10-20 ms | flat |

**Wall clock inflated 7.5x-11.6x. CPU did not move.** §3b's own figures sit inside this:
the shapes that measured 1 137 / 1 238 ms of wall clock in the full vitest run and were
REFUSED were spending ~500 ms of CPU throughout. Wall clock was never measuring the
work.

A **broader legitimate sweep** was run so the budget is not calibrated on two shapes
alone. Every shape that reaches the 64 KiB `cook_source` cap: timers
(`~{1%minute} `, 121-149 ms CPU), prose (13-15), headings (50-52), `@a{1%g}` with no
space (340-356), 200 steps x 4 000 chars (14-15), 600 ingredient refs (47-51), real
serializer frontmatter (18-19). **Nothing legitimate exceeds 506 ms of CPU.**

## 13.2 THE MECHANISM, AND WHY `schedstat` AND NOT `utime`+`stime`

The child cannot self-police — the synchronous WASM parse can never check a timer,
which is the original problem this pivot exists for — so the **parent** measures it. It
samples `/proc/<pid>/schedstat` field 1 (`sum_exec_runtime`, **nanoseconds**) every
`cookParseCpuPollMs` and `SIGKILL`s the child once `cookParseCpuMs` is spent.

Both candidates were measured. `schedstat` won on three counts:

1. **Resolution.** Nanoseconds, against `utime`/`stime`'s 10 ms USER_HZ ticks — which
   would additionally require assuming `sysconf(_SC_CLK_TCK)`, a value **Node exposes
   nowhere**.
2. **It measures the threat and nothing else.** `schedstat` is the MAIN THREAD, which is
   where 100% of the hostile computation lives (`parser.parse()` is one synchronous
   single-threaded WASM call, as is the `JSON.parse` of its report). `utime`+`stime`
   aggregate the thread group, so they also charge V8's **parallel GC helper threads**:
   measured **690 ms against a 346 ms main thread for one and the same 64 KiB parse**.
   That makes the thread-group figure a function of how many cores happen to be free —
   the exact coupling this decision exists to remove. It would also have forced a
   budget above ~800 ms of *observed* cost, with unknown inflation on a wider box.
3. **It is the stable figure** — ±3% across an 11.6x wall-clock inflation (13.1).

**The residual, stated rather than hidden.** Helper-thread CPU is not counted. Measured
across every shape probed it is **≤0.6x of the main-thread figure**, and on the hostile
shapes 0.003x / 0.04x / 0.06x — so the child's TOTAL CPU is bounded at roughly
`1.6 x cookParseCpuMs`, and the 256 MB heap bound independently caps the allocation
that drives GC work at all.

**POLL OVERHEAD, measured.**

| | measured |
|---|---:|
| one sample (read + parse `/proc/<pid>/schedstat`) | **30.23 µs** (20 000 iterations, warm) |
| samples for a pooled round trip (~0.97 ms) | **0** |
| samples for a 437 B fixture / a 64 KiB realistic recipe (13-15 ms) | **0** |
| samples for the worst legitimate shape (~500 ms CPU) | ~19 ≈ **0.6 ms** |
| samples for a hostile parse (1 500 ms CPU) | ~60 ≈ **1.8 ms** |
| overshoot past the budget (one interval) | **20 ms** measured (1 520 vs 1 500) |

The first sample is scheduled 25 ms out, so for every real recipe the timer is created
and cleared **without ever firing**. There is no measurable read-path cost.

**Non-Linux hosts.** `readChildCpuMs` returns `null` rather than throwing, and the parse
then falls through to the wall ceiling and the heap bound only — strictly weaker, and
documented in the function rather than hidden. Production is a Linux container on
LXC 110, so this is a dev-box caveat, not a production one.

## 13.3 THE BOUNDS AS LANDED, WITH HEADROOM

`COOK_BOUNDS` is now seven values (still a separate object from the untouched nine
`COOK_LIMITS`), each env-overridable:

| bound | value | env | headroom |
|---|---:|---|---|
| `cookParseCpuMs` **(PRIMARY)** | **1 500** | `NORISH_COOK_PARSE_CPU_MS` | **2.96x** over the worst legitimate CPU (506 ms); ~88x over a realistic recipe (17 ms); ~2 500x over a fixture |
| `cookParseCpuPollMs` | 25 | `NORISH_COOK_PARSE_CPU_POLL_MS` | 1.7% overshoot; 0 polls for any real recipe |
| `cookParseWallCeilingMs` (BACKSTOP) | **8 000** | `NORISH_COOK_PARSE_WALL_CEILING_MS` | 9.6x the worst legitimate IDLE wall (830 ms); above the 6 264 ms measured under 11.6x starvation |
| `cookParseHeapMb` | 256 | unchanged | 7.8x the worst accepted peak (33 MB) |
| `cookParsePoolSize` | 2 | unchanged | — |
| `cookParseQueueTimeoutMs` | 1 000 | unchanged | — |
| `cookParseReadyTimeoutMs` | 2 000 | `NORISH_COOK_PARSE_READY_TIMEOUT_MS` | ~8x the 200-243 ms cold spawn |

**`cookParseReadyTimeoutMs` is the one bound that is new by NAME only.** It used to be
DERIVED as `cookParseQueueTimeoutMs + cookParseTimeoutMs` = 2 000 ms. With the parse
bound becoming an 8 000 ms backstop, that derivation would silently have stretched the
cold-spawn wait to **9 000 ms** — a real latency regression smuggled in by an unrelated
change. Same value, now stated.

**Why the ceiling is a BACKSTOP and not a bandaid.** It cannot be reached by a child
that is computing, because the CPU gate kills that child first. It exists only for a
child stuck **without** burning CPU — a hang, a lost IPC reply — which the CPU gate is
structurally blind to because the counter never advances. A blocked-but-idle child is
not a DoS amplifier: it holds one pool slot, `cookParseQueueTimeoutMs` degrades anything
queued behind it, and D-27-W3B-10's terminate-and-replace disposes of it.

**The heap bound became MORE important, exactly as §3 warned, and was NOT weakened.**
`"#" x 8192` peaks at 839 MB and the round-1 bypass at 1 650 MB; with the wall ceiling
now 8 s it is the only thing standing between a hostile row and that balloon.

## 13.4 WHAT THE HOSTILE FAMILIES NOW MEASURE, AND HOW EACH DIES

| input | bytes | **CHILD CPU if left to run** | **under the gate** |
|---|---:|---:|---|
| H1 `---\na: "["x65400\n---\nstep\n` | 65 417 | **22 759 ms** (23 086 ms wall, flat 6 MB) | `pool-cpu` at **1 520 ms CPU / 1 640 ms wall** |
| H1 balanced 25 000 / 30 000-deep `[`/`]`, `{`-nesting | 50-60 KB | 4.8-10.5 s in-process | `pool-cpu` at 1 500 ms CPU |
| report explosion `"#" x 8192` | **8 192** | **12 222 ms** CPU; SIGABRT at 13 691 ms wall, 839 MB peak | `pool-cpu` at 1 500 ms CPU (heap bound is the backstop) |
| round-1 bypass 16 x 3 996 `@a{1%}` | 63 966 | **4 895 ms** CPU, then `RuntimeError: unreachable` at 4 940 ms | `pool-cpu` at 1 500 ms CPU |
| 64 KiB of `@a{1%g} ` — worst ACCEPTED | 65 536 | 328-373 ms | **SUCCEEDS** (22% of budget) |
| `"#p " x 21845` — worst ACCEPTED | 65 535 | 452-506 ms | **SUCCEEDS** (34% of budget) |

Every hostile family is killed by the **CPU gate**, and the ratio is not marginal: the
cheapest of them burns **3.3x** the budget and H1 burns **15x** it. The two legitimate
shapes sit at 22% and 34%. **There is no overlap between the two populations on this
axis** — which is precisely what was untrue on the wall-clock axis, where the gap was
1.44x and inverted under load.

## 13.5 THE NEVER-BROKEN PROPERTY UNDER CONTENTION — PROVEN WITHOUT A VACUOUS TEST

The claim has two halves. Only one can be proven without involving the host scheduler,
so they are proven separately rather than conflated into one hopeful test.

**HALF ONE — THE MECHANISM, FULLY DETERMINISTIC.** A new test-only child,
`__tests__/cooklang/stub-parse-worker.mjs`, speaks the pool's IPC protocol and imports
nothing. It decouples the two axes completely:

- `STUB_MODE=sleep`, 3 000 ms: **burns ~0 CPU, elapses 3 s of wall clock.** The
  superseded 1 000 ms bound would have killed it. The test asserts it **SUCCEEDS**, that
  the stub's own ingredient token came back (so it is a real round trip, not an
  accidental `null` that looks like success), that elapsed time really did exceed
  1 000 ms (anti-vacuity — it cannot pass by replying instantly), and that **no bound
  reason was logged at all**.
- `STUB_MODE=burn`, 6 000 ms: **blocks its event loop**, exactly as the synchronous WASM
  parse does, so no timer inside it could rescue it. The test asserts `pool-cpu`,
  `bound: "cookParseCpuMs"`, `measured >= 1 500`, **and `measured < 1 700`** — i.e. the
  gate did not overshoot by more than one poll interval.

No load to manufacture, nothing to flake.

**HALF TWO — THE REAL SHAPES ON A REALLY LOADED BOX.** A test spawns
`3 x availableParallelism()` (12 here) blocking spinners and then parses BOTH worst
legitimate shapes through the real WASM child. **Its own recorded numbers:**

| shape | wall under load | CPU sampled | wall/CPU | verdict |
|---|---:|---:|---:|---|
| 64 KiB of `@a{1%g} ` | **2 294 ms** | 330 ms | **6.95x** | **PARSED** |
| `"#p " x 21845` | **1 192 ms** | 401 ms | **2.97x** | **PARSED** |

Both elapsed **past the superseded 1 000 ms bound** — i.e. both would have been REFUSED
by D-27-W3B-03 — and both parsed, with CPU at 22% and 27% of budget.

**HOW IT IS KEPT FROM BEING GREEN-BUT-EMPTY.** Three assertions, and the third is the
one that matters: the wall/CPU ratio must exceed **1.5x** and at least one shape must
have elapsed past 1 000 ms. **If the spinners fail to bite, the test FAILS rather than
passing quietly.** The 3x-cores spinner count is calibrated, not picked: it leaves the
child roughly a quarter of a core, which on the measured CPU costs puts elapsed time at
~1.2-2.3 s — past 1 000 ms with margin and still ~4x under the 8 000 ms ceiling, so the
BACKSTOP cannot fire and turn this into the flaky test it is replacing.

**WHAT IT DOES NOT CLAIM.** It does not reproduce §3b's exact 20-worker vitest
contention; it manufactures its own, which measured **harsher** (7.5x-11.6x wall
inflation against §3b's ~2.5x). It asserts no particular elapsed time, because that is a
property of the host and not of this code. Both limits are stated in the test docblock.

**THE PREVIOUS TEST'S WEAKER CLAIM IS GONE.** §3b's version had to raise the bound
through its env lever and could only assert "not INHERENTLY refused". The replacement
asserts the shapes parse **at the shipped defaults**, with headroom asserted on the CPU
figure the gate actually decides with.

**THE HOSTILE ASSERTIONS WERE MADE CONTENTION-PROOF TOO.** `elapsed < 1 500 ms` on a
hostile input is a measurement OF THE MACHINE — under load a hostile row takes longer in
elapsed time to burn its budget. Those assertions now bound only
`cookParseWallCeilingMs` ("it did not hang", which is all wall clock can honestly say),
and the teeth moved to `measured >= cookParseCpuMs`, which is contention-invariant. For
the H1 family — flat 6 MB, so `pool-heap` is impossible — the reason is pinned to
`pool-cpu` exactly.

## 13.6 THE TIMEOUT AND CRASH PATHS, RE-PROVED — NOT ASSUMED TO CARRY OVER

| path | proof under the NEW gate |
|---|---|
| **CPU gate** | `withCookTokens` on the H1 row → `cookTokens: null`, warn, no throw, no hang, `reason: "pool-cpu"`, `measured >= 1 500`. Anti-vacuity floor raised to `elapsed > 0.9 x cookParseCpuMs` with `findCookSourceDefect` stubbed to `null`, so it cannot pass by being refused at the door — and that floor is SOUND on any box, because burning 1 500 ms of CPU takes at least that long in elapsed time |
| **wall-clock BACKSTOP** | NEW dedicated test: the sleeping stub with the ceiling lowered to 1 200 ms through its env lever → `null`, `reason: "pool-timeout"`, `bound: "cookParseWallCeilingMs"`, `measured >= 1 200`; elapsed > 1 100 ms (it waited the ceiling out) and < 10 000 ms (it did NOT wait out the child's 30 s sleep). The doomed pid is captured WHILE it is stuck and asserted gone afterwards, so terminate-and-replace is proven for the backstop too |
| **heap bound** | unchanged and still fires; the report-explosion payloads resolve `null` with the parent's heap growth < 64 MB against their unbounded 839-1 650 MB |
| **child crash mid-flight** | unchanged: a child `SIGKILL`ed externally 150 ms into an H1 parse resolves `null`, the killed pid is gone, the next call succeeds |
| **no child spawnable** | unchanged: entry forced to a nonexistent file → `null`, `pool-spawn-failed`, no throw |
| **saturation** | `poolSize + 4` concurrent bound-hitting requests all resolve; ceiling re-derived from the bounds actually on that path (`queueTimeout + 2 x cpuMs + slack`) rather than the retired `cookParseTimeoutMs` |
| **from the SHIPPED BUNDLE** | a throwaway tsdown entry exercised the real `dist-server/*.mjs` pool: lazy spawn (no pids before the first parse), unit canonicalization (`unit: "gram"`), the worst legitimate shape **OK in 813 ms wall / 475 ms CPU**, and H1 killed at **1 520 ms CPU / 1 640 ms wall** with the full log line `reason: "pool-cpu", bound: "cookParseCpuMs", limit: 1500, measured: 1520, cpuMs: 1520, elapsedMs: 1630, bytes: 65417, pid: …` and **no recipe prose**. The throwaway entry was removed and `tsdown.config.ts` is byte-identical (`git diff` empty) |

## 13.7 ADVERSARIAL SELF-VERIFICATION (not a substitute for Task 6)

Both weakenings were **executed, proven RED, and reverted byte-identically** (md5
verified). Neither was committed.

1. **Make the CPU gate never fire** (`if (false && …)`) → **13 tests RED** across
   `pool.test.ts` and `attach-tokens.test.ts`, including every hostile-corpus case, both
   worst-accepted cases, the burn-stub case, the contention case and the log-shape case.
   The H1 payloads then fell through to the 8 000 ms ceiling at 8 022-8 253 ms elapsed —
   which independently confirms the backstop is live.
2. **Regress the gate to WALL CLOCK at the superseded 1 000 ms**, changing nothing else
   → **9 tests RED**, and critically the two that exist for this decision:
   *"does NOT refuse a parse that elapses 3 s of WALL CLOCK while burning no CPU"* and
   *"parses BOTH worst legitimate shapes while the box is saturated with spinners"*.
   **The contention test catches a wall-clock regression directly** — it is not green by
   accident.

## 13.8 New log reasons and the operator surface

`pool-cpu` **is new** and is the one to watch; `pool-timeout` now means *stuck without
burning CPU*, which is a different and much rarer condition than it used to be. Every
bound hit now carries **`bound` + `limit` + `measured` + `cpuMs` + `elapsedMs` +
`bytes` + `pid`**, so a `pool-cpu` rate is actionable: `measured` says whether a row was
marginal or 15x over. Still no recipe prose and no ingredient names — asserted, on a log
line generated from a payload carrying `"Grandmother's Secret Cassoulet"` and
`@duck confit`.

## 13.9 Gates — all green, per package

| gate | baseline | result |
|---|---|---|
| real `tsc --noEmit -p` shared-server / shared / api / queue / trpc / db | EXIT 0 | **EXIT 0 all six, zero output** (redirected to files; `tsc \| head` lies) |
| shared-server test | 427 | **432** (+5), and **three consecutive full runs green** |
| shared / api / queue / trpc | 295 / 408 / 121 / 337 | **295 / 408 / 121 / 337** |
| web / mobile / auth | 424 / 132 / 133 | **424 / 132 / 133** |
| db test (`sg docker`) | 179 | **179** |
| lint shared-server / api / queue / db / trpc | 0 errors | **0 errors**; touched files contribute **0 warnings** |
| `check-workspace-imports.mjs` | EXIT 0 | **EXIT 0** |
| `build:server` | EXIT 0 | **EXIT 0**, `dist-server/parse-worker.mjs` emitted (6 942 B) |
| tsdown HARD GATE (negative case) | fails the build | **re-executed: EXIT 1** with the explanatory error, then reverted byte-identically |
| `@cooklang/cooklang` importers in the bundle | index 0 / worker 1 | **index.mjs 0, parse-worker.mjs 1** |
| one-importer static assertions | 1 prod / 1 test | **unchanged and still green** (the stub child is `.mjs` and imports nothing, so it is invisible to both sweeps by construction) |
| `git diff pnpm-lock.yaml` | empty | **empty** |
| `pnpm i18n:check` | EXIT 1, pre-existing | **EXIT 1, unchanged**; 0 i18n files touched |
| DB migration | 42 | **42**; `migrations/` and `meta/_journal.json` untouched |

**Files changed: four, plus one new test fixture.** `src/cooklang/limits.ts`,
`src/cooklang/pool.ts`, `__tests__/cooklang/pool.test.ts`,
`__tests__/cooklang/attach-tokens.test.ts`, and the new
`__tests__/cooklang/stub-parse-worker.mjs`. **Nothing under `apps/`, `packages/db`,
`packages/trpc` or `packages/api`.** `findCookSourceDefect`, `serialize.ts` and the
H1/H2/H3 fixes are **untouched** (Tasks 3/4 own those). No `as any`, no `@ts-ignore`, no
`@ts-expect-error`. W4/W5/W6 untouched.

## 13.10 Two things the director should know

1. **The tsdown gate's hardcoded `parse-worker.mjs` is CORRECT and was deliberately left
   alone.** The prior agent's finding was about the **pool's runtime sibling rule**,
   which derives the extension from `extname(import.meta.url)` — a hardcoded `.js`
   *there* would have resolved a nonexistent path **in production only, silently**. In
   the build gate a hardcoded `.mjs` fails the build LOUDLY if tsdown's output ever
   changes, which is the desired direction. Both were re-verified; do not "fix" the gate
   to match the pool.
2. **§3b's exit item 3 is now materially different.** The thing to watch is `pool-cpu`,
   and a nonzero rate on real recipes no longer means "the number is wrong for this box"
   — the number is now box-independent. It would mean a genuinely new legitimate shape
   costs more than 506 ms of CPU, which is a **measurement to redo**, not a knob to
   turn. `pool-timeout` now means a stuck child and should be near-zero; if it is not,
   that is a bug report, not a tuning signal.
