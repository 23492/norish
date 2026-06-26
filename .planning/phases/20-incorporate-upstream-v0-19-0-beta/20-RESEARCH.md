# Phase 20: Incorporate Upstream v0.19.0-beta — Research

**Researched:** 2026-06-26
**Domain:** Git merge mechanics, upstream schema-split adoption, module-boundary refactor, hard-constraint re-assertion, beta-env provisioning
**Confidence:** HIGH (all claims grounded in `git merge-tree`, `git show`, `git diff`, live filesystem inspection)

---

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

- **D-01:** `git merge upstream/main` onto a dedicated integration branch — NOT rebase, NOT squash-merge.
- **D-02:** Branch name `integ/upstream-0.19.0` off `main` (`866f518e`). Tag `main` first (e.g. `pre-0.19.0-integration`).
- **D-03:** One `git merge`, then resolve conflicts in dependency-ordered plans by subsystem: `db-schema` → `api`/`parser` → `auth`/`permissions` → `seed-config` → `web` UI. Each subsystem = its own gsd plan with isolation/build gates.
- **D-04:** Adopt the `@norish/db-schema` split. Re-port fork table additions into `packages/db-schema/src/schema/*`; collapse `packages/db/src/schema/*` to upstream re-export shims.
- **D-05:** Per-table 3-way re-apply for shared tables: take upstream 0.19.0's `@norish/db-schema` file as the base and re-apply ONLY our fork's column/enum/constraint additions on top.
- **D-06 (finding):** Upstream tops at migration 0034 (35 journal entries, idx 0–34). Fork has 0035–0038 on top, NO numbering collision. Schema split is code-only (no new SQL migrations). Live DB at migration 39 → merge introduces no new SQL migrations.
- **D-07:** Take-all, re-assert constraints. Accept all 0.19.0 features by default; override only where a change collides with a fork hard constraint.
- **D-08:** Default conflict bias = favor upstream for non-constraint files. Our code wins only in hard-constraint + feature-bearing files (Camoufox parser, auth/permissions/claim-processor, seed-config, household/sharing/ratings/visibility/policy schema + UI).
- **D-09 (mandatory, non-negotiable):**
  - Scraping stays native Camoufox — `packages/api/src/parser/fetch.ts` → `packages/api/src/camofox.ts`; NEVER reintroduce `playwright.ts` or `playwright-core` dependency or `chrome-headless` service.
  - Per-cookbook isolation (HOUSE-06) suites stay green — adversarially verified.
  - Config-as-code env sync preserved in `seed-config.ts`.
  - WorkOS + multi-household + per-cookbook permissions preserved in `auth.ts`/`permissions.ts`/`claim-processor.ts`.
- **D-10:** Integrate the beta now on `integ/upstream-0.19.0` (do not wait for a stable 0.19.0 tag).
- **D-11:** Publish to a NEW `norish-beta.knoppsmart.com` environment as the final plan(s) of Phase 20. Live (`norish.knoppsmart.com`) stays on the phases-1–19 image throughout.
- **D-12:** `norish-beta` runs a duplicate testing database — clone of live (restore existing dump or fresh dump at provisioning time); never share the live Postgres. Keep it refreshable.

### Claude's Discretion

- Exact subsystem plan count / split granularity within the D-03 dependency order.
- Mechanics of the beta provisioning (compose service name, Cloudflare tunnel/ingress wiring, DB restore scripting) — within the constraints of D-11/D-12.

### Deferred Ideas (OUT OF SCOPE)

- Cutover of 0.19.0 to live `norish.knoppsmart.com` — separate deliberate step after beta validation.
- Other upstream branches — `feature/add-site-auth-tokens`, `Offline-mode`, `rc/0.17.3-beta`, `feature/rss-feed`: each its own future phase.
- Promotion of beta → stable once upstream tags a non-beta 0.19.0.
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| UPSTREAM-019 | Incorporate upstream `norish-recipes/norish` v0.19.0-beta (PR #468, squashed commit `1f684480`) on a dedicated integration branch, re-asserting fork hard constraints, reconciling the `@norish/db-schema` split, and deploying to `norish-beta.knoppsmart.com`. Hard gates: isolation + db/queue testcontainer suites under `sg docker`, typecheck/lint/test green, director-owned `pnpm docker:build`. | All sections below. Conflict surface (49 files, sub-system mapped). Migration status confirmed. Hard-constraint collisions named. Beta provisioning inventoried. |
</phase_requirements>

---

## Summary

Upstream `norish-recipes/norish` v0.19.0-beta (PR #468, squashed commit `1f684480`, 2026-06-19) changes 996 files (+28,983/−17,969 lines) relative to the merge-base `6af3670a`. A `git merge-tree --write-tree HEAD upstream/main` run against our current `HEAD` (`95ed25c9`) predicts **49 conflicts across 48 files** (1 is a modify/delete on `playwright.ts`); 112 files auto-merge cleanly. The CONTEXT.md estimate of "~110 overlapping" was approximate; the real hard-conflict surface is 49 files.

The most consequential upstream change is a **two-part structural refactor**: (1) a new `packages/db-schema/` package that pulls all real schema definitions out of `packages/db/src/schema/` (which collapses to one-line re-export shims), and (2) a module-boundary consolidation that moves `server-config-loader` from `@norish/config` (DELETED) → `@norish/shared-server/config/server-config-loader`, moves Redis pub/sub utilities from `@norish/queue/redis/*` → `@norish/shared-server/redis/*`, and moves realtime emitters from `@norish/trpc/helpers` → `@norish/shared-server/realtime/*`. The auto-merge handles the 83 upstream-touched files correctly (their import paths are already updated in the merged tree); only the 4 fork-only files using the old paths need manual import fixup post-merge.

The fork's hard constraints survive in their most critical file (`packages/api/src/parser/fetch.ts` — `playwright.ts` delete/modify CONFLICT, must be resolved as "keep deleted + rewrite fetch.ts onto `camofox.ts`"). `packages/api/src/startup/seed-config.ts` auto-merges and preserves all fork sync functions (WorkOS, AI, video, toggles). `packages/auth/src/auth.ts`, `permissions.ts`, and `claim-processor.ts` also auto-merge without conflict but carry upstream module-path updates that the fork-specific import sites must mirror.

**Primary recommendation:** Plan structure = 5 conflict-resolution plans (D-03 order: db-schema → api/parser → auth+trpc → web UI → ci/tooling) + 1 beta-env provisioning plan, each gated on the isolation+testcontainer suites and followed by the director-owned `pnpm docker:build` only on the last plan.

---

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Conflict resolution — db-schema | Database / Storage | — | Schema is the lowest-level dependency; all other tiers import from it. Must be resolved first so shims can be tested. |
| Conflict resolution — api/parser | API / Backend | — | Camoufox constraint lives here; depends on db-schema shims. |
| Conflict resolution — auth/permissions/trpc | API / Backend | Frontend Server (SSR) | WorkOS + multi-household sessions span server and SSR context. tRPC middleware is backend. |
| Conflict resolution — web UI | Frontend Server (SSR) | Browser / Client | Most web conflicts are React components + contexts. |
| Conflict resolution — CI/tooling | CDN / Static | — | GitHub Actions + pnpm-workspace catalog; no runtime tier. |
| Beta-env provisioning | CDN / Static | API / Backend | Compose service + Cloudflare ingress + DB clone; no code changes. |

---

## 1. Live Merge Conflict Surface

**Verified command:** `git merge-tree --write-tree HEAD upstream/main`
[VERIFIED: git merge-tree output, 2026-06-26]

**Confirmed figures:** 996 files changed in upstream squash commit `1f684480` (verified via `git show 1f684480 --stat`). **49 total conflicts** (48 content conflicts + 1 modify/delete). 112 auto-merges. The "~110 overlapping" from CONTEXT.md refers to the total overlap set; hard conflicts are 49.

### Conflicts by D-03 Subsystem Order

#### Subsystem 1 — `db-schema` (4 files, HIGHEST RISK)

All 4 files are `packages/db/src/schema/*` files that upstream collapsed to one-line re-export shims (`export * from "@norish/db-schema/schema/<table>"`), while our fork still contains the full table definitions with our fork-only additions. Resolving these means: (a) create `packages/db-schema/` with upstream's real defs as the base, (b) add our fork columns/enums to the appropriate `packages/db-schema/src/schema/*` files (D-05), and (c) replace `packages/db/src/schema/*` with the upstream shim pattern.

| File | Our Fork Adds | Upstream 0.19.0 Base Has | Classification |
|------|--------------|--------------------------|----------------|
| `packages/db/src/schema/auth.ts` | `activeHouseholdId` column on `users` (mutual FK → `households`, needs `AnyPgColumn`) | All other user/account/session tables (194-line full def in `db-schema/auth.ts`) | 3-way re-apply: add `activeHouseholdId` into `db-schema/src/schema/auth.ts` |
| `packages/db/src/schema/households.ts` | `permissionLevel` enum, `inviteToken`, `viewPolicy`, `editPolicy`, `deletePolicy` columns, `uq_households_invite_token` | base table without those columns | 3-way re-apply: add into `db-schema/src/schema/households.ts` |
| `packages/db/src/schema/recipes.ts` | `householdId` column (FK → `households`), `recipeVisibilityEnum`, `visibility` column, `uq_recipes_url_household` constraint (replaces `uq_recipes_url_user`) | base table without those columns | 3-way re-apply: add into `db-schema/src/schema/recipes.ts` |
| `packages/db/src/schema/relations.ts` | Added `household:` relation on `recipes`, `householdUsers`/`households` relations, `visibility` in recipe | base relations without household/sharing relations | 3-way re-apply: add into `db-schema/src/schema/relations.ts` |

**Note:** `household-users.ts`, `recipe-shares.ts`, `recipe-ratings.ts`, `site-auth-tokens.ts` are identical or non-conflicting — they auto-merge cleanly. See Sections 2 and 5.

#### Subsystem 2 — `api`/`parser` (5 files, HIGHEST RISK for D-09)

| File | Conflict Type | Resolution |
|------|--------------|------------|
| `packages/api/src/playwright.ts` | **MODIFY/DELETE** — our fork deleted it; upstream modified it. Git leaves upstream's version in tree. | **Our deletion WINS.** Delete this file. Never reintroduce. |
| `packages/api/src/parser/fetch.ts` | Content — upstream re-imports from `@norish/api/playwright`; fork uses `@norish/api/camofox`. | **Our version WINS.** `fetch.ts` must import from `camofox.ts`, never `playwright`. See §4. |
| `packages/api/src/ai/image-recipe-parser.ts` | Content — upstream moved server-config-loader import; fork added locale/language threading. | Take upstream import path + keep fork locale logic. |
| `packages/api/src/ai/recipe-parser.ts` | Content — same pattern as image-recipe-parser.ts. | Take upstream import path + keep fork locale logic. |
| `packages/api/src/video/normalizer.ts` | Content — upstream changes; fork added `targetLanguage` threading. | 3-way merge: take both sets of changes. |

#### Subsystem 3 — `auth`/`permissions`/`trpc` (13 files)

**Key finding:** `packages/auth/src/auth.ts`, `packages/auth/src/permissions.ts`, `packages/auth/src/claim-processor.ts` — **all three AUTO-MERGE cleanly** (no CONFLICT lines from merge-tree). However, the auto-merge result carries upstream's new import paths. The auto-merged `claim-processor.ts` now imports `HouseholdUserInfo` from `@norish/shared-server/realtime/households` (upstream path) and `invalidateHouseholdCacheForUsers` from `@norish/shared-server/cache/household`. The fork-specific `auth.ts` additions (WorkOS, multi-household hooks, `addUserToHousehold`, `setActiveHousehold`) survive in the auto-merged result — verified by `git cat-file` on the merge tree.

The 13 conflicts in this group are all in the packages that wrap/consume auth (`shared-react` hooks, `shared/zod`, `trpc` routers). They follow a consistent pattern: upstream did import-path reformatting + added new functionality; our fork added multi-household/sharing/ratings features. Resolution = take upstream's refactored base + re-apply fork additions on top.

| File | Upstream Change | Fork Change |
|------|----------------|-------------|
| `packages/trpc/src/middleware.ts` | Moved `getCachedHouseholdForUser` from `@norish/db/cached-household` → `@norish/shared-server/cache/household`; moved `SubscriptionMultiplexer` from `@norish/queue` → `@norish/shared-server/redis` | Added `getHouseholdsForUser`, `memberHouseholdIds` into `withAuth` ctx |
| `packages/trpc/src/routers/households/households.ts` | Upstream refactoring | Fork added rename/invite mutations |
| `packages/trpc/src/routers/recipes/recipes.ts` | Upstream refactoring | Fork added household scoping |
| `packages/trpc/src/routers/recipes/shares.ts` | Upstream added `recipe-share-links` router | Fork rewrote shares with visibility |
| `packages/trpc/src/routers/recipes/helpers.ts` | Upstream changes | Fork added household-scoped helpers |
| `packages/shared-react/src/hooks/households/types.ts` | Upstream renamed/added types | Fork added multi-household types |
| `packages/shared-react/src/hooks/households/use-household-mutations.ts` | Upstream changes | Fork added rename/invite mutations |
| `packages/shared-react/src/hooks/ratings/index.ts` | Upstream changes | Fork added `useRecipeRatersQuery` |
| `packages/shared-react/src/contexts/households/household-context.tsx` | Import ordering | Fork added mutation hooks |
| `packages/shared-server/src/cache/household.ts` | NEW FILE in upstream (moved from `@norish/db/cached-household`). | Our fork has the OLD location. Git generates conflict because both sides modified the same logical file (our fork's `packages/db/src/cached-household.ts` diverged from the merge-base while upstream extracted it). |
| `packages/shared/src/contracts/zod/household.ts` | Upstream refactoring | Fork added inviteToken, policy types |
| `packages/shared/src/contracts/zod/recipe.ts` | Upstream refactoring | Fork added visibility types |
| `packages/trpc/__tests__/archive/archive-import-validation.test.ts` | Updated mock paths (`@norish/shared-server/cache/household`, `@norish/shared-server/redis/subscription-multiplexer`) | Fork added `getHouseholdsForUser` mock |

#### Subsystem 4 — `seed-config` (0 conflicts)

`packages/api/src/startup/seed-config.ts` **AUTO-MERGES CLEANLY**. [VERIFIED: git merge-tree + git cat-file on merge tree object `27533f5d`]

Auto-merge result verified to contain: `syncWorkOSProvider`, `syncAIConfigFromEnv`, `syncVideoConfigFromEnv`, `syncBooleanToggleFromEnv`, `syncAuthTogglesFromEnv`. Import path correctly updated to `@norish/shared-server/config/server-config-loader` by the 3-way merge. No manual work needed for seed-config itself.

#### Subsystem 5 — Web UI (15 files, MEDIUM RISK)

15 conflicts in `apps/web/`. Most follow the pattern: upstream upgraded HeroUI v2 → v3 (component API changes: `Autocomplete` → `ComboBox`, `Select` → `ListBox`, etc.) AND our fork added multi-household/sharing/ratings UI. Both sets of changes need to win.

| File | Risk | Pattern |
|------|------|---------|
| `apps/web/app/(app)/recipes/[id]/recipe-page-desktop.tsx` | HIGH — ratings display | Upstream UI refactor + fork added `RecipeRaters` component |
| `apps/web/app/(app)/recipes/[id]/recipe-page-mobile.tsx` | HIGH — ratings display | Same |
| `apps/web/app/(app)/recipes/[id]/components/recipe-share-panel.tsx` | HIGH — sharing/visibility | Upstream added new share features; fork rewrote the panel |
| `apps/web/app/share/[token]/page.tsx` | HIGH — public share gate | Upstream UI changes; fork added visibility gate |
| `apps/web/context/household-context.tsx` | MEDIUM | Import ordering (upstream) + fork added hooks |
| `apps/web/context/recipes-context.tsx` | MEDIUM | Upstream refactor + fork added household context watch |
| `apps/web/components/navbar/navbar-user-menu.tsx` | MEDIUM | Upstream UI; fork added cookbook switcher |
| `apps/web/app/(app)/settings/household/components/household-info-card.tsx` | MEDIUM | Upstream UI; fork added rename + policy card |
| `apps/web/app/(app)/settings/household/components/join-code-card.tsx` | MEDIUM | Upstream UI; fork added invite link section |
| `apps/web/app/(app)/settings/household/components/no-household-view.tsx` | MEDIUM | Upstream UI; fork refactored to use modal |
| `apps/web/app/(auth)/login/page.tsx` | MEDIUM | Upstream changes; fork added WorkOS auto-redirect + escape |
| `apps/web/app/(auth)/login/components/auto-sign-in.tsx` | MEDIUM | Upstream changes; fork added `?sso=0` escape link |
| `apps/web/app/(app)/settings/admin/components/video-processing-form.tsx` | LOW | Upstream heroui v3 refactor; fork added AssemblyAI provider |
| `apps/web/components/shared/import-recipe-modal.tsx` | LOW | Upstream UI; fork added active cookbook indicator |
| `apps/web/components/timer-dock.tsx` | LOW | Upstream UI; fork patched timer dock UI bugs |

**HeroUI v2 → v3 note:** The auto-merged `pnpm-workspace.yaml` upgrades `@heroui/react` catalog entry from `^2.8.10` to `^3.0.4`. Upstream also adds `@heroui-pro/react: 1.0.0-beta.5` (`git grep upstream/main` shows it's used in Carousel, Sheet, Segment, DropZone components). `@heroui-pro/react` is on the public npm registry (verified `npm view @heroui-pro/react version` = `1.0.0-beta.6`). The CI workflow adds a `HEROUI_AUTH_TOKEN` secret — but since the package is publicly accessible on npm, `pnpm docker:build` on LXC 110 can install it without a special token (the token is a CI optimization, not a gate).

#### Additional conflicts

- `packages/queue/src/allergy-detection/producer.ts` and `worker.ts` (2 files): upstream moved `server-config-loader` and realtime emitter imports; fork unchanged logic. Resolution: take upstream's new import paths wholesale.
- `packages/ui/src/star-rating.tsx` (1 file): upstream refactored the API (`size`, `allowClear`, `showValueSuffix` props); fork added `userValue`/`onClear` for RATE-01. 3-way merge: unify both feature additions under upstream's new type-safe API.
- `.github/workflows/_node-ci.yml` and `pr-quality.yml` (2 files): upstream added `HEROUI_AUTH_TOKEN` secret, our fork changed `CHROME_WS_ENDPOINT` → `CAMOFOX_URL`. Resolution: keep `CAMOFOX_URL`, add `HEROUI_AUTH_TOKEN`, drop `CHROME_WS_ENDPOINT`.
- `pnpm-lock.yaml` (1 file): always conflicts on merge; regenerate with `pnpm install` after all package.json conflicts are resolved.

---

## 2. `@norish/db-schema` Split Mechanics (D-04/D-05)

[VERIFIED: `git ls-tree upstream/main packages/db-schema/`, `git show upstream/main:packages/db-schema/package.json`, `git show upstream/main:packages/db/src/schema/households.ts`]

### Upstream structure (confirmed)

- **Package:** `packages/db-schema/` (name `@norish/db-schema`, version `0.19.0-beta`)
- **Exports:** `"."→src/schema/index.ts`, `"./schema"→src/schema/index.ts`, `"./schema/*"→src/schema/*.ts`
- **Dependencies:** only `drizzle-orm: catalog:` (no `@norish/config`, no `@norish/db`)
- **`packages/db` dependency:** `"@norish/db-schema": "workspace:*"` in `packages/db/package.json`
- **Shim pattern:** `packages/db/src/schema/households.ts` = `export * from "@norish/db-schema/schema/households";`
- **Top-level index:** `packages/db/src/schema/index.ts` = `export * from "@norish/db-schema/schema";`
- **pnpm-workspace:** `packages/*` glob already picks up `packages/db-schema/` — no explicit entry needed. (Note: upstream adds `"!apps/quick-import-extension"` exclusion — fork should adopt this too.)

### Fork `@norish/db-schema` does NOT exist yet

[VERIFIED: `ls /opt/norish-src/packages/db-schema/` → directory absent]

This directory must be **created from scratch** during the db-schema conflict-resolution plan (Plan 20-01). The simplest approach: after `git merge`, the conflict on `packages/db/src/schema/households.ts` delivers `upstream/main`'s shim as option 3 and our fork's full def as option 2; resolve by creating `packages/db-schema/` with upstream's full defs + re-porting fork additions, then accepting upstream's shim for `packages/db/src/schema/`.

### Per-Table Re-port Inventory

For each table, the leftmost column is the target file in `packages/db-schema/src/schema/`.

| Target File | Fork-Only Additions | Upstream 0.19.0 Changes? | Classification |
|-------------|--------------------|--------------------------|-|
| `auth.ts` | `activeHouseholdId uuid` column on `users` (mutual FK, needs `AnyPgColumn`), `import { type AnyPgColumn }` | Yes — extensive refactoring of the auth tables (194-line def) | **3-way re-apply**: take upstream's full `db-schema/auth.ts` as base, ADD our `activeHouseholdId` FK column + `AnyPgColumn` import |
| `households.ts` | `permissionLevel` pgEnum, `inviteToken text`, `viewPolicy`/`editPolicy`/`deletePolicy` columns (permissionLevel enum), `uq_households_invite_token` index | Yes — upstream 0.19.0 base (without those cols) | **3-way re-apply**: take upstream `db-schema/households.ts` as base, ADD `permissionLevel` enum + `inviteToken` + 3 policy columns + unique constraint |
| `recipes.ts` | `householdId uuid` FK column, `recipeVisibilityEnum` pgEnum, `visibility` column, `idx_recipes_household_id` index, `uq_recipes_url_household` (replaces upstream's `uq_recipes_url_user`) | Yes — upstream still has `uq_recipes_url_user` | **3-way re-apply**: take upstream `db-schema/recipes.ts`, REPLACE `uq_recipes_url_user` with `uq_recipes_url_household`, ADD `householdId` + `recipeVisibilityEnum` + `visibility` + household index |
| `relations.ts` | `household:` one-relation on `recipes`, `householdUsers` and `households` relations with `household: many(householdUsers)` / `householdUsers: many(householdUsers)`, visibility carried through | Yes — upstream `db-schema/relations.ts` has the base relations | **3-way re-apply**: take upstream `db-schema/relations.ts` as base, ADD household/householdUsers relations + visibility |
| `household-users.ts` | **IDENTICAL** to upstream `db-schema/household-users.ts` (verified byte-for-byte comparison) | No fork delta | **Clean take**: accept upstream `db-schema/household-users.ts` unchanged |
| `recipe-shares.ts` | Identical struct; fork only changed `tokenHash` to 32-byte (was 24-byte) in application code, not schema | No schema change | **Clean take**: accept upstream `db-schema/recipe-shares.ts`; fork's longer token is in the repo layer |
| `recipe-ratings.ts` | **IDENTICAL** to upstream `db-schema/recipe-ratings.ts` | None | **Clean take**: accept upstream unchanged |
| `site-auth-tokens.ts` | **IDENTICAL** to upstream `db-schema/site-auth-tokens.ts` | None | **Clean take**: accept upstream unchanged |

**Mutual-FK re-verification required:** After re-porting `auth.ts` (`activeHouseholdId` → `households.id`) into `db-schema`, confirm `references((): AnyPgColumn => households.id, ...)` pattern is used (prevents the circular-reference type collapse that causes tsc to infer `any`). [ASSUMED pattern matches prior phases 02-01/02-03]

---

## 3. Migration Reconciliation (D-06)

[VERIFIED: `git show upstream/main:packages/db/src/migrations/meta/_journal.json`, `cat /opt/norish-src/packages/db/src/migrations/meta/_journal.json`]

| Side | Journal entries | Index range | Last migration |
|------|----------------|-------------|----------------|
| Upstream 0.19.0 | **35** | 0000–0034 | `0034_loosen_step_order_constraint` |
| Our fork | **39** | 0000–0038 | `0038_lean_sauron` (recipe visibility) |

**D-06 CONFIRMED.** No numbering collision. Migrations 0035–0038 are fork-only and carry forward unchanged. The `@norish/db-schema` split is **code-only** — confirmed by inspecting upstream's migration list (tops at 0034, no new SQL file introduced for the split). The live DB is at migration 39 (Drizzle's internal count: 39 applied, which corresponds to index 38 = the last fork migration applied at deploy-time). **The merge introduces zero new SQL migrations.** `_journal.json` will extend linearly from our fork's 39-entry version.

---

## 4. Hard-Constraint Collision Points (D-09)

[VERIFIED: `git show upstream/main:packages/api/src/playwright.ts`, `git show upstream/main:packages/api/src/parser/fetch.ts`, `git ls-tree HEAD packages/api/src/playwright.ts`]

### 4a. Camoufox (scraping) — HIGHEST RISK

| Constraint | Upstream 0.19.0 State | Fork State | Resolution |
|------------|----------------------|-----------|------------|
| `playwright.ts` must not exist | **RE-INTRODUCED** — upstream modified it (it exists in `upstream/main`; `git ls-tree upstream/main packages/api/src/playwright.ts` confirms) | **DELETED** in our HEAD | **CONFLICT: modify/delete.** Resolution = our deletion WINS. The merged tree leaves upstream's `playwright.ts`; the resolve step must `git rm packages/api/src/playwright.ts`. |
| `fetch.ts` must import from `camofox.ts` | **BROKEN** — upstream `fetch.ts` imports `import { getBrowser } from "@norish/api/playwright"` and uses `const browser = await getBrowser()` | **FIXED** — our `fetch.ts` imports from `camofox.ts` | **CONFLICT: content.** Our version WINS. After resolve, grep `packages/api/src/parser/fetch.ts` for `playwright` must return zero results. |
| `playwright-core` must not be in `packages/api/package.json` | Present in upstream: `"playwright-core": "npm:rebrowser-playwright-core@^1.52.0"` | Absent in our fork | **AUTO-MERGED CLEANLY.** Verified: `git cat-file -p 27533f5d:packages/api/package.json` → no `playwright-core` entry. Our deletion prevailed. |
| `chrome-headless` must not be in compose | Still in upstream example compose: `CHROME_WS_ENDPOINT: ws://chrome-headless:3000` | Not in our compose | Fork's `docker-compose.fork.yml` has no `chrome-headless` service. Keep it absent. |

**Proof command post-merge:**
```bash
# Must return zero results for playwright/chrome in api source
grep -r "playwright\|chrome-headless\|CHROME_WS_ENDPOINT" \
  packages/api/src/ packages/api/package.json docker/ \
  --include="*.ts" --include="*.json" --include="*.yml"
# Must show camofox.ts
ls packages/api/src/camofox.ts
# Must NOT show playwright.ts
ls packages/api/src/playwright.ts 2>/dev/null && echo "FAIL" || echo "PASS"
```

### 4b. Per-Cookbook Isolation (HOUSE-06)

Isolation test suites (confirmed present in fork):
- `packages/db/__tests__/server/db/repositories/households.isolation.test.ts` — 6 tests
- `packages/trpc/__tests__/recipes/permissions-integration.test.ts` — multi-cookbook block
- `packages/trpc/__tests__/ratings/raters.test.ts` — assertRecipeAccess(view) gate

These tests are NOT in the conflict list (they auto-merge or remain unchanged). After all conflict resolution:

**Proof commands:**
```bash
sg docker -c 'pnpm --filter @norish/db test --reporter verbose -- --testPathPattern="households.isolation"'
sg docker -c 'pnpm --filter @norish/trpc test --reporter verbose -- --testPathPattern="permissions-integration|raters"'
```

**Adversarial verification required (D-09):** After isolation suites pass, weaken the `assertRecipeAccess`/`buildViewPolicyCondition` boundary → confirm suites go RED → revert byte-identical (never commit the weakening).

### 4c. Config-as-Code Env Sync (seed-config.ts)

**AUTO-MERGES CLEANLY.** [VERIFIED: `git cat-file -p 27533f5d:packages/api/src/startup/seed-config.ts`]

The auto-merged `seed-config.ts` contains: `syncWorkOSProvider` (line 493), `syncAIConfigFromEnv` (607), `syncVideoConfigFromEnv` (651), `syncBooleanToggleFromEnv` (694), `syncAuthTogglesFromEnv` (727). Import path correctly updated to `@norish/shared-server/config/server-config-loader` by the 3-way merge.

**Proof command:**
```bash
grep -n "syncWorkOSProvider\|syncAIConfigFromEnv\|syncVideoConfigFromEnv\|syncAuthTogglesFromEnv" \
  packages/api/src/startup/seed-config.ts
# Must show all 4 function definitions
```

### 4d. WorkOS + Multi-Household + Per-Cookbook Permissions

`packages/auth/src/auth.ts`, `permissions.ts`, `claim-processor.ts` — **all three auto-merge cleanly**. WorkOS `buildWorkOSProviders()` function, `addUserToHousehold`/`setActiveHousehold` hooks in `auth.ts`, and the per-cookbook `canAccessResource`/`resolveRecipeCookbookPolicy` in `permissions.ts` all survive.

**Import path note:** The auto-merged `claim-processor.ts` now imports from `@norish/shared-server/realtime/households` (new upstream path). Our 4 fork-only files using `@norish/config/server-config-loader` need manual import fixup:
- `packages/auth/__tests__/auth/workos-provider.test.ts`
- `packages/trpc/__tests__/ratings/raters.test.ts`
- `packages/api/__tests__/server/ai/transcriber-assemblyai.test.ts`
- `packages/config/__tests__/config/server-config-loader.test.ts` ← this test must be **moved or deleted** (the module it tests no longer lives in `@norish/config`)

**Proof commands:**
```bash
grep -n "buildWorkOSProviders\|addUserToHousehold\|setActiveHousehold" packages/auth/src/auth.ts
grep -n "canAccessResource\|resolveRecipeCookbookPolicy\|buildViewPolicyCondition" packages/auth/src/permissions.ts
pnpm --filter @norish/auth test --reporter verbose
```

---

## 5. Site-Auth-Tokens Status (CONTEXT.md Open Question)

[VERIFIED: `git show upstream/main:packages/db-schema/src/schema/site-auth-tokens.ts` vs `cat /opt/norish-src/packages/db/src/schema/site-auth-tokens.ts`, `git ls-tree -r upstream/main packages/ | grep "site-auth"`, `find /opt/norish-src/packages -name "*.ts" | xargs grep -l "siteAuthToken"`]

**Finding: site-auth-tokens is FULLY incorporated in upstream 0.19.0 and the schemas are byte-identical.**

The `site-auth-tokens.ts` schema definition is identical on both sides (same columns: `userId`, `domain`, `name`, `valueEnc`, `type` enum, `createdAt`, `updatedAt`, versionColumn; same indexes). Upstream 0.19.0 also ships:
- `packages/db-schema/src/schema/site-auth-tokens.ts` (the new home for the real def)
- `packages/db/src/schema/site-auth-tokens.ts` (re-export shim — same as all other db/schema files)
- `packages/db/src/repositories/site-auth-tokens.ts` (full CRUD repo)
- `packages/trpc/src/routers/site-auth-tokens/` (full tRPC router)
- Full app-side UI in `apps/web/app/(app)/settings/user/components/site-auth-tokens-card.tsx`

**Determination:** site-auth-tokens is a **clean upstream-take** for the schema side. The `db-schema/src/schema/site-auth-tokens.ts` from upstream can be accepted as-is; it already matches our fork's current definition. No fork-only additions to re-port for this table. The feature is fully functional on both sides — no `feature/add-site-auth-tokens` branch content is missing from 0.19.0.

---

## 6. Module-Boundary Refactor Impact

[VERIFIED: `git diff 6af3670a upstream/main -- packages/queue/src/allergy-detection/producer.ts`, `git diff 6af3670a upstream/main -- packages/auth/src/auth.ts`, `git diff 6af3670a upstream/main -- packages/auth/src/claim-processor.ts`, `git cat-file -p 27533f5d:packages/api/src/startup/seed-config.ts`]

Upstream 0.19.0 moved several shared utilities to `@norish/shared-server`:

| Old path (removed) | New path | Impact on fork |
|--------------------|----------|----------------|
| `@norish/config/server-config-loader` | `@norish/shared-server/config/server-config-loader` | **DELETED** from `@norish/config`. 87 fork files used old path; auto-merge handles all upstream-touched files. 4 fork-only files need manual fixup (listed in §4d). |
| `@norish/queue/redis/client` | `@norish/shared-server/redis/client` | Upstream-touched files auto-merge. Fork's `auth.ts` and `claim-processor.ts` auto-merge with the new path. |
| `@norish/queue/redis/subscription-multiplexer` | `@norish/shared-server/redis/subscription-multiplexer` | Auto-merges in trpc/middleware; fork-only queue workers auto-merge. |
| `@norish/db/cached-household` | `@norish/shared-server/cache/household` | Causes a conflict in `shared-server/src/cache/household.ts` (new upstream file vs old fork location). Resolution: accept the moved file. |
| `@norish/trpc/helpers` (emitByPolicy, PolicyEmitContext) | `@norish/shared-server/realtime/policy` | `@norish/trpc/helpers` still EXISTS in upstream but now re-exports from shared-server; backward compat. Fork's queue workers using `@norish/trpc/helpers` continue to work. |
| `@norish/auth/crypto` | `@norish/config/crypto` | `@norish/auth/crypto` still EXISTS as a re-export barrel (`export * from "@norish/config/crypto"`). Fork's 9 files using `@norish/auth/crypto` continue to work — NO import migration needed. |

---

## 7. `norish-beta` Deployment Surface (D-11/D-12)

[VERIFIED: `cat /opt/norish/docker-compose.fork.yml`, `sg docker -c 'docker ps'`, `ls /home/claude/norish-backups/`, `sg docker -c 'docker inspect norishp2-app-1'`]

### Existing live stack (must remain untouched)

| Component | Details |
|-----------|---------|
| Container | `norish-app`, image `norish:live` (`8f6d14ba902e`), port `3000:3000` |
| DB | `norish-db` (postgres:17-alpine), volume `norish_db_data`, port 5432 (internal only) |
| Redis | `norish-redis` (redis:8.6.2), port 6379 (internal only) |
| Compose file | `/opt/norish/docker-compose.fork.yml` |
| Rollback tag | `norish:rollback-20260625-pre` (old image `bae95ed366c2`) |

### Existing verify-stack (reference, NOT the beta env)

`norishp2-app-1` (image `norish:local`, port `3010:3000`) was the pre-deploy verify stack. It runs at `http://192.168.2.47:3010` (LAN only, no HTTPS, no public DNS). This is NOT suitable as `norish-beta.knoppsmart.com` (which requires HTTPS + public Cloudflare routing). The `/tmp/norishp2/` compose file is gone (ephemeral path).

### Existing pg_dump backup

`/home/claude/norish-backups/norish-live-20260625-162541.dump` — 1.6M, 222 TOC objects, live DB at migration 39. Use as the initial beta DB clone per D-12. [VERIFIED: `ls -la /home/claude/norish-backups/norish-live-20260625-162541.dump`]

### New `norish-beta` compose service requirements

The beta env is a NEW isolated stack alongside (not replacing) the live stack. Required elements:

| Element | Requirement |
|---------|-------------|
| App service | New container, image `norish:beta` (built from `integ/upstream-0.19.0`), port `3001:3000` (3000 and 3010 taken) |
| DB service | New `norish-beta-db` container (postgres:17-alpine), separate volume `norish_beta_db_data`, NO shared volumes with live |
| Redis service | New `norish-beta-redis` container, separate volume |
| Network | New docker network `norish-beta` to isolate from live's network |
| Camofox | Reuse existing camofox at `http://192.168.2.26:9377` (already shared; stateless, safe) |
| AUTH_URL | `https://norish-beta.knoppsmart.com` |
| TRUSTED_ORIGINS | `https://norish-beta.knoppsmart.com` |
| MASTER_KEY | NEW key (separate encrypted key store; do not reuse live's key — encrypted secrets are incompatible) |
| WorkOS callback | `https://norish-beta.knoppsmart.com/api/auth/oauth2/callback/workos` — must be registered in WorkOS dashboard |
| Compose file path | `/opt/norish/docker-compose.beta.yml` (keeps it alongside `fork.yml`) |

**DB clone / refresh script:** `pg_restore --clean --if-exists -d $BETA_DATABASE_URL /home/claude/norish-backups/<latest>.dump` — or fresh `pg_dump` of live at provisioning time. Document that beta DB should be re-cloned from live before each validation session.

### Cloudflare ingress wiring

`cloudflared` binary is present at `/usr/local/bin/cloudflared` (version 2026.6.0). The tunnel is NOT running as a local process or service — it is managed via Cloudflare's Zero Trust dashboard (DNS routing for `norish.knoppsmart.com` is already configured). [VERIFIED: `ps aux | grep cloudflared` returns empty, `find / -name "config.yml" | xargs grep -l "knoppsmart"` returns only compose files.]

Adding `norish-beta.knoppsmart.com` requires:
1. Add a new CNAME or Cloudflare Tunnel ingress rule in the Cloudflare Zero Trust dashboard pointing `norish-beta.knoppsmart.com` → `localhost:3001` (or the container's host:port).
2. This is a human/director step — cannot be scripted from LXC 110 without the Cloudflare API token.
3. Alternatively, use `cloudflared tunnel run` with an ingress config file — but that requires the tunnel credentials which are in the Cloudflare dashboard.

**[ASSUMED]** The Cloudflare tunnel is configured via the Zero Trust dashboard pointing at `localhost:3000`. Adding a beta route at port `3001` requires a dashboard action by the operator.

---

## 8. Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| `git` | All merge ops | ✓ | system git | — |
| `pnpm` | Build/install | ✓ | `10.x` (per `.npmrc` + monorepo) | — |
| `node` | Build | ✓ | 22.21.1 (from norishp2 container) | — |
| `sg docker` | Testcontainer suites | ✓ | docker group access via `sg docker` | — |
| `postgres:17-alpine` | Beta DB | ✓ | (existing container) | — |
| `/home/claude/norish-backups/norish-live-20260625-162541.dump` | Beta DB seed | ✓ | 1.6M, migration 39 | Fresh `pg_dump` from live at provisioning time |
| Camofox at `http://192.168.2.26:9377` | Beta scraping | ✓ (assumed reachable) | 1.4.1 (vendored) | — |
| Cloudflare dashboard access | `norish-beta.knoppsmart.com` DNS | Manual (operator) | — | LAN-only beta at `http://192.168.2.47:3001` |
| WorkOS dashboard | Register new callback URI | Manual (operator) | — | WorkOS login disabled for initial beta testing |
| `HEROUI_AUTH_TOKEN` | CI only | Not needed for `pnpm docker:build` on LXC 110 | — | `@heroui-pro/react` is on public npm registry |

**Missing dependencies with no fallback:** None that block the merge work. The Cloudflare dashboard + WorkOS registration are operator steps that can be done independently of code work.

---

## 9. Validated Environment Gotchas (from CLAUDE.md + prior phases)

These MUST be threaded into every plan task:

### Gotcha 1: Hardlink Farm Re-sync After Merge

After `git merge` (or any `git checkout`/`git restore`), any file that `git` replaces on disk severs the hardlink between `packages/<pkg>/src/<file>` and `node_modules/@norish/<pkg>/src/<file>`. The NEW `@norish/db-schema` package will need workspace materialization (it doesn't exist yet, so there's no stale hardlink — but after `pnpm install` creates it, future git ops may break links).

**Required after each conflict resolution step that touches source files:**
```bash
cp -a packages/db/src/. node_modules/@norish/db/src/
cp -a packages/auth/src/. node_modules/@norish/auth/src/
cp -a packages/trpc/src/. node_modules/@norish/trpc/src/
# For the new package, after pnpm install materializes it:
cp -a packages/db-schema/src/. node_modules/@norish/db-schema/src/
```

### Gotcha 2: `AnyPgColumn` Mutual FK Pattern

When re-porting `activeHouseholdId` on `users` (FK → `households.id`) and `adminUserId` on `households` (FK → `users.id`), both tables reference each other. Required pattern:

```typescript
import { type AnyPgColumn } from "drizzle-orm/pg-core";
// in users table:
activeHouseholdId: uuid("active_household_id").references(
  (): AnyPgColumn => households.id, { onDelete: "set null" }
)
```

Without `(): AnyPgColumn =>` the circular reference causes TypeScript to collapse both table types to `any`. [VERIFIED: established in Phase 02-01]

### Gotcha 3: Swap Headroom for `pnpm docker:build`

The Next.js build is heavy. The 2026-06-25 deploy succeeded with ~6.6Gi headroom on LXC 110, but was tight. `pct set 110 -swap <MB>` is available from the Proxmox host if needed. Build is DIRECTOR-owned — run as:
```bash
nohup pnpm docker:build > /tmp/beta-build.log 2>&1 &
echo $! > /tmp/beta-build.pid
# Poll: tail -f /tmp/beta-build.log, check /tmp/beta-build.pid
```
Never use Monitor/sleep wait-loop in a subagent.

### Gotcha 4: `@norish/db-schema` Workspace Injection

After `git merge` delivers `packages/db-schema/` and `pnpm install` runs:
- `node_modules/@norish/db-schema/src/**` will be hardlinked to `packages/db-schema/src/**`
- All downstream packages (`@norish/db`, `@norish/api`, etc.) import from `@norish/db/schema` which re-exports from `@norish/db-schema/schema` — so existing downstream import sites need no changes
- The new package's `tsconfig.json` uses `@norish/tsconfig/compiled-package.json` — verify this exists in `packages/tsconfig/`

### Gotcha 5: Build Discipline (director/executor model)

Per CLAUDE.md: `pnpm docker:build` is the **director's job, never a subagent's**. All plans that have an executor resolve conflicts + run `typecheck`/`lint`/`test`; the `pnpm docker:build` step is always a final director-owned gate.

---

## 10. Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Predicting merge conflicts | Manual file-by-file comparison | `git merge-tree --write-tree HEAD upstream/main` | Already runs without mutating working tree |
| pnpm lockfile re-generation | Manual lockfile editing | `pnpm install` after resolving all package.json conflicts | Lockfile is always auto-generated |
| DB clone/restore | Custom pg_dump parser | `pg_restore --clean --if-exists` | Standard tool; handles all migration-state objects |
| TypeScript circular FK types | Any workaround other than `AnyPgColumn` | `import { type AnyPgColumn }` + lazy reference fn | This is the established drizzle pattern for mutual FKs |

---

## 11. Common Pitfalls

### Pitfall 1: Accepting Upstream's `playwright.ts` in the Merge

**What goes wrong:** `git merge` (modify/delete conflict) leaves `packages/api/src/playwright.ts` in the tree because upstream modified it. If the executor accepts this without running the proof command, the Camoufox constraint is silently violated — the build still passes because playwright-core is absent from `package.json` but the file exists and would cause a runtime import error.

**How to avoid:** Immediately after `git merge upstream/main`, in the first task of Plan 20-01 (before any other work): `git rm packages/api/src/playwright.ts` and commit. Then verify `grep -r "playwright" packages/api/src/` returns zero results.

### Pitfall 2: Forgetting to Create `packages/db-schema/` Before Resolving Schema Conflicts

**What goes wrong:** Resolving `packages/db/src/schema/households.ts` to upstream's shim before `packages/db-schema/src/schema/households.ts` exists causes all consumers to fail at typecheck with "module @norish/db-schema not found."

**How to avoid:** The db-schema plan (Plan 20-01) must: (1) run `pnpm install` first to materialize the new package from the lockfile, OR (2) create the `packages/db-schema/` directory structure manually before accepting any schema shims.

### Pitfall 3: `pnpm install` Without Resolving `pnpm-lock.yaml` First

**What goes wrong:** `pnpm install` regenerates the lockfile. If run before all package.json conflicts are resolved, it may install versions inconsistent with the catalog.

**How to avoid:** Resolve all package.json conflicts (including `pnpm-workspace.yaml` catalog) before running `pnpm install`. The `pnpm-lock.yaml` conflict is always resolved by `pnpm install` — do not attempt to manually merge it.

### Pitfall 4: Not Migrating the 4 Fork-Only Files' `server-config-loader` Imports

**What goes wrong:** `packages/config/__tests__/config/server-config-loader.test.ts` imports `@norish/config/server-config-loader` which no longer exists → typecheck failure. The other 3 fork-only test files have the same issue.

**How to avoid:** Include import migration of these 4 files in the appropriate plan. `packages/config/__tests__/config/server-config-loader.test.ts` should be deleted or moved to `packages/shared-server/`; the other 3 need `@norish/config/server-config-loader` → `@norish/shared-server/config/server-config-loader`.

### Pitfall 5: Using a Stale Beta DB

**What goes wrong:** The beta DB diverges from live (new migrations applied live, different server_config settings), causing the 0.19.0 beta to validate against data that doesn't reflect the production state.

**How to avoid:** Per D-12, re-clone the beta DB from a fresh `pg_dump` before each validation session. Include the refresh script in the beta provisioning plan, and document the refresh expectation explicitly.

### Pitfall 6: HeroUI v2 → v3 API Breakage in Conflict-Resolved UI Files

**What goes wrong:** Our fork's UI components in the 15 conflicting web files use HeroUI v2 APIs (`Autocomplete`, `AutocompleteItem`, `SelectItem`). After the merge, the catalog upgrades to `@heroui/react: ^3.0.4`. Our resolved UI files may have v2 component names that no longer exist in v3.

**How to avoid:** In the web UI plan, explicitly audit each conflicting component for v2→v3 API breaks and apply upstream's v3 patterns. Run `pnpm --filter @norish/web typecheck` after each file resolution.

---

## Validation Architecture

Nyquist validation is **enabled** (config.json `workflow.nyquist_validation: true`).

### Test Framework

| Property | Value |
|----------|-------|
| Framework | Vitest 4 (per CLAUDE.md `vitest: 4`) |
| Config | `vitest.config.ts` per package |
| Quick run (single package) | `pnpm --filter @norish/<pkg> test` |
| Full suite command | `pnpm test` (all packages) |
| DB/queue suites | `sg docker -c 'pnpm --filter @norish/db test'` (requires testcontainer Docker access) |
| Security-critical isolation | `sg docker -c 'pnpm --filter @norish/db test -- --testPathPattern="households.isolation"'` |

### Per-Plan Gate Commands

| Plan | Gate Command | Criteria |
|------|-------------|----------|
| 20-01 (db-schema split) | `sg docker -c 'pnpm --filter @norish/db test'` + `pnpm --filter @norish/db typecheck` | All 99 db tests pass; typecheck clean; households.isolation 6/6 |
| 20-02 (api/parser) | `pnpm --filter @norish/api test` + `pnpm --filter @norish/api typecheck` | Camoufox proof command zero results; api tests pass |
| 20-03 (auth/permissions/trpc) | `pnpm --filter @norish/auth test` + `sg docker -c 'pnpm --filter @norish/trpc test'` | auth 129+; trpc 256+; isolation 6/6; adversarial verification |
| 20-04 (web UI) | `pnpm --filter @norish/web typecheck` + `pnpm --filter @norish/web test` | web typecheck clean; web tests 383+ |
| 20-05 (ci/tooling/pnpm-lock) | `pnpm typecheck` (all) + `pnpm lint` (all) | Full monorepo clean |
| 20-06 (beta provisioning) | `curl -s https://norish-beta.knoppsmart.com/api/v1/health` | `{"status":"ok","db":"ok"}` |
| Phase gate | Director-owned `pnpm docker:build` → beta image | Build exits 0; container healthy |

### Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| UPSTREAM-019 / D-09a | playwright.ts absent; fetch.ts uses camofox | Lint/grep proof | `grep -r playwright packages/api/src/` → zero | After merge resolution |
| UPSTREAM-019 / D-09b | Per-cookbook isolation stays green | Integration DB | `sg docker -c 'pnpm --filter @norish/db test -- --testPathPattern households.isolation'` | ✅ exists |
| UPSTREAM-019 / D-09b | Adversarial verification | Manual + automated | Weaken boundary → red → revert | Per plan |
| UPSTREAM-019 / D-09c | seed-config sync functions present | Unit / grep | `grep -n "syncWorkOSProvider\|syncAIConfigFromEnv" packages/api/src/startup/seed-config.ts` | ✅ after auto-merge |
| UPSTREAM-019 / D-09d | WorkOS + multi-household in auth.ts | Unit | `pnpm --filter @norish/auth test` | ✅ exists |
| UPSTREAM-019 / D-06 | Migrations 0035–0038 intact, no new SQL | DB boot check | Container health check + migration log shows `Migrations complete` | ✅ invariant |
| UPSTREAM-019 / D-11 | Beta env reachable and healthy | Smoke | `curl https://norish-beta.knoppsmart.com/api/v1/health` | After provisioning |

---

## Security Domain

**security_enforcement:** enabled (config.json confirms `security_enforcement: true`, `security_asvs_level: 2`).

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | Yes | better-auth 1.6.9 + WorkOS; unchanged by merge |
| V3 Session Management | Yes | better-auth sessions; unchanged |
| V4 Access Control | Yes — **SECURITY CRITICAL** | `canAccessResource`/`assertRecipeAccess` per-cookbook; HOUSE-06 isolation suites; adversarial verification required post-merge |
| V5 Input Validation | Yes | Zod 4 schema gates on all tRPC procedures; unchanged |
| V6 Cryptography | Yes | `encrypt`/`decrypt` from `@norish/config/crypto` (or `@norish/auth/crypto` re-export); unchanged |

### Known Threat Patterns for This Merge

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Cross-cookbook recipe leak via upstream refactor | Information Disclosure | `assertRecipeAccess(view)` gate + `buildViewPolicyCondition`; households.isolation test suite adversarially verified |
| Chrome/playwright reintroduction | Tampering (supply chain) | Proof command: `grep -r playwright packages/api/src/` → zero results; `ls packages/api/src/playwright.ts` → absent |
| Beta DB sharing live data | Information Disclosure | Separate compose network + separate Postgres volume + separate MASTER_KEY (different encryption key) |
| WorkOS callback hijack via new domain | Spoofing | Register `norish-beta.knoppsmart.com/api/auth/oauth2/callback/workos` in WorkOS dashboard before activating WorkOS on beta |

---

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | Cloudflare tunnel for `norish.knoppsmart.com` is managed via Zero Trust dashboard pointing to `localhost:3000`; adding beta requires a dashboard action | §7 | If tunnel is managed locally (e.g. a config file not found by our search), a different provisioning approach may be available. Low risk — worst case is manual Cloudflare dashboard step remains required. |
| A2 | Camofox at `http://192.168.2.26:9377` is reachable from the beta container (LXC 110 to LAN IP) | §7 | If network topology changes, beta scraping fails. Mitigation: verify connectivity with `curl http://192.168.2.26:9377/health` from LXC 110 before deploying beta. |
| A3 | The `@heroui/react` v2→v3 upgrade does not break any auto-merged (non-conflicting) web components in our fork | §1 (web UI) | If v3 has additional breaking changes beyond the component API changes already visible in the 15 conflict files, more web files may fail typecheck. Mitigation: run `pnpm --filter @norish/web typecheck` immediately after merge and before conflict resolution to surface all broken files. |
| A4 | `packages/config/__tests__/config/server-config-loader.test.ts` should be deleted (the tested module moved) | §4d | If the test is testing something still applicable in shared-server, it should be moved rather than deleted. Planner should inspect the test content before deciding. |

**If this table is empty:** All other claims were verified by running `git merge-tree`, `git show`, `git cat-file`, `git diff`, `ls`, `cat`, and `sg docker` commands against the live repo during research.

---

## Sources

### Primary (HIGH confidence — verified by running commands against live repo)

- `git merge-tree --write-tree HEAD upstream/main` — full conflict list (49 conflicts, 112 auto-merges) [VERIFIED: 2026-06-26]
- `git show 1f684480 --stat` — confirmed 996 files changed, +28,983/−17,969 [VERIFIED]
- `git show upstream/main:packages/db-schema/package.json` — db-schema package structure [VERIFIED]
- `git show upstream/main:packages/db/src/schema/households.ts` — confirmed shim pattern [VERIFIED]
- `git show upstream/main:packages/db-schema/src/schema/households.ts` — upstream base def [VERIFIED]
- `git show upstream/main:packages/db/src/migrations/meta/_journal.json` — 35 entries, tops at 0034 [VERIFIED]
- `cat /opt/norish-src/packages/db/src/migrations/meta/_journal.json` — 39 entries, tops at 0038 [VERIFIED]
- `git cat-file -p 27533f5d:packages/api/src/startup/seed-config.ts` — auto-merge preserves WorkOS/AI/video sync [VERIFIED]
- `git cat-file -p 27533f5d:packages/api/package.json` — no playwright-core in auto-merged result [VERIFIED]
- `sg docker -c 'docker ps'` — live service inventory [VERIFIED]
- `ls -la /home/claude/norish-backups/norish-live-20260625-162541.dump` — backup exists [VERIFIED]
- `sg docker -c 'docker inspect norishp2-app-1'` — norishp2 LAN-only, not suitable for beta [VERIFIED]

### Secondary (HIGH confidence — official docs / established patterns)

- CLAUDE.md `/opt/norish-src/CLAUDE.md` — fork hard constraints, environment requirements [VERIFIED: read]
- `.planning/phases/20-incorporate-upstream-v0-19-0-beta/20-CONTEXT.md` — locked decisions D-01..D-12 [VERIFIED: read]
- Prior phase summaries (STATE.md) — test count baselines (auth 129, trpc 256, db 99, web 383) [CITED: .planning/STATE.md]

---

## Metadata

**Confidence breakdown:**
- Conflict surface: HIGH — `git merge-tree` is authoritative; every conflict file individually verified
- Migration reconciliation: HIGH — both `_journal.json` files read and compared directly
- Hard-constraint collision: HIGH — `git show` on upstream files confirmed playwright.ts reintroduced; auto-merge verified via `git cat-file`
- site-auth-tokens determination: HIGH — both schemas read and compared; upstream feature breadth confirmed
- Beta provisioning: MEDIUM — live stack inventoried; Cloudflare tunnel mechanism inferred (no config file found locally; dashboard management assumed)
- HeroUI v2→v3 breakage scope: MEDIUM — breakage visible in conflict files; non-conflict auto-merged files not individually inspected

**Research date:** 2026-06-26
**Valid until:** 2026-07-26 (stable upstream; no new 0.19.0 commits expected imminently)

---

## RESEARCH COMPLETE
