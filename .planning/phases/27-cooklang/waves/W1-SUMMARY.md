# Phase 27 — W1 (Serializer + parser read-model) — SUMMARY

> Status: **CODE-COMPLETE**, gates green. Additive, un-wired, safe on `main`.
> Scope per `27-ARCHITECTURE.md` §7 (W1) + `27-CONTEXT.md` + plan `27-01-PLAN.md`.
> NO deploy, NO stack, NO DB, NO migration (DB stays at **41**), NO write-path wiring,
> NO renderer change. `unit-converter.ts`, `applyIngredientLinkMarkup`,
> `createIngredientLinkCandidates` and `SmartInstruction` are all UNTOUCHED (that is W6).

**Commits:** `40ad343e` (task 1) → `d850a546` (task 2) → `b4a0f555` (task 3) →
`c3253b13` (task 4) → `58cabd9f` (trpc mock fix). Base `8a78021a`.

## What shipped

### 1. `CookTokens` contract + nullable `cookSource`/`cookTokens` (task 1)

`packages/shared/src/contracts/zod/cook-tokens.ts` — a **plain-JSON** read model,
discriminated on `type`:

| Schema | Shape |
|---|---|
| `CookTextTokenSchema` | `{ type:"text", value }` |
| `CookIngredientTokenSchema` | `{ type:"ingredient", name, amount: number\|null, unit: string\|null }` |
| `CookTimerTokenSchema` | `{ type:"timer", name: string\|null, amount: number\|null, unit: string\|null }` |
| `CookStepTokensSchema` | `{ order, section: string\|null = null, tokens: CookToken[] = [] }` |
| `CookTokensSchema` | `CookStepTokens[]` |

`unit` is always the CANONICAL norish unit ID (D-8), never a localized label. No parser
index and no class instance can cross this contract. Barrel-exported from
`contracts/zod/index.ts`; DTO types `CookTokenDTO` / `CookStepTokensDTO` / `CookTokensDTO`
added to `contracts/dto/recipe.d.ts`.

`FullRecipeSchema` gains `cookSource: z.string().nullable().default(null)` and
`cookTokens: CookTokensSchema.nullable().default(null)` — **`.default(null)`, not merely
nullable** (D-27-W1-05), so every existing producer on the hot read path
(`packages/db/src/repositories/recipes.ts:234,:1182`, tRPC `.output()` at
`packages/trpc/src/routers/recipes/recipes.ts:155,172`) keeps parsing without supplying
them. Deliberately NOT added to `FullRecipeInsertSchema` / `FullRecipeUpdateSchema`
(W2 owns the write path) and NOT derived from drizzle (`recipes.cook_source` does not
exist until W2's `0041`).

### 2. `structuredToCooklang` productionized into `@norish/shared/cooklang` (task 2)

| File | Role |
|---|---|
| `packages/shared/src/cooklang/types.ts` | `StructuredRecipe` / `StructuredStep` / `StructuredIngredientRef` / `StructuredTimerRef` / `LinkOutcome` / `SerializeResult` (spike's `Spike*` prefix renamed). |
| `packages/shared/src/cooklang/serialize.ts` | `structuredToCooklang(recipe, units?)`, `serializeWithReport(recipe, units?)` (kept — W5's confidence gate needs `LinkOutcome[]`), `formatCooklangIngredient`, `formatCooklangTimer`. |
| `packages/shared/src/cooklang/index.ts` | Barrel. |
| `packages/shared/src/lib/ingredient-token.ts` | `normalizeIngredientLinkName` + the formerly-private `formatTokenAmount`, moved down (D-27-W1-04). |

`"./cooklang": "./src/cooklang/index.ts"` added to the `@norish/shared` exports map.
**`@norish/shared` gained NO dependency** — no `@cooklang/*` may reach the Expo bundle.

**The spike's vendored stand-ins are gone.** Units run through the REAL `normalizeUnit`
from `@norish/shared/lib/unit-localization` (optional `UnitsMap` argument; identity-behaved
without one), so `%unit` is guaranteed canonical (`gr` → `gram`, `EL` → `tablespoon`).
`formatUnit` is deliberately NOT used to build `%unit` — it returns a locale-dependent
display string and would destroy the D-8 verbatim round-trip; it is exercised as the
READ-side counterpart in the round-trip suite (D-27-W1-03).

`normalizeIngredientLinkName` is re-exported from
`packages/shared-react/src/text/ingredient-links.ts` so every existing consumer is
unaffected. **Verified byte-identical to `HEAD~`**: `applyIngredientLinkMarkup`,
`createIngredientLinkCandidates`, `formatIngredientLinkToken`, `formatIngredientLinkAmount`,
`getIngredientLinkCandidateKey`, `isIngredientLinkHref`, `parseIngredientLinkHref` and the
`IngredientLinkCandidate` type.

Behaviour (all asserted): `\n\n` between steps; `== Heading ==` for a `#`-prefixed step;
`@name{qty%unit}` / `@name{qty}` / bare `@salt` / `@sea salt{}`; longest-ingredient-name-first
matching ("brown sugar" beats "sugar"); unanchored refs APPENDED and reported as
`placement:"appended"`; YAML frontmatter carrying `norish.system: metric|us` (D-2); raw
alternates normalized before `%unit`; byte-identical output on repeated calls; input not
mutated.

### 3. `@cooklang/cooklang` dependency + `parse → cookTokens` server util (task 3)

**Supply chain (T-27-SC), verified BEFORE adding** via `pnpm view @cooklang/cooklang@0.18.7`:

- **license: `MIT`**
- **repository: `git+https://github.com/cooklang/cooklang-rs.git` (directory `typescript`)**
  — the official Rust/WASM parser, **not** the archived `cooklang-ts`
- **resolved version: `0.18.7`** — the line the spike validated
- lockfile entries: `pnpm-lock.yaml` carries `@cooklang/cooklang` at `0.18.7` (importer
  `packages/shared-server`, snapshot + resolution). `packages/shared-server/package.json`
  lists `"@cooklang/cooklang": "^0.18.7"` in `dependencies`. No npm/yarn artifacts.
- bundled binary `pkg/cooklang_wasm_bg.wasm` (2 090 790 bytes).

`packages/shared-server/src/cooklang/parse.ts` (exported as
`@norish/shared-server/cooklang/parse`):

- `toCookTokens(recipe, units?)` — pure projection of a `CooklangRecipe` **class instance**
  into plain JSON. Every `item.index` is dereferenced into `recipe.ingredients` /
  `recipe.timers`; quantities read via `getQuantityValue` / `getQuantityUnit`; `%unit`
  re-normalized through the real `normalizeUnit` (D-8); `== Heading ==` names ride along on
  each step as `section`; `order` is a recipe-wide running index over step content.
- `parseCookSource(cookSource, units?)` — `CookTokensDTO | null`, **never throws**.
- Module-level lazy `CooklangParser` singleton so the WASM module initialises once.
- Logging via `parserLogger` from `@norish/shared-server/logger`; no `console.log`.

### 4. Round-trip suite against the REAL WASM parser (task 4)

`packages/shared-server/__tests__/cooklang/round-trip.test.ts` (D-27-W1-02: this package
has both halves and a `node` vitest env). For all five ported fixtures: structured →
`.cook` → **real `CooklangParser`** → the SAME per-step ingredient names, amounts and units.
Also asserted: an EMPTY parser report for our own output; blank-line separation; D-8
verbatim units (`gram`, `tablespoon`) and **no localized label** (`%g}`, `%grams}`, `%EL}`, …)
anywhere in a `.cook`; the read-side `formatUnit` in three locales (`gram` → grams / gram / g,
`tablespoon` → tbsp / EL / eetlepels); headings as sections and never as prose steps; every
fixture timer; the inline/appended link report plus an explicit unanchored-ref case; the two
halves agreeing (`parseCookSource` over the serializer output). **No assertion from the
spike suite was weakened, skipped, `.todo`'d or `.skip`'d.**

## Decisions taken during execution

| # | Decision | Rationale |
|---|---|---|
| **W1-E1** | `parseCookSource` returns `null` when the parser emits ANY diagnostic (report non-empty), as well as for blank/non-string input, a throwing parser, or a step-less source. | Satisfies the plan's "garbage → null" contract honestly: `"@@@{{{"` and `"~{bad"` do NOT make the WASM parser throw, they warn and yield text-only steps. norish AUTHORS every `.cook` it stores (D-3), so a diagnostic means our own writer produced something the parser did not fully understand; rendering a partially-understood recipe is worse than falling back to the legacy path, and the signal is exactly what W5's confidence gate wants. |
| **W1-E2** | Timer units are NOT run through `normalizeUnit`, on either the write or the read side. | They are Cooklang TIME units ("minutes"), a different vocabulary from the norish ingredient units config (which has no time entries). Passing them through would be a no-op today but the wrong contract. |
| **W1-E3** | `cookware` items project to a **text** token (their name) and `inlineQuantity` items to a text token via `quantity_display`. | The W1 token model has exactly three types (per the plan). Dropping these items would silently corrupt the step prose; W4 owns any richer cookware rendering. |
| **W1-E4** | `serializeWithReport` kept as a public export alongside `structuredToCooklang`. | Per the plan — W5's confidence gate consumes `LinkOutcome[]`. |
| **W1-E5** | Serializer takes `units?: UnitsMap` as an optional second positional argument. | Mirrors `normalizeUnit(unit, config)` / `formatUnit(unit, locale, config, qty)` call style used everywhere else; keeps the function usable and identity-behaved without server config. |

## Deviations from the plan (and why)

1. **A serializer defect was found and fixed, changing behaviour vs the spike.**
   `quoteYaml` quoted every digit-leading value, so the frontmatter read `servings: "4"`.
   Cooklang types `servings` as a number and reported
   `Unsupported value for key: 'servings' — expected 'number' but got 'string'` for **all
   five fixtures**. Root cause fixed: plain numbers are now emitted unquoted (`servings: 24`),
   while values that would genuinely confuse YAML (`"15 min"`) stay quoted. Without this the
   W1-E1 "clean report" contract would have rejected our own output — the exact class of
   finding the plan told the executor to surface rather than accommodate.

2. **`pnpm add` was rejected in favour of the W0 precedent.**
   `pnpm --filter @norish/shared-server add @cooklang/cooklang@^0.18.7` re-resolved every
   caret range in the workspace (vitest 4.1.6 → 4.1.10, prettier 3.8.3 → 3.9.6,
   `@types/node`, tailwind, postcss …) — 1 738 insertions of unrelated churn — and then died
   on a root-owned `node_modules/@turbo/linux-64`. Reverted; the dependency was added to the
   manifest by hand and the lockfile regenerated with `pnpm install --lockfile-only` (the W0
   `convert` precedent). Result: **zero version bumps**; the 423/119-line lockfile diff is
   entirely the `@cooklang/cooklang` entries plus injected-workspace peer-hash rewrites.
   Verified minimal: with the manifest change stashed, `pnpm install --lockfile-only`
   produces a **zero** diff, so no pre-existing lockfile drift is being smuggled in.

3. **One file outside `files_modified` was touched:**
   `packages/trpc/__tests__/recipes/test-utils.ts` — `createMockFullRecipe` builds a
   `FullRecipeDTO` and two `recipes.getEditable` tests compare procedure output to it with
   `toEqual`. With `cookSource`/`cookTokens` defaulting to `null`, the parsed output carries
   both keys and the mock did not. The mock was brought back in line with the DTO it claims
   to be (2 keys, both `null`). No assertion weakened, no production code involved; the
   alternative (dropping the defaults) would break the read path and violate a must_have.

4. **`pnpm deps:cycles` cannot exit 0 — it is RED at baseline.**
   `check-circular-deps.mjs` reports `packages/db-schema/src/schema/auth.ts ->
   packages/db-schema/src/schema/households.ts` (the documented mutual-FK `AnyPgColumn`
   pattern from CLAUDE.md) and exits 1 **on the untouched tree at `8a78021a`** — verified by
   stashing. Because the script is chained with `&&`, `check-workspace-imports.mjs` never
   runs under `pnpm deps:cycles`. That second script is the one that actually gates this
   wave's helper move, so it was run directly: **`No workspace import issues found.` EXIT 0**
   — no `@norish/shared` → `@norish/shared-react` edge and no forbidden workspace import.
   Fixing the db-schema cycle is explicitly out of W1 scope (`packages/db-schema` must not
   change), so it is reported, not papered over.

5. **New source files contribute 0 lint warnings, at the cost of prettier-cleanliness on
   two of them.** The repo's `eslint import/order` (`groups: ["type", …]`,
   `newlines-between: "always"`) and `@ianvs/prettier-plugin-sort-imports` (`<TYPES>^@norish`
   / relative groups) give **irreconcilable** blank-line placement for any file importing
   both an `@norish` type and a relative type. The repo already carries ~5 such baseline
   warnings, and `pnpm format` is already red on 18 files across these three packages at
   baseline. Lint is the plan's stated gate, so lint won: `src/cooklang/serialize.ts` and
   `src/cooklang/parse.ts` use the eslint-canonical order and would be reformatted by
   `prettier --write`. All other new files are clean under both.

## Environment repair (sandbox only — no repo change)

The hoisted-linker gotcha bit exactly as `27-CONTEXT.md` warned, and worse than documented:
`node_modules/@norish/*` were **root-owned injected copies predating W0** (no `src/units/`
at all), so `@norish/shared/units` and `@norish/shared/cooklang` were **not resolvable from
any other package**, and the executor could not `cp` into them. Repaired by pointing each
injected copy's `src/` at the workspace source (`node_modules/@norish/<pkg>/src ->
../../../packages/<pkg>/src`) for `shared`, `shared-react` and `shared-server`, and
hard-linking their `package.json`s — so edits and new modules are live and can never go
stale again. The aborted `pnpm add` also deleted
`packages/{shared,shared-react,shared-server}/node_modules/@norish/`; those nine `link:`
symlinks were rebuilt exactly as `pnpm-lock.yaml` declares them. **None of this is in the
git tree**; a clean CI/docker `pnpm install` resolves everything from the lockfile.

## Gates / evidence

| Gate | Result |
|---|---|
| `pnpm typecheck` | **17/17 EXIT 0** |
| `@norish/shared` suite | **284/284** (W0 baseline 257 → +18 serialize, +9 cook-tokens; 0 net-new failures) |
| `@norish/shared-react` suite | **37/37** (baseline 37 — the helper move is transparent) |
| `@norish/shared-server` suite | **254/254** (baseline 215 → +12 parse, +27 round-trip), running the REAL WASM parser |
| `@norish/trpc` | 287 passed / **7 failed** — all `router-fan-out-isolation.test.ts`, all `connect ECONNREFUSED 127.0.0.1:5432` (needs a live Postgres; pre-existing sandbox gap) |
| `@norish/db` | 17 files passed / 2 failed — `cleanup-workflows`, `timer-keywords-config`, both `ECONNREFUSED :5432` (the known, unrelated environment limitation) |
| `@norish/api` · `auth` · `config` · `queue` · `web` · `mobile` | **350 · 133 · 712 · 88 · 424 · 132**, all EXIT 0 |
| `pnpm --filter @norish/db test zodSchemas` | **8/8** |
| lint `@norish/shared` | 0 errors, **45 warnings = baseline**; new files contribute 0 |
| lint `@norish/shared-server` | 0 errors, **57 warnings = baseline**; new files contribute 0 |
| lint `@norish/shared-react` | 0 errors, **208 warnings = baseline** |
| `check-workspace-imports.mjs` | EXIT 0 — no forbidden workspace edge |
| `check-circular-deps.mjs` | EXIT 1 — **pre-existing** db-schema `auth ↔ households` cycle, identical at `8a78021a` |
| `pnpm --filter @norish/web build:server` | **EXIT 0** |
| `pnpm i18n:check` | EXIT 1, output **byte-identical to baseline** (the pre-existing `no`-locale 68-key gap). W1 adds no user-facing strings; zero new gaps. |
| `pnpm docker:build` | **NOT RUN** — the build is the director's job (CLAUDE.md). See "W1 exit items". |

### The two WASM risks, retired EMPIRICALLY

1. **WASM under vitest — retired, no configuration needed.** The real parser runs in
   `@norish/shared-server`'s `node` vitest environment with **no flag and no config change**;
   Node 22 imports WebAssembly module instances natively and emits only
   `ExperimentalWarning: Importing WebAssembly module instances is an experimental feature`.
   The e2e harness's `NODE_OPTIONS=--experimental-wasm-modules` is a leftover from an older
   Node line, not a requirement. **Nothing had to be landed**, so nothing was.
2. **WASM in the server bundle — tsdown leg retired.**
   `pnpm --filter @norish/web build:server` EXIT 0. Because W1 is unwired nothing imports the
   parser yet, so that alone only proves the build is not broken; the resolution leg was
   proven directly instead: plain Node 22 ESM
   `await import("@cooklang/cooklang")` → constructs `CooklangParser` and parses
   `Mix @flour{200%gram}.` correctly, **with no flag**, from `/opt/norish-src`.
   `@cooklang/cooklang` will be **external** in the server bundle (`noExternal` is
   `@norish/*` only) and resolves from `node_modules`.

## Security

Per the plan's `<threat_model>`, and **verified against the diff, not assumed**: the diff
contains **no** tRPC procedure, **no** realtime emit site, **no** repository query, **no**
`where` clause, **no** route handler, **no** permission check and **no** migration. Nothing
under `packages/db/src/migrations/`, `packages/db-schema/`, `apps/web/app/(app)/recipes/`,
`apps/web/components/recipe/` or `apps/mobile/` is touched, and nothing is deleted from
`packages/shared-react/src/text/ingredient-links.ts` beyond the two relocated helpers.
The serializer and the parse util accept **no `ctx`, no household id, no user id, no db
handle**. HOUSE-06 and the `view:"everyone"` clamp are therefore untouched by construction.

- **T-27-SC (supply chain):** mitigated — license/repository/version verified before adding
  and recorded above; pinned via `pnpm-lock.yaml`.
- **T-27-01 (DoS on hostile `.cook`):** partially mitigated by design —
  `parseCookSource` returns `null` and never throws. **Input-size limiting and rate
  considerations are W2's**, where untrusted text first reaches the parser.
- **T-27-02 (`cookSource`/`cookTokens` disclosure):** accepted — both default to `null` and
  no producer sets them in W1, so the DTO carries no new data.
- **T-27-03 (helper move):** mitigated — `@norish/shared-react` suite green and the retained
  exports byte-identical to `HEAD~`.
- **Adversarial revert-check: N/A this wave, as a reasoned exclusion, not an omission** —
  there is no boundary predicate in the W1 diff to weaken. It returns in force in **W2**,
  where `deriveProjectionTx` first writes rows and `cookTokens` first reaches a scoped
  procedure.

## W1 exit items for the DIRECTOR

- `pnpm docker:build` + an **in-image** confirmation that `@cooklang/cooklang` survives
  `pnpm deploy --filter @norish/web --prod` into `/app/deploy/node_modules` and loads its
  `.wasm` under the production Node runtime. Executor-side evidence (tsdown EXIT 0 + a
  flag-free Node 22 ESM load) is green; the image leg is the director's.

## What W2 can now assume

- `structuredToCooklang(recipe, units?)` is importable from **`@norish/shared/cooklang`**,
  is pure, and emits canonical unit IDs into `%unit` — proven verbatim against the real
  parser on five fixtures.
- `serializeWithReport` returns `LinkOutcome[]` with `placement:"inline"|"appended"` — the
  confidence signal W5 needs is already produced.
- `parseCookSource(cookSource, units?)` / `toCookTokens(recipe, units?)` are importable from
  **`@norish/shared-server/cooklang/parse`**, reachable from `@norish/trpc`, `@norish/queue`,
  `@norish/auth`, `@norish/api` and `apps/web`. Output is `structuredClone`-able plain JSON
  that validates against `CookTokensSchema`, with all parser indices dereferenced.
- `FullRecipeSchema.cookSource` / `.cookTokens` exist, default to `null`, and are safe to
  populate — W2 only has to start setting them.
- **The `.cook` a producer writes must parse with an EMPTY report**, or `parseCookSource`
  will refuse to build a read model. W2's `deriveProjectionTx` should treat a `null` return
  as "keep the legacy projection" and surface it, not swallow it.
- `order` on `CookStepTokens` is a recipe-wide running index over step content, and
  `section` is the `== Heading ==` name (or `null`) — headings are NOT steps.
- Still open from W0, still unaddressed: no `kilogram` / `fl oz` / `pint` canonical unit IDs,
  and the density table is ~29 ingredients (W2 / W5 follow-ups).
