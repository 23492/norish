# Phase 21 — 01 — SUMMARY

**Status:** CODE-COMPLETE (plannable slice). Not deployed (deploy is a separate agent).
**Base:** `main` @ `869b689d`. **Scope:** the director-decided slice from `21-CONTEXT.md` +
the settings recommended-default from `21-SETTINGS-INVENTORY.md`.

## What shipped

### 1. MEDIA-UX-01 — media-aware lightbox (DONE)
- `image-lightbox.tsx`: `images` prop widened from `{src;alt?}[]` to a discriminated
  `LightboxMedia = LightboxImage | LightboxVideo` union (exported). Video slides render
  through the existing `VideoPlayer` (poster + duration); a shared `LightboxSlide` renders
  image-or-video in both the carousel and single-item paths. Counter/arrows/thumbnails
  already gate on `images.length > 1`, so mixed sets now get all three.
- `components/ui/carousel.tsx`: `Carousel.Thumbnail` (its only consumer is the lightbox)
  gained optional `type` + optional `src` — video thumbnails show the poster (or a dark
  fallback) with a play badge.
- `media-carousel.tsx`: new exported pure `buildLightboxMedia(items)` maps the FULL sorted
  set 1:1 (videos kept, order preserved); the `items.filter(type === "image")` drop and the
  `if (item.type !== "image") return` guard are gone; the lightbox index is the slide index.
- Test: `__tests__/components/media-carousel-lightbox.test.tsx` (5 cases) proves videos are
  kept, order preserved, poster/duration carried, missing poster → null.
- Left untouched on purpose: every `unoptimized` (criterion 2 / A2 is OUT of scope — needs
  the network trace first).

### 2. Mobile-nav avatar (DONE)
- `mobile-nav.tsx`: the user-menu wrapper went from an `h-13 … px-2` glass pill (a circle
  floating in an oval) to a clean `size-13` circle sized to the nav height. Name label stays
  hidden — Phase 13's avatar-only decision is preserved. `mobile-nav.test.tsx` stays green.

### 3. Calendar — hide empty past days (DONE, polish-sized piece only)
- New `components/calendar/visible-days.ts` → `filterVisibleDays(days, itemsByDate, todayKey)`:
  today + all future always kept; a past day is kept only if it holds ≥1 planned item.
- Applied in both `mobile-timeline.tsx` and `desktop-timeline.tsx` to the `eachDayOfInterval`
  result BEFORE deriving keys/rows/virtualizer/todayIndex (desktop: before row padding).
- Test: `__tests__/components/calendar/visible-days.test.ts` (4 cases).
- Rows-of-7 re-architecture stays deferred to its own phase (per the audit).

### 4. Settings reduction (DONE — recommended default, with a documented deviation)
- Removed from the admin tab: `AuthProvidersCard` (env-backed: `OIDC_*/GITHUB_*/GOOGLE_*/
  WORKOS_*`, already shipped an `EnvManagedBadge`) and `SystemCard` + restart modal
  (operator action). Dropped the `ai` (`AIConfigForm`) and `video` (`VideoProcessingForm`)
  accordion items from `AIProcessingCard` — both have verified env syncs
  (`syncAIConfigFromEnv`, `syncVideoConfigFromEnv`). Kept prompts + bulk-categorization.
- Orphaned component files deleted (git-recoverable): `auth-providers/` (10 files),
  `restart-required-chip`, `system-card`, `restart-confirmation-modal`, `ai-config-form`,
  `video-processing-form`.
- **Kept (no-env / UI-only → cutting would regress):** `GeneralCard`, `PermissionPolicyCard`,
  `AdminShareLinksCard`, `ContentDetectionCard` (incl. timer-keywords), prompts.
- **DEVIATION from `21-SETTINGS-INVENTORY.md`:** the inventory lists content-detection as
  env-backed (✅) and safe to cut. Code inspection proves otherwise — `CONTENT_INDICATORS`,
  `UNITS_JSON`, `CONTENT_INGREDIENTS` are declared in `env-config-server.ts` but **consumed
  nowhere** (`importEnvOperatorConfig` only syncs AI/video/auth). Cutting the card would make
  those settings permanently unsettable — a real regression — so it was kept. Reversible;
  revisit if real env plumbing is added. This is exactly the "only way to set something" trap
  the audit flagged.

## Gates
- `pnpm --filter @norish/web typecheck` — EXIT 0.
- `pnpm typecheck` (17 projects) — 17/17 successful.
- `pnpm --filter @norish/web test` — 424 passed (415 baseline + 9 new), 70 files.
- `pnpm --filter @norish/web lint` — 0 errors (1483 warnings; baseline was ~1593 — fewer only
  because dead files were deleted).
- `pnpm --filter @norish/web build` — EXIT 0.
- `pnpm i18n:check` — no strings were added/changed, so the gate does not apply. It DOES fail,
  but the failure is **pre-existing on the clean base `869b689d`**: the `no` (Norwegian)
  locale is missing `settings.join.*` keys. Filed as a discovered issue (not fixed — out of
  scope). No locale file was touched by this phase.

## Deferred / discovered (not fixed here)
- A2 `unoptimized` image-fetch fix — blocked on the browser network trace (OUT of scope).
- Calendar rows-of-7 — its own phase.
- Settings second pass (caldav, token cards, the four ❌ env-less cards) — reversible, later.
- Pre-existing i18n gap: `no` locale missing `settings.join.*` (see STATE).
