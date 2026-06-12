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

- [ ] **HOUSE-01**: A user can belong to multiple households simultaneously.
- [ ] **HOUSE-02**: A user can create, join (by code), and leave multiple households.
- [ ] **HOUSE-03**: A user can switch their active household/cookbook.
- [ ] **HOUSE-04**: Recipes are scoped to a household/cookbook (`recipes.household_id`); `null` = personal.
- [ ] **HOUSE-05**: A personal cookbook coexists with shared cookbooks for the same user.
- [ ] **HOUSE-06**: Per-cookbook isolation — members of one household cannot see another household's recipes (security-critical).
- [ ] **HOUSE-07**: Import/create assigns the recipe to the active cookbook (selectable).

### Video transcription (AssemblyAI) — Phase 3

- [ ] **VIDEO-01**: AssemblyAI is a selectable native transcription provider (config-driven key).
- [ ] **VIDEO-02**: TikTok & Instagram video imports work (caption + transcription).
- [ ] **VIDEO-03**: Video description/caption is used in extraction (already upstream — verify retained).
- [ ] **VIDEO-04**: No boot-time patch for transcription — ships in the built image.

### Setup / maintainability — Phase 0 / cross-cutting

- [ ] **SETUP-01**: Fork builds via `pnpm docker:build` on LXC 110 and deploys to the existing stack.
- [ ] **SETUP-02**: Diff vs upstream is minimal + isolated; upstream remote tracked.
- [ ] **SETUP-03**: No extra runtime setup vs off-the-shelf norish (config/env only).

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
| HOUSE-01..07 | Phase 2 | Pending |
| VIDEO-01..04 | Phase 3 | Pending |
| SETUP-01..03 | Phase 0 | In progress |

**Coverage:** v1 = 20 requirements, all mapped to phases.
