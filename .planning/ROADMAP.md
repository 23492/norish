# Roadmap: norish (Kiran's fork)

## Overview

Fork upstream norish and evolve it in feature phases — native Camoufox scraping, multi-household cookbooks, per-cookbook permission policies, and AssemblyAI transcription — each shipped as a maintainable, re-baseable increment built on LXC 110 and deployed to the existing stack. Phase 0 (fork + gsd-core + build pipeline) is the foundation.

## Phases

> **DEPLOYED 2026-06-26:** Phases 1–19 are LIVE — `main` (`690623377`) built to image `8f6d14ba902e` and swapped onto `norish-app` (tagged `norish:live`; old image preserved as `norish:rollback-20260625-pre`), container healthy, DB at migration 39 (no new migrations). The "human-verify (docker:build + redeploy)" half of each phase's gate below is therefore DONE; the **remaining** gate is the per-phase **Chrome e2e UAT** against live `https://norish.knoppsmart.com`. Details: STATE.md `## Session log` (2026-06-26) + vault `Norish push-to-live DEPLOYED (2026-06-26)`.
>
> **DEPLOYED 2026-07-21:** Phase 20 (upstream `v0.19.0-beta` incorporation, PR #468) + Phase 20.1 (free-component HeroUI Pro replacement) are LIVE — `main` fast-forwarded to `edf16de2` (then `e10e77fa` for docs) built token-free and swapped onto `norish-app` (tagged `norish:live`, image `e96d46f5c084`; old image preserved as `norish:rollback-20260721-pre` = `8f6d14ba902e`), container healthy, 0 restarts, `/api/v1/health` → `{status:ok, db:ok}`, DB still at migration 39 (no new migrations). Live is now `0.19.0-beta` (was `0.18.3-beta`). As with the 2026-06-26 deploy, the "human-verify (docker:build + redeploy)" half of the gate is DONE for Phase 20/20.1; the **remaining** gate — the per-phase **Chrome e2e UAT** against live `https://norish.knoppsmart.com` — is still OUTSTANDING for the new v0.19.0 surface and the 20.1-swapped UI (Drawer/Carousel/DropZone), same as it remains outstanding for Phases 2–18.

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
- [x] **Phase 20: Incorporate upstream v0.19.0-beta** - Merge upstream's `v0.19.0-beta` (PR #468) into the fork on a dedicated integration branch (UPSTREAM-019-01). LARGE + high-overlap (~996 files, ~110 overlapping ours): re-assert the fork's hard constraints at each conflict (Camoufox-not-Chrome in `parser/fetch.ts`/no `playwright.ts`; per-cookbook isolation suites stay green; config-as-code env sync), and reconcile our `packages/db/src/schema` against upstream's NEW `packages/db-schema/` package split. Gate on the isolation + db testcontainer suites (`sg docker`) + `pnpm docker:build`. **COMPLETE:** merged on `integ/upstream-0.19.0`, built token-free, deployed to live 2026-07-21 — live now `0.19.0-beta`. Full assessment: vault `norish-upstream-0.19.0-incorporation-assessment`.
- [x] **Phase 20.1: Replace @heroui-pro/react with free components (INSERTED 2026-07-15)** - Unblock phase 20's `pnpm docker:build` gate WITHOUT buying the HeroUI Pro license (Kiran's decision 2026-07-15): replace all 6 pro usages (Segment→`ToggleButtonGroup`; Sheet→free `Drawer` in Panel.tsx; Carousel×3→local embla compound `apps/web/components/ui/carousel.tsx` from 21st.dev @shadcn/carousel; DropZone→react-aria-components DropZone+FileTrigger in `apps/web/components/ui/drop-zone.tsx`) with zero NEW npm deps, then purge the dep + `HEROUI_AUTH_TOKEN` plumbing from Dockerfile/CI. **COMPLETE & SHIPPED 2026-07-21:** `pnpm --filter @norish/web build` green token-free; `@heroui-pro/react` dependency and all `HEROUI_AUTH_TOKEN` plumbing (Dockerfile secret mount + 5 GitHub workflows) removed. 3 plans on `integ/upstream-0.19.0`. Vault: `norish-heroui-pro-replacement`.
- [ ] **Phase 21: UI polish & media-viewing UX (from the 2026-07-21 UAT)** - Subtractive polish pass — *"every pixel must earn its place; most should lose"* (Kiran, 2026-07-21). Two strands: **(a) MEDIA-UX-01 — media viewing is broken-by-design**: tapping a photo opens a lightbox that only ever receives `items.filter(type === "image")` (`media-carousel.tsx`), so a recipe with 1 photo + N videos yields a single-image lightbox with **no counter, no arrows, no thumbnails** — you lose the media set you were just swiping. Also: lightbox thumbnails render the **full-size original** into a 64px slot (`unoptimized` in `components/ui/carousel.tsx`), and Kiran reports the same image being fetched at several sizes (needs a network trace to confirm). **(b) Chrome reduction** — strip settings to essentials (it currently reads as self-hostable software, not a polished app), replace the wonky mobile-nav avatar, and rework the calendar into tappable rows of 7 that expand to a single day, hiding empty past days. Inputs: UAT sections A3 + D in vault `norish-uat-v0.19.0`. **Not started.**
- [ ] **Phase 22: Realtime fan-out isolation (BUG — cross-cookbook leak)** - The realtime layer does NOT honour the per-cookbook isolation the tRPC layer enforces. All 54 `emitByPolicy()` sites take a `viewPolicy`, and **34 of them read the SERVER-WIDE `getRecipePermissionPolicy()`** instead of the recipe's own cookbook policy. Live `server_config.recipe_permission_policy` is `{"view":"everyone",...}` (verified against the live DB 2026-07-21), so `emitByPolicy` takes its `case "everyone"` branch → `emitter.broadcast()` → **every connected client receives the full dashboard recipe DTO of every import, update, rating and share, regardless of cookbook**. This directly contradicts HOUSE-06, which Phase 3 adversarially proved on the REST/tRPC path only. Fix in code (resolve the policy from the recipe's OWN household, as `canAccessResource` already does) — NOT by flipping the live config, which would only mask it. **Sequenced first**: every later phase adds emit sites, and building on a leaky bus multiplies the fix. (REALTIME-ISO-01)
- [ ] **Phase 23: Cookbook context & moving recipes** - A recipe never shows which cookbook it lives in, and there is no way to move it. Show the owning cookbook on the recipe detail view; tapping it opens a move-to-cookbook action (respecting POLICY-01 edit rights on both source and destination); add a Cookbooks browser entry to the nav. Small, high-frequency, and it makes the multi-cookbook model from Phase 2 legible for the first time. Source: UAT section B3. (CKBK-MOVE-01)
- [ ] **Phase 24: Import at scale & visible progress** - Two halves of the same queue-UX story: **BULK-01** — accept many URLs (or a blog) in one submission, fanned out over the existing Camoufox import queue with per-item outcome reporting; **IMPORT-UX-01** — a real progress indicator for a running import, since import "can feel a bit slow at times" (UAT B2) and today the only feedback is a skeleton card. The progress surface rides the realtime bus, which is exactly why **Phase 22 must land first**. (BULK-01, IMPORT-UX-01)
- [ ] **Phase 25: Shopping list — aisle grouping** - Group the shopping list by aisle/category rather than a flat list (Tandoor model: food→category, store→ordered categories; seedable from `open-tandoor-data`). **Smaller than the vault note assumed**: norish already ships `stores` + `ingredient_store_preferences` (`normalized_name` → store, unique per user), which is the exact pattern an aisle mapping should extend rather than invent. Decoupled from any pantry (dropped). (SHOP-01)
- [ ] **Phase 26: What's-for-dinner suggester** - Suggest tonight's recipe from season + recent ratings, presented with the rater's avatar, stars and a thought-bubble. Builds entirely on the shipped `recipe_ratings` + tags surface — no new data source, no new provider. The cheapest "feels like a product" win on the list. (DINNER-01)
- [ ] **Phase 27: Cooklang migration (MAJOR, upstream-convergent)** - Migrate recipe step/ingredient representation to Cooklang, delivering the long-wanted **in-step ingredient quantities** and **multi-timer cooking mode**. Converges with upstream issue [#470](https://github.com/norish-recipes/norish/issues/470) (open, maintainer `mikevanes`, still an empty placeholder) — build it **contributable as the PR that closes #470**, which turns the fork from diverging into driving. Parser `@cooklang/cooklang` (MIT, WASM — NOT the archived `cooklang-ts`). Hard parts: no JS structured→`.cook` serializer exists (build + contribute one) so the AI/JSON-LD importer can emit Cooklang; dual metric/US units, nutrition and media need a home in Cooklang metadata. **Has an external blocking dependency** (design coordination with the maintainer) so it must not gate the phases above it. (COOK-01)
- [ ] **Phase 28: Cost-per-recipe badge (MAJOR)** - € / €€ / €€€ per serving. Daily `supermarkt/checkjebon` (MIT, 12 NL chains) pull → Postgres price index; the existing Camoufox AH scraper as cache-miss enrichment; LLM ingredient→product parse (strong for Dutch) + fuzzy match; computed async, badged on the recipe card. Legal: prices aren't personal data and homelab use is fine, but **do not redistribute** scraped AH data — lean on checkjebon (MIT) and Open Prices (ODbL). (COST-01)
- [ ] **Phase 29: "What can I make now?" (MAJOR)** - Photograph what's on the counter → AI vision recognises ingredients → suggest makeable recipes and what's missing. Explicitly **image-based, no pantry/inventory** (pantry was dropped as a concept). Uses the existing AI provider's vision path. Per Kiran, the competitive research (incl. Albert Heijn's GenAI direction) is deliberately **deferred to build time** rather than done now. (MAKE-01)
- [ ] **Phase 30: Shared-recipe versions & lineage (MAJOR)** - Saving a shared recipe creates a **version in a shared lineage bucket** rather than an unrelated copy; users explore the versions others made; reviews aggregate across the lineage but stay attributed to the version they were left on. **Now unblocked** — SHARE-02 (save-to-account) shipped 2026-07-21. Phase 2's recipe↔cookbook model stays forward-compatible via a `lineage_id`/`parent_recipe_id`. (VERSION-01)

## Upstream tracking

- **Fork base:** `0.18.3-beta` (merge-base `6af3670a` with `upstream/main`). Our fork is **+156 commits** ahead.
- **Incorporated:** `upstream/main`'s **`v0.19.0-beta`** (PR #468, commit `1f684480`) — a **large** release (~996 files, +29k/−18k) that overlapped ~110 files we'd forked, including our core surface: the Camoufox parser (`packages/api/src/parser/fetch.ts`, the removed `playwright.ts`), `auth.ts`/`permissions.ts`/`claim-processor.ts`, `seed-config.ts`, and the household/ratings/recipe-page UI, plus a NEW `packages/db-schema/` package (a schema split) reconciled against our multi-household/shares/ratings schema — was merged on the dedicated `integ/upstream-0.19.0` integration branch (**Phase 20**, above), built token-free after the Phase 20.1 HeroUI Pro swap, and **deployed to live 2026-07-21**. `main` is now at `edf16de2`/`e10e77fa`; live is `0.19.0-beta` (was `0.18.3-beta`). Remaining gate: the per-phase Chrome e2e UAT against live for the new v0.19.0 + 20.1 surface. See the vault note `norish-upstream-0.19.0-incorporation-assessment`.
- **Also incorporated:** `upstream/rc/0.20.0-beta` (commit `5ebd0cf0 Fix mobile compile`) — mobile-only: apps/mobile package updates, expo-widgets patch removed, pnpm-workspace changes. Merged on `integ/upstream-0.20.0-beta` (ff to main commit `64d7e4c3`, pushed to origin 2026-07-21). pnpm-lock.yaml conflict resolved: accepted upstream mobile changes + regenerated via `pnpm install --no-frozen-lockfile`. Web typecheck EXIT 0. main is now at `64d7e4c3`; live still runs `0.19.0-beta` image (no rebuild needed — mobile-only change).

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
**Plans**: 6 plans (waves 1–6, strict serial order per D-03; use_worktrees:false — one plan at a time)

Canonical refs: vault note `norish-upstream-0.19.0-incorporation-assessment`; ROADMAP "## Upstream tracking" section (above); `.planning/STATE.md` (2026-06-26 deploy state)

Plans:
- [ ] 20-01-PLAN.md — Branch + merge + db-schema split: tag main, branch integ/upstream-0.19.0, `git merge upstream/main`, `git rm` reintroduced playwright.ts, create @norish/db-schema + re-port fork tables (per-table 3-way), db testcontainer + HOUSE-06 isolation green (adversarial). (wave 1)
- [ ] 20-02-PLAN.md — api/parser conflict resolution: Camoufox re-assertion + AI/video locale threading on upstream's moved server-config-loader import; @norish/api typecheck+test. (wave 2)
- [ ] 20-03-PLAN.md — auth/permissions/trpc resolution: verify auto-merged auth core + resolve 13 trpc/shared-react/shared/shared-server conflicts; auth+trpc green under sg docker; tRPC-layer adversarial isolation check. (wave 3)
- [ ] 20-04-PLAN.md — web UI resolution: 15 web + star-rating conflicts onto HeroUI v3 keeping ratings/sharing/cookbook/WorkOS/AssemblyAI/timer-dock UI; @norish/web typecheck+test. (wave 4)
- [ ] 20-05-PLAN.md — CI/tooling + module-boundary import fixups + lockfile finalize + full-monorepo typecheck/lint/test green (db/queue/trpc under sg docker); build-candidate gate. (wave 5)
- [ ] 20-06-PLAN.md — norish-beta provisioning (config artifacts: isolated compose stack, beta env template, guarded DB clone/refresh script, runbook) + blocking operator checkpoint for build/deploy/DNS/WorkOS/Cloudflare (autonomous:false; live untouched). (wave 6)

### Phase 20.1: Replace @heroui-pro/react with free components (inserted 2026-07-15)
**Goal**: The fork builds and ships upstream 0.19.0's UI with ZERO paid dependencies: every `@heroui-pro/react` usage replaced by a free, already-installed equivalent (free `@heroui/react` v3, `react-aria-components`, `embla-carousel-react`), and the `HEROUI_AUTH_TOKEN` secret plumbing removed from Dockerfile + CI. Resolves the phase-20 build blocker (STATE.md 2026-06-28) per Kiran's decision NOT to buy the HeroUI Pro license.
**Depends on**: Phase 20 waves 1–5 (the integration branch `integ/upstream-0.19.0` with the HeroUI v3 web UI). Blocks the 20-06 operator deploy (which needs a buildable image).
**Requirements**: UPSTREAM-019 (deployability)
**Success Criteria** (what must be TRUE):
  1. `grep -rn "heroui-pro\|HEROUI_AUTH_TOKEN"` over apps/packages/docker/.github (excl. node_modules/.planning) returns zero hits; `@heroui-pro/react` gone from package.json + lockfile.
  2. Replacements are behaviorally equivalent: dashboard grid/list toggle (free ToggleButtonGroup — DONE 2026-07-15), all 13 Panel bottom-sheet consumers on free Drawer (incl. nested), media-carousel/image-lightbox/step-images on a local embla Carousel compound (dots, thumbnails, loop, selectedIndex), import-from-image dropzone on react-aria-components DropZone+FileTrigger (drag-drop + picker).
  3. Zero NEW npm dependencies added (21st.dev used as code reference only: @shadcn/carousel id 813 MIT as the carousel base).
  4. GATE: `pnpm --filter @norish/web build` (the exact blocked Next.js build) EXIT 0 with no token; full-monorepo typecheck/lint/test green (sg docker); then the director-owned `pnpm docker:build` succeeds secret-free.
**Plans**: 3 plans, serial (20.1-01 free swaps Segment/Sheet/DropZone; 20.1-02 local embla carousel + 3 call sites; 20.1-03 dep/CSS/CI purge + build gate + director checkpoint)

Canonical refs: `.planning/phases/20.1-replace-heroui-pro/` (CONTEXT + RESEARCH incl. the retrieved 21st.dev sources + API mappings); vault note `norish-heroui-pro-replacement`

Plans:
- [ ] 20.1-01-PLAN.md — Free-sibling swaps: Segment→ToggleButtonGroup (applied in working tree, verify+commit), Panel.tsx Sheet→free Drawer (13 consumers untouched), pro DropZone→react-aria-components DropZone/FileTrigger wrapper; web typecheck+test. (wave 1)
- [ ] 20.1-02-PLAN.md — Local `components/ui/carousel.tsx` on embla (21st.dev @shadcn/carousel base + Dots/Thumbnails/selectedIndex/--carousel-gap extensions) + migrate media-carousel/image-lightbox/step-images. (wave 2)
- [ ] 20.1-03-PLAN.md — Purge dep + globals.css import + vitest stub + Dockerfile/CI HEROUI_AUTH_TOKEN; `pnpm --filter @norish/web build` token-free gate + full-monorepo green; director docker:build + visual-parity checkpoint. (wave 3)

### Phase 21: UI polish & media-viewing UX (from the 2026-07-21 UAT)
**Goal**: The app reads as a polished product rather than self-hostable software, and viewing a recipe's media behaves the way a user expects. Guiding principle (Kiran, 2026-07-21): *"every pixel must earn its place; most should lose"* — this phase is primarily SUBTRACTIVE; new components only where something is actively broken.
**Depends on**: Phase 20.1 (the free-component UI baseline) + the 2026-07-21 live deploy. Section D of the UAT is the evidence base.
**Requirements**: MEDIA-UX-01 (new), plus UI-POLISH-01 (new, chrome reduction)
**Success Criteria** (what must be TRUE):
  1. **MEDIA-UX-01** — opening any media item keeps you in the same media set: the lightbox no longer silently drops videos via `items.filter(type === "image")` in `media-carousel.tsx`, so a recipe with 1 photo + N videos still shows a position counter, prev/next, and the thumbnail strip. Navigating in the lightbox and returning keeps the carousel on the same item.
  2. **No wasteful image fetches** — lightbox/carousel thumbnails no longer download the full-size original into a 64px slot (`unoptimized` + `sizes="64px"` in `components/ui/carousel.tsx`); confirm against a browser network trace that a given image is fetched once per needed size, not repeatedly.
  3. **Settings reduced** — the settings surface shows only what a normal user needs; operator/self-host concerns are hidden or removed. Anything cut can be restored if it turns out to be needed (Kiran: "if we miss any, we can bring them back").
  4. **Mobile nav** — the profile avatar in the mobile bottom nav is replaced with a clean, consistent element.
  5. **Calendar** — renders as tappable rows of 7 that expand into a single day on tap; empty past days are not shown.
  6. No functional regressions: `@norish/web` typecheck + the 410-test suite stay green, and `pnpm --filter @norish/web build` stays EXIT 0.
**Open question**: A1 from the UAT (dashboard grid/list toggle — "animation only works for the first item") is unreproduced; the free `ToggleButtonGroup` CSS has no sliding indicator or selected-state transition, so this needs a screen recording before any change is made. Do NOT blind-patch a working control.
**Plans**: not yet planned — scope from UAT section D before writing plans.

Canonical refs: vault `norish-uat-v0.19.0` (Kiran's filled-in UAT worksheet incl. screenshots); vault `norish-product-roadmap` (the broader unbuilt backlog)

---

## Sequencing rationale (Phases 22–30, drafted 2026-07-21)

The product backlog had been living in the vault (`norish-product-roadmap`) and in the REQUIREMENTS "Backlog / future phases" section, but never as *sequenced phases* — which is why seven researched features stayed invisible to the build. This block merges them in. The ordering follows four rules:

1. **Correctness before features.** Phase 22 is a live cross-cookbook leak in the realtime layer. Every phase below it adds `emitByPolicy` sites, so fixing it first is strictly cheaper than fixing it later.
2. **Cheap legibility before expensive capability.** Phases 23–26 are all small-to-medium, use only shipped primitives (households, the import queue, `stores`, `recipe_ratings`), and each removes a "this doesn't feel finished" complaint. They should land before any MAJOR phase starts.
3. **MAJOR phases are sequenced, not parallelised.** 27–30 each carry a real research or external dependency. They are listed in the order that maximises what the *previous* one unlocks, not in order of excitement.
4. **Nothing with an unresolved product decision is scheduled.** INVITE-02 and RATE-02 are decisions for Kiran, not phases; they stay in the backlog until decided. (SHOP-02 was on this list and was **decided on 2026-07-21** — see below — which is what made Phase 25 plannable.)

**Not scheduled — open decisions for Kiran:**
- **INVITE-02** — should an invite link let a new user sign up while `registration_enabled` is off? (A deliberate registration bypass; security-shaped, so it wants an explicit yes.)
- **RATE-02** — should rater *names* show on the no-auth public share view? RATE-01 deliberately kept ratings authenticated-only because exposing cookbook members' names to anonymous visitors is a privacy call.
- ~~SHOP-02~~ — **DECIDED 2026-07-21 (Kiran): "Only a household should share a shopping list."** No longer an open decision; promoted into Phase 25 as a requirement. `groceries`/`stores` re-key onto `household_id`, and SHOP-01's aisle mapping keys the same way, so both land in one migration.

### Phase 22: Realtime fan-out isolation
**Goal**: Realtime events obey the same per-cookbook boundary (HOUSE-06) that the tRPC layer already enforces, so no client is ever pushed a recipe it could not have fetched.
**Depends on**: Phase 3 (POLICY-01 — the per-cookbook policy resolution and `canAccessResource` precedent) + Phase 20 (the current merged surface).
**Requirements**: REALTIME-ISO-01 (new)
**Evidence** (measured 2026-07-21, not assumed):
  - `packages/shared-server/src/realtime/policy.ts` — `emitByPolicy` maps `view: "everyone"` to `emitter.broadcast(event, data)`, i.e. every connected socket.
  - 54 `emitByPolicy(` call sites across `packages/queue/src` (7 workers, 38 sites) and `packages/trpc/src` (4 files, 16 sites); **34** resolve their policy from the server-wide `getRecipePermissionPolicy()`.
  - Live `server_config.recipe_permission_policy` = `{"edit":"household","view":"everyone","delete":"household"}` — so the broadcast branch is the *active* branch in production today.
  - Payloads are not identifiers only: `emitByPolicy(..., "imported", { recipe: dashboardDto, ... })` ships the full dashboard DTO.
**Success Criteria** (what must be TRUE):
  1. No recipe-bearing realtime event reaches a client outside that recipe's own cookbook, **regardless of the server-wide default policy** — i.e. the live config can stay `view: "everyone"` and the leak is still closed. The fix is in code; flipping config would only mask it.
  2. Every one of the 34 server-wide-policy emit sites resolves the effective policy from the recipe's **own** household (mirroring `getHouseholdPolicy` / `canAccessResource`), or degrades to household-scoped emission.
  3. An adversarial realtime isolation suite (two households, two subscribed clients) proves member B never receives A's `importStarted` / `imported` / recipe-updated / rated / shared events — and the suite goes **RED when the fix is reverted**, verified before it is trusted.
  4. The meaning of `view: "everyone"` for the *realtime* path is decided and documented — either it is honoured only for a genuinely public surface, or it no longer implies socket broadcast at all. Phase 3 already disallows per-cookbook `view = everyone`; this closes the matching hole one layer down.
  5. Existing `@norish/queue` + `@norish/trpc` suites stay green under `sg docker`; no live operator action required to deploy the fix.
**Plans**: 3 (serial — the failing test must exist before any production change)

Canonical refs: `packages/shared-server/src/realtime/policy.ts`; `packages/auth/src/permissions.ts` (`getRecipePermissionPolicy`); `packages/db/src/repositories/households.ts:660` (`getHouseholdPolicy`); Phase 3 `03-CONTEXT.md`

Plans:
- [ ] 22-01: Audit + adversarial harness — enumerate all 54 emit sites into a table (file, event, payload, policy source), build the two-household two-socket integration harness, and land a **failing** test that proves the leak. No production change in this plan.
- [ ] 22-02: Queue workers — resolve the effective policy per recipe/household at emit time across the 7 workers (recipe-import, paste-import, image-import, auto-tagging, auto-categorization, allergy-detection, nutrition-estimation); harness goes green for the queue path.
- [ ] 22-03: tRPC routers (recipes, shares, ratings, helpers) + the `everyone` semantics decision + docs; full-monorepo typecheck/lint/test green under `sg docker`; revert-check confirms the suite goes RED.

### Phase 23: Cookbook context & moving recipes
**Goal**: A recipe visibly belongs to a cookbook, and can be moved to another one the user may write to. The multi-cookbook model shipped in Phase 2 becomes legible in the UI instead of being an invisible scoping rule.
**Depends on**: Phase 2 (multi-household membership + active-cookbook context) + Phase 3 (POLICY-01 edit rights).
**Requirements**: CKBK-MOVE-01 (new)
**Success Criteria** (what must be TRUE):
  1. The recipe detail view (desktop + mobile) shows which cookbook the recipe lives in.
  2. Tapping it offers a move action listing only cookbooks the user may **write** to; moving requires edit rights on the **source** (POLICY-01) and membership of the **destination**. A move never widens access (HOUSE-06) and never orphans the recipe.
  3. A Cookbooks entry in the nav browses the user's cookbooks and their contents — the "menu option that says cookbooks" from UAT B3.
  4. Moving a recipe updates every scoped surface it appears on (dashboard, search, meal plan, shopping-list linkage) without a manual refresh — and, post-Phase-22, without notifying the cookbook it left or a cookbook it never entered.
  5. i18n in all 11 locales; `@norish/web` + `@norish/trpc` suites green.
**Open question**: what happens to a moved recipe's existing ratings and share links — do they travel with it, or reset? Ratings are per-user and cookbook-scoped for *visibility*, so a move can silently expose or hide who rated what. Decide before planning.
**Plans**: TBD (~2) — scope after the open question is settled.

Canonical refs: vault `norish-uat-v0.19.0` section B3; `.planning/phases/02-multi-household/02-CONTEXT.md`; `.planning/phases/03-per-cookbook-policies/03-CONTEXT.md`

### Phase 24: Import at scale & visible progress
**Goal**: Importing more than one recipe is a first-class action, and any running import reports honest progress instead of an indefinite skeleton.
**Depends on**: **Phase 22** (hard — the progress surface rides the realtime bus; building it on a broadcasting bus would leak one user's import progress to everyone) + Phase 1 (Camoufox scraping) + the existing BullMQ import queue.
**Requirements**: BULK-01, IMPORT-UX-01 (new)
**Success Criteria** (what must be TRUE):
  1. A user submits many URLs (or one blog/index URL) in a single action; each becomes an independent queue job against the active cookbook, and partial failure is normal — the user sees per-item outcome (imported / duplicate / failed + why), not one aggregate error.
  2. A running import shows real progress derived from actual job state (fetch → parse → enrich), not a synthetic timer. Where a stage's duration genuinely is unknown, the UI says so rather than faking a bar.
  3. Bulk import respects the same limits and safety as single import: Camoufox stays the only fetch path (no headless Chrome), duplicate detection still applies per cookbook, and a bulk run cannot starve the queue for other users.
  4. Progress events are cookbook-scoped (inherits Phase 22) — one household's import never appears in another's UI.
  5. i18n in all 11 locales; `@norish/queue` suites green under `sg docker`.
**Open question**: what is a sane cap on a single bulk submission, and does a whole-blog crawl need explicit per-domain rate limiting before it points Camoufox at someone's site? Decide before planning.
**Plans**: TBD (~3)

Canonical refs: vault `norish-uat-v0.19.0` section B2; `packages/queue/src/recipe-import/`; `.planning/phases/01-camofox/`

### Phase 25: Shopping list — aisle grouping
**Goal**: The shopping list is ordered the way a shop is walked — grouped by aisle/category — instead of by insertion order.
**Depends on**: Phase 0 (the shipped grocery/store surface). Independent of Phases 22–24.
**Requirements**: SHOP-01, SHOP-02
**Success Criteria** (what must be TRUE):
  1. Every grocery item resolves to a category; the list renders grouped by category in a user-orderable sequence, with uncategorised items in a clearly-labelled bucket rather than hidden.
  2. Categorisation extends the **existing** `ingredient_store_preferences` pattern (`normalized_name` → target, unique per user) rather than inventing a parallel mapping; a user correction sticks for future lists.
  3. A seed mapping (from `open-tandoor-data`, or equivalent) covers common Dutch and English ingredients out of the box, so a new user gets useful grouping with zero configuration — consistent with the "users do zero config" constraint.
  4. Explicitly **decoupled from any pantry/inventory** (dropped as a concept) — no on-hand subtraction.
  5. **SHOP-02** — the list is HOUSEHOLD-scoped: members of a shared cookbook see and edit one list. Migration assigns each existing user's groceries/stores to their own household with no data loss and no cross-household merge of pre-existing items; a member never sees a list for a household they aren't in (HOUSE-06).
  6. `@norish/db` + `@norish/trpc` suites green; i18n in all 11 locales.
**Note on sizing** (measured 2026-07-21): the vault framed this as a MAJOR phase. It is not. `packages/db-schema/src/schema/stores.ts` already ships `stores` (user-scoped, ordered via `sort_order`) *and* `ingredient_store_preferences` mapping a normalized ingredient name to a store, unique per `(user_id, normalized_name)`. Aisle grouping is the same shape one level down, so the pattern, the repo helpers and the UI affordance all already exist.
**Decision recorded 2026-07-21 (Kiran)**: *"Only a household should share a shopping list."* This settles the data model — the previously-blocking SHOP-02 question is answered, and the aisle mapping keys on `household_id` alongside the re-keyed `groceries`/`stores`. One migration, not two. Phase 25 is now plannable.
**Plans**: TBD (~2) — writable now that SHOP-02 is decided.

Canonical refs: `packages/db-schema/src/schema/{groceries,stores}.ts`; https://github.com/TandoorRecipes/open-tandoor-data

### Phase 26: What's-for-dinner suggester
**Goal**: The app answers "what should we eat tonight?" from what the household already rated and what's in season — the cheapest phase on this list that makes it feel like a product rather than a database.
**Depends on**: Phase 4 (RATE-01 — ratings, averages and the named-rater list) + Phase 2 (cookbook scoping). Independent of Phases 22–25, though it inherits Phase 22's correctness if sequenced after it.
**Requirements**: DINNER-01
**Success Criteria** (what must be TRUE):
  1. A suggestion surface proposes recipes from the active cookbook using recency of rating + rating value + season, and explains *why* each was suggested rather than presenting an oracle.
  2. Each suggestion shows the rater's avatar, their stars, and a thought-bubble treatment — the presentation Kiran specified, not a generic list row.
  3. Dietary/allergy tags already on the household are respected: a suggestion never surfaces something a member is tagged allergic to.
  4. Suggestions are cookbook-scoped and never reveal ratings from a cookbook the viewer isn't in (HOUSE-06 / the RATE-01 access gate).
  5. No new provider, no new external data source, no new npm dependency — season is derivable from the date, everything else is already in the schema.
**Plans**: TBD (~2)

### Phase 27: Cooklang migration (MAJOR)
**Goal**: Recipes are represented in Cooklang, delivering in-step ingredient quantities and named concurrent timers (pasta + sauce), built so the work is contributable upstream as the PR that closes issue #470.
**Depends on**: Phases 22–26 landed (this is the largest lift on the roadmap and should not run against a moving UI). **Externally blocked** on design coordination with upstream maintainer `mikevanes` — #470 is still an empty placeholder, so there is no spec to build against yet.
**Requirements**: COOK-01
**Success Criteria** (draft — to be firmed once the upstream design is agreed):
  1. Recipe steps carry inline ingredient quantities and named timers, parsed via `@cooklang/cooklang` (MIT, WASM — explicitly **not** the archived `cooklang-ts`).
  2. A structured→`.cook` serializer exists (none does in JS today) so the AI/JSON-LD importer can emit Cooklang; it is written to be contributed, not fork-local.
  3. norish's dual metric/US units, nutrition data and media survive the round trip via Cooklang metadata/extensions — no data loss on import→edit→export.
  4. A cooking mode drives multiple named timers concurrently from the parsed steps.
  5. Migration is reversible: existing recipes convert without loss, and the change is shaped as an upstream-mergeable increment rather than fork divergence.
**Plans**: TBD — **do not plan until the upstream design conversation has happened.** Writing plans against an empty placeholder issue would guarantee rework.

### Phase 28: Cost-per-recipe badge (MAJOR)
**Goal**: Each recipe carries a € / €€ / €€€ per-serving cost badge, computed asynchronously from a real Dutch price index.
**Depends on**: Phase 1 (Camoufox, reused as cache-miss enrichment) + a decided AI provider (ingredient parsing). Independent of Phase 27.
**Requirements**: COST-01
**Success Criteria** (draft):
  1. A daily `supermarkt/checkjebon` (MIT, 12 NL chains) pull populates a Postgres price index; a cache miss falls through to the existing Camoufox AH scrape.
  2. Ingredient→product matching uses an LLM parse (strong for Dutch) plus fuzzy matching, normalised per serving and bucketed into three tiers.
  3. Cost is computed **async** and never blocks import or page render; a recipe without a confident match shows no badge rather than a wrong one.
  4. **Legal constraint honoured**: scraped AH data is never redistributed. Attribution and redistribution rest on checkjebon (MIT) and Open Prices (ODbL).
**Plans**: TBD (~3)

### Phase 29: "What can I make now?" (MAJOR)
**Goal**: Photograph what's on the counter and get recipes you can actually make, plus what you'd still need.
**Depends on**: a vision-capable AI provider (the existing provider abstraction) + Phase 25 (category/ingredient normalisation makes matching tractable).
**Requirements**: MAKE-01
**Success Criteria** (draft):
  1. An image (optionally plus free text) yields recognised ingredients the user can correct before matching — the recognition is a proposal, not a verdict.
  2. Matching returns makeable recipes from the active cookbook and, for near-misses, exactly what is missing.
  3. **No pantry/inventory is created or stored** — recognition is on-the-fly. (Pantry was deliberately dropped.)
  4. Uses the existing AI provider path; no second provider integration.
**Research**: deliberately **deferred to build time** per Kiran — survey existing image→recipe implementations and the Albert Heijn GenAI capabilities when the phase starts, not now.
**Plans**: TBD

### Phase 30: Shared-recipe versions & lineage (MAJOR)
**Goal**: A saved shared recipe becomes a version in a shared lineage rather than a disconnected copy, so people can see how a recipe evolved across households.
**Depends on**: Phase 4 (SHARE-01 visibility + RATE-01 ratings) and **SHARE-02, which shipped 2026-07-21** — this is no longer blocked. Sequenced last because it is the deepest schema change on the list.
**Requirements**: VERSION-01
**Success Criteria** (draft):
  1. Saving a shared recipe records a `lineage_id`/`parent_recipe_id` link instead of an orphaned copy; Phase 2's recipe↔cookbook model is already forward-compatible with this.
  2. A lineage view shows the versions others created, with names visible.
  3. Reviews aggregate across the lineage but stay **attributed to the version** they were left on — an aggregate must never silently reassign a rating to a different version.
  4. Lineage never widens access: seeing that a version exists must not expose a recipe in a cookbook you cannot view (HOUSE-06).
**Plans**: TBD
