import type { UnitsMap } from "@norish/config/zod/server-config";
import type {
  CookStepTokensDTO,
  CookTokenDTO,
  CookTokensDTO,
} from "@norish/shared/contracts/dto/recipe";
// TYPE-ONLY, and it must stay that way: a VALUE import of the child entry would
// pull `@cooklang/cooklang` into the parent bundle and break the one-importer
// invariant this whole design rests on. Type imports are fully erased.
import type {
  CookParseRequest,
  CookParseResponse,
  RawCookStepTokens,
} from "./parse-worker";

import { fork, type ChildProcess } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, extname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { normalizeUnit } from "@norish/shared/lib/unit-localization";

import { parserLogger as log } from "../logger";

import { COOK_BOUNDS, COOK_LIMITS, findCookSourceDefect } from "./limits";

/**
 * THE RESOURCE BOUND ON THE WASM PARSE (Phase 27, W3B — T-27-01).
 *
 * WHAT THIS MODULE IS FOR, IN ONE SENTENCE: it makes the guarantee on
 * `@cooklang/cooklang` a REAL RESOURCE BOUND instead of a claim about the shape
 * of the input.
 *
 * WHY THAT MATTERS ENOUGH TO ADD A PROCESS BOUNDARY. T-27-01 was mitigated twice
 * by trying to recognize hostile input, and REFUTED twice:
 *  - round 1 predicted which tokens the parser would object to
 *    (`maxCookMalformedTokens`). Bypassed by `@a{1%}` (closes its brace, scored
 *    ZERO malformed, ~10 s parse, 143.7 MB report) AND it falsely refused an
 *    ordinary 536-byte pot roast that the real parser handled in 13 ms;
 *  - round 2 asserted the serializer's own output grammar
 *    (`findCookSourceDefect`). Bypassed by an unconstrained FRONTMATTER
 *    recognizer: `---\na: ${"[".repeat(65400)}\n---\nstep\n` parsed for
 *    **24 557 / 38 511 ms**.
 *
 * Three rounds of "make the recognizer complete" each found a sub-grammar the
 * last did not know about, because the parser's failure modes are unbounded:
 * quadratic diagnostics (839 MB out of an 8 KiB input), YAML recursion blowups,
 * and `RuntimeError: unreachable` on NINE BYTES. So the parse itself is bounded,
 * and recognizer completeness stops being load-bearing.
 *
 * THE PRIMARY GATE IS THE CHILD'S CPU TIME, NOT WALL CLOCK (D-27-W3B-03a,
 * superseding D-27-W3B-03). This is the part most likely to be "simplified" back
 * into a bug, so the reason is stated here as well as in `./limits`:
 *
 *  - A wall-clock bound CONFLATES THE THREAT WITH UNRELATED HOST LOAD. The
 *    original 1 000 ms wall-clock bound was set deliberately above the worst
 *    legitimate shapes (648 / 694 ms idle) and was then MEASURED to refuse those
 *    same shapes at 1 137 / 1 238 ms in the full shared-server run, because wall
 *    clock inflates under contention while the work performed does not. Pinning the
 *    child and ten spinners to one core inflated wall clock **7.5x-11.6x** while the
 *    child's CPU cost stayed flat within **±3%**. Every point on the wall-clock axis
 *    is wrong on some box; CPU time is the axis the threat actually lives on.
 *  - THE CHILD CANNOT SELF-POLICE. `parser.parse()` is one synchronous WASM call;
 *    it can never check a timer. That is the whole reason for this pivot. So the
 *    PARENT samples `/proc/<pid>/schedstat` every `cookParseCpuPollMs` and
 *    `SIGKILL`s the child once `cookParseCpuMs` is spent. `SIGKILL` needs no
 *    cooperation from V8 and none from the WASM, which is what makes it trustworthy.
 *
 * THE MEMORY BOUND IS THE CHILD'S RSS, NOT `--max-old-space-size` (D-27-W3B-14,
 * superseding the memory half of D-27-W3B-03). This module used to claim that a
 * 256 MB `--max-old-space-size` "catches the report-explosion family's 839 MB-1.65
 * GB balloon". It does not: that flag caps V8's OLD GENERATION, and the parser
 * allocates in WASM LINEAR MEMORY, which the flag has no authority over. A child
 * forked exactly as `spawnChild` forks one measured **899 MB of RSS at the instant
 * the 1 500 ms CPU gate fired** and **2 273 MB** if left to run — and dropping the
 * flag entirely (`execArgv: []`) left the whole cooklang suite green, so the bound
 * had no teeth either. The parent therefore samples the child's `VmRSS` from
 * `/proc/<pid>/status` on the SAME poll as the CPU counter and `SIGKILL`s the child
 * on a REAL, MEASURED resident-set budget. See `./limits` for the calibration.
 *
 * FOUR BOUNDS, NONE REDUNDANT:
 *  - `cookParseCpuMs` (1 500 ms of the CHILD's CPU) — the computation bound. Kills
 *    H1's frontmatter recursion, which burns 22 759 ms of CPU at a FLAT 6 MB and is
 *    therefore invisible to every memory bound there is.
 *  - `cookParseRssMb` (512 MB of the CHILD's resident set) — the memory bound. It
 *    is what actually stops the ballooning families: `"#" x 8192` and the round-1
 *    bypass cross it at 630 ms / 642 ms of child CPU, well before the CPU gate.
 *  - `cookParseWallCeilingMs` (8 000 ms) — a BACKSTOP for a child stuck WITHOUT
 *    burning CPU (a hang, a lost IPC reply), which the CPU gate cannot see because
 *    the counter does not advance. Deliberately generous: a blocked-but-idle child
 *    is not a DoS amplifier, it just occupies one pool slot, and
 *    `cookParseQueueTimeoutMs` plus terminate-and-replace already handle that.
 *  - `cookParseOldSpaceMb` (256 MB), the child's own `--max-old-space-size`. V8's
 *    old generation ONLY. Kept as a second line — an old-space OOM aborts the child
 *    (`SIGABRT`, parent alive) — and no longer billed as the memory bound.
 *
 * WHY A CHILD PROCESS AND NOT `worker_threads` + `resourceLimits`. Measured, not
 * assumed: `maxOldGenerationSizeMb: 64` on the round-1 bypass payload produced
 * `FATAL ERROR: Reached heap limit` -> `v8::internal::V8::FatalProcessOutOfMemory`
 * inside `Builtin_JsonParse` and **ABORTED THE ENTIRE NODE PROCESS** — the parent
 * did not survive. The WASM binding returns its result as a JSON string and that
 * allocation happens in a V8 builtin, where V8 cannot unwind to the graceful
 * per-worker OOM path. A memory bound that kills the web server is a larger
 * incident than the one it prevents. The same payload against a child process
 * exits `SIGABRT` with the parent alive. DO NOT "simplify" this to a worker
 * thread; see D-27-W3B-02.
 *
 * WHY POOLED AND NOT ONE ISOLATE PER PARSE. A fresh isolate per parse would be
 * immune to poisoning but costs ~150 ms (`fork` -> import -> parse -> reply),
 * ~120x the pooled round trip, on every recipe fetch. Pooled measures p50
 * 0.965 ms / p95 1.506 ms — at p95 FASTER than today's in-process parse
 * (3.097 ms), because the parse no longer shares a heap or a GC with the
 * request-serving event loop.
 *
 * FAILURE IS FREE FOR THE USER — THE NEVER-BROKEN GUARANTEE. Every failure mode
 * here (CPU gate, RSS gate, wall backstop, old-space abort, crash, WASM trap,
 * malformed envelope, a child that will not spawn, a saturated pool) resolves
 * `null`. `null` means no `cook`
 * argument, so the FULL legacy projection is written and the import SUCCEEDS; on
 * the read path it means `cookTokens: null` and the legacy render. This function
 * NEVER throws and NEVER hangs.
 *
 * LOGS CARRY COUNTS, CODES AND A PID — NEVER RECIPE PROSE (T-27-05). The child's
 * stdout and stderr are DISCARDED rather than piped: a WASM panic writes to
 * stderr, and nothing the child prints may reach a shared log stream.
 */

/** A child that has hit a bound, crashed or misbehaved is never reused. */
type RetireReason =
  | "pool-cpu"
  /** The parent measured the child's RSS past `cookParseRssMb` and killed it. */
  | "pool-rss"
  | "pool-timeout"
  /** The child aborted itself on a V8 OLD-SPACE OOM (`cookParseOldSpaceMb`). */
  | "pool-heap"
  | "pool-crash"
  | "pool-bad-envelope"
  | "pool-shutdown";

type Outcome =
  | { ok: true; steps: RawCookStepTokens[]; reportEmpty: boolean }
  | { ok: false; reason: "parse-threw"; error: string }
  | {
      ok: false;
      reason: RetireReason | "pool-saturated" | "pool-spawn-failed";
      elapsedMs: number;
      /**
       * The child's CPU cost as last sampled, or `null` when it could not be read
       * (a pid that is already gone, or a host without `/proc/<pid>/schedstat`).
       */
      cpuMs: number | null;
      /**
       * The child's RESIDENT SET as last sampled, in MB, or `null` when it could
       * not be read (a pid that is already gone, or a host without
       * `/proc/<pid>/status`).
       */
      rssMb: number | null;
    };

type InFlight = {
  id: number;
  startedAt: number;
  /** Cancels BOTH the CPU poll and the wall-clock backstop. */
  stopTimers: () => void;
  settle: (outcome: Outcome) => void;
};

type PoolChild = {
  child: ChildProcess;
  pid: number;
  busy: boolean;
  ready: boolean;
  retired: boolean;
  readyWaiters: (() => void)[];
  inFlight: InFlight | null;
};

type Waiter = {
  settled: boolean;
  timer: NodeJS.Timeout;
  resolve: (result: PoolChild | "pool-saturated" | "pool-spawn-failed") => void;
};

let children: PoolChild[] = [];
let waiters: Waiter[] = [];
let nextRequestId = 1;
/** The CPU cost of the most recent parse that ran long enough to be sampled. */
let lastSampledCpuMs: number | null = null;
/** The child RSS of the most recent parse that ran long enough to be sampled. */
let lastSampledRssMb: number | null = null;

/**
 * THE PRIMARY GATE'S MEASUREMENT: how much CPU this child has consumed, in ms.
 *
 * `/proc/<pid>/schedstat` field 1 is the task's `sum_exec_runtime` IN NANOSECONDS.
 * It was chosen over `/proc/<pid>/stat`'s `utime`+`stime` after measuring both, for
 * three reasons:
 *
 *  1. RESOLUTION. `schedstat` is nanoseconds. `utime`/`stime` are USER_HZ clock
 *     ticks — 10 ms granularity — and would additionally require assuming
 *     `sysconf(_SC_CLK_TCK)`, which Node exposes nowhere.
 *  2. IT MEASURES THE THREAT AND NOTHING ELSE. `schedstat` reports the MAIN
 *     THREAD, which is exactly where 100% of the hostile computation lives:
 *     `parser.parse()` is one synchronous, single-threaded WASM call, and so is
 *     the `JSON.parse` of its report. `utime`+`stime` aggregate the whole thread
 *     group, so they also charge V8's PARALLEL GC helper threads — measured at
 *     **690 ms against a 346 ms main thread** for one and the same 64 KiB parse.
 *     That makes the thread-group figure a function of how many cores happen to be
 *     free, which is the very coupling this decision exists to remove.
 *  3. IT IS THE STABLE FIGURE. Across an 11.6x wall-clock inflation the main-thread
 *     figure moved by ±3%.
 *
 * The helper-thread CPU that this therefore does NOT count was measured at
 * <=0.6x of the main-thread figure on every shape probed (hostile shapes: 0.003x,
 * 0.04x, 0.06x), so the child's TOTAL CPU is bounded at roughly
 * `1.6 x cookParseCpuMs`, and `cookParseRssMb` independently caps the allocation
 * that drives GC work in the first place.
 *
 * RETURNS `null` RATHER THAN THROWING, and the caller then falls through to the
 * wall-clock backstop. Two ways that happens: the pid is already gone (a race with
 * the child exiting — expected and harmless), or the host has no
 * `/proc/<pid>/schedstat` at all. The latter is not Linux, so it is not production
 * (the deployed artefact is a Linux container on LXC 110); on such a host the parse
 * is bounded by `cookParseWallCeilingMs` and `cookParseOldSpaceMb` only, which is
 * strictly weaker and is stated rather than hidden.
 */
function readChildCpuMs(pid: number): number | null {
  try {
    const raw = readFileSync(`/proc/${pid}/schedstat`, "latin1");
    const end = raw.indexOf(" ");
    const nanoseconds = Number(end === -1 ? raw.trim() : raw.slice(0, end));

    return Number.isFinite(nanoseconds) ? nanoseconds / 1e6 : null;
  } catch {
    return null;
  }
}

/**
 * THE MEMORY BOUND'S MEASUREMENT: this child's RESIDENT SET, in MB
 * (D-27-W3B-14 — VERIFY-3 blocker 1).
 *
 * `/proc/<pid>/status`'s `VmRSS` line reports the resident set IN KILOBYTES.
 * `/proc/<pid>/statm` is cheaper (24.35 µs against 33.61 µs, 20 000 iterations
 * warm) but reports PAGES, and converting pages to bytes means assuming
 * `sysconf(_SC_PAGESIZE)` — a value **Node exposes nowhere**, and 4 KiB is not
 * universal (arm64 ships 16 KiB and 64 KiB kernels). That is exactly the assumption
 * D-27-W3B-03a refused to make about `sysconf(_SC_CLK_TCK)` when it chose
 * `schedstat` over `utime`+`stime`, and a silently 16x-wrong memory bound is a
 * worse outcome than 9 µs. `VmRSS` needs no such assumption.
 *
 * WHY RSS AND NOT `--max-old-space-size`. That flag caps V8's OLD GENERATION. The
 * WASM parser allocates in LINEAR MEMORY, which the flag does not govern, so a
 * `--max-old-space-size=256` child was measured at **899 MB of RSS at the instant
 * the CPU gate fired** and **2 273 MB** unbounded. RSS is the number the OOM killer
 * and the container limit act on, it covers linear memory, V8's heap, the returned
 * JSON string and the binary, and — like the CPU counter, and unlike wall clock —
 * it is a function of the work performed rather than of host load.
 *
 * ABSOLUTE, NOT A DELTA FROM THE START OF THE PARSE. A delta would measure "growth
 * caused by this parse" and would let a child that has already drifted high stay
 * there; the container sees the absolute figure. The drift is bounded and was
 * MEASURED to a plateau rather than assumed: a fresh child sits at 73.5 MB, and
 * after 1 050 heavy parses (25 x 64 KiB `@a{1%g} ` + 25 x `"#p " x 21845` + 100
 * realistic, twelve times over) it plateaus at 175.2 MB — WASM linear memory is
 * never returned to the OS, so the floor is permanent but flat. `cookParseRssMb`
 * is calibrated against that plateau, not against a fresh child.
 *
 * `null` RATHER THAN A THROW, exactly as `readChildCpuMs`: a pid already gone, or a
 * host with no `/proc/<pid>/status`. On such a host this bound is simply absent and
 * `cookParseOldSpaceMb` plus the CPU gate carry it, which is strictly weaker and is
 * stated rather than hidden. Production is a Linux container on LXC 110.
 */
function readChildRssMb(pid: number): number | null {
  try {
    const raw = readFileSync(`/proc/${pid}/status`, "latin1");
    const at = raw.indexOf("\nVmRSS:");

    if (at < 0) return null;

    const end = raw.indexOf(" kB", at);

    if (end < 0) return null;

    const kilobytes = Number(raw.slice(at + "\nVmRSS:".length, end).trim());

    return Number.isFinite(kilobytes) ? kilobytes / 1_024 : null;
  } catch {
    return null;
  }
}

/**
 * Where the child entry lives: the SIBLING of this module, with the extension
 * matching this module's own (D-27-W3B-09).
 *
 * That one rule covers both worlds. In dev and vitest this file is
 * `.../src/cooklang/pool.ts`, so the sibling is `parse-worker.ts` and Node 22
 * strips its types on load. In production `apps/web/tsdown.config.ts` has
 * `noExternal: [/^@norish\//]`, so THIS FILE IS INLINED INTO
 * `dist-server/index.mjs` — `import.meta.url` is the bundle's URL and the sibling
 * rule lands on `dist-server/parse-worker.mjs`, which is emitted because the child
 * entry is an explicit, NAMED tsdown entry.
 *
 * THE EXTENSION IS TAKEN FROM THIS FILE, NOT ASSUMED TO BE `.js`. tsdown emits
 * `.mjs`, so a hardcoded `.js` would resolve a path that does not exist — and
 * because a missing child degrades silently to `null`, that mistake would have
 * been invisible in production. It was caught only by listing `dist-server/`.
 *
 * THAT ENTRY IS A HARD BUILD GATE, NOT A CONVENTION. If the chunk were missing,
 * production would spawn nothing, resolve `null` on every parse, render every
 * recipe on the legacy path and emit NO error anyone would ever report — a
 * completely invisible failure (T-27-09). `apps/web/tsdown.config.ts` therefore
 * asserts the emitted file exists and FAILS THE BUILD if it does not.
 *
 * The env override is an operational escape hatch for exactly that failure, and
 * the seam the pool tests use to prove that a missing child costs the user
 * nothing. Production uses the sibling rule.
 */
function resolveWorkerEntry(): string {
  const override = process.env.NORISH_COOK_PARSE_WORKER_PATH;

  if (override !== undefined && override.trim() !== "") return override;

  const here = fileURLToPath(import.meta.url);

  return join(dirname(here), `parse-worker${extname(here) || ".js"}`);
}

function isReadyMessage(message: unknown): boolean {
  return (
    typeof message === "object" &&
    message !== null &&
    (message as { ready?: unknown }).ready === true
  );
}

function isParseResponse(message: unknown): message is CookParseResponse {
  if (typeof message !== "object" || message === null) return false;

  const candidate = message as Partial<CookParseResponse>;

  if (typeof candidate.id !== "number") return false;
  if (candidate.ok === true) return Array.isArray((candidate as { steps?: unknown }).steps);

  return candidate.ok === false && typeof (candidate as { error?: unknown }).error === "string";
}

/**
 * Terminate and replace, NEVER reuse (D-27-W3B-10). A compiled binary that has
 * just trapped, hit a bound or returned a shape we do not understand is not a
 * thing to keep serving requests from. The ~120 ms replacement cost is paid OFF
 * the request path: the request that triggered it has already been answered with
 * `null`.
 */
function retire(target: PoolChild, reason: RetireReason): void {
  if (target.retired) return;

  target.retired = true;
  children = children.filter((candidate) => candidate !== target);

  const flight = target.inFlight;

  if (flight) {
    flight.stopTimers();
    target.inFlight = null;
    flight.settle({
      ok: false,
      reason: reason === "pool-shutdown" ? "pool-crash" : reason,
      elapsedMs: Math.round(performance.now() - flight.startedAt),
      cpuMs: lastSampledCpuMs,
      rssMb: lastSampledRssMb,
    });
  }

  for (const wake of target.readyWaiters) wake();
  target.readyWaiters = [];

  try {
    target.child.kill("SIGKILL");
  } catch {
    // Already gone. `SIGKILL` on a dead pid is not an error condition here.
  }

  target.child.removeAllListeners();

  // PAY THE REPLACEMENT COST OFF THE REQUEST PATH (D-27-W3B-10). Spawning only on
  // the NEXT request would put the ~200 ms `fork` + WASM instantiation INSIDE that
  // request's budget, and under load that request degrades to `null` — it loses its
  // tokens because an unrelated earlier request hit a bound. Observed exactly that
  // way in the full shared-server run before this was added.
  //
  // ONLY REPLACE A CHILD THAT ACTUALLY WORKED. If a child never reported ready, its
  // entry is broken (a mis-packaged bundle, a deleted chunk), and eagerly replacing
  // it would spin-spawn processes forever against a permanent failure. `ready`
  // is therefore the circuit breaker: at most one replacement attempt, and a
  // permanently broken entry spawns twice and then stops.
  if (reason !== "pool-shutdown" && target.ready) {
    if (children.length < COOK_BOUNDS.cookParsePoolSize) spawnChild();
  }

  pump();
}

function spawnChild(): PoolChild | null {
  let child: ChildProcess;

  try {
    child = fork(resolveWorkerEntry(), [], {
      // V8's OLD-GENERATION cap, and NOTHING MORE (D-27-W3B-14). It is NOT the
      // memory bound — the parser allocates in WASM linear memory, which this flag
      // does not govern; `cookParseRssMb`, sampled by the parent, is the memory
      // bound. Kept because an old-space OOM aborts the child with the parent
      // alive. Passing `execArgv` explicitly also stops the parent's own flags
      // (vitest's, for instance) from leaking into the child.
      execArgv: [`--max-old-space-size=${COOK_BOUNDS.cookParseOldSpaceMb}`],
      // stdout and stderr are DISCARDED, not piped: a WASM panic writes to
      // stderr and nothing the child prints may reach a shared log stream
      // (T-27-05). `ipc` is the only channel.
      stdio: ["ignore", "ignore", "ignore", "ipc"],
      serialization: "json",
    });
  } catch (err) {
    log.error(
      { module: "cooklang", reason: "pool-spawn-failed", err },
      "Could not spawn the Cooklang parse child; keeping the legacy projection"
    );

    return null;
  }

  const entry: PoolChild = {
    child,
    pid: child.pid ?? -1,
    busy: false,
    ready: false,
    retired: false,
    readyWaiters: [],
    inFlight: null,
  };

  child.on("message", (message: unknown) => {
    if (isReadyMessage(message)) {
      entry.ready = true;

      for (const wake of entry.readyWaiters) wake();
      entry.readyWaiters = [];

      return;
    }

    const flight = entry.inFlight;

    if (!isParseResponse(message)) {
      // A shape we do not understand from a process that runs a compiled binary.
      retire(entry, "pool-bad-envelope");

      return;
    }

    // A late reply to a request already settled by the bound. Its child is
    // retired by then, so this cannot be mistaken for the current request.
    if (!flight || flight.id !== message.id) return;

    flight.stopTimers();
    entry.inFlight = null;

    flight.settle(
      message.ok
        ? { ok: true, steps: message.steps, reportEmpty: message.reportEmpty }
        : { ok: false, reason: "parse-threw", error: message.error }
    );
  });

  child.on("error", () => {
    // Covers a failed spawn that surfaces asynchronously and a broken channel.
    retire(entry, "pool-crash");
  });

  child.on("exit", (code, signal) => {
    // A V8 fatal OLD-SPACE OOM aborts: `code=null signal=SIGABRT` (measured), or
    // exit 134 where the signal is not reported. That is `cookParseOldSpaceMb`
    // doing its job — the second line, not the memory bound (D-27-W3B-14).
    const heap = signal === "SIGABRT" || code === 134;

    retire(entry, heap ? "pool-heap" : "pool-crash");
  });

  // The pool must not hold the event loop open on its own account: a leaked child
  // would hang a vitest run or a container stop. Safe because every state in
  // which the pool is WAITING for this child also has an active timer of its own
  // (the ready wait and the parse bound), which keeps the loop alive exactly as
  // long as it needs to be.
  child.unref();
  child.channel?.unref();

  children.push(entry);

  return entry;
}

function takeIdleChild(): PoolChild | "no-capacity" | "pool-spawn-failed" {
  for (const candidate of children) {
    if (!candidate.busy && !candidate.retired) {
      candidate.busy = true;

      return candidate;
    }
  }

  // LAZY: nothing is spawned until a parse actually asks for it, so a process
  // that never reads or writes a `.cook` pays nothing.
  if (children.length < COOK_BOUNDS.cookParsePoolSize) {
    const spawned = spawnChild();

    if (!spawned) return "pool-spawn-failed";

    spawned.busy = true;

    return spawned;
  }

  return "no-capacity";
}

/** Hand freed or newly spawnable children to whoever is queued. */
function pump(): void {
  while (waiters.length > 0) {
    const next = waiters[0];

    if (!next) return;

    if (next.settled) {
      waiters.shift();
      continue;
    }

    const taken = takeIdleChild();

    if (taken === "no-capacity") return;

    waiters.shift();
    next.settled = true;
    clearTimeout(next.timer);
    next.resolve(taken);
  }
}

function release(target: PoolChild): void {
  if (!target.retired) target.busy = false;

  pump();
}

/**
 * Get a child, or degrade. BOUNDED REQUEST QUEUE (D-27-W3B-10): a request that
 * cannot get a child within `cookParseQueueTimeoutMs` resolves rather than
 * queueing without limit, so saturation degrades to the legacy render and never
 * hangs a request and never grows unboundedly.
 */
function acquire(): Promise<PoolChild | "pool-saturated" | "pool-spawn-failed"> {
  const direct = takeIdleChild();

  if (direct !== "no-capacity") return Promise.resolve(direct);

  return new Promise((resolve) => {
    const waiter: Waiter = {
      settled: false,
      resolve,
      timer: setTimeout(() => {
        if (waiter.settled) return;

        waiter.settled = true;
        waiters = waiters.filter((candidate) => candidate !== waiter);
        resolve("pool-saturated");
      }, COOK_BOUNDS.cookParseQueueTimeoutMs),
    };

    waiters.push(waiter);
  });
}

/**
 * Wait for the warm-up handshake.
 *
 * "Getting a usable child" is queue time; only the parse itself is charged against
 * `cookParseTimeoutMs`, so a cold parse never eats into the parse bound.
 *
 * WHY THIS BUDGET IS NOT `cookParseQueueTimeoutMs` ALONE. Waiting for a COLD SPAWN
 * is a different thing from waiting for a BUSY PEER, and bounding them by the same
 * number conflated the two. A cold spawn is `fork` + WASM instantiate + a warm-up
 * parse, measured at 200-243 ms idle — but on a loaded box (a full test run, a busy
 * container) it is several times that, and at 1 000 ms a request was observed to
 * give up on a perfectly healthy child and lose its tokens. 2 000 ms is ~8x the
 * measured cold spawn and is still a BOUND: if it expires the request resolves
 * `null`, so it can degrade but it can never hang.
 *
 * IT IS NOW ITS OWN NAMED BOUND (D-27-W3B-03a). It used to be DERIVED as
 * `cookParseQueueTimeoutMs + cookParseTimeoutMs`, which happened to equal 2 000 ms.
 * Once the parse bound became an 8 000 ms wall-clock BACKSTOP that derivation would
 * silently have stretched the cold-spawn wait to 9 000 ms — a real latency
 * regression smuggled in by an unrelated change. Same value, stated explicitly.
 */
const READY_TIMEOUT_MS = COOK_BOUNDS.cookParseReadyTimeoutMs;

function waitReady(target: PoolChild): Promise<boolean> {
  if (target.ready) return Promise.resolve(true);
  if (target.retired) return Promise.resolve(false);

  return new Promise((resolve) => {
    let done = false;
    const finish = (): void => {
      if (done) return;

      done = true;
      clearTimeout(timer);
      resolve(target.ready && !target.retired);
    };
    const timer = setTimeout(finish, READY_TIMEOUT_MS);

    target.readyWaiters.push(finish);
  });
}

function runRequest(target: PoolChild, src: string, scale?: number): Promise<Outcome> {
  return new Promise((resolve) => {
    const id = nextRequestId;

    nextRequestId += 1;

    let done = false;
    const settle = (outcome: Outcome): void => {
      if (done) return;

      done = true;
      resolve(outcome);
    };

    const startedAt = performance.now();
    const cpuAtStart = readChildCpuMs(target.pid);

    lastSampledCpuMs = null;
    lastSampledRssMb = null;

    let sampleTimer: NodeJS.Timeout | null = null;
    let wallTimer: NodeJS.Timeout | null = null;

    const stopTimers = (): void => {
      if (sampleTimer !== null) {
        clearTimeout(sampleTimer);
        sampleTimer = null;
      }

      if (wallTimer !== null) {
        clearTimeout(wallTimer);
        wallTimer = null;
      }
    };

    /**
     * THE TWO MEASURED GATES, ON ONE POLL: the child's CPU time and its resident
     * set. A recursive `setTimeout` rather than a `setInterval` so a slow sample can
     * never queue up behind itself.
     *
     * ONE LOOP, TWO AXES, BY DESIGN (D-27-W3B-14). The memory bound rides the timer
     * the CPU gate already pays for, so it costs no extra scheduling and it can
     * never disagree with the CPU gate about when a child was last observed.
     *
     * IT COSTS NOTHING IN THE COMMON CASE. The first sample is scheduled
     * `cookParseCpuPollMs` (25 ms) out, and a pooled round trip is ~0.97 ms, so for
     * every real recipe this timer is created and cleared without ever firing —
     * measured at ZERO polls for both a 437-byte fixture and a 64 KiB realistic
     * recipe. When it does fire, the pair costs ~58 µs (23.62 + 33.61 µs, 20 000
     * iterations warm).
     *
     * CPU IS CHECKED FIRST because it is the PRIMARY gate and the only one that can
     * see H1's flat-6-MB recursion at all. In practice the two never race: the
     * ballooning families cross `cookParseRssMb` at ~630 ms of CPU, 2.4x before the
     * CPU budget, and H1 never moves the RSS needle.
     */
    const sampleChild = (): void => {
      const cpuNow = readChildCpuMs(target.pid);
      const cpuMs = cpuNow === null || cpuAtStart === null ? null : cpuNow - cpuAtStart;
      const rssMb = readChildRssMb(target.pid);

      if (cpuMs !== null) lastSampledCpuMs = Math.round(cpuMs);
      if (rssMb !== null) lastSampledRssMb = Math.round(rssMb);

      if (cpuMs !== null && cpuMs > COOK_BOUNDS.cookParseCpuMs) {
        stopTimers();
        settle({
          ok: false,
          reason: "pool-cpu",
          elapsedMs: Math.round(performance.now() - startedAt),
          cpuMs: Math.round(cpuMs),
          rssMb: lastSampledRssMb,
        });
        // `SIGKILL` needs no cooperation from V8 or from the WASM, which is the
        // whole reason it is trustworthy against a synchronous parse.
        retire(target, "pool-cpu");

        return;
      }

      // THE MEMORY BOUND. ABSOLUTE, not a delta from the start of this parse: the
      // container and the OOM killer act on the absolute figure, and the child's
      // idle floor was measured to PLATEAU at 175.2 MB over 1 050 heavy parses, so
      // an absolute budget cannot drift into false refusals.
      if (rssMb !== null && rssMb > COOK_BOUNDS.cookParseRssMb) {
        stopTimers();
        settle({
          ok: false,
          reason: "pool-rss",
          elapsedMs: Math.round(performance.now() - startedAt),
          cpuMs: lastSampledCpuMs,
          rssMb: Math.round(rssMb),
        });
        retire(target, "pool-rss");

        return;
      }

      sampleTimer = setTimeout(sampleChild, COOK_BOUNDS.cookParseCpuPollMs);
    };

    sampleTimer = setTimeout(sampleChild, COOK_BOUNDS.cookParseCpuPollMs);

    // THE WALL-CLOCK BACKSTOP. Only reachable by a child that is stuck WITHOUT
    // burning CPU, because a child that IS burning CPU is killed by the gate above
    // long before this fires. See `./limits` for why it is deliberately generous.
    wallTimer = setTimeout(() => {
      const elapsedMs = Math.round(performance.now() - startedAt);

      stopTimers();
      settle({
        ok: false,
        reason: "pool-timeout",
        elapsedMs,
        cpuMs: lastSampledCpuMs,
        rssMb: lastSampledRssMb,
      });
      retire(target, "pool-timeout");
    }, COOK_BOUNDS.cookParseWallCeilingMs);

    target.inFlight = { id, startedAt, stopTimers, settle };

    const request: CookParseRequest = {
      id,
      src,
      ...(typeof scale === "number" ? { scale } : {}),
    };

    try {
      target.child.send(request);
    } catch (err) {
      stopTimers();
      target.inFlight = null;
      log.error(
        { module: "cooklang", reason: "pool-crash", pid: target.pid, err },
        "Could not send to the Cooklang parse child; keeping the legacy projection"
      );
      settle({ ok: false, reason: "pool-crash", elapsedMs: 0, cpuMs: null, rssMb: null });
      retire(target, "pool-crash");
    }
  });
}

/** D-8: `%unit` carries a canonical norish unit ID — re-normalize on the way back in. */
function canonicalUnit(unit: string | null, units?: UnitsMap): string | null {
  if (!unit) return null;

  const normalized = units ? normalizeUnit(unit, units) : unit;

  return normalized === "" ? null : normalized;
}

/**
 * Finish the projection the child could not: turn the child's `rawUnit` into the
 * canonical norish unit ID. The child cannot do this (it may not import
 * `@norish/shared`), and the distinct key name is what makes forgetting this pass
 * a type error rather than an un-normalized unit reaching a client.
 */
function toCookTokens(steps: RawCookStepTokens[], units?: UnitsMap): CookTokensDTO {
  return steps.map(
    (step): CookStepTokensDTO => ({
      order: step.order,
      section: step.section,
      tokens: step.tokens.map((token): CookTokenDTO =>
        token.type === "ingredient"
          ? {
              type: "ingredient",
              name: token.name,
              amount: token.amount,
              unit: canonicalUnit(token.rawUnit, units),
            }
          : token
      ),
    })
  );
}

/**
 * Which bound a retired request breached, the value it was allowed, and the value
 * that was actually measured against it (T-27-05: numbers and codes, never prose).
 */
function breachedBound(
  reason: RetireReason | "pool-saturated" | "pool-spawn-failed",
  elapsedMs: number,
  cpuMs: number | null,
  rssMb: number | null
): { bound: string | null; limit: number | null; measured: number | null } {
  switch (reason) {
    case "pool-cpu":
      return { bound: "cookParseCpuMs", limit: COOK_BOUNDS.cookParseCpuMs, measured: cpuMs };
    case "pool-rss":
      return { bound: "cookParseRssMb", limit: COOK_BOUNDS.cookParseRssMb, measured: rssMb };
    case "pool-timeout":
      return {
        bound: "cookParseWallCeilingMs",
        limit: COOK_BOUNDS.cookParseWallCeilingMs,
        measured: elapsedMs,
      };
    case "pool-heap":
      // The child aborted itself on a V8 OLD-SPACE OOM. `measured` is `null`
      // because the breach is observed as a `SIGABRT`, not as a number we hold —
      // unlike `pool-rss`, where the parent measured the figure it refused.
      return {
        bound: "cookParseOldSpaceMb",
        limit: COOK_BOUNDS.cookParseOldSpaceMb,
        measured: null,
      };
    default:
      return { bound: null, limit: null, measured: null };
  }
}

/**
 * Parse a `.cook` source in a pooled child process, under all four bounds, with
 * the BYTE CAP enforced here and the recognizer left to the caller.
 *
 * PRIVATE. `parseInPool` (recognizer enforced) and
 * `parseInPoolBelowTheRecognizerForTests` (recognizer deliberately skipped) are the
 * only two ways in, and both of them come through here, so the byte cap has no
 * bypass at all.
 */
async function boundedParse(
  src: string,
  units?: UnitsMap,
  scale?: number
): Promise<CookTokensDTO | null> {
  const bytes = Buffer.byteLength(src, "utf8");

  // THE BYTE CAP, ENFORCED BY THE DOOR ITSELF (D-27-W3B-15 — VERIFY-3 blocker 4).
  // `./parse` and `./build-payload` check it too and refuse before they ever get
  // here, so on the shipped path this costs one `Buffer.byteLength` comparison and
  // never fires. It exists because the previous arrangement made "nobody calls the
  // pool without checking first" a CONVENTION, and a convention is not a bound. It
  // is ERROR level precisely because reaching it means a caller skipped `./parse`.
  if (bytes > COOK_LIMITS.maxCookSourceBytes) {
    log.error(
      {
        module: "cooklang",
        reason: "input-too-large",
        limit: "maxCookSourceBytes",
        measured: bytes,
        allowed: COOK_LIMITS.maxCookSourceBytes,
        door: "pool",
      },
      "Cooklang source reached the pool over the byte cap; refusing to parse"
    );

    return null;
  }

  const acquired = await acquire();

  if (acquired === "pool-saturated") {
    log.warn(
      {
        module: "cooklang",
        reason: "pool-saturated",
        bytes,
        allowed: COOK_BOUNDS.cookParsePoolSize,
        limit: "cookParseQueueTimeoutMs",
        measured: COOK_BOUNDS.cookParseQueueTimeoutMs,
      },
      "Cooklang parse pool is saturated; keeping the legacy projection"
    );

    return null;
  }

  if (acquired === "pool-spawn-failed") {
    log.error(
      { module: "cooklang", reason: "pool-spawn-failed", bytes },
      "No Cooklang parse child available; keeping the legacy projection"
    );

    return null;
  }

  const target = acquired;

  try {
    if (!(await waitReady(target))) {
      log.error(
        { module: "cooklang", reason: "pool-spawn-failed", pid: target.pid, bytes },
        "Cooklang parse child never reported ready; keeping the legacy projection"
      );
      retire(target, "pool-crash");

      return null;
    }

    const outcome = await runRequest(target, src, scale);

    if (!outcome.ok) {
      if (outcome.reason === "parse-threw") {
        // Preserved verbatim from the in-process implementation.
        log.warn({ module: "cooklang", err: outcome.error }, "Cooklang parse threw");

        // The parser survived the throw, but a compiled binary that has just
        // trapped does not keep serving requests (D-27-W3B-10).
        retire(target, "pool-crash");

        return null;
      }

      const breached = breachedBound(
        outcome.reason,
        outcome.elapsedMs,
        outcome.cpuMs,
        outcome.rssMb
      );

      log.warn(
        {
          module: "cooklang",
          reason: outcome.reason,
          bound: breached.bound,
          limit: breached.limit,
          // WHICH NUMBER ACTUALLY BREACHED, beside the limit it breached — so an
          // operator reading `pool-cpu` can see how far over budget the row was,
          // and so a test can assert the gate measured what it refused instead of
          // trusting that it did. `null` only for `pool-heap`, whose breach is
          // observed as the child's `SIGABRT` and is not a number we hold.
          measured: breached.measured,
          cpuMs: outcome.cpuMs,
          // BOTH measured axes travel on every bound hit, not just the one that
          // fired: `pool-timeout` with `cpuMs` near zero is a stuck child, and
          // `pool-cpu` with a high `rssMb` is a different production signal from
          // `pool-cpu` at a flat 85 MB (H1's shape).
          rssMb: outcome.rssMb,
          elapsedMs: outcome.elapsedMs,
          bytes,
          pid: target.pid,
        },
        "Cooklang parse hit a resource bound; keeping the legacy projection"
      );

      return null;
    }

    if (!outcome.reportEmpty) {
      // Preserved verbatim from the in-process implementation.
      log.warn({ module: "cooklang" }, "Cooklang source did not parse cleanly");

      return null;
    }

    const tokens = toCookTokens(outcome.steps, units);

    return tokens.length > 0 ? tokens : null;
  } finally {
    release(target);
  }
}

/**
 * Parse a `.cook` source in a pooled child process, under all four bounds.
 *
 * THE ONLY WAY TO REACH THE WASM PARSER. Resolves `null` for every failure and
 * never rejects; see the module docblock for why `null` costs the user nothing.
 *
 * ============================================================================
 * IT IS A DOOR NOW, AND IT ENFORCES ITS OWN PRECONDITIONS (D-27-W3B-15).
 * ============================================================================
 *
 * The previous version of this docblock said "NOT A DOOR … no production code
 * outside `./parse` may call this", and NOTHING ENFORCED THAT. This module was a
 * public subpath (`@norish/shared-server/cooklang/pool`), it carried no byte cap
 * and no recognizer of its own, and the static one-importer assertion covers
 * `@cooklang/cooklang`, not this specifier — so a second caller could have appeared
 * unrecognized and reached the WASM with neither gate in front of it. "No
 * production code may" is a convention; a convention is not a boundary
 * (VERIFY-3 blocker 4). Three things changed, and they are independent:
 *
 *  1. THE SUBPATH IS GONE from `package.json`'s `exports`, so nothing outside
 *     `@norish/shared-server` can import this module at all. The lifecycle helper
 *     other packages' test suites genuinely need is re-exported from `./parse`.
 *  2. THE DOOR ENFORCES. `boundedParse` applies `maxCookSourceBytes` to EVERY
 *     entry, and this function additionally applies `findCookSourceDefect`. Both
 *     are checked again in `./parse` and `./build-payload` — the same deliberate
 *     double-check `build-payload` already does against `parseCookSource`, and on
 *     the shipped path the second run is one already-refused-nothing pass over
 *     <= 64 KiB.
 *  3. THE CALLER LIST IS PINNED by a static assertion in `pool.test.ts` that walks
 *     the real tree, in the same style as the `@cooklang/cooklang` one-importer
 *     assertion, so a second caller fails a test rather than review.
 *
 * THE BOUND-ONLY TEST METHODOLOGY IS PRESERVED, AND MADE VISIBLE.
 * `pool.test.ts` and `limits.test.ts` deliberately drive hostile sources PAST the
 * recognizer, because that is the only way to prove the bound is what stops them
 * rather than the recognizer. They call `parseInPoolBelowTheRecognizerForTests`,
 * whose name states exactly which gate it skips and who may use it, instead of
 * this door silently being that thing for everybody.
 */
export async function parseInPool(
  src: string,
  units?: UnitsMap,
  scale?: number
): Promise<CookTokensDTO | null> {
  const defect = findCookSourceDefect(src);

  if (defect) {
    // ERROR level, and deliberately so: `./parse` and `./build-payload` both run
    // this check and refuse first, so reaching it means a caller came in around
    // them. Counts, codes and an OFFSET only — never the source (T-27-05).
    log.error(
      {
        module: "cooklang",
        reason: "not-serializer-shaped",
        defect: defect.defect,
        offset: defect.offset,
        bytes: typeof src === "string" ? Buffer.byteLength(src, "utf8") : 0,
        door: "pool",
      },
      "Cooklang source reached the pool without passing the recognizer; refusing to parse"
    );

    return null;
  }

  return boundedParse(src, units, scale);
}

/**
 * The pool WITHOUT the recognizer in front of it — the byte cap and all four
 * resource bounds still apply.
 *
 * FOR THE BOUND-ONLY PROOFS, AND FOR NOTHING ELSE. `pool.test.ts` exists to prove
 * that the H1 frontmatter recursion, the report explosion and the round-1 bypass
 * are stopped BY THE BOUND. Feeding them through `parseInPool` would prove only
 * that `findCookSourceDefect` refuses them, which is a different (and already
 * separately tested) claim — and it is exactly the confusion that let round 2 ship
 * a recognizer as if it were a guarantee.
 *
 * It is named for what it skips so that a second caller is visible in review, and
 * its caller list is PINNED by a static assertion in `pool.test.ts` that walks the
 * real tree. It is not reachable from outside `@norish/shared-server`: this module
 * is no longer an exported subpath (D-27-W3B-15).
 */
export function parseInPoolBelowTheRecognizerForTests(
  src: string,
  units?: UnitsMap,
  scale?: number
): Promise<CookTokensDTO | null> {
  return boundedParse(src, units, scale);
}

/**
 * Kill every child and clear the queue.
 *
 * For `afterAll` in tests (vitest will not exit while a child lives) and for a
 * graceful container stop. The pool is lazy, so a later `parseInPool` simply
 * spawns again.
 */
export function shutdownCookParsePool(): void {
  const queued = waiters;

  waiters = [];

  for (const waiter of queued) {
    if (waiter.settled) continue;

    waiter.settled = true;
    clearTimeout(waiter.timer);
    waiter.resolve("pool-saturated");
  }

  for (const target of [...children]) retire(target, "pool-shutdown");

  children = [];
}

/** Live child pids. For the pool's own tests (laziness, terminate-and-replace). */
export function cookParsePoolPidsForTests(): number[] {
  return children.filter((candidate) => !candidate.retired).map((candidate) => candidate.pid);
}

/**
 * The CPU cost the gate last SAMPLED, in ms, or `null` if the most recent parse
 * finished before the first 25 ms sample (which is every normal recipe).
 *
 * For `pool.test.ts` only, and it exists to make one specific assertion possible:
 * that the worst LEGITIMATE shapes stay inside `cookParseCpuMs` **on a loaded box**.
 * Asserting that on WALL CLOCK is what made the previous suite go red in the full
 * run and green in isolation. Asserting it on the number the gate actually decides
 * with is contention-invariant, which is the entire point of D-27-W3B-03a.
 */
export function cookParseLastCpuMsForTests(): number | null {
  return lastSampledCpuMs;
}

/**
 * The child RSS the memory gate last SAMPLED, in MB, or `null` if the most recent
 * parse finished before the first 25 ms sample (which is every normal recipe).
 *
 * For `pool.test.ts` only, and it is the counterpart of
 * `cookParseLastCpuMsForTests`: it lets the suite assert that the worst LEGITIMATE
 * shapes stay far inside `cookParseRssMb` using the same number the gate decides
 * with, rather than a second reader of `/proc` that could drift from it.
 */
export function cookParseLastRssMbForTests(): number | null {
  return lastSampledRssMb;
}

/**
 * A child's total CPU consumption so far, in ms, or `null` on a host without
 * `/proc/<pid>/schedstat`.
 *
 * For `pool.test.ts` only, and it exists so the READ-PATH LATENCY alarm (R2) can be
 * asserted on CPU rather than on wall clock. It delegates to the gate's own reader
 * instead of re-parsing `/proc` in the test, because two mirrored readers of the same
 * kernel file would drift and only one of them would be the one the bound uses.
 */
export function cookParseChildCpuMsForTests(pid: number): number | null {
  return readChildCpuMs(pid);
}
