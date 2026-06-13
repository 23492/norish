# Requirements: norish (Kiran's fork)

**Defined:** 2026-06-12
**Core Value:** Reliable recipe import & management for Kiran's groups, incl. bot-protected sources, with no extra setup vs upstream.

## v1 Requirements

### Scraping (native Camoufox) — Phase 1

- [ ] **SCRAPE-01**: Recipe page fetching uses the Camoufox REST service (LXC 105) natively, configured via `CAMOFOX_URL`.
- [ ] **SCRAPE-02**: Headless-Chrome dependency removed from the app + docker compose (no `chrome-headless` service required).
- [ ] **SCRAPE-03**: Per-site cookie/header auth tokens are still applied through Camoufox.
- [ ] **SCRAPE-04**: Bot-protected sources (e.g. ah.nl) import successfully end-to-end.
- [ ] **SCRAPE-05**: No boot-time bundle patch needed — Camoufox support ships in the built image.
- [ ] **SCRAPE-06**: Graceful behavior when Camoufox is unreachable (clear error, no silent empty extraction).

### Households / cookbooks — Phase 2

- [x] **HOUSE-01**: A user can belong to multiple households simultaneously.
- [x] **HOUSE-02**: A user can create, join (by code), and leave multiple households.
- [x] **HOUSE-03**: A user can switch their active household/cookbook.
- [x] **HOUSE-04**: Recipes are scoped to a household/cookbook (`recipes.household_id`); `null` = personal.
- [x] **HOUSE-05**: A personal cookbook coexists with shared cookbooks for the same user.
- [x] **HOUSE-06**: Per-cookbook isolation — members of one household cannot see another household's recipes (security-critical).
- [x] **HOUSE-07**: Import/create assigns the recipe to the active cookbook (selectable). _(backend; frontend selector in 02-04)_

### Video transcription (AssemblyAI) — Phase 3

- [ ] **VIDEO-01**: AssemblyAI is a selectable native transcription provider (config-driven key).
- [ ] **VIDEO-02**: TikTok & Instagram video imports work (caption + transcription).
- [ ] **VIDEO-03**: Video description/caption is used in extraction (already upstream — verify retained).
- [ ] **VIDEO-04**: No boot-time patch for transcription — ships in the built image.

### Setup / maintainability — Phase 0 / cross-cutting

- [ ] **SETUP-01**: Fork builds via `pnpm docker:build` on LXC 110 and deploys to the existing stack.
- [ ] **SETUP-02**: Diff vs upstream is minimal + isolated; upstream remote tracked.
- [ ] **SETUP-03**: No extra runtime setup vs off-the-shelf norish (config/env only).
- [ ] **SETUP-04**: Camoufox is bundled in the compose (self-contained) by building the **vendored camofox-browser v1.4.1** source under `docker/camofox/` (no external image/registry — the published 1.8-1.11 images regressed on Akamai); no external browser service required; `CAMOFOX_URL` can override to reuse an external one.
- [ ] **SETUP-05**: All cloud API keys (AI provider, transcription/AssemblyAI, OAuth) are configurable via the admin UI and persisted (encrypted) in the DB — not required as environment variables.

## v2 Requirements

- **HOUSE-08**: Per-cookbook permission policy / move-recipe-between-cookbooks.
- **VIDEO-05**: Dedicated TikTok processor (caption-first hardening).

## Out of Scope

| Feature | Reason |
|---------|--------|
| Mobile app changes | Web is the target |
| Recipe parser/AI rewrite | Works; only fetch layer changes |
| Locale changes | Already NL+EN upstream |

## Traceability

| Requirement | Phase | Status |
|-------------|-------|--------|
| SCRAPE-01..06 | Phase 1 | Pending |
| HOUSE-01..07 | Phase 2 | HOUSE-01,02,03,04,05,06,07 done (frontend switcher/selector in 02-04) |
| VIDEO-01..04 | Phase 3 | Pending |
| SETUP-01..03 | Phase 0 | In progress |
| SETUP-04 | Phase 1 | Done |
| SETUP-05 | Phases 1/3 + cross-cutting | In progress |

**Coverage:** v1 = 22 requirements, all mapped to phases.

## Backlog / future phases

Locked from the product backlog + brainstorm (2026-06-12). All **Backlog/v2** unless a near-term marker is given. The rich version lives in Kiran's Obsidian vault; this is the concise canonical mirror.

### Near-term (candidate next phases)

- **POLICY-01** (near-term, **critical**): Per-household permission policies — each cookbook sets its own view/edit/delete; a household admin can edit any recipe in their household, members edit their own. (Phase 2 ships single-policy-reinterpreted for v1; this is the dedicated follow-on phase.)
- **INVITE-01** (fold into Phase 2 or a quick follow-on): Join a household via a longer-lived, regenerable **invite link** (`/join/<token>`), alongside the short join code.

### Sharing & ratings — Backlog

- **SHARE-01**: Per-link sharing with per-recipe visibility private/household/public (built on `recipe_shares`); public = no-auth view by share token. No public gallery (deferred).
- **SHARE-02**: "Save to account" button on a shared/public recipe → prompt login if needed → copy the recipe into the user's active cookbook.
- **RATE-01**: Ratings show **average + count** plus per-user ratings **with names** (including on public views).
- **VERSION-01** (major): Shared-recipe **versions / lineage** — saving a shared recipe creates a version in a shared bucket; users can explore others' versions; reviews aggregate across versions but stay **attributed to the version**; rater names visible. (Phase 2's recipe-1:N-cookbook model stays forward-compatible via a future `lineage_id` / `parent_recipe_id`.)

### Cooking, cost & discovery — Backlog (major)

- **COOK-01** (major): Migrate to **Cooklang** — aligned with upstream issue #470, built so it is contributable as the PR that closes it (coordinate design with the maintainer). Delivers in-step ingredient quantities + multi-timer cooking mode. Parser `@cooklang/cooklang` (WASM); requires a structured→`.cook` serializer for the importer; map dual-unit / nutrition / media into Cooklang metadata.
- **COST-01** (major): Cost-per-recipe **€/€€/€€€** badge — daily index pull from `supermarkt/checkjebon` (MIT, 12 NL chains) → Postgres; Camoufox AH scrape for cache-miss + Bonus/deals; LLM ingredient parse (Dutch) + fuzzy match; per-serving bucket; **async**. Do not redistribute scraped AH data.
- **MAKE-01** (major): "What can I make now" — **image (+ optional text) input** → AI ingredient recognition → makeable recipes (+ what's missing). **No pantry.** Seed reference: Albert Heijn GenAI (https://nieuws.ah.nl/albert-heijn-zet-volgende-stappen-in-generative-ai/). Deep research deferred to build-time.
- **SHOP-01** (major): Smart shopping list with **aisle / category grouping** (Tandoor model: food→category, store→ordered categories; seed from open-tandoor-data), generated from recipes / meal-plan. Decoupled from any pantry. Deals optional / later.
- **DINNER-01**: What's-for-dinner suggester (season + latest ratings; show rater avatar + stars + thought-bubble).
- **BULK-01**: Bulk import (multiple URLs, or a whole blog).
- **REC-01** (v2): Recommendations ("recipes others liked, similar to this") — content-based first, collaborative as ratings grow.
- **DISCOVER-01** (v2 / potential): Public cookbook discovery.

### Explicitly out of scope

| Feature | Reason |
|---------|--------|
| "I made this" log | Out of scope (recorded) |
| Activity feed | Out of scope (recorded) |
| Export / print | Out of scope (recorded) |
| Recipe requests | Out of scope (recorded) |
| Pantry / inventory | **Dropped** — "what can I make" is image-based (MAKE-01), not pantry-driven |
