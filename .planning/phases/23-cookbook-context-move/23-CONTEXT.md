# Phase 23: Cookbook context & moving recipes — Context

**Gathered:** 2026-07-23
**Status:** Ready for planning
**Requirement:** CKBK-MOVE-01 (source: UAT section B3)

<domain>
## Phase Boundary

A recipe never shows which cookbook it lives in, and there is no way to move it.
This phase makes the multi-cookbook model (Phase 2) legible and adds a guarded move:

1. **Show owning cookbook** on the recipe detail view (desktop + mobile web surfaces).
   A personal recipe (`household_id IS NULL`) shows "Personal".
2. **Move-to-cookbook** action — tapping the cookbook opens a picker of cookbooks the
   user may write to; moving updates `recipes.household_id`, enforced server-side.
3. **Cookbooks browser** nav entry (desktop + mobile) listing the user's cookbooks.

Out of scope: `apps/mobile` (Expo) — "mobile detail surface" = the web app's mobile layout,
consistent with Phase 2's deferral of the native app. No schema change.
</domain>

<decisions>
## Decisions (recorded)

### D-23-01 — Ownership on move: keep the owner, change only the location
A move updates ONLY `recipes.household_id`. `recipes.userId` (the creator/owner) is
UNCHANGED. This is consistent with Phase 2 (02 D-01/D-09): `userId` = owner identity,
`householdId` = cookbook location. It preserves the owner's edit rights post-move (the
owner short-circuit in `canAccessResource`) and grants the destination cookbook's admin
"admin-edits-any" over it. A move never orphans the recipe (owner is never cleared).

### D-23-02 — Source authorization = POLICY-01 edit right on the recipe's own cookbook
The actor must pass `canAccessResource("edit", …)` resolved against the recipe's SOURCE
cookbook — i.e. `assertRecipeAccess(ctx, id, "edit")`. Under `edit = household` (and the
`everyone` sibling, which `canAccessResource` collapses to household for edit) this is
"owner OR source-cookbook admin". A non-member / non-owner / non-admin member is denied —
which also satisfies HOUSE-06 "never move a recipe you cannot even see" (a non-member fails
the edit gate before any move happens).

### D-23-03 — Destination authorization = membership (household) or ownership (Personal)
- Destination is a household H: the actor must be a MEMBER of H
  (`ctx.memberHouseholdIds.includes(H)`). Membership is the right to add — Phase 2 lets any
  member create recipes in a cookbook; there is no separate "add" policy dimension.
- Destination is Personal (`null`): the actor must be the recipe OWNER
  (`owner.userId === ctx.user.id`). "Personal" is the actor's own owner-only space; letting
  a non-owner drop a recipe there would hide it (owner-only) or strand it — disallowed.
- Server admin bypasses both (parity with `canAccessResource`).

### D-23-04 — No-op guard
Moving to the cookbook the recipe is already in is a `BAD_REQUEST` (`already in this
cookbook`), never a silent no-op that emits events.

### D-23-05 — URL-uniqueness collision on the destination
`uq_recipes_url_household (url, household_id)` means moving a URL-bearing recipe into a
cookbook that already holds that URL violates the constraint. The repo catches the unique
violation and the router maps it to `CONFLICT` (`a recipe with this URL already exists in
the destination cookbook`). Moving to Personal (`null` household) never collides (Postgres
treats NULLs as distinct), matching Phase 2 D-13.

### D-23-06 — Realtime: source `deleted` (id-only) + destination `created` (dashboard DTO)
Two events, each scoped by the recipe's OWN cookbook per the AGENTS.md "Realtime scoping"
rule (Phase 22 D-22-02), neither ever broadcast:
1. BEFORE the move — resolve `resolveRecipeRealtimeScope(id)` (recipe still in the SOURCE
   cookbook) → emit `deleted { id }` to the source cookbook. Id-only: it carries NO recipe
   data, so it does not leak the recipe to the cookbook it left; it only lets source members
   drop a now-stale card.
2. AFTER the move — resolve `resolveRecipeRealtimeScope(id)` again (recipe now in the
   DESTINATION cookbook) → emit `created { recipe: dashboardDto }` to the destination so its
   members' lists gain the card (the `onCreated` handler upserts by id).
Interpretation of Success Criterion 4 ("without notifying the cookbook it left or a cookbook
it never entered"): no recipe DTO is pushed to the source or to any unrelated cookbook — the
id-only `deleted` signal to the source is not a content leak and keeps the source list honest
without a manual refresh. Unrelated cookbooks are never targeted (isolation intact).

### D-23-07 — Open question (ratings + share links): they travel with the recipe
`recipe_ratings` and `recipe_shares` are keyed by `recipe_id`, which is unchanged by a move.
Ratings therefore travel with the recipe (no reset); rater-visibility follows the new
cookbook's membership automatically at read time. A public share link is a per-recipe grant
that bypasses cookbook policy (Phase 3 note) — it keeps working after the move. This is the
zero-work, least-surprising choice and needs no code. Recorded so the director can revisit.

### D-23-08 — No schema change / no migration
The move only writes `recipes.household_id` (existing column). No new columns, no migration.
DB stays at migration 40. Flagged explicitly because it keeps the deploy a code-only swap.
</decisions>

<security>
## Security — HOUSE-06 / POLICY-01 are INVARIANT

A move can only ever move a recipe BETWEEN cookbooks the actor is authorised on; it can
never widen who may see/edit a recipe beyond the destination's existing members, and can
never move a recipe the actor cannot see.

Adversarial matrix (tests-first, seed the LIVE `everyone` policy shape as a sibling of
`household` per the AGENTS.md rule):
1. A non-member of the source cookbook CANNOT move its recipe (source edit gate) — proven
   for `edit ∈ {household, everyone}`.
2. A member of the source who is NOT the admin and NOT the owner CANNOT move another
   member's recipe when `edit ∈ {household, everyone}`; the source admin CAN; the owner CAN.
3. A user CANNOT move a recipe INTO a household they do not belong to (destination gate).
4. A non-owner CANNOT move a recipe into Personal (destination = null gate).
5. Revert-check: weaken the guard (skip the destination membership check) → the isolation
   tests go RED → revert byte-identical. Recorded in 23-VALIDATION.md.
</security>

<files>
## Files (map)

**Backend (Plan 23-01)**
- `packages/shared/src/contracts/zod/recipe.ts` — `RecipeMoveInputSchema`.
- `packages/db/src/repositories/recipes.ts` — `moveRecipeToHousehold(id, destination, version)`
  (writes household_id, bumps version, MutationOutcome; maps unique-violation → typed error).
- `packages/trpc/src/routers/recipes/helpers.ts` — `assertRecipeMoveAllowed(ctx, id, dest)`
  (source edit gate + destination membership/owner gate; the testable seam).
- `packages/trpc/src/routers/recipes/recipes.ts` — `move` procedure (auth → move → 2 emits).
- Tests: `packages/trpc/__tests__/recipes/move-permissions.test.ts` (adversarial, tests-first).

**Frontend (Plan 23-02)**
- `packages/shared-react/src/hooks/recipes/dashboard/use-recipes-mutations.ts` — `moveRecipe`.
- `apps/web/hooks/recipes/*`, `apps/web/context/recipes-context.tsx` — expose `moveRecipe`.
- `apps/web/components/recipes/cookbook-chip.tsx` (new) + move modal — the tap-to-move UI.
- `apps/web/components/recipes/readonly-recipe-sections.tsx` — render the cookbook chip.
- `apps/web/app/(app)/recipes/[id]/recipe-page-{desktop,mobile}.tsx` — wire the chip in.
- `apps/web/config/site.ts`, `apps/web/components/navbar/{navbar,mobile-nav}.tsx` — Cookbooks entry.
- `apps/web/app/(app)/cookbooks/page.tsx` (new) — the cookbooks browser.
- `packages/i18n/src/messages/<locale>/{navbar,recipes}.json` — new keys in ALL 12 locales.
</files>

---
*Phase: 23-cookbook-context-move — Context gathered 2026-07-23*
</content>
</invoke>
