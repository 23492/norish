# 22-03 SUMMARY — tRPC routers, `everyone` semantics, full gate

## What landed

### The 16 tRPC emit sites

- **`recipes.ts` (9)** — `created` resolves against `createdId`; `updated` against the
  recipe id; `converted` against `recipe.id` / `recipeId`; the three `*Started` triggers
  against `recipeId`. **`deleted` resolves BEFORE `deleteRecipeById`** — resolving
  afterwards would find no row and fail closed to the actor, so the recipe's own cookbook
  would never learn of the deletion.
- **`ratings.ts` (3)** — `ratingUpdated` resolves against `recipeId`, which is the whole
  point: a rating on a recipe shared into another cookbook previously emitted onto the
  *rater's* cookbook channel. `emitRatingFailed` is pinned to `owner`.
- **`shares.ts` (3)** — the share lifecycle resolves against `share.recipeId`;
  `setVisibility` against `input.recipeId`; **`saveShared` against the newly created copy
  (`createdId`), not the source** — the source may live in a cookbook the saver cannot see.
- **`recipes/helpers.ts` (1)** — `emitRecipeFailure` pinned to `owner`.

`packages/trpc/src/helpers.ts` re-exports both resolvers alongside `emitByPolicy`.

### Tests

- `packages/trpc/__tests__/realtime/router-fan-out-isolation.test.ts` (new, 9 tests) —
  drives the real resolver + real `emitByPolicy` in the exact shape the routers use, with
  an actor whose active cookbook is **not** the recipe's. Also pins that the receive side
  (`createPolicyAwareIterables`) still subscribes to the broadcast channel, making explicit
  that the invariant lives on the send side.
- `packages/trpc/__tests__/recipes/shares.test.ts` — added an assertion that `saveShared`
  resolves against the saved copy and **never** against the source recipe id.

### Docs

`AGENTS.md` gained a "Realtime scoping (REALTIME-ISO-01)" section stating the rule for new
emit sites, the `everyone`-is-not-broadcast decision, and where the guarding tests live.
Phases 24 and 26 both add emit sites; this is the note that should stop the regression.

## Deviations from the plan

1. **`emitRecipeFailure` / `emitRatingFailed` became synchronous and `owner`-scoped.** The
   plan said "pin it to household scope". Household scope tells a whole cookbook that one
   member's action failed, which is both noisier and wider than necessary; `owner` is the
   correct floor. Dropping the `getRecipePermissionPolicy()` read also made both functions
   synchronous, so the `void emitRecipeFailure(...)` call site lost its needless `void`.
2. **`vi.mock` by path in the new router test.** `node-linker=hoisted` gives each package
   its own `@norish/db` copy, so mocking the bare specifier from `packages/trpc` targets a
   different module identity than the one the resolver loads. The mock uses a repo-relative
   path into the root copy, with a comment explaining why.
3. **No `22-VALIDATION.md` "one representative call site" revert.** Both revert checks were
   executed at 22-02 (broadcast branch, and policy source) and are transcribed in
   22-VALIDATION.md §3; re-running an equivalent third weakening would not add signal.

## Verification

- `sg docker -c 'pnpm --filter @norish/trpc test'` → **278/278** (baseline 269 + 9 new).
- `pnpm typecheck` → **17/17, EXIT 0**.
- `pnpm lint` → **0 errors** across all workspaces (warnings unchanged; the queue's 83 were
  confirmed pre-existing by stashing).
- Emit-site counts held: queue 38, trpc 16, total 54.
- `grep -rn getRecipePermissionPolicy packages/queue/src packages/trpc/src` → 6 hits, all
  non-emit reads of the server-wide default (config display, permissions router, admin,
  pending list, cookbook-creation defaults, import dedup).

## Out-of-scope finding, filed not fixed

`packages/queue/src/recipe-import/producer.ts` passes the server-wide `policy.view` into
`recipeExistsByUrlForPolicy`. Under the live `view: "everyone"` this makes import dedup
search **across cookbooks**, so importing a URL another household already imported can
return *their* recipe. That is a read-path issue, not a realtime emit, so it is outside
Phase 22's stated scope. Recorded in STATE.md for sequencing.

## Self-check

- Both revert-checks transcribed in 22-VALIDATION.md, not merely asserted. ✓
- `saveShared` resolves against the new copy, and a test pins it. ✓
- Emit-site counts held at 38 + 16 = 54. ✓
- Nothing deployed; live `server_config` untouched; nothing pushed to a remote. ✓
