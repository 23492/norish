# 22-VALIDATION — Phase 22 evidence

All commands run on LXC 110 at `/opt/norish-src`, branch `main`, 2026-07-21.
`sg docker` is required for the queue/db testcontainer suites (the `claude` user is not in
the docker group in-process).

## 1. The leak, reproduced BEFORE any production change (plan 22-01)

Commit `de3bf9a4`, with `git diff --name-only main -- packages/*/src` **empty**.

```
$ pnpm --filter @norish/shared-server test
 FAIL  __tests__/realtime/fan-out-isolation.test.ts > ... > event: imported > is never delivered to a member of another cookbook
 AssertionError: expected [ 'norish:recipe:broadcast:imported' ] to deeply equal []
 - Expected
 + Received
 - []
 + [
 +   "norish:recipe:broadcast:imported",
 + ]

 Test Files  1 failed | 13 passed (14)
      Tests  12 failed | 182 passed (194)
```

The failure names the leaking channel, `norish:recipe:broadcast:imported` — the channel
every authenticated connection subscribes to via `createPolicyAwareIterables`.

## 2. Green after the fix

```
$ pnpm --filter @norish/shared-server test
 Test Files  14 passed (14)
      Tests  201 passed (201)

$ sg docker -c 'pnpm --filter @norish/queue test'
 Test Files  13 passed (13)
      Tests  77 passed (77)          # baseline 77 — unchanged

$ sg docker -c 'pnpm --filter @norish/trpc test'
 Test Files  28 passed (28)
      Tests  278 passed (278)        # baseline 269 + 9 new router-isolation tests
```

## 3. Revert checks — both weakenings observed RED, both reverted byte-identical

Neither weakening was committed. `git diff` confirmed clean after each restore.

### 3a. Reinstating the broadcast branch in `emitByPolicy` (D-22-01)

```diff
+  if (viewPolicy === "everyone") {
+    emitter.broadcast(event, data);
+
+    return;
+  }
   if (viewPolicy === "owner" || isPersonalScope) {
```

```
 FAIL  ... > does not reach every connected socket even when the cookbook policy is `everyone`
 FAIL  ... > resolveRecipeRealtimeScope (D-22-02) > routes a personal recipe to its owner only, never to a household channel
 FAIL  ... > resolveHouseholdRealtimeScope (pre-row import events) > scopes a personal import to the importer alone
 Test Files  1 failed | 13 passed (14)
      Tests  3 failed | 197 passed (200)
```

### 3b. Sourcing the policy server-wide instead of from the recipe's cookbook (D-22-02)

```diff
-  return {
-    viewPolicy: cookbook.policy.view,
+  const serverWide = await getRecipePermissionPolicy();
+
+  return {
+    viewPolicy: serverWide.view,
     ctx: { userId: owner.userId, householdKey: owner.householdId },
   };
```

```
 FAIL  ... > resolveRecipeRealtimeScope (D-22-02) > keys on the RECIPE's cookbook, not the actor's active cookbook
 FAIL  ... > resolveRecipeRealtimeScope (D-22-02) > honours a cookbook's OWN narrower policy over the wider server default
 Test Files  1 failed | 13 passed (14)
      Tests  2 failed | 199 passed (201)
```

Note on 3b: with D-22-01 in place, weakening the *policy source* alone no longer produces a
broadcast — the two fixes are defence in depth. What it does produce is a **widening**
(a cookbook whose own policy is `view: "owner"` would emit to the whole cookbook), which is
what the second assertion catches. The `honours a cookbook's OWN narrower policy` test was
added specifically because the first revert run showed only one test reacting.

## 4. Emit-site counts held

A "fix" that deletes emissions is not a fix.

```
$ grep -rho "emitByPolicy(" packages/queue/src --include=*.ts | wc -l
38
$ grep -rho "emitByPolicy(" packages/trpc/src --include=*.ts | wc -l
16          # 54 total, unchanged from the 22-01 audit
```

No emit site reads the server-wide policy any more:

```
$ grep -rn "getRecipePermissionPolicy" packages/queue/src packages/trpc/src
packages/queue/src/recipe-import/producer.ts       # dedup job-id scoping, not an emit
packages/trpc/src/routers/config/procedures.ts     # reads the config for display
packages/trpc/src/routers/permissions/permissions.ts
packages/trpc/src/routers/admin/ai-config.ts
packages/trpc/src/routers/recipes/pending.ts
packages/trpc/src/routers/households/households.ts # cookbook creation defaults
```

All six remaining uses are legitimate reads of the server-wide default; none is an emit.

## 5. Full-monorepo gate

```
$ pnpm typecheck
 Tasks:    17 successful, 17 total
EXIT=0

$ pnpm lint
 (0 errors — see §6)
```

Per-package prettier was re-checked; the only formatting changes are inside the files this
phase touched (two unrelated files that prettier wanted to reformat,
`shared-server/src/media/storage.ts` and `shared-server/src/ai/providers/listing.ts`, were
reverted to keep the diff scoped).

## 6. Baseline deltas investigated, not accepted blindly

- `pnpm --filter @norish/queue lint` reports **83 warnings, 0 errors**. Verified as
  pre-existing by stashing the phase's changes and re-running: identical 83/0.
- Four queue test files and two tRPC test files needed their
  `@norish/shared-server/realtime/policy` / `../../src/helpers` mocks extended with the two
  new resolver exports. This is mock-surface maintenance, not a behaviour change.

## 7. Environment findings (not defects in this phase)

- **`node-linker=hoisted`**: workspace packages are *hardlinked copies* under
  `node_modules/@norish/*`, and each package additionally has its own nested copy. Editing
  `packages/<pkg>/src` with a tool that rewrites the file (rather than truncating in place)
  breaks the hardlink, so cross-package typechecks silently see stale code. `pnpm install`
  refuses to re-link non-interactively (`ERR_PNPM_ABORTED_REMOVE_MODULES_DIR_NO_TTY`) and
  `node_modules` is root-owned, so `ln -f` fails; `cp` into the existing file works.
  The same nesting is why
  `packages/trpc/__tests__/realtime/router-fan-out-isolation.test.ts` must mock
  `@norish/db` by path rather than by bare specifier.
- **Out-of-scope finding, filed not fixed**: `packages/queue/src/recipe-import/producer.ts`
  passes the server-wide `policy.view` into `recipeExistsByUrlForPolicy`. Under the live
  `view: "everyone"` that makes import dedup search *across* cookbooks, so importing a URL
  another household already has can return **their** recipe. That is a read-path issue on
  the REST/queue side, not a realtime emit, so it is out of Phase 22's stated scope —
  recorded in STATE.md for sequencing.

## 8. No live/operator action

Phase 22 is code-only, as required by success criterion 5 and the phase brief. The live
`server_config.recipe_permission_policy` was **not** touched and remains
`{"edit":"household","view":"everyone","delete":"household"}`. Nothing was built, deployed,
or pushed to a remote.
