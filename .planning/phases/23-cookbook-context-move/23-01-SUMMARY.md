# 23-01 SUMMARY — Server-side move recipe between cookbooks

**Commit:** `52c5b44e`
**Requirement:** CKBK-MOVE-01

## What shipped
- `RecipeMoveInputSchema` (`{ id, destinationHouseholdId: uuid|null, version }`) in
  `packages/shared/src/contracts/zod/recipe.ts`.
- `moveRecipeToHousehold(id, destination, version)` in `packages/db/.../recipes.ts` — writes
  ONLY `recipes.household_id` (owner unchanged — D-23-01), version-guarded (MutationOutcome),
  and maps a `uq_recipes_url_household` unique violation to `MOVE_DESTINATION_URL_CONFLICT`.
- `assertRecipeMoveAllowed(ctx, id, destination)` in the recipes router helpers — the testable
  authorization seam: SOURCE = `assertRecipeAccess(edit)` (POLICY-01 edit on the recipe's own
  cookbook), DESTINATION = membership for a household / ownership for Personal (D-23-02/03),
  no-op guard (D-23-04), server-admin parity.
- `recipes.move` tRPC procedure — auth → resolve SOURCE realtime scope BEFORE the move →
  move (CONFLICT on url collision) → emit `deleted {id}` to the source cookbook + `created`
  (dashboard DTO) to the destination, each scoped to the recipe's own cookbook (D-23-06,
  AGENTS.md realtime rule), never broadcast.

## Tests
- `packages/trpc/__tests__/recipes/move-permissions.test.ts` — 13 adversarial cases written
  failing-first, seeding both `edit=household` AND the `edit=everyone` sibling. trpc 281 → 294.

## Decisions
- Ownership stays with the creator; only the cookbook moves (D-23-01).
- Open question resolved (D-23-07): ratings + share links travel with the recipe (keyed by
  `recipe_id`, unchanged) — no reset, no code.
- No schema change / no migration (D-23-08).
</content>
