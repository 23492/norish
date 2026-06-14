# Roadmap: norish (Kiran's fork)

## Overview

Fork upstream norish and evolve it in feature phases — native Camoufox scraping, multi-household cookbooks, per-cookbook permission policies, and AssemblyAI transcription — each shipped as a maintainable, re-baseable increment built on LXC 110 and deployed to the existing stack. Phase 0 (fork + gsd-core + build pipeline) is the foundation.

## Phases

- [x] **Phase 0: Fork & tooling setup** - Fork, gsd-core, dev env on LXC 110, stock self-build de-risk
- [x] **Phase 1: Native Camoufox scraping** - Replace headless Chrome with the Camoufox REST client in source
- [ ] **Phase 2: Multi-household cookbooks** - Multiple households per user + per-cookbook recipe scoping
- [ ] **Phase 3: Per-cookbook permission policies** - Each cookbook sets its own view/edit/delete; admin-edits-any/members-edit-own (POLICY-01) — code-complete 2026-06-14, human-verify pending
- [ ] **Phase 4: Recipe sharing** - Per-recipe visibility private/household/public on the existing recipe_shares; public = no-auth read-only view by share token (SHARE-01); recipe ratings show average+count + a per-user named-rater list on the authenticated detail view (RATE-01, public-view ratings deferred RATE-02) — code-complete 2026-06-14, human-verify pending
- [ ] **Phase 5: AssemblyAI transcription** - Native AssemblyAI provider for video imports (renumbered from Phase 4); 04-01 code-complete 2026-06-14, human-verify (real key + e2e) pending
- [ ] **Phase 6: DeepSeek V4 AI/LLM provider** - DeepSeek selectable for recipe-extraction with `deepseek-v4-pro` + `deepseek-v4-flash` (AI-01); provider already upstream, V4 model ids surfaced in the admin picker + unit-tested; 06-01 code-complete 2026-06-14, human-verify pending

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
**Plans**: 6 plans (4 planned 2026-06-12; 02-05 added 2026-06-13; 02-06 added 2026-06-13) — 6/6 code-complete (02-01, 02-02, 02-03 shipped 2026-06-13; 02-04 + 02-05 + 02-06 code-complete 2026-06-13, human-verify PENDING with the lead)

Canonical refs: `.planning/phases/02-multi-household/02-CONTEXT.md` (D-01..D-15)

Plans:
- [x] 02-01: Schema + migration (recipes.household_id, user.active_household_id; swap uq_recipes_url_user→(url,household_id); relation + recipe zod; generate 0035 migration) — wave 1 ✅ 2026-06-13
- [x] 02-02: Backend core (active-household resolver/setter + multi-membership; tRPC context/middleware; households list+switchActive; recipe scoping rewrite by household_id; import queue carries householdId; secondary-repo callers; + auto-create own household on signup) — wave 2 ✅ 2026-06-13
- [x] 02-03: Permissions + per-cookbook isolation tests (security-critical: canAccessResource by recipe household_id + member household ids; dedicated DB + tRPC isolation suites; HOUSE-06) — wave 3 ✅ 2026-06-13
- [~] 02-04: Frontend + i18n (cookbook switcher navbar+mobile with Personal option; list/active/switch hooks+context; assign-to-active import; nl+en real + all 11 locales for i18n:check) — wave 4 ⏳ code-complete 2026-06-13 (static verify green: typecheck x2, i18n:check, lint all exit 0); HUMAN-VERIFY (docker build + visual smoke) PENDING with the lead
- [~] 02-05: Multi-household UI completion (households.rename admin-only/optimistic mutation; create/join/rename on the global household context; reusable Create/Join cookbook modal opened from the navbar switcher; admin inline-rename in settings; createOrJoin+rename i18n in all 11 locales) — wave 5 ⏳ code-complete 2026-06-13 (static verify green: typecheck x5, i18n:check, web lint, household tests all exit 0); resolves CKBK-UI-01 + RENAME-01 + the HOUSE-02 UI gap; HUMAN-VERIFY (Chrome re-verify) PENDING with the lead
- [~] 02-06: Shareable invite link (INVITE-01) — households.invite_token + migration 0036; admin generate/regenerate; a PUBLIC name-only getByInviteToken; a joinByInviteToken mutation reusing the multi-membership path; an admin invite-link UI in settings + the public /join/[token] page (logged-out → login → return); i18n in all 11 locales. Same security model as the join code; registration-bypass DEFERRED to INVITE-02 — wave 6 ⏳ code-complete 2026-06-13 (static verify green: typecheck x5, i18n:check, web lint, household tests 7/7 + 26/26 + 6/6; PUBLIC endpoint name-only, adversarially verified); HUMAN-VERIFY (Chrome re-verify incl. migration-0036-at-boot) PENDING with the lead

### Phase 3: Per-cookbook permission policies
**Goal**: Each cookbook (household) carries its own view/edit/delete recipe policy; a cookbook admin can edit/delete any recipe in their cookbook while members manage their own — per-cookbook isolation (HOUSE-06) preserved.
**Depends on**: Phase 2 (the per-cookbook isolation boundary + canAccessResource signature)
**Requirements**: POLICY-01
**Success Criteria** (what must be TRUE):
  1. A cookbook admin sets that cookbook's view/edit/delete policy from Household settings; members do not see the card.
  2. edit/delete=household => the cookbook admin can edit/delete any recipe; a member can edit/delete only their own.
  3. A non-member never sees/edits/deletes another cookbook's recipes regardless of that cookbook's policy (HOUSE-06).
**Plans**: 1 plan (03-01) — code-complete 2026-06-14, human-verify (Chrome) pending with the lead

Canonical refs: `.planning/phases/03-per-cookbook-policies/03-CONTEXT.md`

Plans:
- [x] 03-01: Per-cookbook view/edit/delete policy (permission_level enum columns + migration 0037; canAccessResource per-cookbook + admin-or-owner; buildViewPolicyCondition source-swap; getHouseholdPolicy/setHouseholdPolicy + admin setPolicy mutation; admin-only Recipe Permissions card; i18n 11 locales; adversarial isolation + real-parse tests) — code-complete 2026-06-14 (static verify GREEN: typecheck x6, i18n:check, lint, auth 99 + trpc 88 + db households 18 + web hooks 26); HUMAN-VERIFY (Chrome + migration-0037-at-boot) PENDING with the lead

### Phase 4: Recipe sharing
**Goal**: A recipe carries an explicit visibility (private/household/public); a public recipe is viewable read-only, no-auth, by a long share token on the existing `/share/<token>` route, built ON the existing `recipe_shares` feature.
**Depends on**: Phase 2 (per-cookbook isolation, HOUSE-06) + Phase 3 (POLICY-01 assertRecipeAccess edit/view)
**Requirements**: SHARE-01, RATE-01
**Success Criteria** (what must be TRUE):
  1. A recipe can be set private / household / public; only `public` is reachable by the no-auth share route.
  2. A private/household recipe is NOT viewable via `/share/<token>` even with a valid token; a public recipe shows ONLY that one recipe (no other recipes/owner data/cookbook listing).
  3. An owner or cookbook admin (edit access) creates/revokes the share link + sets visibility from the recipe page; sharing never widens cross-cookbook access (HOUSE-06).
  4. The authenticated recipe detail view shows the recipe's average rating + count and a per-user "rated by <name> ★★★★" list; the rater list is only readable by a user who can view the recipe (a non-viewer gets FORBIDDEN, names never fetched). Public-view ratings deferred (RATE-02).
**Plans**: 2 plans (SHARE-01, RATE-01) — both code-complete 2026-06-14, human-verify (Chrome) pending with the lead

Plans:
- [x] SHARE-01: recipes.visibility enum + migration 0038; public-route visibility gate in sharedRecipeProcedure + a repo-level gate; create->public / revoke-last->private transitions; shareSetVisibility (assertRecipeAccess edit) + the recipe Share-panel control; 32-byte share token; i18n 11 locales; adversarial gate + real-parse + isolation tests — code-complete 2026-06-14 (static verify GREEN: typecheck x6, i18n:check, lint; trpc recipes+households 96, db recipe+share+isolation+zod 34, auth 99; both public gates adversarially RED-when-weakened then reverted; HOUSE-06 6/6 intact); HUMAN-VERIFY (Chrome + migration-0038-at-boot) PENDING with the lead
- [x] RATE-01: recipe average+count + per-user named-rater list on the AUTHENTICATED detail view, built ON the existing recipe_ratings feature (no schema change/migration). NEW: getRecipeRaters repo join (decrypted display names, null-safe) + RecipeRaters{,Schema} shared zod + a NEW ratings.getRaters authedProcedure gated on assertRecipeAccess(view) FIRST (non-viewer -> FORBIDDEN, names never fetched — HOUSE-06/POLICY-01) + a read-only RecipeRaters component ("You" + null-name fallback) in both detail pages + i18n 11 locales. Public-view ratings DEFERRED as RATE-02 (privacy). 3 (RATE-01) commits — code-complete 2026-06-14 (static verify GREEN: typecheck db/shared/auth/trpc/shared-react/web all EXIT 0, i18n:check EXIT 0, lint clean; trpc recipes+ratings+households 109/109 incl. raters 5/5, db households.isolation 6/6 + recipe 12/12 + recipe-shares 8/8; the access gate adversarially RED-when-weakened then reverted byte-identical, never committed); HUMAN-VERIFY (Chrome) PENDING with the lead

### Phase 5: AssemblyAI transcription
**Goal**: AssemblyAI is a native transcription provider; video imports transcribe through it.
**Depends on**: Phase 1 (build/deploy pipeline); independent of Phases 2-4
**Requirements**: VIDEO-01, VIDEO-02, VIDEO-03, VIDEO-04
**Success Criteria** (what must be TRUE):
  1. With an AssemblyAI key configured, a TikTok/Instagram video imports with transcription.
  2. Caption/description is still used; no boot-patch.
**Plans**: TBD (~2)


### Phase 6: DeepSeek V4 AI/LLM provider
**Goal**: DeepSeek is a selectable AI/LLM (recipe-extraction) provider, with the V4 models `deepseek-v4-pro` + `deepseek-v4-flash` selectable in the admin AI-config; key read at runtime from the admin secret (no env, no boot-patch).
**Depends on**: Phase 1 (build/deploy pipeline + cloud-keys-via-admin-UI principle); independent of Phases 2-5.
**Requirements**: AI-01
**Success Criteria** (what must be TRUE):
  1. The admin AI-config exposes DeepSeek with an API-key field (already true — wired from upstream).
  2. `deepseek-v4-pro` + `deepseek-v4-flash` are offered as selectable models in the admin model picker.
  3. Either V4 model builds a working AI-SDK model via the existing `case "deepseek"` reading the runtime key; no env, no boot-patch, no new dependency.
**Plans**: 1 plan (06-01) — code-complete 2026-06-14, human-verify (Chrome + real key extraction) pending with the lead

Canonical refs: `.planning/phases/06-deepseek-provider/06-01-PLAN.md` + `06-01-SUMMARY.md`

Plans:
- [x] 06-01: Surface deepseek-v4-pro + deepseek-v4-flash as selectable models (listing defaults merged with the live /models) + fetch-mocked unit tests for the deepseek listing + factory dispatch — code-complete 2026-06-14 (static verify GREEN: typecheck config/shared/shared-server/api/web, i18n:check, lint; @norish/shared-server 150/154 with +6 new, the 4 fails pre-existing archive; both server-config.ts twins still byte-identical, not edited); the DeepSeek provider itself (enum/factory/listing/connection-test/admin-UI/i18n/@ai-sdk dep) was ALREADY present from upstream. HUMAN-VERIFY (Chrome admin AI-config + real-key extraction) PENDING with the lead

Plans:
- [x] 04-01: AssemblyAI provider in the transcription enum + native transcribeWithAssemblyAI + config/key wiring (admin UI) + 11-locale i18n + unit test — code-complete 2026-06-14 (static verify GREEN: typecheck config/shared/api/web, i18n:check, lint, @norish/api 334/334 incl. 4 new; fetch-mocked, NO real API); HUMAN-VERIFY (real AssemblyAI key in norishp2 + a short-YouTube-clip e2e import) PENDING with the lead
- [ ] 04-02: TikTok/Instagram verification (folded into the 04-01 human-verify; same dispatch path — may need cookies for bot-walls)
