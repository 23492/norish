# Norish: HeroUI Pro replacement (Phase 20.1) — no paid license

> PENDING VAULT CAPTURE: the Obsidian wiki MCP was not authorized in the 2026-07-15 session.
> Ingest this note as `norish-heroui-pro-replacement` (project: norish, category: journal,
> tags: norish, heroui, gsd, upstream-merge, ui-components), then delete this file.

## Decision (Kiran, 2026-07-15)

Do **NOT** buy the HeroUI Pro license (`HEROUI_AUTH_TOKEN`). Upstream norish v0.19.0-beta adopted the paid `@heroui-pro/react@1.0.0-beta.5`, which blocked the fork's `pnpm docker:build` on `integ/upstream-0.19.0` (see the 2026-06-28 STATE.md entry — the Next.js build failed with `Can't resolve '@heroui-pro/react'`; typecheck/vitest stayed green because a stub package + test alias masked it). Instead: replace every pro usage with free equivalents. Inserted as **gsd Phase 20.1** (`.planning/phases/20.1-replace-heroui-pro/` — CONTEXT, RESEARCH, 3 plans).

## Key discovery

Almost everything "Pro" has a free sibling **already installed** in the repo — zero new npm dependencies needed:

| Pro component (file) | Free replacement | Source |
|---|---|---|
| `Segment` (recipe-view-mode-toggle.tsx) | `ToggleButtonGroup`/`ToggleButton` from free `@heroui/react@3.1.0` | pattern already in repo (`measurement-system-selector.tsx`); API confirmed via 21st.dev `@larsen66/heroui-toggle-button-group` (id 15413). **✅ Applied 2026-07-15, tsc clean** |
| `Sheet` (Panel.tsx — the app's single bottom-sheet wrapper, 13 consumers) | free `@heroui/react` `Drawer` (`placement="bottom"`) — near-1:1 slot match (Backdrop/Content/Dialog/Handle/CloseTrigger/Header/Heading/Body/Footer); only `NestedRoot` needs a plain second Root | free HeroUI v3, verified in `drawer/index.d.ts` |
| `Carousel`+`useCarousel` (media-carousel, image-lightbox, cookingmode step-images) | local `apps/web/components/ui/carousel.tsx` on `embla-carousel-react@^8.6.0` (**already a dep** — pro's Carousel is embla-based) | base: 21st.dev `@shadcn/carousel` (id 813, MIT, source retrieved) + extensions: compound aliases, `selectedIndex` in context, `.Dots`, `.Thumbnails`, `--carousel-gap` var |
| `DropZone` (import-from-image-modal.tsx) | `react-aria-components` `DropZone`+`FileTrigger` (**already installed** — free HeroUI v3's own base; `onDrop`/`getDropOperation` signatures identical) | local styled wrapper `ui/drop-zone.tsx` |
| `@import "@heroui-pro/react/css"` (globals.css) + package.json dep + vitest stub + Dockerfile `--mount=type=secret,id=HEROUI_AUTH_TOKEN` + `secrets.HEROUI_AUTH_TOKEN` in 5 GitHub workflows | delete all | 20.1-03 |

## Phase gate

`pnpm --filter @norish/web build` (the exact blocked Next.js build) must pass token-free, then full-monorepo suites, then the director-owned `pnpm docker:build` → `norish:beta` — now secret-free. Visual-parity checklist in 20.1-03 Task 3 (nested panels, carousel dots/thumbnails, dropzone drag+picker).

## 21st.dev MCP notes

Free tier: searches unmetered; component-code retrievals metered at 2/day (both used 2026-07-15 on ids 15413 + 813). The retrieved shadcn carousel source is preserved in `20.1-RESEARCH.md` §2.3 context so execution doesn't need another retrieval.

## Status

- 2026-07-15: Phase 20.1 planned (3 plans); Segment swap applied in working tree; ROADMAP + STATE updated. Next: execute 20.1-01.
