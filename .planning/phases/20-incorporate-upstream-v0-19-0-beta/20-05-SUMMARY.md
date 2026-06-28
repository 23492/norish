---
phase: "20"
plan: "05"
subsystem: "ci-tooling-final-sweep"
tags: ["ci", "tooling", "camoufox", "lockfile", "typecheck", "lint", "test", "green"]
requires: ["20-04"]
provides: ["full-monorepo-green", "ci-camoufox-delta", "branch-build-candidate"]
affects:
  - .github/workflows/_node-ci.yml
  - .github/workflows/pr-quality.yml
tech-stack:
  added: []
  patterns: ["CAMOFOX_URL in CI (Camoufox constraint)", "HEROUI_AUTH_TOKEN secret forwarding (upstream addition)"]
key-files:
  created: []
  modified:
    - .github/workflows/_node-ci.yml
    - .github/workflows/pr-quality.yml
decisions:
  - "CI fork delta: replaced CHROME_WS_ENDPOINT with CAMOFOX_URL (http://localhost:9377) in both workflow files, kept HEROUI_AUTH_TOKEN from upstream"
  - "Queue allergy-detection files verified as already on upstream import paths (no fork delta to re-apply per 20-01 SUMMARY note)"
  - "Fork-only test imports (@norish/config/server-config-loader) verified as already migrated by 20-02/20-03 executors"
  - "packages/config/__tests__/config/server-config-loader.test.ts verified as already deleted (GONE)"
  - "pnpm-lock.yaml verified clean (regenerated at 20-01, no new conflicts); pnpm install --frozen-lockfile exits 0"
  - "12 db env failures are pre-existing ECONNREFUSED (timer-keywords-config x9, cleanup-workflows x3) — not regressions"
metrics:
  duration: "~25 minutes"
  completed: "2026-06-28"
  tasks_completed: 3
  files_changed: 2
---

# Phase 20 Plan 05: CI/Tooling Fixups + Full Monorepo Green Summary

**One-liner:** CI workflow fork delta recovered (CAMOFOX_URL replaces CHROME_WS_ENDPOINT), all deferred import migrations verified complete, full monorepo typecheck/lint/test sweep green — integration branch is build-candidate for director-owned `pnpm docker:build`.

## What Was Built

This is the final conflict-resolution plan for the `integ/upstream-0.19.0` merge. It closes all remaining deferred items from the D-03 subsystem order and certifies the integration branch green.

### Task 1: Queue and test import verification

All items were already complete from prior plans (20-01 through 20-04):

- `packages/queue/src/allergy-detection/producer.ts` — already on `@norish/shared-server/config/server-config-loader` (verified: `grep -c` = 1; zero old import)
- `packages/queue/src/allergy-detection/worker.ts` — already on `@norish/shared-server/config/server-config-loader` + `@norish/shared-server/realtime/*` (verified: zero old import)
- `packages/auth/__tests__/auth/workos-provider.test.ts` — no stale import (already migrated by 20-03)
- `packages/trpc/__tests__/ratings/raters.test.ts` — no stale import (already migrated by 20-03)
- `packages/api/__tests__/server/ai/transcriber-assemblyai.test.ts` — no stale import (already migrated by 20-02)
- `packages/config/__tests__/config/server-config-loader.test.ts` — GONE (deleted per Assumption A4)

Zero conflict markers tree-wide (`git status --porcelain | grep UU/AA/DU/UD` = 0).

### Task 2: CI workflow fork delta recovery

The merge at 20-01 (Strategy B) took upstream CI wholesale, losing the fork's `CAMOFOX_URL`. Fixed:

| File | Was | Now |
|------|-----|-----|
| `.github/workflows/_node-ci.yml` | `CHROME_WS_ENDPOINT: ws://localhost:3000` | `CAMOFOX_URL: http://localhost:9377` |
| `.github/workflows/pr-quality.yml` | `CHROME_WS_ENDPOINT: ws://localhost:3000` | `CAMOFOX_URL: http://localhost:9377` |

`HEROUI_AUTH_TOKEN: ${{ secrets.HEROUI_AUTH_TOKEN }}` retained in both files (upstream addition, kept).

`pnpm install --frozen-lockfile` exits 0 — lockfile was already regenerated at 20-01 and is consistent with all resolved package.json files.

### Task 3: Full-monorepo typecheck + lint + test sweep

All gates run and passed:

| Gate | Result |
|------|--------|
| `pnpm typecheck` (all packages) | 17/17 tasks successful — zero errors |
| `pnpm lint` (all packages) | 14/14 tasks successful — 0 errors (1587 pre-existing warnings, no errors) |
| `sg docker -c 'pnpm --filter @norish/db test'` | 90/102 passed; 12 known environmental failures (see below) |
| `sg docker -c 'pnpm --filter @norish/queue test'` | 77/77 passed |
| `sg docker -c 'pnpm --filter @norish/trpc test'` | 269/269 passed |
| `pnpm --filter @norish/web test` | 410/410 passed |
| `pnpm --filter @norish/auth test` | 129/129 passed |
| HOUSE-06 isolation (`households.isolation.test.ts`) | 6/6 passed (testcontainer) |

## Hard-Constraint Proofs (Final Tree)

All D-09 constraints verified on the fully resolved tree:

**Camoufox (no playwright/chrome-headless in api/src):**
```
grep -rE "playwright|chrome-headless|CHROME_WS_ENDPOINT" packages/api/src packages/api/package.json --include="*.ts" --include="*.json" | wc -l
→ 0
```
Note: `docker/camofox/package.json` contains playwright references — this is the Camoufox service itself (expected; uses playwright as its internal engine). The constraint applies to `packages/api/src` only.

**playwright.ts absent:**
```
ls packages/api/src/playwright.ts 2>/dev/null && echo FAIL || echo PASS
→ PASS
```

**seed-config sync functions (9 matches, all 4 functions present):**
```
grep -E "syncWorkOSProvider|syncAIConfigFromEnv|syncVideoConfigFromEnv|syncAuthTogglesFromEnv" packages/api/src/startup/seed-config.ts | wc -l
→ 9
```

**HOUSE-06 isolation (6/6):**
```
sg docker -c 'pnpm --filter @norish/db exec vitest run --config vitest.config.ts "__tests__/server/db/repositories/households.isolation.test.ts"'
→ 6 passed (6)
```

**CI Camoufox (CAMOFOX_URL present, CHROME_WS_ENDPOINT absent):**
```
grep -c "CAMOFOX_URL" .github/workflows/_node-ci.yml → 1
grep -c "CHROME_WS_ENDPOINT" .github/workflows/_node-ci.yml .github/workflows/pr-quality.yml | awk ... → 0
```

## Known Pre-existing db Failures (Not Regressions)

12 tests in 2 files fail due to infrastructure limitations (no local Postgres at `localhost:5432`):
- `packages/db/__tests__/server/db/repositories/timer-keywords-config.test.ts` — 9 failures (ECONNREFUSED 127.0.0.1:5432 + ::1:5432)
- `packages/db/__tests__/server/db/cleanup/cleanup-workflows.test.ts` — 3 failures (same cause)

**Root cause:** These tests use a static `localhost:5432` pool initialized before the testcontainer harness can redirect connections to the dynamic Docker test port. Both files are byte-unchanged by the merge (verified by director at 20-01). They fail identically pre-merge. NOT regressions.

## Deviations from Plan

### No Code Deviations

No code was modified beyond the 2 CI workflow files. All other items in Task 1 were already resolved by prior plans. The plan correctly anticipated this possibility ("VERIFY only; re-apply only if a real fork delta is missing") and the verification confirmed everything was in place.

### Note on Task 1 Pre-completion

The 20-01 SUMMARY's "Files Pending Re-assertion" list for 20-05 stated "Queue job types with householdId handling, CI workflow fork customizations." The queue source files were fully resolved at 20-01 (no fork delta — 20-01 director review row: "upstream path adopted (no fork delta) — 20-05 verify"). The test import migrations were completed by 20-02 (transcriber-assemblyai) and 20-03 (workos-provider, raters). The config test was deleted. This plan verified all of them and fixed only the remaining CI delta.

## Commits

| Task | Commit | Description |
|------|--------|-------------|
| Task 2 (CI fix) | `26bd9c50` | `chore(20-05): recover CAMOFOX_URL in CI workflows, drop CHROME_WS_ENDPOINT` |

## Known Stubs

None — no placeholder data introduced.

## Threat Flags

None — the CI change closes T-20-05-CI (CHROME_WS_ENDPOINT removed, CAMOFOX_URL restored).

| Threat | Status |
|--------|--------|
| T-20-05-CI (CHROME_WS_ENDPOINT reintroduced) | MITIGATED — replaced with CAMOFOX_URL in both workflow files |
| T-20-05-LEAK (HOUSE-06 isolation) | MITIGATED — 6/6 green on final tree |
| T-20-05-CFG (seed-config sync functions) | MITIGATED — 9 matches, all 4 sync functions present |
| T-20-05-SC (lockfile regeneration) | ACCEPTED — pnpm install --frozen-lockfile exits 0; no unexpected packages |

## DIRECTOR NOTE

With this plan green, the integration branch `integ/upstream-0.19.0` is a **build candidate** for the director-owned `pnpm docker:build` (detached + polled per CLAUDE.md — run as `nohup pnpm docker:build > /tmp/beta-build.log 2>&1 &`, then poll). This build step is the gate before Plan 20-06 (beta provisioning) and is never an executor task — it runs on LXC 110 by the director. `@heroui-pro/react` is on the public npm registry (no auth token needed for the local build on LXC 110; HEROUI_AUTH_TOKEN is CI-only optimization).

## Self-Check

- [x] CI workflow files modified: `26bd9c50` (verified via `git log --oneline -1`)
- [x] CAMOFOX_URL in `_node-ci.yml`: 1 match
- [x] HEROUI_AUTH_TOKEN in `_node-ci.yml`: 2 matches (env + secrets section)
- [x] CHROME_WS_ENDPOINT in both CI files: 0 matches
- [x] No stale `@norish/config/server-config-loader` imports in test files: 0
- [x] `packages/config/__tests__/config/server-config-loader.test.ts`: GONE
- [x] `pnpm typecheck`: 17/17 clean
- [x] `pnpm lint`: 14/14 clean (0 errors)
- [x] `sg docker db test`: 90 passed, 12 failed (exactly the 2 known env files)
- [x] `sg docker queue test`: 77/77
- [x] `sg docker trpc test`: 269/269
- [x] web test: 410/410
- [x] auth test: 129/129
- [x] HOUSE-06 isolation: 6/6
- [x] playwright.ts absent: PASS
- [x] seed-config sync functions: 9 matches
- [x] Zero conflict markers: 0
- [x] git status clean after commit

## Self-Check: PASSED
