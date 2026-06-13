# Phase 3: Per-cookbook (per-household) permission policies - Context

**Gathered:** 2026-06-14
**Status:** DISCUSS — decisions pending Kiran's approval (NOT ready for planning until the DECISIONS block is signed off)

> This is a **discuss/context** artifact. The `<decisions>` below are **recommendations with a default**, not locked choices. Once Kiran approves them, this becomes "Ready for planning" and an executor can plan + build. The phase takes the `03-per-cookbook-policies` slot **provisionally** — see the Sequencing note.

<domain>
## Phase Boundary

Today norish has **one server-wide** `recipe_permission_policy` (`view`/`edit`/`delete` ∈ `everyone|household|owner`), stored in `server_config` and read everywhere via `getRecipePermissionPolicy()`. Phase 2 (D-09) **reinterpreted** the `household` value as "scoped to the recipe's own cookbook (`recipes.household_id`) AND requester must be a member of that cookbook" — but the **policy itself is still a single global setting**. Every cookbook is forced to use the same view/edit/delete rules.

**POLICY-01** makes **each cookbook (household) carry its OWN view/edit/delete policy**, and adds the roadmap nuance: *a household admin can edit/delete any recipe in their household; members edit/delete their own, not others'*.

**In scope:**
- Each household stores its own `view`/`edit`/`delete` policy (defaulting to today's server-wide values).
- `canAccessResource` + `buildViewPolicyCondition` resolve the policy **from the recipe's cookbook** instead of the global setting.
- The **admin-edits-any / members-edit-own** rule, server-side + tested.
- An **admin-only** UI on the Household settings page to set that household's policy.
- The dedicated per-cookbook isolation tests (HOUSE-06) stay green; new tests for the per-cookbook policy + admin-vs-member rule.
- One Drizzle migration + backfill (each existing household → current server-wide values).
- i18n for the new UI in all **11 locales** (da, de-formal, de-informal, en, es, fr, it, ko, nl, pl, ru).

**Out of scope / deferred:**
- **Move-recipe-between-cookbooks** (the OTHER half of HOUSE-08) — explicitly NOT this phase.
- **Sharing** (SHARE-01, backlog) — the per-recipe public-link share path is a separate feature; we only flag the interaction (Decision e).
- Mobile app (`apps/mobile`).
- Per-**recipe** (vs per-cookbook) ACLs — not requested.

</domain>

<current_state>
## Current State (ground truth — quoted from the actual code)

### Where the single server-wide policy is read

**1. `packages/auth/src/permissions.ts` — `canAccessResource`** (the per-recipe gate used by `assertRecipeAccess` / `findRecipeForViewer`). It **already** receives the recipe's `householdId` and the requester's member-household set (the 02-03 boundary), but it reads the **global** policy:

```ts
export async function getRecipePermissionPolicy(): Promise<RecipePermissionPolicy> {
  const value = await getConfig<RecipePermissionPolicy>(ServerConfigKeys.RECIPE_PERMISSION_POLICY);
  return value ?? DEFAULT_RECIPE_PERMISSION_POLICY;
}

export async function canAccessResource(
  action: PermissionAction,
  userId: string,
  ownerId: string,
  resourceHouseholdId: string | null,
  requesterMemberHouseholdIds: string[],
  isServerAdmin: boolean
): Promise<boolean> {
  if (userId === ownerId || isServerAdmin) return true;

  const policy = await getRecipePermissionPolicy();   // <-- GLOBAL read; the seam
  const policyLevel = policy[action];

  switch (policyLevel) {
    case "everyone":
      return true;
    case "household": {
      if (resourceHouseholdId === null) return false;            // personal = owner-only
      return requesterMemberHouseholdIds.includes(resourceHouseholdId);  // member-of-cookbook
    }
    default:
      return false;   // "owner" — only the owner short-circuit above passes
  }
}
```

> Note: there are **TWO** `getRecipePermissionPolicy` implementations in the tree — this one in `@norish/auth/permissions` (used by `canAccessResource`) AND one re-exported from `@norish/config/server-config-loader` (used by the routers: ratings, shares, pending, recipes, households L607, permissions, admin/ai-config). **Both read the same global `server_config` row.** POLICY-01 must thread per-cookbook resolution through BOTH or consolidate them.

**2. `packages/db/src/repositories/recipes.ts` — `buildViewPolicyCondition`** (the list-scoping SQL builder, used by `listRecipes`, favorites, ratings list — L326/L1429/L1510). It reads only `policy.view`, globally, via a thin `getRecipeViewPolicy()`:

```ts
type RecipeViewPolicy = RecipePermissionPolicy["view"];

async function getRecipeViewPolicy(): Promise<RecipeViewPolicy> {
  const policy = await getConfig<RecipePermissionPolicy>(ServerConfigKeys.RECIPE_PERMISSION_POLICY);
  return policy?.view ?? DEFAULT_RECIPE_PERMISSION_POLICY.view;   // <-- GLOBAL read; the seam
}

export interface RecipeListContext {
  userId: string;
  householdUserIds: string[] | null;
  activeHouseholdId: string | null;
  memberHouseholdIds: string[];
  isServerAdmin: boolean;
}

async function buildViewPolicyCondition(ctx: RecipeListContext) {
  const viewLevel = await getRecipeViewPolicy();
  if (ctx.isServerAdmin) return undefined;            // admin sees all
  switch (viewLevel) {
    case "everyone":
      return undefined;                               // no filter
    case "household":
      if (ctx.activeHouseholdId) {
        return or(eq(recipes.householdId, ctx.activeHouseholdId), isNull(recipes.userId));
      }
      return or(
        and(isNull(recipes.householdId), eq(recipes.userId, ctx.userId)),
        isNull(recipes.userId)
      );
    case "owner":
      return or(eq(recipes.userId, ctx.userId), isNull(recipes.userId));
    default:
      return or(eq(recipes.userId, ctx.userId), isNull(recipes.userId));
  }
}
```

### Why the list-scoping seam is already 90% solved by HOUSE-06

`buildViewPolicyCondition` runs in the context of **one active cookbook** (`ctx.activeHouseholdId`). The list a user sees is **already** scoped to that single cookbook's recipes (the HOUSE-06 isolation boundary). So the only `view` value that meaningfully varies the LIST is `everyone` (cross-cookbook): the `household` branch and the per-cookbook policy collapse to the SAME thing for a member browsing their active cookbook. **This means the per-cookbook `view` policy is read from the ACTIVE cookbook, not per-row** — the list never mixes cookbooks. (See Design §B for the one subtlety: a per-cookbook `view = everyone` would have to widen the filter to also surface that specific cookbook's recipes to non-members — flagged as Decision e.)

### Storage today

- `packages/config/src/zod/server-config.ts` defines `RecipePermissionPolicySchema` (`view` default `everyone`, `edit`/`delete` default `household`), `DEFAULT_RECIPE_PERMISSION_POLICY`, and the `RECIPE_PERMISSION_POLICY` config key. The value lives as **one row** in the `server_config` table (key/value JSONB, versioned), read via `getConfig(...)`.
- `packages/db/src/schema/households.ts` — the `households` table currently has `id, name, adminUserId, joinCode, joinCodeExpiresAt, inviteToken, ..., versionColumn`. **No policy columns yet.** Crucially it has a **single `adminUserId`** (one admin per household); `getHouseholdsForUser` derives a per-member `isAdmin = member.userId === h.adminUserId` boolean. This single-admin model is what the "admin-edits-any" rule keys off.
- `packages/db/src/schema/recipes.ts` — `recipes.householdId uuid NULL REFERENCES households(id) ON DELETE SET NULL` (added in Phase 2, `idx_recipes_household_id`, `uq_recipes_url_household`). This is the cookbook pointer every policy resolution keys off.

</current_state>

<decisions>
## DECISIONS for Kiran (recommendations + default — APPROVE/AMEND each)

> These are the gate. Each has a recommended default in **bold**. Nothing is built until Kiran signs off.

### (a) Storage shape — where the per-cookbook policy lives
- **D-01 (RECOMMENDED): Three enum columns on `households`** — `view_policy`, `edit_policy`, `delete_policy`, each `pgEnum` reusing the existing `everyone|household|owner` values, `NOT NULL DEFAULT` matching `DEFAULT_RECIPE_PERMISSION_POLICY` (`everyone`/`household`/`household`).
  - **Why:** a household has **exactly one** policy (1:1), so columns are the minimal idiomatic shape — mirrors how Phase 2 put `recipes.household_id` directly on `recipes` rather than a join table (02 D-01). No extra table, no extra join in the hot path (`canAccessResource` already loads the recipe row; the household row is one cheap lookup or join). Drizzle migration is trivial. Reuses the existing `PermissionLevelSchema` enum.
  - **Alternative (rejected): a separate `household_policies` table** keyed by `household_id`. Buys nothing for a strict 1:1 and adds a join + a "missing row" edge case. Only worth it if policies grow to many dimensions or need history — not in scope.
  - **Alternative (rejected): a JSONB `policy` column on `households`.** Loses enum-level DB validation and clean Drizzle typing; the global one is JSONB only because it sits in a generic key/value `server_config` table. A first-class table deserves typed columns.
  - **Enum reuse note:** decide whether to reuse the existing Postgres enum from `PermissionLevelSchema` or mint a new `pg_enum` — recommend **reuse** (one `permission_level` enum) so the values can't drift.

### (b) Which dimensions are per-cookbook
- **D-02 (RECOMMENDED): all three — `view`, `edit`, `delete` — go per-cookbook**, for symmetry with the global policy and because the admin-vs-member nuance (Decision c) lives on `edit`/`delete`. The global `recipe_permission_policy` is then **demoted to "default for new cookbooks"** (Decision d), not a live gate.
  - **Alternative:** make only `edit`/`delete` per-cookbook and keep `view` global. Tempting because (per Current State) the active-cookbook list already makes `view` mostly moot — but it splits the mental model and complicates the UI ("two of these are yours, one is the server's"). Recommend **against** unless Kiran wants minimal surface for v1.

### (c) The "admin-edits-any / members-edit-own" rule — semantics
This is the core new behavior. Three ways to model it; recommendation is option **D-03-A**.
- **D-03-A (RECOMMENDED): redefine what `household` MEANS for `edit`/`delete`** — `edit/delete = household` ⇒ "the household **admin** (`households.adminUserId`) OR the recipe **owner**". Members who are not the admin and not the owner cannot edit others' recipes. `view = household` is unchanged (any member sees it). `owner` and `everyone` keep their current meaning.
  - **Why:** zero new schema beyond Decision (a); it's a semantic refinement of the existing three-value enum, exactly mirroring how 02 D-09 refined `household` for the cookbook model. It maps **directly** to the roadmap sentence. The single-admin model already exists (`adminUserId` + the derived `isAdmin`), so "admin" is unambiguous.
  - **Mechanics:** `canAccessResource` gains the recipe-cookbook's `adminUserId` (or an `isRequesterAdminOfResourceCookbook` boolean computed by the caller) so the `household` branch for `edit`/`delete` can check `userId === ownerId || userId === cookbookAdminId`. The `view` branch keeps the member-of-cookbook check.
- **D-03-B (alternative): a 4th permission level `admin`** (`everyone|household|owner|admin`) where `edit = admin` ⇒ "admin-or-owner" and `edit = household` keeps "any member". More expressive (a cookbook could pick "any member edits" OR "only admin+owner edits") but it's a wider enum touching the global schema, the UI, i18n, and every policy switch. Recommend **only if** Kiran wants both behaviors selectable per cookbook.
- **D-03-C (rejected): a separate boolean `members_can_edit_others`.** Orthogonal flag is the most flexible but the least coherent with the existing single-enum-per-action model and doubles the UI controls. Rejected unless a strong product reason appears.

### (d) Does the server-wide policy stay?
- **D-04 (RECOMMENDED): keep `recipe_permission_policy` as the DEFAULT applied to NEW cookbooks** (read at household-create time → written into the new household's columns), and **stop reading it as a live gate**. The admin "Recipe Permissions" card in **server** settings then reads as "default for new cookbooks" (re-label its i18n copy).
  - **Why:** preserves an admin lever for instance-wide defaults, keeps the existing card meaningful, avoids a destructive config removal. The live gate moves entirely to the per-cookbook columns after backfill.
  - **Alternative:** remove the global policy entirely (and its admin card). Cleaner conceptually but throws away the "set a sane default for everyone" lever and is a bigger blast radius (the admin card, the permissions router payload, ai-config). Recommend **against** for v1.
  - **Personal recipes (`household_id IS NULL`)** have no cookbook row to carry a policy. Recommend they **keep owner-only semantics** (already true: `canAccessResource` returns `false` for `household` when `resourceHouseholdId === null`, and `view=everyone` still exposes them globally if the global default were everyone). Decide: do personal recipes follow the **global default** policy (Decision d keeps it around) or are they **hard owner-only**? **Recommend: personal recipes fall back to the retained global policy** (so `view=everyone` still works for a single-user instance), which is the current behavior — no change.

### (e) Can a cookbook be "public" (per-cookbook `view = everyone`)? Interaction with sharing (SHARE-01)
- **D-05 (RECOMMENDED): YES, allow per-cookbook `view = everyone`**, and make `buildViewPolicyCondition` widen the list filter to also surface **that specific cookbook's** recipes to non-members (a `recipes.household_id IN (<public cookbook ids>)` term), while **all other cookbooks stay isolated**. This is the one place the per-cookbook `view` policy must be read **across cookbooks**, not just the active one.
  - **Implication:** the list query needs the set of `household_id`s whose `view_policy = everyone` (one cheap query, cacheable). `canAccessResource("view", ...)` likewise must treat a recipe whose cookbook is public as viewable by anyone.
  - **Sharing (SHARE-01) note:** SHARE-01 (backlog) is a **per-recipe public link** — orthogonal to a per-cookbook `view=everyone`. They don't conflict, but the eventual SHARE-01 plan should treat a shared link as a **separate grant** that bypasses cookbook view policy for that one recipe. Flag, don't build.
  - **Alternative (simpler v1):** **disallow** per-cookbook `view = everyone` (cap per-cookbook `view` at `household`/`owner`; only the *global default* may be `everyone`). This keeps `buildViewPolicyCondition` reading **only** the active cookbook (no cross-cookbook widening), which is a materially smaller change and keeps HOUSE-06 trivially intact. **Recommend this simpler cap for v1** unless Kiran specifically wants public cookbooks now — in which case D-05 (allow) applies. *(Lead: surface both; this is the highest-leverage scope decision.)*

### (f) UI placement
- **D-06 (RECOMMENDED): an admin-only "Recipe Permissions" card on the Household settings page** (`apps/web/app/(app)/settings/household/...`), mirroring the existing **server** admin card `apps/web/app/(app)/settings/admin/components/permission-policy-card.tsx` (three `Select`s, optimistic save). Visible/editable only when the viewer is that household's admin (`isAdmin` from the household context); read-only or hidden for members.
  - **Why:** the household settings page already hosts members-card, join-code-card, info-card with admin-gated controls (rename, kick, transfer-admin) — the policy card slots in beside them and reuses the same admin gate + optimistic-version mutation pattern.

</decisions>

<design>
## Design (recommended approach + how it plugs into the 02-03 boundary)

### A. Policy resolution in `canAccessResource` (the per-recipe gate)
Replace the **global** `getRecipePermissionPolicy()` read inside `canAccessResource` with a **per-cookbook** resolution keyed off the recipe's `resourceHouseholdId` (which the function already receives):
- If `resourceHouseholdId` is non-null → load that household's `{view_policy, edit_policy, delete_policy}` (+ its `adminUserId` for Decision c). Recommend the caller (`assertRecipeAccess` / `findRecipeForViewer` in `helpers.ts`) resolve the household policy + admin once and pass it in, OR `canAccessResource` does a cached lookup by `householdId` — to keep `canAccessResource` synchronous-ish and testable, **prefer passing a resolved `cookbookPolicy` + `cookbookAdminId` argument** (parallels how 02-03 pushed `householdId` + `memberHouseholdIds` into the signature rather than having the function fetch).
- If `resourceHouseholdId` is null (personal) → fall back to the retained global default (Decision d) — unchanged behavior.
- The `household` branch for `edit`/`delete` becomes "owner OR cookbook admin" (Decision c, D-03-A). The `view` branch stays "member of cookbook" (+ public-cookbook widening if Decision e = allow).

### B. Policy resolution in `buildViewPolicyCondition` (the list scoping)
- For a member browsing their **active** cookbook, the view policy is read from the **active cookbook's** `view_policy` (one lookup; `ctx.activeHouseholdId` is already present in `RecipeListContext`). Because the list is already isolated to the active cookbook, `view = household` and a per-cookbook policy collapse to the same SQL — so this is mostly a **source swap** (read the active cookbook's column instead of the global row).
- **Only if Decision e = allow public cookbooks:** add a term to also include recipes whose cookbook has `view_policy = everyone` (a `inArray(recipes.householdId, publicCookbookIds)` clause). `RecipeListContext` would gain the `publicCookbookIds` set (resolved in middleware/context, cacheable). If Decision e = disallow (recommended v1), **no cross-cookbook term is needed** and the change is purely the source swap.
- Server admin still returns `undefined` (sees all) — unchanged.

### C. Default-for-new-cookbooks + backfill
- `createHousehold` reads the retained global `recipe_permission_policy` and writes its values into the new household's three columns (Decision d). The columns also have static DB defaults equal to `DEFAULT_RECIPE_PERMISSION_POLICY` as a safety net.
- **Backfill:** the single Drizzle migration sets every existing household's `view_policy/edit_policy/delete_policy` to the **current** global `recipe_permission_policy` value. On THIS instance there are **0 households** (per 02 D-15: 1 user / 9 recipes / 0 households), so the backfill is a no-op in practice but must be correct for real deployments. Where the live global value can't be read inside the migration SQL, the column DEFAULT (= `DEFAULT_RECIPE_PERMISSION_POLICY`) covers new rows and the backfill `UPDATE ... SET ... = '<default>'` covers existing rows; an admin then adjusts per cookbook.

### D. The two `getRecipePermissionPolicy` readers
Audit + reconcile: `canAccessResource` (auth) must go per-cookbook. The **router-level** readers (ratings, shares, pending, recipes, households L607, permissions.get, admin/ai-config) mostly use `policy.view` to decide **realtime emit scope** (`emitByPolicy`) — these should read the **relevant cookbook's** view policy (the recipe's cookbook for recipe/rating/share events; the kicked user's relevant household for the households L607 `policyUpdated` emit) rather than the global one, OR be left on the global default with a documented caveat. Recommend: thread the cookbook policy where a recipe/cookbook is in scope; leave `permissions.get` returning the **global default** (re-labeled "default") plus, optionally, the active cookbook's effective policy for the client. *(This reconciliation is a meaningful slice of the work — call it out in the plan.)*

### E. Realtime / cache
- A `households.setPolicy` mutation (admin-only, optimistic `version`) emits a `policyUpdated`-style event to that household so members' recipe views refetch. Reuse the existing `permissionsEmitter` / `emitToHousehold` plumbing already used on kick (households L607).
- If a `cached-household` entry exists, invalidate it on policy change (the same `invalidateHouseholdCacheForUsers` used on join/leave/kick/rename).
</design>

<security>
## Security — HOUSE-06 isolation is INVARIANT

**The invariant:** a non-member NEVER sees/edits/deletes another cookbook's recipes, **regardless of that cookbook's policy**. The per-cookbook policy only varies access **among the owner / members / everyone WITHIN the existing isolation boundary**. Concretely:
- `edit`/`delete` per cookbook can only ever **narrow** access (owner-only, or admin+owner, or members) — never grant a non-member edit rights.
- `view = household` (default) = members only; `view = owner` = owner only — both strictly inside the boundary.
- The **only** widening is per-cookbook `view = everyone` (Decision e), and that is an **explicit, admin-chosen, per-cookbook** opt-in that exposes ONLY that one cookbook's recipes, never any other cookbook's. If Decision e = disallow (recommended v1), there is **no** widening path at all and HOUSE-06 is trivially preserved.
- A cookbook's policy can **never** reach into another cookbook: resolution is always keyed by the recipe's own `household_id`.

**Adversarial test plan (mirror the 02-03 "weaken → red → revert" discipline):**
1. **Cross-cookbook isolation under every policy combo:** a member of cookbook A must get `404/FORBIDDEN` (not just empty list) for a recipe in cookbook B for `view ∈ {everyone, household, owner}` set on B — A is not a member of B. Assert at BOTH layers: `canAccessResource("view"/"edit"/"delete")` returns false AND `buildViewPolicyCondition` excludes B's rows from A's list.
2. **Admin-vs-member edit (Decision c):** member (non-admin, non-owner) of cookbook A gets FORBIDDEN editing/deleting another member's recipe when `edit/delete = household`; the cookbook **admin** succeeds; the **owner** succeeds.
3. **Public cookbook (only if Decision e = allow):** a non-member CAN view recipes of a cookbook with `view = everyone`, but still CANNOT edit/delete them, and still CANNOT view a *different* non-public cookbook. Setting one cookbook public must not leak any other cookbook.
4. **Weaken-to-red:** temporarily break the per-cookbook keying (e.g. resolve policy from the *active* cookbook instead of the *recipe's* cookbook) and confirm the isolation tests go RED; then revert. This proves the tests actually pin the boundary.
5. **Personal recipes:** `household_id IS NULL` stays owner-only under `household`, and follows the retained global default under `everyone` (Decision d) — no cross-user leak.
</security>

<migration>
## Migration

- **One Drizzle migration `0037_*`** (generated via `pnpm db:generate`, never hand-written except where drizzle-kit can't express the backfill `UPDATE`). It:
  1. Adds `households.view_policy`, `edit_policy`, `delete_policy` (enum, `NOT NULL DEFAULT` = `DEFAULT_RECIPE_PERMISSION_POLICY`: `everyone`/`household`/`household`).
  2. Backfills existing households to the current global `recipe_permission_policy` values (no-op on this instance: 0 households).
- Auto-applies at boot via `migrate()` in `packages/api/src/startup/migrations.ts` (same path as Phase 2's `0035`/`0036`). Latest migration in-tree is **`0036_perpetual_karma.sql`**, so this is **`0037`**.
- No destructive change to `server_config`; the global `recipe_permission_policy` row is retained (Decision d).
</migration>

<files_likely_touched>
## Files Likely Touched (map + rough size)

**Schema + migration (S)**
- `packages/db/src/schema/households.ts` — add 3 enum policy columns (+ reuse/define the `permission_level` pgEnum).
- `packages/db/src/migrations/0037_*.sql` + `meta/` — generated migration + backfill.
- `packages/db/src/schema/relations.ts` — none expected (no new FK), verify.

**Shared contracts / zod (S–M)**
- `packages/config/src/zod/server-config.ts` — reuse `PermissionLevelSchema`; possibly a `HouseholdPolicySchema`/DTO; (D-03-B only: extend the enum with `admin`).
- `packages/shared/src/contracts/dto/household*.ts` + `zod` — add `viewPolicy/editPolicy/deletePolicy` (+ `adminUserId` already present) to the household DTO; a `SetHouseholdPolicyInputSchema` (householdId + 3 levels + version).

**Backend repositories + permissions (M, the core)**
- `packages/auth/src/permissions.ts` — `canAccessResource` per-cookbook resolution + admin-or-owner for `edit/delete` (Decision c); reconcile the duplicate `getRecipePermissionPolicy`.
- `packages/db/src/repositories/recipes.ts` — `buildViewPolicyCondition` source swap (read active cookbook's `view_policy`); `RecipeListContext` (+ `publicCookbookIds` ONLY if Decision e = allow); the `getRecipeViewPolicy` helper.
- `packages/db/src/repositories/households.ts` — `getHouseholdPolicy(householdId)`, `setHouseholdPolicy(...)` (optimistic-version), and write-default-on-create in `createHousehold`; the DTO mappers (`mapHousehold...`) to surface the policy.
- `packages/trpc/src/routers/recipes/helpers.ts` — `assertRecipeAccess` / `findRecipeForViewer` resolve the recipe-cookbook's policy + admin and pass into `canAccessResource`.
- `packages/trpc/src/routers/households/households.ts` — new `setPolicy` mutation (admin-only, version, emit `policyUpdated`); the L607 emit reconciliation.
- `packages/trpc/src/routers/permissions/permissions.ts` — `get` returns the global **default** (re-labeled) + optionally the active cookbook's effective policy.
- `packages/trpc/src/routers/recipes/recipes.ts`, `ratings/ratings.ts`, `recipes/shares.ts`, `recipes/pending.ts` — audit the ~12 `getRecipePermissionPolicy()`/`policy.view` emit-scope reads; thread per-cookbook where a recipe is in scope (Design §D).
- `packages/trpc/src/middleware.ts` / `context.ts` — (ONLY if Decision e = allow) compute `publicCookbookIds`.
- `packages/db/src/cached-household.ts` — surface/invalidate the policy on the cached household.

**Frontend + i18n (M)**
- `apps/web/app/(app)/settings/household/components/` — new `permission-policy-card.tsx` (mirror the admin one), wired into `household-view.tsx` / `household-settings-content.tsx`, admin-gated.
- `apps/web/app/(app)/settings/household/context.tsx` + `apps/web/context/household-context.tsx` — `setPolicy` mutation + expose the active household's policy.
- `apps/web/app/(app)/settings/admin/components/permission-policy-card.tsx` + `context.tsx` — re-label to "default for new cookbooks" (Decision d).
- `apps/web/.../hooks/households/*` — list/mutation hook for `setPolicy` (shared-react factory + web wrapper, mirroring rename/transferAdmin from 02-05).
- `packages/i18n/src/messages/<locale>/{settings,household}.json` — new keys in **all 11 locales**; gate via `pnpm i18n:check` (source of truth = `en`).

**Tests (M)**
- `packages/auth/__tests__/permissions.test.ts` — per-cookbook policy + admin-vs-member matrix.
- `packages/trpc/__tests__/recipes/permissions-integration.test.ts` — the adversarial isolation matrix (Security §) + weaken-to-red.
- `packages/db` repo tests for `setHouseholdPolicy`/`getHouseholdPolicy` + `buildViewPolicyCondition` source.

**Rough size:** medium phase, larger than 02-05 (rename) but smaller than 02-02. The schema + migration + UI + i18n are mechanical; the **weight is in (1)** the `canAccessResource` per-cookbook + admin-vs-member logic and **(2)** the ~12-call reconciliation of the duplicate policy readers + emit-scope. If Decision e = **disallow** (recommended v1), drop the cross-cookbook `publicCookbookIds` work entirely — meaningfully smaller. Estimate ~4–6 executable tasks (schema/migration; permissions+repo core; router+mutation+emit reconcile; UI+context; i18n; tests/adversarial) — the planner sizes precisely.
</files_likely_touched>

<sequencing>
## Sequencing note — POLICY-01 vs the video phase

The roadmap had a "Phase 3 = video transcription" (VIDEO-01..04, AssemblyAI). POLICY-01 is the **critical near-term** item but is **not yet sequenced** against video. **Kiran chooses the order.** This doc provisionally takes the `03-per-cookbook-policies` directory slot; if video goes first, this becomes `04-` (or whatever slot) — the content is independent of the number. No code in this phase depends on the video phase or vice-versa, so either order is safe.
</sequencing>

<specifics>
## Specific Ideas

- Mirror the **existing server admin** "Recipe Permissions" card exactly (`apps/web/app/(app)/settings/admin/components/permission-policy-card.tsx`: three heroui `Select`s, optimistic save, `ShieldCheckIcon`) for the per-household card — familiar, zero new design.
- Keep diffs minimal + re-baseable against upstream norish (CLAUDE.md hard constraint). The per-cookbook policy is an **additive** set of columns + a semantic refinement of the existing enum — not a rewrite.
- The single-admin model (`households.adminUserId`) is the natural home for "admin-edits-any" — no new role system needed.
</specifics>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Hard constraints / process
- `CLAUDE.md` — fork hard constraints: complete work / no placeholders, match upstream style, pnpm@10.33.2, ESM/TS 5.9, **Drizzle migrations auto-applied at boot**, **per-cookbook isolation is security-critical and must be server-side + tested**.
- `.planning/REQUIREMENTS.md` — **POLICY-01** (line 74: per-household policies, admin-edits-any/members-edit-own), **HOUSE-06** (line 24: isolation, security-critical, DONE), **HOUSE-08** (line 44: per-cookbook policy / move-recipe — this phase takes the *policy* half).
- `.planning/phases/02-multi-household/02-CONTEXT.md` — **D-09** (policy reinterpretation per-cookbook), **D-10** (per-cookbook override DEFERRED to here), **D-11/D-12** (the isolation boundary + `canAccessResource` signature), **D-15** (migration/backfill pattern; 0 households on this instance).

### Permissions + isolation (the seam)
- `packages/auth/src/permissions.ts` — `canAccessResource` (the per-recipe gate; already takes `resourceHouseholdId` + `requesterMemberHouseholdIds`), the duplicate `getRecipePermissionPolicy`.
- `packages/db/src/repositories/recipes.ts` — `buildViewPolicyCondition`, `getRecipeViewPolicy`, `RecipeListContext`, `getRecipeOwnerAndHousehold`.
- `packages/trpc/src/routers/recipes/helpers.ts` — `assertRecipeAccess`, `findRecipeForViewer` (the callers that pass `householdId` + `memberHouseholdIds` into `canAccessResource`).
- `packages/trpc/src/middleware.ts` §44/§65/§123 — `memberHouseholdIds` derivation in `withAuth`.

### Storage
- `packages/config/src/zod/server-config.ts` — `RecipePermissionPolicySchema`, `PermissionLevelSchema`, `DEFAULT_RECIPE_PERMISSION_POLICY`, `RECIPE_PERMISSION_POLICY` key.
- `packages/db/src/schema/households.ts` — target for the 3 policy columns; `adminUserId` (single admin).
- `packages/db/src/schema/recipes.ts` — `recipes.householdId` (the cookbook pointer policy resolves off).
- `packages/db/src/repositories/households.ts` — `createHousehold`, `getHouseholdsForUser` (derives `isAdmin`), `getHouseholdMemberIds(householdId)`, `isUserHouseholdAdmin`, `renameHousehold`/`transferHouseholdAdmin` (the admin-gated optimistic-version mutation pattern to mirror).

### Policy readers to reconcile (Design §D)
- `packages/trpc/src/routers/{ratings/ratings.ts, recipes/shares.ts, recipes/pending.ts, recipes/recipes.ts, permissions/permissions.ts, admin/ai-config.ts}` + `households/households.ts` §607 — all call `getRecipePermissionPolicy()` (mostly for `emitByPolicy` scope).

### UI + i18n
- `apps/web/app/(app)/settings/admin/components/permission-policy-card.tsx` + `context.tsx` — the card to mirror for the per-household version (+ re-label as "default").
- `apps/web/app/(app)/settings/household/components/{household-settings-content,household-view,household-info-card,members-card,join-code-card}.tsx` + `context.tsx`, `apps/web/context/household-context.tsx` — where the per-household card + `setPolicy` wiring land.
- `packages/i18n/src/messages/<locale>/{settings,household}.json` + `pnpm i18n:check` — all **11 locales** (da, de-formal, de-informal, en, es, fr, it, ko, nl, pl, ru), source of truth `en`.

### Tests
- `packages/auth/__tests__/permissions.test.ts`, `packages/trpc/__tests__/recipes/permissions-integration.test.ts` — extend for the per-cookbook policy matrix + adversarial isolation (weaken → red → revert).
</canonical_refs>

<deferred>
## Deferred Ideas

- **Move-recipe-between-cookbooks** (the other half of HOUSE-08) — change a recipe's `household_id`; needs its own move-permission + dedup-collision handling. Separate phase.
- **SHARE-01** (backlog) — per-recipe public share link; orthogonal to per-cookbook `view=everyone`; treat a share as a separate grant that bypasses cookbook view policy for one recipe.
- **Per-recipe ACLs / multiple admins per household** — not requested; the single-`adminUserId` model is assumed throughout.
- **D-03-B (4th `admin` permission level)** — only if Kiran wants "any member edits" AND "admin+owner only" both selectable per cookbook; otherwise the `household`-means-admin-or-owner refinement (D-03-A) covers the roadmap need.
</deferred>

---

*Phase: 03-per-cookbook-policies (provisional slot — see Sequencing)*
*Context gathered: 2026-06-14*
*Status: DISCUSS — DECISIONS pending Kiran's approval*
