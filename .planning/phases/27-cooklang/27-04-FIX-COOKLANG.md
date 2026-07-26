# 27-04 — VERIFY-3 blockers 1, 2, 3, 4: the root fixes

**Executor:** LXC 110, `/opt/norish-src`, branch `main`.
**Scope:** VERIFY-3 blockers **1, 2, 3 and 4** only. Blockers 5 and 6 were fixed
concurrently by another stream (`ff289ae6`, `370cec55`) and are not covered here.
**Nothing pushed. Nothing deployed.** DB at migration **42**, `_journal.json` still 42
entries, `packages/db/src/migrations/` untouched, `git diff pnpm-lock.yaml` EMPTY, no
`as any` / `@ts-ignore` / `@ts-expect-error` / type widening anywhere in the diff.

| commit | blocker |
|---|---|
| `2232d3e5` `fix(27-04): mint pool.test.ts's REALISTIC fixture from the real serializer` | **2** |
| `ea242ed0` `test(27-04): make the two vacuous cooklang assertions assert the real outcome` | **3** |
| `43b5e1b7` `fix(27-04): bound the parse child's MEMORY on measured RSS, not on a V8 flag` | **1** |
| `388650b2` `fix(27-04): close the pool's third door — no public subpath, enforced preconditions` | **4** |

Two new decisions were taken and are recorded in the code that carries them:
**D-27-W3B-14** (the memory bound is measured RSS, not `--max-old-space-size`) and
**D-27-W3B-15** (`./cooklang/pool` is not a public door).

---

## Blocker 1 — `cookParseHeapMb` was not a memory bound

### What was actually wrong

`--max-old-space-size=256` caps **V8's old generation**. `@cooklang/cooklang` is a
`wasm-pack` build and its parse allocates in **WASM linear memory**, which that flag has
no authority over; the diagnostic report additionally crosses the boundary as a string
that lands in large-object space. So the flag never bounded what the threat allocates,
and three separate places — `limits.ts`, `pool.ts`, `parse.ts`, plus §3/§11/§13.3/§15.6
of `27-04-SUMMARY.md` — described it as what "catches the report-explosion family's
839 MB-1.65 GB balloon", sizing the container against a "~628 MB" transient.

VERIFY-3's own mutation settled it: `execArgv: []` (no heap flag at all) left 331/331
cooklang tests green. **A flag with no teeth and the wrong subsystem in its rationale.**

### Measurements (this box: LXC 110, Node v22.22.3, 4 cores, the real child)

Method: fork `packages/shared-server/src/cooklang/parse-worker.ts` exactly as `pool.ts`
does (`execArgv: ['--max-old-space-size=256']`, `stdio: ["ignore","ignore","ignore","ipc"]`,
`serialization: "json"`), then sample `/proc/<pid>/status` `VmRSS` and
`/proc/<pid>/schedstat` every 25 ms while one parse runs.

**Baseline and drift — measured to a plateau, not extrapolated:**

| point | child RSS |
|---|---:|
| after the warm-up handshake (`ready`) | **73.5 MB** |
| after 200 realistic parses | 93.1 MB |
| after +20 x 64 KiB `@a{1%g} ` | 152.1 MB |
| after +20 x `"#p " x 21845` | 174.2 MB |
| after **1 050** heavy parses (12 rounds of 25+25+100) | **175.2 MB** — flat from round 1 |

WASM linear memory is never returned to the OS, so the floor is permanent — but it is
**flat**, which is what makes an absolute budget safe rather than drift-prone.

**Worst LEGITIMATE single-parse peak, on a fresh child:**

| shape | peak RSS | child CPU |
|---|---:|---:|
| 64 KiB of `@a{1%g} ` | **120.3 MB** | 335.6 ms |
| `"#p " x 21845` | **152.9 MB** | 502.3 ms |
| 600 ingredient refs | 88.0 MB | 56.4 ms |
| a realistic 437 B recipe | 73.6 MB (no growth) | 12.2 ms |
| 200 x 4 000-char prose steps | 73.5 MB (no growth) | 14.7 ms |

**Hostile families, free-running with a 512 MB kill line:**

| payload | outcome | RSS at kill | child CPU at kill |
|---|---|---:|---:|
| H1 `---\na: "["x65400\n---\nstep\n` | killed by the CPU gate | **85.1 MB (FLAT, 79→85 across 64 samples)** | 1 505 ms |
| report explosion `"#" x 8192` | killed on RSS | 523.7 MB | **630.8 ms** |
| round-1 bypass 16 x 3 996 `@a{1%}` | killed on RSS | 519.1 MB | **642.0 ms** |

Largest single-sample RSS jump across both ballooning families: **+39 MB** (…399 → 438 →
477 MB), i.e. the overshoot a 25 ms poll can miss.

### The root fix

**D-27-W3B-14.** The parent already samples the child's CPU counter every
`cookParseCpuPollMs`; it now reads the child's `VmRSS` from `/proc/<pid>/status` **on the
same poll** and `SIGKILL`s it once RSS passes `cookParseRssMb`. New retire reason
`pool-rss`, `bound: "cookParseRssMb"`, with the **measured** figure in the log. Both
axes (`cpuMs`, `rssMb`) now travel on **every** bound hit, not just the one that fired.

- **`cookParseRssMb: 512`** (`NORISH_COOK_PARSE_RSS_MB`). 3.3x the worst legitimate peak
  (152.9 MB) and 2.9x the idle plateau (175.2 MB) — the same headroom rule
  `cookParseCpuMs` uses (2.96x over 506 ms).
- **`/proc/<pid>/status` and not the cheaper `/proc/<pid>/statm`** (33.61 µs vs 24.35 µs,
  20 000 iterations warm; the `schedstat` read beside it is 23.62 µs). `statm` reports
  **pages**, and pages→bytes means assuming `sysconf(_SC_PAGESIZE)` — a value Node
  exposes nowhere, and not 4 KiB on 16K/64K arm64 kernels. That is precisely the
  assumption D-27-W3B-03a refused to make about `_SC_CLK_TCK` when it chose `schedstat`
  over `utime`+`stime`; a silently 16x-wrong memory bound is worse than 9 µs.
- **ABSOLUTE, not a delta from the parse start.** The container and the OOM killer act on
  the absolute figure. Safe because the drift plateaus (above).
- **The 256 MB flag is KEPT and RENAMED `cookParseOldSpaceMb`**
  (`NORISH_COOK_PARSE_OLD_SPACE_MB`), because that is exactly what it sets. It stays as
  the second line for the one hole an RSS poll has — a single allocation larger than one
  poll interval — and `pool-heap` now maps to `bound: "cookParseOldSpaceMb"`.

**Every stale figure corrected in place:** `limits.ts` (module docblock, the
`COOK_BOUNDS` docblock's four-bound table, the pool-size/transient paragraph, both bound
comments), `pool.ts` (module docblock, `readChildCpuMs`'s residual note, the
`spawnChild` `execArgv` comment, the `exit` handler comment), `pool.test.ts`
(`HOSTILE.kills`, the file's own reason arithmetic).

### In-pool numbers, on the shipped path

Driven through the real `parseInPool` with the real logger spied:

| payload | reason | `measured` | `cpuMs` | `rssMb` | elapsed |
|---|---|---:|---:|---:|---:|
| report explosion `"#" x 8192` | **`pool-rss`** | **513 MB** | 679 | 513 | 1 270 ms |
| round-1 bypass | **`pool-rss`** | **513 MB** | 744 | 513 | 1 274 ms |
| H1 65 400 `[` | `pool-cpu` | 1 507 ms | 1 507 | **84 (flat)** | 3 106 ms |
| 64 KiB `@a{1%g} ` | — PARSED | — | — | 120 | — |
| `"#p " x 21845` | — PARSED | — | — | 163 | — |

In the pool the overshoot is **+1 MB** (513 against 512), because the poll catches the
first crossing; free-running it is ≤ 39 MB.

**Honest worst-case transient:** `cookParsePoolSize x (cookParseRssMb + one poll interval
of allocation)` = `2 x (512 + 39)` ≈ **1 102 MB**. This supersedes "~628 MB" (which was
`2 x cookParseHeapMb` plus slack, and `cookParseHeapMb` never bounded RSS). The pre-fix
truth was ~1.8 GB across two slots and formally **unbounded**.

**Determinism, and why it is arithmetic rather than luck:** RSS and CPU are both
functions of the work performed, so their order does not move with host load. The
ballooning families cross 512 MB at 630-744 ms of child CPU — 2x-2.4x before the 1 500 ms
CPU budget — on every run. The only gate that could pre-empt the memory gate is the
8 000 ms **wall** backstop under heavy contention (§15.3's ~5.3x crossover), so the
deterministic test lifts the ceiling to 60 s through its env lever, exactly as the
sibling CPU-gate test does.

### Mutation evidence

**V3-W2 — disable the RSS gate.** `pool.ts`:
`if (false && rssMb !== null && rssMb > COOK_BOUNDS.cookParseRssMb) {`
→ **3 RED** in `pool.test.ts`:

- `pins the MEMORY gate on the report-explosion artefact with the wall backstop lifted (deterministic)`
- `resolves null, with the gate reporting the CPU it refused, on report explosion — `"#" x 8192` (8 KiB IN, 839 MB peak)`
- `resolves null, with the gate reporting the CPU it refused, on round-1 bypass — 16 x 3 996 chars of `@a{1%}``

The two sweep rows fall through to `pool-cpu` at ~899 MB, which the new assertion "no
reported `rssMb` above the budget without `pool-rss` as the reason" refuses. Reverted by
**reverse edit** (never `git checkout` — the injected `node_modules/@norish/*` twins
share the workspace inode): md5 `a620e877d7127f62700e7425f33e69f2` on **both** the
workspace file and its hardlink twin, `cmp` clean, `git diff` empty. Not committed.

**V3-W2b — drop the V8 flag (`execArgv: []`).** → **334/334 cooklang tests still green.**
Run deliberately, and recorded in `limits.ts` as the **expected** result rather than a
finding: the RSS gate fires at 512 MB, so no test payload can reach a V8 old-space OOM at
all. The point is that the memory guarantee no longer rests on that flag, and the gate it
does rest on goes red the moment it is disabled. Reverted, `cmp` clean.

### New / changed assertions

- `pins the MEMORY gate on the report-explosion artefact with the wall backstop lifted
  (deterministic)` — reason, `bound`, `measured >= 512`, `measured < 640` (the overshoot
  is bounded), and `cpuMs < cookParseCpuMs` so it cannot be the CPU gate in disguise.
- an RSS-headroom assertion on **both** worst-legitimate shapes
  (`cookParseLastRssMbForTests() < cookParseRssMb * 0.6`; measured 120 and 163 of 512).
- `names the V8 old-space flag for what it sets, and the memory bound for what it bounds`
  — `cookParseRssMb` present, `cookParseHeapMb` **absent**, `cookParseRssMb >
  cookParseOldSpaceMb` (so `pool-heap` is not dead by construction), and the transient
  arithmetic `poolSize x rssMb === 1024` stated as an assertion.
- the hostile sweep gained a `pool-rss` branch (`entry.kills` must be `balloons`), plus
  "both measured axes are non-null on every bound hit" and "no reported RSS above the
  budget without `pool-rss`".
- the log-shape test now asserts `rssMb` travels on a **CPU** bound hit and is below the
  memory budget (H1 is flat at 84 MB, which is *why* the CPU gate is what refuses it).

---

## Blocker 2 — the stale hand-written `REALISTIC` fixture

### What was actually wrong

`pool.test.ts:92` held a hand-written `.cook` literal whose frontmatter was unquoted
(`title: Weeknight Tomato Pasta`). Task 3's H1 root fix (`5cdfc8aa`) made every
non-numeric frontmatter value quoted **unconditionally** on both sides of the contract,
so from that commit on `findCookSourceDefect` refuses that literal with
`{"defect":"frontmatter-value","offset":11}` in ~1 ms. It survived because `parseInPool`
sits **below** the recognizer — the ~15 assertions that lean on `REALISTIC` (the
read-path latency alarm, "a real recipe round-trips through the process boundary", every
`warmToExactlyOneChild()`, the laziness and pool-size assertions, `scale` forwarding, the
recovery-after-retire assertions) were exercising a source no norish serializer could
have written.

### The root fix

The same one applied in `1ec0a521` (§16): **mint it from the real serializer, never
hand-write a `.cook` literal.** `REALISTIC_RECIPE` is now a `StructuredRecipe` and
`REALISTIC = structuredToCooklang(REALISTIC_RECIPE, units)`. Blank-line separation,
section headings and timer placement are the serializer's, not the test's.

Minted output: **486 bytes**, `findCookSourceDefect` → `null`, frontmatter
`title: "Weeknight Tomato Pasta"` / `servings: 4` / `norish.system: "metric"`,
**five** content steps, `[0].section === "Prep"`, `[4].section === "Finish"`.

### Verification that the ~15 assertions now test what their names claim

Every pre-existing assertion holds **unchanged** against the minted source, which is the
point: the fixture was always *meant* to be serializer output.

| assertion | now genuinely tests |
|---|---|
| `spawns exactly one child on the first parse, and never exceeds the pool size` | laziness + pool size on a real serializer-shaped recipe |
| `produces a CookTokensSchema-valid DTO for a realistic recipe` | 5 steps, sections `Prep`/`Finish`, **plus newly-pinned parsed content**: `spaghetti 400 gram`, `olive oil 2 tablespoon`, the `1 minutes` timer — values that exist only because the WASM in the child derived them |
| `each committed fixture completes in under 50 ms once the pool is warm` | warm-up now warms on a source the read path would accept |
| `a warm round trip costs bounded CPU and has a bounded FLOOR` | the R2 latency alarm measures the real read-path shape (parent CPU, child CPU, fastest-of-100) |
| `forwards scale to the WASM` | unchanged (its own inline source was already recognizer-clean) |
| `warmToExactlyOneChild()` x 2 (`retires the exact pid…`, `survives a child killed EXTERNALLY…`) | the "known good" parse that establishes exactly one child is a real recipe |
| `leaves the PARENT process alive…` final recovery parse, `SATURATION…` recovery parse, `A CHILD THAT WILL NOT SPAWN…` | the recovery/degradation checks use a source the door would accept |

**New guard, so it cannot rot silently again** — declared before its consumers:
`the REALISTIC fixture is a source the real recognizer accepts (not just one the pool
tolerates)` asserts `findCookSourceDefect(REALISTIC) === null`, asserts the emitter's own
quoted frontmatter prefix, and asserts the byte size is still a real-recipe size class.
Since blocker 4, `REALISTIC` additionally goes through `parseInPool` — the guarded door —
so a rotted fixture would *also* fail everywhere rather than pass below the recognizer.

`pool.test.ts`: 36 → **38** tests at this commit.

---

## Blocker 3 — two vacuous assertions

### 3a. `limits.test.ts` — the ten accepted hostile-corpus rows

**What was wrong.** They asserted only `expect(poolSpy).toHaveBeenCalledTimes(1)`; the
structural check sat behind `if (result !== null)`. A child that fails to spawn also
resolves `null`, so a silent spawn failure passed all ten.

**Root fix.** `refused: boolean` → `outcome: "refused" | "tokens" | "no-steps"`, and each
accepted row now asserts unconditionally:

1. the pool was asked **exactly once** *and with the whole source*
   (`toHaveBeenCalledWith(Buffer.byteLength(source, "utf8"))` — "was called" cannot tell
   a full parse from a truncated one);
2. the pool **answered** rather than degraded — none of `pool-cpu`, `pool-rss`,
   `pool-timeout`, `pool-heap`, `pool-crash`, `pool-bad-envelope`, `pool-saturated`,
   `pool-spawn-failed` was logged;
3. a non-null, `CookTokensSchema`-valid, **non-empty** token stream.

**A case the boolean could not express, found by probing every accepted row through the
real pool:** `atCap("== h ==\n")` — 8 192 section headings and nothing else — is accepted
by the recognizer, crosses the process boundary, parses cleanly (135 ms) and still
resolves `null`, because it describes **zero steps**. That is now the named `no-steps`
outcome instead of being absorbed by the `if`. The other nine all return a 1-step token
stream (43 690 / 16 384 / 14 562 / 1 tokens depending on the shape).

### 3b. `attach-tokens.test.ts` — the spawn-failure case

**What was wrong.** `expect(result.cookTokens).toBeNull()` cannot distinguish a clean
`pool-spawn-failed` from a bound hit, a crash, a recognizer refusal, or a
`withCookTokens` that stopped parsing altogether.

**Root fix.** An `errorSpy` was added to the logger mock and the case now asserts:
`reason: "pool-spawn-failed"` at **ERROR** level; **no** bound reason
(`pool-cpu`/`pool-timeout`/`pool-heap`/`pool-crash`) logged; `withCookTokens`'s own
`stored-source-did-not-parse` warn fired; the row passes through intact (`id`, `name`,
`cookSource`); and it degraded at the door rather than hanging
(`elapsed < cookParseQueueTimeoutMs + 2 000`). The input stays `VALID_COOK`, which the
recognizer accepts, so the only honest reason for a `null` is that no child could be had.

### Non-vacuity proven (§15.1 protocol) — weakening V3-W1

`pool.ts`: `child = fork(`${resolveWorkerEntry()}.WEAKENED`, [], {` — i.e. a silent spawn
failure, exactly the failure mode blocker 3 named.

- **With the fixed assertions: 28 RED**, including **all ten** accepted corpus rows —
  `neither throws nor exceeds 2000 ms on …` × {one 60 000-byte token with no whitespace ·
  deeply repeated section headings · well-formed cookware at maximum density ·
  well-formed timers at maximum density · well-formed ingredients at maximum density (the
  worst ACCEPTED shape) · astral-plane characters · combining marks · embedded NUL bytes ·
  lone surrogates · escaped prose at maximum density (every metacharacter, ACCEPTED)} —
  plus `control: the pool spy is provably WIRED`, `does NOT refuse ordinary US shorthand
  once the serializer has escaped it`, `the `unreachable` trap is contained by the child
  process, with the recognizer bypassed`, `accepts a title made entirely of the two
  characters quoting must escape` and all 14 `still mints: …` rows.
- **With the PRE-fix assertions restored (`git show HEAD:…`) and the same weakening still
  applied: 18 RED, and NOT ONE of the ten.** That is the defect, demonstrated rather than
  argued.

Reverted by reverse edit: md5 `c50b94a13b178ed07c6b14bf4dbc549e` on the workspace file
**and** its `node_modules/@norish` hardlink twin, `cmp` clean, `git diff --exit-code`
empty. Never committed.

---

## Blocker 4 — `parseInPool` was an unenforced third door

### What was actually wrong

`parseInPool` reaches the WASM. It was a **public subpath** (`"./cooklang/pool"` in
`packages/shared-server/package.json`), carried **no byte cap and no recognizer of its
own**, and the "only `./parse` may call this" rule lived in a docblock. The static
one-importer assertion covers `@cooklang/cooklang`, not this specifier, so a second
caller in `@norish/api` / `@norish/queue` / `@norish/trpc` / `apps/web` would have reached
the parser with neither gate in front of it and **nothing would have gone red**.

### The root fix — D-27-W3B-15, three independent parts

**1. The subpath is gone.** Nothing outside `@norish/shared-server` can import the module
at all. The single external consumer,
`packages/trpc/__tests__/recipes/shares.test.ts`, needs only `shutdownCookParsePool`
(vitest will not exit while a child lives), which is a **lifecycle** concern, not a
parsing one — so `./cooklang/parse` re-exports it. A suite gets the teardown without
`parseInPool` coming along.

**2. The door enforces its own preconditions.** A private `boundedParse` applies
`COOK_LIMITS.maxCookSourceBytes` to **every** entry; `parseInPool` additionally applies
`findCookSourceDefect`. Both refuse at **ERROR** level with `door: "pool"`, because
reaching either means a caller came in around `./parse`. On the shipped path neither ever
fires — this is the same deliberate double-check `build-payload.ts` already performs
against `parseCookSource` (see its own comment at gate 2 of 3).

**3. The caller list is pinned by static assertions that walk the real tree**, in the
style of the existing one-importer sweep:

- `is NOT an exported subpath of @norish/shared-server` — reads `package.json` and asserts
  `./cooklang/pool` absent, `./cooklang/parse` present;
- `names every PRODUCTION file that imports the pool module` — exactly
  `["packages/shared-server/src/cooklang/parse.ts"]`;
- `names every TEST file that imports the pool module, and none is outside this package`
  — the seven cooklang suites, each asserted to start with `packages/shared-server/`;
- `names every caller of the below-the-recognizer entry, each with a stated reason` — its
  declaration is the only production occurrence; the callers are exactly
  `limits.test.ts` and `pool.test.ts`, justified inline;
- `refuses a source the recognizer rejects, and one over the byte cap, without spawning`
  — behavioural, on the function itself, and it asserts **no child was spawned** for
  either refusal (`cookParsePoolPidsForTests()` unchanged).

The three walkers were de-duplicated into module-level `repoFiles(kind)` /
`filesMatching(kind, pattern)` helpers so the pool sweep and the WASM sweep cannot drift
apart.

### The bound-only methodology is preserved — and made visible

`pool.test.ts` and `limits.test.ts` must drive hostile sources **past** the recognizer: a
bound proven only on inputs the recognizer already refuses proves nothing about the bound,
and conflating the two is exactly how round 2 shipped a recognizer as if it were a
guarantee. They now call **`parseInPoolBelowTheRecognizerForTests`**, which

- names the gate it skips, so a second caller is unmissable in review;
- still applies the byte cap and all four resource bounds;
- has its caller list pinned to those two files by its own static assertion;
- is unreachable from outside the package, because the subpath is gone.

Nine call sites in `pool.test.ts` (the hostile sweep, the parent-alive loop, the
deterministic CPU-gate and memory-gate tests, terminate-and-replace, the external-kill
case, saturation x2, the log-shape test) and two in `limits.test.ts` (the three H2
`RuntimeError: unreachable` trap shapes plus its recovery parse) moved to it. Every
**legitimate** source in those files now goes through the real guarded door, which is
strictly more coverage than before.

### Decision recorded: why the recognizer is enforced at the door *and* in `./parse`

The recognizer runs twice on the read path. That is deliberate:

- Moving it *down* into `parseInPool` and deleting it from `./parse` would destroy the
  `poolSpy` "**THE POOL WAS NEVER ASKED**" proof (D-27-W3B-12) that ~30 assertions in
  `limits.test.ts` rest on — a refused source must not cross the process boundary at all,
  and that is only observable if the refusal happens above the pool.
- Leaving it out of the door entirely is the blocker.
- So both, and the cost is measured: `findCookSourceDefect` is a single left-to-right pass
  over at most 64 KiB, and the read-path latency alarm (parent CPU ≤ 4 ms per warm round
  trip, measured 1.087 ms) stays green with the second pass in place on the 486 B
  `REALISTIC` shape.

### Mutation evidence

Each executed, proven RED, reverted by reverse edit, never committed.

| # | the exact edit | RED |
|---|---|---|
| **V3-W3** | `pool.ts`: `if (false && defect) {` in `parseInPool` | **1** — `refuses a source the recognizer rejects, and one over the byte cap, without spawning` (1 562 ms: it waits out the H1 parse) |
| **V3-W4** | `pool.ts`: `if (false && bytes > COOK_LIMITS.maxCookSourceBytes) {` in `boundedParse` | **1** — the same test, on its byte-cap half (409 ms) |
| **V3-W5** | `package.json`: re-add `"./cooklang/pool": "./src/cooklang/pool.ts"` | **1** — `is NOT an exported subpath of @norish/shared-server` |

Reverts verified: `pool.ts` md5 `365c65fe9ac25ae02211438824098674` and `package.json` md5
`b020fc53cfa91b6ffd73b5aa25ce286d`, each matching on **both** the workspace file and its
`node_modules/@norish` hardlink twin, `cmp` clean against a pre-edit copy.

### One out-of-scope edit, declared

`apps/web/tsdown.config.ts` — **comment only**. Its docblock named
`@norish/shared-server/cooklang/pool` as what `noExternal` inlines, which is no longer a
resolvable specifier; it now names `./cooklang/parse` as the door the pool is pulled in
through. No config value changed; `build:server` re-run after the edit (EXIT 0,
`parse-worker.mjs` emitted).

---

## Gates — real numbers

| gate | baseline | result |
|---|---|---|
| `tsc --noEmit -p packages/shared-server/tsconfig.json` | EXIT 0 | **EXIT 0**, zero output (redirected to a file; `tsc \| head` lies) |
| `tsc --noEmit -p` shared / trpc / api / queue / db | EXIT 0 | **EXIT 0 all five**, zero output |
| `@norish/shared-server` test, FULL run | 546 | **554 passed / 22 files** (+8), **three consecutive full runs green** — the contention-sensitive assertions (the R2 latency alarm, the deterministic CPU and memory gates, the spinner contention test) held every time |
| cooklang suites only | 331 | **339 passed / 7 files** (+8) |
| `@norish/trpc` test | 337 | **337 passed / 32 files** |
| `@norish/shared` test | 319 | **319 passed / 15 files** |
| `@norish/api` test | 408 | **408 passed / 30 files** |
| `@norish/queue` test | 121 | **123 passed / 18 files** (+2 from the other stream's blocker-5/6 fix) |
| eslint shared-server / trpc / api / queue (whole package) | 0 errors | **0 errors** each; **0 warnings from any cooklang file** |
| `tooling/monorepo/scripts/check-workspace-imports.mjs` | EXIT 0 | **EXIT 0** — "No workspace import issues found." |
| `pnpm --filter @norish/web build:server` | EXIT 0 | **EXIT 0**, `dist-server/parse-worker.mjs` emitted (**6 942 B**) |
| `git diff pnpm-lock.yaml` | empty | **empty** |
| `packages/db/src/migrations/` + `meta/_journal.json` | untouched, 42 entries | **untouched, 42 entries** |
| `as any` / `@ts-ignore` / `@ts-expect-error` added | none | **none** (grep over the full diff `9100e0de..HEAD`) |

**Not run, and why:** `@norish/db`'s suite needs `sg docker` and a container; I touched no
file in `packages/db` (the concurrent stream owns `recipes.ts`). `pnpm docker:build` is
the director's job per `CLAUDE.md`.

**Pre-existing red, NOT caused by this work:** `prettier --check` fails on
`packages/shared-server/src/cooklang/{pool,parse}.ts`,
`__tests__/cooklang/{pool,limits,attach-tokens,build-payload,parse,round-trip-fidelity}.test.ts`
and `apps/web/tsdown.config.ts`. Verified pre-existing by extracting each file's `HEAD`
content into a probe beside the original (so prettier resolves the same config) and
re-checking: every one of them was already non-conformant, and `build-payload.test.ts` /
`parse.test.ts` / `round-trip-fidelity.test.ts` are files this work never touched. The
enforced gate in this repo's scripts is eslint, which is clean. Reformatting these files
would produce a large unrelated diff; flagged for the director rather than done here.

---

## Things the director should know

1. **The container sizing number changed, and it went UP.** Worst-case transient for the
   parse pool is now **~1 102 MB** (`2 x (512 + 39)`), stated honestly, against the
   "~628 MB" that was recorded before and the ~1.8 GB that was actually true. It is the
   first time this figure has been a *bound* rather than an estimate. If 1 GB of transient
   is unacceptable on LXC 110 (5 GB total, ~1.4 GB available while I measured), the lever
   is `NORISH_COOK_PARSE_RSS_MB` — but it must not go below ~350 MB without re-measuring,
   because the child's idle plateau alone is 175.2 MB and the worst legitimate single
   parse peaks at 152.9 MB.
2. **`pool-rss` is the new reason to watch, and it should be the common hostile outcome.**
   On this box the two ballooning families are now refused as `pool-rss` at ~640-744 ms of
   child CPU rather than as `pool-cpu` at 1 500 ms — i.e. a hostile row is killed roughly
   twice as fast as before. `pool-cpu` remains the reason for the H1 recursion family,
   which runs at a flat 84 MB. `pool-heap` should now be effectively unreachable: read
   `rssMb` beside every reason.
3. **`cookParseOldSpaceMb` has no teeth in the suite and cannot have** — `execArgv: []`
   still leaves 334/334 green, re-verified. That is stated in `limits.ts` as the expected
   consequence of the RSS gate firing first, not hidden. If someone wants a test with
   teeth on it, it would need `NORISH_COOK_PARSE_RSS_MB` raised past ~2.3 GB in that test,
   which would allocate 2.3 GB on a 5 GB box; I judged that a worse trade than stating the
   limitation.
4. **`@a{1/0%g}` / `@a{0/0%g}` (VERIFY-3's "minor, also open") is still open.** Out of
   scope for blockers 1-4; unchanged by this work.
5. **The `27-04-SUMMARY.md` rows for blocker 1** (§0's last row, §3, §11, §13.3, §15.6)
   are now superseded by D-27-W3B-14 and the numbers above. I did **not** edit
   `27-04-SUMMARY.md` as instructed; the director consolidates.

---

*Phase 27-cooklang — plan 27-04, VERIFY-3 blockers 1-4. Written 2026-07-26 on LXC 110.*
