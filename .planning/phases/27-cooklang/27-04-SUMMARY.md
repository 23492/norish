---
phase: 27-cooklang
plan: 04
subsystem: infra
tags: [cooklang, wasm, child-process, resource-bound, dos, tsdown, vitest]

status: COMPLETE — all six tasks. 1/2/5 (§1-§12) · the CPU-time bound redesign D-27-W3B-03a (§13) · 3/4, the H1/H2/H3 root fixes (§14) · 6, the adversarial weakenings + the wave close-out (§15). NOTHING IS DEPLOYED: live is still image `516c52576a5f` at DB 42.

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
  - "D-27-W3B-06 changed the EMITTER, not the recognizer: every non-numeric frontmatter value is quoted UNCONDITIONALLY, which is why a pre-Task-3 `.cook` is refused on read (a W5 prerequisite)."
  - "Task 6 finding: above ~5.3x of host contention the 8 000 ms WALL BACKSTOP pre-empts the 1 500 ms CPU gate, so a hostile row is refused as `pool-timeout`. Never-broken holds; the operator signal is `cpuMs`, not the reason alone."
---

# 27-04 — Bound the WASM parse (all six tasks)

**Commits, in the order they landed:** `59f3a767` (T1) · `4bbeecc7` (T2) ·
`226f04a7` (T5) · `cffaa5d8` (the CPU-gate redesign) · `5cdfc8aa` (T3, H1) ·
`d3848c54` (T4, H2 + H3) · `231baf91` (T6's root fix to the read-path latency alarm)
· plus the record commits. **Nothing pushed. Nothing deployed** — live still runs
image `516c52576a5f` (verified: `docker inspect norish-app`) at DB migration **42**,
`pnpm-lock.yaml` diff EMPTY, `packages/db/src/migrations/` and `meta/_journal.json`
untouched throughout.

---

## HOW TO READ THIS FILE

Four executors wrote it, in this order, and each section is kept intact as the record
of what was measured when. Read §0 first if you only read one thing.

| § | what it covers | status |
|---|---|---|
| **§0** | **the superseded claims, in one table** | **read this first** |
| §1-§12 | Tasks 1/2/5: the pivot to a resource bound, the pooled child, the async ripple, the copy path | current, except where §0 says otherwise |
| §3b | how the wall-clock bound was found to refuse legitimate recipes | **HISTORICAL** — kept as the record of the discovery; decided in §13 |
| "What Tasks 3, 4 and 6 must still pick up" | the Tasks 1/2/5 executor's handover | **HISTORICAL — all three are now DONE**; one of its recommendations was deliberately not followed (§0) |
| §13 | **D-27-W3B-03a — the primary gate is CPU time, not wall clock** | current |
| §14 | Tasks 3/4 — the H1 / H2 / H3 root fixes | current |
| **§15** | **Task 6 — the adversarial weakenings — and the WAVE CLOSE-OUT: W5's prerequisites, the corrected operational guidance, what is NOT done** | current |

---

## §0. THE SUPERSEDED CLAIMS, IN ONE TABLE

Nothing below has been deleted from where it was written; this table is the index of
what NOT to act on. Every row was a correct reading of the evidence available at the
time, which is why it is worth keeping visible.

| claim, and where it still appears | superseded by | what is true now |
|---|---|---|
| "the frontmatter value grammar **must accept both** quoted and unquoted values, or every real recipe is refused" — *What Tasks 3, 4 and 6 must still pick up* → Task 3 | **§14.1** (D-27-W3B-06, Task 3) | The opposite was done: the **EMITTER** now quotes every non-numeric value UNCONDITIONALLY, and the recognizer accepts only `"…"` or a plain number. Accepting plain scalars means accepting nearly arbitrary YAML — `title: a [[[[…` was legitimate serializer output — which is H1 with one extra step. Proven by weakening **W3B-W6** (§15.2): restoring the unquoted branch turns **120 tests RED**, including all 14 realistic recipes |
| "the heap bound is reached at ~285 ms, **before** the time bound" — D-27-W3B-03 in `27-04-PLAN.md`, and the T-27-01b threat row | **§3** ("A MATERIAL DEVIATION"), refined in §13.3 | It did not reproduce: the heap bound fires at **6-12 s**, so the CPU gate is what fires first on every hostile family. The heap bound is **not** redundant — it is the only thing standing between a hostile row and 839 MB-1.65 GB now that the wall ceiling is 8 s |
| `cookParseTimeoutMs: 1_000`, a WALL-CLOCK `SIGKILL`, as "the bound" — §1-§12 passim, and two docblocks | **§13** (D-27-W3B-03a) | The primary gate is `cookParseCpuMs: 1_500`, sampled from `/proc/<pid>/schedstat`; wall clock survives only as `cookParseWallCeilingMs: 8_000`, a BACKSTOP for a child stuck without burning CPU. The two docblocks that still described the old bound were corrected in `231baf91` (§15.4) |
| "`pool-timeout` should be ~zero; any occurrence is a bug report" — §13.10 | **§15.3** (Task 6's contention finding) | True for a QUIET box. Above ~5.3x of contention the 8 s backstop pre-empts the 1 500 ms CPU gate, so a hostile row is legitimately refused as `pool-timeout`. **The reason alone is not the signal — read `cpuMs` beside it** |
| "`AI_API_KEY` is empty on live, so W3's producer never fires there — the deploy is a no-op in practice" — W3's exit item 5 in `waves/W3-SUMMARY.md`, `STATE.md` and `ROADMAP.md` (all three now annotated in place) | **§15.6** | **Wrong now.** Live's `ai_config` has held a DeepSeek key since 2026-06-15 (set via the Admin UI) and it is now env-backed in `/opt/norish/.env` (untracked, `chmod 600`, verified present). **W3 will NOT be inert once deployed** |

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

> **SUPERSEDED IN PART (§13 / D-27-W3B-03a).** `cookParseTimeoutMs: 1_000` — the
> WALL-CLOCK bound described here and throughout §1-§12 — no longer exists. Read it as
> `cookParseCpuMs: 1_500` (the primary gate) plus `cookParseWallCeilingMs: 8_000` (a
> backstop). The heap-bound analysis below stands and is the reason the heap bound was
> NOT relaxed when the ceiling rose to 8 s.

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

> **HISTORICAL — ALL THREE ARE NOW DONE.** Task 3 and Task 4 landed in `5cdfc8aa` /
> `d3848c54` (§14); Task 6 landed in `231baf91` + the record (§15). This section is
> kept as the Tasks-1/2/5 executor's handover, **and one of its recommendations was
> deliberately NOT followed** — see the first row of §0 and §14.1: the frontmatter
> grammar does **not** accept unquoted values, because the EMITTER was changed to stop
> producing them.

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

> **ITEM 2 IS PARTLY SUPERSEDED — see §15.3.** "`pool-timeout` should be near-zero and
> any occurrence is a bug report" holds on a quiet box, but `1 500 x 5.34 = 8 000`, so
> above ~5.3x of sustained contention the wall BACKSTOP pre-empts the CPU gate and a
> hostile row is legitimately refused as `pool-timeout`. Read `cpuMs` beside the reason:
> ~0 is a stuck child, hundreds of ms is the bound working.

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

---

# 14. Tasks 3 and 4 — the H1 / H2 / H3 root fixes

**Commits:** `5cdfc8aa` (Task 3, H1) · `d3848c54` (Task 4, H2 + H3) · this commit (the
record). Nothing pushed. Tree `main`, DB at migration **42**,
`packages/db/src/migrations/` and `meta/_journal.json` untouched, `pnpm-lock.yaml`
untouched. The nine `COOK_LIMITS` are unchanged and still asserted literally;
`COOK_BOUNDS`, `pool.ts`, `parse-worker.ts`, `apps/web/tsdown.config.ts` and
`pool.test.ts` were **not touched** (Tasks 1/2/5 own them, and another stream was
editing them concurrently). No `as any`, no `@ts-ignore`, no `@ts-expect-error`. W4/W5/W6
untouched.

**Files changed (9).** `packages/shared/src/cooklang/serialize.ts`,
`packages/shared/src/cooklang/index.ts`, `packages/shared/src/lib/ingredient-token.ts`,
`packages/shared/__tests__/cooklang/serialize.test.ts`,
`packages/shared-server/src/cooklang/limits.ts`,
`packages/shared-server/__tests__/cooklang/limits.test.ts`,
`packages/shared-server/__tests__/cooklang/round-trip-fidelity.test.ts`,
`packages/shared-server/__tests__/cooklang/parse.test.ts`, and — forced by the emission
change, two assertions only —
`packages/api/__tests__/ai/features/recipe-extraction/cook-payload.test.ts`.

## 14.1 H1 — the key set and the value grammar as landed (D-27-W3B-06)

**The closed key set, derived from `buildFrontmatter`'s code and now exported from it as
the single source of truth:**

```ts
COOK_FRONTMATTER_KEYS = ["title", "servings", "time.prep", "time.cook", "source", "norish.system"] as const
COOK_FRONTMATTER_NUMERIC_KEYS = ["servings"] as const   // Cooklang TYPES servings as a number
COOK_FRONTMATTER_MAX_VALUE_CHARS = 1_002                // = 2 x maxRecipeNameChars + 2
```

`buildFrontmatter` is typed against the tuple, so `tsc` refuses a key that is not a
member; `limits.ts` IMPORTS all three constants rather than restating them.

**The value grammar:**

```
frontmatter := "---" NL ( line NL )+ "---" NL     // at most one block, and FIRST
line        := KEY ": " VALUE                    // each KEY at most once
KEY         := a member of COOK_FRONTMATTER_KEYS
VALUE       := number   (for a numeric key)  |  quoted  (for every other key)
number      := "-"? DIGIT+ ( "." DIGIT+ )?       // plain decimal only; no 1e+21
quoted      := '"' ( char | "\\" | '\"' )+ '"'   // NON-EMPTY and trim-invariant
char        := anything but '"', '\', or a YAML-forbidden control (TAB is allowed)
```

**THE ONE DECISION THAT CONTRADICTS §"What Tasks 3, 4 and 6 must still pick up".** That
section advised that the grammar "must accept both" quoted and unquoted values, "or
every real recipe is refused". I did the opposite and **changed the EMITTER instead**:
every non-numeric value is now quoted **unconditionally**, and the old
`PLAIN_YAML_SCALAR` branch is deleted. Reason: that branch was
`/^[\p{L}\p{N}][^\r\n:#"]*$/u`, so `title: a [[[[[…` — 65 000 flow-sequence characters
under a KNOWN key — was legitimate serializer output. Accepting plain scalars therefore
means accepting very nearly arbitrary YAML, which is the H1 hole with one extra step.
Quoting collapses the value space to two shapes a recognizer can assert. Verified against
the real WASM: `title: "Spaghetti Bolognese"`, `norish.system: "metric"` and a 5 000-char
quoted `[`-flood all parse with an **empty report** (the flood in 42 ms — quoting also
removes the recursion, though the length cap makes that moot).

**Values that cannot be expressed inside the grammar OMIT THEIR KEY** rather than being
emitted unrecognizably: an all-whitespace value, a `source` whose quoted form exceeds
1 002 chars, and a `servings` that `String(Number(x))` renders exponentially. Optional
metadata is dropped, the recipe keeps its `cook_source`, and the DB columns remain the
source of truth for all of these fields. A `title` cannot reach the cap in practice —
`checkStructuredRecipeLimits` caps the name at 500 and quoting at most doubles it, which
is exactly where 1 002 comes from.

**What the H1 payloads do NOW — refused by the recognizer, not merely bounded:**

| input | bytes | before | now |
|---|---:|---|---|
| `---\na: ${"[".repeat(65400)}\n---\nstep\n` | 65 417 | `null`, 24 557 / 38 511 ms | **`frontmatter-too-large`** (one length comparison) |
| balanced 25 000-deep `[`/`]` | 50 017 | `null`, 4 838 ms | **`frontmatter-too-large`** |
| balanced 30 000-deep `[`/`]` | 60 017 | `null`, 8 256 ms | **`frontmatter-too-large`** |
| `{`-nesting variant | 60 017 | `null`, 10 489 ms | **`frontmatter-too-large`** |
| `title: @@@@ ####` | 30 | `null`, diagnostics | **`frontmatter-value`** |
| `a: &x [*x]` | 24 | `null`, diagnostics | **`frontmatter-key`** |

The four big ones die on the **arithmetic block cap** (6 080 chars max, from the key set
x the per-value maximum) before any value is examined; shortened variants of the same
payloads die on `frontmatter-value` / `frontmatter-key`. Both `title: @@@@ ####` and
`a: &x [*x]` are refused.

**Six named defect codes**, so a log can triage without carrying the source:
`frontmatter-unterminated`, `frontmatter-line` (not `key: value` at all — a comment,
`...`, an indented continuation), `frontmatter-key`, `frontmatter-duplicate-key`,
`frontmatter-value`, `frontmatter-too-large`. A second `---` block and a `---` block that
is not first are refused by the BODY recognizer as `unescaped-metacharacter` (`-` is a
metacharacter and the serializer escapes every `-` it writes) — no new code needed, and
both are asserted.

**The bound half of the criterion was NOT duplicated.** Task 3's second acceptance
criterion (every H1 payload proven bounded with the recognizer stubbed to `null`) is
already carried by `pool.test.ts`, which drives all four H1 payloads plus the round-1
bypass THROUGH the pool with no recognizer in the way at all. That file belongs to
Tasks 1/2 and was being edited concurrently, so re-asserting the same property in
`limits.test.ts` would have added a slow duplicate and a merge conflict for no new
information. The two proofs remain independent, which is the point of the pivot.

## 14.2 H2 — confirmed for all three sigils, fixed on both sides (D-27-W3B-07)

Re-confirmed on this tree before fixing: `@a{ %g}`, `~a{ %m}`, `#a{ %g}` and `~a{ % }`
each raise `RuntimeError: unreachable`; `@a{ }` does not trap but is equally not
serializer output. All of them returned `null` from `findCookSourceDefect` before this
commit. All are now `malformed-token`, together with the no-trailing-newline, TAB and
NBSP variants of each sigil, and the padded/doubled-space forms (`{1 %g}`, `{ 1%g}`,
`{1% g}`, `{1%g }`, `{1  1/2%g}`, `{1%fl  oz}`).

- **Emission.** The serializer already trimmed via `escapeTokenText`, but
  `formatTokenAmount(" ")` returned **`"0"`** (`Number(" ")` is `0`), so a blank amount
  emitted `@flour{0%gram}` — inventing a quantity, and rendering "0 gram" on the read
  side. A blank amount is now NO amount, exactly like `""`: the token degrades to
  `@salt` / `@sea salt{}` and **the ref is never dropped** (the projection builds
  ingredient rows from the tokens). That is the only behaviour change on this side, and
  it is a fidelity improvement, not just a hardening.
- **`#cookware` — established explicitly, as the plan required:** the serializer emits
  cookware **nowhere** (only `@` and `~`). So the emission half is a **no-op for `#`**;
  the recognizer still refuses the `#` form, because a `#` token in a serializer-authored
  source is by definition not serializer-shaped.
- **Recognition.** `matchTokenBody` now mirrors `escapeTokenText` **per segment**
  (leading / trailing / doubled whitespace is a defect) instead of counting characters —
  counting is precisely what let a space through. The same rule is applied to the token
  **NAME**, which goes through the same escaper: `@ flour{1%cup}`, `@flour {1%cup}`,
  `@brown  sugar{1%cup}` and `~ rest{5%minutes}` are refused too. Internal SINGLE spaces
  stay legal (`{1 1/2%cup}`, a `fl oz` unit, `@sea salt{}`), because over-tightening here
  is exactly how round 1 failed.
- **Containment is asserted separately**: `parseInPool` is called DIRECTLY with all three
  trap shapes (recognizer bypassed), each resolves `null`, the parent survives, and the
  pool still serves a good source afterwards.

## 14.3 H3 — the span fix, and the test dimension that was missing (D-27-W3B-08)

`findNameIndex` is now `findNameSpan`, returning `{ index, length }` — the **matched**
span — and `splitFragment` slices by `length`. Confirmed before and after:

| ingredient name | step prose | before | now |
|---|---|---|---|
| `"flour "` | `Add flour now.` | `Add @flour{1%cup}now.` | `Add @flour{1%cup} now.` |
| `" flour"` | `Add flour now.` | `Add @flour{1%cup}now.` | `Add @flour{1%cup} now.` |
| `" flour "` | `Add flour now.` | `Add @flour{1%cup}ow.` (2 chars gone) | `Add @flour{1%cup} now.` |
| `"brown  sugar"` | `Add brown sugar into the bowl.` | `…{1%cup}into the bowl.` | `…{1%cup} into the bowl.` |
| `"brown   sugar"` | `Add brown sugar into the bowl.` | `…{1%cup}nto the bowl.` (ate the `i`) | `…{1%cup} into the bowl.` |

**`toLowerCase()` is not length-preserving**, so the span is measured in the ORIGINAL
string's coordinates through an explicit per-code-unit fold map (`foldCase`): `"İ"`
lowercases to two code units, and folding the whole string then using folded indices
against the original would have reintroduced the same off-by-N through a different door.
A lone surrogate lowercases to itself, so surrogate pairs survive.

**The new tests vary the REF NAME, not the prose** — that is the dimension the existing
45-test suite structurally lacked (it varies prose exhaustively and always passes a clean
name, so the two lengths were always equal). Leading, trailing, both, internal double,
internal triple, TAB, NBSP, a newline, mixed, and a length-changing lowercase name, each
crossed with the ref at the **start**, the **middle** and the **end** of the step: 30
byte-identical `serialize -> REAL parser -> project` round trips in
`round-trip-fidelity.test.ts`, plus the emitter-side equivalents in `serialize.test.ts`,
plus the four measured artefacts pinned by name (including an explicit
`not.toBe("Add flournow.")`). **No existing assertion was weakened or deleted to
accommodate any of this.**

## 14.4 Assertions that PINNED the old wrong behaviour, rewritten loudly

Four, all of them pinning the emitted frontmatter shape or the H1 hole itself:

1. `limits.test.ts`: `expect(findCookSourceDefect("---\ntitle: X\n---\n\nstep\n")).toBeNull()`
   — it **asserted that an unquoted value is accepted**, i.e. it pinned the H1 hole. Now
   asserts `frontmatter-value`, with the reason in a comment.
2. `serialize.test.ts`: `title: Spaghetti Bolognese` and `norish.system: metric` →
   quoted.
3. `round-trip-fidelity.test.ts`: `title: Roast Beef` → `title: "Roast Beef"` (the
   control-character FOLD it tests is unchanged).
4. `parse.test.ts` and `api/…/cook-payload.test.ts`: hand-written frontmatter quoted.

The `api` file is outside Tasks 3/4's `<files>`; I edited **two assertion lines** there
because my emission change would otherwise have left that suite knowingly red for the
consolidated gate. Nothing else in `packages/api` was touched.

## 14.5 No regression into false refusals — re-verified explicitly

- **The 14 realistic recipes are now a COMMITTED corpus** in `limits.test.ts` (they were
  a hand-run verify-round list before): the pot roast (`@` / `#` / `~` shorthand),
  `2% milk`, `70% dark chocolate`, `S&P`, `Ben & Jerry's`, `3-4 cloves`, `1/2 tsp`,
  `180°C (350°F)`, Dutch (`± 200 g`, `2½ uur`), CJK (`麻婆豆腐`), `Café @ Home blend`,
  `{filtered} water`, `jalapeño #2`, and a numeric title `1.50` with `to taste`. Each is
  asserted to pass every cap, produce **no defect**, and come back from the REAL parser
  with a read model. All 14 mint.
- The five committed fixtures still serialize, pass both gates and round-trip, with **no
  fixture and no fixture assertion edited**.
- Round-trip fidelity is still byte-identical, and the two documented normalizations are
  unchanged and still the only two: CR/LF in prose folds to a space, and an unpaired
  UTF-16 surrogate becomes U+FFFD. **No third normalization was introduced** — the H2
  amount change removes an invented `0`, and the H3 fix removes a deletion.
- `parser.extensions = 0` untouched; `180°C` and `1.50 kg` still round-trip verbatim.

## 14.6 Gates

| gate | result |
|---|---|
| real `tsc --noEmit -p packages/shared/tsconfig.json` | **EXIT 0**, zero output (redirected to a file; `tsc \| head` lies) |
| real `tsc --noEmit -p packages/shared-server/tsconfig.json` | **EXIT 0**, zero output |
| `@norish/shared` test | **319 passed / 15 files** (was 295 — +24) |
| `@norish/shared-server` test | **545 passed / 22 files** (was 432 — +113), full-suite run |
| `@norish/api` `cook-payload.test.ts` | **25 passed** |
| `@norish/shared-react` `ingredient-links.test.ts` | **9 passed** (it consumes `formatTokenAmount`) |
| eslint on every touched source file | **0 errors, 0 warnings** |
| `grep maxCookMalformedTokens\|countMalformedCookTokens` | 5 hits, **all prose in docblocks**, no code |
| DB migration | **42**, `migrations/` + `meta/_journal.json` untouched |

**Per the concurrency instructions I did NOT run the full monorepo gate** — three other
streams were editing `apps/mobile`, `packages/shared-react` and the pool in the same tree.
One transient failure is worth recording honestly: in the first full `@norish/shared-server`
run, `pool.test.ts`'s "warm p50 round trip is under 5 ms" measured **5.43 ms** and failed.
It is a wall-clock latency measurement in **another stream's file**, it passed in isolation
and in the later full run, and my change does not touch that path (that test parses a
hand-written source through the pool). It is the same contention sensitivity §13 documents
for wall-clock assertions, not a regression from Tasks 3/4.

## 14.7 Three things the director should know

1. **A `.cook` written by the PRE-Task-3 serializer is now REFUSED on the read and copy
   paths** (unquoted plain scalars are no longer serializer-shaped). Live data is
   confirmed clean — **0 rows with a non-NULL `cook_source`** — so the blast radius today
   is zero, and any row written from here on is written by the new serializer. But this is
   the one place where an existing row's behaviour changes, and if W5's backfill ever
   reads rows minted between `f7bcecb8` and this commit, it must re-serialize rather than
   re-parse. It also settles **director exit item 4**: no H3 data audit is needed, because
   there are no rows to audit.
2. **`findCookSourceDefect` is still not the guarantee, and the docblocks now say so in
   both directions.** The H1/H2 fixes are recorded as defence in depth with an explicit
   pointer to `pool.test.ts` for the bound. Please keep that framing in review — the same
   mistake has now been available in three separate places.
3. **Task 6 (adversarial verification) is still NOT DONE** and is not mine. Two obvious
   weakenings for the new grammar, in the same style as W3B-W1/W2: (a) restore the
   `PLAIN_YAML_SCALAR` branch in `quoteYaml` and confirm the H1 artefact tests go RED;
   (b) revert `matchTokenBody` to counting characters and confirm the H2 tests go RED.
   Both revert cleanly and neither should ever be committed.

---

# 15. Task 6 — the adversarial weakenings — and the WAVE CLOSE-OUT

**Commits:** `231baf91` (the read-path latency root fix + two more contention flips +
two stale docblocks) · this commit (the record). Nothing pushed. **Nothing deployed.**
Tree `main`, DB at migration **42**, `packages/db/src/migrations/` and
`meta/_journal.json` untouched, `pnpm-lock.yaml` diff EMPTY. No `as any`, no
`@ts-ignore`, no `@ts-expect-error`. No `COOK_LIMITS`, `COOK_BOUNDS` or
`COOK_FRONTMATTER_KEYS` value moved. `maxCookMalformedTokens` stayed deleted. W4/W5/W6
untouched. Files touched by this task's ONE commit: `src/cooklang/pool.ts`,
`src/cooklang/limits.ts` (docblock only), `src/cooklang/parse.ts` (docblock only),
`__tests__/cooklang/pool.test.ts` — all in `@norish/shared-server`.

## 15.1 THE PROTOCOL, AND WHY EVERY REVERT WAS CHECKED TWICE

Each weakening: edit → run the suites → record the exact failing test names → revert by
the **reverse edit** (never `git checkout`) → verify `md5sum` against a pre-edit copy,
`cmp` against it, and `git diff --exit-code`. **The reverse edit rather than
`git checkout -- <file>` is deliberate and it is an environment trap, not fastidiousness:**
`node_modules/@norish/*` are injected **hardlink farms sharing the workspace inode**, so
a `git checkout` replaces the file with a NEW inode and the injected twin keeps the
WEAKENED bytes — every cross-package suite would then have gone on running the weakening
while `git diff` read clean. The twin's md5 is therefore asserted too, on every revert.
**No weakening was committed** (`git diff --exit-code` empty after each; the commit
above contains none of them).

## 15.2 THE SIX WEAKENINGS OF THE NEW SURFACE

W3B-W1/W2 (disable the CPU gate → 13 RED; regress it to wall clock → 9 RED) and W3's
five (W3-W1…W3-W5) are recorded in §13.7 and `27-03-SUMMARY.md`. These six cover the
surface that landed in Tasks 3, 4 and 6 — the H1 closed frontmatter grammar, H2's
trim-aware emission and recognition, H3's matched span, and the pooling itself.

| # | the exact edit | RED | reverted |
|---|---|---|---|
| **W3B-W4** | `limits.ts`: reinstate the pre-Task-3 recognizer — `if (/^[A-Za-z][A-Za-z0-9._-]*: .*$/.test(line)) return null;` at the top of `findFrontmatterLineDefect`, plus `if (false && …)` on BOTH `frontmatter-too-large` caps (the arithmetic block cap and the line-count cap) | **30 RED** in `limits.test.ts` (30 failed / 120 passed) | md5 `7c5b419a…`, `cmp` clean, `git diff` empty |
| **W3B-W5** | `limits.ts`: `isSerializedSegment` back to counting — `return segment.chars > 0;` | **22 RED** in `limits.test.ts` (22 failed / 128 passed) | same md5, `cmp` clean, `git diff` empty |
| **W3B-W6** | `serialize.ts`: restore the deleted `PLAIN_YAML_SCALAR = /^[\p{L}\p{N}][^\r\n:#"]*$/u` branch in `quoteYaml` (`if (PLAIN_YAML_SCALAR.test(flat)) return flat;`) | **120 RED**: `@norish/shared` 6, `@norish/shared-server` 97, `@norish/api` `cook-payload` 17 | md5 `482d6551…`, `cmp` clean, `git diff` empty |
| **W3B-W7** | `ingredient-token.ts`: `formatTokenAmount`'s guard back to `if (amount == null \|\| amount === "")`, so `Number(" ")` is `0` and a blank amount formats as `"0"` | **7 RED** in `@norish/shared` `serialize.test.ts` | md5 `3d395fe2…`, `cmp` clean, `git diff` empty |
| **W3B-W8** | `serialize.ts`: `splitFragment(…, span.index, ref.name.length, token)` — the H3 defect | **20 RED**: `@norish/shared` 6, `@norish/shared-server` `round-trip-fidelity` 14 | md5 `482d6551…`, `cmp` clean, `git diff` empty |
| **W3B-W9** | `serialize.ts`: add `"author"` to `COOK_FRONTMATTER_KEYS` without teaching `buildFrontmatter` to emit it — i.e. KEY-SET DRIFT between the two halves | **4 RED**: `limits.test.ts` 3, `@norish/shared` `serialize.test.ts` 1 | md5 `482d6551…`, `cmp` clean, `git diff` empty |
| **W3B-W10** | `pool.ts`: `release()` retires its child instead of freeing it — i.e. DELETE THE POOLING, every parse pays a fresh 200-243 ms spawn | **5 RED** in `pool.test.ts`, incl. the new latency alarm and `each committed fixture completes in under 50 ms` (measured **303 ms**) | md5 `c50b94a1…`, `cmp` clean, `git diff` empty |

**Every weakening turned something red. There is no coverage gap to report** — which
is worth stating plainly, because the instruction was to report one loudly if a planned
weakening had turned nothing red.

### The exact RED test names

**W3B-W4 (30)** — all six `returns a NAMED defect for the H1 artefact: …` (`65 400
unbalanced [` · `balanced 25 000-deep [/]` · `balanced 30 000-deep [/]` ·
`{`-nesting variant · `title: @@@@ ####` · `YAML anchor + alias a: &x [*x]`), `REJECTS a
frontmatter block the serializer could not have written`, and 23 of the 30 `REFUSED`
rows: a literal / folded block scalar, a flow map, a flow sequence, a YAML tag, an
unquoted value, an unquoted numeric title, an empty value, an empty QUOTED value, a
whitespace-padded quoted value, an unterminated quote, a quote closed only by an
ESCAPED quote, a RAW quote, a RAW backslash, a control character, a NUL, a QUOTED
`servings`, an exponential `servings`, a key not in the closed set, a YAML anchor under
an unknown key, a duplicate key, more lines than the key set has keys, a value longer
than the per-key maximum. **The four 50-65 KB H1 payloads went from
`frontmatter-too-large` back to ACCEPTED, exactly as the director's brief required.**
(The seven `REFUSED` rows that stayed green — a comment line, `...`, no space after the
colon, a blank line, a TAB/SPACE-indented line, an unterminated block — are refused by
the *structure*, not the key/value grammar, so the permissive line pattern cannot rescue
them. That is the correct result, not a gap.)

**W3B-W5 (22)** — every one of the H2 `REJECTS "…" and never asks the pool` rows:
`@a{ %g}\n`, `~a{ %m}\n`, `#a{ %g}\n`, `@a{ %g}` (no trailing newline), `~a{ % }\n`,
`@a{ }\n`, the TAB and NBSP variants of all three sigils, `@a{1 %g}`, `@a{ 1%g}`,
`@a{1% g}`, `@a{1%g }`, `@a{1  1/2%g}`, `@a{1%fl  oz}`, `@ flour{1%cup}`,
`@flour {1%cup}`, `@brown  sugar{1%cup}`, `~ rest{5%minutes}`. **All three trap sigils
reach the parser again**, and the same assertion proves the pool was never asked.

**W3B-W6 (120)** — `@norish/shared`: `emits YAML frontmatter carrying norish.system
(D-2)`, `emits numeric metadata UNQUOTED so the parser reports no diagnostic`, `emits
only key: "…" or key: <number>, for every hostile metadata value`, `keeps servings a
BARE number and quotes everything else`, `OMITS a key rather than emitting a value the
recognizer would refuse`, `emits an all-whitespace metadata value as NO key at all`.
`@norish/shared-server`: 97, including `accepts a REAL serializer-emitted line for every
key in the closed set`, `accepts every committed serializer fixture's real .cook
output`, `agrees with the serializer about every character YAML forbids RAW`, the whole
`soundness: the serializer can NEVER produce a source the recognizer refuses` sweep, and
**all 14 of `the 14 realistic recipes still MINT`**. `@norish/api`: 17 of 25
`cook-payload` tests. **This is the row that settles §0's first line:** the emitter and
the recognizer are two halves of one contract, and moving either half alone costs every
real recipe its `cook_source`.

**W3B-W7 (7)** — the six `emits no blank-quantity shape for an amount/unit of …`
rows (`" "`, `"\t"`, NBSP, `"  "`, `" \t "`, U+2028) and `a blank amount keeps the
reference and reports it as placed`. The fabricated `@flour{0%gram}` is caught on the
emitter side. **Not run: `@norish/shared-react`'s `ingredient-links.test.ts` (9 tests),
which also consumes `formatTokenAmount`** — another agent owned that package during this
task, so its 9 tests are an untested additional detector rather than a claimed one.

**W3B-W8 (20)** — `@norish/shared`: `keeps the prose intact around a ref name with
trailing space / leading space / both / internal double space / internal triple space`
and `the SPECIFIC measured H3 artefacts no longer eat a character`.
`@norish/shared-server` `round-trip-fidelity.test.ts`: 12 × `keeps the prose
BYTE-IDENTICAL with <whitespace shape>, at the start / in the middle`, `the four
MEASURED H3 artefacts render byte-identically`, and `the ingredient NAME still comes
back trimmed and collapsed, and the ref is never dropped`. **`"flour "` produces
`"Add flournow."` again and a ref-name-whitespace test catches it** — which is the
dimension the pre-Task-4 45-test suite structurally could not see. (The `at the end`
positions stay green: with no prose after the ref there is nothing for the over-long
slice to eat. Worth knowing if this defect ever recurs — an end-of-step ref hides it.)

**W3B-W9 (4)** — `REJECTS a key not in the closed set with frontmatter-key`, `accepts a
REAL serializer-emitted line for every key in the closed set`, `the closed key set is
EXACTLY what the serializer emits (add a key here and there)`, and `@norish/shared`'s
`emits each key at most once, in the closed set's order`. So the **two-way** key-set
assertion §14.1 claims really does bite in the direction that a one-way allowlist would
have rotted in silently.

**W3B-W10 (5)** — `spawns exactly one child on the first parse, and never exceeds the
pool size`, `each committed fixture completes in under 50 ms once the pool is warm`,
`a warm round trip costs bounded CPU and has a bounded FLOOR`, `retires the exact pid
that hit the bound, and the next call still succeeds`, `survives a child killed
EXTERNALLY mid-flight and answers with null`.

## 15.3 THE FLAKY LATENCY ASSERTION, ROOT-FIXED — AND TWO MORE OF THE SAME CLASS

`pool.test.ts`'s `warm p50 round trip is under 5 ms over 100 iterations` measured
**5.43 ms** for the Tasks-3/4 executor and **9.39 ms** when re-measured here, in full
runs, while passing in isolation. It had **the exact disease D-27-W3B-03a diagnosed for
the bound itself**: 5.9x of headroom (5 ms against a design p50 of 0.85 ms) on a
quantity §13.1 measured inflating **7.5x-11.6x under host load**. Raising it to 25 ms
would have been the wall-clock retune this phase already rejected once — and would have
retired the alarm, since a per-parse respawn is about the only regression 25 ms still
catches.

**The alarm moved onto axes that measure THIS CODE**, mirroring the architecture of
`COOK_BOUNDS` itself (a CPU primary + a generous wall backstop):

| assertion | measured on this box | ceiling | rationale |
|---|---:|---:|---|
| PARENT CPU per warm round trip (`process.cpuUsage()` over 100 iterations) | **1.087 ms** | 4 ms | ~3.7x, the same headroom rule `cookParseCpuMs` uses; CPU was measured flat within ±3% across an order of magnitude of load |
| CHILD CPU per warm round trip (`/proc/<pid>/schedstat`, via the gate's own reader) | **1.154 ms** | 4 ms | same |
| the **FASTEST** of the 100 round trips, not the median | **1.513 ms** | 5 ms | the minimum is the standard robust estimator for a path's intrinsic latency — the least-interfered-with iteration — and 5 ms is R2's original number, now on a statistic that measures the code |

`cookParseChildCpuMsForTests(pid)` was added beside the two existing `ForTests` exports
so the test reads the child's CPU through **the gate's own reader** rather than
re-parsing `/proc` itself — two mirrored readers of one kernel file would drift, and only
one of them would be the one the bound decides with.

**It can still fail meaningfully, and that was verified rather than argued:** W3B-W10
(delete the pooling) turns it RED. Its first assertion fires — after a warm-up parse
there is no live child left to attribute CPU to — and the sibling 50 ms fixture
assertion measured **303 ms** in the same run, so the floor would have caught it too.
A WASM instance rebuilt per parse (+15.7 ms), an extra copy of a 64 KiB payload or a lost
`ready` handshake each cost CPU or raise the floor by far more than 3.7x.

### ⚠ THE FINDING THAT CAME OUT OF FIXING IT: ABOVE ~5.3x OF CONTENTION THE BACKSTOP PRE-EMPTS THE CPU GATE

Two more tests in the same file were flaky for one shared reason, and it is **arithmetic,
not luck**: burning 1 500 ms of CPU takes 1 500 ms of wall clock only on an idle box, and
`1 500 x 5.34 = 8 000`. So **once sustained contention exceeds ~5.3x — well inside the
7.5x-11.6x §13.1 measured — the 8 000 ms WALL BACKSTOP fires before the CPU gate can
spend its budget**, and the same hostile row is refused as `pool-timeout` with
`bound: "cookParseWallCeilingMs"` instead of `pool-cpu`.

Observed, not theorised: `resolves null, with the gate reporting the CPU it refused, on
report explosion — "#" x 8192` failed at **8 158 ms** in a full run, and `leaves the
PARENT process alive with its heap essentially untouched` died on vitest's 30 s file
timeout because it drove all six hostile payloads at up to 8 s each.

**This is not a defect in the bound.** The row is refused either way, the child is killed
and replaced either way, and the user loses nothing either way — the never-broken
guarantee holds on both paths. `cookParseWallCeilingMs` was NOT changed: it is a
deliberate 9.6x over the worst legitimate IDLE wall clock, and lowering the CPU budget or
raising the ceiling to separate them would trade a real property for a tidier test.

What was wrong was the **tests**, and both are now root-fixed:

- The hostile sweep no longer PINS one reason at the shipped defaults — pinning one was a
  measurement of the machine, the very mistake D-27-W3B-03a exists to stop repeating. It
  now asserts what is true on every box, with three sets of teeth: the per-reason number
  (`pool-cpu` ⇒ `measured >= cookParseCpuMs`; `pool-timeout` ⇒
  `measured >= cookParseWallCeilingMs`), the discrimination that **`pool-heap` remains
  impossible for a flat-6-MB H1 shape**, and — the important one — that a `pool-timeout`
  on a hostile row carries **`cpuMs > 0.5 x cookParseCpuMs`**, i.e. the child was
  COMPUTING and not stuck. A broken CPU sampler cannot hide in that branch.
- **A NEW deterministic test pins the CPU gate on the real H1 artefact** with the
  backstop lifted to 60 s through its env lever, so on any box, idle or starved, the only
  gate that can fire is the CPU gate: `reason: "pool-cpu"`, `bound: "cookParseCpuMs"`,
  `measured >= 1 500`, and an anti-vacuity floor (`elapsed > 0.9 x cookParseCpuMs`) that
  is sound everywhere because burning 1 500 ms of CPU takes at least that long. This is
  the assertion the sweep gave up, restored without the load dependence rather than lost.
- The parent-heap test drives the **two ballooning payloads**, which is its actual claim:
  the four H1 rows run at a flat 6 MB and can contribute nothing to a heap-GROWTH figure,
  while each can hold a child for up to 8 s. A test that dies on the harness timeout
  proves only that the harness has one — that rule is in the file's own docblock.

## 15.4 TWO DOCBLOCKS STILL DESCRIBED THE SUPERSEDED WALL-CLOCK BOUND

`limits.ts`'s module docblock ("`./pool`: a 1 000 ms `SIGKILL` wall-clock bound and a
256 MB heap bound") and its lesson paragraph ("what bounds parse time is `./pool`'s
wall-clock `SIGKILL`"), plus `parse.ts`'s guarantee paragraph ("under a 1 000 ms
wall-clock bound"), were **false after `cffaa5d8`**. All three now describe the CPU gate,
the backstop and the heap bound, and name D-27-W3B-03a as what superseded the old text.
This is exactly the class of stale claim D-27-W3B-13 was created to prevent — a docblock
that states a guarantee the code no longer provides — and it is the **fourth** time in
this phase that a comment had to be corrected rather than trusted.

## 15.5 W5's PREREQUISITES, NOW ACCUMULATED — READ BEFORE PLANNING THE BACKFILL

W5 is the live-data backfill (migration `0042`) and it now carries three hard
preconditions, two of which did not exist when it was scoped.

1. **W5's BACKFILL MUST RE-SERIALIZE, NOT RE-PARSE.** Task 3 made every non-numeric
   frontmatter value quoted UNCONDITIONALLY, so a `.cook` written by the PRE-Task-3
   serializer (unquoted plain scalars — `title: Spaghetti Bolognese`) is **no longer
   serializer-shaped and is refused on the read and copy paths**. Live data is confirmed
   clean (**0 rows with a non-NULL `cook_source`**), so the blast radius today is zero —
   but any backfill that reads a stored source and re-parses it will refuse rows minted
   between `f7bcecb8` and `5cdfc8aa`. Re-serialize from the structured tables instead.
   This also settles the old **director exit item 4**: no H3 data audit is needed,
   because there are no rows to audit.
2. **THE UNIT VOCABULARY AND A ROUNDING RULE MUST LAND FIRST.** D-27-W3-07 was measured
   in W3 and the answer was uncomfortable: the DERIVED US output is **worse than the
   AI's** — 18 of 35 ingredients differ across the five fixtures, every `cup` of a dry
   good becomes `ounce` (`2 cup flour` → `8.81849 ounce`), `fl oz` and `pint` are never
   produced at all, and every conversion carries unrounded 6-decimal values
   (`14 ounce` → `14.109585 ounce`). So W5 must not enable single-system extraction until
   **both** the W0 `kilogram` / `fl oz` / `pint` canonical unit IDs **and** a rounding
   rule are in. The density table (~29 ingredients) should be expanded in the same pass,
   after measuring the flag rate on out-of-table volume-authored ingredients.
3. **W5 PAUSES FOR KIRAN'S EXPLICIT SIGN-OFF.** Per the Phase-22.4/25 migration
   discipline, and unchanged by anything in this plan. `0042` is a data migration on a
   live database; nothing about it is inferable from a green suite.

## 15.6 CORRECTED OPERATIONAL GUIDANCE FOR THE DEPLOY

- **`pool-cpu` firing does NOT mean "the number is wrong for this box".** The bound is
  now box-independent (±3% across an 11.6x wall-clock inflation), so a nonzero `pool-cpu`
  rate on real recipes means a genuinely new legitimate shape costs more than the
  measured **506 ms** worst-legitimate CPU. That is **a measurement to redo, not a knob
  to turn** — and the 506 ms figure itself deserves re-measuring on the deployed box.
- **`pool-timeout` should be near zero, and it is a bug report rather than a tuning
  signal — WITH ONE MEASURED EXCEPTION.** §15.3: above ~5.3x of sustained contention a
  hostile row legitimately lands on the backstop. So **read `cpuMs` beside the reason**:
  `pool-timeout` with `cpuMs` at ~0 is a genuinely stuck child (a hang, a lost IPC reply)
  and is the bug report; `pool-timeout` with `cpuMs` in the hundreds or thousands is a
  hostile row on a saturated box, which is the bound working. Every bound log already
  carries `bound` + `limit` + `measured` + `cpuMs` + `elapsedMs` + `bytes` + `pid`.
- **`pool-heap` is not redundant** and must not be relaxed if the ceiling ever rises: it
  is the only thing between a hostile row and 839 MB-1.65 GB (§3, §13.3).
- **Size the container against ~628 MB of transient**, not 512 MB: two children at a
  measured 313.6 MB peak RSS each (`--max-old-space-size` caps V8's old space, not RSS).
- **The `tsdown` build gate's hardcoded `parse-worker.mjs` is CORRECT — do NOT "fix" it.**
  The `.js`/`.mjs` finding concerned the **pool's runtime sibling rule**, which derives
  its extension from `extname(import.meta.url)` because a hardcoded `.js` there would
  resolve a nonexistent path **in production only, silently**. In the BUILD GATE a
  hardcode fails the build LOUDLY if tsdown's output ever changes, which is the whole
  point of having the gate. Both were re-verified in §13.9.
- **W3 will NOT be inert once deployed.** Live's `ai_config` has held a DeepSeek key
  since **2026-06-15** (set through the Admin UI) and it is now **env-backed**:
  `AI_API_KEY` in `/opt/norish/.env` (verified present, untracked — outside the repo —
  and `chmod 600`). W3's exit item 5, `27-03-SUMMARY.md` and `STATE.md` all say the
  opposite; they are **wrong** and are corrected here and in `STATE.md`. Extraction is
  live-configured, so the first deploy carrying W3 begins minting real `cook_source`
  rows, which makes §15.5's re-serialize prerequisite live rather than theoretical.
- Still open and unchanged: an **in-image** confirmation that `dist-server/parse-worker.mjs`
  is present and the pool spawns **inside the container** (R1's failure mode is silent, so
  the build host is not evidence), and a verified-restorable backup before the deploy.

## 15.7 WHAT IS **NOT** DONE

- **W4** (client token renderer, multi-timer, deleting the heuristic runtime path),
  **W5** (backfill `0042` + review tool, gated on sign-off) and **W6** (contract:
  `cook_source` NOT NULL) are **untouched**. Phase 27 is 3 of 7 waves deployed and 4 of 7
  code-complete.
- **NOTHING FROM W3 OR W3B IS DEPLOYED.** Live `norish-app` runs image
  **`516c52576a5f`** at DB migration **42** — verified with `docker inspect` during this
  task, not assumed. `pnpm docker:build` is the director's step and was not run.
- `apps/web` was **not** run (412/424 red for an unrelated reason, and another agent owns
  it this session); `@norish/shared-react` was **not** run for the same ownership reason.
  Neither was touched.

## 15.8 Gates

| gate | baseline | result |
|---|---|---|
| real `tsc --noEmit -p packages/shared-server` | EXIT 0 | **EXIT 0**, zero output (redirected to a file; `tsc \| head` lies) |
| real `tsc --noEmit -p packages/shared` | EXIT 0 | **EXIT 0**, zero output |
| `@norish/shared-server` test | 545 with **1 flaky red** | **546 passed / 22 files** (+1 deterministic CPU-gate test), full-suite run, the flaky red GONE |
| `@norish/shared` test | 319 | **319 passed / 15 files** |
| `@norish/api` `cook-payload` | 25 | **25 passed** |
| `@norish/queue` test | 121 | **121 passed / 17 files** |
| `@norish/db` test (`sg docker`) | 179 | **179 passed / 23 files** |
| eslint on every touched source file | 0 errors | **0 errors, 0 warnings** |
| the 14 realistic recipes | all mint | **all 14 mint** (and W3B-W6 proves the assertion bites) |
| `@cooklang/cooklang` importers in production | 1 (`parse-worker.ts`) | **1**; the static one-importer assertion and the tsdown gate both untouched |
| `git diff` after every weakening | empty | **empty**, md5 + `cmp` verified against a pre-edit copy, twin inode checked |
| DB migration | 42 | **42**; `migrations/` + `meta/_journal.json` untouched |
| `git diff pnpm-lock.yaml` | empty | **empty** |

## 15.9 THREE THINGS THE DIRECTOR SHOULD KNOW

1. **A bound test that pins WHICH gate fired is a measurement of the machine.** §15.3's
   arithmetic (`1 500 x 5.34 = 8 000`) means the answer changes with host load, and this
   file now has three tests that were written as if it could not. The general rule, worth
   carrying into W4-W6: assert the never-broken OUTCOME at the shipped defaults, and pin
   a MECHANISM only with the other bounds lifted out of the way through their env levers.
2. **The emitter and the recognizer are one contract with two halves, and W3B-W6 is the
   proof.** Moving either half alone costs every real recipe its `cook_source` — 120 tests
   red, including all 14 realistic recipes. That is the strongest argument for keeping
   `COOK_FRONTMATTER_KEYS` exported from the serializer and imported by `limits.ts`, and
   against ever "relaxing the recognizer" as a standalone change.
3. **The live DeepSeek key changes the risk profile of the next deploy** (§15.6). Every
   prior summary assumed W3 would be inert on live. It will not be: the first deploy
   carrying W3 starts writing real `cook_source` rows through the new serializer, which is
   exactly when §15.5's re-serialize prerequisite and the `pool-cpu` / `pool-timeout`
   watch become real rather than precautionary.

---

# 16. POST-WAVE DEFECT: the 11 `cook-tokens-isolation` reds were a STALE FIXTURE

`packages/trpc` measured **326/337**. All 11 reds were in
`packages/trpc/__tests__/recipes/cook-tokens-isolation.test.ts`, every one of them
`AssertionError: expected null not to be null` on `cookTokens`. It reproduced with
nothing else running, so it was correctly treated as a genuine defect rather than
test pollution. It was genuine — but it was in the TEST'S INPUT, not in the code.

## 16.1 THE ROOT CAUSE, AND THE EVIDENCE THAT PROVES IT

The suite's `.cook` was a **hand-written string literal** carrying UNQUOTED
frontmatter scalars:

```
---
title: Grandma's Secret Stollen
norish.system: metric
---
```

§ Task 3 (the H1 root fix) made `buildFrontmatter` quote every non-numeric scalar
**unconditionally**, and taught `findCookSourceDefect` a closed grammar in which
`VALUE := quoted` for every key outside `COOK_FRONTMATTER_NUMERIC_KEYS`. From Task 3
onward this literal is **not something norish's serializer could have written**, and
the read path refuses it — exactly as designed.

Measured inside `packages/trpc`'s own vitest environment, on the real modules:

```
DIAG byteBreach=null
DIAG defect={"defect":"frontmatter-value","offset":11}
DIAG parseCookSource=NULL
```

`offset: 11` is `4 + len("title") + 2` — the first byte of the `title` VALUE. The
refusal is logged by the real `parserLogger` as
`reason: "not-serializer-shaped", defect: "frontmatter-value", offset: 11, bytes: 139`.

The same source with the two values quoted, in the same environment, in the same run:

```
DIAG quoted defect=null
DIAG quoted parseCookSource=[{"order":0,"section":null,"tokens":[
  {"type":"text","value":"Fold the "},
  {"type":"ingredient","name":"marzipan","amount":200,"unit":"gram"}, ... ]}]
```

**This refutes every mechanical hypothesis.** The failure is NOT child-entry
resolution, NOT a `.ts`/`.mjs` mismatch, NOT a missing loader, NOT a stale hardlink
farm, and NOT an env difference in that suite. `parseCookSource` never reached the
pool at all: `findCookSourceDefect` is checked FIRST, as defence in depth, and it
returned a defect. The tests took **132 ms** in total for 35 tests — far too fast
for eleven child spawns, which was the first clue that no spawn was ever attempted.

The pool is healthy under `packages/trpc`. Sampling the process table during the
green run catches the child directly:

```
PID 4165134  PPID 4164333
/usr/local/bin/node --max-old-space-size=256 \
  /opt/norish-src/packages/shared-server/src/cooklang/parse-worker.ts
```

The sibling-extension rule (`parse-worker${extname(here) || ".js"}`) correctly
resolves `.ts` in the source context and the 256 MB heap bound is applied. The prior
agent's `.mjs` fix is intact and needed no further work. Independently,
`shares.test.ts` in the same package has always driven a frontmatter-less `.cook`
through the real pool and has always been green.

## 16.2 PRODUCTION IS **NOT** AFFECTED

Stated plainly, because it bears on a deploy decision:

- The emitter and the recognizer **agree**. `structuredToCooklang` quotes; the
  recognizer requires quotes. Only the hand-written test string disagreed with both.
  This is precisely §15.9's point 2 — the two halves of one contract — and here the
  contract held; a stale third party had copied one half by hand.
- The live DB carries **6 recipes and ZERO non-null `cook_source`** (`select
  count(cook_source) from recipes` -> `0`), and **0** rows with unquoted frontmatter.
  There is no pre-T3 `.cook` anywhere on live to be refused.
- Nothing is deployed: `norish:live` is still `516c52576a5f…`, and the live DB is at
  migration **42**.

The residual risk this DOES flag is §15.5's re-serialize prerequisite, already
recorded: any `.cook` minted by a PRE-Task-3 serializer is now correctly refused on
read and falls back to the full legacy projection. That is the never-broken guarantee
working, it loses the user nothing, and on live there are no such rows.

## 16.3 THE FIX — FIXTURE, NOT CODE, AND NOT A RE-QUOTED LITERAL

No production file was touched. **Zero** changes to `COOK_LIMITS`, `COOK_BOUNDS`,
`COOK_FRONTMATTER_KEYS`, the escaping, the CPU gate or the tsdown build gate.

1. `SECRET_COOK_SOURCE` is now **minted by the real serializer**
   (`structuredToCooklang`) rather than hand-written. Re-quoting the literal would
   have fixed the symptom and left the next grammar change to rot it again; minting
   it means the suite consumes whatever the emitter actually emits. Same two-way
   discipline `limits.test.ts` uses to pin the key set against the recognizer.
2. The permitted side was **strengthened, not weakened**. `expect(cookTokens)
   .not.toBeNull()` cannot tell a working boundary from a refused parse, a bound hit
   or a failed spawn — all four resolve `null`. A new `expectRealCookTokens` pins the
   exact token stream, including `amount: 200, unit: "gram"` values that exist ONLY
   because the WASM in the child derived them from `@marzipan{200%gram}`. Every
   permitted-side assertion now routes through it. The denied side is untouched.

## 16.4 VERIFICATION

| gate | expected | result |
| --- | --- | --- |
| `@norish/trpc` test | 337 | **337 passed / 32 files** |
| the 11 tests pass via the REAL pooled parse | not a mock, not a tolerated null | **child fork captured in the process table**; tokens pinned to parsed amounts/units |
| `@norish/shared-server` test | 546 | **546 passed / 22 files** |
| `@norish/shared` test | 319 | **319 passed / 15 files** |
| `@norish/api` test | 408 | **408 passed / 30 files** |
| `@norish/queue` test | 121 | **121 passed / 17 files** |
| `@norish/db` test | 179 | **179 passed / 23 files** |
| real `tsc --noEmit -p packages/trpc/tsconfig.json` | EXIT 0 | **EXIT 0**, zero output |
| DB migration | 42 | **42** applied on live |
| deployed image | unchanged | **`516c52576a5f…`**, nothing deployed |

## 16.5 ONE THING THE DIRECTOR SHOULD KNOW

**A hand-written fixture is an unversioned third copy of a contract.** §15.9 framed
the emitter and the recognizer as two halves that must move together; this defect
shows the halves moved together correctly and a hand-copied literal in a THIRD
package silently did not. The isolation suite is the only place a `.cook` was typed
by hand and then required to parse, and it is now minted. One other hand-written
`.cook` remains, in `packages/db/__tests__/.../cook-write-path.test.ts`, and it is
deliberately left alone: it hands the repository `cookSource` AND `cookTokens` as
literal payloads and asserts storage round-trips, so its bytes are opaque and never
parsed. It is not wrong — but if W4/W5 ever make that suite parse, it will need the
same treatment.
