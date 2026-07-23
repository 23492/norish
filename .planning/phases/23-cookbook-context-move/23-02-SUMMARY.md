# 23-02 SUMMARY — Cookbook context UI, move action, Cookbooks nav

**Commit:** `ecb06369`
**Requirement:** CKBK-MOVE-01

## What shipped
- **moveRecipe mutation** through `createUseRecipesMutations` + the shared/web recipes
  contexts — invalidates the actor's list + detail on success; error toast on failure.
- **CookbookChip** (`apps/web/components/recipes/cookbook-chip.tsx`) — shows the recipe's
  owning cookbook (or "Personal") on the recipe detail, rendered via a new `cookbook` slot on
  the shared `ReadonlyRecipeSummary`, so BOTH desktop and mobile detail pages inherit it
  (scope item 1). When the viewer can edit and has ≥1 write destination, the chip becomes a
  button opening **MoveRecipeModal**, which lists only cookbooks the viewer may write to
  (Personal offered to the owner only) (scope item 2). The server re-enforces every rule.
- **Cookbooks nav entry** (scope item 3) — `/cookbooks` added to `siteConfig.navItems`,
  wired into desktop `navbar.tsx` + `mobile-nav.tsx` (BookOpenIcon), and a `/cookbooks`
  browser page listing Personal + each household with active badge + member counts, switching
  the active cookbook and routing to the (cookbook-scoped) dashboard — mirrors the Phase-2
  switcher.
- **i18n** — `navbar.nav.cookbooks`, `navbar.cookbook.{title,subtitle,open}` and a
  `recipes.move.*` block in ALL 12 locale dirs (incl. `no`, to introduce no new gaps).

## Tests
- `mobile-nav.test.tsx` + `recipe-favorites-doubletap.test.tsx` updated for the new nav item
  and the CookbookChip on the detail pages. web stays 424/424.

## Notes
- Realtime on move follows Phase 22: destination `created` keys on the recipe's new cookbook;
  source `deleted` is id-only (no DTO leak to the cookbook it left).
</content>
