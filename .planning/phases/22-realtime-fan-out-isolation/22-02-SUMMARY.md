# 22-02 SUMMARY — Core fix + the 7 queue workers

**Commit**: `33c04546` `fix(22-02): resolve realtime scope from the recipe's own cookbook (queue)`

## What landed

### `packages/shared-server/src/realtime/policy.ts`

- **D-22-01** — `emitByPolicy` no longer calls `emitter.broadcast()`. `everyone` and
  `household` both emit at cookbook scope; `owner`, and any scope whose `householdKey`
  equals its `userId` (the personal-recipe key convention), emit to the user channel.
  `TypedRedisEmitter.broadcast()` is retained for genuinely global events.
- **D-22-02** — `resolveRecipeRealtimeScope(recipeId, fallback)` resolves the view policy
  **and** the target household key from the recipe's own cookbook, mirroring
  `resolveRecipeCookbookPolicy`. Personal recipes key on the owner's user id; unresolvable
  recipes fail closed to `owner` scope against the actor.
- `resolveHouseholdRealtimeScope(householdId, fallback)` — added beyond the plan, for the
  pre-row `importStarted` / `failed` events (see Deviations).

### The 7 workers (38 sites)

`recipe-import`, `paste-import`, `image-import`, `auto-tagging`, `auto-categorization`,
`allergy-detection`, `nutrition-estimation`. The `const policy = await
getRecipePermissionPolicy()` hoist is replaced by a single scope resolution in the same
position, so this remains **one DB read per job** — the allergy worker emits 11 times and
must not make 11 round-trips. Emit-site count unchanged at 38.

## Deviations from the plan

1. **`resolveHouseholdRealtimeScope` added.** The plan said to keep the actor ctx at a
   hardcoded `"household"` scope for the pre-row `importStarted`. That hardcodes a policy
   and keeps the actor's key. The job data already carries `householdId` — the cookbook the
   import targets, i.e. the recipe's household-to-be — so a cookbook-based resolver is both
   more correct and no more code. `image-import` and `paste-import`'s `handleJobFailed`
   needed `householdId` added to their `job.data` destructuring.
2. **Dedup narrowed as a side effect.** `recipe-import` passes its resolved `viewPolicy`
   into `recipeExistsByUrlForPolicy`. Previously that was the server-wide `everyone`, so
   the duplicate search ranged across all cookbooks; it is now the target cookbook's own
   policy. This is a correctness improvement, and it is *not* a behaviour change this plan
   invented — the same variable was always threaded there.
3. **Four queue test files needed their `realtime/policy` mocks extended** with the two new
   resolver exports. Mock-surface maintenance only.

## Verification

- `pnpm --filter @norish/shared-server test` → 201/201.
- `sg docker -c 'pnpm --filter @norish/queue test'` → 77/77 (baseline 77).
- `tsc --noEmit` clean for both packages.
- Lint unchanged: 0 errors, 83 pre-existing queue warnings (confirmed by stashing).
- **Revert checks**: both weakenings observed RED and reverted byte-identical; neither
  committed. Full transcripts in 22-VALIDATION.md §3.

## Self-check

- Revert checks actually run, RED observed, weakenings reverted byte-identical. ✓
- Scope resolved once per job, not once per emit. ✓
- Emit-site count held at 38. ✓
