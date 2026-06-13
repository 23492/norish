---
phase: 02-multi-household
plan: 05
subsystem: ui
tags: [react, heroui, next-intl, trpc, drizzle, households, cookbook, rename, modal, i18n]

requires:
  - phase: 02-multi-household
    provides: "households.create/join/switchActive + multi-membership (02-02); global household context with households/activeHouseholdId/switchActive + the navbar cookbook switcher (02-04); per-cookbook isolation (02-03)"
provides:
  - "households.rename tRPC mutation + renameHousehold repo fn (admin-only, optimistic-version, members cache invalidated)"
  - "RenameHouseholdInputSchema (shared zod) — { householdId, name, version }"
  - "Global HouseholdContextValue now exposes createHousehold / joinHousehold / rename (so the navbar can call them); settings context inherits create/join from the base context"
  - "shared-react useHouseholdMutations.rename (optimistic name update + switcher-list invalidation)"
  - "Reusable CreateOrJoinCookbookModal + CreateOrJoinCookbookForms (apps/web/components/shared) sourcing create/join from the global context"
  - "Navbar 'Create or join a cookbook' opens the modal (desktop + mobile via the shared NavbarUserMenu) instead of routing to settings"
  - "no-household-view.tsx refactored to reuse CreateOrJoinCookbookForms (no duplicated form logic)"
  - "Admin-only inline cookbook rename on the Household settings page (household-info-card)"
  - "settings.household.createOrJoin.title + settings.household.rename.* (5 keys) across all 11 locales (nl+en real, 9 EN-fallback)"
affects: [02-multi-household-human-verify]

tech-stack:
  added: []
  patterns:
    - "rename mutation mirrors transferHouseholdAdmin/regenerateJoinCode: admin pre-check in the router + optimistic-version (sql version+1, where includes version, stale/applied MutationOutcome) in the repo"
    - "create/join/rename promoted onto the GLOBAL household context (factory gained useCreateHousehold/useJoinHousehold/useRename adapters mirroring useSwitchActive); settings context inherits them via ...base, so create/join were removed from its explicit list"
    - "Create/Join forms extracted to one shared component (CreateOrJoinCookbookForms) sourcing mutations from useHouseholdContext(); both the navbar modal and NoHouseholdView render it"
    - "Navbar modals follow the ImportRecipeModal pattern (isOpen/onOpenChange + sibling render in NavbarUserMenu); the switcher is shared, so mobile gets the modal with no mobile-nav change"
    - "Admin inline rename = pencil -> Input (Enter saves, Esc cancels) -> rename(id, name, household.version); addToast success / showSafeErrorToast failure"

key-files:
  created:
    - apps/web/components/shared/create-or-join-cookbook-modal.tsx
  modified:
    - packages/db/src/repositories/households.ts
    - packages/trpc/src/routers/households/households.ts
    - packages/shared/src/contracts/zod/household.ts
    - packages/shared-react/src/hooks/households/use-household-mutations.ts
    - packages/shared-react/src/hooks/households/types.ts
    - packages/shared-react/src/contexts/households/household-context.tsx
    - apps/web/context/household-context.tsx
    - apps/web/components/navbar/navbar-user-menu.tsx
    - apps/web/app/(app)/settings/household/components/no-household-view.tsx
    - apps/web/app/(app)/settings/household/components/household-info-card.tsx
    - apps/web/__tests__/hooks/households/use-household-mutations.test.ts
    - "packages/i18n/src/messages/<11 locales>/settings.json"

key-decisions:
  - "No new realtime event for rename. The plan said emit the existing household-updated event IF there is one — there is none, and the household subscription side maps each event to a dedicated router subscription + connection-manager registration + client handler, so adding one would balloon the diff. Instead the router invalidates the household cache for ALL members (invalidateHouseholdCacheForUsers) and the client rename mutation optimistically sets the name + invalidates the switcher list; the renamer sees it immediately, other members on their next read. Cross-member realtime rename is not a plan must-have."
  - "create/join/rename live on the GLOBAL HouseholdContextValue (needed by the navbar). The settings context already spreads ...base, so createHousehold/joinHousehold were REMOVED from the settings context explicit fields (inherited from base) — net simpler, no duplication. leaveHousehold/kickUser/regenerateJoinCode/transferAdmin stay settings-only."
  - "Reuse, dont reinvent: the Create/Join forms were extracted verbatim from no-household-view.tsx into CreateOrJoinCookbookForms (same heroui Input + InputOtp + the existing settings.household.create.*/join.* keys); no-household-view.tsx now just renders that component."
  - "Modal closes on create/join dispatch (the mutations are fire-and-forget; onError re-invalidates) — matches how no-household-view already clears inputs immediately; the switcher updates via the backend setActiveHousehold + the list invalidation/subscription."
  - "i18n keys live in the settings.json namespace (settings.household.createOrJoin.title + settings.household.rename.*) because the modal + rename use useTranslations(settings.household); no navbar.json change (the dropdown entry keeps navbar.cookbook.manage). EN-fallback x9 per the user-locked i18n decision."
  - "rename name validation: strict zod (trim, min 1, max 100) mirroring the create flow, enforced again in the repo (FORBIDDEN if not admin; Invalid household name if empty/too long)."

patterns-established:
  - "Global-context-sourced shared form component reused by both a navbar modal and a settings page"
  - "admin-only optimistic-version rename, surfaced through the same context the switcher uses"

requirements-completed: [CKBK-UI-01, RENAME-01, HOUSE-02]

duration: ~15min
completed: 2026-06-13
---

# Phase 02 Plan 05: Multi-household UI Completion Summary

**A households.rename mutation (admin-only, optimistic-version) plus a reusable Create/Join cookbook modal opened from the navbar switcher and an admin inline-rename on the Household settings page — making create-another / join-by-code reachable anytime and HOUSE-02 true end-to-end in the UI, with new strings across all 11 locales (nl+en real, 9 EN-fallback).**

## Performance

- **Duration:** ~15 min (production commits 15:44 -> 15:59 +02:00)
- **Started:** 2026-06-13T15:44:52+02:00
- **Completed:** 2026-06-13T15:59:21+02:00
- **Tasks:** 5 (Tasks 1-5; the human-verify checkpoint is owned by the lead and was NOT run)
- **Files modified:** 22 (1 created)

## Accomplishments

- **Task 1 — backend rename:** renameHousehold(householdId, requesterId, name, version) repo fn (asserts admin via the households adminUserId, else throws FORBIDDEN; validates trimmed name min 1/max 100; optimistic version + 1 update returning stale/applied — mirroring transferHouseholdAdmin). households.rename mutation (authedProcedure, admin pre-check, fire-and-forget, invalidates the household cache for all members). RenameHouseholdInputSchema { householdId, name, version } added to shared zod.
- **Task 2 — global context + hooks:** a rename(householdId, name, version) mutation on createUseHouseholdMutations (optimistically updates the cached name + invalidates the switcher list; onError re-invalidates); HouseholdMutationsResult gained rename; HouseholdContextValue now exposes createHousehold/joinHousehold/rename (factory gained useCreateHousehold/useJoinHousehold/useRename adapters, web wired); the settings context inherits create/join from ...base (removed from its explicit list).
- **Task 3 — modal + navbar:** new create-or-join-cookbook-modal.tsx exporting CreateOrJoinCookbookForms (the exact Create name-Input + Join 6-digit InputOtp forms, now sourcing create/join from the GLOBAL useHouseholdContext()) and a CreateOrJoinCookbookModal (heroui Modal, isOpen/onOpenChange). The navbar Create or join a cookbook entry now opens the modal (was href=/settings?tab=household); rendered alongside ImportRecipeModal. no-household-view.tsx refactored to reuse CreateOrJoinCookbookForms (about 90 lines of duplicated form logic removed). Mobile gets the modal for free (shared NavbarUserMenu).
- **Task 4 — admin rename in settings:** household-info-card.tsx shows an admin-only pencil that swaps the name into an inline Input (Enter saves / Esc cancels / Save+Cancel buttons) calling rename(household.id, name, household.version); success addToast, failure showSafeErrorToast. Non-admins see the name read-only.
- **Task 5 — i18n:** settings.household.createOrJoin.title + settings.household.rename.{button,label,placeholder,success,failed} added to ALL 11 locales (reusing existing create.*/join.* for the modal body + existing common.actions.save/cancel). nl + en real; the other 9 (da, de-formal, de-informal, es, fr, it, ko, pl, ru) use the EN string (user-locked EN-fallback). pnpm i18n:check exits 0; each locale diff is exactly +10 lines.

## Task Commits

1. **Task 1: households.rename mutation (admin, optimistic)** - 538fa09d (feat)
2. **Task 2: expose create/join/rename on global household context** - 2bfc8c1c (feat)
3. **Task 3: create-or-join cookbook modal from navbar switcher** - 8933c0a8 (feat)
4. **Task 4: admin cookbook rename in settings** - edb19b27 (feat)
5. **Task 5: i18n create/join modal + rename (nl+en real, EN fallback x9)** - dd8dc294 (feat)

**Plan metadata:** this SUMMARY commit (docs) + the STATE/ROADMAP/REQUIREMENTS update commit (docs).

## Files Created/Modified

- packages/db/src/repositories/households.ts — renameHousehold (admin-only, optimistic-version)
- packages/trpc/src/routers/households/households.ts — rename mutation + router registration
- packages/shared/src/contracts/zod/household.ts — RenameHouseholdInputSchema
- packages/shared-react/src/hooks/households/use-household-mutations.ts — rename mutation
- packages/shared-react/src/hooks/households/types.ts — rename on HouseholdMutationsResult
- packages/shared-react/src/contexts/households/household-context.tsx — create/join/rename on the global value + factory; settings context inherits create/join
- apps/web/context/household-context.tsx — passes the create/join/rename adapters into the factory
- apps/web/components/shared/create-or-join-cookbook-modal.tsx — NEW: shared forms + modal
- apps/web/components/navbar/navbar-user-menu.tsx — opens the modal from the switcher
- apps/web/app/(app)/settings/household/components/no-household-view.tsx — reuses the shared forms
- apps/web/app/(app)/settings/household/components/household-info-card.tsx — admin inline rename
- apps/web/__tests__/hooks/households/use-household-mutations.test.ts — mock brought up to date + rename coverage
- packages/i18n/src/messages/<11 locales>/settings.json — createOrJoin + rename keys

## Decisions Made

See key-decisions in frontmatter (no new realtime event for rename; create/join/rename promoted to the global context with the settings context inheriting them; form reuse via a shared component; modal closes on dispatch; settings.json namespace + EN-fallback x9; strict-but-double-checked name validation).

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Re-linked package-src files into the node_modules hardlink farm**
- **Found during:** Task 2 (running the household test suites)
- **Issue:** packages/shared/src/contracts/zod/household.ts and packages/trpc/src/routers/households/households.ts were NOT hardlinked to their node_modules/@norish/* twins (a prior git checkout in an earlier plan had broken the inode link, per the CLAUDE.md gotcha). My in-place edits therefore did not propagate to the runtime copies, so vitest loaded a stale @norish/shared without RenameHouseholdInputSchema (.input(undefined) -> TypeError: Cannot use in operator to search for ~standard in undefined). A third file (use-households-list-query.ts, created by 02-04) was MISSING from node_modules entirely, breaking import resolution.
- **Fix:** Re-established the hardlinks (rm + ln) for all three: @norish/shared/.../household.ts, @norish/trpc/.../households.ts, and @norish/shared-react/.../use-households-list-query.ts. The db + the other shared-react files were correctly linked and propagated automatically.
- **Files modified:** none in git (node_modules is gitignored; environment re-sync, not a source change)
- **Verification:** all three twins share inodes with their package-src files (link count 2) and contain the new code; the trpc households-stale test went GREEN again.
- **Committed in:** n/a (environment fix)

**2. [Rule 1 - Correctness] Brought the web mutations test mock up to the current hook contract**
- **Found during:** Task 2
- **Issue:** apps/web/__tests__/hooks/households/use-household-mutations.test.ts was ALREADY failing (8/8) on the pre-existing HEAD: its useTRPC mock predates 02-04 and lacked households.list, households.switchActive, and recipes.list, which createUseHouseholdMutations already references. My Task-2 rename addition would compound the gap.
- **Fix:** Added households.list (queryKey/queryOptions), households.switchActive, households.rename, and recipes.list.queryKey to the mock; declared+reset mockRenameMutate/mockSwitchActiveMutate; added rename/switchActive to the exports assertions; added a focused test that rename passes the trimmed name + supplied version. Contract-only test fixup — no production behavior change.
- **Files modified:** apps/web/__tests__/hooks/households/use-household-mutations.test.ts
- **Verification:** the suite now passes 9/9 (8 originally + 1 new).
- **Committed in:** 2bfc8c1c (Task 2 commit)

**3. [Rule 1 - Lint/a11y] Removed autoFocus from the rename Input**
- **Found during:** Task 4
- **Issue:** the repos eslint bans autoFocus (jsx-a11y/no-autofocus); my rename Input used it.
- **Fix:** removed the autoFocus prop (the user explicitly clicks the pencil to enter edit mode, so it is unnecessary). Lint went clean.
- **Files modified:** apps/web/app/(app)/settings/household/components/household-info-card.tsx
- **Verification:** pnpm --filter @norish/web lint exits 0.
- **Committed in:** edb19b27 (Task 4 commit)

### Scope note (not a deviation)

- The plans files_modified lists mobile-nav.tsx, but the cookbook switcher (and now the create-or-join modal trigger + modal) lives entirely in the SHARED NavbarUserMenu, which mobile-nav.tsx already renders. So the modal works on mobile with NO mobile-nav.tsx change. Likewise household-view.tsx only composes the cards, so the rename control lives in household-info-card.tsx and household-view.tsx is unchanged.

---

**Total deviations:** 3 (1 blocking env re-sync, 1 correctness test-contract fixup, 1 lint/a11y). **Impact:** all necessary for the tasks; no scope creep. No new realtime/invite system; no backend behavior beyond the rename mutation; no mobile-nav.tsx/household-view.tsx change needed.

## Issues Encountered

### shared-react filtered typecheck uses --noCheck (pre-existing, same as 02-04)
pnpm --filter @norish/shared-react typecheck runs tsc --noEmit --noCheck and is green. To honor the HARD GATE I also ran a REAL tsc --noEmit for the package and grepped for my touched files (household-context.tsx, use-household-mutations.ts, hooks/households/types.ts): zero errors in any touched file (the 2 pre-existing real-tsc errors noted in 02-04 are unrelated to this plan).

## User Setup Required

None — no external service configuration required (user_setup: []).

## Human-Verify: PENDING (lead — Chrome)

The checkpoint:human-verify task was NOT run (owned by the lead). The lead rebuilds norish:local, restarts the norishp2 verify stack, and re-verifies in Claude-in-Chrome: open the avatar switcher -> Create or join a cookbook opens a modal -> create a 2nd cookbook (it appears in the switcher + becomes active) -> the join-by-code field is present -> rename the cookbook in Settings -> Household (as admin) and confirm the new name in the switcher. Static verification (typecheck x5, i18n:check, lint, household tests) is all green.

## Next Phase Readiness

CKBK-UI-01 + RENAME-01 are code-complete and HOUSE-02 is now true end-to-end in the UI (create-another / join-by-code reachable from the navbar at any time; admin rename in settings). After the leads Chrome re-verify of 02-04 + 02-05, Phase 2 is shippable. Phase 3 (AssemblyAI) remains independent/unplanned.

## Self-Check: PASSED

Re-ran every task acceptance_criteria + the plan-level verification:
- **Task 1:** renameHousehold exported (repo); rename mutation registered in the households router; both typecheck; rename asserts admin (FORBIDDEN) + uses optimistic version + 1; RenameHouseholdInputSchema in shared. db/shared/trpc typecheck = EXIT 0. PASS
- **Task 2:** HouseholdContextValue exposes createHousehold/joinHousehold/rename; HouseholdMutationsResult has rename; shared-react + web typecheck = EXIT 0 (real tsc on touched shared-react files = 0 errors). PASS
- **Task 3:** create-or-join-cookbook-modal.tsx uses useHouseholdContext create/join; navbar opens the modal from Create or join a cookbook (href removed; setShowCookbookModal + the modal render); no-household-view.tsx reuses CreateOrJoinCookbookForms (0 inline form/useState/mutation lines); web typecheck + lint = EXIT 0. PASS
- **Task 4:** household settings shows an admin-only rename control (isAdmin gated pencil + inline Input) wired to rename(household.id, name, household.version); web typecheck + lint = EXIT 0. PASS
- **Task 5:** pnpm i18n:check = EXIT 0; createOrJoin + rename keys present in all 11 locales; nl+en real, 9 EN-fallback (each diff +10 lines). PASS
- **Plan verification:** typecheck db/shared/trpc/shared-react/web all EXIT 0; i18n:check EXIT 0; @norish/web lint EXIT 0; household tests green (web hooks 24/24, trpc households-stale 1/1, db households.isolation 6/6). PASS

key-files.created exists on disk; git log --grep shows 5 feat(02-05) commits. Live DB/containers untouched; nothing pushed; no pnpm build/docker:build/dev-server run.

---
*Phase: 02-multi-household*
*Completed: 2026-06-13*
