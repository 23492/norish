# Roadmap: norish (Kiran's fork)

## Overview

Fork upstream norish and evolve it in three feature phases — native Camoufox scraping, multi-household cookbooks, and AssemblyAI transcription — each shipped as a maintainable, re-baseable increment built on LXC 110 and deployed to the existing stack. Phase 0 (fork + gsd-core + build pipeline) is the foundation.

## Phases

- [x] **Phase 0: Fork & tooling setup** - Fork, gsd-core, dev env on LXC 110, stock self-build de-risk
- [ ] **Phase 1: Native Camoufox scraping** - Replace headless Chrome with the Camoufox REST client in source
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
- [ ] 00-02: Reproduce stock self-build + verify deploy on LXC 110

### Phase 1: Native Camoufox scraping
**Goal**: The browser fetch layer talks to the Camoufox REST service natively; chrome-headless removed.
**Depends on**: Phase 0
**Requirements**: SCRAPE-01, SCRAPE-02, SCRAPE-03, SCRAPE-04, SCRAPE-05, SCRAPE-06
**Success Criteria** (what must be TRUE):
  1. Recipe import of a bot-protected URL (ah.nl) succeeds with no chrome-headless service running.
  2. Cookie/header site-auth tokens are honored via Camoufox.
  3. The built image needs no boot-patch; if Camoufox is unreachable the import fails with a clear error, not a silent empty result.
**Plans**: TBD (~3)

Plans:
- [ ] 01-01: CAMOFOX_URL config + Camoufox REST client (packages/api/src/camofox.ts)
- [ ] 01-02: Rewrite parser/fetch.ts fetch path onto the client (tokens, waits, HTML); update 3 callers
- [ ] 01-03: Remove chrome-headless from compose/config; dependency cleanup; tests

### Phase 2: Multi-household cookbooks
**Goal**: Users belong to multiple households, switch the active cookbook, and recipes are scoped per cookbook with isolation.
**Depends on**: Phase 1
**Requirements**: HOUSE-01, HOUSE-02, HOUSE-03, HOUSE-04, HOUSE-05, HOUSE-06, HOUSE-07
**Success Criteria** (what must be TRUE):
  1. A user creates/joins two households + a personal cookbook and switches between them.
  2. Recipes show only for the active cookbook; another household's recipes are not visible (isolation).
  3. Import assigns the recipe to the active cookbook.
**Plans**: TBD (~4-5)

Plans:
- [ ] 02-01: Schema migration (recipes.household_id, user.active_household_id; drop single-household guard)
- [ ] 02-02: Backend — active-household at tRPC context; multi-membership repo; recipe scoping + secondary repos
- [ ] 02-03: Permissions — per-cookbook isolation (security-critical) + tests
- [ ] 02-04: Frontend — switcher, create/join/leave, assign-to-cookbook; i18n nl+en

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
