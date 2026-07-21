# Phase 22 — Realtime fan-out isolation (REALTIME-ISO-01)

**Status**: planned 2026-07-21
**Requirement**: REALTIME-ISO-01
**Depends on**: Phase 3 (POLICY-01 / `canAccessResource` / `resolveRecipeCookbookPolicy`), Phase 20 (current merged surface)

## The defect, measured

Grounded against the working tree at `main` = `ab06c7ef` (tree clean).

1. **`emitByPolicy` broadcasts.** `packages/shared-server/src/realtime/policy.ts` maps
   `view: "everyone"` onto `emitter.broadcast(event, data)`, which publishes to
   `norish:<ns>:broadcast:<event>`.

2. **Every authenticated client subscribes to that channel.**
   `packages/trpc/src/helpers.ts:204-206` (`createPolicyAwareIterables`) subscribes each
   connection to *three* channels — household, **broadcast**, user — so `broadcast` is
   literally "every connected socket", with no per-cookbook filter on the receive side.

3. **The active production policy takes the broadcast branch.** Live
   `server_config.recipe_permission_policy` = `{"edit":"household","view":"everyone","delete":"household"}`
   (queried against the live DB 2026-07-21).

4. **All 54 emit sites read the server-wide policy — not 34.** The ROADMAP recorded 34;
   a full re-audit of the tree shows **54 of 54**. Every site resolves via
   `getRecipePermissionPolicy()` from `@norish/shared-server/config/server-config-loader`,
   either as `policy.view` or via a `const viewPolicy = policy.view` hoist. There is **no**
   emit site today that consults the recipe's own cookbook.

   | file | sites |
   |---|---|
   | `packages/queue/src/allergy-detection/worker.ts` | 11 |
   | `packages/queue/src/auto-tagging/worker.ts` | 9 |
   | `packages/queue/src/auto-categorization/worker.ts` | 6 |
   | `packages/queue/src/recipe-import/worker.ts` | 4 |
   | `packages/queue/src/image-import/worker.ts` | 3 |
   | `packages/queue/src/paste-import/worker.ts` | 3 |
   | `packages/queue/src/nutrition-estimation/worker.ts` | 2 |
   | **queue subtotal** | **38** |
   | `packages/trpc/src/routers/recipes/recipes.ts` | 9 |
   | `packages/trpc/src/routers/ratings/ratings.ts` | 3 |
   | `packages/trpc/src/routers/recipes/shares.ts` | 3 |
   | `packages/trpc/src/routers/recipes/helpers.ts` | 1 |
   | **trpc subtotal** | **16** |
   | **TOTAL** | **54** |

5. **Payloads are full DTOs, not ids.** e.g. `emitByPolicy(recipeEmitter, viewPolicy, ctx,
   "imported", { recipe: dashboardDto, ... })` in `recipe-import/worker.ts:86,148`.

6. **A second, independent leak vector: the target key is the ACTOR's, not the recipe's.**
   `PolicyEmitContext.householdKey` is built in `packages/trpc/src/middleware.ts:38` as
   `household?.id ?? user.id` — the *acting* user's active cookbook. So even once the
   broadcast branch is closed, an event about a recipe in cookbook A can still be emitted
   onto cookbook B's channel whenever the actor's active cookbook differs from the recipe's
   own (the `saveShared` / cross-cookbook rating paths). Fixing only the policy *source*
   would leave this open.

**Why it survived**: Phase 3 proved HOUSE-06 adversarially on the REST/tRPC read path only
(`packages/trpc/__tests__/recipes/permissions-integration.test.ts`). No test has ever
asserted anything about which *channel* an event lands on.

## Decision D-22-01 — `view: "everyone"` no longer implies socket broadcast

Locked. Success criterion 1 requires the leak to be closed **with the live config left at
`view: "everyone"`**, so `everyone` cannot keep meaning `broadcast()` on a recipe-bearing
event. Resolution:

- `emitByPolicy` **never calls `emitter.broadcast()`**. `everyone` degrades to
  household-scoped emission, and to user-scoped when the scope has no household
  (personal recipe). "Everyone may *fetch* this if they know its id" (a REST/authorisation
  statement, which `canAccessResource` continues to honour unchanged) is not the same
  claim as "push this to every open socket unsolicited".
- `TypedRedisEmitter.broadcast()` itself is **retained** — it is legitimate for genuinely
  global, non-resource events (server-config changes, connection invalidation). It is
  `emitByPolicy`'s *use* of it for recipe payloads that is wrong. A regression test pins
  that `emitByPolicy` never reaches it.
- Phase 3 already forbids a per-cookbook `view = everyone`
  (`setHouseholdPolicy`, `SetHouseholdPolicyInputSchema`). This closes the matching hole
  one layer down.

## Decision D-22-02 — resolve scope from the recipe, once per handler

Locked. The fix mirrors `resolveRecipeCookbookPolicy` (`packages/auth/src/permissions.ts:52`)
rather than inventing a second resolution rule.

New in `packages/shared-server/src/realtime/policy.ts`:

```ts
resolveRecipeRealtimeScope(recipeId, fallback: PolicyEmitContext)
  -> { viewPolicy: PermissionLevel; ctx: PolicyEmitContext }
```

- looks up the recipe's owner + household via `getRecipeOwnerAndHousehold` (`@norish/db`);
- household recipe -> that household's `viewPolicy` (`getHouseholdPolicy`), and
  `ctx = { userId: <recipe owner>, householdKey: <recipe householdId> }`;
- personal recipe (`householdId === null`) -> server-wide default policy, and
  `ctx = { userId: <recipe owner>, householdKey: <recipe owner id> }` (matching the
  `household?.id ?? user.id` key convention), so it can only ever reach the owner;
- unknown/orphaned recipe -> **fail closed**: fall back to the caller-supplied actor
  `fallback` ctx at `owner` scope (actor-only), never wider.

Home is `shared-server` because both `@norish/queue` and `@norish/trpc` already depend on
it, and `shared-server` already depends on `@norish/db` — no new package edges.
(`@norish/queue` does **not** depend on `@norish/auth`, so `resolveRecipeCookbookPolicy`
cannot be reused directly from the workers; the realtime resolver is the shared-server
sibling of it.)

**Shape is preserved on purpose**: the 54 call sites keep the
`emitByPolicy(emitter, viewPolicy, ctx, event, data)` signature. Only the *derivation* of
`viewPolicy` + `ctx` changes, resolved **once per job/procedure** exactly where
`const policy = await getRecipePermissionPolicy()` sits today — so this stays one DB
round-trip per handler, not one per emit (the allergy worker emits 11 times).

Actor-scoped events that have no recipe to resolve against (`failed`, `importStarted`
before the row exists) keep the actor ctx and are pinned to household/owner scope — never
broadcast.

## Canonical refs

- `packages/shared-server/src/realtime/policy.ts` — `emitByPolicy`
- `packages/shared-server/src/redis/pubsub.ts` — channel construction, `broadcast`
- `packages/trpc/src/helpers.ts:194-252` — `createPolicyAwareIterables` (the receive side)
- `packages/trpc/src/middleware.ts:38` — `householdKey = household?.id ?? user.id`
- `packages/auth/src/permissions.ts:52` — `resolveRecipeCookbookPolicy` (the precedent)
- `packages/db/src/repositories/households.ts:660` — `getHouseholdPolicy`
- `.planning/phases/03-per-cookbook-policies/03-CONTEXT.md`

## Plans

- **22-01** — audit + adversarial harness. Lands a **failing** two-household/two-socket
  test. No production change.
- **22-02** — the core fix (`policy.ts`) + all 38 queue emit sites.
- **22-03** — all 16 tRPC emit sites + docs + full-monorepo green + revert-check.
