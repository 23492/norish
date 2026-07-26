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

import { COOK_BOUNDS } from "./limits";

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
 * THREE BOUNDS, NONE REDUNDANT:
 *  - `cookParseCpuMs` (1 500 ms of the CHILD's CPU) — the computation bound. Kills
 *    every measured hostile family: H1's frontmatter recursion burns 22 759 ms of
 *    CPU, the `"#" x 8192` report explosion 12 222 ms, the round-1 bypass 4 895 ms.
 *  - `cookParseWallCeilingMs` (8 000 ms) — a BACKSTOP for a child stuck WITHOUT
 *    burning CPU (a hang, a lost IPC reply), which the CPU gate cannot see because
 *    the counter does not advance. Deliberately generous: a blocked-but-idle child
 *    is not a DoS amplifier, it just occupies one pool slot, and
 *    `cookParseQueueTimeoutMs` plus terminate-and-replace already handle that.
 *  - `cookParseHeapMb` (256 MB), enforced by the child's own
 *    `--max-old-space-size`. This is what catches the report-explosion family's
 *    839 MB-1.65 GB balloon, and it is MORE important now that the wall-clock
 *    ceiling is 8 s rather than 1 s.
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
 * here (time bound, heap bound, crash, WASM trap, malformed envelope, a child
 * that will not spawn, a saturated pool) resolves `null`. `null` means no `cook`
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
  | "pool-timeout"
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
 * `1.6 x cookParseCpuMs`, and the 256 MB heap bound independently caps the
 * allocation that drives GC work in the first place.
 *
 * RETURNS `null` RATHER THAN THROWING, and the caller then falls through to the
 * wall-clock backstop. Two ways that happens: the pid is already gone (a race with
 * the child exiting — expected and harmless), or the host has no
 * `/proc/<pid>/schedstat` at all. The latter is not Linux, so it is not production
 * (the deployed artefact is a Linux container on LXC 110); on such a host the parse
 * is bounded by `cookParseWallCeilingMs` and `cookParseHeapMb` only, which is
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
      // The HEAP bound. Passing `execArgv` explicitly also stops the parent's own
      // flags (vitest's, for instance) from leaking into the child.
      execArgv: [`--max-old-space-size=${COOK_BOUNDS.cookParseHeapMb}`],
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
    // A V8 fatal OOM aborts: `code=null signal=SIGABRT` (measured), or exit 134
    // where the signal is not reported. That is the HEAP bound doing its job.
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

    let cpuTimer: NodeJS.Timeout | null = null;
    let wallTimer: NodeJS.Timeout | null = null;

    const stopTimers = (): void => {
      if (cpuTimer !== null) {
        clearTimeout(cpuTimer);
        cpuTimer = null;
      }

      if (wallTimer !== null) {
        clearTimeout(wallTimer);
        wallTimer = null;
      }
    };

    /**
     * THE PRIMARY GATE. A recursive `setTimeout` rather than a `setInterval` so a
     * slow sample can never queue up behind itself.
     *
     * IT COSTS NOTHING IN THE COMMON CASE. The first sample is scheduled
     * `cookParseCpuPollMs` (25 ms) out, and a pooled round trip is ~0.97 ms, so for
     * every real recipe this timer is created and cleared without ever firing —
     * measured at ZERO polls for both a 437-byte fixture and a 64 KiB realistic
     * recipe. When it does fire, one sample costs ~30 µs.
     */
    const sampleCpu = (): void => {
      const cpuNow = readChildCpuMs(target.pid);
      const cpuMs = cpuNow === null || cpuAtStart === null ? null : cpuNow - cpuAtStart;

      if (cpuMs !== null) lastSampledCpuMs = Math.round(cpuMs);

      if (cpuMs !== null && cpuMs > COOK_BOUNDS.cookParseCpuMs) {
        stopTimers();
        settle({
          ok: false,
          reason: "pool-cpu",
          elapsedMs: Math.round(performance.now() - startedAt),
          cpuMs: Math.round(cpuMs),
        });
        // `SIGKILL` needs no cooperation from V8 or from the WASM, which is the
        // whole reason it is trustworthy against a synchronous parse.
        retire(target, "pool-cpu");

        return;
      }

      cpuTimer = setTimeout(sampleCpu, COOK_BOUNDS.cookParseCpuPollMs);
    };

    cpuTimer = setTimeout(sampleCpu, COOK_BOUNDS.cookParseCpuPollMs);

    // THE WALL-CLOCK BACKSTOP. Only reachable by a child that is stuck WITHOUT
    // burning CPU, because a child that IS burning CPU is killed by the gate above
    // long before this fires. See `./limits` for why it is deliberately generous.
    wallTimer = setTimeout(() => {
      const elapsedMs = Math.round(performance.now() - startedAt);

      stopTimers();
      settle({ ok: false, reason: "pool-timeout", elapsedMs, cpuMs: lastSampledCpuMs });
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
      settle({ ok: false, reason: "pool-crash", elapsedMs: 0, cpuMs: null });
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
  cpuMs: number | null
): { bound: string | null; limit: number | null; measured: number | null } {
  switch (reason) {
    case "pool-cpu":
      return { bound: "cookParseCpuMs", limit: COOK_BOUNDS.cookParseCpuMs, measured: cpuMs };
    case "pool-timeout":
      return {
        bound: "cookParseWallCeilingMs",
        limit: COOK_BOUNDS.cookParseWallCeilingMs,
        measured: elapsedMs,
      };
    case "pool-heap":
      return { bound: "cookParseHeapMb", limit: COOK_BOUNDS.cookParseHeapMb, measured: null };
    default:
      return { bound: null, limit: null, measured: null };
  }
}

/**
 * Parse a `.cook` source in a pooled child process, under all three bounds.
 *
 * THE ONLY WAY TO REACH THE WASM PARSER. Resolves `null` for every failure and
 * never rejects; see the module docblock for why `null` costs the user nothing.
 *
 * NOT A DOOR. This is deliberately NOT the place the byte cap and
 * `findCookSourceDefect` are enforced — those belong to `./parse` and
 * `./build-payload`, which are the two and only two doors. No production code
 * outside `./parse` may call this.
 */
export async function parseInPool(
  src: string,
  units?: UnitsMap,
  scale?: number
): Promise<CookTokensDTO | null> {
  const bytes = Buffer.byteLength(src, "utf8");
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

      const breached = breachedBound(outcome.reason, outcome.elapsedMs, outcome.cpuMs);

      log.warn(
        {
          module: "cooklang",
          reason: outcome.reason,
          bound: breached.bound,
          limit: breached.limit,
          // WHICH NUMBER ACTUALLY BREACHED, beside the limit it breached — so an
          // operator reading `pool-cpu` can see how far over budget the row was,
          // and so a test can assert the gate measured what it refused instead of
          // trusting that it did. `null` only for the heap bound, whose breach is
          // observed as the child's `SIGABRT` and is not a number we hold.
          measured: breached.measured,
          cpuMs: outcome.cpuMs,
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
