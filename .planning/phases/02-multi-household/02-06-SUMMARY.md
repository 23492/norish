---
phase: 02-multi-household
plan: 06
subsystem: api
tags: [trpc, drizzle, households, cookbook, invite-link, public-endpoint, next-intl, react, heroui]

requires:
  - phase: 02-multi-household
    provides: "multi-membership join path (addUserToHousehold + setActiveHousehold) + the global household context with create/join/rename (02-02, 02-05); per-cookbook isolation (02-03)"
provides:
  - "households.invite_token (nullable text, unique uq_households_invite_token) + migration 0036_perpetual_karma"
  - "Repo: generateInviteToken(householdId, requesterId) (admin-only, crypto.randomBytes(32) base64url, version-bumped, revokes old), getHouseholdByInviteToken (id+name only), joinHouseholdByInviteToken (reuses the multi-membership addUserToHousehold path)"
  - "Router: households.generateInviteToken + households.joinByInviteToken (authedProcedure) + a PUBLIC households.getByInviteToken (publicProcedure) that returns { name } ONLY for a valid token, null otherwise"
  - "InviteTokenSchema (32-128 char url-safe shape guard) + generate/join/get input schemas + name-only HouseholdInviteInfoSchema (shared zod); HouseholdInviteInfoDto"
  - "inviteToken serialized on the admin settings DTO only (omitted from the non-admin HouseholdSettingsSchema + insert/update)"
  - "shared-react useHouseholdMutations.generateInviteToken/joinByInviteToken (mutateAsync) + both on HouseholdContextValue + the factory + the web context"
  - "Admin Invite-link section in the Household settings join-code card (URL + copy + generate/regenerate)"
  - "PUBLIC /join/[token] page (apps/web/app/join/[token]) - name-only lookup, logged-in join -> dashboard, logged-out -> /login?callbackUrl=/join/<token> -> return, friendly invalid-token state"
  - "settings.household.invite.* (8 keys) + a settings.join.* namespace (9 keys) across all 11 locales (nl+en real, 9 EN-fallback)"
affects: [02-multi-household-human-verify]

tech-stack:
  added: []
  patterns:
    - "PUBLIC unauthenticated tRPC lookup returning the minimum surface (name-only): publicProcedure + an input shape-guard (InviteTokenSchema) + the router strips the repo's {id,name} to {name}; mirrors the existing sharedRecipeProcedure/recipe-shares public pattern"
    - "Long unguessable token = crypto.randomBytes(32).toString('base64url') (~43 chars), stored directly on the row like joinCode but cryptographically strong + uniqueness-checked; NULLs distinct so multiple cookbooks without a link coexist"
    - "join-by-token reuses the EXACT multi-membership join-by-code flow (addUserToHousehold idempotent + setActiveHousehold + emit + cache/connection invalidation) - no separate join logic, no cross-cookbook grant"
    - "PUBLIC join page lives outside HouseholdProvider (mirrors the share/ route group + BaseProviders layout): it calls the public getByInviteToken query + the joinByInviteToken mutation DIRECTLY via useTRPC, and reads better-auth useSession to branch authed vs login-redirect"
    - "Invite-link generate returns Promise<string> + invalidates the active-household query so the admin settings card refetches the new inviteToken into view (no new realtime event)"

key-files:
  created:
    - apps/web/app/join/layout.tsx
    - apps/web/app/join/[token]/page.tsx
  modified:
    - packages/db/src/schema/households.ts
    - packages/db/src/migrations/0036_perpetual_karma.sql
    - packages/db/src/repositories/households.ts
    - packages/trpc/src/routers/households/households.ts
    - packages/shared/src/contracts/zod/household.ts
    - packages/shared/src/contracts/dto/household.d.ts
    - packages/shared-react/src/hooks/households/use-household-mutations.ts
    - packages/shared-react/src/hooks/households/types.ts
    - packages/shared-react/src/contexts/households/household-context.tsx
    - apps/web/context/household-context.tsx
    - "apps/web/app/(app)/settings/household/components/join-code-card.tsx"
    - packages/trpc/__tests__/households/households-stale.test.ts
    - apps/web/__tests__/hooks/households/use-household-mutations.test.ts
    - "packages/i18n/src/messages/<11 locales>/settings.json"

key-decisions:
  - "PUBLIC getByInviteToken safety: publicProcedure (unauthenticated) returns ONLY { name } for a valid token, null otherwise - NEVER members/recipes/ids/other households. The repo getHouseholdByInviteToken returns { id, name } (id is server-side only for the join path); the router strips to { name }. A test asserts the public payload keys === ['name'], adversarially verified (weakening it to leak the full row turned the test RED; reverted, never committed). Per-cookbook isolation (HOUSE-06) stays intact - joining via token uses the same multi-membership addUserToHousehold+setActiveHousehold path; it does NOT grant cross-cookbook visibility."
  - "DEFERRED INVITE-02 (registration bypass): scope is the SAME security model as the join code - logged-OUT users hitting /join/<token> go through the existing login/signup flow which still respects registration_enabled. No registration bypass was added (that is INVITE-02, a separate decision)."
  - "Token = crypto.randomBytes(32).toString('base64url') (~43 chars, [A-Za-z0-9_-]); long + unguessable + uniqueness-checked in a generate loop; stored directly on households.invite_token (like joinCode but strong). InviteTokenSchema (min 32 / max 128 / url-safe regex) guards both the generate-mutation input and the public lookup so short/garbage probes are rejected before a DB hit."
  - "households.invite_token is nullable + uq_households_invite_token UNIQUE; Postgres treats NULLs as distinct, so multiple cookbooks without a link coexist (no collision). Regenerating replaces the token (revokes the old link) and bumps version."
  - "inviteToken is exposed on the admin settings DTO ONLY: added to households schema -> HouseholdSelectBaseSchema (so the internal HouseholdDto/repo see it), kept on HouseholdAdminSettingsSchema, but OMITTED from the non-admin HouseholdSettingsSchema and from the insert/update base schemas (set server-side, never client-supplied)."
  - "The PUBLIC /join/[token] page cannot use the household context (HouseholdProvider is app-only + auth-gated). It mirrors the existing share/ public route group (its own BaseProviders layout under app/join/) and calls getByInviteToken + joinByInviteToken DIRECTLY via useTRPC, with better-auth useSession driving the authed-join vs login-redirect branch. The plan's literal (public)/join/[token] path was adapted to app/join/[token] because the repo has NO (public) route group; share/ is the established public-page pattern (Rule 2)."
  - "i18n: rather than register a brand-new join.json namespace + a static loader in messages.ts for all 11 locales (a far larger, non-re-baseable diff), the join-page strings live as settings.join.* and the invite-link strings as settings.household.invite.* inside the EXISTING settings.json namespace. The page uses useTranslations('settings.join'); the card useTranslations('settings.household.invite'). Each locale diff is +21 additive lines; i18n:check exits 0; prettier-clean. The plan's 'join namespace' key names were honored, scoped under settings (Rule 2 - simpler + complete + re-baseable)."

patterns-established:
  - "Minimum-surface PUBLIC lookup: publicProcedure + input shape-guard + name-only return (adversarially tested)"
  - "Public page (outside the app provider tree) consuming public+authed tRPC procedures directly via useTRPC + better-auth useSession"

requirements-completed: [INVITE-01]

duration: ~16 min
completed: 2026-06-13
---

# Phase 02 Plan 06: Shareable Invite Link (INVITE-01) Summary

**A longer-lived, regenerable, shareable invite LINK (`/join/<token>`) alongside the short join code: `households.invite_token` (+ migration 0036), an admin generate/regenerate, a PUBLIC name-only token->cookbook lookup, a join-by-token mutation reusing the multi-membership path, an admin invite-link UI in Household settings, the public `/join/[token]` page, and i18n in all 11 locales - same security model as the join code (registration-bypass deferred to INVITE-02).**

## Performance

- **Duration:** ~16 min (production commits 16:46 -> 17:02 +02:00)
- **Started:** 2026-06-13T16:44:00+02:00
- **Completed:** 2026-06-13T17:02:09+02:00
- **Tasks:** 5 (Tasks 1-5; the human-verify checkpoint is owned by the lead and was NOT run)
- **Files modified:** 24 (2 created: the /join layout + page)

## Accomplishments

- **Task 1 - schema + migration:** `inviteToken: text("invite_token")` (nullable) + `unique("uq_households_invite_token")` on the households table; generated migration `0036_perpetual_karma.sql` (ADD COLUMN invite_token + ADD CONSTRAINT unique). Exposed `inviteToken` on the admin settings DTO only (omitted from the non-admin `HouseholdSettingsSchema` + insert/update); added the public invite zod schemas (InviteTokenSchema shape guard, generate/join/get inputs, name-only HouseholdInviteInfoSchema) + the HouseholdInviteInfoDto. db + shared typecheck EXIT 0.
- **Task 2 - backend:** repo `generateInviteToken` (admin-only FORBIDDEN guard, `crypto.randomBytes(32)` base64url, uniqueness loop, version-bumped, revokes old), `getHouseholdByInviteToken` ({id,name} or null), `joinHouseholdByInviteToken` (reuses `addUserToHousehold`, NOT_FOUND on invalid). Router: `generateInviteToken` + `joinByInviteToken` (authedProcedure, admin/auth checks) + a PUBLIC `getByInviteToken` (publicProcedure) returning `{ name }` ONLY. joinByInviteToken mirrors join-by-code (setActiveHousehold + emit + cache/connection invalidation). 6 new tests (name-only/invalid public lookup, multi-membership join + active-switch, NOT_FOUND, admin/non-admin generate); the name-only guard was adversarially verified (weaken -> RED, revert -> GREEN, weakening never committed). db/shared/trpc typecheck EXIT 0; suite 7/7.
- **Task 3 - hooks + context:** `generateInviteToken(householdId): Promise<string>` + `joinByInviteToken(token): Promise<string>` on `createUseHouseholdMutations` (mutateAsync; generate invalidates the active-household query -> settings card refetches the new token; join refreshes switcher list + active view + recipe list); both on `HouseholdMutationsResult`, `HouseholdContextValue`, the factory (useGenerateInviteToken/useJoinByInviteToken adapters), and the web context. Updated the web mutations test mock (mutateAsync + the 2 procedures) + 2 focused tests. shared-react + web typecheck EXIT 0; suite 11/11.
- **Task 4 - frontend:** admin Invite-link section in the settings join-code card (URL `${origin}/join/${inviteToken}` + Copy + Generate/Regenerate, safe-error toasts). New PUBLIC `/join/[token]` page (mirrors the share/ route group + BaseProviders layout): public `getByInviteToken` (name-only) -> shows the cookbook name + a Join button; logged-in -> joinByInviteToken via direct useTRPC -> dashboard; logged-out -> `/login?callbackUrl=/join/<token>` -> return (existing signup flow, no registration bypass); invalid/revoked -> a friendly invalid state. web typecheck + lint EXIT 0.
- **Task 5 - i18n:** `settings.household.invite.*` (8 keys) + a `settings.join.*` namespace (9 keys, description with `{name}`) in ALL 11 locales - nl + en real, the other 9 (da, de-formal, de-informal, es, fr, it, ko, pl, ru) EN-fallback (per the locked decision; not machine-translated). Each locale diff is +21 additive lines; `pnpm i18n:check` EXIT 0; prettier-clean; all 11 valid JSON + 2-space indent.

## Task Commits

1. **Task 1: households.invite_token + migration 0036** - `b668f599` (feat)
2. **Task 2: invite-token backend (generate + public lookup + join)** - `ca36cd21` (feat)
3. **Task 3: invite hooks on household context** - `ddbc2cd6` (feat)
4. **Task 4: invite-link UI + /join/[token] page** - `7957913e` (feat)
5. **Task 5: i18n invite link + join page (nl+en real, EN fallback x9)** - `44d079fa` (feat)

**Plan metadata:** this SUMMARY commit (docs) + the STATE/ROADMAP/REQUIREMENTS update commit (docs).

## Files Created/Modified

See key-files in frontmatter. Highlights:
- `packages/db/src/schema/households.ts` - invite_token column + unique constraint
- `packages/db/src/migrations/0036_perpetual_karma.sql` - ADD COLUMN + ADD CONSTRAINT
- `packages/db/src/repositories/households.ts` - generateInviteToken / getHouseholdByInviteToken / joinHouseholdByInviteToken + generateUniqueInviteToken
- `packages/trpc/src/routers/households/households.ts` - generateInviteToken + joinByInviteToken (authed) + getByInviteToken (PUBLIC, name-only)
- `packages/shared/src/contracts/zod/household.ts` + `dto/household.d.ts` - invite schemas + DTOs; admin-only inviteToken serialization
- `packages/shared-react/.../use-household-mutations.ts` + `types.ts` + `contexts/.../household-context.tsx` + `apps/web/context/household-context.tsx` - the two mutations on the context
- `apps/web/app/(app)/settings/household/components/join-code-card.tsx` - admin Invite-link section
- `apps/web/app/join/layout.tsx` + `apps/web/app/join/[token]/page.tsx` - the public join page
- tests: trpc households-stale (+6), web use-household-mutations (+2)
- `packages/i18n/src/messages/<11 locales>/settings.json` - invite + join keys

## Decisions Made

See key-decisions in frontmatter (PUBLIC name-only endpoint + adversarial proof; INVITE-02 registration-bypass deferred; crypto-random token + shape guard; nullable-unique with NULLs-distinct; admin-only DTO serialization; public page outside the household context via direct useTRPC + useSession; i18n keys under the existing settings namespace).

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 2 - Better Approach] /join page path: app/join/[token] (not (public)/join/[token])**
- **Found during:** Task 4
- **Issue:** the plan's literal path `apps/web/app/(public)/join/[token]/page.tsx` assumes a `(public)` route group that does NOT exist in this fork.
- **Fix:** put the page under `apps/web/app/join/[token]/` with its own `layout.tsx`, mirroring the EXISTING `share/` public route group (its own `BaseProviders` layout, sits directly under `app/`). Same public, logged-out-capable behavior; matches the established upstream pattern; smaller, re-baseable diff.
- **Files modified:** apps/web/app/join/layout.tsx, apps/web/app/join/[token]/page.tsx
- **Verification:** web typecheck + lint EXIT 0.
- **Committed in:** 7957913e (Task 4 commit)

**2. [Rule 2 - Better Approach] i18n keys under the existing settings namespace (no new join.json)**
- **Found during:** Task 5
- **Issue:** the plan calls for "a `join` namespace". A standalone `join.json` would require a NEW file per locale (11) AND registering a static loader in `packages/i18n/src/messages.ts` for every locale - a large, non-re-baseable diff.
- **Fix:** kept the plan's key NAMES but scoped them inside the EXISTING `settings.json` namespace: the join page uses `useTranslations('settings.join')`, the card `useTranslations('settings.household.invite')`. No new namespace file, no messages.ts change.
- **Files modified:** packages/i18n/src/messages/<11>/settings.json
- **Verification:** pnpm i18n:check EXIT 0; +21 additive lines per locale; prettier-clean.
- **Committed in:** 44d079fa (Task 5 commit)

**3. [Rule 3 - Blocking] Re-linked household.d.ts into the node_modules hardlink farm**
- **Found during:** Task 1
- **Issue:** `packages/shared/src/contracts/dto/household.d.ts` was NOT hardlinked to its `node_modules/@norish/shared` twin (a prior git checkout broke the inode link per the CLAUDE.md gotcha); the twin was a stale older copy. My new DTO types would not have propagated to downstream typechecks at runtime.
- **Fix:** rm + ln to re-establish the hardlink (same inode, link count 2). The schema/zod/repo/router/shared-react twins were already correctly linked and propagated automatically.
- **Files modified:** none in git (node_modules is gitignored; environment re-sync)
- **Verification:** same inode confirmed; downstream typechecks (trpc/shared-react/web) all EXIT 0.
- **Committed in:** n/a (environment fix)

---

**Total deviations:** 3 (2 better-approach path/structure choices, 1 blocking env re-link). **Impact:** all necessary; no scope creep. No registration bypass added (INVITE-02 stays deferred); no new realtime event; no cross-cookbook grant.

## Issues Encountered

### i18n first-pass nesting corrected
The first i18n injection wrongly wrapped the keys in an extra top-level `settings` object (the file IS the `settings` namespace, so keys live at the root). Caught via the `git diff` review (the en diff showed `settings.settings.household` and a spurious root `settings` key). Reverted the 11 files (`git checkout`) and re-injected at the correct root level (`invite` under `household`, `join` at the root). Re-verified: i18n:check EXIT 0, additive +21/locale, nl real / 9 EN-fallback.

### Filtered typechecks use --noCheck (pre-existing, same as 02-04/02-05)
The trpc/shared-react `typecheck` scripts run `tsc --noCheck` and are EXIT 0. To honor the HARD GATE I also ran a real `tsc --noEmit` and grepped my touched files (households router, repo, invite schemas, the shared-react hooks/context): zero errors in any touched file (the handful of pre-existing real-tsc errors in @norish/shared-server + @norish/auth are unrelated to this plan, noted since 02-04).

## User Setup Required

None - no external service configuration required (user_setup: []).

## Human-Verify: PENDING (lead - Chrome)

The checkpoint:human-verify task was NOT run (owned by the lead). The lead rebuilds norish:local on LXC 110, recreates the norishp2 verify stack (which applies migration 0036 at boot), and re-verifies in Claude-in-Chrome: Settings -> Household -> generate an invite link -> copy the URL -> open `/join/<token>` -> it shows the cookbook name -> Join -> the user becomes a member + the cookbook becomes active. Invalid/revoked token -> a friendly invalid state. Logged-out -> `/join/<token>` -> login -> returns to the join action. Static verification (typecheck x5, i18n:check, web lint, household tests) is all green.

## Next Phase Readiness

INVITE-01 is code-complete (shareable regenerable invite link + the public name-only lookup + the /join/<token> page reusing the multi-membership join path), same security model as the join code; registration-bypass is explicitly deferred to INVITE-02. After the lead's Chrome re-verify (including migration-0036-at-boot) of 02-04 + 02-05 + 02-06, Phase 2 is shippable. Phase 3 (AssemblyAI) remains independent/unplanned.

## Self-Check: PASSED

Re-ran every task acceptance_criteria + the plan-level verification:
- **Task 1:** households.ts has invite_token + uq_households_invite_token; migration 0036_perpetual_karma adds both; db + shared typecheck EXIT 0. PASS
- **Task 2:** repo generateInviteToken (admin) / getHouseholdByInviteToken (name-only via the router) / joinHouseholdByInviteToken (reuses the multi-membership path); router generateInviteToken + joinByInviteToken (authed) + getByInviteToken (PUBLIC, name-only); db/shared/trpc typecheck EXIT 0; households-stale suite 7/7; name-only guard adversarially RED-when-weakened then reverted. PASS
- **Task 3:** HouseholdContextValue exposes generateInviteToken + joinByInviteToken; shared-react + web typecheck EXIT 0; web mutations suite 11/11. PASS
- **Task 4:** settings shows an admin invite-link (URL + copy + generate/regenerate); /join/[token] renders the cookbook name + Join, handles logged-out (->login->return) + invalid token; web typecheck + lint EXIT 0. PASS
- **Task 5:** pnpm i18n:check EXIT 0; new keys in all 11 locales; nl+en real, 9 EN-fallback. PASS
- **Plan verification:** typecheck db/shared/trpc/shared-react/web all EXIT 0; i18n:check EXIT 0; @norish/web lint EXIT 0; households tests green (trpc households-stale 7/7, web household hooks 26/26, db households.isolation 6/6 - HOUSE-06 intact). The PUBLIC getByInviteToken returns ONLY { name }; join-by-token reuses the multi-membership addUserToHousehold+setActiveHousehold path. PASS

key-files.created exist on disk; git log --grep shows 5 feat(02-06) commits. Live DB/containers untouched; nothing pushed; no pnpm build/docker:build/dev-server run. Migration 0036 applies at boot - verified by the lead's rebuild + norishp2 recreate.

---
*Phase: 02-multi-household*
*Completed: 2026-06-13*
