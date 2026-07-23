# 24-VALIDATION — Phase 24 security evidence (BULK-01, IMPORT-UX-01)

All commands on `/opt/norish-src`, branch `main`, 2026-07-23. This phase touches the realtime
emit + import-dedup isolation boundary (the HOUSE-06 / REALTIME-ISO-01 / IMPORT-DEDUP-ISO-01
family Phase 22 closed), so it is adversarially verified.

## 1. What is proven BLOCKED (cross-cookbook attacks)

### Progress push never crosses the cookbook boundary
`emitImportProgress` is the ONLY new realtime emit site. `progress-isolation.test.ts` drives
the REAL `emitImportProgress` + REAL `emitByPolicy` and asserts, for every case INCLUDING the
LIVE `view: "everyone"` sibling:
- `view: household` → emits to `emitToHousehold(HOUSEHOLD_A)` only; cookbook B untouched; no broadcast.
- `view: everyone` (production default) → STILL clamps to `emitToHousehold(HOUSEHOLD_A)`; no broadcast.
- personal import (householdKey === userId) → `emitToUser(USER_A)` only; no broadcast, no household.

So client B never receives cookbook A's bulk-import progress (the HOUSE-06 leak).

### Bulk dedup stays within the actor's cookbook
`bulk-fan-out-isolation.test.ts` drives the REAL `addImportJob`/`generateJobId` against a
stateful in-memory queue under `LIVE_SERVER_POLICY = view:"everyone"`:
- Two cookbooks importing the SAME URL get DISTINCT job ids (no global-id collision) — B is
  queued even though A already holds the URL.
- Dedup asks the repository with `viewPolicy === "household"` only (never a cross-cookbook search).
- A URL repeated within ONE cookbook's batch → the second is a `duplicate`, scoped to B's job id.

### Shared fan-out matrix
`importProgress` was added to `RECIPE_EVENTS` in
`packages/shared-server/__tests__/realtime/fan-out-isolation.test.ts`, so it is covered by the
same outsider-never-receives matrix as the other recipe-bearing events.

```
$ pnpm --filter @norish/queue exec vitest run recipe-import/progress-isolation recipe-import/bulk-fan-out-isolation
  Test Files  2 passed (2)
       Tests  6 passed (6)
$ pnpm --filter @norish/shared-server exec vitest run realtime/fan-out-isolation
  Test Files  1 passed (1)
       Tests  27 passed (27)
$ pnpm --filter @norish/trpc exec vitest run realtime/router-fan-out-isolation
  Test Files  1 passed (1)
       Tests  9 passed (9)
```

## 2. Adversarial REVERT-CHECK — the core guard, observed RED then reverted byte-identical

The core guard is `emitImportProgress` in `packages/queue/src/recipe-import/progress.ts`,
which routes progress through `emitByPolicy` (clamped to the cookbook). Weaken it to a
server-wide broadcast and the isolation suite must go RED:

```
# weakening applied to progress.ts: replaced
#   emitByPolicy(recipeEmitter, scope.viewPolicy, scope.ctx, "importProgress", payload);
# with
#   void recipeEmitter.broadcast("importProgress", payload);

$ pnpm --filter @norish/queue exec vitest run recipe-import/progress-isolation
  Test Files  1 failed (1)
       Tests  3 failed (3)          # all 3 cases (incl. the everyone sibling) caught the leak
  - Expected  { method: "emitToHousehold"/"emitToUser", key: ... }
  + Received  { method: "broadcast" }
```

Reverted byte-identical via `git checkout -- packages/queue/src/recipe-import/progress.ts`
(the weakening was NEVER committed), then re-verified GREEN on a clean tree:

```
$ git checkout -- packages/queue/src/recipe-import/progress.ts
$ git status --porcelain packages/queue/src/recipe-import/progress.ts    # (empty — clean)
$ pnpm --filter @norish/queue exec vitest run recipe-import/progress-isolation
  Test Files  1 passed (1)
       Tests  3 passed (3)
```

## 3. Backend emit sites (from `21cccba8`) verified scoped

The two worker emit sites (`fetching`, `saving`) both reuse the scope the worker already
resolved for the job (`{ viewPolicy, ctx }`, from `resolveHouseholdRealtimeScope` keyed on the
import's TARGET cookbook) and go through `emitImportProgress` → `emitByPolicy`. No
`emitter.broadcast()` is reachable from the progress path. Covered by §1 and the revert-check §2.

## 4. Full gate results
- `pnpm typecheck` — 17/17 EXIT 0.
- `pnpm lint` — 0 errors (warnings at baseline).
- `pnpm --filter @norish/web build` — EXIT 0.
- Affected suites — queue 88, trpc 294, web 424, shared-react 37, shared-server realtime 27.
- `i18n:check` — exit 1 SOLELY on the pre-existing `no`-locale 68-key gap (proven by stashing
  the phase's i18n edits: baseline `no` missing 68, post-change `no` missing 68, and NONE of
  the missing keys are this phase's new keys — zero new gaps).
- **MIGRATION: none** (DB stays at 40).
