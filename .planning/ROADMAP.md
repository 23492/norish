# Roadmap: norish (Kiran's fork)

## Overview

Fork upstream norish and evolve it in feature phases — native Camoufox scraping, multi-household cookbooks, per-cookbook permission policies, and AssemblyAI transcription — each shipped as a maintainable, re-baseable increment built on LXC 110 and deployed to the existing stack. Phase 0 (fork + gsd-core + build pipeline) is the foundation.

## Phases

> **Marker legend** (added 2026-07-28 — `[ ]` had come to mean three different things):
> - `[x]` — shipped **and** deployed to live, nothing outstanding.
> - `[~]` — **code-complete and deployed, but a gate is still outstanding.** For Phases 2–18 that
>   gate is the per-phase **Chrome e2e UAT** against live (the build/deploy half is DONE — see the
>   two DEPLOYED banners below). For Phase 21 it is the deferred UI pieces named in its own entry.
> - `[ ]` — **not done: work remains.** Phase 27 (W6 outstanding), 27.2–27.6, and 28–31.

> **DEPLOYED 2026-06-26:** Phases 1–19 are LIVE — `main` (`690623377`) built to image `8f6d14ba902e` and swapped onto `norish-app` (tagged `norish:live`; old image preserved as `norish:rollback-20260625-pre`), container healthy, DB at migration 39 (no new migrations). The "human-verify (docker:build + redeploy)" half of each phase's gate below is therefore DONE; the **remaining** gate is the per-phase **Chrome e2e UAT** against live `https://norish.knoppsmart.com`. Details: STATE.md `## Session log` (2026-06-26) + vault `Norish push-to-live DEPLOYED (2026-06-26)`.
>
> **DEPLOYED 2026-07-21:** Phase 20 (upstream `v0.19.0-beta` incorporation, PR #468) + Phase 20.1 (free-component HeroUI Pro replacement) are LIVE — `main` fast-forwarded to `edf16de2` (then `e10e77fa` for docs) built token-free and swapped onto `norish-app` (tagged `norish:live`, image `e96d46f5c084`; old image preserved as `norish:rollback-20260721-pre` = `8f6d14ba902e`), container healthy, 0 restarts, `/api/v1/health` → `{status:ok, db:ok}`, DB still at migration 39 (no new migrations). Live is now `0.19.0-beta` (was `0.18.3-beta`). As with the 2026-06-26 deploy, the "human-verify (docker:build + redeploy)" half of the gate is DONE for Phase 20/20.1; the **remaining** gate — the per-phase **Chrome e2e UAT** against live `https://norish.knoppsmart.com` — is still OUTSTANDING for the new v0.19.0 surface and the 20.1-swapped UI (Drawer/Carousel/DropZone), same as it remains outstanding for Phases 2–18.

- [x] **Phase 0: Fork & tooling setup** - Fork, gsd-core, dev env on LXC 110, stock self-build de-risk
- [x] **Phase 1: Native Camoufox scraping** - Replace headless Chrome with the Camoufox REST client in source
- [~] **Phase 2: Multi-household cookbooks** - Multiple households per user + per-cookbook recipe scoping
- [~] **Phase 3: Per-cookbook permission policies** - Each cookbook sets its own view/edit/delete; admin-edits-any/members-edit-own (POLICY-01) — code-complete 2026-06-14, human-verify pending
- [~] **Phase 4: Recipe sharing** - Per-recipe visibility private/household/public on the existing recipe_shares; public = no-auth read-only view by share token (SHARE-01); recipe ratings show average+count + a per-user named-rater list on the authenticated detail view (RATE-01, public-view ratings deferred RATE-02) — code-complete 2026-06-14, human-verify pending
- [~] **Phase 5: AssemblyAI transcription** - Native AssemblyAI provider for video imports (renumbered from Phase 4); 04-01 code-complete 2026-06-14, human-verify (real key + e2e) pending
- [~] **Phase 6: DeepSeek V4 AI/LLM provider** - DeepSeek selectable for recipe-extraction with `deepseek-v4-pro` + `deepseek-v4-flash` (AI-01); provider already upstream, V4 model ids surfaced in the admin picker + unit-tested; 06-01 code-complete 2026-06-14, human-verify pending
- [~] **Phase 7: Locale-aware extraction** - AI recipe-extraction preserves the source content's language instead of defaulting to English (LOCALE-01); a language-preservation directive + the source/default locale threaded through all three extraction prompt builders; 07-01 code-complete 2026-06-14, human-verify pending
- [~] **Phase 8: WorkOS AuthKit login provider** - WorkOS AuthKit added as an ADDITIONAL better-auth login provider via the genericOAuth plugin (explicit authorize URL + custom getToken/getUserInfo against the WorkOS authenticate endpoint), admin-configured Client ID + API Key at runtime; additive + reversible (existing email/password, Google, GitHub, OIDC untouched) (WORKOS-01); 08-01 code-complete 2026-06-14, human-verify (lead docker:build + Kiran WorkOS dashboard/keys) pending
- [~] **Phase 9: WorkOS env config (config-as-code)** - WorkOS Client ID + API Key read from env (WORKOS_CLIENT_ID + WORKOS_API_KEY, seeding the DB at boot like OIDC/Google/GitHub; env takes precedence over a non-overridden row) instead of the admin UI, and the WorkOS card removed from the admin Auth Providers UI (WORKOS-ENV-01); 09-01 code-complete 2026-06-14, human-verify (lead docker:build + set WORKOS_CLIENT_ID in the live compose + redeploy; owner sets WORKOS_API_KEY) pending
- [~] **Phase 10: WorkOS-only auth** - WorkOS becomes the SOLE sign-in/sign-up path: with password auth off + WorkOS the only provider, the unauthenticated login page auto-redirects straight to the WorkOS AuthKit hosted page (norish login UI never shown) and the norish-only email/password login + signup are gone; conditional + recoverable (a `?sso=0` escape and re-enabling password / unsetting WorkOS both restore the normal login page; no redirect loop) (WORKOS-ONLY-01); 10-01 code-complete 2026-06-14, human-verify (lead sets PASSWORD_AUTH_ENABLED=false + WorkOS env in the live compose + docker:build + Chrome e2e) pending
- [~] **Phase 11: WorkOS OIDC fix** - Fix the broken WorkOS login by switching genericOAuth to standard OIDC via AuthKit discovery (WORKOS-OIDC-01); code-complete 2026-06-14, **superseded by Phase 12** (the OIDC-discovery surface was reverted there). Human-verify pending.
- [~] **Phase 12: WorkOS AuthKit flow (Option A)** - The actual working WorkOS login: first-party AuthKit flow, reverting Phase 11's OIDC-discovery surface; code-complete 2026-06-14, human-verify (lead docker:build + WorkOS keys + Chrome e2e) pending
- [~] **Phase 13: Mobile nav — hide name** - Avatar-only profile item in the mobile bottom-nav (drop the name label); code-complete 2026-06-14, human-verify pending
- [~] **Phase 14: Operator config via env (R1)** - AI provider + transcription configured as config-as-code: `syncAIConfigFromEnv`/`syncVideoConfigFromEnv` re-seed the DB every boot, env wins, fixing env↔DB drift; code-complete 2026-06-15, human-verify pending
- [~] **Phase 15: Single admin via env (R2)** - Operator/admin account configured from env (config-as-code), same env-wins re-seed pattern; code-complete 2026-06-15, human-verify pending
- [~] **Phase 16: Rating undo** - Allow removing/undoing a recipe rating; code-complete 2026-06-15, human-verify pending
- [~] **Phase 18: Open registration via env (R4)** - `registration_enabled` + `password_auth_enabled` as config-as-code (re-seeded every boot, env wins, survives a clean DB), removing the manual `UPDATE server_config` for the commercial WorkOS-only launch (OPEN-REGISTRATION-ENV-01); code-complete 2026-06-15, human-verify (lead sets the toggles in the live env + docker:build + redeploy) pending. *(Phase 17 number was skipped — never created.)*
- [x] **Phase 19: Ingredient unit normalization (update path)** - The recipe UPDATE path normalizes locale-specific unit terms to canonical IDs identically to the CREATE path (UNIT-NORM-01); **COMPLETE & verified green 2026-06-25** (db testcontainer suite 8/8 under `sg docker`, adversarially confirmed). First plan executed end-to-end through the cross-AI Antigravity/Gemini worker under native Opus review.
- [x] **Phase 20: Incorporate upstream v0.19.0-beta** - Merge upstream's `v0.19.0-beta` (PR #468) into the fork on a dedicated integration branch (UPSTREAM-019-01). LARGE + high-overlap (~996 files, ~110 overlapping ours): re-assert the fork's hard constraints at each conflict (Camoufox-not-Chrome in `parser/fetch.ts`/no `playwright.ts`; per-cookbook isolation suites stay green; config-as-code env sync), and reconcile our `packages/db/src/schema` against upstream's NEW `packages/db-schema/` package split. Gate on the isolation + db testcontainer suites (`sg docker`) + `pnpm docker:build`. **COMPLETE:** merged on `integ/upstream-0.19.0`, built token-free, deployed to live 2026-07-21 — live now `0.19.0-beta`. Full assessment: vault `norish-upstream-0.19.0-incorporation-assessment`.
- [x] **Phase 20.1: Replace @heroui-pro/react with free components (INSERTED 2026-07-15)** - Unblock phase 20's `pnpm docker:build` gate WITHOUT buying the HeroUI Pro license (Kiran's decision 2026-07-15): replace all 6 pro usages (Segment→`ToggleButtonGroup`; Sheet→free `Drawer` in Panel.tsx; Carousel×3→local embla compound `apps/web/components/ui/carousel.tsx` from 21st.dev @shadcn/carousel; DropZone→react-aria-components DropZone+FileTrigger in `apps/web/components/ui/drop-zone.tsx`) with zero NEW npm deps, then purge the dep + `HEROUI_AUTH_TOKEN` plumbing from Dockerfile/CI. **COMPLETE & SHIPPED 2026-07-21:** `pnpm --filter @norish/web build` green token-free; `@heroui-pro/react` dependency and all `HEROUI_AUTH_TOKEN` plumbing (Dockerfile secret mount + 5 GitHub workflows) removed. 3 plans on `integ/upstream-0.19.0`. Vault: `norish-heroui-pro-replacement`.
- [~] **Phase 21: UI polish & media-viewing UX (from the 2026-07-21 UAT)** - Subtractive polish pass — *"every pixel must earn its place; most should lose"* (Kiran, 2026-07-21). Two strands: **(a) MEDIA-UX-01 — media viewing is broken-by-design**: tapping a photo opens a lightbox that only ever receives `items.filter(type === "image")` (`media-carousel.tsx`), so a recipe with 1 photo + N videos yields a single-image lightbox with **no counter, no arrows, no thumbnails** — you lose the media set you were just swiping. Also: lightbox thumbnails render the **full-size original** into a 64px slot (`unoptimized` in `components/ui/carousel.tsx`), and Kiran reports the same image being fetched at several sizes (needs a network trace to confirm). **(b) Chrome reduction** — strip settings to essentials (it currently reads as self-hostable software, not a polished app), replace the wonky mobile-nav avatar, and rework the calendar into tappable rows of 7 that expand to a single day, hiding empty past days. Inputs: UAT sections A3 + D in vault `norish-uat-v0.19.0`. **Plannable slice CODE-COMPLETE 2026-07-23, and DEPLOYED (plannable slice) 2026-07-23** (lightbox media-awareness + mobile-nav circle + hide-empty-past-days + settings recommended-default reduction; commits `c63532aa`→`69ca3f62` on `main`, gates green; live image `9659fecfc478`, healthy, migration 40→40 no-op, health verified independently). **Still checkbox-open — DEFERRED pieces remain outstanding**: A2 `unoptimized`/image-sizing (needs a network trace), calendar rows-of-7 (own phase), the A1 grid/list toggle animation (unreproduced), settings 2nd pass. See the Plans block below + `21-01-SUMMARY.md`.
- [x] **Phase 22: Realtime fan-out isolation (BUG — cross-cookbook leak) — FIXED 2026-07-21** - The realtime layer does NOT honour the per-cookbook isolation the tRPC layer enforces. All 54 `emitByPolicy()` sites take a `viewPolicy`, and **all 54 read the SERVER-WIDE `getRecipePermissionPolicy()`** instead of the recipe's own cookbook policy (the "34" first recorded here was an undercount — corrected by the 22-01 audit; all 54 also target the ACTOR's cookbook key, a second vector). Live `server_config.recipe_permission_policy` is `{"view":"everyone",...}` (verified against the live DB 2026-07-21), so `emitByPolicy` takes its `case "everyone"` branch → `emitter.broadcast()` → **every connected client receives the full dashboard recipe DTO of every import, update, rating and share, regardless of cookbook**. This directly contradicts HOUSE-06, which Phase 3 adversarially proved on the REST/tRPC path only. Fix in code (resolve the policy from the recipe's OWN household, as `canAccessResource` already does) — NOT by flipping the live config, which would only mask it. **Sequenced first**: every later phase adds emit sites, and building on a leaky bus multiplies the fix. **COMPLETE + DEPLOYED 2026-07-21** — 3 plans, code-only, live config untouched; the rule is now written into `AGENTS.md`. Shipped to live as image `d44715015f1d` (healthy, 0 restarts, no migrations; rollback `norish:rollback-20260721-v0200`), image verified empirically to contain zero executable `emitter.broadcast(` calls in the policy path. (REALTIME-ISO-01)
- [x] **Phase 22.1: Import dedup isolation (INSERTED 2026-07-21) — FIXED + DEPLOYED** - Follow-up found while fixing Phase 22, and it was **three** defects, not one, all active under the live `view:"everyone"`: (a) `recipeExistsByUrlForPolicy`'s `everyone` branch was `eq(recipes.url, url)` with **no cookbook predicate**, so an import into cookbook B was deduped against — and handed back — a recipe in cookbook A; (b) the producer resolved that scope from the server-wide policy; (c) **`generateJobId("everyone")` produced a GLOBAL job id**, so two cookbooks importing the same URL collided on one BullMQ job and the second was rejected as "duplicate" — one household silently blocking another's import. Also closed a gap Phase 22 itself left (`worker.ts` reused the *realtime* view policy for the *dedup* decision; a personal import fell back to the server default `everyone`). Fix **removes the `everyone` scope from this path entirely** (params narrowed to `"household" | "owner"`; unreachable `default` fails closed) rather than just avoiding it at call sites. A pre-existing test **asserted the leaky behaviour** and was rewritten. Deployed as image `07d4520eb513`. (IMPORT-DEDUP-ISO-01)
- [x] **Phase 22.2: Recipe-list personal-view isolation (INSERTED 2026-07-21) — FIXED + DEPLOYED** - The item Phase 22.1 flagged but did not chase, confirmed real. `buildViewPolicyCondition`'s personal-view branch (no active cookbook) answered `view: "everyone"` with **no where-clause at all**, so `listRecipes` returned **every recipe on the server**, including other users' personal recipes. Reachable with no privilege by any authenticated user — `households.switchActive` accepts `{ householdId: null }` and the personal view falls back to the server-wide policy, which is live-set to `everyone`. `everyone` now clamps to the viewer's own recipes + orphans; **no unfiltered branch remains**. Third instance of the same root cause after 22 and 22.1, and all three hid behind an isolation suite that seeded `view: "household"` instead of the live policy — the rule that follows is now in `AGENTS.md`. Deployed as image `c5fb0e897946`. (LIST-ISO-01)
- [x] **Phase 22.3: Read-path isolation (INSERTED 2026-07-21) — FIXED + DEPLOYED** - Two composing leaks. **VIEW-ISO-01** — `canAccessResource`'s `case "everyone": return true` (the permission kernel) had no cookbook clamp, so any authenticated user could read any other cookbook's recipe via `recipes.getById`; the fifth instance of the family and the one the LIST fix (22.2) did not cover (different gate). Now `everyone` collapses into the `household` branch (member-for-view, cookbook-admin-for-edit/delete, personal owner-only). **MEDIA-AUTHZ-01** — the two authed recipe-media route handlers were authenticated but NOT authorized (`proxy.ts` proves a session, not access); new `denyUnauthorizedRecipeMedia` runs the same gate and refuses with **404 not 403**. `/share/[token]` and `avatars/[id]` deliberately untouched. A fourth pre-existing test asserted the leak; rewritten. Deployed as image `5ab3a6876929`. (VIEW-ISO-01, MEDIA-AUTHZ-01)
- [x] **Phase 22.4: Root cause + tags leak (INSERTED 2026-07-21) — FIXED + DEPLOYED 2026-07-23** - Kiran: "no bandaids, get to the root cause." 22/22.1/22.2/22.3 were four clamps of ONE value at four layers; **the origin: `view: "everyone"` was the shipped default, seeded into `server_config` and inherited by every new cookbook via `createHousehold` → `getDefaultCookbookPolicy()`, while `setHouseholdPolicy` had rejected that exact value since Phase 3.** Root fix at the point of manufacture: `DEFAULT_RECIPE_PERMISSION_POLICY.view` → `household` (both copies), zod default → `household`, `households.view_policy` column default → `household`, `getDefaultCookbookPolicy` clamps `everyone`→`household`, plus **migration `0039_root_iso_no_everyone_view`** moving existing household rows AND the `server_config` row (dry-run-verified against a restore of the live backup — caught a jsonb-vs-json cast bug). **TAGS-ISO-01** (sixth leak) — `config.tags` served every household's tags whenever the server-wide view was `everyone` (i.e. always); now caller-scoped. The 22/22.1/22.2/22.3 clamps stay as defence-in-depth. **DEPLOYED 2026-07-23 — live image `01f7ca7184b3`, healthy, DB migrated 39 → 40** (first migration since Phase 20); verified on the live DB: 0 households on `everyone`, `server_config` view = `household`. Rollback image `5ab3a6876929` (`norish:rollback-20260723-v223`). (ROOT-ISO-01, TAGS-ISO-01)
- [x] **Phase 23: Cookbook context & moving recipes — DEPLOYED 2026-07-23, image `6106a50f6ad0`** - A recipe never shows which cookbook it lives in, and there is no way to move it. Show the owning cookbook on the recipe detail view; tapping it opens a move-to-cookbook action (respecting POLICY-01 edit rights on both source and destination); add a Cookbooks browser entry to the nav. Small, high-frequency, and it makes the multi-cookbook model from Phase 2 legible for the first time. Source: UAT section B3. (CKBK-MOVE-01) **Shipped in code:** `recipes.move` (server-enforced: edit on the SOURCE + membership/ownership of the DESTINATION, HOUSE-06); CookbookChip + MoveRecipeModal on the recipe detail (desktop + mobile); a `/cookbooks` browser + nav entry; i18n in all 12 locales. Realtime follows Phase 22 (destination `created` keys on the new cookbook; source `deleted` is id-only). **NO migration** (writes only the existing `recipes.household_id`; DB stays at 40). Commits `52c5b44e` (backend + adversarial suite, RED-first) + `ecb06369` (UI + i18n), on `main`, pushed. Gates green (typecheck 17/17, trpc 294, web 424, lint 0-errors, web build EXIT 0; `i18n:check` fails ONLY on the pre-existing `no` gap — zero new gaps). Security-gate revert-checks RED-then-reverted-byte-identical (`23-VALIDATION.md`), and independently adversarially re-verified PASS by a second agent immediately before deploy. **DEPLOYED 2026-07-23** — live image `6106a50f6ad0` (built from `main@99ae11bb`), container healthy, 0 restarts, migration 40→40 no-op, health verified independently (deploy agent + a separate check agent, both PASS). Rollback tag `norish:rollback-20260723-pre-phase23` = image `9659fecfc478` (outgoing Phase-21 image). **Remaining gate:** Chrome e2e UAT of the move flow + Cookbooks browser against live.
- [x] **Phase 24: Import at scale & visible progress — DEPLOYED 2026-07-23, image `7fed8a7ba89a`** - Two halves of the same queue-UX story: **BULK-01** — accept many URLs (or a pasted blog index) in one submission, fanned out over the existing Camoufox import queue (one job per URL via the SAME `addImportJob` path, so Phase-22.1 per-cookbook dedup + job-id scoping hold) with per-item outcome reporting (queued/exists/duplicate); **IMPORT-UX-01** — a real progress indicator for a running import (single AND bulk), an honest `fetching → saving` stage on the pending skeleton card (indeterminate spinner, no fake bar), riding the cookbook-scoped realtime bus (the reason **Phase 22 landed first**). Commits `21cccba8` (backend + adversarial isolation suites) + `5854844d` (frontend + i18n) + `fba2052e` (docs), on `main`, pushed. **NO migration** (DB stays at 40). Cap = 25 URLs/submission (D-24-01); no crawl — URLs are extracted from text, never spidered (D-24-02). Security: `emitImportProgress` is the only new emit site, cookbook-scoped via `emitByPolicy` (never broadcast); progress + bulk-fan-out isolation suites seed the LIVE `everyone` sibling; the core-guard revert-check went RED-then-reverted byte-identical (`24-VALIDATION.md`), and independently adversarially re-verified PASS by a second agent immediately before deploy. Gates green (typecheck 17/17, queue 88, trpc 294, web 424, shared-react 37, shared-server realtime 27, lint 0-errors, web build EXIT 0; `i18n:check` exit 1 SOLELY on the pre-existing `no` gap — zero new gaps). **DEPLOYED 2026-07-23** — live image `7fed8a7ba89a` (built from `main@fba2052e`), container `norish-app` healthy, 0 restarts, migration 40→40 no-op, health verified independently (deploy agent + a separate check agent, both PASS: local+public `/api/v1/health` ok, local+public `/` → 307, no level-50/60 logs). Empirical image verification confirmed `importFromUrls` + `emitImportProgress`/`importProgress` present in the built bundle and all prior isolation fixes intact. Rollback tag `norish:rollback-20260723-pre-phase24` = image `6106a50f6ad0` (outgoing Phase-23 image). Backup: `/home/claude/norish-backups/norish-live-20260723-220438-pre-phase24.dump` (222 TOC, verified restorable). Session was a resume of an interrupted (session-limit) prior run — see STATE.md 2026-07-23 session log. **Remaining gate:** Chrome e2e UAT of the bulk modal + live progress. (BULK-01, IMPORT-UX-01)
- [x] **Phase 25: Shopping list — household-shared + aisle grouping — DEPLOYED 2026-07-23, image `8895dec71f5f`, migration 0040 (DB 40→41)** - Two requirements in ONE migration. **SHOP-02** — the shopping list (`groceries`/`stores`/`ingredient_store_preferences`/`recurring_groceries`) is re-keyed from `user_id` to `household_id`, so members of a shared cookbook share ONE list (Kiran's 2026-07-21 decision). **SHOP-01** — a built-in default aisle set (8 aisles, 172 curated EN+NL ingredient keywords) is seeded per household so the (already store-grouped) list is grouped with zero config; extends the existing `stores`/`ingredient_store_preferences` pattern (NOT open-tandoor-data). **Migration `0040_shopping_list_household` — DB 40→41**: adds `household_id` (NOT NULL, FK), backfills each row to its user's OWN household (earliest-admin, fallback earliest-membership — injective per user ⇒ no cross-user merge, no unique collision), swaps the aisle-map unique to `(household_id, normalized_name)`, and seeds default aisles into existing store-less households. **DRY-RUN-VERIFIED against a RESTORE of the live backup in a throwaway scratch db** (groceries 10→10, 0 null/orphans, every row → its own household, 2 households seeded, unique holds). Isolation (HOUSE-06) enforced server-side + adversarially revert-checked (RED→reverted). Gates green (typecheck 17/17, `@norish/db` incl. 6 new isolation tests, trpc 294, lint 0-err, web build EXIT 0; i18n exit 1 only on the pre-existing `no` gap). Commits on `main`. **DEPLOYED 2026-07-23** — live image `8895dec71f5f` (built from `main@13958cf8`), migration `0040` applied at boot, DB 40→41; data-effect verified on the live DB (0 null/orphan `household_id` across all four re-keyed tables, pre-existing rows preserved, 0 household-membership mismatches) and the migration was independently re-verified via a second dry-run restore. See the ROADMAP "### Phase 25" detail section + STATE.md session log 2026-07-23. (SHOP-01, SHOP-02)
- [x] **Phase 26: What's-for-dinner suggester — DEPLOYED 2026-07-24, image `082924a3d0a5`** - Suggest tonight's recipe from season + recent ratings, presented with the rater's avatar, stars and a thought-bubble. Builds entirely on the shipped `recipe_ratings` + tags surface — no new data source, no new provider. The cheapest "feels like a product" win on the list. **Shipped in code:** `recipes.dinnerSuggestion` (candidate query `getDinnerSuggestionCandidates` reuses `buildViewPolicyCondition` WHOLESALE → HOUSE-06 scoping INHERITED; ranking is a pure, deterministic fn in `@norish/shared-server/recipes/dinner-suggester` weighing SEASON — a bilingual EN+NL lexicon matched against each recipe's OWN tags, current season from the date — and RECENT RATINGS — household-scoped avg + count + last-rated recency, date-seeded jitter, no `Math.random()`); a `DinnerSuggestion` dashboard card (under Today's meals, desktop + mobile) with season chip + stars + a rater thought-bubble sourced from the ALREADY-gated `ratings.getRaters` (RATE-01 — suggester never fetches names); i18n in all 12 locales. Placement = dashboard/home (D-26-06). **NO migration, NO new provider/table** (DB stays 41); season degrades gracefully to rating-only when tags carry no seasonal signal (D-26-02). Commits `34a4ee03` (backend + adversarial isolation suite) → `b592a76c` (UI + i18n) → `f792cc1e` (docs), on `main`, pushed. Gates green (typecheck 17/17, shared-server dinner-suggester 11, db dinner-isolation 6, trpc 294, shared-react 37, web 424, lint 0-err, web build EXIT 0; `i18n:check` exit 1 SOLELY on the pre-existing `no` gap — zero new gaps). Security: cross-cookbook attack proven blocked incl. under live `view:"everyone"`; core-guard revert-check RED-then-reverted byte-identical (`26-VALIDATION.md`); independently adversarially re-verified PASS by a second agent immediately before deploy; rater path stays RATE-01-gated. **DEPLOYED 2026-07-24** — live image `082924a3d0a5` (built from `main@f792cc1e`), container `norish-app` healthy, 0 restarts, migration 41→41 no-op ("Migrations complete"). Health verified independently (deploy agent + a separate check agent, both PASS): local + public `/api/v1/health` ok, local + public `/` → 307, zero level-50/60 logs. Empirical image verification confirmed `getDinnerSuggestionCandidates`/`selectDinnerSuggestions` present in the built bundle and all prior isolation fixes (22–22.4) intact. Rollback tag `norish:rollback-20260724-pre-phase26` = image `8895dec71f5f` (outgoing Phase-25 image); backup `/home/claude/norish-backups/norish-live-20260724-003747-pre-phase26.dump` (230 TOC, verified restorable). **Remaining gate:** Chrome e2e UAT of the suggestion card against live. (DINNER-01)
- [ ] **Phase 27: Cooklang migration (MAJOR)** - Migrate recipe step/ingredient representation to Cooklang, delivering the long-wanted **in-step ingredient quantities** and **multi-timer cooking mode**. **UNBLOCKED 2026-07-24 (Kiran): fork-independent, NO #470 gating** — the fork has progressed past the original and makes its own design calls, so the serializer lives **fork-local** rather than being contributed upstream. Parser `@cooklang/cooklang` (MIT, WASM — NOT the archived `cooklang-ts`). **FULL-NATIVE, NO bandaids (Kiran, 2026-07-24)** — reversed from additive-dual-store: `.cook` is the **single source of truth**, `steps`/`recipe_ingredients` demote to a **derived projection**, the heuristic `SmartInstruction`/`applyIngredientLinkMarkup` layer is **deleted**, and metric↔US uses a **deterministic OSS converter** (`convert`, MIT) + USDA density table instead of the AI `unit-converter.ts`. Master plan **`.planning/phases/27-cooklang/27-ARCHITECTURE.md`**; reversals in `27-DECISIONS.md`; de-risked by the committed spike (`structuredToCooklang` vs the REAL WASM parser, `27-EXTRACTION-PROMPT.md`, `27-EXPERIMENT.md`). Migrations `0041` expand · `0042` backfill (data-mutating) · `0043` NOT-NULL; shopping-list FK kept safe via UPSERT-stable projection; low-confidence backfill tail goes to a **review queue** (no permanent fallback). 7 waves (W0–W6) — wave by wave:

  **Wave status (chronological; each wave's full record is in its SUMMARY):**

  - **W0 (deterministic units subsystem) CODE-COMPLETE + pushed `a4f9c2a5`**;

  - **W1 (serializer + parser read-model) CODE-COMPLETE + pushed** (`40ad343e` → `58cabd9f`): `structuredToCooklang` productionized into **`@norish/shared/cooklang`** on the REAL `normalizeUnit`, **`@cooklang/cooklang@^0.18.7` (MIT, `cooklang/cooklang-rs`) is now a real pnpm workspace dependency of `@norish/shared-server`** in `pnpm-lock.yaml`, a `parse → cookTokens` server util that dereferences every parser index and returns `null` rather than throwing, and nullable `cookSource`/`cookTokens` (defaulting to `null`) on `FullRecipeSchema` — additive and un-wired.

  - **W2 (write path + `0041`) CODE-COMPLETE + pushed** (`9f548b96` → `a896dae1`, base `8d541fb4`), the SERVER half only: migration **`0041`** (expand-only on `recipes`: `cook_source`, `cook_confidence`, `cook_review_needed`; plus the `(recipe_id, system_used, ingredient_id)` UNIQUE index, whose de-dup **re-points every `groceries.recipe_ingredient_id` onto the survivor BEFORE deleting**, sums only on a lossless merge and otherwise flags `cook_review_needed`) — hand-written per D-27-W2-08, **NOT applied to live**, with a read-only `checks/0041-precheck.sql` for the pre-deploy dry-run against a restored dump; **`deriveProjectionTx`** in `@norish/db`, UPSERT-stable on that natural key so `recipe_ingredients.id` and its grocery FK survive an edit and `steps.id`/`step_images` survive a re-derive, materializing both systems' ingredient rows (opposite via W0's converter, flag-and-preserve) and the native system's steps, importing **no parser** (`@norish/db` gained no dependency); **`buildCookPayload`** + **`withCookTokens`** in `@norish/shared-server`, the former validating its own output so a non-NULL `cook_source` always parses cleanly and a failed derive never fails the user's write; and `cookSource`/`cookTokens` on `recipes.get`/`getEditable` **strictly after the access check**, with list/search/dashboard byte-for-byte unchanged. **Nothing user-visible changed — no `.cook` producer exists until W3, so every recipe still has `cook_source IS NULL`.** Gates green (typecheck 17/17; db 164/1 pre-existing; trpc 322; shared 295; shared-server 275; web 424; mobile 132; lint 0 errors at baseline; `build:server` EXIT 0; **+139 tests**), with four adversarial weakenings each turning an isolation suite RED and reverted byte-identical.

  - **W3 (extraction native + T-27-01 input limits) CODE-COMPLETE — 5 of 5 tasks** (`f29254b9` → `65815ec4` → `527a852d` → `49f03139` → **`f7bcecb8`** the T-27-01 root-cause fix → **`be72cc9b`** the queue-side isolation suite; base `faa13d8e`, nothing pushed). **THIS IS THE WAVE THAT SWITCHES THE FEATURE ON: a newly AI-extracted recipe can now have a non-NULL `recipes.cook_source`, the first time that is true in this codebase.** Everything else is byte-identical — a string-shaped model response, JSON-LD, the python scraper, structured paste, a Mealie archive and the manual editor all pass **no** `cook` (D-27-W3-08). **What shipped:** a linkage prompt fragment appended by all three extraction builders as CODE, never a `.txt` edit (D-27-W3-01 — `loadPrompt` reads SERVER CONFIG, so a `.txt` edit is a silent no-op on an existing install; proven closed by a per-builder test with `loadPrompt` mocked to an unrelated base prompt); `recipeExtractionSchema.recipeInstructions` accepting a per-step OBJECT **or** a plain STRING (object first, D-27-W3-03) with a TOTAL never-throwing normalizer, so no import that succeeds today can fail (the **R1** mitigation); `buildCookFromExtraction`, the only new minting call site, refusing in four ways that each cost the user NOTHING (`no-step-linkage` debug, `incomplete-ingredient-coverage` error, `input-too-large` error, `did-not-parse-cleanly` error — counts only, never prose, T-27-05); the **coverage gate** (D-27-W3-04) that stops `deriveProjectionTx` silently dropping ingredients a model failed to link (8-of-11 ⇒ no `.cook`, **11** ingredient rows, `cook_source IS NULL`); `ExtractedRecipe { recipe, cook }` threading the payload from the three AI extractors to `createRecipeWithRefs(..., cook)` **alongside** the DTO, never inside it (D-27-W3-02); the opposite system's authored step prose still written in the cook branch (D-27-W3-05); and `cook_source = NULL` on an ordinary no-`cook` update so a stored `.cook` can never go stale (D-27-W3-06). **T-27-01 IS DISCHARGED — and by the ROOT CAUSE, after a false start that a verifier caught.** The plan's nine caps could not satisfy the plan's own <2 000 ms criterion: the parser emits a diagnostic per malformed token quoting the token's whole LINE, so report construction is O(malformed × line length) and adversarial input INSIDE 64 KiB measured up to **18.8 s / ~250 MB** (a 4 KiB `#` run alone costs 4.5 s), non-monotonically in the cap. A tenth cap (`maxCookMalformedTokens: 8`) was added, and then an **independent adversarial verifier REFUTED it with working repros** — a brace-closed `@a{1%}` flood scored 0 malformed and took **11 118 ms / 150 MB**, while an ordinary US-shorthand pot roast (“Preheat the oven @ 325”) was **wrongly refused** though the real parser handles it in 13 ms with an empty report. **The real defect: `.cook` is a syntax-bearing format and the serializer emitted step prose VERBATIM, so model-shaped text was being INJECTED into that syntax** (structurally SQL/HTML injection). Fixed in `f7bcecb8` by escaping every metacharacter in every piece of text norish did not author as a token (`escapeCookText`; `\X` is a general, losslessly-reversible escape, and `sanitizeTokenName`'s silent STRIP is gone), `extensions = 0` on the parser (which also stopped the read model rewriting prose numbers: `180°C` → `180 °C`, `1.50 kg` → `1.5 kg`), quoting frontmatter and deciding quoting by KEY (a newline in a model-supplied recipe NAME could inject arbitrary `.cook` body), and **`findCookSourceDefect` — an output-integrity assertion, not an input heuristic** — at the same two doors. **`COOK_LIMITS` is back to the NINE originally planned caps at their planned values; `maxCookMalformedTokens` is DELETED.** Worst timing across 25 hostile families: **648.8 ms** (a 3.1× margin); the verifier's bypass refused in 1.3 ms; the pot roast now earns a `cook_source`. Proven by a new 45-test round-trip-fidelity suite with an EXHAUSTIVE sweep of all 32 ASCII punctuation characters in 9 positions, all 100 adjacent metacharacter pairs, and 40 hostile strings in 7 positions each. **Lesson: do not predict a parser — constrain what you hand it and assert your own output.** **FOUR INCIDENTAL never-broken defects fixed at the root:** `computeCookProjection` dropped the AMOUNT of a split-amount ingredient (bare mention first, quantified later) in BOTH systems; `findNameIndex` spun forever on a blank ingredient name; a timer with an empty amount/unit emitted `~{%min}`; and the two frontmatter injection/typing defects. **ISOLATION IS PROVEN AT THE WRITE AND EMIT END** (`be72cc9b`): a new 33-test `packages/queue/__tests__/recipe-import/cook-source-isolation.test.ts` drives the REAL `processImportJob` against the REAL `resolveHouseholdRealtimeScope`/`resolveRecipeRealtimeScope`/`emitByPolicy` with a `.cook` minted by the REAL `buildCookPayload` and the REAL `RecipeDashboardSchema` — cross-cookbook write and emit, the dedup-hit emit, the PERSONAL (`household_id IS NULL`) import, the `userId: null` orphan branch, the `imported` payload and the list DTO, **each with a `view: "everyone"` sibling** (AGENTS.md). **No real leak was found.** ONE file, no production change. The read-side `NOT_FOUND` half stays in W2's `cook-tokens-isolation.test.ts` because `@norish/auth` (where `canAccessResource` lives) is a FORBIDDEN import edge for `@norish/queue`; re-implementing the predicate would have been mocking the boundary. **ALL FIVE PLANNED ADVERSARIAL WEAKENINGS EXECUTED (plus one self-directed), each RED, each reverted byte-identical, none committed:** W3-W1 (7 red, incl. both `calls parse 0 times` assertions), W3-W1b (11 red), W3-W4 weakening the ESCAPER (14 red), W3-W5 weakening the RECOGNIZER (25 red, with the time budget blown on exactly the families the deleted heuristic let through), W3-W2 (2 red, exactly as the plan predicted), W3-W3 adding `cookSource` to the `imported` payload (**4 red**, both the cookbook and the PERSONAL case, under both policies). **D-27-W3-07 IS NOW MEASURED and CONFIRMED — the director's open decision item can be closed: the derived US output IS worse than the AI's, 18 of 35 ingredients differ** across the five fixtures, on two independent axes — (1) every dry good the model measures in `cup` becomes `ounce` (11 of 18; `2 cup flour` → `8.81849 ounce`) and `fl oz`/`pint` are never produced at all; (2) all conversions are unrounded 6-decimal values (`14 ounce` → `14.109585 ounce`), which would SURVIVE a vocabulary fix. The HARD assertion held for all five: same ingredient names, same count, no ingredient lost. **W5 PREREQUISITES (both, not either): the W0 `kilogram`/`fl oz`/`pint` vocabulary AND a rounding/presentation rule.** Dual-system extraction is KEPT; single-system extraction stays deferred to W5. **Gates:** typecheck 17/17 (and a REAL `tsc --noEmit` clean in api/queue/shared/shared-server — the repo's own script passes `--noCheck` in 6 of 17 packages and does NOT type-check `packages/api`, proven adversarially); api **408**; queue **121**; shared-server **389**; db (docker) **178 passed / 0 failed** (the long-standing “pre-existing” red was a stale-`node_modules` artefact); trpc 335; shared 295; web 424; mobile 132; auth 133; lint 0 errors with warnings at baseline; `check-workspace-imports.mjs` EXIT 0; `build:server` EXIT 0; `i18n:check` EXIT 1 on the `no` locale ONLY (68 keys, zero new); `pnpm-lock.yaml` diff EMPTY; isolation suites queue 44 / trpc 46 / db 25; **+192 net-new tests**. **NO MIGRATION** — `packages/db/src/migrations/` and `meta/_journal.json` untouched, DB stays at **42**, the `0042` (W5) / `0043` (W6) sequence unchanged (D-27-W3-10). **No file under `apps/`; the renderer is W4.**

  - **W3 director exit items:** `docker:build` + deploy-image sanity (first deploy where the parser runs on the WRITE path); decide D-27-W3-07 as above; watch `incomplete-ingredient-coverage` / `did-not-parse-cleanly` / `not-serializer-shaped` (the last should be ZERO); a verified-restorable backup before the W3 deploy; **`AI_API_KEY` IS set on live — env-backed in `/opt/norish/.env` (untracked, `chmod 600`), on top of the DeepSeek key the Admin UI wrote to `ai_config` on 2026-06-15 — so W3's producer WILL fire and the deploy is NOT a no-op** (an earlier note claiming the opposite was corrected on 2026-07-26; see `27-04-SUMMARY.md` §15.6); and a small plan for the `--noCheck` typecheck hole.

  - **UPDATE 2026-07-27 (later same day): W4 (client token renderer + multi-timer, plan `27-05`) is now ALSO DEPLOYED** — new live image `sha256:4427ffbf…`, previous `sha256:704aa6b6…`, rollback tag `norish:rollback-20260727-pre-27-05`, no migration (DB stays at 42) — see the "Status of the phase" line and the `27-05 (W4)` bullet below for the full record.

  - **UPDATE 2026-07-27 (later still): 27-06 (W5-PREP) is now CODE-COMPLETE** — the units vocabulary (`kilogram`/`fluid_ounce`/`pint`) and the rounding rule both land, closing 2 of W5's 3 hard prerequisites; NOT deployed (pure offline code); see the `27-06 (W5-PREP)` bullet below for the full record.

  - **UPDATE 2026-07-27 (later still again): W5 (plan `27-07`, migration `0042` live-data backfill) is now ALSO DEPLOYED** — the phase's first IRREVERSIBLE wave. New live image `sha256:f1b6664ea600…`, previous `sha256:e216d3303bc2…`, rollback tag `norish:rollback-20260727-pre-27-07`, **migration 42 → 43** (`0042_backfill_cook_source` is journal-only, D-27-W5-02; the mutation ran at boot as `backfillCookSource()`). Backfill outcome `candidates:6, derived:1, flagged:5, refused:0, failed:0` — all 6 recipes now carry a `cook_source`, only `Gnocchi in tomatensaus` (0.917) cleared the review threshold, the other five (0.000–0.333) are flagged `cook_review_needed`. Zero data loss confirmed by two independent agents (steps 80→80, recipe_ingredients 136→136, grocery links 10→10, 0 orphaned/silently-nulled FKs). Root cause of the mixed derive quality is a newly-surfaced but pre-existing data-quality issue — duplicated bilingual `steps` rows — flagged as a follow-up, not introduced by this wave. See the `27-07 (W5)` bullet below and the "Status of the phase" line for the full record.

  - **NEXT: W6** (`cook_source` NOT NULL, migration `0043`) — the only remaining wave of the phase. **RE-SCOPED 2026-07-28 as its own phase, 27.6** — the `27-ARCHITECTURE.md` §7 form is NOT executable (its justification "Safe because W5 guaranteed 100% coverage" is FALSE; see Phase 27.6 below for the evidence and the hard prerequisites). See `.planning/phases/27-cooklang/waves/W3-SUMMARY.md`, `waves/W4-SUMMARY.md` and `27-06-SUMMARY.md`. Director exit items for `0041`/W3B (docker:build + in-image WASM confirmation, the `0041` precheck against a restored dump, and a verified-restorable backup before `0041` reached live) are all closed by prior deploys. See `.planning/phases/27-cooklang/waves/W2-SUMMARY.md`. (COOK-01)
- [x] **Phase 27.1: Import reliability (INSERTED 2026-07-28) — DEPLOYED, but its premise was WRONG** - Shipped five things (mirror-the-absent-measurement-half, one retry at raised token headroom, JSON-LD-after-AI-failure fallback, visible failure surfacing, in-stack Camoufox compose) plus the PENDING-ISO-01 leak fix, on live image `sha256:919a5e950735…`. **CORRECTED 2026-07-28 (later, by five diagnostic agents): the recorded root cause was wrong and this phase fixed mostly the wrong thing.** The relaxed normalizer sits on an **unreachable path** (`Output.object` validates inside `generateText` and throws before `mirrorMeasurementSystems`/`validateExtractionOutput` run — live logs only ever show "AI response did not match expected format.", never "Recipe extraction failed - missing required fields"), and the retry raises a token budget that was never the constraint (the same starved page at 100 000 tokens still returns `{}` in 3 s, `finish_reason: stop`). What 27.1 DID genuinely fix: reasoning-exhaustion, which is **1 of 25** live AI failures (wiswijzer/erwtensoep, the one demonstrated win), plus the real, live cross-household `getPending` leak and the failure-UX defects. **Its 24/24 empirical gate certified the `structured` parser path — which 27.1 did not modify**; every one of the 24 logged `parserPath:"structured"`, `usedAI:false`, so the AI path was never exercised. The real root cause is the upstream sanitizer — see Phase 27.2. (IMPORT-REL-01..05, PENDING-ISO-01)
- [ ] **Phase 27.2: Imports actually work — the sanitizer (INSERTED 2026-07-28)** - **THE headline fix.** `extractSanitizedBody` (`packages/shared-server/src/ai/helpers.ts:93`) harvests page text only from `h2,h3,h4,h5,h6,p,li,dt,dd,figcaption`. Classic Blogger pages put the whole recipe as bare text nodes separated by `<br>` inside `div.post-body` — zero `<p>`, zero `<li>` — so the sanitizer hands the model 86–585 characters of navigation chrome, the DB base prompt's "Return {} if data cannot be extracted" fires correctly, DeepSeek returns the two-character string `{}`, the strict Zod schema rejects it, and the user sees "AI response did not match expected format." **24 of the 25 live AI failures are this.** Fix the selector pass (`<br>`-separated text nodes + table cells, prefer a real article-body container over `<main>`, fall back to whole-root text when the selector pass yields implausibly little), raise the live `ai_config.maxTokens` above the measured ~11k floor (a DB row, not a deploy), and add the observability that would have caught it in an hour instead of a week. **`helpers.ts` is byte-identical to upstream/main — this is an UPSTREAM defect and a good upstreaming candidate.** (IMPORT-SANITIZE-01, IMPORT-OBS-01)
- [ ] **Phase 27.3: Gates that don't lie (INSERTED 2026-07-28)** - **6 of 17 packages do not typecheck.** Five carry a script-level `--noCheck`; the sixth and worst is `apps/web`, whose script reads as an honest `tsc --noEmit` while `apps/web/tsconfig.json:6` sets `"noCheck": true` — a real typecheck yields **285 errors**, including a modal importing three non-existent `@heroui/react` members (would throw on render) and an authorization path reading `user.isServerAdmin` off a type that does not declare it. Plus 17 broken `@norish/shared/contracts` type imports hidden by `skipLibCheck` (so `Slot` is `any` at four live call sites) and `pnpm i18n:check` exiting 1 on 68 missing `no` keys — which `pr-quality.yml:46` has been running red on every PR and every push to main. Restore honest typechecking, fix what surfaces, and add a build-time assertion that covers the **Next.js server bundle** rather than only the tsdown bundle. (GATE-01, I18N-01)
- [ ] **Phase 27.4: Close the live defects (INSERTED 2026-07-28)** - Everything found today that is broken on live right now: the **Cooklang parse pool's child resolution** (broken in the Next.js/Turbopack server chunks since `59f3a767`, costing every recipe its ingredient chips, per-step scaling, section headings and concurrent timers — RENDER only, not import); **two more `pending.ts` isolation leaks** plus four unowned `is*` job probes (SECURITY-CRITICAL, same family as 27.1-06); **`deleteAccount` orphaning recipes** into a permanently invisible, undeletable state; **service-worker recipe-media caching** that bypasses `requireRecipeMediaAccess` forever, with no sign-out purge and a `update-sw-version.js` that has been a no-op since it was written; the bypassable `clone-beta-db.sh` live-DB guard; and the DeepSeek key rotation. (COOKPOOL-01, PENDING-ISO-02, ACCT-DEL-01, SW-CACHE-01, OPS-01)
- [ ] **Phase 27.5: Delete the dead weight (INSERTED 2026-07-28)** - Execute the three adversarial dead-code reviews written 2026-07-28 (`27.1-REVIEW-A-import-surface.md` ~2 115 deletable lines, `-REVIEW-B-data-server.md` ~1 150, `-REVIEW-C-apps-tooling.md` 42 findings). Deletion-only, no behaviour change. **Trap:** `packages/api/src/parser/jsonld.ts:2` carries a FALSE `@deprecated` comment — 27.1 put that file on the live path in four places; it is NOT dead. (DEADCODE-01)
- [ ] **Phase 27.6: Cooklang as the only source of truth (the real W6) (INSERTED 2026-07-28)** - Kiran, 2026-07-28: *"Ik wil cooklang als de enige source of truth hebben. de rest mag er allemaal uitgesloopt worden."* This is the destination — the legacy render fork, `unit-converter.ts`, the heuristic ingredient-link markup and the timer-keyword scan all go. But `27-ARCHITECTURE.md:320`'s W6 is **NOT executable as written**: its stated justification ("Safe because W5 guaranteed 100% coverage") is **FALSE** — W5 covered *existing rows* (`candidates:6, derived:1, flagged:5`), said nothing about future inserts, and nothing at all about the read path. Shipping it today would break the structured URL-import, paste-import, Mealie-archive and manual-create write paths **and** render zero steps on 100% of recipes. Re-scoped with its prerequisites as hard gates. (COOK-02)
- [ ] **Phase 28: Cost-per-recipe badge (MAJOR)** - € / €€ / €€€ per serving. Daily `supermarkt/checkjebon` (MIT, 12 NL chains) pull → Postgres price index; the existing Camoufox AH scraper as cache-miss enrichment; LLM ingredient→product parse (strong for Dutch) + fuzzy match; computed async, badged on the recipe card. Legal: prices aren't personal data and homelab use is fine, but **do not redistribute** scraped AH data — lean on checkjebon (MIT) and Open Prices (ODbL). (COST-01)
- [ ] **Phase 29: "What can I make now?" (MAJOR)** - Photograph what's on the counter → AI vision recognises ingredients → suggest makeable recipes and what's missing. Explicitly **image-based, no pantry/inventory** (pantry was dropped as a concept). Uses the existing AI provider's vision path. Per Kiran, the competitive research (incl. Albert Heijn's GenAI direction) is deliberately **deferred to build time** rather than done now. (MAKE-01)
- [ ] **Phase 30: Shared-recipe versions & lineage (MAJOR)** - Saving a shared recipe creates a **version in a shared lineage bucket** rather than an unrelated copy; users explore the versions others made; reviews aggregate across the lineage but stay attributed to the version they were left on. **Now unblocked** — SHARE-02 (save-to-account) shipped 2026-07-21. Phase 2's recipe↔cookbook model stays forward-compatible via a `lineage_id`/`parent_recipe_id`. (VERSION-01)
- [ ] **Phase 31: Ingest-pipeline overhaul (MAJOR, post-Cooklang)** - Sequenced sketch recorded 2026-07-24 (Kiran) as the follow-on to Phase 27. Phase 27 improves the extraction *prompt* and adds the structured→`.cook` serializer; this phase reworks the ingest path end-to-end on top of it — the extraction schema (per-step linkage as a first-class output), provider orchestration/repair, ingredient dedupe/normalisation, and the JSON-LD ↔ AI ↔ image/video convergence onto one well-linked structured shape. **Depends on Phase 27** (the linkage schema + serializer + confidence gate land there first). Not scoped further until 27 ships. (INGEST-01)

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
**DEPLOYED (plannable slice) 2026-07-23** — live image `9659fecfc478`, healthy, 0 restarts. No migration this phase (DB stays at migration 40, unchanged since the 22.4 deploy). Health verified independently (deploy agent + a separate check agent, both PASS): local + public `/api/v1/health` ok, local + public `/` → 307, zero level-50/60 logs. Empirical image verification confirmed the lightbox marker present in built chunks and the removed settings-admin files absent, plus all prior isolation fixes (22–22.4) intact. Rollback tag `norish:rollback-20260723-pre-phase21` = image `01f7ca7184b3` (outgoing Phase-22.4 image); backup `/home/claude/norish-backups/norish-live-20260723-171931-pre-phase21.dump` (222 TOC, verified restorable). **This is a partial delivery**: the four plannable-slice items (lightbox, mobile-nav, hide-empty-past-days, settings reduction) are live, but A2 `unoptimized` image-fetch fix, calendar rows-of-7, the A1 toggle animation, and a settings 2nd pass remain DEFERRED — hence the checkbox above stays `[ ]`. See STATE.md session log 2026-07-23 for full detail.

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
**Plans**: SCOPED 2026-07-21 — see `.planning/phases/21-ui-polish-media-ux/21-CONTEXT.md`. The audit finds these five criteria are **not one phase**: criterion 1 (lightbox) is real but is a *type* problem not a filter deletion (`ImageLightboxProps.images` has no discriminator and `Carousel.Thumbnail` is `NextImage`-only); criterion 2 is app-wide — `unoptimized` is on **12** media renders, not 2, and the reported "several sizes" symptom is **not explained by the code** (with `unoptimized`, `sizes` is inert and no srcset is emitted), so the network trace is a hard prerequisite and the likely reason for the bypass — auth-gated media route handlers the optimizer cannot fetch through — must be established or the fix 401s every image; criterion 3 (settings) is **not plannable** without a card-by-card disposition decision from Kiran, since Phases 14/15 already moved operator config to env and cutting a card that is the only way to set something is a regression; criterion 4 must **not** undo Phase 13, which deliberately made the mobile nav avatar-only; criterion 5 (calendar rows-of-7) is **mis-sized** — the calendar is a 14-component timeline with drag-and-drop, and rows-of-7 is a different information architecture, so it wants its own phase ("hide empty past days" is the polish-sized piece). Plannable today = lightbox + avatar + empty-past-days.

**Plan checkboxes** (21-01-PLAN.md — the plannable slice, **CODE-COMPLETE 2026-07-23, DEPLOYED 2026-07-23**, live image `9659fecfc478`):
  - [x] MEDIA-UX-01 — media-aware lightbox: `ImageLightbox.images` widened to a discriminated `LightboxMedia` union, video slides via `VideoPlayer`, `Carousel.Thumbnail` shows a video poster+play badge, `buildLightboxMedia` keeps the full set 1:1. The `filter(type==="image")` drop is gone. Counter/arrows/thumbnails appear for mixed sets.
  - [x] Mobile-nav avatar — oval glass pill → clean `size-13` circle; Phase-13 hidden-name preserved.
  - [x] Calendar — empty past days hidden via `filterVisibleDays` in both timelines (today+future always shown; past kept only if it has items). Rows-of-7 NOT attempted (own phase).
  - [x] Settings reduction — recommended default applied: AuthProviders + System/restart cut, AI-config + video-processing accordion items cut; every no-env setting kept. **Deviation:** content-detection kept (its env vars are declared but consumed nowhere → cutting = regression).
  - [ ] A2 `unoptimized` / image-sizing — DEFERRED (needs the network trace; OUT of scope).
  - [ ] Calendar rows-of-7 — DEFERRED to its own phase.
  Gates: web+full typecheck 0, web tests 424/424 (415 baseline + 9), lint 0 errors, web build 0. i18n:check unaffected (no strings changed); its failure is pre-existing (`no` locale missing `settings.join.*`). SUMMARY: `.planning/phases/21-ui-polish-media-ux/21-01-SUMMARY.md`.

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
  - 54 `emitByPolicy(` call sites across `packages/queue/src` (7 workers, 38 sites) and `packages/trpc/src` (4 files, 16 sites). ~~**34** resolve their policy from the server-wide `getRecipePermissionPolicy()`~~ — **CORRECTED by the 22-01 audit: it is 54 of 54.** The audit also found a SECOND, independent vector the estimate missed: all 54 also target `ctx.householdKey`, which `middleware.ts:38` sets to the ACTOR's active cookbook, so cross-cookbook flows (`saveShared`, rating a shared recipe) misroute even with the broadcast branch closed. See `22-AUDIT.md`.
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
- [x] 22-01: Audit + adversarial harness — all 54 emit sites tabulated (`22-AUDIT.md`); two-household/two-socket harness built; **12 tests landed RED** naming `norish:recipe:broadcast:imported`, with zero production diff. Commit `de3bf9a4`.
- [x] 22-02: Core fix + the 7 queue workers (38 sites). `emitByPolicy` no longer broadcasts (D-22-01); `resolveRecipeRealtimeScope` / `resolveHouseholdRealtimeScope` resolve policy AND target key from the recipe's own cookbook (D-22-02). shared-server 201/201, queue 77/77. Commit `33c04546`.
- [x] 22-03: The 16 tRPC sites + a router-level isolation suite + `AGENTS.md` "Realtime scoping" rule. trpc 278/278 (269 baseline + 9 new), `pnpm typecheck` 17/17, `pnpm lint` 14/14 with 0 errors. Both revert-checks RED then reverted byte-identical (`22-VALIDATION.md` §3).

### Phase 23: Cookbook context & moving recipes
**DEPLOYED 2026-07-23** — live image `6106a50f6ad0` (built from `main@99ae11bb`), container `norish-app` healthy, 0 restarts. No migration this phase (DB stays at migration 40 — the move writes only the existing `recipes.household_id`). Health verified independently (deploy agent + a separate check agent, both PASS): local + public `/api/v1/health` ok, local + public `/` → 307, zero level-50/60 logs. Security independently adversarially re-verified PASS by a second agent immediately before deploy (move guard checks both ends from the recipe's OWN cookbook policy, HOUSE-06 holds, 13/13 move-permissions + 9/9 db-isolation green, both revert-checks RED-then-reverted byte-identical). Empirical image verification confirmed `assertRecipeMoveAllowed`/`moveRecipeToHousehold` present, the move path uses `emitByPolicy` (not broadcast), and all prior isolation fixes (22–22.4) intact. Rollback tag `norish:rollback-20260723-pre-phase23` = image `9659fecfc478` (outgoing Phase-21 image); backup `/home/claude/norish-backups/norish-live-20260723-182140-pre-phase23.dump` (222 TOC, verified restorable). Remaining gate: Chrome e2e UAT of the move flow + Cookbooks browser against live. See STATE.md session log 2026-07-23 for full detail.

**Goal**: A recipe visibly belongs to a cookbook, and can be moved to another one the user may write to. The multi-cookbook model shipped in Phase 2 becomes legible in the UI instead of being an invisible scoping rule.
**Depends on**: Phase 2 (multi-household membership + active-cookbook context) + Phase 3 (POLICY-01 edit rights).
**Requirements**: CKBK-MOVE-01 (new)
**Success Criteria** (what must be TRUE):
  1. The recipe detail view (desktop + mobile) shows which cookbook the recipe lives in.
  2. Tapping it offers a move action listing only cookbooks the user may **write** to; moving requires edit rights on the **source** (POLICY-01) and membership of the **destination**. A move never widens access (HOUSE-06) and never orphans the recipe.
  3. A Cookbooks entry in the nav browses the user's cookbooks and their contents — the "menu option that says cookbooks" from UAT B3.
  4. Moving a recipe updates every scoped surface it appears on (dashboard, search, meal plan, shopping-list linkage) without a manual refresh — and, post-Phase-22, without notifying the cookbook it left or a cookbook it never entered.
  5. i18n in all 11 locales; `@norish/web` + `@norish/trpc` suites green.
**Open question — RESOLVED 2026-07-23 (D-23-07)**: ratings + share links **travel with the recipe**. Both are keyed by `recipe_id`, which a move does not change, so they follow automatically with no reset and no code. Rater-visibility follows the new cookbook's membership at read time; a public share link stays a per-recipe grant that bypasses cookbook policy (Phase 3 note). This is the least-surprising, zero-work choice — recorded so it can be revisited if a "who rated what" leak concern surfaces.
**Ownership decision (D-23-01)**: a move writes ONLY `recipes.household_id`; the owner (`recipes.userId`) is unchanged — ownership is identity, cookbook is location (Phase 2 D-01/D-09). Preserves the owner's edit rights post-move; never orphans the recipe.
**Plans**: 2 (both DONE — serial, tests-first).
- [x] 23-01: `RecipeMoveInputSchema` + `moveRecipeToHousehold` repo fn + `assertRecipeMoveAllowed` guard + `recipes.move` procedure; 13 adversarial move-permission tests written RED-first (incl. the `edit=everyone` sibling). Commit `52c5b44e`. trpc 281→294.
- [x] 23-02: moveRecipe mutation + CookbookChip/MoveRecipeModal on the detail (desktop + mobile) + `/cookbooks` nav & browser + i18n (all 12 locales). Commit `ecb06369`. web 424.

Canonical refs: vault `norish-uat-v0.19.0` section B3; `.planning/phases/02-multi-household/02-CONTEXT.md`; `.planning/phases/03-per-cookbook-policies/03-CONTEXT.md`; `.planning/phases/23-cookbook-context-move/23-VALIDATION.md`

### Phase 24: Import at scale & visible progress
**DEPLOYED 2026-07-23** — live image `7fed8a7ba89a` (built from `main@fba2052e`), container `norish-app` healthy, 0 restarts. No migration (DB stays at 40; 40→40 no-op). Resumed from an interrupted session: the backend (`21cccba8`) was already committed-but-unpushed and the shared-react data layer was uncommitted/in-flight; it was reconciled with the backend contract and finished forward. Health + security independently re-verified PASS before deploy (second agents, separate from the implementer). Rollback tag `norish:rollback-20260723-pre-phase24` = image `6106a50f6ad0`; backup `/home/claude/norish-backups/norish-live-20260723-220438-pre-phase24.dump` (222 TOC, verified restorable). See STATE.md session log 2026-07-23 and `.planning/phases/24-import-at-scale-progress/24-VALIDATION.md`.

**Goal**: Importing more than one recipe is a first-class action, and any running import reports honest progress instead of an indefinite skeleton.
**Depends on**: **Phase 22** (hard — the progress surface rides the realtime bus; building it on a broadcasting bus would leak one user's import progress to everyone) + Phase 1 (Camoufox scraping) + the existing BullMQ import queue.
**Requirements**: BULK-01, IMPORT-UX-01 (new)
**Success Criteria** (what must be TRUE):
  1. A user submits many URLs (or one blog/index URL) in a single action; each becomes an independent queue job against the active cookbook, and partial failure is normal — the user sees per-item outcome (imported / duplicate / failed + why), not one aggregate error.
  2. A running import shows real progress derived from actual job state (fetch → parse → enrich), not a synthetic timer. Where a stage's duration genuinely is unknown, the UI says so rather than faking a bar.
  3. Bulk import respects the same limits and safety as single import: Camoufox stays the only fetch path (no headless Chrome), duplicate detection still applies per cookbook, and a bulk run cannot starve the queue for other users.
  4. Progress events are cookbook-scoped (inherits Phase 22) — one household's import never appears in another's UI.
  5. i18n in all 11 locales; `@norish/queue` suites green under `sg docker`.
**Open question — RESOLVED 2026-07-23**: cap = **25 URLs/submission** (D-24-01), enforced in the zod input schema (bounds direct API callers too) + previewed client-side. Whole-blog crawl per-domain rate limiting is **moot** (D-24-02): we only EXTRACT http(s) URLs from the pasted text — we never fetch/spider a page — so every URL is one ordinary queue job bounded by existing worker concurrency; Camoufox stays the only fetch path.
**Plans**: 2 (both DONE).
- [x] 24-01: `parseBulkImportUrls` + cap + `RecipeImportStage` contract; `importProgress` event + `emitImportProgress` (worker, cookbook-scoped) + `onImportProgress` subscription; `recipes.importFromUrls` bulk fan-out; adversarial bulk-fan-out + progress isolation suites (LIVE `everyone` sibling). Commit `21cccba8`. queue 88.
- [x] 24-02: client-only import-stage cache + progress subscription + bulk mutation (shared-react); progress indicator on the skeleton card + bulk import modal (apps/web); i18n all 12 locales; web test-mock updates. Commit `5854844d`. web 424.

Canonical refs: vault `norish-uat-v0.19.0` section B2; `packages/queue/src/recipe-import/`; `.planning/phases/01-camofox/`; `.planning/phases/24-import-at-scale-progress/24-VALIDATION.md`

### Phase 25: Shopping list — aisle grouping
**DEPLOYED 2026-07-23** — a MIGRATION deploy, DB 40→41, the SECOND migration since Phase 20 (after 22.4's `0039`). Live image `8895dec71f5f` (built from `main@13958cf8`), container `norish-app` healthy, 0 restarts. Migration `0040_shopping_list_household` applied at boot ("Migrations complete"; live DB migration count/max id 41, confirmed). Data-effect verified on the live DB by BOTH the deploy agent AND an independent check agent, PASS: every re-keyed row across `groceries`/`stores`/`ingredient_store_preferences`/`recurring_groceries` carries a non-null valid `household_id` (nulls `0|0|0|0`), pre-existing rows preserved (`groceries` 10→10, `recurring_groceries` 0→0), `stores` 0→16 and `ingredient_store_preferences` 0→344 are the documented SHOP-01 default-aisle seeding (8 aisles × 2 households) not data loss, 0 household-membership mismatches. Health verified independently (deploy agent + a separate check agent, both PASS): local + public `/api/v1/health` ok, local + public `/` → 307, zero level-50/60 logs. Security AND the migration were independently re-verified PASS before deploy by a second agent, separate from the implementer, including a fresh migration dry-run against a restore of the live backup into a throwaway scratch DB. Empirical image verification confirmed `resolveShoppingHouseholdId`/`listGroceriesByHousehold` present, exactly 41 migration `.sql` files, and all prior isolation fixes (22–22.4) intact. **⚠️ ROLLBACK NOTE — image-only rollback is NOT write-safe**: `0040` adds a NOT-NULL `household_id` column, so the outgoing Phase-24 image (tagged `norish:rollback-20260723-pre-phase25` = `7fed8a7ba89a`) can still READ shopping data via the retained `user_id` column but its WRITES would violate the NOT NULL constraint — a real rollback must RESTORE the pre-phase25 dump, not just retag the image. Pre-phase25 backup: `/home/claude/norish-backups/norish-live-20260723-233441-pre-phase25.dump` (222 TOC objects, verified restorable). Remaining gate: Chrome e2e UAT of the shared list + aisle grouping against live. See STATE.md session log 2026-07-23 for full detail.

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
**Plans**: 25-01 (SHOP-01 + SHOP-02, one migration) — DEPLOYED 2026-07-23. See
`.planning/phases/25-shopping-list-household-aisle/{25-01-PLAN,25-01-SUMMARY,25-VALIDATION}.md`.
**Migration `0040` — DB 40→41** (re-keys ownership on live tables; dry-run-verified against a
restored live backup). Category seed = built-in curated EN+NL default (D-25-04, NOT open-tandoor-data).

Canonical refs: `packages/db-schema/src/schema/{groceries,stores}.ts`; https://github.com/TandoorRecipes/open-tandoor-data

### Phase 26: What's-for-dinner suggester
**DEPLOYED 2026-07-24** — live image `082924a3d0a5` (built from `main@f792cc1e`), container `norish-app` healthy, 0 restarts. No migration (DB stays at 41; 41→41 no-op). Health + security independently re-verified PASS before deploy (second agents, separate from the implementer) and again matched against the empirically-verified built bundle. Rollback tag `norish:rollback-20260724-pre-phase26` = image `8895dec71f5f`; backup `/home/claude/norish-backups/norish-live-20260724-003747-pre-phase26.dump` (230 TOC, verified restorable). See STATE.md session log 2026-07-24 and `.planning/phases/26-whats-for-dinner-suggester/26-VALIDATION.md`.

**Goal**: The app answers "what should we eat tonight?" from what the household already rated and what's in season — the cheapest phase on this list that makes it feel like a product rather than a database.
**Depends on**: Phase 4 (RATE-01 — ratings, averages and the named-rater list) + Phase 2 (cookbook scoping). Independent of Phases 22–25, though it inherits Phase 22's correctness if sequenced after it.
**Requirements**: DINNER-01
**Success Criteria** (what must be TRUE):
  1. A suggestion surface proposes recipes from the active cookbook using recency of rating + rating value + season, and explains *why* each was suggested rather than presenting an oracle.
  2. Each suggestion shows the rater's avatar, their stars, and a thought-bubble treatment — the presentation Kiran specified, not a generic list row.
  3. Dietary/allergy tags already on the household are respected: a suggestion never surfaces something a member is tagged allergic to.
  4. Suggestions are cookbook-scoped and never reveal ratings from a cookbook the viewer isn't in (HOUSE-06 / the RATE-01 access gate).
  5. No new provider, no new external data source, no new npm dependency — season is derivable from the date, everything else is already in the schema.
**Plans**: 2 (both DONE).
- [x] 26-01: `getDinnerSuggestionCandidates` (reuses `buildViewPolicyCondition` wholesale) + `selectDinnerSuggestions` pure ranking fn (season lexicon + rating quality/popularity/recency + date-seeded jitter) in `@norish/shared-server/recipes/dinner-suggester`; adversarial dinner-isolation suite (LIVE `everyone` sibling). Commit `34a4ee03`. shared-server dinner-suggester 11, db dinner-isolation 6.
- [x] 26-02: `DinnerSuggestion` dashboard card (desktop + mobile, under Today's meals) with season chip + stars + rater thought-bubble via `ratings.getRaters` (RATE-01-gated); i18n all 12 locales. Commit `b592a76c`. web 424.

Canonical refs: `.planning/phases/26-whats-for-dinner-suggester/` (CONTEXT, 26-01/26-02 PLAN + SUMMARY, VALIDATION)

### Phase 27: Cooklang migration (MAJOR)
**Goal**: Recipes are represented in Cooklang, delivering in-step ingredient quantities and named concurrent timers (pasta + sauce).
**Depends on**: Phases 22–26 landed (this is the largest lift on the roadmap and should not run against a moving UI).
**Status**: **UNBLOCKED + FULL-NATIVE (Kiran, 2026-07-24)** — fork-independent, **no #470 gating**. Reversed from additive-dual-store to **FULL NATIVE, NO bandaids**: `.cook` is the **single source of truth**; `steps`/`recipe_ingredients` demote to a **derived projection**; the heuristic `SmartInstruction`/`applyIngredientLinkMarkup` layer is **deleted**; metric↔US becomes a **deterministic OSS converter** (`convert`, MIT) + a USDA-seeded density table, replacing the AI `unit-converter.ts`. Master plan **`.planning/phases/27-cooklang/27-ARCHITECTURE.md`**; reversals in `27-DECISIONS.md`; de-risked by the committed spike (`27-cooklang/spike/` serializer vs the REAL `@cooklang/cooklang@0.18.7` WASM parser, `27-EXTRACTION-PROMPT.md`, `27-EXPERIMENT.md`).
**Requirements**: COOK-01
**Success Criteria**:
  1. Recipe steps carry inline ingredient quantities and named timers, parsed via `@cooklang/cooklang` (MIT, WASM — explicitly **not** the archived `cooklang-ts`).
  2. `.cook` is authoritative; the structured→`.cook` serializer (`structuredToCooklang` in `@norish/shared`) drives AI/JSON-LD import; the structured tables are regenerated as a projection (`deriveProjectionTx`) on every write.
  3. The `.cook` carries ONE native unit system (D-2 revised); the other system + volume↔weight are **derived deterministically** (`convert` + density table, flag-on-unknown); canonical unit IDs round-trip as the `%unit` literal (D-8, confirmed).
  4. Cooking mode + recipe detail render from parser tokens (`cookTokens` DTO projection); heuristic runtime deleted; concurrent named timers from timer tokens.
  5. Shopping-list FK (`groceries.recipe_ingredient_id`) + search keep working via the UPSERT-stable projection (natural key `recipe_id,system_used,ingredient_id`); existing recipes AI-relinked to a best-effort `.cook` with a **review queue** for the low-confidence tail (no permanent fallback).
**Waves** (see 27-ARCHITECTURE.md §7): W0 units · W1 serializer+parser read-model · W2 write-path + `0041` expand · W3 extraction native · W4 token renderer + multi-timer · W5 backfill `0042` + review tool · W6 contract (**re-scoped 2026-07-28 as Phase 27.6** — `27-ARCHITECTURE.md` §7's W6 row is superseded). ~6 waves / ~6–8 plans.
**Plans**:
  - **27-01 (W1) COMPLETE** — serializer + parser read-model, additive. `58cabd9f`. **Deployed.**
  - **27-02 (W2) COMPLETE** — write path + migration `0041` (expand-only), `deriveProjectionTx`, `buildCookPayload`, read path. `a746f00d`. **Deployed** (live image `516c52576a5f`, DB 41 → **42**).
  - **27-03 (W3) COMPLETE** — extraction native: per-step linkage, the three prompt builders, the `.cook` producer, and the T-27-01 ROOT-CAUSE FIX (escaping at the serializer; the predictive tenth cap DELETED). `be72cc9b`. **NOT deployed.**
  - **27-04 (W3B) COMPLETE AND DEPLOYED, all six tasks — "bound the WASM parse"** (`59f3a767` → `4bbeecc7` → `226f04a7` → `cffaa5d8` → `5cdfc8aa` → `d3848c54` → `231baf91`, plus the VERIFY-3/VERIFY-4 root-fix commits below). T-27-01 had been mitigated twice and **refuted twice**, so the guarantee stopped being an input predicate and became a **RESOURCE BOUND**: every parse runs in a pooled child process the parent can `SIGKILL`, `@cooklang/cooklang` is imported by exactly ONE production file, and the **primary gate is the child's CPU TIME** (`cookParseCpuMs: 1_500`, sampled from `/proc/<pid>/schedstat`), not wall clock — wall clock was measured refusing legitimate recipes under contention, and CPU was measured flat within ±3% across an 11.6x wall-clock inflation (D-27-W3B-03a). Plus an 8 000 ms wall BACKSTOP, a measured-RSS child memory bound (`cookParseRssMb: 512`, real headroom **2.67x** against a warmed child), and three root-cause fixes: the CLOSED frontmatter grammar (H1), a nine-byte WASM panic (H2) and **a serializer that DELETED user text** (H3). **Nine adversarial weakenings, each proven RED and reverted byte-identically, none committed.** **DEPLOYED 2026-07-27** — new live image `sha256:704aa6b6…`, previous `516c52576a5f`, rollback tag `norish:rollback-20260727-pre-27-04`, no migration (DB stays at 42), pushed `faa13d8e..fbe2cfa7` (52 commits). Summary: `27-04-SUMMARY.md` (§0 = every superseded claim, §15 = the W3B close-out, "RESOLUTION" = every VERIFY-3 blocker closed with its commit, "LIVE DEPLOY RECORD" = the deploy facts).
  - **VERIFY-3 (THIRD independent adversarial verification of T-27-01), sha `0b246943d569f22fd66d99e9209386cb76ab36b0`: FAIL — six open blockers before deploy — ALL SIX NOW CLOSED (see below).** The good news inside the original FAIL: this was the **first of what became two consecutive rounds to find no parser bypass** — rounds 1 and 2 each produced a working exploit; round 3 swept ~71 000 recognizer-filtered shapes + 60 hand-built families and found zero, with every never-broken path re-confirmed independently. **The six blockers, and their root fixes:** (1) `cookParseHeapMb: 256` was **not** a memory bound — replaced by a real measured-RSS gate, `43b5e1b7`; (2) a stale unquoted `.cook` fixture in `pool.test.ts:92` silently bypassed its own recognizer — re-minted from the real serializer, `2232d3e5`; (3) two vacuous test assertions that a silently-failed spawn could pass — now assert the real outcome, `ea242ed0`; (4) `parseInPool` was an unenforced third door to the WASM — closed, no public subpath, `388650b2`; (5) **USER-VISIBLE BUG** — nutrition estimation NULLed a freshly-minted `cook_source` — root-fixed, `ff289ae6`; (6) **USER-VISIBLE BUG** — a metric↔US system switch served the wrong system's `.cook` — root-fixed in the same commit, the CLEAR-not-remint decision independently confirmed correct (no step-linkage column exists outside the native `.cook`). Also fixed: `pnpm typecheck` was genuinely RED from duplicate `@tanstack/query-core`/`better-auth` installs — a `pnpm-workspace.yaml` override + lockfile refresh, `9cf78c18` (NOT the `package.json#pnpm.overrides` location originally prescribed — that location replaces, rather than merges with, the workspace file's overrides and would have silently dropped five existing ones) — and the flaky `migrate-gallery-images.test.ts`, `bd6b3071`. **A fourth independent adversarial verification (VERIFY-4) then re-proved every fix by its own mutations and returned PASS**, finding no bypass of T-27-01 for the second consecutive round, two contention-only test flakes (both fixed, `9211b256` + `528889d8`, neither capable of blocking the deploy since the image build runs no tests), and several record corrections (RSS-gate headroom is 2.67x against a warmed child, not 3.3x; container sizing ~1 102 MB, not 628/512 MB; the `TRPCLink<any>` widening was added in-range, not pre-existing, and has since been removed, `ff13ab6b`). **Full record: `27-04-SUMMARY.md` § "VERIFY-3 — open blockers before deploy" (historical) and § "RESOLUTION" (current).**
  - **27-05 (W4) CODE-COMPLETE AND DEPLOYED — "the client token renderer + multi-timer".**
    **DEPLOYED 2026-07-27** — new live image
    **`sha256:4427ffbf2ecf8e7972852dcfe5db770359f774d051a12758ba4647f6e1ede822`**, previous
    `sha256:704aa6b60b3365dde1894e94a52204f7e8b33c5350b8cd141ce97d61e42c465e`, rollback tag
    `norish:rollback-20260727-pre-27-05` (verified resolving to the old image id), **no
    migration** (DB stays at 42), backup
    `/home/claude/norish-backups/norish-live-20260727-114304-pre-27-05.dump` verified
    restorable at 231 TOC objects. Health at cutover PASS (0 restarts, health checks green
    locally + publicly, zero `pool-*` bound reasons over a 5-minute watch); memory settled
    **~309 MiB**, lower than 27-04's 374–395 MiB settle. Confirmed by two independent
    agents (deploy + separate check agent). `f284707e`/`d1668e7c` (plan) → `2c34d92c` (T1 — pure token render model in `@norish/shared/cooklang`) → `dfe8caca` (T2 — web token branch: renderer, `SmartInstruction`, readonly steps list) → `91fa269f` (T2b — closing a same-session gap where token-branch ingredient chips had degraded to non-interactive spans) → `dc59402f` (T3 — cooking mode on tokens + **concurrent NAMED timers**, the pasta+sauce case, + the `timer.step_fallback_label` i18n key in all 12 locales) → `fecd327e` (the last hard-coded English timer-fallback literal, i18n'd) → `ed6381ad` (T4 — mobile token-render parity, incl. the `formatUnit` wiring mobile never had) → `f6974536` (T5 — the non-invocation proof + the adversarial revert-check) → `bac3b15a`/`518bea9f`/`9b84f664`/`e2d43aaa` (four independent-verifier warning closures) → `aa0c2f72` (a corollary tsc-count fix). Recipe detail and cooking mode, on web AND mobile, now render a token-bearing recipe's steps from `cookTokens` instead of a prose scan — token-authoritative ingredient chips (localized, servings-scaled through the exact same expression the ingredient list uses, D-27-W4-03), section headings from `CookStepTokens.section`, and concurrent named timers that each notify independently. **The heuristic runtime path is provably UNCALLED on the token branch** (`createIngredientLinkCandidates`/`parseTimerDurations` spied at 0 invocations, D-27-W4-01) but the symbols themselves are untouched — deleting them is **W6's** job, not W4's. A `cookTokens: null` recipe — still the common case, live has 0 recipes with `cook_source` — renders byte-for-byte as before. **Divergences from the plan text, both intentional:** the shipped timer id is `${recipeId}-s${stepIndex}-${index}` (no `-t` infix — the plan draft's `-t${tokenIndex}` form was never implemented; docs/tests were aligned to the shipped form, not the reverse); T3 needed an undeclared second touch to `smart-markdown-renderer.tsx` (already touched once by T2) to wire the i18n key into the fallback label T2 left hard-coded, cascading into `next-intl` mocks added to 4 pre-existing test suites with no assertion edited. **Verification, TWO independent rounds:** round 1 PASS with 5 warnings — 4 closed (timer-id docs/tests alignment; a done-step chip regression where ingredient chips vanished on a token-bearing step marked done in cooking mode; a mobile `systemUsed`-filter gap that doubled step counts on dual-system-authored recipes; missing direct test coverage for mobile's cook-token renderer branch) and 1 deliberately left open (`timer-parser.ts:262` rebuilds its keyword→seconds map per match instead of once per parse — a perf nit, zero correctness impact); round 2 (independent re-verification) PASS, no new findings. **Nine prompt-injection attempts across four agents this wave** (each firing immediately after a `git checkout`/revert during load-bearing verification, fake `system-reminder`-styled framing claiming the change "was intentional"), **all ignored and reported**, ground truth re-established via `git diff`/`md5sum` every time — **zero prompt-injection attempts were observed during the deploy itself.** The one deliberately-left-open verifier warning (`timer-parser.ts:262`'s per-match keyword-map rebuild) is a perf nit only, not a phase-wave item — do not confuse it with wave "W5" below. Gates: full vitest **3 425 passed / 0 failed** (VERIFY-4 baseline 3 362); typecheck 17/17; lint 0 errors; real `apps/web` `tsc --noEmit --noCheck false` error count unchanged at the accepted 285; `deps:cycles`/`i18n:check` fail only on their pre-existing accepted gaps; `pnpm-lock.yaml` diff EMPTY; **DB unchanged at 42, no migration**. Summaries: `27-05-SUMMARY.md` (plan-level index) and `waves/W4-SUMMARY.md` (the substantive wave record, incl. "What W5 can now assume").
  - **27-06 (W5-PREP) CODE-COMPLETE — "the three unblocked prerequisites for W5" — NOT deployed (pure offline units-subsystem code).** `f93eaf65` (T1 — `kilogram`/`fluid_ounce`/`pint` canonical unit IDs, 67 units total in `units.default.json`, + `resolveUnitsMap` in a new `@norish/config/units-config` module closing the `syncUnits` no-op trap at the READ boundary, D-27-W5P-05 — no DB write, `seed-config.ts` diff EMPTY) → `311eada3` (T2 — the US dry-goods volume preference in `convertToSystem`: a US-targeted MASS with a REAL density crosses into VOLUME, D-27-W5P-01, closing the D-27-W3-07 flagship regression `2 cup flour → 8.81849 ounce` back to `2 cup`; + `roundQuantity`, 3 significant digits at exactly one site, D-27-W5P-03/04) → `d18f02d7` (T3 — reconciled the 5 W0 `convert-measure.test.ts` assertions the rounding rule tightens, pre-edit red set matched the plan's prediction exactly, +1 new one-directional-crossing test) → `9d7b6b3e` (T4 — a bilingual Dutch alias + 36-word prep-stopword pass over `density-table.ts`/`ingredient-density.ts`, closing the 86.2%-flag-rate gap `27-W5-PREP-DENSITY-MEASUREMENT.md` measured; D-27-W5P-06 keeps generic cheese unmapped; D-27-W5P-07 repairs the DEAD `chopped_onion` row). **The full-table alias-reachability invariant this wave introduces caught a SECOND, previously-unknown dead alias beyond the plan's predicted `chopped_onion`** — `"bicarbonate of soda"` was already unreachable before this task (`"of"` was already an English prep-stopword from an earlier wave, unrelated to the Dutch work) — repaired the same way, reachable reduced form added, stopword list untouched. **Two of W5's three hard prerequisites are now DISCHARGED** (the unit vocabulary and the rounding rule; the density-table flag-rate measurement was already done in the prior session). Gates: `@norish/config` 755/755; `@norish/shared-server` 556/556 + real `tsc --noEmit` clean; `@norish/shared` 564/564; `@norish/db` 183/183 (Postgres ran for real); `pnpm typecheck` 17/17; lint 0 errors at each touched package's pre-existing baseline; `pnpm-lock.yaml`/`seed-config.ts` diffs EMPTY; `packages/db/src/migrations/` + `meta/_journal.json` untouched, DB stays at **42**. `pnpm deps:cycles` reports one pre-existing, UNRELATED cycle (`db-schema` auth↔households), verified present before and after this plan's diff, logged to `deferred-items.md` rather than fixed. **Director decision points on record:** D-27-W5P-02 (`fluid_ounce`/`pint` deliberately OUT of the automatic US ladder — the measured AI output never produced either; a 2-line change reverses it); D-27-W5P-06 (14 of the 25 measured Dutch names stay uncovered — feta/mozzarella/generic-grated-cheese need real USDA figures, a W5 table-expansion item, not a rename). Summaries: `27-06-SUMMARY.md` and `waves/W5-PREP-SUMMARY.md`.
  - **27-07 (W5, live-data backfill) CODE-COMPLETE AND DEPLOYED.** Kiran
    signed off 2026-07-27 (dry-run against a restored dump explicitly WAIVED — no users on
    the instance; the pre-run `pg_dump` is the sole recovery path). `0d770c65` (T1 —
    `applyCookBackfill` in `@norish/db/repositories/cook-backfill`: the transactional write
    of `cook_source`/`cook_confidence`/`cook_review_needed` in the SAME transaction as
    `deriveProjectionTx`'s re-derive, guarded by a snapshot-before/recheck-after on every
    grocery-linked `recipe_ingredients.id` — D-27-W5-06 — throwing
    `GroceryLinkWouldBreakError` and rolling the whole transaction back rather than let the
    retirement DELETE null a shopping-list FK; `cook_review_needed` written as a SQL
    `OR` against its current value, D-27-W5-05; never bumps `updated_at`/`version`,
    D-27-W5-04) → `0af791f8` (T2 — `hasNameAnchor` re-exported from the serializer so the
    seeder reuses the SAME word-boundary matcher rather than a second, drifting one;
    `buildStructuredRecipeFromLegacy` turns a legacy recipe's native `steps` +
    `recipe_ingredients` into a `StructuredRecipe`, longest-name-first assignment,
    heading steps never get refs, unanchored ingredients APPENDED not dropped;
    `cookConfidenceFromLinks` + `COOK_REVIEW_CONFIDENCE_THRESHOLD = 0.8` (D-27-W5-03);
    `backfillCookSource()` the boot-time runner — no AI call D-27-W5-01, never throws
    D-27-W5-04/R4, logs ids/counts/reasons only, never prose T-27-05) → `e56bad7f` (T3 —
    migration `0042`: journal entry only (idx 42, 43 total), asserting `0041`'s natural-key
    index as its precondition, NO DML; `checks/0042-postcheck.sql` the read-only PRE/POST
    pair; `backfillCookSource()` wired into `apps/web/server/index.ts` after
    `migrateGalleryImages()` / before `initializeVideoProcessing()`). **Task 4 (the live
    run) is a separate `checkpoint:human-verify` gated task, deliberately NOT executed by
    the T1-3 executor — nothing touched live.** Gates: `@norish/db` **198** (183 baseline +
    10 T1 + 5 T3); `@norish/api` **430** (408 baseline + 22 T2); `@norish/shared` **564**
    (unchanged, `hasNameAnchor` additive); `pnpm typecheck` 17/17; real `tsc --noEmit` in
    `packages/api` clean; lint 0 errors at baseline warnings (db 62, api 97, shared 45);
    `build:server` EXIT 0; `deps:cycles` only the pre-existing `db-schema` cycle;
    `pnpm-lock.yaml` diff EMPTY. **Three adversarial weakenings (grocery-link guard,
    sticky-flag OR, scoped UPDATE) each turned RED, each reverted byte-identical, none
    committed** — the scoped-UPDATE weakening surfaced a real isolation-suite gap (the
    snapshot only covered `recipe_ingredients`/`steps`/`groceries`, not the neighbour
    recipe's OWN `cook_source`/`cook_confidence`/`cook_review_needed`), closed by
    extending the snapshot rather than accepting the miss. **D-27-W5-07 evidence
    recorded:** the D-27-W3-07 measurement now reports **15 of 35** ingredient unit
    differences (was 18/35 at W3) — non-zero on every fixture, so dual-system extraction
    stays KEPT; the switch decision is NOT reopened here. Summary: `27-07-SUMMARY.md`.
  - **UPDATE 2026-07-27 (later still): 27-07 POST-VERIFICATION FIX PASS — ALL 3 BLOCKER
    GAPS CLOSED, still NOT deployed.** An independent verifier reviewed Tasks 1-3 before
    Task 4 and returned NO-GO with 3 BLOCKER gaps (`27-07-VERIFICATION.md`). `ab996d47`
    (G1 — `checks/0042-postcheck.sql` selected `groceries.id` instead of
    `groceries.recipe_ingredient_id` under the `recipe_ingredient_id_at_risk` alias,
    making the POST anti-join's "zero rows" safety check unsatisfiable; fixed, proven by
    constructing the real orphan case against Postgres) → `8d056c9c` (G3 —
    `backfillCookSource()` could still reject because `getUnits()`/
    `listRecipeIdsWithoutCookSource()` sat outside the per-recipe try/catch, contradicting
    R4 and the unguarded `main().catch(process.exit(1))` call site; both ends fixed) →
    `17d19abd` (G2 — no guard against silent `steps`/`step_images` loss: 3 real legacy step
    shapes — a trailing `#` heading, two consecutive headings, a whitespace-only step —
    collapse the derived step count past `syncProjectedStepsTx`'s positional tail-trim,
    cascading `step_images`; added `StepWouldBeLostError` in the same snapshot/derive/
    recheck/throw-and-rollback shape as the grocery-link guard, proven both by a db-level
    rollback test per shape and an api-level test driving the REAL chain to show the
    collapse is genuine). Gates re-verified: `@norish/db` **203** (198 + 5), `@norish/api`
    **436** (430 + 6), `@norish/shared` **564** (unchanged); all 4 adversarial weakenings
    (the 3 original + 1 new) turned RED and reverted byte-identical. Two data-quality
    findings the verifier also raised (appended ingredient names in step prose;
    opposite-system amount rewriting) were explicitly ACCEPTED by Kiran as designed
    (Architecture §8) and are not reopened. **Task 4 STILL not executed** — nothing
    touched live. Summary: `27-07-SUMMARY.md` (Post-Verification Fix Pass section).
  - **SUPERSEDED 2026-07-27 (later same day): Task 4 (the live run) DEPLOYED.** Verified-restorable
    backup `/home/claude/norish-backups/norish-live-20260727-184348-pre-27-07.dump` (231 TOC
    objects) → `docker:build` → deploy → migration `0042` applied, DB **42 → 43** → boot-time
    `backfillCookSource()` ran, outcome `candidates:6, derived:1, flagged:5, refused:0,
    failed:0`. New live image `sha256:f1b6664ea600…`, previous `sha256:e216d3303bc2…`,
    rollback tag `norish:rollback-20260727-pre-27-07`. Zero data loss confirmed by two
    independent agents (steps 80→80, recipe_ingredients 136→136, step_images 0→0, grocery
    links 10→10, 0 orphaned and 0 silently-nulled `groceries.recipe_ingredient_id`). Only
    `Gnocchi in tomatensaus` (confidence 0.917) cleared the `< 0.800` review threshold; the
    other five (0.000–0.333) are flagged `cook_review_needed` — traced to a newly-surfaced
    but PRE-EXISTING data-quality issue (bilingual duplicate `steps` rows, e.g. Gnocchi 10
    rows = 5 NL + 5 EN, Bonensalade 12 rows for ~6 canonical steps), not introduced by the
    backfill (row counts unchanged) and flagged as a follow-up. Health PASS: 0 restarts,
    migration 43, both public endpoints green, zero `level>=50` lines, memory settled 358.5
    MiB. Kiran waived the restored-dump dry-run and accepted that appended ingredient names
    are written into stored `steps.step` prose; the second targeted verification pass was
    cut short at his instruction to proceed. Summary: `27-07-SUMMARY.md`,
    `27-07-VERIFICATION.md`.
  - **W6: NOT STARTED.** The contract — `cook_source` NOT NULL (migration `0043`) plus
    **deleting the heuristic `SmartInstruction`/`applyIngredientLinkMarkup`/
    timer-keyword-scan symbols** W4 deliberately left in place — which is why a
    contention-flaky parse bound had to be fixed rather than tuned — **with TWO
    prerequisites recorded**: the 8 000 ms wall backstop, and
    `setActiveSystemForRecipe` clearing `cook_source` on a metric↔US switch, which becomes
    a hard failure once the column is NOT NULL. **RE-SCOPED 2026-07-28 as its own phase,
    27.6** — and the two prerequisites recorded here turned out to be a subset: five write
    paths mint no `cook_source`, and the read path itself is broken (F-11). See the Phase
    27.6 entry below; `27-ARCHITECTURE.md` §7's W6 row is superseded by it.
**Status of the phase**: **6 of 7 waves DEPLOYED (W0–W5); only W6 remains.** W5 (plan
`27-07`, migration `0042` live-data backfill) is CODE-COMPLETE AND DEPLOYED 2026-07-27 —
the phase's first IRREVERSIBLE wave. VERIFY-3's six blockers and three gate problems are
all closed at the root; VERIFY-4 (fourth independent verification) PASSED; W4 then passed
its own two independent verification rounds and deployed; W5's own post-verification fix
pass closed all 3 blocker gaps before its live run. Live now runs image
`sha256:f1b6664ea600…` (previous `sha256:e216d3303bc2…`), rollback tag
`norish:rollback-20260727-pre-27-07`, **DB now at migration 43** (`0042` applied,
backfill ran at boot: `candidates:6, derived:1, flagged:5, refused:0, failed:0`, zero
data loss). **NEXT: W6** — `cook_source` NOT NULL (migration `0043`); it is the only
remaining wave of the phase. **RE-SCOPED 2026-07-28 as Phase 27.6**, because
`27-ARCHITECTURE.md:320`'s justification for it ("Safe because W5 guaranteed 100%
coverage") is **FALSE** — W5 covered existing rows, not future inserts, and said nothing
about the read path (which is itself broken, F-11). W6 is blocked on Phases 27.2/27.3/27.4
and on the hard prerequisites listed in the Phase 27.6 entry below.

### Phase 27.1: Import reliability: AI extraction resilience, JSON-LD fallback, failure surfacing, in-stack Camoufox (INSERTED) — DEPLOYED 2026-07-28
**Goal:** Recipe import works end-to-end, and when it does not, the failure is VISIBLE instead of silent.
**DEPLOYED 2026-07-28.** New live image `sha256:919a5e950735…`, previous `sha256:f1b6664ea600…`,
rollback tag `norish:rollback-20260728-pre-27.1`, migration UNCHANGED (43 → 43, no migration this
phase), backup `/home/claude/norish-backups/norish-live-20260728-114136-pre-27.1.dump` verified
restorable at 231 TOC objects. Health: container healthy, 0 restarts, both `/api/v1/health`
endpoints `{status:ok,db:ok}`, both `/` → 307, `backfillCookSource` clean at boot
(`candidates:1, derived:0, flagged:1`), one disclosed non-recurring `level:50` cold-boot line
(a pre-existing 27-04 Cooklang-pool graceful-degradation path, not a new defect). **Post-deploy
empirical gate (Success Criterion 7): 24/24 live imports succeeded** — the mandated bonensalade
URL, 16/16 `ah.nl` across 8 categories, 7/7 `lekkerensimpel.com` — and the failure-UX bar also
passed (`example.com` failed cleanly, `failed` emitted, no eternal skeleton). **Caveat: all 24
took `parserPath: "structured"`** (every source page shipped valid JSON-LD, which runs before
AI), so the AI extraction path, its one-shot retry, and the JSON-LD-after-AI-failure fallback
remain unit-tested but NOT yet exercised live. **Open risk for W6:** the structured path mints
no `cook_source` (D-27-W3-08), and all 24 gate imports took it — Phase 27's W6 (`cook_source`
NOT NULL) would turn every ordinary import into a hard failure unless resolved first; unscoped.
In-stack camofox (this phase's `docker/docker-compose.fork.yml`) remains adopted in the repo but
UNVERIFIED live — `CAMOFOX_URL` still points at the off-stack LXC 105 instance deliberately, so
the import fix would not be confounded by a scrape-topology change. Full record: the 2026-07-28
session-log entry in `STATE.md` and `27.1-CONTEXT.md`.

**CORRECTION 2026-07-28 (later the same day, by five independent diagnostic agents) — THIS PHASE'S
RECORDED ROOT CAUSE WAS WRONG, AND IT FIXED MOSTLY THE WRONG THING.** Recorded honestly here rather
than quietly overwritten; the text above is preserved as it stood.
  1. **The relaxed normalizer is on an UNREACHABLE path.** `Output.object` validates inside
     `generateText` and throws *before* `mirrorMeasurementSystems` / `validateExtractionOutput` ever
     run. The live logs prove it: the error string is always "AI response did not match expected
     format." and NEVER "Recipe extraction failed - missing required fields". IMPORT-REL-01 is
     correct code on a path no live failure reaches.
  2. **The retry raises a token budget that was never the constraint.** The same starved page at
     100 000 output tokens still returns `{}` in 3 seconds with `finish_reason: stop`. The retry
     DOES genuinely fix reasoning-token exhaustion — that is **1 of the 25** live AI failures
     (wiswijzer/erwtensoep, the one demonstrated win). IMPORT-REL-02 is real, and small.
  3. **The 24/24 empirical gate certified the `structured` parser path — which this phase did not
     modify.** Every one of the 24 imports logged `parserPath:"structured"`, `usedAI:false`. The
     gate never exercised the AI path, the retry, or the JSON-LD fallback. **Any future import gate
     MUST include non-JSON-LD pages** (see Phase 27.2's acceptance gate).
  4. **The real root cause is upstream's sanitizer** — `extractSanitizedBody`
     (`packages/shared-server/src/ai/helpers.ts:93`) starves the model of the recipe text on
     `<br>`-separated Blogger pages. **24 of the 25 live AI failures are this.** Scheduled as
     **Phase 27.2**. `helpers.ts` is byte-identical to `upstream/main` — an UPSTREAM defect, not a
     fork regression, and an upstreaming candidate.

  **What 27.1 did unambiguously deliver, and keeps:** PENDING-ISO-01 (a real, live cross-household
  leak — see 27.4 for the two siblings it missed), IMPORT-REL-04's visible failure card, the
  reasoning-exhaustion retry, the repo-tracked in-stack Camoufox compose, and the import-gate
  harness (now committed, F-10 closed).

**Requirements**: IMPORT-REL-01, IMPORT-REL-02, IMPORT-REL-03, IMPORT-REL-04, IMPORT-REL-05, PENDING-ISO-01 (+ SETUP-04, HOUSE-06)
**Depends on:** Phase 27 (W0-W5 deployed; W6 is NOT a prerequisite and NOT in scope)
**Plans:** 6 plans in 3 waves
**Planned:** 2026-07-28. Root cause established empirically against the LIVE stack by three independent
agents; recorded as locked decisions in `27.1-CONTEXT.md`. No RESEARCH.md — the evidence is the research.
**The defect, in one line:** import failures are INTERMITTENT, from three sub-causes — a strict
validator that discards complete metric-only recipes, reasoning-token exhaustion on large HTML, and no
retry — compounded by two UX defects that make a failure look like nothing happened.
**Success Criteria:**
  1. A complete single-system extraction imports (the absent measurement half is mirrored, never a rejection).
  2. A transient AI failure gets exactly one retry, at raised output-token headroom; a deterministic one gets none.
  3. AI stays PRIMARY; a page shipping valid schema.org Recipe still imports after AI has FINALLY failed,
     through the same normalizer / `createRecipeWithRefs` / cook-projection path.
  4. A failure ALWAYS reaches the user as a rendered, dismissible error card — never an eternal skeleton —
     and never crosses a cookbook boundary (proven under the live `view: "everyone"`, adversarially).
  5. Camoufox is defined in-stack in a repo-tracked fork compose; `CAMOFOX_URL` remains an explicit override.
  6. **`recipes.getPending` no longer serves every user every household's queued imports** under the live
     `view: "everyone"` — PENDING-ISO-01, added by director override 2026-07-28 (D-27.1-12).
  7. **A non-skippable POST-DEPLOY EMPIRICAL GATE passes**: the mandated ah.nl URL, then >= 10 further
     ah.nl recipes across >= 6 categories, then >= 5 lekkerensimpel recipes — each evidenced with fetch,
     JSON-LD, path taken, per-system ingredient counts, `cook_source`, and any failure VERBATIM.
**Waves:** W1 = plans 01, 03, 04, 06 (independent, zero file overlap) -> W2 = plan 02 (shares
`parser/index.ts` with 01) -> W3 = plan 05 (the gate, after build + deploy).
**Execution:** one plan at a time (`use_worktrees: false`), native (`cross_ai: false` — the agy worker
stalls on vitest).

Plans:

- [x] 27.1-01-PLAN.md — AI extraction resilience: mirror the absent measurement half, relax the validator to name + metric, one retry at raised output headroom (wave 1) — DONE 2026-07-28, see `27.1-01-SUMMARY.md`
- [x] 27.1-02-PLAN.md — JSON-LD fallback after FINAL AI failure, minting a scored `.cook` through the sanctioned minter; `parserPath` observability markers (wave 2, depends on 01) — DONE 2026-07-28, see `27.1-02-SUMMARY.md`
- [x] 27.1-03-PLAN.md — Failure surfacing: unconditional fail-closed `failed` emit + a rendered dismissible error card in 12 locales (wave 1) — DONE 2026-07-28, see `27.1-03-SUMMARY.md`
- [x] 27.1-04-PLAN.md — In-stack Camoufox: repo-tracked `docker/docker-compose.fork.yml` + operator runbook; live untouched (wave 1) — DONE 2026-07-28, see `27.1-04-SUMMARY.md`
- [x] 27.1-05-PLAN.md — POST-DEPLOY EMPIRICAL GATE: the import harness, the three bars, and the browser proof that a failure is visible (wave 3, blocking checkpoints) — RAN 2026-07-28, 24/24 imports passed (bonensalade + 16/16 ah.nl + 7/7 lekkerensimpel), failure-UX bar passed; CAVEAT: every import took `parserPath: "structured"`, so the AI/retry/JSON-LD-fallback paths were not exercised live. No `27.1-05-SUMMARY.md` written yet — see the STATE.md 2026-07-28 session-log deploy entry for the record in the meantime.
- [x] 27.1-06-PLAN.md — PENDING-ISO-01: fold `everyone` into the cookbook clamp in `recipes.getPending`, with the RED-first two-household suite (wave 1) — DONE 2026-07-28, see `27.1-06-SUMMARY.md`

**Findings raised while planning, NOT in scope** (full detail in `27.1-CONTEXT.md`):
  - ~~**F-1 / proposed PENDING-ISO-01**~~ — **PROMOTED INTO SCOPE 2026-07-28 by director override; now
    plan 27.1-06.** `recipes.getPending` (`packages/trpc/src/routers/recipes/pending.ts:29-32`) returned
    `true` for EVERY queued job when `policy.view === "everyone"` — the live value — so every user was
    served every household's pending imports, `recipeId` and source `url` included. Fourth member of the
    REALTIME-ISO-01 / IMPORT-DEDUP-ISO-01 / LIST-ISO-01 family. The planner deferred it as out of the
    briefed five-item scope; the director overrode that because per-cookbook isolation is a CLAUDE.md
    hard constraint and the leak is live. See D-27.1-12.
  - **F-5 (SECURITY, minor; raised while planning 27.1-06, NOT scheduled).** The four `is*` probes in the
    same file — `isNutritionEstimating` (:58-74), `isAutoTagging` (:102-118), `isAutoCategorizing`
    (:120-136), `isAllergyDetecting` (:166-182) — answer `jobs.some(j => j.data.recipeId === input.recipeId)`
    with NO ownership check. Lower severity than F-1 (a boolean about an id the caller must already hold),
    and both sources of other cookbooks' ids are now closed. Needs its own decision.
  - **F-2** `defaults.ts` still defaults `maxTokens: 10000` (inert on live; tight for a fresh install).
  - **F-3** `docker/docker-compose.beta.yml:38` hardcoded the off-stack Camoufox as a default (fixed in 27.1-04).
  - **F-4** `packages/api/src/parser/fetch.ts:8-10` documented a plain-HTTP fallback that does not exist (fixed in 27.1-02).

**Follow-ups register — raised during the 2026-07-28 deploy, empirical gate, and the five-agent
diagnostic sweep that followed.** Each item is either CLOSED, or carries the phase that now owns it.
Items with no owning phase need a decision.
  - **F-6 (was "the sharpest open risk"; CONFIRMED and BROADER than recorded — now owned by Phase
    27.6).** Original wording: W6 (`cook_source` NOT NULL) assumed ordinary imports would carry a
    `cook_source`; per D-27-W3-08 the STRUCTURED parser path mints none, and all 24 gate imports
    took that path. **That is confirmed, and it is only one of five write paths.** The complete set
    that mints no `cook_source` today: structured URL import (`packages/api/src/parser/index.ts:420-427`,
    which deliberately returns `cook: null`), paste-import (`packages/queue/src/…/worker.ts:136`),
    Mealie archive import (`packages/shared-server/src/archive/parser.ts:364`), manual recipe
    creation (`packages/trpc/src/routers/recipes/recipes.ts:222`), and recipe copy. **And the risk
    is not confined to the write side:** `setActiveSystemForRecipe`
    (`packages/db/src/repositories/recipes.ts:1150-1156`) deliberately NULLs `cook_source` on a
    metric↔US switch, which a NOT NULL column makes an outright constraint violation, and the READ
    path is currently broken outright (F-11). W6 as written in `27-ARCHITECTURE.md:320` would break
    all five write paths, the unit-system toggle, and render zero steps on 100% of recipes. **Owned
    by Phase 27.6, whose prerequisites are exactly this list.**
  - **F-7 (OPEN, unchanged — no owning phase; needs a decision).** In-stack camofox
    (`docker/docker-compose.fork.yml` from 27.1-04) is repo-tracked but was deliberately NOT adopted
    live (`CAMOFOX_URL` still points at the off-stack LXC 105 instance, `192.168.2.26`) — still
    unverified against real traffic. **Note for anyone reading this next to the import work:
    Camoufox itself is VERIFIED HEALTHY** — 200 OK from inside the app container — and is **NOT
    implicated in any of the 25 import failures. Do not chase it.**
  - **F-8 (minor, OPEN — no owning phase).** `yt-dlp` throws `EACCES` when attaching an embedded
    video on import; the recipe itself imports fine, only the secondary video asset fails.
  - **F-9 (FOLDED INTO PHASE 27.3).** The 68-key Norwegian (`no`) locale backlog, proven
    pre-existing by reconstructing base state from `a1e51a7c` (0 keys introduced by 27.1). Now
    known to be worse than a backlog: `pnpm i18n:check` exits 1, and `pr-quality.yml:46` runs it on
    every PR and every push to `main`, so that CI job has been **red continuously**. Separately,
    136 orphan `settings.admin.*` leaf keys × 12 locales were left behind when the fork deleted
    upstream's admin forms.
  - **F-10 — CLOSED 2026-07-28.** `tooling/import-gate/` (`README.md`, `run-import-gate.mjs`,
    `urls.ah.txt`, `urls.lekkerensimpel.txt`) is now repo-tracked — committed as `efb9e3ca`
    *"chore(27.1): track the import-gate regression harness"*. Phase 27.2's acceptance gate extends
    it with the non-JSON-LD blogspot set.
  - **F-2 (OWNED BY PHASE 27.2).** `packages/shared-server/src/config/defaults.ts` still defaults
    `maxTokens: 10000`. **Correction to the earlier "inert on live" note: the LIVE value comes from
    the DB `ai_config` row, and it is also 10000.** Measured 2026-07-28: `deepseek-v4-pro` spends
    9 000–10 000 tokens on reasoning before emitting any output, so a 10–11-ingredient recipe does
    not fit (`finish_reason:"length"`, empty content) while a 6-ingredient one does. **Even after
    the sanitizer fix, every medium recipe loses its first attempt at 10000.** 27.2 raises the DB
    row above the measured ~11k floor and aligns `defaults.ts` for fresh installs.
  - **F-5 (SECURITY, minor; RE-SCOPED AND OWNED BY PHASE 27.4).** The four `is*` job probes in
    `packages/trpc/src/routers/recipes/pending.ts` answer
    `jobs.some(j => j.data.recipeId === input.recipeId)` with **no ownership check** — a boolean
    oracle over any recipe UUID. Line numbers moved when 27.1-06 edited the file; they are now
    `:50-66` (`isNutritionEstimating`), `:94-110` (`isAutoTagging`), `:112-128`
    (`isAutoCategorizing`), `:158-174` (`isAllergyDetecting`). The register's earlier `:58-74`
    etc. are stale.
  - **F-11 (NEW, LIVE — owned by Phase 27.4). The Cooklang parse pool is broken on the READ path.**
    `packages/shared-server/src/cooklang/pool.ts:320-328` resolves its child as "sibling of this
    module, with this module's extension" — correct for the tsdown bundle
    (`/app/dist-server/parse-worker.mjs`, verified healthy, 12/12 forks OK), but the pool is ALSO
    compiled into three Next.js/Turbopack server chunks, and Turbopack polyfills `import.meta.url`
    to the original SOURCE path. It therefore forks
    `node_modules/@norish/shared-server/src/cooklang/parse-worker.ts`, which exists nowhere in the
    image: `fork()` succeeds (real pid), the child exits 1 after ~80 ms, and
    `stdio:["ignore","ignore","ignore","ipc"]` (`pool.ts:420`) **discards the `Cannot find module`
    stderr**, leaving only "never reported ready". Broken on every image since `59f3a767
    feat(27-04)`; became visible only when W5's boot backfill minted the first-ever `cook_source`
    at 09:58:41 on 2026-07-28. **Blast radius is RENDER ONLY, not import** — the mint path runs in
    `dist-server`, where resolution is correct. Cost to the user: no inline ingredient chips, no
    per-step scaling, no section headings, no concurrent timers, on every recipe open. The stored
    `cook_source` for the live recipe **is valid** (parses `ok:true`, 10 ingredients, through the
    working worker) — `"stored-source-did-not-parse"` is a misnomer for "the pool did not start".
    The build gate written to prevent exactly this (`apps/web/tsdown.config.ts:44-55`) only checks
    the tsdown bundle and has been green throughout.
  - **F-12 (NEW, SECURITY, LIVE — owned by Phase 27.4).** Two more `pending.ts` isolation leaks of
    the REALTIME-ISO-01 / IMPORT-DEDUP-ISO-01 / LIST-ISO-01 / PENDING-ISO-01 family, missed when
    27.1-06 fixed `getPending`: `getPendingAutoTagging` (`:79-84`) and `getPendingAllergyDetection`
    (`:141-145`) filter with `job.data.userId === ctx.user.id || job.data.householdKey ===
    ctx.householdKey`. That **OR** ignores the `view:"owner"` policy clamp that `getPending:31-34`
    applies, leaking household-mates' recipe IDs under an owner-only policy.
  - **F-13 (NEW, DATA LOSS, LIVE — owned by Phase 27.4).** `deleteAccount`
    (`packages/trpc/src/routers/user/user.ts:279-318` → `deleteUser`,
    `packages/db/src/repositories/users.ts:347-349`) is a live, user-reachable mutation and leaves
    the account's personal recipes with **both `user_id` and `household_id` NULL** — permanently
    invisible, undeletable, media retained on disk. Root cause: `recipes.household_id` /
    `recipes.user_id` are `ON DELETE SET NULL`, not cascade. Related: `deleteHousehold`
    (`packages/db/src/repositories/households.ts:126`) is dead code **and** hazardous — a bare
    delete against the same SET NULL FK. **Delete it; do not give it a caller.**
  - **F-14 (NEW, SECURITY — owned by Phase 27.4).** Service worker: recipe media at
    `/recipes/{id}/{filename}` is not under `/api/`, so `apps/web/public/sw.js:65` serves it
    `cacheFirst` from CacheStorage forever, never revalidated, **bypassing
    `requireRecipeMediaAccess`**. All GET `/api/**` responses are also persisted unconditionally,
    and there is no cache purge on sign-out. Compounding it, `apps/web/scripts/update-sw-version.js`
    is a **no-op** — it replaces `__CACHE_VERSION__`, a token that exists nowhere; `sw.js:1`
    hardcodes `norish-cache-v0.3.0-beta`, so the cache name has never changed across releases and
    the eviction branch has never fired.
  - **F-15 (NEW, OPS — owned by Phase 27.4).** `tooling/beta/clone-beta-db.sh`'s live-DB guard is
    bypassable: the `*"norish-beta"*` match also matches the **password** in the URL, so a live
    connection string passes the guard and reaches `pg_restore --clean`.
  - **F-16 (NEW, OPS — no owning phase; needs a decision).** `pnpm docker:test` tests the WRONG
    image — `docker/docker-compose.test.yml:10` pulls `norishapp/norish:rc-v0.18.3-beta` from the
    registry instead of the image `pnpm docker:build` just produced.
  - **F-17 (NEW, minor — no owning phase; needs a decision).** The mobile dashboard renders
    `TODAYS_MEALS_MOCK` as real data (`apps/mobile/src/app/(tabs)/dashboard/index.tsx:138`).
    Mobile is out of scope per PROJECT.md, so this is recorded, not scheduled.
  - **F-18 (NEW, SECURITY CHORE — owned by Phase 27.4). The DeepSeek API key must be rotated.** It
    was exposed in a session transcript earlier and was briefly written to `/tmp` on 2026-07-28.
    Confirmed NOT in the git tree.

## Sequencing rationale (Phases 27.2–27.6, inserted 2026-07-28)

Five decimal phases sit between 27.1 and 28 so the 28/29/30/31 numbering is untouched. The order is
deliberate, and the dependency is real in every case:

1. **27.2 first, because the product is broken for users right now.** 24 of 25 live AI import
   failures are one sanitizer defect. Nothing else on this list changes what a user experiences
   today. It is also the smallest of the five.
2. **27.3 second, because every later phase's verification depends on it.** 6 of 17 packages do not
   typecheck and `i18n:check` has been red on `main` continuously. Until the gates are honest, a
   green run from 27.4/27.5/27.6 means nothing — 27.1's own 24/24 gate certifying a path it never
   touched is exactly the failure mode being designed out. 27.2 restores the two packages that are
   already clean (`api`, `queue`) as a free down-payment; 27.3 does the rest.
3. **27.4 third, because it closes what is live and wrong** — a security leak family, a data-loss
   path, and the render regression that has silently disabled the entire Cooklang read path since
   `59f3a767`. It must precede 27.6, which cannot verify anything about the read path until the
   parse pool actually starts.
4. **27.5 fourth, because deleting ~3 300 lines is far safer once the typechecker is honest** (27.3)
   and once nothing on the deletion list is in flight for a live fix (27.4).
5. **27.6 last, because it is the contract.** Making `cook_source` NOT NULL is irreversible and only
   safe once every write path mints one, the unit-system toggle stops NULLing it, and the read path
   provably works. Four of those five prerequisites are other phases' output.

### Phase 27.2: Imports actually work — the sanitizer (INSERTED 2026-07-28)
**Goal**: A recipe page that has no JSON-LD and no `<p>`/`<li>` markup — the classic Blogger shape —
imports through AI extraction instead of failing with "AI response did not match expected format."

**Status**: NOT STARTED. Plan via `gsd:plan-phase` when it starts.
**Depends on**: nothing. Phase 27.1 is deployed; this corrects its premise.
**Requirements**: IMPORT-SANITIZE-01, IMPORT-OBS-01 (+ F-2)

**The defect, established empirically 2026-07-28 (do not re-derive it):**
`extractSanitizedBody` (`packages/shared-server/src/ai/helpers.ts:93`) harvests page text only from
`h2,h3,h4,h5,h6,p,li,dt,dd,figcaption`. Classic Blogger pages put the entire recipe as **bare text
nodes separated by `<br>`** inside `div.post-body` — zero `<p>`, zero `<li>`. The sanitizer therefore
hands the model **86–585 characters of navigation chrome** instead of the recipe. The DB base prompt
says *"Return {} if data cannot be extracted"*, so DeepSeek **correctly** returns the two-character
string `{}`, which fails the strict Zod schema → `AI_NoObjectGeneratedError` → `VALIDATION_ERROR` →
the user-visible "AI response did not match expected format."
  - **Evidence:** susannekookt/kwarkbol — the sanitizer yields **107 chars**; the real recipe is
    **2 760 chars**. Restoring the post-body text and re-running the *identical* prompt produced a
    valid 11-ingredient extraction.
  - **7/7 correlation:** the only two pages that succeeded live are the only two whose post-body
    contains `<li>`.
  - **24 of the 25 live AI failures are this.** The 25th is reasoning-token exhaustion, which 27.1's
    retry already fixed.
  - **`helpers.ts` is byte-identical to `upstream/main` — an UPSTREAM defect, not a fork regression.
    Flag the sanitizer fix as an UPSTREAMING CANDIDATE** (CLAUDE.md: "consider upstreaming
    features"); keep the diff minimal and isolated so the PR is offerable as-is.

**Scope:**
  1. **Fix `extractSanitizedBody`** — capture `<br>`-separated text nodes and table cells; prefer a
     real article-body container (`.post-body`, `[itemprop=articleBody]`, `article`) over `<main>`;
     and **fall back to whole-root text when the selector pass yields implausibly little relative to
     the root's own text length**. That last clause is the general fix — the selector list will
     always miss some site.
  2. **Raise `ai_config.maxTokens` above the measured ~11k floor.** This is a **DB row, not a
     deploy**. Measured: `deepseek-v4-pro` burns 9 000–10 000 tokens on reasoning before emitting
     output; a 10–11-ingredient recipe does not fit in 10 000 (`finish_reason:"length"`, empty
     content), a 6-ingredient one does. **Even after the sanitizer fix, every medium recipe loses
     its first attempt at 10 000.** Align `defaults.ts` for fresh installs (F-2).
  3. **Observability — the reason this cost a week instead of an hour.** Log the sanitized content
     length at `info` alongside "Starting AI recipe extraction", and **warn loudly when a large page
     yields a tiny sanitized body**: that is a *parser-bug* signature, not a "no recipe here"
     signature, and nothing in the logs distinguished the two.
  4. **Fix the lying log marker** at `packages/api/src/parser/index.ts:353`. It fires from the call
     site at `:454` even when AI was never invoked, because the guard at `:432` is
     `aiEnabled && await isPageLikelyRecipe(html)` — so a page that never reached the model still
     logs "AI extraction failed; attempting the JSON-LD fallback". Fix the false `reason` default at
     `:458` (`structured-and-ai-failed`) in the same pass.
  5. **Restore honest typecheck on `packages/api` and `packages/queue`** — both are ALREADY clean
     under a real `tsc` (director-verified 2026-07-28, exit 0). Removing their `--noCheck`
     (`packages/api/package.json:15`, `packages/queue/package.json:17`) is free, and it is the two
     packages this phase edits. The other four are 27.3's job.

**ACCEPTANCE GATE (hard):**
  - The gate **MUST exercise the AI path on non-JSON-LD pages**. The blogspot set, all five:
    susannekookt/kwarkbol, kokenzonderkennis/soto-soep, doorboerstra/soto-ajam,
    kokenmetaly/shoarma-soep, taartenzoet/boterkoek.
  - Record **`parserPath` and `usedAI` per URL** in the evidence.
  - **A gate that only passes JSON-LD pages is EXPLICITLY INSUFFICIENT and does not close this
    phase.** 27.1's 24/24 gate was exactly that gate: every import logged `parserPath:"structured"`,
    `usedAI:false`, certifying a path 27.1 never modified. Extend `tooling/import-gate/`
    (repo-tracked since `efb9e3ca`) rather than writing a second harness.

### Phase 27.3: Gates that don't lie (INSERTED 2026-07-28)
**Goal**: `pnpm typecheck`, `pnpm i18n:check` and the build assertions tell the truth, so a green run
is evidence rather than decoration.

**Status**: NOT STARTED. Plan via `gsd:plan-phase` when it starts.
**Depends on**: Phase 27.2 (which restores `api` + `queue` as its own down-payment).
**Requirements**: GATE-01, I18N-01 (closes F-9)

**What is actually hidden — 6 of 17 packages do not typecheck:**
  - Script-level `--noCheck`: `packages/api/package.json:15`, `packages/auth:16`,
    `packages/queue:17`, `packages/shared-server:57`, `packages/trpc:49`. **trpc's is not even
    `--noEmit`** — it is byte-identical to its own `build` script (`rm -rf dist .cache && tsc -p
    tsconfig.json --noCheck`), so `pnpm typecheck` deletes trpc's build output as a side effect and
    checks nothing.
  - **The sixth and worst:** `apps/web/tsconfig.json:6` sets `"noCheck": true` while the script at
    `apps/web/package.json:18` reads as an honest `tsc --noEmit`. A real typecheck yields **285
    errors**. (The tsconfig line carries an upstream issue link, `norish-recipes/norish#333`, and
    the comment "This needs to be fixed" — it has been true since `bb003e9a` "Disable typecheck for
    now in CI", 2026-03-11.)
  - **VERIFIED FREE (director, 2026-07-28):** a real `tsc` on `packages/api` and `packages/queue` is
    **exit 0, clean** — 27.2 takes those two.
  - Prior art: `.planning/quick/typecheck-gate-restore.md` already restored `packages/shared-react`
    and `apps/mobile` the same way and records the method. Follow it.

**What apps/web's `noCheck` is hiding (a sample, not the list):**
  - `create-or-join-cookbook-modal.tsx` imports **three non-existent `@heroui/react` members** —
    that would throw on render.
  - `lib/recipe-media.ts:180` reads `user.isServerAdmin` off a type that **does not declare it** —
    on an **authorization** path.

**Also in scope:**
  - **`@norish/shared/contracts` ships 17 broken type imports**, hidden by `skipLibCheck`. The
    consequence is not cosmetic: **`Slot` resolves to `any` at four live call sites.**
  - **`pnpm i18n:check` exits 1** — locale `no` is missing 68 keys. `pr-quality.yml:46` runs it on
    every PR *and* every push to `main`, so that job has been **red continuously**. Get it to exit
    0. Separately, 136 orphan `settings.admin.*` leaf keys × 12 locales remain from when the fork
    deleted upstream's admin forms — remove them in the same pass.
  - **Add a build-time assertion that covers the Next.js server bundle, not only the tsdown
    bundle.** `apps/web/tsdown.config.ts:44-55` already asserts `parse-worker.mjs` was emitted —
    and it was green throughout the entire period the Cooklang pool was broken in the Turbopack
    chunks (F-11). An assertion that only covers one of two bundlers is the same class of lie as
    `--noCheck`.

**Success Criteria** (what must be TRUE):
  1. No `--noCheck` in any `typecheck` script; no `noCheck` in any `tsconfig.json`; `pnpm typecheck`
     is 17/17 green **and** a deliberately planted type error turns it RED (prove it, then revert).
  2. `pnpm i18n:check` exits 0.
  3. `Slot` is a real type at all four call sites.
  4. A build assertion fails if the **Next.js server bundle** cannot resolve the Cooklang parse
     worker.

### Phase 27.4: Close the live defects (INSERTED 2026-07-28)
**Goal**: Everything found on 2026-07-28 that is broken on the live stack is fixed, with the
isolation items adversarially proven.

**Status**: NOT STARTED. Plan via `gsd:plan-phase` when it starts.
**Depends on**: Phase 27.3 (honest gates — several of these are exactly the class `--noCheck` hides).
**Requirements**: COOKPOOL-01, PENDING-ISO-02, ACCT-DEL-01, SW-CACHE-01, OPS-01
(closes F-5, F-11, F-12, F-13, F-14, F-15, F-18)

**Scope, in descending user impact:**
  1. **COOKPOOL-01 — the parse pool's child resolution, across BOTH bundlers** (F-11 above has the
     full diagnosis). `packages/shared-server/src/cooklang/pool.ts:320-328` is correct for tsdown
     and wrong for Turbopack. Two things to note going in: the **documented escape hatch
     `NORISH_COOK_PARSE_WORKER_PATH` (`pool.ts:321`) would work today** as an operational
     stop-gap, and **the pool discards the child's stderr**
     (`stdio:["ignore","ignore","ignore","ipc"]`, `pool.ts:420`) — which is why an ordinary
     `Cannot find module` surfaced as "never reported ready". **Stop discarding it.** The comment
     there justifies the discard by T-27-05 (a WASM panic must not leak into a shared log stream);
     the fix is to capture and log it under the module's own logger, not to keep it dark.
  2. **PENDING-ISO-02 — SECURITY-CRITICAL.** The two remaining `pending.ts` leaks (F-12:
     `getPendingAutoTagging:79-84`, `getPendingAllergyDetection:141-145` — the `||` that ignores the
     `view:"owner"` clamp `getPending:31-34` applies) **plus** the four unowned `is*` probes (F-5:
     `:50-66`, `:94-110`, `:112-128`, `:158-174`). Same family as REALTIME-ISO-01 /
     IMPORT-DEDUP-ISO-01 / LIST-ISO-01 / PENDING-ISO-01. **Per CLAUDE.md this requires the
     adversarial revert-check:** after the isolation suites pass, temporarily weaken the boundary,
     confirm the suites go RED, revert byte-identically, and never commit the weakening. RED-first,
     with a `view:"everyone"` sibling for every case.
  3. **ACCT-DEL-01 — data loss (F-13).** `deleteAccount` orphans personal recipes into a
     permanently invisible, undeletable state because the FKs are `ON DELETE SET NULL`. Decide the
     behaviour (cascade the personal rows, or refuse the delete until they are moved) and implement
     it. **Delete `deleteHousehold` (`households.ts:126`) — it is dead code AND hazardous; do not
     give it a caller.**
  4. **SW-CACHE-01 — security (F-14).** Recipe media at `/recipes/{id}/{filename}` is served
     `cacheFirst` from CacheStorage forever (`sw.js:65`), never revalidated, bypassing
     `requireRecipeMediaAccess`. Fix the media rule, stop persisting all GET `/api/**` responses
     unconditionally, purge the cache on sign-out, and fix the `update-sw-version.js` no-op so the
     cache name actually changes across releases and the eviction branch can fire.
  5. **OPS-01 — the operator hazards.** `tooling/beta/clone-beta-db.sh`'s guard (F-15: the
     `*"norish-beta"*` match hits the password, so a live URL passes into `pg_restore --clean`), and
     **the DeepSeek API key rotation (F-18)** — exposed in a session transcript and briefly written
     to `/tmp` on 2026-07-28.

**Success Criteria** (what must be TRUE):
  1. A recipe with a `cook_source` renders ingredient chips, per-step scaling, section headings and
     concurrent timers **in the deployed image**, not just in a unit test — the pool starts under
     both bundlers.
  2. Under `view:"owner"`, no `pending.ts` procedure returns a recipe id the caller cannot access;
     the four `is*` probes answer only for recipes the caller can access. Adversarially proven.
  3. Deleting an account leaves no recipe row with both `user_id` and `household_id` NULL.
  4. Recipe media is not served from CacheStorage to a session that cannot access it; signing out
     purges the cache; the SW cache name changes when the release does.
  5. The DeepSeek key in use on live is a new one.

### Phase 27.5: Delete the dead weight (INSERTED 2026-07-28)
**Goal**: The ~3 300 lines of provably unreachable code found by the three adversarial reviews are
gone, with no behaviour change.

**Status**: NOT STARTED. Plan via `gsd:plan-phase` when it starts.
**Depends on**: Phase 27.3 (an honest typechecker is what makes a large deletion safe) and Phase 27.4
(nothing on the deletion list should be in flight for a live fix).
**Requirements**: DEADCODE-01

**The work is already written down — execute the reports, do not re-derive them.** Each was produced
2026-07-28 by an independent adversarial sweep with hand-built reachability graphs (no `knip`/
`ts-prune` in this repo), and each documents its own method so any claim can be falsified:
  - `.planning/phases/27.1-…/27.1-REVIEW-A-import-surface.md` — `packages/api`, `packages/queue`,
    `apps/parser-api`; 41 files; 23 findings; **~2 115 lines deletable at HIGH confidence**
    (the `packages/queue/src/redis/` island of byte-identical `shared-server` duplicates, the
    `packages/api/src/ai/` barrel + `core/executor.ts` + `core/guards.ts`, the superseded
    `video/instagram.ts`, the test-only `lib/domain-matcher.ts`).
  - `…/27.1-REVIEW-B-data-server.md` — db, db-schema, trpc, auth, shared-server, shared; 309 files;
    22 findings; **~1 150 lines**.
  - `…/27.1-REVIEW-C-apps-tooling.md` — apps/web, apps/mobile, ui, shared-react, i18n, config,
    tooling, docker, root config; 1 169 files; **42 findings**.

**Traps recorded in those reports — read them before deleting anything:**
  - **`packages/api/src/parser/jsonld.ts:2` carries a FALSE `@deprecated` comment** ("kept only for
    `LEGACY_RECIPE_PARSER_ROLLBACK`"). **27.1 put this file on the LIVE path in four places.** It is
    not dead. Do not delete it; fix the comment.
  - **`LEGACY_RECIPE_PARSER_ROLLBACK` is set nowhere**, and enabling it is *actively worse* than the
    default.
  - **`db-schema/relations.ts` looks orphaned but is LIVE** — consumed via drizzle relational
    queries, which no import graph will show you.

**Success Criteria** (what must be TRUE):
  1. Every deletion is justified by a HIGH-confidence finding in one of the three reports, cited by
     section.
  2. Full `pnpm test` / `typecheck` / `lint` green **after** 27.3 made those gates real.
  3. No file on a live path is deleted — the three traps above are each explicitly re-checked.

### Phase 27.6: Cooklang as the only source of truth — the real W6 (INSERTED 2026-07-28)
**Goal**: `.cook` is the single representation. `cook_source` is NOT NULL, and the legacy render
fork, `unit-converter.ts`, the heuristic ingredient-link markup and the timer-keyword scan are gone.

**Status**: NOT STARTED — and NOT plannable until its prerequisites are discharged. Plan via
`gsd:plan-phase` when they are.
**Depends on**: Phases 27.2, 27.3, 27.4 (hard — see prerequisites), 27.5 (soft — deleting dead code
first keeps this diff readable).
**Requirements**: COOK-02 (completes COOK-01)

**Kiran, 2026-07-28 (binding):** *"Ik wil cooklang als de enige source of truth hebben. de rest mag
er allemaal uitgesloopt worden."* Cooklang-only IS the destination. This phase is not a question of
whether, only of order.

**THE RECORDED JUSTIFICATION FOR W6 IS FALSE — correcting it, not overwriting it.**
`27-ARCHITECTURE.md:320` states W6 is *"Safe because W5 guaranteed 100% coverage."* It is not:
  - W5 covered **existing rows** — `candidates:6, derived:1, flagged:5, refused:0, failed:0` — and
    says **nothing about future inserts**.
  - W5 says **nothing about the read path**, which has in fact been broken in the Next.js server
    bundle since `59f3a767` (F-11).
  - Five write paths mint no `cook_source` today, and the unit-system toggle actively NULLs one.
  Shipping W6 as written would break structured/paste/Mealie/manual/copy write paths **and** render
  zero steps on 100% of recipes.

**HARD PREREQUISITES (gates, not preferences — every one must be TRUE before `0043` is written):**
  1. **27.4's parse-pool fix holds in BOTH bundles** — tsdown *and* the Next.js/Turbopack server
     chunks — proven against the deployed image, not a unit test.
  2. **EVERY write path mints a `cook_source`:**
     - structured URL import — `packages/api/src/parser/index.ts:420-427`, which today deliberately
       returns `cook: null` per D-27-W3-08;
     - paste-import — `packages/queue/src/…/worker.ts:136`;
     - Mealie archive import — `packages/shared-server/src/archive/parser.ts:364`;
     - manual create — `packages/trpc/src/routers/recipes/recipes.ts:222`;
     - recipe copy.
  3. **`setActiveSystemForRecipe` (`packages/db/src/repositories/recipes.ts:1150-1156`) stops
     NULLing `cook_source` on a metric↔US switch.** Its current `CASE WHEN … ELSE NULL` is correct
     under a nullable column and a constraint violation under a NOT NULL one; it needs to re-mint or
     translate, not clear.
  4. **The 8 000 ms wall backstop** (27-04's `cookParseCpuMs: 1_500` CPU gate plus the wall
     backstop) still holds on the mint path once every write path runs it.

**Only then, in this order:**
  5. Migration **`0043` — `cook_source` NOT NULL.** Irreversible; requires a verified-restorable
     backup and Kiran's explicit sign-off, per the Phase 22.4 / 25 / 27-07 migration discipline.
  6. Delete `unit-converter.ts`, the heuristic ingredient-link markup, the timer-keyword scan, and
     the transitional read-fork. (W4 proved the heuristic runtime path is **UNCALLED** on the token
     branch — `createIngredientLinkCandidates`/`parseTimerDurations` spied at 0 invocations,
     D-27-W4-01 — but deliberately left the symbols in place. This is where they go.)

**Success Criteria** (what must be TRUE):
  1. Every write path — URL import (structured *and* AI), paste, Mealie archive, manual create,
     copy — produces a recipe with a non-NULL `cook_source`, proven live.
  2. A metric↔US toggle on any recipe leaves `cook_source` non-NULL and correct.
  3. Recipe detail and cooking mode render from tokens for **100%** of recipes; no code path remains
     that reads the legacy projection for rendering.
  4. `0043` applies to live with zero data loss, evidenced the way `0042` was (row counts and FK
     integrity confirmed by two independent agents).
  5. `unit-converter.ts`, `applyIngredientLinkMarkup`, the timer-keyword scan and the transitional
     fork are deleted, and the suite is green without them.
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

### Phase 31: Ingest-pipeline overhaul (MAJOR, post-Cooklang)
**Goal**: Rework the recipe ingest path end-to-end so every source (webpage/JSON-LD, AI extraction, image OCR, video transcript) converges on ONE well-linked structured shape — per-step ingredient linkage as a first-class output, cleaner provider orchestration/repair, and stronger ingredient dedupe/normalisation.
**Depends on**: **Phase 27** — the per-step linkage schema, the `structuredToCooklang` serializer and the confidence gate land there first; this phase generalises them across the whole ingest surface rather than the extraction prompt alone.
**Requirements**: INGEST-01
**Status**: Sketch recorded 2026-07-24 (Kiran) as the deliberate follow-on to Phase 27. **Not scoped further until Phase 27 ships** — its final shape depends on what the Cooklang work proves out (esp. the AI-relinking accuracy and confidence-gate tuning from `27-EXPERIMENT.md`).
**Plans**: TBD (do not plan until Phase 27 lands).
