# Phase 27: Cooklang migration (COOK-01) — Context

**Gathered:** 2026-07-24
**Status:** Ready for planning — **this context covers WAVE 1 ONLY**
**Requirements:** COOK-01 (source: ROADMAP Phase 27)
**Master plan:** `.planning/phases/27-cooklang/27-ARCHITECTURE.md` (authoritative; §7 = the wave table)
**Locked decisions:** `.planning/phases/27-cooklang/27-DECISIONS.md`

<domain>
## Phase Boundary — and the wave boundary inside it

Phase 27 is **wave-structured**: seven waves (W0–W6) under an expand→migrate→contract
discipline, sequenced so **the app is never broken between waves** (`27-ARCHITECTURE.md` §7).
This CONTEXT is scoped to **W1 and nothing else**.

### Where the phase stands

- **W0 — Units subsystem: DONE.** Shipped `packages/shared/src/units/` (`@norish/shared/units`):
  `convertToUnit` / `convertToSystem` / `deriveConversion` over `convert@7.0.2` (MIT) plus a
  config-as-code USDA-distilled density table with a flag-on-unknown guarantee. 32 tests,
  gates green, additive and un-wired. Commit `a4f9c2a5`; see `waves/W0-SUMMARY.md`.
- **W1 — Serializer + parser read-model: THIS CONTEXT / plan `27-01-PLAN.md`.**
- **W2–W6 — NOT IN SCOPE HERE.** Deferred, *not* dropped (see `<deferred>`).

### W1 deliverable (from `27-ARCHITECTURE.md` §7, row W1)

> "Move `structuredToCooklang` into `@norish/shared` (real `formatUnit`); add
> `@cooklang/cooklang` parse→`cookTokens` server util; add `cookSource`/`cookTokens` to
> DTO (nullable). **Never-broken guarantee: additive; renderers still use old path.**"

Concretely, four things and only these four:

1. The pure serializer `structuredToCooklang` moves out of `.planning/phases/27-cooklang/spike/`
   into `@norish/shared`, rewritten against the **real** `unit-localization` module instead of
   the spike's vendored stand-ins.
2. `@cooklang/cooklang` (MIT, WASM, `^0.18.7` — **not** the archived `cooklang-ts`) becomes a
   real workspace dependency, resolved through pnpm and present in `pnpm-lock.yaml`.
3. A server-side `parse → cookTokens` utility wrapping that parser.
4. Nullable `cookSource` / `cookTokens` on the recipe DTO / zod contracts — **unwired**: no
   producer sets them, no consumer reads them, no DB column exists yet.

### The never-broken guarantee, stated as a constraint on the executor

W1 is **purely additive**. After W1:

- Cooking mode, recipe detail, mobile and the timer-keyword scan still run the **existing**
  `SmartInstruction` / `applyIngredientLinkMarkup` heuristic path, byte-for-byte unchanged in
  behaviour. W1 deletes **nothing** from the runtime render path.
- `recipes.cook_source` does **not** exist as a column. The DTO fields are contract-only and
  default to `null`, so every existing `FullRecipeSchema.parse(...)` call site keeps working
  without supplying them.
- No tRPC procedure, realtime emit, repository query, permission check or migration changes.

</domain>

<decisions>
## Decisions carried forward from `27-DECISIONS.md` (locked — do not relitigate)

These are the locked decisions that actually constrain W1. The rest of `27-DECISIONS.md`
constrains later waves and is listed under `<deferred>`.

### D-3 — AI emits structured JSON with per-step refs; a PURE serializer emits `.cook`
The model never writes Cooklang directly. `structuredToCooklang` is a **pure, dependency-free,
unit-testable function**: structured recipe in, `.cook` string out. No I/O, no DB, no network,
no `Math.random()`, no locale-dependent output. W1 productionizes exactly this function.

### D-4 — Serializer home = FORK-LOCAL in `@norish/shared`
No upstream-contribution constraint (upstream #470 no longer gates the fork). The spike
vendored its helpers inline only because it is a standalone project outside the workspace.

### D-8 — Canonical unit ID is serialized as the `%unit` literal; `normalizeUnit` on parse
**CONFIRMED in the spike:** Cooklang treats `%unit` as an opaque string, so canonical norish
unit IDs (`gram`, `tablespoon`) round-trip **verbatim** with zero conversion loss. This is the
single most load-bearing fact for W1's round-trip test.

### D-2 (as reversed) — ONE native system per `.cook`
The `.cook` carries one system, recorded as `norish.system: metric|us` in YAML frontmatter.
The opposite system is derived deterministically by the W0 units module — **at derive time in
W2**, never inside the serializer. The W1 serializer must not convert anything.

### Confirmed parser facts (`@cooklang/cooklang@0.18.7`, verified against the real package)
- `import { CooklangParser, getQuantityValue, getQuantityUnit, type CooklangRecipe }`.
  `new CooklangParser().parse(src, scale?)` → `[CooklangRecipe, reportHtmlString]`. There is
  **no default export**, and the class is `CooklangParser`, not `Parser` (`Parser` is the raw
  WASM binding, re-exported but not the intended API).
- `recipe.sections: Section[]`; `Section = { name: string|null, content: Content[] }`;
  `Content = { type:"step", value: Step }`; `Step = { items: Item[] }`.
- `Item = { type:"text", value:string } | { type:"ingredient"|"cookware"|"timer", index:number }`
  — ingredient/timer items carry an **index into `recipe.ingredients` / `recipe.timers`**, not
  inline data. The read-model util MUST dereference the index; a token model that ships the
  raw index to a client would be useless.
- **Steps are separated by a BLANK line (`\n\n`).** Single newlines merge into one step.
- `== Heading ==` = section; `~name{n%unit}` = timer; `#pot{}` = cookware.
- Metadata = YAML frontmatter (`---`); the legacy `>> k: v` form is deprecated.
- `CooklangRecipe` is a **class instance**, not a plain object — the util must project it into
  plain JSON before it can cross the tRPC/superjson boundary.

### Decisions taken FOR W1 in this context (new; recorded here because the executor needs them)

#### D-27-W1-01 — The parse util lives in `@norish/shared-server`, NOT `@norish/api`
Decided from the actual import graph (`node -e` over every workspace `package.json`):

```
@norish/shared        -> config, db-schema                      (consumed by mobile + web)
@norish/shared-server -> config, db, i18n, shared               (consumed by trpc, queue, auth, api, web)
@norish/api           -> auth, config, db, i18n, queue, shared, shared-server, trpc
```

- `@norish/api` is a **leaf**: only `apps/web` depends on it, and `@norish/api` itself depends
  on `@norish/trpc`. Hosting the parse util there would make it unreachable from
  `@norish/trpc` (where the recipe `get`/`getById` procedures that will ship `cookTokens` in
  W2 live) and from `@norish/queue` (the import worker) — and any attempt to reach back would
  be a dependency cycle.
- `@norish/shared-server` is already the fork's home for server-only recipe logic that trpc
  consumes (`recipes/randomizer`, `recipes/dinner-suggester` from Phase 26) and is a dependency
  of trpc, queue, auth, api and web. It is the only package that reaches every future consumer.
- **The parser must not go into `@norish/shared`**: `@norish/shared` is imported by
  `apps/mobile` (Expo/RN). `27-ARCHITECTURE.md` §1.3 requires clients to render plain-JSON tokens and
  **never** run the WASM parser. Putting `@cooklang/cooklang` in `@norish/shared` would drag a
  WASM binary into the React Native bundle. This is why the serializer (pure) and the parser
  (server-only) are deliberately split across two packages.

#### D-27-W1-02 — Split of homes: serializer in `@norish/shared`, parser in `@norish/shared-server`
`@norish/shared-server` depends on `@norish/shared`, so the round-trip test (serializer output
→ real WASM parser) can live in `@norish/shared-server`, which has both halves **and** a `node`
vitest environment. `@norish/shared`'s vitest environment is `jsdom` — a poor host for a WASM
node module. Pure serializer tests stay in `@norish/shared`; every WASM-touching test lives in
`@norish/shared-server`.

#### D-27-W1-03 — `%unit` carries the CANONICAL unit ID; `formatUnit` is the render-side counterpart
The W1 brief says the serializer must use the **real** `formatUnit`
(`packages/shared/src/lib/unit-localization.ts:134`) instead of the spike's stand-ins. Resolved
as follows, because a literal reading conflicts with D-8:

- `formatUnit(unitId, locale, config, qty)` returns a **locale-dependent display string**
  (`"g"`, `"grams"`, `"gr"`). Writing that into `%unit` would make the `.cook` locale-dependent
  and destroy the verbatim round-trip that D-8 is built on.
- Therefore the serializer emits the **canonical unit ID** into `%unit` (D-8, exactly as the
  spike already does), and uses the **real** `normalizeUnit` from that same
  `@norish/shared/lib/unit-localization` module to guarantee that what it emits *is* a
  canonical ID before it writes it.
- `formatUnit` is the **counterpart on the read side** and is asserted as such: the round-trip
  test proves `formatUnit(parsedUnit, locale, unitsConfig, parsedAmount)` reproduces the
  expected human-readable label from the parser's output. That is the real, correct use of the
  real `formatUnit` in W1, and it is how the existing UI already works
  (`useUnitFormatter` → `formatUnit`, `packages/shared-react/src/hooks/use-unit-formatter.ts`).
- Net effect: **the spike's vendored unit handling is fully replaced by the real
  `unit-localization` module**, which is the substance of the instruction, without breaking D-8.

#### D-27-W1-04 — The spike's other stand-ins are replaced by MOVING the real helpers down, not by copying
The spike's `normalizeName` / `formatAmount` mirror `normalizeIngredientLinkName` and the
private `formatTokenAmount` in `packages/shared-react/src/text/ingredient-links.ts`.
`@norish/shared` **cannot** import from `@norish/shared-react` (shared-react depends on shared;
`pnpm deps:cycles` enforces this). So the two pure helpers **move down** into `@norish/shared`
and `ingredient-links.ts` **re-exports** them — zero behaviour change, zero duplication,
nothing deleted. (`applyIngredientLinkMarkup` and `createIngredientLinkCandidates` are **not**
touched; their deletion is W6.)

#### D-27-W1-05 — The new DTO fields must default to `null`, not merely be nullable
`FullRecipeSchema` is `createSelectSchema(recipes).extend(...)` and is `.parse()`d on the hot
read path (`packages/db/src/repositories/recipes.ts:234`, `:1182`). A bare
`z.string().nullable()` would make the key **required** and break every existing producer.
The fields are added as explicitly nullable **with `.default(null)`**, so existing callers that
supply neither field keep parsing. They are *not* derived from the drizzle table, because the
`recipes.cook_source` column does not exist until W2's `0041`.

#### D-27-W1-06 — No migration, no schema change, no DB touch
DB stays at migration **41**. W1 adds zero migration files. `packages/db-schema` is untouched.

</decisions>

<security>
## Security scoping (the gate is scoped, NOT weakened)

**W1 touches no permission boundary.** Stated explicitly so the security gate is calibrated
correctly — and stated *as a claim the executor must verify*, not as permission to skip:

- No new tRPC procedure, no new realtime emit site, no change to any repository query, no
  change to `buildViewPolicyCondition` / `canAccessResource` / `emitByPolicy`, no change to
  any `where` clause, no new route handler.
- HOUSE-06 (per-cookbook isolation) and the `view:"everyone"` clamp (AGENTS.md) are
  **untouched by construction**: W1 adds a pure function, a pure parse projection over a string
  the caller already possesses, and two contract fields nobody reads.
- The serializer and parse util take **no `ctx`, no household id, no user id, no db handle**.
  If a W1 task finds itself needing one, the task has drifted out of scope — stop.

**Therefore the standard adversarial revert-check (weaken the boundary → suite goes RED →
revert byte-identical) is NOT APPLICABLE this wave** — there is no boundary predicate in the
W1 diff to weaken. This is recorded as an explicit, reasoned N/A, not an omission. It returns
in force in **W2**, where `deriveProjectionTx` first writes rows and the `cookTokens` read
model first reaches a scoped procedure.

**What the gate DOES cover in W1** — a genuine supply-chain surface:

- `@cooklang/cooklang@^0.18.7` is a **new third-party dependency shipping a compiled WASM
  binary** (`pkg/cooklang_wasm_bg.wasm`, built from `cooklang/cooklang-rs`). License, publisher,
  version pin and provenance must be verified before it is added — see the plan's
  `<threat_model>` (T-27-01/T-27-SC).
- The parser will eventually consume **untrusted, user-supplied recipe text**. In W1 nothing
  untrusted reaches it, but the util's failure mode must already be defined: parse failure
  returns `null` and never throws into a request path.

</security>

<code_context>
## Existing code the executor must build on (grounded, verified this session)

### Reusable assets
- `packages/shared/src/lib/unit-localization.ts` — `normalizeUnit` (raw → canonical ID, line 50)
  and `formatUnit` (canonical ID → localized display, line 134). Both real, both tested
  (`packages/shared/__tests__/lib/unit-localization.test.ts`). `UnitsMap` comes from
  `@norish/config/zod/server-config`.
- `packages/shared/src/units/` (`@norish/shared/units`, W0) — deterministic conversion. **W1
  does not call it**; it is listed so the executor recognises it as already-owned territory and
  does not re-implement or re-wire it.
- `packages/shared-react/src/text/ingredient-links.ts` — `normalizeIngredientLinkName` (line 22),
  `formatIngredientLinkToken` (71), `formatIngredientLinkAmount` (88), private
  `formatTokenAmount` (245). Source of the two helpers moved down per D-27-W1-04.
- `.planning/phases/27-cooklang/spike/` — `structured-to-cooklang.ts` (the prototype),
  `fixtures.ts` (**five realistic hand-built norish recipes with per-step `expected` amounts —
  this is the eval material to port**), `structured-to-cooklang.test.ts` (the round-trip
  harness against the real WASM parser).

### Established patterns to mirror
- **Export surface:** both `@norish/shared` and `@norish/shared-server` use explicit, per-path
  `exports` maps in `package.json` (e.g. `"./units": "./src/units/index.ts"`,
  `"./recipes/dinner-suggester": "..."`). A new module is not importable until its entry is
  added. `@norish/shared` additionally has a `"./lib/*"` wildcard.
- **Tests:** `packages/<pkg>/__tests__/<area>/<name>.test.ts`, run with
  `vitest run --config ./vitest.config.ts`. `@norish/shared` = **jsdom** env,
  `@norish/shared-server` = **node** env (with DB/env stubs pre-set in its vitest config).
- **Contracts:** zod schemas in `packages/shared/src/contracts/zod/*.ts`, barrel-exported from
  `zod/index.ts`; the matching DTO **types** are declared in
  `packages/shared/src/contracts/dto/recipe.d.ts` as `z.output<typeof Schema>`.
- **Package boundaries** are machine-enforced: `pnpm deps:cycles` runs
  `check-circular-deps.mjs` + `check-workspace-imports.mjs`, with an explicit
  `FORBIDDEN_EDGES` table (`@norish/shared` may not import auth/db/queue/trpc).
- **i18n:** unit display strings come from the units server-config via `formatUnit`, per
  viewer locale, on the client. W1 adds **no user-facing strings**, so `pnpm i18n:check` is
  expected to be unchanged (it currently exits 1 solely on the pre-existing `no`-locale gap).

### Integration points (where W1's output will be consumed — in W2, not now)
- `packages/shared/src/contracts/zod/recipe.ts` → `FullRecipeSchema` (line 58), `.parse`d at
  `packages/db/src/repositories/recipes.ts:234` and `:1182`, and used as the tRPC `.output()`
  at `packages/trpc/src/routers/recipes/recipes.ts:155,172`.
- The serializer's future caller is the extraction/import path (W3); the parse util's future
  callers are the recipe read path (W2) and `deriveProjectionTx` (W2).

### Known environment hazards (both have bitten this repo already)
- **Hoisted-linker gotcha:** `node_modules/@norish/*` are root-owned injected hardlink farms.
  Edits to *existing* `src/**` files are live, but **new modules and `package.json` export-map
  changes go stale** and break cross-package resolution until re-synced
  (`cp -a packages/<pkg>/src/. node_modules/@norish/<pkg>/src/`). W0 and Phase 26 both hit this.
- **`convert` precedent (W0):** a new npm dependency needs `pnpm install --lockfile-only` to
  regenerate `pnpm-lock.yaml`, plus a hand-placement into the sandbox's root `node_modules`;
  a clean CI/docker install resolves it from the lockfile.

</code_context>

<risks>
## Risks the W1 executor must retire EMPIRICALLY (do not assume)

1. **WASM under vitest.** `@cooklang/cooklang` is a `wasm-pack --target bundler` build:
   `pkg/cooklang_wasm.js` does `import * as wasm from "./cooklang_wasm_bg.wasm"`, which plain
   Node ESM only accepts under `--experimental-wasm-modules`. The evidence in-repo is
   *contradictory*: the serializer spike runs vitest with no flag, while the e2e harness sets
   `NODE_OPTIONS=--experimental-wasm-modules` for its vitest run. The executor must **run the
   test and observe** which is true for `@norish/shared-server`'s vitest config, and if a flag
   or a vite plugin is required, land that configuration as part of the task — not as a TODO.
2. **WASM in the docker/server bundle.** `apps/web` builds its server via tsdown with
   `noExternal: [/^@norish\//]` — workspace packages are inlined, everything else stays
   external and is resolved from `node_modules` at runtime. `@cooklang/cooklang` will therefore
   be **external**, and must (a) survive `pnpm deploy --filter @norish/web --prod` into
   `/app/deploy/node_modules` (it will, transitively via `@norish/shared-server`, but this must
   be confirmed) and (b) actually load its `.wasm` under the production Node runtime. The
   executor confirms the tsdown leg (`pnpm --filter @norish/web build:server`, seconds). The
   full `pnpm docker:build` + in-image confirmation is the **director's** job per CLAUDE.md and
   is a W1 exit item, not an executor task.
3. **Round-trip fidelity is the whole point of the wave.** The spike de-risked exactly this:
   structured → `.cook` → real WASM parser → the same per-step amounts. If the ported round-trip
   suite cannot reproduce the spike's result with the real helpers substituted in, that is a
   genuine finding about the helper substitution, not a test to relax.
4. **Longest-name-first matching is load-bearing** (proven in `27-EXPERIMENT.md`): "brown sugar"
   must win over "sugar". It must survive the port and be pinned by a test.
5. **Hoisted-linker staleness** (see `<code_context>`) — new modules + two `package.json`
   export-map changes in one wave is precisely the shape that broke Phase 26's suites.

</risks>

<deferred>
## Explicitly OUT of W1 scope — deferred, NOT dropped

Every item below is real, planned, and owned by a later wave in `27-ARCHITECTURE.md` §7. A W1 task
that starts touching one of these has drifted; stop and surface it rather than expanding.

| Deferred item | Owner |
|---|---|
| Migration `0041` (`cook_source`/`cook_confidence`/`cook_review_needed` columns, the `(recipe_id, system_used, ingredient_id)` unique index) | **W2** |
| `deriveProjectionTx` — transactional derived projection, UPSERT-stable natural key, grocery-FK preservation | **W2** |
| Any write-path wiring: `createRecipeWithRefs`, `updateRecipeWithRefs`, `syncRecipeIngredientsTx`, `syncRecipeStepsTx` | **W2** |
| Shipping `cookTokens` in an actual tRPC response / transitional tokens-else-old-path read fork | **W2** |
| Extraction changes: the 3 prompt builders, `recipe-extraction.txt`, `recipe.schema.ts`, JSON-LD `normalize.ts` | **W3** |
| Token renderer (web + mobile), deleting the runtime heuristic path | **W4** |
| Multi-timer / retiring the timer-keyword scan | **W4** |
| Backfill `0042`, confidence gate, review queue + repair tool (**pauses for Kiran's explicit sign-off**) | **W5** |
| `0043` NOT-NULL contract; deleting `unit-converter.ts`, `applyIngredientLinkMarkup` / `createIngredientLinkCandidates` / `SmartInstruction` markup, the transitional fork | **W6** |
| Adding `kilogram` / `fl oz` / `pint` canonical unit IDs; expanding the ~29-row density table | W2 / W5 (W0 follow-ups) |
| `.cook` file import/export UX, ingest-pipeline overhaul, upstream contribution | Phase 31 / §9 |

</deferred>

<references>
- `.planning/phases/27-cooklang/27-ARCHITECTURE.md` — master plan; §1 target architecture, §2 consumer
  blast radius, §3 units, §7 wave table, §8 risks/isolation
- `.planning/phases/27-cooklang/27-DECISIONS.md` — locked decisions + confirmed parser facts
- `.planning/phases/27-cooklang/waves/W0-SUMMARY.md` — what W0 delivered (`a4f9c2a5`)
- `.planning/phases/27-cooklang/27-EXPERIMENT.md` — where the lossy tail and the
  longest-name-first finding come from
- `.planning/phases/27-cooklang/spike/` — the committed prototype + fixtures + round-trip harness
- `CLAUDE.md` (hard constraints; build ownership), `AGENTS.md` (HOUSE-06, `view:"everyone"`)
</references>

---

*Phase: 27-cooklang — Wave 1*
*Context gathered: 2026-07-24*
</content>
</invoke>
