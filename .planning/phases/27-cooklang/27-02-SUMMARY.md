# 27-02 — Write path + `0041` (Phase 27, WAVE 2) — SUMMARY

**Plan:** `.planning/phases/27-cooklang/27-02-PLAN.md` (execute, wave 2, `autonomous: true`,
`cross_ai: false` — executed natively).
**Requirement:** COOK-01. **Status: CODE-COMPLETE, gates green. Server half only; the
renderer is W4.**

The substantive record — what shipped, the three risks and how each was defused, the
adversarial revert-check, decisions, deviations, evidence, security and the hand-off to W3 —
lives in **`.planning/phases/27-cooklang/waves/W2-SUMMARY.md`**, continuing the wave-summary
convention. This file is the plan-level index.

## Tasks → commits

| Task | Commit | Result |
|---|---|---|
| 1. `0041` expand migration + drizzle schema + the contract fallout | `9f548b96` | 11 new db tests (columns, index, the constraint biting, the FK-safe de-dup replayed from the migration file) + 11 contract assertions that actually PARSE a dashboard payload. |
| 2. `deriveProjectionTx` — UPSERT-stable derived projection, both systems, no parser | `5e915523` | 22 new db tests: grocery-FK preservation across an edit, step-id/step-image preservation, both systems, duplicate-token collapse, headings, scoping. `@norish/db` gained no dependency. |
| 3. Write-path wiring — `buildCookPayload`, the optional `cook` argument, both constraint fallouts | `0f74fb3a` | 14 shared-server + 10 db + 6 trpc tests. No-`cook` behaviour proven unchanged; both 500-risks closed; toggle predicate extracted and tested. |
| 4. Read path — `cookSource` + `cookTokens` on the permission-scoped procedures only | `3b0d42fc` | `withCookTokens` at exactly two call sites, both after the guard; 7 new failure-mode tests. |
| 5. Isolation proof + the adversarial revert-check | `f4280a55` | 22 trpc + 5 db isolation tests, every policy case with its `view: "everyone"` sibling. W-1/W-1b/W-2/W-3 each turned a suite RED and were reverted byte-identical. |
| — `apps/web/tsdown.config.ts`: keep the WASM parser external (outside `files_modified`) | `a896dae1` | `build:server` EXIT 0 again; see deviation 1 in the wave summary. |

Base `8d541fb4`. Net-new tests: **+139**. `pnpm typecheck` 17/17; lint 0 errors with
warnings exactly at baseline in all five touched packages; `check-workspace-imports.mjs`
EXIT 0; `i18n:check` byte-identical to baseline.

## Not done here, by design

`0041` was **not applied to the live database** (it applies at container boot on a future
deploy), `pnpm db:generate` was **not run** (forbidden — snapshots stopped at `0038`), and
`pnpm docker:build` was **not run** (the director's job). No producer of `.cook` exists yet,
so every recipe still has `cook_source IS NULL` and no user-visible behaviour changed.
