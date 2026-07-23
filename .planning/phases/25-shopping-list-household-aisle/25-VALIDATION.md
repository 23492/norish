# Phase 25 — VALIDATION (security gate + migration dry-run)

Requirements: SHOP-02 (household-shared list), SHOP-01 (aisle grouping). DB migration `0040` (DB 40 → 41).

## HOUSE-06 cross-household isolation (security-critical)

New resource: the shopping list becomes HOUSEHOLD-scoped (`groceries`, `stores`,
`ingredient_store_preferences`, `recurring_groceries` re-keyed onto `household_id`).
Isolation is enforced server-side by filtering every read/write on the caller's active
shopping household (`resolveShoppingHouseholdId(ctx)`), and by a NOT_FOUND (never FORBIDDEN)
gate on every mutation that checks the target row's `household_id` equals the caller's.

Note on the `everyone` foot-gun: unlike recipes, the shopping list does NOT consult the
recipe `view` policy at all — scoping is pure `household_id` equality. There is no
`everyone` branch to get wrong. The suite still seeds the LIVE `everyone` recipe policy as
the required sibling and proves it does NOT widen the shopping list.

Tests: `packages/db/__tests__/server/db/repositories/shopping-list.isolation.test.ts` (5, testcontainer):
- member of household A reads only A's groceries/stores/prefs/recurring, never B's;
- `getGroceryHouseholdIds` / `getStoreHouseholdId` / `getRecurringGroceryHouseholdId` return the
  OWNING household (the mutation isolation gate input);
- **`everyone` sibling**: with `server_config.recipe_permission_policy.view = "everyone"` (the live
  value), A's list stays strictly A's — no widening;
- SHOP-01 seed: `seedDefaultAislesForHousehold` seeds aisles + ingredient→aisle mapping,
  `findBestIngredientStorePreference(hh,"milk")` resolves to a seeded aisle, second seed is a no-op.

### Adversarial revert-check (RED → reverted)
Weakened `listGroceriesByHousehold` to drop the `household_id` predicate
(`.where(includeDone ? undefined : eq(isDone,false))`). Result: the isolation suite went
**RED** — both "lists only the caller's household groceries" AND the `everyone`-sibling test
failed (A's list included B's grocery). The weakening was then reverted and the suite is
**GREEN again (5/5)**; `pnpm --filter @norish/db typecheck` EXIT 0; working tree clean for the file.

## Migration `0040` dry-run — RESTORE of the live backup into a SCRATCH db (mirrors Phase 22.4)

Restored `/home/claude/norish-backups/norish-live-20260723-220438-pre-phase24.dump` into a
THROWAWAY `postgres:17-alpine` container (NOT norish-db, NOT the live stack), applied `0040`
in a single transaction, verified, and destroyed the container.

Restored DB was at migration 40 (0000–0039), no `household_id` column. Pre-flight:
**0 users had groceries without a household membership** (no orphans possible).

AFTER `0040`:
- groceries 10 → 10, `null household_id = 0`; stores 0 → 16; prefs 0 → 344; recurring 0 → 0.
- grocery orphans (household_id not a real household) = **0**.
- every grocery mapped to its OWN user's admin household (wrong_owner = **0**).
- both store-less households seeded with the 8 default aisles + mapping (SHOP-01 on live data).
- unique `(household_id, normalized_name)` holds (dup_prefs = 0); temp table dropped.

The migration also applies cleanly on a fresh empty DB (the `@norish/db` testcontainer runs all
migrations incl. `0040` at setup for every suite). The seed uses a session-scoped temp table
(`CREATE TEMP TABLE` + explicit `DROP`) so it is correct under both autocommit and single-txn runners.

## Gates
- `pnpm typecheck` — 17/17 EXIT 0.
- `@norish/db` — green except the two KNOWN sandbox ECONNREFUSED files (`timer-keywords-config`,
  `cleanup-workflows`); 99 tests pass incl. the 6 new isolation tests (+delayed-delivery fixed).
- `@norish/trpc` — 294/294 (baseline).
- `pnpm lint` — 0 errors (warnings at baseline).
- `pnpm i18n:check` — exit 1 SOLELY on the pre-existing `no`-locale gap (68 `[settings]` keys);
  zero i18n/locale files changed, zero new keys.
- `pnpm --filter @norish/web build` — EXIT 0.

**DB 40 → 41. Route through the migration deploy path: backup + boot migration + live data-effect check.**
