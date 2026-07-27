# Deferred items — out of scope for the plan(s) that discovered them

## 27-06 (W5-PREP)

- **`pnpm deps:cycles` fails on the pre-change tree**, unrelated to 27-06's diff:
  `packages/db-schema/src/schema/auth.ts -> packages/db-schema/src/schema/households.ts`.
  Verified by running `pnpm deps:cycles` before touching any file in this plan and again
  after every task — the single reported cycle is identical in both runs, and
  `packages/db-schema/` never appears in `git diff --stat` for 27-06. Not fixed here per
  the SCOPE BOUNDARY (pre-existing, unrelated to the current task's changes). A future
  plan should break the mutual `references((): AnyPgColumn => ...)` cycle between those
  two schema files (or confirm it is an accepted/expected `AnyPgColumn` mutual-FK pattern
  per this fork's own gotchas note and adjust the cycle checker's target set instead).
