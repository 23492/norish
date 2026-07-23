# 23-VALIDATION — Phase 23 evidence (CKBK-MOVE-01)

All commands on LXC 110 at `/opt/norish-src`, branch `main`, 2026-07-23.
`sg docker -c` is required for the trpc/db testcontainer suites (the `claude` user is not
in the docker group in-process).

## 1. The move guard, proven failing-first (plan 23-01, tests-first)

`assertRecipeMoveAllowed` did not exist yet; the adversarial suite was committed RED first:

```
$ sg docker -c 'pnpm --filter @norish/trpc test move-permissions'
 Test Files  1 failed (1)
      Tests  13 failed (13)     # assertRecipeMoveAllowed is undefined
```

After implementing the guard + procedure:

```
$ sg docker -c 'pnpm --filter @norish/trpc test move-permissions'
 Test Files  1 passed (1)
      Tests  13 passed (13)
```

The suite seeds the LIVE policy shape: every source-gate case runs BOTH `edit: "household"`
AND the `edit: "everyone"` sibling (the shipped default), because `canAccessResource`
collapses `edit = everyone` to admin-or-owner — so both must deny a plain member.

## 2. Adversarial matrix (what is proven BLOCKED)

- A non-member of the SOURCE cookbook cannot move its recipe (source edit gate) — `household`
  AND `everyone`.
- A member who is NOT the admin and NOT the owner cannot move another member's recipe —
  `household` AND `everyone`. The source admin can; the owner can.
- A user cannot move a recipe INTO a household they are not a member of (destination gate).
- A non-owner cannot move a recipe into Personal (destination = null gate).
- A no-op move (destination == current cookbook) is rejected `BAD_REQUEST` before any emit.
- Server admin retains parity with `canAccessResource` (may move into any household).

## 3. Revert-checks — two weakenings observed RED, both reverted byte-identical

Neither weakening was committed. Pre-weaken SHA-256 of the guard file:
`e6db47e44e0ed9ff2ee6af8dc2c503212e3cffe020b81dcea7606bdb2b98456e`
(`packages/trpc/src/routers/recipes/helpers.ts`).

### 3a. Neuter the DESTINATION membership check

```diff
-  } else if (!ctx.memberHouseholdIds.includes(destinationHouseholdId)) {
+  } else if (false && !ctx.memberHouseholdIds.includes(destinationHouseholdId)) {
```

```
 × destination gate > FORBIDS moving a recipe INTO a household the actor is not a member of
 Test Files  1 failed (1)
      Tests  1 failed | 12 passed (13)
```

### 3b. Weaken the SOURCE gate from `edit` to `view`

```diff
-  await assertRecipeAccess(ctx, recipeId, "edit");
+  await assertRecipeAccess(ctx, recipeId, "view");
```

```
 × FORBIDS a non-admin, non-owner member from moving another member's recipe   (edit=household)
 × FORBIDS a non-admin, non-owner member from moving another member's recipe   (edit=everyone)
 Test Files  1 failed (1)
      Tests  2 failed | 11 passed (13)
```

The `everyone` sibling reacts too — it is load-bearing, not decorative.

### Restore verified byte-identical

```
$ sha256sum packages/trpc/src/routers/recipes/helpers.ts
e6db47e44e0ed9ff2ee6af8dc2c503212e3cffe020b81dcea7606bdb2b98456e   # matches pre-weaken
$ git diff --stat        # empty
$ sg docker -c 'pnpm --filter @norish/trpc test move-permissions'
      Tests  13 passed (13)
```

## 4. Gates

```
$ pnpm typecheck                        # 17 successful, 17 total — EXIT 0
$ sg docker -c 'pnpm --filter @norish/trpc test'   # 294 passed (baseline 281 + 13 new)
$ pnpm --filter @norish/web test        # 424 passed (baseline 424; 2 tests updated for the new surfaces)
$ sg docker -c 'pnpm --filter @norish/db test households.isolation'  # 9 passed (isolation intact)
$ pnpm lint                             # 14 tasks, 0 errors (warnings at baseline)
$ pnpm i18n:check                       # EXIT 1 — ONLY the pre-existing `no` gap (68 keys),
                                        #   ZERO new gaps vs the base-commit baseline
$ pnpm --filter @norish/web build       # EXIT 0
```

### db suite note
Two db test files (`timer-keywords-config.test.ts`, `cleanup-workflows.test.ts`) fail with
`ECONNREFUSED …:5432` in this sandbox — they need a fixed localhost Postgres rather than a
testcontainer. Neither imports anything Phase 23 touched (the change is additive:
`moveRecipeToHousehold` + `MOVE_DESTINATION_URL_CONFLICT`), and the testcontainer-based
`households.isolation` suite passes 9/9. These are pre-existing environment failures, not a
regression.

### i18n note
The base commit `c93ac6ec` already fails `i18n:check` because the `no` locale is missing 68
keys (an abandoned locale — all 11 maintained locales match source). Phase 23 adds its new
keys to ALL 12 locale dirs INCLUDING `no`, so the missing set stays exactly those 68 keys —
`comm -13 baseline after` is empty (no new gaps introduced).

## 5. No schema change / no live action

No migration — the move writes only the existing `recipes.household_id` column; DB stays at
migration 40. The live stack was not touched; nothing was built into an image or deployed.
</content>
