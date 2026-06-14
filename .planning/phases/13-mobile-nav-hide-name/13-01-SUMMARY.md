---
phase: 13-mobile-nav-hide-name
plan: 13-01
subsystem: web-ui
status: code-complete
requirements: [MOBILE-NAV-HIDE-NAME-01]
commits: [6365ee27, a8df32c3, a3550f0a]
---

# Phase 13 Plan 13-01 SUMMARY: Hide the name label in the mobile bottom-nav profile item (avatar only)

## Outcome: CODE-COMPLETE (human-verify pending: lead docker:build + visual check on a real phone/narrow viewport)

The mobile bottom navigation's profile/account pill no longer renders a name label next to the avatar. It now shows ONLY the avatar (`NavbarUserMenu`, trigger="avatar"), which keeps its tap target and `aria-label="Open user menu"` and still opens the profile/account dropdown. Desktop nav and the dropdown's own name header are untouched; Recepten/Boodschappen/Kalender are unaffected.

## What the label actually was

The only visible text beside the avatar in the mobile bottom bar was the `{activeCookbookName}` `<span>` (mobile-nav.tsx, ex-lines 135-140) — the active **cookbook** name (`households.find(...).name ?? tCookbook("personal")`). For a personal/household cookbook named after the user this reads as the user's name (e.g. "Kiran Knopper…", truncated to `max-w-[5.5rem]`), which is the "name" the task referred to. `user.name` itself appears only (a) as the HeroUI Avatar `name` prop in navbar-user-menu.tsx (initials/a11y, not visible text) and (b) inside the dropdown header (the menu itself) — both INTENTIONALLY kept.

## The change (apps/web/components/navbar/mobile-nav.tsx)

- Removed the `{activeCookbookName}` `<span>` from the profile pill; the pill `<div>` (h-13, shrink-0, px-2, glass) now contains only `<NavbarUserMenu />`. Dropped the now-pointless `gap-2` (single child) so the avatar sits centered with no phantom gap; height/padding/shrink/glass preserved so the adjacent nav pill does not shift.
- Removed the dead code that ONLY fed that label (would otherwise trip ESLint no-unused-vars / strict TS): the `activeCookbookName` const + its 3-line comment, the `useHouseholdContext` import + `{ households, activeHouseholdId }` destructure, and the `tCookbook = useTranslations("navbar.cookbook")` declaration.
- Replaced the pill comment to document that the avatar-only treatment is intentional and the full name lives inside the menu it opens.
- NO i18n key changes (the `navbar.cookbook.*` keys remain; still used by navbar-user-menu.tsx). NO change to navbar.tsx, navbar-user-menu.tsx, messages/*.json.

## Files

- `apps/web/components/navbar/mobile-nav.tsx` — label span removed + dead code (activeCookbookName/useHouseholdContext/tCookbook) removed; pill comment updated.
- `apps/web/__tests__/components/mobile-nav.test.tsx` — NEW. Renders `MobileNav` (mocks next-intl, motion/react, useAutoHide->visible, user-context with name "Kiran Knoppert", and NavbarUserMenu->a labelled avatar button). Asserts: the "Open user menu" button + avatar are present (tap target intact) AND the user's name is NOT in the document; plus the three primary nav items still render.
- `.planning/phases/13-mobile-nav-hide-name/13-01-PLAN.md` — plan.

## Verification (static + unit; LEAD owns docker:build + live visual check)

- `@norish/web` typecheck: EXIT 0 (real `tsc --noEmit`).
- `@norish/web` lint: EXIT 0 (eslint; no mobile-nav findings).
- `@norish/web` test:run: 60 files / 381 tests PASS (baseline before change: 59 / 379; +1 file +2 tests from the new test; the new test also passes in isolation). NO new failures, NO pre-existing failures.
- `git diff --name-only main` (excluding .planning): ONLY `apps/web/components/navbar/mobile-nav.tsx` + `apps/web/__tests__/components/mobile-nav.test.tsx`. navbar.tsx + navbar-user-menu.tsx UNCHANGED.
- Did NOT run `pnpm docker:build`. Did NOT merge/deploy/touch live or `/opt/norish/`.

## Commits (branch feat/mobile-nav-hide-name)

- 6365ee27 docs(13-mobile-nav-hide-name): plan …
- a8df32c3 feat(13-mobile-nav-hide-name): show avatar only in mobile bottom-nav profile item
- a3550f0a test(13-mobile-nav-hide-name): assert mobile bottom-nav shows avatar but not the user name

## HUMAN-VERIFY (pending)

- LEAD: docker:build + deploy to a test env; on a real phone / narrow viewport confirm the bottom-bar profile pill shows the avatar only (no name/cookbook text), the avatar still opens the profile menu, and the desktop nav + the in-menu name header are unchanged.
