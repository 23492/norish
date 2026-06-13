# Roadmap: norish (Kiran's fork)

## Overview

Fork upstream norish and evolve it in three feature phases — native Camoufox scraping, multi-household cookbooks, and AssemblyAI transcription — each shipped as a maintainable, re-baseable increment built on LXC 110 and deployed to the existing stack. Phase 0 (fork + gsd-core + build pipeline) is the foundation.

## Phases

- [x] **Phase 0: Fork & tooling setup** - Fork, gsd-core, dev env on LXC 110, stock self-build de-risk
- [x] **Phase 1: Native Camoufox scraping** - Replace headless Chrome with the Camoufox REST client in source
- [ ] **Phase 2: Multi-household cookbooks** - Multiple households per user + per-cookbook recipe scoping
- [ ] **Phase 3: AssemblyAI transcription** - Native AssemblyAI provider for video imports

## Phase Details

### Phase 0: Fork & tooling setup
**Goal**: A buildable, gsd-equipped fork on LXC 110 with a verified stock self-build.
**Depends on**: Nothing (first phase)
**Requirements**: SETUP-01, SETUP-02, SETUP-03
**Success Criteria** (what must be TRUE):
  1. Fork 23492/norish cloned on LXC 110 with upstream remote tracked.
  2. gsd-core (minimal) installed; CLAUDE.md + .planning/ in place.
  3. `pnpm docker:build` produces a working image; the stock image deploys to LXC 110 against the existing DB.
**Plans**: 2 plans

Plans:
- [x] 00-01: Fork + clone + Node/pnpm + gsd-core + .planning/ + CLAUDE.md
- [x] 00-02: Reproduce stock self-build + verify deploy on LXC 110

### Phase 1: Native Camoufox scraping
**Goal**: The browser fetch layer talks to the Camoufox REST service natively; chrome-headless removed.
**Depends on**: Phase 0
**Requirements**: SCRAPE-01, SCRAPE-02, SCRAPE-03, SCRAPE-04, SCRAPE-05, SCRAPE-06, SETUP-04
**Success Criteria** (what must be TRUE):
  1. Recipe import of a bot-protected URL (ah.nl) succeeds with no chrome-headless service running.
  2. Cookie/header site-auth tokens are honored via Camoufox.
  3. The built image needs no boot-patch; if Camoufox is unreachable the import fails with a clear error, not a silent empty result.
**Plans**: 3 plans

Plans:
- [x] 01-01: CAMOFOX_URL config + Camoufox REST client (packages/api/src/camofox.ts)
- [x] 01-02: Rewrite parser/fetch.ts fetch path onto the client (tokens, waits, HTML); update callers
- [x] 01-03: Remove chrome-headless from compose/config; bundle vendored camofox-browser v1.4.1; tests

### Phase 2: Multi-household cookbooks
**Goal**: Users belong to multiple households, switch the active cookbook, and recipes are scoped per cookbook with isolation.
**Depends on**: Phase 1
**Requirements**: HOUSE-01, HOUSE-02, HOUSE-03, HOUSE-04, HOUSE-05, HOUSE-06, HOUSE-07
**Success Criteria** (what must be TRUE):
  1. A user creates/joins two households + a personal cookbook and switches between them.
  2. Recipes show only for the active cookbook; another household's recipes are not visible (isolation).
  3. Import assigns the recipe to the active cookbook.
**Plans**: 5 plans (4 planned 2026-06-12; 02-05 added 2026-06-13) — 5/5 code-complete (02-01, 02-02, 02-03 shipped 2026-06-13; 02-04 + 02-05 code-complete 2026-06-13, human-verify PENDING with the lead)

Canonical refs: `.planning/phases/02-multi-household/02-CONTEXT.md` (D-01..D-15)

Plans:
- [x] 02-01: Schema + migration (recipes.household_id, user.active_household_id; swap uq_recipes_url_user→(url,household_id); relation + recipe zod; generate 0035 migration) — wave 1 ✅ 2026-06-13
- [x] 02-02: Backend core (active-household resolver/setter + multi-membership; tRPC context/middleware; households list+switchActive; recipe scoping rewrite by household_id; import queue carries householdId; secondary-repo callers; + auto-create own household on signup) — wave 2 ✅ 2026-06-13
- [x] 02-03: Permissions + per-cookbook isolation tests (security-critical: canAccessResource by recipe household_id + member household ids; dedicated DB + tRPC isolation suites; HOUSE-06) — wave 3 ✅ 2026-06-13
- [~] 02-04: Frontend + i18n (cookbook switcher navbar+mobile with Personal option; list/active/switch hooks+context; assign-to-active import; nl+en real + all 11 locales for i18n:check) — wave 4 ⏳ code-complete 2026-06-13 (static verify green: typecheck x2, i18n:check, lint all exit 0); HUMAN-VERIFY (docker build + visual smoke) PENDING with the lead
- [~] 02-05: Multi-household UI completion (households.rename admin-only/optimistic mutation; create/join/rename on the global household context; reusable Create/Join cookbook modal opened from the navbar switcher; admin inline-rename in settings; createOrJoin+rename i18n in all 11 locales) — wave 5 ⏳ code-complete 2026-06-13 (static verify green: typecheck x5, i18n:check, web lint, household tests all exit 0); resolves CKBK-UI-01 + RENAME-01 + the HOUSE-02 UI gap; HUMAN-VERIFY (Chrome re-verify) PENDING with the lead

### Phase 3: AssemblyAI transcription
**Goal**: AssemblyAI is a native transcription provider; video imports transcribe through it.
**Depends on**: Phase 1 (build/deploy pipeline); independent of Phase 2
**Requirements**: VIDEO-01, VIDEO-02, VIDEO-03, VIDEO-04
**Success Criteria** (what must be TRUE):
  1. With an AssemblyAI key configured, a TikTok/Instagram video imports with transcription.
  2. Caption/description is still used; no boot-patch.
**Plans**: TBD (~2)

Plans:
- [ ] 03-01: AssemblyAI provider in the transcription enum + native transcribeWithAssemblyAI
- [ ] 03-02: Config/key wiring + TikTok/Instagram verification
