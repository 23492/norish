# 27-01 — Serializer + parser read-model (Phase 27, WAVE 1) — SUMMARY

**Plan:** `.planning/phases/27-cooklang/27-01-PLAN.md` (execute, wave 1, `autonomous: true`,
`cross_ai: false` — executed natively).
**Requirement:** COOK-01. **Status: CODE-COMPLETE, gates green, additive and un-wired.**

The substantive record — what shipped, decisions, deviations, evidence, security and the
hand-off to W2 — lives in **`.planning/phases/27-cooklang/waves/W1-SUMMARY.md`**, continuing
the wave-summary convention established by `waves/W0-SUMMARY.md`. This file is the plan-level
index.

## Tasks → commits

| Task | Commit | Result |
|---|---|---|
| 1. `CookTokens` contract + nullable `cookSource`/`cookTokens` on `FullRecipeSchema` | `40ad343e` | 9 new tests; back-compat regression proven (a payload with neither key parses, both come back `null`). |
| 2. `structuredToCooklang` into `@norish/shared/cooklang` on the REAL unit helpers | `d850a546` | 18 new pure tests; helpers moved down to `@norish/shared/lib/ingredient-token` and re-exported; the retained `ingredient-links` exports byte-identical to `HEAD~`. |
| 3. `@cooklang/cooklang@^0.18.7` (MIT, `cooklang/cooklang-rs`) + `parse → cookTokens` util | `b4a0f555` | 12 new tests; real WASM under vitest with no flag; `build:server` EXIT 0. Includes a real serializer fix (numeric YAML metadata) surfaced by the parser. |
| 4. Round-trip suite through the REAL WASM parser on the five eval fixtures | `c3253b13` | 27 new tests; per-step amounts + canonical units survive; `formatUnit` asserted in three locales. |
| — trpc `FullRecipeDTO` mock brought in line with the DTO (outside `files_modified`) | `58cabd9f` | `recipes.getEditable` assertions green again. |

Base `8a78021a`.

## must_haves — status

| Truth | Status |
|---|---|
| `structuredToCooklang` importable from `@norish/shared/cooklang`, pure, canonical unit IDs in `%unit` (D-8) | **MET** |
| A `.cook` from `structuredToCooklang` parses under the REAL `@cooklang/cooklang` WASM parser and yields the SAME per-step amounts and units | **MET** (5/5 fixtures) |
| `parseCookSource` returns plain-JSON `cookTokens` with indices dereferenced, `null` (never throws) on invalid input | **MET** |
| `FullRecipeSchema` carries nullable `cookSource` + `cookTokens` defaulting to `null`; every existing producer parses unchanged | **MET** |
| No renderer, procedure, repository query, permission check or migration changed | **MET** (verified against `git diff 8a78021a`) |

| Artifact | Status |
|---|---|
| `packages/shared/src/cooklang/serialize.ts` | present |
| `packages/shared/src/contracts/zod/cook-tokens.ts` | present |
| `packages/shared-server/src/cooklang/parse.ts` | present |
| `packages/shared-server/__tests__/cooklang/round-trip.test.ts` | present |

## Gates (headline)

`pnpm typecheck` **17/17 EXIT 0** · `@norish/shared` **284/284** · `@norish/shared-react`
**37/37** · `@norish/shared-server` **254/254** (real WASM) · lint **0 errors**, warnings at
baseline in all three packages, new files contribute 0 · `check-workspace-imports.mjs`
**EXIT 0** · `pnpm --filter @norish/web build:server` **EXIT 0** · `i18n:check` output
byte-identical to baseline.

Known reds, both **pre-existing and unrelated**: `check-circular-deps.mjs` (db-schema
`auth ↔ households`, red at `8a78021a` too, so `pnpm deps:cycles` cannot exit 0), and the
`ECONNREFUSED :5432` suites in `@norish/db` and `@norish/trpc` that need a live Postgres.

`pnpm docker:build` was **not** run — the build is the director's job (CLAUDE.md); the
in-image WASM confirmation is the W1 exit item recorded in `waves/W1-SUMMARY.md`.
