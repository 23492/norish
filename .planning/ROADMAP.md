# Roadmap: norish (Kiran's fork)

## Overview

Fork upstream norish and evolve it in feature phases — native Camoufox scraping, multi-household cookbooks, per-cookbook permission policies, and AssemblyAI transcription — each shipped as a maintainable, re-baseable increment built on LXC 110 and deployed to the existing stack. Phase 0 (fork + gsd-core + build pipeline) is the foundation.

## Phases

> **DEPLOYED 2026-06-26:** Phases 1–19 are LIVE — `main` (`690623377`) built to image `8f6d14ba902e` and swapped onto `norish-app` (tagged `norish:live`; old image preserved as `norish:rollback-20260625-pre`), container healthy, DB at migration 39 (no new migrations). The "human-verify (docker:build + redeploy)" half of each phase's gate below is therefore DONE; the **remaining** gate is the per-phase **Chrome e2e UAT** against live `https://norish.knoppsmart.com`. Details: STATE.md `## Session log` (2026-06-26) + vault `Norish push-to-live DEPLOYED (2026-06-26)`.

- [x] **Phase 0: Fork & tooling setup** - Fork, gsd-core, dev env on LXC 110, stock self-build de-risk
- [x] **Phase 1: Native Camoufox scraping** - Replace headless Chrome with the Camoufox REST client in source
- [ ] **Phase 2: Multi-household cookbooks** - Multiple households per user + per-cookbook recipe scoping
- [ ] **Phase 3: Per-cookbook permission policies** - Each cookbook sets its own view/edit/delete; admin-edits-any/members-edit-own (POLICY-01) — code-complete 2026-06-14, human-verify pending
- [ ] **Phase 4: Recipe sharing** - Per-recipe visibility private/household/public on the existing recipe_shares; public = no-auth read-only view by share token (SHARE-01); recipe ratings show average+count + a per-user named-rater list on the authenticated detail view (RATE-01, public-view ratings deferred RATE-02) — code-complete 2026-06-14, human-verify pending
- [ ] **Phase 5: AssemblyAI transcription** - Native AssemblyAI provider for video imports (renumbered from Phase 4); 04-01 code-complete 2026-06-14, human-verify (real key + e2e) pending
- [ ] **Phase 6: DeepSeek V4 AI/LLM provider** - DeepSeek selectable for recipe-extraction with `deepseek-v4-pro` + `deepseek-v4-flash` (AI-01); provider already upstream, V4 model ids surfaced in the admin picker + unit-tested; 06-01 code-complete 2026-06-14, human-verify pending
- [ ] **Phase 7: Locale-aware extraction** - AI recipe-extraction preserves the source content's language instead of defaulting to English (LOCALE-01); a language-preservation directive + the source/default locale threaded through all three extraction prompt builders; 07-01 code-complete 2026-06-14, human-verify pending
- [ ] **Phase 8: WorkOS AuthKit login provider** - WorkOS AuthKit added as an ADDITIONAL better-auth login provider via the genericOAuth plugin (explicit authorize URL + custom getToken/getUserInfo against the WorkOS authenticate endpoint), admin-configured Client ID + API Key at runtime; additive + reversible (existing email/password, Google, GitHub, OIDC untouched) (WORKOS-01); 08-01 code-complete 2026-06-14, human-verify (lead docker:build + Kiran WorkOS dashboard/keys) pending
- [ ] **Phase 9: WorkOS env config (config-as-code)** - WorkOS Client ID + API Key read from env (WORKOS_CLIENT_ID + WORKOS_API_KEY, seeding the DB at boot like OIDC/Google/GitHub; env takes precedence over a non-overridden row) instead of the admin UI, and the WorkOS card removed from the admin Auth Providers UI (WORKOS-ENV-01); 09-01 code-complete 2026-06-14, human-verify (lead docker:build + set WORKOS_CLIENT_ID in the live compose + redeploy; owner sets WORKOS_API_KEY) pending
- [ ] **Phase 10: WorkOS-only auth** - WorkOS becomes the SOLE sign-in/sign-up path: with password auth off + WorkOS the only provider, the unauthenticated login page auto-redirects straight to the WorkOS AuthKit hosted page (norish login UI never shown) and the norish-only email/password login + signup are gone; conditional + recoverable (a `?sso=0` escape and re-enabling password / unsetting WorkOS both restore the normal login page; no redirect loop) (WORKOS-ONLY-01); 10-01 code-complete 2026-06-14, human-verify (lead sets PASSWORD_AUTH_ENABLED=false + WorkOS env in the live compose + docker:build + Chrome e2e) pending
- [ ] **Phase 11: WorkOS OIDC fix** - Fix the broken WorkOS login by switching genericOAuth to standard OIDC via AuthKit discovery (WORKOS-OIDC-01); code-complete 2026-06-14, **superseded by Phase 12** (the OIDC-discovery surface was reverted there). Human-verify pending.
- [ ] **Phase 12: WorkOS AuthKit flow (Option A)** - The actual working WorkOS login: first-party AuthKit flow, reverting Phase 11's OIDC-discovery surface; code-complete 2026-06-14, human-verify (lead docker:build + WorkOS keys + Chrome e2e) pending
- [ ] **Phase 13: Mobile nav — hide name** - Avatar-only profile item in the mobile bottom-nav (drop the name label); code-complete 2026-06-14, human-verify pending
- [ ] **Phase 14: Operator config via env (R1)** - AI provider + transcription configured as config-as-code: `syncAIConfigFromEnv`/`syncVideoConfigFromEnv` re-seed the DB every boot, env wins, fixing env↔DB drift; code-complete 2026-06-15, human-verify pending
- [ ] **Phase 15: Single admin via env (R2)** - Operator/admin account configured from env (config-as-code), same env-wins re-seed pattern; code-complete 2026-06-15, human-verify pending
- [ ] **Phase 16: Rating undo** - Allow removing/undoing a recipe rating; code-complete 2026-06-15, human-verify pending
- [ ] **Phase 18: Open registration via env (R4)** - `registration_enabled` + `password_auth_enabled` as config-as-code (re-seeded every boot, env wins, survives a clean DB), removing the manual `UPDATE server_config` for the commercial WorkOS-only launch (OPEN-REGISTRATION-ENV-01); code-complete 2026-06-15, human-verify (lead sets the toggles in the live env + docker:build + redeploy) pending. *(Phase 17 number was skipped — never created.)*
- [x] **Phase 19: Ingredient unit normalization (update path)** - The recipe UPDATE path normalizes locale-specific unit terms to canonical IDs identically to the CREATE path (UNIT-NORM-01); **COMPLETE & verified green 2026-06-25** (db testcontainer suite 8/8 under `sg docker`, adversarially confirmed). First plan executed end-to-end through the cross-AI Antigravity/Gemini worker under native Opus review.
- [ ] **Phase 20: Incorporate upstream v0.19.0-beta** - Merge upstream's `v0.19.0-beta` (PR #468) into the fork on a dedicated integration branch (UPSTREAM-019-01). LARGE + high-overlap (~996 files, ~110 overlapping ours): re-assert the fork's hard constraints at each conflict (Camoufox-not-Chrome in `parser/fetch.ts`/no `playwright.ts`; per-cookbook isolation suites stay green; config-as-code env sync), and reconcile our `packages/db/src/schema` against upstream's NEW `packages/db-schema/` package split. Gate on the isolation + db testcontainer suites (`sg docker`) + `pnpm docker:build`. **Not started.** Full assessment: vault `norish-upstream-0.19.0-incorporation-assessment`. Sequence vs the Phase 2–18 live-integration (below) is TBD — likely integrate-and-deploy the existing fork work first, then rebase 0.19.0 onto it.

## Upstream tracking

- **Fork base:** `0.18.3-beta` (merge-base `6af3670a` with `upstream/main`). Our fork is **+156 commits** ahead.
- **Available upstream:** `upstream/main` shipped **`v0.19.0-beta`** (PR #468, commit `1f684480`) — a **large** release (~996 files, +29k/−18k) that **overlaps ~110 files we've forked**, including our core surface: the Camoufox parser (`packages/api/src/parser/fetch.ts`, the removed `playwright.ts`), `auth.ts`/`permissions.ts`/`claim-processor.ts`, `seed-config.ts`, and the household/ratings/recipe-page UI. It also introduces a NEW `packages/db-schema/` package (a schema split) that collides with our multi-household/shares/ratings schema. **Incorporation = a dedicated rebase/merge phase on its own integration branch, not a cherry-pick.** Scheduled as **Phase 20** (above). See the vault note `norish-upstream-0.19.0-incorporation-assessment`.

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

### Phase 8: WorkOS AuthKit login provider
**Goal**: WorkOS AuthKit is an ADDITIONAL login provider that better-auth consumes; better-auth stays the session/user/household core. Additive + reversible.
**Depends on**: Phase 0 (build/deploy pipeline + cloud-keys-via-admin-UI principle); independent of Phases 2-7.
**Requirements**: WORKOS-01
**Success Criteria** (what must be TRUE):
  1. WorkOS is a better-auth genericOAuth provider (providerId workos) reading Client ID + API Key from server-config at runtime (admin-configurable; NOT env, NOT hardcoded).
  2. An admin enters the WorkOS Client ID + API Key in the admin UI; a 'Continue with WorkOS' button shows on login ONLY when configured; the existing email/password, Google, GitHub, OIDC providers are untouched.
  3. A WorkOS-provisioned user gets their own cookbook (the provider-agnostic signup hook) and same-email users auto-link (workos in trustedProviders).
**Plans**: 1 plan (08-01) — code-complete 2026-06-14, human-verify (lead docker:build + Chrome; Kiran WorkOS dashboard + keys) pending

Canonical refs: `.planning/phases/08-workos-auth/08-01-PLAN.md` + `08-01-SUMMARY.md`

Plans:
- [x] 08-01: WorkOS AuthKit via better-auth genericOAuth (explicit authorize URL + custom getToken POST /user_management/authenticate + getUserInfo mapping the WorkOS user; auth_provider_workos server-config key on both zod twins; provider-cache + seed-config; admin tRPC updateWorkOS + the WorkOS accordion reusing the generic form; logos:workos-icon login button gated on clientId; i18n 11 locales; hermetic fetch-mocked unit test) — code-complete 2026-06-14 (static verify GREEN: typecheck config/shared/db/web/auth/trpc/shared-react/api EXIT 0, i18n:check EXIT 0, lint clean; @norish/auth 106/106 incl. 7 new, trpc 255, shared-react 27, web 379, config 726, shared 222; the two zod twins byte-identical; callback URI to register = ${AUTH_URL}/api/auth/oauth2/callback/workos); HUMAN-VERIFY (lead docker:build + recreate norishp2 + Chrome; Kiran WorkOS dashboard + paste Client ID/API Key + restart) PENDING

### Phase 9: WorkOS env config (config-as-code)
**Goal**: WorkOS is configured purely via env vars (WORKOS_CLIENT_ID + WORKOS_API_KEY) set in the backend/compose at deploy time, never via the admin UI; the WorkOS card is removed from the admin Auth Providers UI. Only the config SOURCE changes — the phase-08 genericOAuth WorkOS provider is unchanged.
**Depends on**: Phase 8 (the WorkOS genericOAuth provider + the auth_provider_workos server-config key/cache).
**Requirements**: WORKOS-ENV-01
**Success Criteria** (what must be TRUE):
  1. Setting WORKOS_CLIENT_ID + WORKOS_API_KEY fully configures the WorkOS provider with zero admin-UI interaction (env seeds/updates the auth_provider_workos DB row at boot, like OIDC/Google/GitHub; env takes precedence over a non-overridden row).
  2. The WorkOS card no longer appears in the admin Auth Providers UI; the google/github/oidc cards still work.
  3. The genericOAuth WorkOS provider logic (providerId workos, the user_management authenticate flow, authorizationUrlParams provider=authkit, custom getToken/getUserInfo) is unchanged.
**Plans**: 1 plan (09-01) — code-complete 2026-06-14, human-verify (lead docker:build + set WORKOS_CLIENT_ID + redeploy; owner sets WORKOS_API_KEY) pending

Canonical refs: `.planning/phases/09-workos-env-config/09-01-PLAN.md` + `09-01-SUMMARY.md`

Plans:
- [x] 09-01: WorkOS via env (config-as-code) — WORKOS_CLIENT_ID + WORKOS_API_KEY in ServerConfigSchema (env-config-server.ts) + a syncWorkOSProvider() in seed-config.ts mirroring syncGoogleProvider (env seeds the auth_provider_workos DB row at boot; env-over-DB precedence; WORKOS_API_KEY encrypted; also in hasOAuthEnvConfigured); the WorkOS admin-UI card removed from auth-providers-card.tsx; Option-5 env docs in .env.example + the example compose; env-sync unit tests (auth-provider-sync.test.ts WorkOS describe, +6) — code-complete 2026-06-14 (static verify GREEN: typecheck config/shared/db/auth/trpc/api/web EXIT 0, i18n:check EXIT 0, lint clean; @norish/api 348/348 incl. auth-provider-sync 22/22 with 6 new, @norish/auth 106/106 workos-provider UNCHANGED, @norish/web 379/379, @norish/trpc 255/255; the phase-08 genericOAuth provider/schema/cache/tRPC plumbing unchanged); 4 commits (bf6d57a7, e3d425a6, 2b10e323, 6693f7e1) on feat/workos-env-config, PUSHED; NO docker:build, NO merge to main, live untouched; HUMAN-VERIFY (lead docker:build + set WORKOS_CLIENT_ID in the live compose + redeploy + confirm the card is gone & the login button shows; owner sets WORKOS_API_KEY) PENDING

### Phase 10: WorkOS-only auth
**Goal**: WorkOS AuthKit is the SOLE sign-in/sign-up path — no norish email/password accounts, and the unauthenticated entry auto-redirects straight to the WorkOS hosted login (norish login UI never shown). Conditional + recoverable: never lock users out or loop.
**Depends on**: Phase 8 (the WorkOS genericOAuth provider) + Phase 9 (WorkOS via env).
**Success criteria**:
  1. With password auth off + WorkOS the only configured provider, `/login` auto-redirects to the WorkOS AuthKit page via `signIn.oauth2({providerId:'workos'})`; the norish login form/buttons are never shown; `/signup` redirects to `/login` (no norish-only signup).
  2. CONDITIONAL: the auto-redirect fires ONLY when exactly one OAuth provider is configured and no credential provider — re-enabling password auth OR unsetting WorkOS returns the normal login page (no lockout, no code deploy).
  3. NO redirect loop (proxy excludes /login, /signup, /auth-error, /api/auth; OAuth errors land on /auth-error with a back link) + an explicit `?sso=0` recovery escape (also a visible link on the redirect spinner) always shows the normal login page.
Mostly PRE-EXISTING in norish (the sole-OAuth-provider auto-redirect + the password-off signup gate already shipped); this phase made the decision a testable pure helper, added the `?sso=0` escape + the visible recovery link, and tested it. The FLIP itself is a config change: `PASSWORD_AUTH_ENABLED=false`.

Canonical refs: `.planning/phases/10-workos-only-auth/10-01-PLAN.md` + `10-01-SUMMARY.md`

Plans:
- [x] 10-01: WorkOS-only auth — NEW pure `shouldAutoRedirectToSso(providers, escapeRequested)` in packages/auth/src/providers.ts (sole OAuth provider + no credential + not escaped); login/page.tsx + signup/page.tsx wired to it with a `?sso=0` escape (forwarded through signup); a visible 'Use another sign-in method' -> /login?sso=0 link on the AutoSignIn spinner (login.useAnotherMethod in all 11 locales); redirect-condition unit test (sso-auto-redirect.test.ts, 8 tests) — code-complete 2026-06-14 (static verify GREEN: typecheck @norish/auth + @norish/web EXIT 0, i18n:check EXIT 0, lint clean on touched files; @norish/auth 114/114 incl. the 8 new + workos-provider 7/7 + password-auth 9/9 UNCHANGED; the genericOAuth provider + proxy matcher + better-auth callback unchanged); 3 commits (b1391406, 19875741, a3f2727e) on feat/workos-only-auth; NO docker:build, NO merge to main, live untouched; HUMAN-VERIFY (lead sets PASSWORD_AUTH_ENABLED=false + WorkOS env in the live compose + docker:build + Chrome e2e: logged-out lands on AuthKit, /login?sso=0 shows the normal page, recovery with password back on) PENDING

### Phase 20: Incorporate upstream v0.19.0-beta
**Goal**: Merge upstream `norish-recipes/norish` `v0.19.0-beta` (PR #468, squashed commit `1f684480`) into the fork on a dedicated integration branch off `main`, re-asserting every fork hard constraint at each conflict and deliberately adopting upstream's NEW `packages/db-schema/` split while preserving our multi-household/sharing/ratings schema. The fork stays buildable, isolation-safe, and deployable — off the live stack throughout.
**Depends on**: Phases 1–18 (the integrated fork on `main`, deployed as `norish:live`) + Phase 19. This rebases 0.19.0 ONTO the shipped fork, not the reverse.
**Requirements**: UPSTREAM-019
**Success Criteria** (what must be TRUE):
  1. `upstream/main`'s `v0.19.0-beta` is incorporated on a dedicated integration branch off `main` (a real merge/rebase, NOT a cherry-pick); `norish-app` stays on `norish:live` the whole time (no live mutation mid-phase).
  2. Every fork hard constraint survives: scraping stays native Camoufox (`packages/api/src/parser/fetch.ts` → `camofox.ts`; NO `playwright.ts` / `chrome-headless` reintroduced); per-cookbook isolation (HOUSE-06) suites stay green; config-as-code env sync (`seed-config.ts` — AI/video/WorkOS/admin/registration) preserved; WorkOS + multi-household + per-cookbook permissions (`auth.ts`/`permissions.ts`/`claim-processor.ts`) preserved.
  3. Our `packages/db/src/schema` (multi-household, `recipe_shares`, `recipe_ratings`, `visibility`, per-cookbook policy columns, migrations 0035–0038) is reconciled against upstream's new `packages/db-schema/` package — the split adopted and our tables re-ported, migrations intact and still applying cleanly at boot.
  4. HARD GATES pass on the integration branch: per-cookbook isolation + db/queue testcontainer suites under `sg docker`, full typecheck/lint/test green, then a director-owned `pnpm docker:build` succeeds. Only then is the branch a candidate for live cutover (a separate, deliberate step — not part of this phase).
**Plans**: TBD — generated by /gsd-plan-phase

Canonical refs: vault note `norish-upstream-0.19.0-incorporation-assessment`; ROADMAP "## Upstream tracking" section (above); `.planning/STATE.md` (2026-06-26 deploy state)

Plans:
- [ ] 20-01: TBD (planner to break down: merge mechanics, db-schema split reconciliation, hard-constraint re-assertion, isolation/build gates)
