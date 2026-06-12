# norish (Kiran's fork)

## What This Is

A self-hosted fork of [norish](https://github.com/norish-recipes/norish) (AGPL-3.0) — a recipe manager — tailored for Kiran's homelab. It keeps upstream's stack and style, adding: native Camoufox-based scraping (replacing headless Chrome), multi-household / multi-cookbook support, and AssemblyAI video transcription. The fork stays as close to upstream as possible so it remains maintainable and re-baseable.

## Core Value

Reliable recipe import & management for Kiran's groups — including bot-protected sources (AH.nl etc.) — with no more setup than the off-the-shelf norish. The package is self-contained: the Camoufox browser is bundled in the compose by default, so no external scraping service is required.

## Requirements

### Validated

- Native Camoufox scraping replaces headless Chrome (no boot-patch) — Phase 1 shipped.

### Active

- [ ] Multiple households per user (friend-group, partner, personal) with switching + per-cookbook recipe scoping — Phase 2 planned
- [ ] AssemblyAI video transcription (native provider) for TikTok/Instagram/YouTube — Phase 3
- [x] Minimal setup parity with upstream; clean, re-baseable diff (ongoing constraint; Camoufox bundled self-contained)

### Out of Scope

- Mobile app (apps/mobile) feature work — web is the target
- Rewriting upstream's recipe parser / AI extraction — works; only the fetch layer changes
- Locale config — already NL-default + EN upstream; no change needed
- Phase 2 v2 extras: moving a recipe between cookbooks + per-cookbook permission-policy overrides (HOUSE-08)

## Context

- Upstream: norish-recipes/norish (AGPL-3.0, very active, latest v0.18.3-beta). Monorepo: pnpm@10.33.2 + Turbo; Next.js 16, React 19, better-auth 1.6.9, Drizzle 0.45, tRPC 11, BullMQ, Postgres 17, Vitest 4, TS 5.9.
- Deploy target: LXC 110 (docker host, 192.168.2.47) — the live norish runs here. Camoufox REST service: LXC 105 (192.168.2.26:9377) or the bundled compose service.
- The current live deploy uses a boot-time patch for Camoufox + AssemblyAI; this fork makes both native source, removing the patch.
- Phase 2 grounding: this instance currently has 1 user / 9 recipes / 0 households, so the migration backfills all existing recipes to `household_id = NULL` (personal) with no data reassignment.

## Constraints

- **Process**: All work follows gsd-core (phase loop, .planning/ artifacts, verify-before-ship).
- **Style**: Match upstream norish conventions exactly (pnpm, ESM, TS). Minimal, isolated diffs; track upstream; consider upstreaming features.
- **Env**: All development via SSH on LXC 110. Build with `pnpm docker:build` on 110. Deploy the built image to 110.
- **Licensing**: AGPL-3.0 (private use fine; offer source if exposed publicly).
- **Quality**: Complete work, no placeholders. Per-cookbook isolation (Phase 2) is security-critical — enforced server-side + covered by dedicated tests.
- **Standalone**: Camoufox is bundled in the compose by default (overridable via `CAMOFOX_URL`); all cloud API keys (AI extraction, transcription, OAuth) are set in the admin UI — never required as env.
- **i18n**: `pnpm i18n:check` uses `en` as source of truth and fails on any missing key in any of the 11 locales (da, de-formal, de-informal, en, es, fr, it, ko, nl, pl, ru) — new UI keys must land in all 11.

## Key Decisions

| Decision | Rationale | Outcome |
|----------|-----------|---------|
| Fork + rebuild (not boot-patch) | Maintainable, native, drops fragile bundle-patching | Done |
| Native Camoufox replaces Chrome in source | User directive; Camoufox beats bot-walls | Done (Phase 1) |
| AssemblyAI as native transcription provider | User choice; folds boot-patch into source | Pending (Phase 3) |
| Dev+build on LXC 110, gh account 23492 | User directive | Done |
| gsd-core minimal profile | Adhere to gsd-core; minimal footprint | Done |
| Camoufox bundled via vendored camofox-browser v1.4.1, built in compose | Standalone package, no external browser service; published 1.8-1.11 images regressed on Akamai (fail AH.nl), so vendor + build the proven v1.4.1; overridable via CAMOFOX_URL | Done |
| Cloud keys via admin UI, not env | Zero-secret env; keys persisted encrypted in DB, configured post-install | Done |
| `recipes.household_id` (nullable FK, ON DELETE SET NULL; NULL=personal) for recipe scoping | A recipe lives in exactly one cookbook (or none); minimal 1:N FK beats a recipe↔cookbook join; mirrors existing `recipes.userId` | Planned (Phase 2, D-01) |
| `user.active_household_id` (dedicated nullable FK) as the active-cookbook pointer | FK integrity (auto-null on household delete) + clean resolver; chosen over user.preferences JSONB | Planned (Phase 2, D-04) |
| `getHouseholdForUser` → `getActiveHouseholdForUser` as the single scoping seam | Member-scoped secondary repos (groceries/calendar/allergies/caldav) follow the active cookbook automatically via `ctx.userIds`; narrows blast radius | Planned (Phase 2, D-05) |
| Swap unique `(url,userId)` → `(url,household_id)` | Dedup is per-cookbook; NULL household rows (personal) never collide | Planned (Phase 2, D-13) |
| `recipe_permission_policy` shape unchanged; `household` reinterpreted per-cookbook | v1 uses one server-wide policy scoped to the recipe's own cookbook + requester membership; per-household override deferred to v2 (HOUSE-08) | Planned (Phase 2, D-09/D-10) |
| Per-cookbook isolation in permissions.ts + dedicated tests | Security-critical (HOUSE-06): `canAccessResource` keyed on recipe household_id + requester member household ids; DB + tRPC isolation suites | Planned (Phase 2, D-11/D-12) |

---
*Last updated: 2026-06-12 — Phase 2 (multi-household) planned; Phases 0 + 1 marked complete (Camoufox scraping shipped + bundled).*
