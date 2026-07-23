# 25-01 SUMMARY — Shopping list: household-shared + aisle grouping

**Requirements:** SHOP-02 (household-shared), SHOP-01 (aisle grouping)
**DB:** migration `0040_shopping_list_household` — **DB 40 → 41** (re-keys ownership on live tables).

## What shipped

### SHOP-02 — household-shared shopping list
- Schema (`packages/db-schema/src/schema/{groceries,stores,recurring-groceries}.ts`): added
  `household_id` (NOT NULL, FK `households`, cascade) + index to `groceries`, `stores`,
  `ingredient_store_preferences`, `recurring_groceries`. `user_id` RETAINED as added-by/audit.
  `ingredient_store_preferences` unique moved to `(household_id, normalized_name)`.
- Repos re-scoped onto `household_id`: `listGroceriesByHousehold`, `createGroceries/createGrocery`
  (take `householdId`), `markAllDoneInStore`/`deleteDoneInStore` (take `householdId`),
  `getGroceryHouseholdIds` (new isolation gate); `listStoresByHousehold`, `getStoreHouseholdId`,
  `checkStoreNameExistsInHousehold(householdId)`, `listIngredientStorePreferencesByHousehold`,
  `upsertIngredientStorePreference(householdId,userId,…)`, `findBestIngredientStorePreference(householdId,name)`;
  `listRecurringGroceriesByHousehold`, `listDueRecurringGroceries(householdId)`,
  `getRecurringGroceryHouseholdId`. New `getOwnHouseholdId(userId)` in the households repo.
- tRPC: new `resolveShoppingHouseholdId(ctx) = ctx.household?.id ?? getOwnHouseholdId(user)`
  (`packages/trpc/src/helpers.ts`) — the single shopping scope. Grocery/store/recurring routers +
  helpers scope reads/writes to it and gate every mutation with a 404-on-mismatch household check
  (replacing the old owner-based `assertHouseholdAccess`). Store `reorder` hardened with the same gate.
  Realtime emit unchanged (keyed on `ctx.householdKey`; audience == DB scope — D-25-07).
- Zod: `household_id` added to Insert schemas; omitted from Select DTOs (internal isolation key).

### SHOP-01 — aisle grouping (out-of-the-box)
- The shopping-list UI already groups by `store` (ordered aisles) and auto-assigns via
  `ingredient_store_preferences`; SHOP-01's content is a DEFAULT SEED so a fresh household groups
  with zero config. `DEFAULT_AISLES` (8 aisles, 172 curated EN+NL ingredient keywords) +
  `seedDefaultAislesForHousehold(householdId,userId)` in the stores repo, called from
  `createHousehold` (signup / new cookbook / OIDC-claim) — idempotent, best-effort.
- Migration `0040` also seeds the SAME set into EXISTING store-less households (DO block).

### Migration `0040_shopping_list_household`
Add nullable `household_id` → backfill each row to the user's OWN household (earliest household
they ADMIN, fallback earliest membership; injective per user ⇒ no cross-user merge, no unique
collision) → drop per-user unique + dedupe defensively → NOT NULL + FK + index + per-household
unique → seed default aisles into store-less households. Journal entry idx 40 added
(hand-authored, matching the 0039 precedent — no snapshot).

## Decisions
- D-25-01 row remap: OWN household (earliest-admin, fallback earliest-membership).
- D-25-02 keep `user_id` as added-by/audit; isolation now keys on `household_id`.
- D-25-03 personal-list home: the user's own household (`resolveShoppingHouseholdId`).
- D-25-04 category seed: BUILT-IN curated EN+NL set (NOT open-tandoor-data — heavy/out of scope).
- D-25-05 aisle == store level (extend `stores`/`ingredient_store_preferences`; no new tables).
- D-25-06 seed reach: new households (createHousehold) + existing store-less households (migration).
- D-25-07 realtime keyed on `householdKey` (unchanged; audience identical to the DB scope).

## Dry-run (see 25-VALIDATION.md)
`0040` applied to a RESTORE of the live backup in a throwaway `postgres:17` scratch db:
groceries 10→10 (0 null), 0 orphans, every row → its own household, 2 store-less households
seeded (16 stores / 344 prefs), unique holds. Live data was small (10 groceries, 2 households).

## Security (see 25-VALIDATION.md)
Cross-household read/mutate proven blocked (isolation suite, incl. the live-`everyone` sibling
proving the list ignores the recipe policy). Revert-check: weaken the household filter → suite
RED → reverted → GREEN.

## Gates
typecheck 17/17 · `@norish/db` green (only the 2 known ECONNREFUSED files fail; 99 pass incl. 6 new) ·
`@norish/trpc` 294/294 · lint 0 errors · i18n exit 1 ONLY on the pre-existing `no` gap (0 new keys) ·
`@norish/web` build EXIT 0.

## Deferred / discovered
- Aisle NAMES seed in English (editable free-text stores); ingredient KEYWORDS are EN+NL.
- New shared-package files are impossible in this sandbox (root-owned node_modules copies), so all
  new code went into existing files; the seed lives in the stores repo.
