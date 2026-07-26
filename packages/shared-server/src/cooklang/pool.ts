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
 * TWO BOUNDS, ONE PER MEASURED FAILURE FAMILY. NEITHER IS REDUNDANT:
 *  - `cookParseTimeoutMs` (1 000 ms), enforced by `SIGKILL` FROM THE PARENT.
 *    OS-guaranteed; it needs no cooperation from V8 and none from the WASM.
 *    Measured to take effect in 16 ms mid-parse. This is what catches the
 *    YAML-recursion family, which burns 24-38 s of pure CPU at a flat 6 MB and is
 *    therefore INVISIBLE to a memory bound.
 *  - `cookParseHeapMb` (256 MB), enforced by the child's own
 *    `--max-old-space-size`. This is what catches the report-explosion family,
 *    which a time bound would only catch after it had already allocated
 *    gigabytes.
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
  | "pool-timeout"
  | "pool-heap"
  | "pool-crash"
  | "pool-bad-envelope"
  | "pool-shutdown";

type Outcome =
  | { ok: true; steps: RawCookStepTokens[]; reportEmpty: boolean }
  | { ok: false; reason: "parse-threw"; error: string }
  | { ok: false; reason: RetireReason | "pool-saturated" | "pool-spawn-failed"; elapsedMs: number };

type InFlight = {
  id: number;
  startedAt: number;
  timer: NodeJS.Timeout;
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
    clearTimeout(flight.timer);
    target.inFlight = null;
    flight.settle({
      ok: false,
      reason: reason === "pool-shutdown" ? "pool-crash" : reason,
      elapsedMs: Math.round(performance.now() - flight.startedAt),
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

    clearTimeout(flight.timer);
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
 * give up on a perfectly healthy child and lose its tokens. The sum of the two
 * existing bounds is ~8x the measured cold spawn, introduces no new knob, and is
 * still a BOUND: if it expires the request resolves `null`, so it can degrade but
 * it can never hang.
 */
const READY_TIMEOUT_MS = COOK_BOUNDS.cookParseQueueTimeoutMs + COOK_BOUNDS.cookParseTimeoutMs;

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
    const timer = setTimeout(() => {
      const elapsedMs = Math.round(performance.now() - startedAt);

      // THE TIME BOUND. `SIGKILL` needs no cooperation from V8 or from the WASM,
      // which is the whole reason it is trustworthy against a synchronous parse.
      settle({ ok: false, reason: "pool-timeout", elapsedMs });
      retire(target, "pool-timeout");
    }, COOK_BOUNDS.cookParseTimeoutMs);

    target.inFlight = { id, startedAt, timer, settle };

    const request: CookParseRequest = {
      id,
      src,
      ...(typeof scale === "number" ? { scale } : {}),
    };

    try {
      target.child.send(request);
    } catch (err) {
      clearTimeout(timer);
      target.inFlight = null;
      log.error(
        { module: "cooklang", reason: "pool-crash", pid: target.pid, err },
        "Could not send to the Cooklang parse child; keeping the legacy projection"
      );
      settle({ ok: false, reason: "pool-crash", elapsedMs: 0 });
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
 * Parse a `.cook` source in a pooled child process, under both bounds.
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

      log.warn(
        {
          module: "cooklang",
          reason: outcome.reason,
          bound:
            outcome.reason === "pool-timeout"
              ? "cookParseTimeoutMs"
              : outcome.reason === "pool-heap"
                ? "cookParseHeapMb"
                : null,
          limit:
            outcome.reason === "pool-timeout"
              ? COOK_BOUNDS.cookParseTimeoutMs
              : outcome.reason === "pool-heap"
                ? COOK_BOUNDS.cookParseHeapMb
                : null,
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
