---
phase: 02-multi-household
plan: 04
subsystem: ui
tags: [react, next-intl, heroui, tanstack-query, trpc, households, cookbook-switcher, i18n]

requires:
  - phase: 02-multi-household
    provides: "households.list + households.switchActive tRPC procedures, HouseholdSummaryDto, active-household scoping of recipes by recipes.household_id, multi-membership (create/join guards removed), signup auto-creates own cookbook"
provides:
  - "shared-react household hooks: useHouseholdsListQuery (households.list) + switchActive mutation (invalidates household list + recipe list)"
  - "HouseholdContextValue extended with households / activeHouseholdId / switchActive (web factory wired)"
  - "Navbar cookbook switcher (shared NavbarUserMenu dropdown, used by desktop navbar + mobile-nav): lists households + a Personal option, marks the active cookbook, calls switchActive, fully localized"
  - "Import modal shows the active cookbook as the assign target; recipe list refetches on active-household change (switchActive + recipes-context effect)"
  - "navbar.cookbook.* (6 keys) + common.import.url.targetCookbook across all 11 locales (nl+en real, 9 EN-fallback)"
affects: [02-multi-household-human-verify]

tech-stack:
  added: []
  patterns:
    - "Extend the shared-react factory hooks/contexts in place; web wrappers stay thin (one self-contained list-query wrapper + a useSwitchActive adapter)"
    - "switchActive invalidates BOTH the household-list query and the recipes.list query path so the dashboard refetches into the new cookbook"
    - "Single shared cookbook switcher lives in NavbarUserMenu (rendered by both desktop navbar and mobile bottom-bar) - no duplicated dropdown; mobile-nav additionally surfaces the active cookbook name"
    - "Belt-and-suspenders recipe refetch: recipes-context useEffect invalidates the list when activeHouseholdId changes (covers server-driven household-switched events, not only the local switchActive)"
    - "i18n parity via the en-source gate: real nl+en, EN-string fallback for the other 9 locales (key presence is what the gate enforces)"

key-files:
  created:
    - packages/shared-react/src/hooks/households/use-households-list-query.ts
    - apps/web/hooks/households/use-households-list-query.ts
  modified:
    - packages/shared-react/src/hooks/households/types.ts
    - packages/shared-react/src/hooks/households/use-household-mutations.ts
    - packages/shared-react/src/hooks/households/index.ts
    - packages/shared-react/src/contexts/households/household-context.tsx
    - apps/web/hooks/households/use-household-mutations.ts
    - apps/web/hooks/households/index.ts
    - apps/web/context/household-context.tsx
    - apps/web/components/navbar/navbar-user-menu.tsx
    - apps/web/components/navbar/mobile-nav.tsx
    - apps/web/components/shared/import-recipe-modal.tsx
    - apps/web/context/recipes-context.tsx
    - "packages/i18n/src/messages/<11 locales>/navbar.json + common.json"

key-decisions:
  - "Single shared switcher: the cookbook DropdownSection lives in NavbarUserMenu (the avatar/ellipsis menu rendered by BOTH the desktop navbar and the mobile bottom-bar), so mobile gets the same switcher with no duplicated dropdown. mobile-nav.tsx additionally renders the active cookbook name (real mobile state) and consumes the household context."
  - "switchActive (shared-react mutation) invalidates the household-list query, the active-household settings query, AND the recipes.list query path ([trpc.recipes.list.queryKey({})[0]]); recipes-context.tsx ALSO invalidates on activeHouseholdId change as a server-event safety net."
  - "No per-cookbook import picker for v1 - the backend (02-02) assigns imports to the ACTIVE cookbook; the modal only INDICATES the target (active cookbook name or Personal). Matches the plan v1 requirement."
  - "Create/Join surfaces the EXISTING join-by-code flow via a Create or join a cookbook entry that links to /settings?tab=household (the existing household settings create/join UI). INVITE-LINK IS OUT OF SCOPE: no new invite-link/token system was built."
  - "i18n EN-FALLBACK x9 (user-locked decision, overrides the plan best-effort-translations wording): nl and en got real, proper translations; the other 9 locales (da, de-formal, de-informal, es, fr, it, ko, pl, ru) use the ENGLISH string as the value so the en-source key-presence gate (pnpm i18n:check) passes. These 9 are intentionally NOT machine-translated and can be localized properly later."
  - "HeroUI collection: the cookbook DropdownSection children are provided as a single array literal [Personal, ...households.map(...), manage] (react-aria flattens arrays). This matches the runtime-proven pattern in auth-language-selector.tsx (mapped DropdownItems as direct children)."
  - "createHouseholdContext factory gained useHouseholdsListQuery + useSwitchActive options; createHouseholdSettingsContext now spreads the base context value (...base) so the new households/activeHouseholdId/switchActive fields propagate to the settings context too."

patterns-established:
  - "Cookbook switcher = shared NavbarUserMenu section (desktop + mobile share one component)"
  - "Active-cookbook switch fans out invalidation to household list + recipe list; recipes-context guards on activeHouseholdId change"

requirements-completed: [HOUSE-01, HOUSE-02, HOUSE-03, HOUSE-07]

duration: ~14min
completed: 2026-06-13
---

# Phase 02 Plan 04: Frontend Cookbook Switcher + Assign-to-Cookbook UX + i18n Summary

**Navbar cookbook switcher (desktop + mobile) listing households + a Personal option with the active one marked, wired to households.list/switchActive via extended shared-react hooks/context, an import modal that shows the active-cookbook target with recipe-list refetch on switch, and navbar/common i18n keys across all 11 locales (nl+en real, 9 EN-fallback).**

## Performance

- **Duration:** ~14 min (production commits 13:11 -> 13:24 +02:00)
- **Started:** 2026-06-13T13:11:09+02:00
- **Completed:** 2026-06-13T13:24:46+02:00
- **Tasks:** 5 (Tasks 1-5; the dev-server task + the human-verify checkpoint are owned by the lead and were NOT run)
- **Files modified:** 35 (2 created)

## Accomplishments
- **Task 1 - shared-react hooks:** new useHouseholdsListQuery (households.list -> { households, activeHouseholdId, currentUserId, isLoading, invalidate }) + a switchActive(householdId | null) mutation on createUseHouseholdMutations that invalidates the household-list query AND the recipes.list query path; HouseholdMutationsResult gained switchActive; the new hook/type are exported and wired into createHouseholdHooks; the web mutations wrapper passes useHouseholdsListQuery.
- **Task 2 - context:** HouseholdContextValue extended with households / activeHouseholdId / switchActive; the factory consumes a list-query option + a useSwitchActive option; the web household-context.tsx passes useHouseholdsListQuery and useSwitchActive: () => useHouseholdMutations().switchActive; createHouseholdSettingsContext spreads the base value so the new fields propagate.
- **Task 3 - switcher UI:** a Cookbook DropdownSection in NavbarUserMenu listing a Personal item (active when activeHouseholdId === null) + each household (member count subtitle, UserGroup icon) with a CheckIcon on the active one and onPress -> switchActive(...), plus a Create or join a cookbook entry to /settings?tab=household. Used by both the desktop navbar and the mobile bottom-bar (which renders the same NavbarUserMenu); mobile-nav additionally shows the active cookbook name. All strings via useTranslations.
- **Task 4 - import target + refetch:** the import modal shows targetCookbook (active cookbook name, or Personal) as helper text by the import button; recipes-context.tsx invalidates the recipe list when activeHouseholdId changes (in addition to the switchActive-driven invalidation from Task 1).
- **Task 5 - i18n:** added navbar.cookbook.{label,personal,personalDescription,active,members,manage} + common.import.url.targetCookbook to ALL 11 locales. nl + en are real translations; the other 9 (da, de-formal, de-informal, es, fr, it, ko, pl, ru) use the EN string value (user-locked EN-fallback). pnpm i18n:check exits 0.

## Task Commits

1. **Task 1: shared-react households list + switchActive hooks** - 8b31b113 (feat)
2. **Task 2: expose households/active/switchActive in context** - 0b988214 (feat)
3. **Task 3: navbar cookbook switcher (desktop + mobile) with Personal** - da3d6beb (feat)
4. **Task 4: show active cookbook in import + refetch on switch** - b33327c7 (feat)
5. **Task 5: i18n cookbook switcher keys (nl+en real, EN fallback x9)** - 1ce89054 (feat)

**Plan metadata:** this SUMMARY commit (docs) + the STATE/ROADMAP/REQUIREMENTS update commit (docs).

## Files Created/Modified
- packages/shared-react/src/hooks/households/use-households-list-query.ts - new list-query hook (households.list)
- packages/shared-react/src/hooks/households/use-household-mutations.ts - switchActive mutation + recipe-list invalidation
- packages/shared-react/src/hooks/households/{types.ts,index.ts} - HouseholdsListResult type, switchActive on result type, exports, factory wiring
- packages/shared-react/src/contexts/households/household-context.tsx - households/activeHouseholdId/switchActive on the context value
- apps/web/hooks/households/{use-households-list-query.ts,use-household-mutations.ts,index.ts} - web wrappers
- apps/web/context/household-context.tsx - passes list + switch hooks into the factory
- apps/web/components/navbar/navbar-user-menu.tsx - the cookbook switcher DropdownSection
- apps/web/components/navbar/mobile-nav.tsx - active-cookbook label; renders the shared switcher menu
- apps/web/components/shared/import-recipe-modal.tsx - active-cookbook import-target indication
- apps/web/context/recipes-context.tsx - refetch recipe list on activeHouseholdId change
- packages/i18n/src/messages/<11 locales>/{navbar.json,common.json} - cookbook switcher + import-target keys

## Decisions Made
See key-decisions in frontmatter (single shared switcher, switchActive fan-out invalidation, no v1 import picker, create/join via existing join-by-code, EN-fallback x9, HeroUI array-children collection pattern, settings-context base spread).

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Correctness] recipes-context refetch on activeHouseholdId change (in addition to the switchActive invalidation)**
- **Found during:** Task 4
- **Issue:** The plan v1 requirement is satisfied by invalidating the recipe list inside switchActive (Task 1). But the active household can also change via the server-driven household-switched connection-invalidation event (emitted by the backend switchActive/join/leave/kick paths in 02-02), not only via the local mutation; relying solely on the local mutation would miss those paths.
- **Fix:** Added a useEffect in recipes-context.tsx that invalidates the recipe list when activeHouseholdId changes (skips initial mount). This also satisfies the plan must_haves key_link (recipes-context.tsx -> households router via invalidate on active-household change).
- **Files modified:** apps/web/context/recipes-context.tsx
- **Verification:** web typecheck + lint clean; grep proves the activeHouseholdId-tied invalidate.
- **Committed in:** b33327c7 (Task 4 commit)

**2. [Rule 1 - Re-baseability] Reverted incidental JSON reformatting in 3 fallback-locale files**
- **Found during:** Task 5
- **Issue:** The bulk EN-fallback inserter re-serialized JSON; for de-formal/navbar, de-informal/navbar and pl/common the repo had compact single-line nested objects that got normalized to multi-line, enlarging those diffs beyond the added keys (a minimal-diff / re-baseability concern per CLAUDE.md).
- **Fix:** Restored those 3 files from git and re-inserted ONLY the new keys via surgical text edits, preserving their original compact formatting. All other 6 fallback locales already had canonical formatting (byte-matched json.dumps) so their inserts were already minimal.
- **Files modified:** packages/i18n/src/messages/{de-formal,de-informal}/navbar.json, packages/i18n/src/messages/pl/common.json
- **Verification:** pnpm i18n:check exits 0; each locale diff is now +8 (navbar) / +3-1 (common) only; JSON validated.
- **Committed in:** 1ce89054 (Task 5 commit)

---

**Total deviations:** 2 auto-fixed (1 correctness safety-net, 1 re-baseability cleanup). **Impact:** Both improve correctness/cleanliness within scope; no scope creep, no new invite system, no backend change.

## Issues Encountered

### shared-react typecheck uses --noCheck (pre-existing)
The plan gate pnpm --filter @norish/shared-react typecheck runs tsc --noEmit --noCheck (skips deep dependency-type checking) and is green. A REAL tsc --noEmit for @norish/shared-react has TWO PRE-EXISTING errors unrelated to this plan (the better-auth AuthInstance cast - same one noted in 02-02 - and a pre-existing use-convert-mutation.ts updater error). To honor the acceptance-criteria HARD GATE I additionally ran a real tsc --noEmit filtered to EVERY file this plan touched (household-context.tsx, use-household-mutations.ts, use-households-list-query.ts, types.ts, index.ts): zero errors in any touched file. So the plan introduced no new real type errors.

## User Setup Required
None - no external service configuration required (user_setup: [] in the plan).

## Human-Verify: PENDING (lead)

The checkpoint:human-verify task was NOT run (owned by the lead, per scope). The lead must run the resource-sensitive docker build + full-stack smoke against the live DB on LXC 110 and present the visual verification to the user. Static verification (typecheck x2, i18n:check, lint) is all green. See Next Phase Readiness for the exact what-built + how-to-verify hand-off.

## Next Phase Readiness

**For the lead (human-verify checkpoint content):**

*What was built:* A cookbook switcher in the user/avatar menu (desktop navbar + mobile bottom-bar share the same NavbarUserMenu). It lists every household the user belongs to plus a Personal option, marks the active cookbook with a check, and calls households.switchActive on select. Switching refetches the dashboard recipe list (so each cookbook shows only its own recipes). A Create or join a cookbook entry links to the existing household settings (existing join-by-code flow; no invite-link). The import-from-URL modal shows which cookbook the recipe will be added to (the active one, or Personal). All strings localized in 11 locales; nl + en are real translations.

*How to verify:* Build + run the stack on LXC 110, open the app.
1. Open the user (avatar) menu -> confirm a Cookbook section listing your households + Personal, with the active one check-marked.
2. Create a second household (via the Create or join a cookbook entry -> household settings), then switch between it, the first household, and Personal -> the recipe list must change per cookbook and must NOT show another cookbook recipes (per-cookbook isolation from 02-03).
3. Import a recipe -> confirm the modal shows it will be added to the active cookbook, and it appears only in that cookbook.
4. Switch the app language to Dutch -> confirm the switcher strings are proper Dutch (Kookboek / Persoonlijk / Actief / Kookboek aanmaken of lid worden / {n} leden).
5. On a narrow viewport, confirm the mobile bottom-bar avatar opens the same switcher and shows the active cookbook name.

Resume signal: approved or describe issues.

## Self-Check: PASSED

Re-ran every task <acceptance_criteria> + the plan-level <verification>:
- Task 1: households.list query hook + switchActive mutation present; HouseholdMutationsResult has switchActive; web wrapper wires useHouseholdsListQuery; switchActive invalidates recipesListPath. PASS
- Task 2: HouseholdContextValue has households/activeHouseholdId/switchActive; web household-context passes useHouseholdsListQuery + useSwitchActive. PASS
- Task 3: navbar-user-menu renders Personal + households.map + switchActive(null)/switchActive(cookbook.id); mobile-nav renders the shared switcher + consumes the household context; no hardcoded English (lint exit 0). PASS
- Task 4: import modal shows targetCookbook(active|Personal); recipe list invalidated on switchActive AND on activeHouseholdId change. PASS
- Task 5: pnpm i18n:check exits 0; en+nl cookbook.* real; all 11 locales have identical key sets; 9 locales EN-fallback. PASS
- <verification>: pnpm --filter @norish/shared-react typecheck = EXIT 0; pnpm --filter @norish/web typecheck = EXIT 0; pnpm i18n:check = EXIT 0; pnpm --filter @norish/web lint = EXIT 0. Real tsc filtered to all touched shared-react files = 0 errors. PASS

key-files.created exist on disk; git log shows 5 feat(02-04) commits. Live DB/containers untouched; nothing pushed; no docker/dev-server build run.

---
*Phase: 02-multi-household*
*Completed: 2026-06-13*
