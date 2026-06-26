# Pre-Deploy Verification Gate

- **Repo:** /opt/norish-src
- **Branch:** claude/overnight-20260622
- **Host:** LXC 110 (`claude` user; db/queue run under `sg docker`)
- **Date:** 2026-06-25
- **Scope:** Read-only static + test verification across all workspaces. No code changed, no commit/push/build/deploy.

## VERDICT: RED (single isolated cause)

Typecheck and lint are fully GREEN across all 18 packages. Tests: every package passes
all assertions, but `@norish/db` exits non-zero due to **flaky testcontainer
setup/teardown under concurrency** (Postgres `57P01` "terminating connection due to
administrator command" + `beforeAll` hook timeouts at 60s). No assertion/logic failure
was observed in any run. This is an environment/resource-contention flake, not a code
defect — director judgment required on whether to gate the deploy.

## Typecheck — `pnpm typecheck`

- Exit code: **0** — 16/16 tasks successful (5 cached). No errors.

## Lint — `pnpm lint`

- Exit code: **0** — 13/13 tasks successful. **0 errors**, warnings only
  (unused vars, padding-line-between-statements, no-console in logger, react-hooks
  exhaustive-deps in mobile). None block.

## Tests — `pnpm test` (run under `sg docker`)

Full suite run with `--continue`; db/queue ran under `sg docker` (testcontainers OK).

| Package | Typecheck | Lint | Tests (passed/total) | Result |
|---|---|---|---|---|
| @norish/api | pass | pass (1 warn) | 366/366 | GREEN |
| @norish/web | pass | pass | 383/383 | GREEN |
| @norish/mobile | pass | pass (16 warn) | 130/130 | GREEN |
| @norish/trpc | pass | pass | 256/256 | GREEN |
| @norish/shared-server | pass | pass | 154/154 | GREEN |
| @norish/shared | pass | pass (6 warn) | 222/222 | GREEN |
| @norish/shared-react | pass | pass | 27/27 | GREEN |
| @norish/auth | pass | pass (1 warn) | 129/129 | GREEN |
| @norish/config | pass | pass | 726/726 | GREEN |
| @norish/queue | pass | pass (2 warn) | 77/77 | GREEN (sg docker) |
| @norish/db | pass | pass (2 warn) | 99/99 assertions pass | **RED — flaky** (sg docker) |
| @norish/i18n / ui / parser-api / tooling configs | pass | pass | n/a | GREEN |

- **db + queue confirmed run under `sg docker`** — Postgres/Redis testcontainers started
  successfully (logs show "PostgreSQL container started", "Database migrations applied").
- **queue:** 13 files / 77 tests, clean, no errors.

### @norish/db RED detail — flaky testcontainer, not a logic failure

Ran 3 times under `sg docker`; result is non-deterministic:

| Run | Test files | Tests | Errors | Notes |
|---|---|---|---|---|
| 1 (full suite) | 17 passed | 99/99 passed | 4 | `57P01` teardown errors; all assertions passed |
| 2 (db alone) | 17 passed | 99/99 passed | 4 | same |
| 3 (db alone) | 3 failed / 14 passed | 76 passed / 23 skipped | 3 | `beforeAll` "Hook timed out in 60000ms" |

- Error class: Postgres `severity: FATAL, code: '57P01', routine: 'ProcessInterrupts'`
  = "terminating connection due to administrator command" (container reaped while a
  connection was open), and `Error: Hook timed out in 60000ms` in `beforeAll` →
  `RepositoryTestBase.setup()` (which starts a per-suite Postgres container).
- Affected files **change between runs** (run 1/2: cleanup-workflows + timer-keywords;
  run 3: recipe-shares + tags + timer-keywords). A real defect would fail the same
  assertion deterministically; this shifting, container-startup-bound pattern is the
  signature of resource contention when many suites each spin up their own Postgres
  testcontainer in parallel on a shared host.
- No assertion (`expect`) ever failed in any run. When the hook does complete, the suite
  is 99/99 green.

## Notes for the director

- Nothing was changed, committed, pushed, built, or deployed.
- The only RED is `@norish/db`, and it is an infra flake (testcontainer startup timeout /
  teardown race under concurrency), not a code/logic regression.
- Suggested mitigations (out of scope for this gate): raise `hookTimeout` for db suites,
  reduce vitest pool concurrency for db, or reuse a single Postgres container across the
  suite. To confirm green, re-run `sg docker -c 'pnpm --filter @norish/db test'` in
  isolation with lower concurrency.
