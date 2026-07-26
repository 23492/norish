/**
 * A TEST-ONLY STAND-IN FOR THE PARSE CHILD (Phase 27, W3B — D-27-W3B-03a).
 *
 * WHY THIS FILE EXISTS. The one claim D-27-W3B-03a rests on is that the primary
 * gate is the child's CPU CONSUMPTION and not the wall clock it elapsed against.
 * Proving that with the real WASM parser would mean manufacturing host contention
 * and hoping the scheduler cooperates — which is exactly how the previous suite
 * ended up red in the full run and green in isolation.
 *
 * A stub child makes both directions DETERMINISTIC, because it decouples the two
 * axes completely:
 *
 *  - `STUB_MODE=sleep` burns ~0 CPU and elapses `STUB_MS` of WALL CLOCK. The old
 *    1 000 ms wall-clock bound WOULD have killed this. The CPU gate must not.
 *  - `STUB_MODE=burn` blocks the event loop in a tight loop for `STUB_MS`, exactly
 *    as the synchronous WASM parse does, so it cannot be rescued by a timer. The
 *    CPU gate must kill it once `cookParseCpuMs` is spent.
 *
 * IT IS DELIBERATELY NOT A `.ts` FILE AND IT IMPORTS NOTHING. It must never appear
 * in the `@cooklang/cooklang` one-importer sweeps in `pool.test.ts`, and it is
 * `fork`ed by raw Node, which cannot load `@norish/*` source.
 *
 * The pool reaches this file through `NORISH_COOK_PARSE_WORKER_PATH`, the same
 * operational escape hatch the missing-child test uses. Production resolves the
 * child by the sibling rule and never looks at this env var.
 */

const MODE = process.env.STUB_MODE ?? "sleep";
const DURATION_MS = Number(process.env.STUB_MS ?? 3_000);

/** One valid step, so a successful stub parse projects to a non-empty token list. */
const STEPS = [
  {
    order: 0,
    section: null,
    tokens: [
      { type: "text", value: "stub " },
      { type: "ingredient", name: "flour", amount: 200, rawUnit: "gram" },
    ],
  },
];

function reply(id) {
  process.send?.({ id, ok: true, steps: STEPS, reportEmpty: true });
}

process.on("message", (message) => {
  if (typeof message !== "object" || message === null) return;
  if (typeof message.id !== "number") return;

  if (MODE === "burn") {
    // BLOCKING ON PURPOSE. A `setTimeout` here would be cooperative and would let
    // the event loop answer the parent, which is the opposite of what the real
    // synchronous WASM parse does.
    const until = Date.now() + DURATION_MS;

    while (Date.now() < until) {
      // Spin. The parent's CPU gate is what must end this.
    }

    reply(message.id);

    return;
  }

  // `sleep`: elapse wall clock while consuming no CPU at all.
  setTimeout(() => reply(message.id), DURATION_MS);
});

process.send?.({ ready: true });
