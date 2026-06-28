---
phase: 20
plan: "04"
subsystem: web, ui
tags: [heroui-v3, fork-delta, recipe-rating, cookbook-switcher, household-rename, sso, assemblyai, visibility]
dependency_graph:
  requires: [20-01, 20-02, 20-03]
  provides: [web-fork-deltas-v3]
  affects: [apps/web, packages/ui]
tech_stack:
  added: []
  patterns: [heroui-v3-compound-api, createHouseholdContext, vitest-alias-stub]
key_files:
  created:
    - apps/web/__tests__/stubs/heroui-pro-react.ts
  modified:
    - packages/ui/src/star-rating.tsx
    - apps/web/app/(app)/recipes/[id]/recipe-page-desktop.tsx
    - apps/web/app/(app)/recipes/[id]/recipe-page-mobile.tsx
    - apps/web/app/(app)/recipes/[id]/components/recipe-share-panel.tsx
    - apps/web/app/share/[token]/page.tsx
    - apps/web/context/household-context.tsx
    - apps/web/context/recipes-context.tsx
    - apps/web/components/navbar/navbar-user-menu.tsx
    - apps/web/app/(app)/settings/household/components/household-info-card.tsx
    - apps/web/app/(app)/settings/household/components/join-code-card.tsx
    - apps/web/app/(auth)/login/page.tsx
    - apps/web/app/(auth)/login/components/auto-sign-in.tsx
    - apps/web/app/(app)/settings/admin/components/video-processing-form.tsx
    - apps/web/components/shared/import-recipe-modal.tsx
    - apps/web/vitest.config.ts
    - apps/web/__tests__/components/navbar-user-menu-open-state.test.tsx
decisions:
  - Re-applied all fork web deltas onto HeroUI v3 API (Card.Content/Card.Header, toast(), variant=tertiary, compound Select/ListBox) rather than deferring
  - Kept upstream v3 no-household-view.tsx (inline create/join forms are a superset of fork's modal delegation)
  - Kept upstream v3 timer-dock.tsx (already incorporates equivalent style fixes)
  - Added heroui-pro-react vitest stub + alias because paid package has no exports without HEROUI_AUTH_TOKEN
  - Added Dropdown.Section to navbar test mock to match fork's cookbook-switcher addition
metrics:
  duration: "context-continuation (prior session + current)"
  completed: "2026-06-28"
  tasks_completed: 3
  files_changed: 17
---

# Phase 20 Plan 04: Web UI Fork Deltas onto HeroUI v3 Base Summary

Re-applied all fork-specific web UI features onto upstream 0.19.0's HeroUI v3 base, including RecipeRaters, visibility share panel, cookbook switcher, household rename/invite cards, WorkOS SSO escape, AssemblyAI provider option, and active-cookbook import indicator — all migrated to v3 component API.

## Objective

All 16 files (15 web + `packages/ui/src/star-rating.tsx`) were taken on the upstream side at plan 20-01 (Strategy B). This plan re-applied the fork's delta on top, using the HeroUI v3 compound API throughout.

## Tasks Completed

| # | Task | Commit | Files |
|---|------|--------|-------|
| 1 | Recipe subsystem (raters, visibility, star-rating clear) | 7ed9a677 | recipe-page-desktop, recipe-page-mobile, recipe-share-panel, share/[token]/page, star-rating.tsx |
| 2 | Auth/admin/household/navbar deltas | 7ed9a677 | household-context, recipes-context, navbar-user-menu, household-info-card, join-code-card, login/page, auto-sign-in, video-processing-form, import-recipe-modal |
| 3 | Test gate (typecheck + test green) | 7ed9a677 | vitest.config.ts, heroui-pro-react stub, navbar test mock |

## Implementation Details

### star-rating.tsx
Added `userValue?: number | null` and `onClear?: () => void` props alongside upstream's `allowClear`/`size`/`showValueSuffix`. `handleSelect` routes to `onClear()` when `onClear` is set and the user taps their own current rating (clear intent), otherwise falls through to `onChange`.

### Recipe pages (desktop + mobile)
Re-imported `RecipeRaters` component and wired `removeRating` from `useRatingsMutation()`. Added `handleClearRating` that calls `removeRating(recipe.id)`. Passed `userValue` and `onClear` to `<StarRating>`. Rendered `<RecipeRaters recipeId={recipe.id} />` below the rating control.

### recipe-share-panel.tsx
Restored visibility mutation (`useMutation` via tRPC), `queryClient`, `RecipeVisibility` type, and `visibilityOptions`. Built visibility `<Select>` using v3 compound API: `Select.Trigger` / `Select.Popover` / `ListBox` / `ListBox.Item` / `ListBox.ItemIndicator`.

### household-context.tsx
Restored full `createHouseholdContext` call with all eight hook factories: `useHouseholdsListQuery`, `useSwitchActive`, `useCreateHousehold`, `useJoinHousehold`, `useRename`, `useGenerateInviteToken`, `useJoinByInviteToken`, `useHouseholdSubscription`.

### recipes-context.tsx
Re-added `useHouseholdContext` import, `useEffect`, `useRef`, and the `activeHouseholdId` watch effect that calls `base.invalidate()` when the active cookbook changes, keeping the recipe list in sync with cookbook switches.

### navbar-user-menu.tsx
Added cookbook switcher `Dropdown.Section` between language and create-recipe items. Uses `switchActive(null)` for personal and `switchActive(cookbook.id)` for household cookbooks. Shows a `CheckIcon` on the active entry.

### household-info-card.tsx
Added inline rename: `isEditingName`/`nameDraft` state, pencil-icon trigger, `Input` (v3) in the `Card.Header` editing mode, `handleSaveName` calling `rename()` from context, `toast()` on success.

### join-code-card.tsx
Added invite link section below the join code section (separated by `<Separator/>`). Calls `generateInviteToken()` from context, constructs full invite URL, provides copy-to-clipboard. State: `isGeneratingLink`.

### login/page.tsx + auto-sign-in.tsx
Restored `shouldAutoRedirectToSso` import and `?sso=0` / `logout=true` escape hatch. `auto-sign-in.tsx` renders a "Use another method" `<Link href="/login?sso=0">` below the auto-redirect spinner so SSO-forced users can break out.

### video-processing-form.tsx
Added `"assemblyai"` to `TRANSCRIPTION_PROVIDER_OPTIONS` array so it appears in the admin settings dropdown.

### import-recipe-modal.tsx
Re-added `useHouseholdContext` to resolve active cookbook name (`households.find()` or personal fallback). Renders `BookOpenIcon` + `targetCookbook` translation below the URL input.

## Files Not Changed (intentional)

- `apps/web/app/(app)/settings/household/components/no-household-view.tsx`: Upstream v3 already has inline create/join forms — a superset of the fork's `CreateOrJoinCookbookForms` modal delegation. Kept upstream version.
- `apps/web/components/timer-dock.tsx`: Upstream v3 already incorporates equivalent style fixes from the fork. No delta to re-apply.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] `@heroui-pro/react` unresolvable in test environment**
- **Found during:** Task 3 (test gate)
- **Issue:** `panel.test.tsx` failed with "Failed to resolve entry for package `@heroui-pro/react`". The paid package has no `main`/`module`/`exports` fields without the `HEROUI_AUTH_TOKEN` postinstall download.
- **Fix:** Created `apps/web/__tests__/stubs/heroui-pro-react.ts` (`export const Sheet = {}`) and added vitest `resolve.alias` entry mapping `@heroui-pro/react` to the stub.
- **Files modified:** `apps/web/__tests__/stubs/heroui-pro-react.ts`, `apps/web/vitest.config.ts`
- **Commit:** 7ed9a677

**2. [Rule 1 - Bug] `useHouseholdContext` not mocked in navbar open-state test**
- **Found during:** Task 3 (test gate)
- **Issue:** `navbar-user-menu-open-state.test.tsx` threw "useHouseholdContext must be used within HouseholdProvider" after the navbar component gained the household context import.
- **Fix:** Added `vi.mock("@/context/household-context", ...)` returning stub with `activeHouseholdId: null`, `households: []`, `switchActive: vi.fn()`.
- **Files modified:** `apps/web/__tests__/components/navbar-user-menu-open-state.test.tsx`
- **Commit:** 7ed9a677

**3. [Rule 1 - Bug] `Dropdown.Section` missing from navbar test's `@heroui/react` mock**
- **Found during:** Task 3 (test gate, second run)
- **Issue:** After the household-context mock was added, the test still failed with "Element type is invalid: expected a string...but got: undefined" because `Dropdown.Section` was used by the navbar component but not defined in the test's inline `@heroui/react` mock.
- **Fix:** Added `Section` component to the `Dropdown` compound object in the mock.
- **Files modified:** `apps/web/__tests__/components/navbar-user-menu-open-state.test.tsx`
- **Commit:** 7ed9a677

## Verification

- `pnpm --filter @norish/web typecheck`: EXIT 0, clean (no type errors)
- `pnpm --filter @norish/web test`: 68 test files passed, 410 tests green

## Known Stubs

None. All fork features are fully wired.

## Threat Flags

None. No new network endpoints, auth paths, or schema changes introduced. Changes are purely UI-layer re-application of existing fork features.

## Self-Check: PASSED

- Commit 7ed9a677 exists: VERIFIED
- All 16 target files modified/created: VERIFIED (17 files changed in commit)
- `pnpm --filter @norish/web typecheck` exit 0: VERIFIED
- `pnpm --filter @norish/web test` 410 passing, 0 failed: VERIFIED

---

## Gap Closure (2026-06-28) — timer-dock fork fixes re-applied

**Commit:** cc740294

The original executor incorrectly judged `apps/web/components/timer-dock.tsx` as "already incorporating equivalent style fixes" and left it byte-identical to upstream 0.19.0. Both fork timer-dock fixes were missing. They have been re-applied onto upstream's restructured component:

### Fix 1 — mobile FAB tap-through (pointer-events)
- Positioning wrapper: added `pointer-events-none` so the dock's empty area does not block the `md:hidden` mobile add-grocery FAB beneath it.
- Card (`motion.div`): added `pointer-events-auto` so the card itself remains interactive.

### Fix 2 — close control reachable on short/mobile viewports with >1 timer
- Expanded card: added `max-h-[80dvh]` + `flex flex-col` to clamp the card height.
- Inner `motion.div` (expanded wrapper): added `className="flex min-h-0 flex-col"` so the flex layout propagates.
- Header button: added `shrink-0` so the close control stays pinned and always reachable.
- Timer list: changed `max-h-96 overflow-y-auto` to `min-h-0 flex-1 overflow-y-auto` so the list scrolls within the clamped card.
- Notifications footer: added `shrink-0` to stay pinned below the scroll area.

All upstream 0.19.0 changes preserved (bg-surface tokens, className prop merge, auto-hide, isMobile detection).

**Gates re-run after gap closure:**
- `pnpm --filter @norish/web typecheck`: EXIT 0
- `pnpm --filter @norish/web test`: 68 files, 410 tests — all green
