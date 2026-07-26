/**
 * THE CHILD PROCESS THAT RUNS THE WASM PARSER (Phase 27, W3B — T-27-01).
 *
 * THIS IS THE ONLY FILE IN THE REPO THAT IMPORTS `@cooklang/cooklang`.
 * That is an invariant, asserted by `pool.test.ts`, and it is what makes the
 * resource bound in `./pool` a real guarantee rather than a hope: the parser
 * cannot be reached except by sending a message to this process, and this
 * process is disposable.
 *
 * WHY A CHILD PROCESS AND NOT A WORKER THREAD (D-27-W3B-02). `worker_threads` +
 * `resourceLimits` was MEASURED to abort the ENTIRE Node process on the payload
 * class in question: the WASM binding returns its result as a JSON string, and
 * the `JSON.parse` allocation happens inside a V8 builtin where V8 cannot unwind
 * to the graceful per-worker OOM path, so it escalates to
 * `v8::internal::V8::FatalProcessOutOfMemory` and the parent dies. A memory
 * bound that kills the web server is not a bound. A child process contains the
 * same fatal OOM (`SIGABRT`, parent alive) and is also faster at the tail
 * (p95 1.5 ms vs 5.4 ms) because it shares neither heap nor GC with the
 * request-serving event loop. DO NOT "simplify" this back to a worker thread.
 *
 * WHY THE PROJECTION HAPPENS HERE. The parser hands back a `CooklangRecipe`
 * CLASS instance whose step items carry only an INDEX into
 * `recipe.ingredients` / `timers` / `cookware` / `inlineQuantities`. A class
 * instance cannot be structured-cloned across the IPC channel, so the
 * dereference MUST happen on this side; only plain JSON crosses.
 *
 * WHAT THIS FILE MAY IMPORT — a hard constraint, established empirically.
 * The pool `fork`s this file as a RAW `.ts` in dev and vitest (Node 22 strips
 * types) and as the emitted `dist-server/parse-worker.js` in production. Raw
 * Node cannot load `@norish/*` source: those packages import relative modules
 * WITHOUT a file extension (`./unit-form-selector`), which ESM refuses
 * (`ERR_MODULE_NOT_FOUND`, reproduced on this tree). So VALUE imports here are
 * restricted to `@cooklang/cooklang` and `node:` builtins. `import type` is
 * erased by type stripping and is safe.
 *
 * The direct consequence: this file CANNOT call `normalizeUnit`, so it emits an
 * ingredient's unit as the parser gave it, under the deliberately different key
 * `rawUnit`. `./pool` canonicalizes it in the parent. The distinct key is not
 * cosmetic — it makes a missing canonicalization pass a TYPE ERROR rather than a
 * silently un-normalized unit reaching a client (D-8).
 *
 * THIS PROCESS HOLDS NOTHING. No credentials, no DB handle, no network, no ctx,
 * no household scope. It cannot make an authorization decision, so it cannot get
 * one wrong. It receives a string and returns tokens.
 */

import {
  CooklangParser,
  getQuantityUnit,
  getQuantityValue,
  quantity_display,
  type CooklangRecipe,
} from "@cooklang/cooklang";

/** Parse one `.cook` source. `scale` is forwarded verbatim to the WASM (D-27-W3B-11). */
export type CookParseRequest = {
  id: number;
  src: string;
  scale?: number;
};

/**
 * An ingredient token as it leaves the child: `rawUnit` is the parser's own unit
 * string, NOT a canonical norish unit ID. `./pool` maps it to `unit`.
 */
export type RawCookToken =
  | { type: "text"; value: string }
  | { type: "ingredient"; name: string; amount: number | null; rawUnit: string | null }
  | { type: "timer"; name: string | null; amount: number | null; unit: string | null };

export type RawCookStepTokens = {
  order: number;
  section: string | null;
  tokens: RawCookToken[];
};

/**
 * `ok: false` is a parser THROW (including a WASM trap that this process
 * survived). A bound hit never produces a response at all — the process is gone.
 *
 * `reportEmpty: false` means the parser emitted a diagnostic. norish AUTHORS
 * every `.cook` it stores (D-3), so a diagnostic means our own writer produced
 * something the parser did not fully understand; the parent refuses it.
 */
export type CookParseResponse =
  | { id: number; ok: true; steps: RawCookStepTokens[]; reportEmpty: boolean }
  | { id: number; ok: false; error: string };

/** Sent once, after the warm-up parse, so the pool never sends into a cold child. */
export type CookWorkerReady = { ready: true };

/**
 * NO DIALECT EXTENSIONS (T-27-01 root-cause fix). Moved here verbatim from
 * `parse.ts` when the parse moved into this process.
 *
 * norish AUTHORS every `.cook` it parses, and it writes only CORE Cooklang:
 * `@name`, `@name{amount%unit}`, `~{amount%unit}`, `~name{amount%unit}`,
 * `== Heading ==` and YAML frontmatter. None of that is an extension, so switching
 * every extension off costs nothing — and it buys round-trip fidelity, which W4
 * stands on. With the default mask (`3818`) the parser also LEXES PROSE NUMBERS
 * into `inlineQuantity` items and re-formats them on the way out, so
 * `Bake at 180°C` came back as `Bake at 180 °C` and `Add 1.50 kg` as `Add 1.5 kg`:
 * the read model silently rewrote text the user typed. With `0` the same prose
 * round-trips byte-identically (`round-trip-fidelity.test.ts`).
 */
const COOK_PARSER_EXTENSIONS = 0;

/**
 * The WASM module is initialised on first construction (~15-20 ms to compile and
 * instantiate the 2 090 790-byte binary, then ~29 ms for the first parse to JIT).
 * One parser serves this process for its whole life; the pool throws the process
 * away rather than reusing a parser that has misbehaved.
 */
const parser = new CooklangParser();

parser.extensions = COOK_PARSER_EXTENSIONS;

function textToken(value: string): RawCookToken {
  return { type: "text", value };
}

/**
 * Project a parsed recipe into the plain-JSON token read model.
 *
 * `order` is a recipe-wide running index over non-text step content, so a client
 * can address a step without knowing about sections; the section heading it
 * belongs to travels with the step as `section`.
 */
function toRawCookTokens(recipe: CooklangRecipe): RawCookStepTokens[] {
  const steps: RawCookStepTokens[] = [];
  let order = 0;

  for (const section of recipe.sections) {
    for (const content of section.content) {
      if (content.type !== "step") continue;

      const tokens: RawCookToken[] = [];

      for (const item of content.value.items) {
        switch (item.type) {
          case "text": {
            tokens.push(textToken(item.value));
            break;
          }
          case "ingredient": {
            const ingredient = recipe.ingredients[item.index];

            if (!ingredient) break;

            tokens.push({
              type: "ingredient",
              name: ingredient.name,
              amount: getQuantityValue(ingredient.quantity),
              // NOT canonicalized here — see the module docblock. `./pool` runs
              // `normalizeUnit` in the parent and renames this to `unit`.
              rawUnit: getQuantityUnit(ingredient.quantity),
            });
            break;
          }
          case "timer": {
            const timer = recipe.timers[item.index];

            if (!timer) break;

            tokens.push({
              type: "timer",
              name: timer.name ?? null,
              amount: getQuantityValue(timer.quantity),
              // a Cooklang TIME unit ("minutes"), not a norish ingredient unit —
              // deliberately NOT run through `normalizeUnit`, exactly as the
              // serializer deliberately does not normalize it on the way out.
              unit: getQuantityUnit(timer.quantity),
            });
            break;
          }
          case "cookware": {
            // Cookware has no token type in the W1 read model (W4 owns the
            // renderer); keep its name in the prose so the step still reads.
            const cookware = recipe.cookware[item.index];

            if (cookware) tokens.push(textToken(cookware.name));
            break;
          }
          case "inlineQuantity": {
            const quantity = recipe.inlineQuantities[item.index];

            if (quantity) tokens.push(textToken(quantity_display(quantity)));
            break;
          }
        }
      }

      steps.push({ order, section: section.name ?? null, tokens });
      order += 1;
    }
  }

  return steps;
}

function handle(request: CookParseRequest): CookParseResponse {
  try {
    const [recipe, report] = parser.parse(request.src, request.scale);

    return {
      id: request.id,
      ok: true,
      steps: toRawCookTokens(recipe),
      reportEmpty: typeof report !== "string" || report.trim() === "",
    };
  } catch (err) {
    // The MESSAGE only, never the source (T-27-05). A WASM trap surfaces here as
    // `RuntimeError: unreachable`; it was measured NOT to poison the parser, but
    // the pool discards this process anyway.
    return {
      id: request.id,
      ok: false,
      error: err instanceof Error ? `${err.name}: ${err.message}` : "unknown parse error",
    };
  }
}

process.on("message", (message: unknown) => {
  if (typeof message !== "object" || message === null) return;

  const request = message as Partial<CookParseRequest>;

  if (typeof request.id !== "number" || typeof request.src !== "string") return;

  const response = handle({
    id: request.id,
    src: request.src,
    ...(typeof request.scale === "number" ? { scale: request.scale } : {}),
  });

  process.send?.(response);
});

/**
 * Warm up BEFORE reporting ready, so the pool never pays the 15-20 ms WASM
 * instantiation or the ~29 ms first-parse JIT inside a request's wall-clock
 * bound. The source is a fixed two-token constant, not user data.
 */
parser.parse("Add @flour{200%gram} and wait ~{1%minute}.\n");

const ready: CookWorkerReady = { ready: true };

process.send?.(ready);
