# Requirements: norish (Kiran's fork)

**Defined:** 2026-06-12
**Core Value:** Reliable recipe import & management for Kiran's groups, incl. bot-protected sources, with no extra setup vs upstream.

## v1 Requirements

### Scraping (native Camoufox) — Phase 1

- [x] **SCRAPE-01**: Recipe page fetching uses the Camoufox REST service (LXC 105) natively, configured via `CAMOFOX_URL`.
- [x] **SCRAPE-02**: Headless-Chrome dependency removed from the app + docker compose (no `chrome-headless` service required).
- [x] **SCRAPE-03**: Per-site cookie/header auth tokens are still applied through Camoufox.
- [x] **SCRAPE-04**: Bot-protected sources (e.g. ah.nl) import successfully end-to-end.
- [x] **SCRAPE-05**: No boot-time bundle patch needed — Camoufox support ships in the built image.
- [x] **SCRAPE-06**: Graceful behavior when Camoufox is unreachable (clear error, no silent empty extraction).

### Households / cookbooks — Phase 2

- [x] **HOUSE-01**: A user can belong to multiple households simultaneously.
- [x] **HOUSE-02**: A user can create, join (by code), and leave multiple households. _(backend complete; UI gap RESOLVED in 02-05 — create-another / join-by-code now reachable any time from the navbar switcher's "Create or join a cookbook" modal; CKBK-UI-01 done)_
- [x] **HOUSE-03**: A user can switch their active household/cookbook.
- [x] **HOUSE-04**: Recipes are scoped to a household/cookbook (`recipes.household_id`); `null` = personal.
- [x] **HOUSE-05**: A personal cookbook coexists with shared cookbooks for the same user.
- [x] **HOUSE-06**: Per-cookbook isolation — members of one household cannot see another household's recipes (security-critical).
- [x] **HOUSE-07**: Import/create assigns the recipe to the active cookbook. _(backend 02-02; frontend 02-04 indicates the active-cookbook target + refetches the list on switch — v1 shows the active target, no manual picker; code-complete, human-verify pending)_

### Recipe sharing — Phase 4

- [x] **SHARE-01**: Per-link recipe sharing with per-recipe visibility private/household/public (built ON the existing `recipe_shares`); public = no-auth read-only view of ONE recipe by long share token at `/share/<token>`; gated on `visibility = public` (private/household unreachable publicly); owner/cookbook-admin creates/revokes the link + sets visibility from the recipe page. No public gallery (deferred). _(code-complete 2026-06-14; human-verify pending)_

### Video transcription (AssemblyAI) — Phase 5

_(renumbered from Phase 3/4 to make room for the Sharing phase.)_

- [x] **VIDEO-01**: AssemblyAI is a selectable native transcription provider (config-driven key). _(code-complete 2026-06-14, 04-01; key set in the admin UI -> video_config.transcriptionApiKey; native upload->poll dispatch; human-verify with the lead pending)_
- [ ] **VIDEO-02**: TikTok & Instagram video imports work (caption + transcription).
- [ ] **VIDEO-03**: Video description/caption is used in extraction (already upstream — verify retained).
- [ ] **VIDEO-04**: No boot-time patch for transcription — ships in the built image.

### AI / LLM provider (DeepSeek) — Phase 6

- [x] **AI-01**: DeepSeek is a selectable AI/LLM (recipe-extraction) provider with the V4 models `deepseek-v4-pro` + `deepseek-v4-flash` selectable in the admin AI-config; the API key is read from the admin AI-config secret at runtime (SETUP-05; no env, no boot-patch). _(code-complete 2026-06-14, 06-01; the provider was already wired from upstream — this surfaced the two V4 model ids in the model picker + added unit coverage; human-verify with the lead pending)_

### Setup / maintainability — Phase 0 / cross-cutting

- [ ] **SETUP-01**: Fork builds via `pnpm docker:build` on LXC 110 and deploys to the existing stack.
- [ ] **SETUP-02**: Diff vs upstream is minimal + isolated; upstream remote tracked.
- [ ] **SETUP-03**: No extra runtime setup vs off-the-shelf norish (config/env only).
- [ ] **SETUP-04**: Camoufox is bundled in the compose (self-contained) by building the **vendored camofox-browser v1.4.1** source under `docker/camofox/` (no external image/registry — the published 1.8-1.11 images regressed on Akamai); no external browser service required; `CAMOFOX_URL` can override to reuse an external one.
- [ ] **SETUP-05**: All cloud API keys (AI provider, transcription/AssemblyAI, OAuth) are configurable via the admin UI and persisted (encrypted) in the DB — not required as environment variables.

## v2 Requirements

- ~~**HOUSE-08**~~: Per-cookbook permission policy / move-recipe-between-cookbooks. **Both halves are now scheduled**: the policy half shipped as POLICY-01 (Phase 3); the move half is CKBK-MOVE-01 (Phase 23), raised independently by the 2026-07-21 UAT (B3).
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
| HOUSE-01..07 | Phase 2 | HOUSE-01..07 done; frontend (switcher, active-cookbook import indication, refetch-on-switch, 11-locale i18n) landed in 02-04 — code-complete, human-verify pending with the lead |
| SHARE-01 | Phase 4 | Code-complete 2026-06-14, human-verify pending |
| VIDEO-01..04 | Phase 5 | VIDEO-01 code-complete 2026-06-14 (04-01); VIDEO-02..04 folded into the human-verify / retained |
| AI-01 | Phase 6 | Code-complete 2026-06-14 (06-01); DeepSeek provider already upstream, V4 model ids surfaced + tested; human-verify pending |
| SETUP-01..03 | Phase 0 | In progress |
| SETUP-04 | Phase 1 | Done |
| SETUP-05 | Phases 1/3 + cross-cutting | In progress |
| UPSTREAM-019 | Phase 20 | Complete |
| MEDIA-UX-01 | Phase 21 | Pending — raised by the 2026-07-21 UAT (A3) |
| UI-POLISH-01 | Phase 21 | Pending — raised by the 2026-07-21 UAT (D) |
| REALTIME-ISO-01 | Phase 22 | Pending — BUG, confirmed against live 2026-07-21 |
| CKBK-MOVE-01 | Phase 23 | Pending — raised by the 2026-07-21 UAT (B3) |
| BULK-01 | Phase 24 | Pending — promoted from backlog 2026-07-21 |
| IMPORT-UX-01 | Phase 24 | Pending — raised by the 2026-07-21 UAT (B2) |
| SHOP-01 | Phase 25 | Pending — promoted from backlog 2026-07-21 |
| SHOP-02 | Phase 25 | Pending — DECIDED 2026-07-21 (household-scoped lists) |
| DINNER-01 | Phase 26 | Pending — promoted from backlog 2026-07-21 |
| COOK-01 | Phase 27 | Pending — externally blocked on upstream #470 design |
| COST-01 | Phase 28 | Pending — promoted from backlog 2026-07-21 |
| MAKE-01 | Phase 29 | Pending — promoted from backlog 2026-07-21 |
| VERSION-01 | Phase 30 | Pending — unblocked by SHARE-02 shipping 2026-07-21 |

**Coverage:** v1 = 22 requirements, all mapped to phases. The 2026-07-21 roadmap extension adds 11 more (Phases 22–30), promoting the previously vault-only product backlog into sequenced phases. Still unscheduled by design (open product decisions, not capacity): INVITE-02, RATE-02, REC-01, DISCOVER-01.

## Backlog / future phases

Locked from the product backlog + brainstorm (2026-06-12). All **Backlog/v2** unless a near-term marker is given. The rich version lives in Kiran's Obsidian vault; this is the concise canonical mirror.

### Near-term (candidate next phases)

- [x] **POLICY-01** (Phase 3, 03-01) — DONE 2026-06-14 (code-complete; human-verify pending): Per-household permission policies — each cookbook sets its own view/edit/delete via 3 `permission_level` enum columns on `households` (+ migration 0037, backfilled from the server-wide policy). `canAccessResource` resolves per-cookbook from the recipe's OWN household; `edit`/`delete = household` => recipe owner OR cookbook admin (admin-edits-any / members-edit-own). `buildViewPolicyCondition` reads the active cookbook's `view_policy`; an active cookbook never widens cross-cookbook (HOUSE-06 intact, adversarially verified). DISALLOWS per-cookbook `view = everyone` (only the global default may be everyone); the server-wide policy is demoted to the default for new cookbooks + the personal-recipe fallback. Admin-only Recipe Permissions card on the Household settings page + i18n in all 11 locales.
- [x] **INVITE-01** (Phase 2, 02-06) — DONE 2026-06-13: shareable, regenerable **invite link** (`/join/<token>`) alongside the short join code. `households.invite_token` (+ migration 0036); admin generate/regenerate; a PUBLIC name-only `getByInviteToken` lookup; a `joinByInviteToken` mutation reusing the multi-membership join path; an admin invite-link UI in Household settings + the public `/join/[token]` page (logged-out → login → return); i18n in all 11 locales. SAME security model as the join code; **registration-bypass is explicitly DEFERRED as INVITE-02** (a separate decision). (code-complete; folded into the 02-06 human-verify)
- **INVITE-02** (Backlog/v2, deferred from 02-06): invite-link-as-**registration bypass** — let a logged-out invitee sign up via `/join/<token>` even when `registration_enabled` is off (a scoped, token-gated registration). v1 keeps the existing signup flow + `registration_enabled`.
- [x] **CKBK-UI-01** (Phase 2 fix) — DONE 2026-06-13 (02-05): create-another + join-by-code are reachable any time via the navbar switcher's "Create or join a cookbook" modal (the same forms NoHouseholdView used, now sourced from the global household context). No longer blocks HOUSE-02.
- [x] **RENAME-01** (user-requested 2026-06-13) — DONE 2026-06-13 (02-05): `households.rename` mutation (admin-only, optimistic-version) + an admin inline-rename on the Household settings page (household-info-card), surfaced through the global household context.

### Sharing & ratings — Backlog

- [x] **SHARE-01** (Phase 4, SHARE-01) — DONE 2026-06-14 (code-complete; human-verify pending): Per-link sharing with per-recipe visibility private/household/public, built ON the existing `recipe_shares` feature. Added `recipes.visibility` enum + migration 0038; the no-auth `/share/<token>` route serves a recipe ONLY when `visibility = public` (private/household unreachable even with a valid token — adversarially verified); creating a link promotes to public, revoking the last one reverts to private; an editor (owner/cookbook admin per POLICY-01) sets visibility from the recipe Share panel; token standardized to crypto.randomBytes(32). Public payload is single-recipe display data only (no ids/owner/cookbook listing). No public gallery (deferred); SHARE-02 deferred.
- [x] **SHARE-02** — DONE (shipped 2026-07-21): "Save to account" button on a shared/public recipe → prompt login if needed → copy the recipe into the user's active cookbook. Backed by the `saveShared` authed procedure (`packages/trpc/src/routers/recipes/shares.ts:376`) and `ShareSaveButton`, rendered on both the desktop (`app/share/[token]/page.tsx`) and mobile (`shared-recipe-page-mobile.tsx`) public views. **History worth keeping**: the button was silently orphaned by the v0.19.0 merge — the component survived but both render sites were dropped, so the feature was dead code until the 2026-07-21 UAT (B4) caught it and commit `0a52ade1` restored it. Same "silent partial completion" failure class the 20-04 review caught on `timer-dock.tsx`. **Unblocks VERSION-01** (Phase 30), which needs a save event to hang lineage off.
- [x] **RATE-01** (Phase 4, RATE-01) — DONE 2026-06-14 (code-complete; human-verify pending): On the AUTHENTICATED recipe detail page (desktop + mobile), show a recipe's **average + count** and a per-user **"rated by <name> ★★★★"** list, built ON the existing per-user `recipe_ratings` feature (table + repo + ratings router + StarRating UI + the useRatingQuery that already returns averageRating/ratingCount, + the dashboard card that already shows averageRating via the DTO). Added: `getRecipeRaters` repo join (decrypted display names, null-safe) + `RecipeRaters{,Schema}` shared zod + a NEW `ratings.getRaters` authedProcedure that runs `assertRecipeAccess(view)` FIRST (a user outside the recipe's OWN cookbook gets FORBIDDEN and the names are never fetched — HOUSE-06/POLICY-01; adversarially verified) + a read-only `RecipeRaters` component (current user labelled "You", null-name fallback) in both detail pages' rating section + i18n in all 11 locales. NO schema change/migration. **Public-share-view ratings are DEFERRED as RATE-02** (privacy decision — exposing member names on the no-auth /share view). (code-complete; human-verify with the lead pending)
- **RATE-02** (Backlog/v2, deferred from RATE-01 — privacy decision for Kiran): show ratings + rater **names** on the no-auth `/share/<token>` public view. Exposing cookbook member names to anonymous visitors is a privacy call; RATE-01 kept ratings authenticated-views-only and left the public surface (sharedRecipeProcedure + PublicRecipeViewSchema) untouched. Confirm the privacy stance (e.g. names vs. anonymized stars, opt-in) before building.
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

### Correctness / fork-maintenance fixes

- **UNIT-NORM-01** (Phase 19) — The recipe UPDATE path must normalize locale-specific ingredient unit terms to canonical IDs identically to the CREATE path. `syncRecipeIngredientsTx` (`packages/db/src/repositories/recipes.ts`) wrote `unit: ingredient.unit ?? null` verbatim, so editing a recipe persisted un-normalized units (e.g. Dutch "handvol" instead of "handful"). Fix: export `getUnitsForNormalization` from `ingredients.ts` and apply `normalizeUnit(ingredient.unit ?? "", units)` at the single update site — mirroring `attachIngredientsToRecipeByInputTx`. Closes the 3 `updateRecipeWithRefs` failures in `ingredient-unit-normalization.test.ts` that Phase 18 logged as out-of-scope. No schema/migration; no security surface.

### Upstream incorporation

- [x] **UPSTREAM-019** (Phase 20) — Incorporate upstream `norish-recipes/norish` **v0.19.0-beta** (PR #468, squashed commit `1f684480`) into the fork on a dedicated integration branch off `main`, re-asserting the fork's hard constraints at every conflict (Camoufox-not-Chrome — `packages/api/src/parser/fetch.ts`, never reintroduce `playwright.ts`/headless Chrome; per-cookbook isolation HOUSE-06 stays green; config-as-code env sync in `seed-config.ts`; WorkOS + multi-household + per-cookbook permissions in `auth.ts`/`permissions.ts`/`claim-processor.ts`) and reconciling our `packages/db/src/schema` (multi-household, `recipe_shares`, `recipe_ratings`, `visibility`, per-cookbook policy columns, migrations 0035–0038) against upstream's NEW `packages/db-schema/` package split. ~996 files changed upstream, ~110 overlap our fork. Hard gates: per-cookbook isolation + db/queue testcontainer suites under `sg docker`, full typecheck/lint/test green, then a director-owned `pnpm docker:build`. Off the live stack throughout (live cutover is a separate, deliberate step). Full assessment: vault `norish-upstream-0.19.0-incorporation-assessment`.

### UI polish & media UX — Phase 21 (from the 2026-07-21 UAT)

- [ ] **MEDIA-UX-01** (Phase 21) — Opening a recipe's media must keep the user in the same media set. Today `media-carousel.tsx` builds the lightbox from `items.filter(type === "image")`, so a recipe with 1 photo + N videos opens a single-image lightbox with no position counter, no prev/next and no thumbnail strip — the media you were swiping disappears. The lightbox must expose the full media set (or at minimum every image) with counter + navigation, and returning from it must leave the carousel on the same item. Additionally, thumbnails must not download the full-size original into a 64px slot (`unoptimized` + `sizes="64px"` in `components/ui/carousel.tsx`); verify against a browser network trace. Source: UAT section A3.
- [ ] **UI-POLISH-01** (Phase 21) — Reduce visual and functional chrome so the app reads as a polished product rather than self-hostable software — *"every pixel must earn its place; most should lose"*. Concretely: strip the settings surface to what a normal user needs (removals are reversible), replace the wonky mobile-nav profile avatar, and rework the calendar into tappable rows of 7 that expand into a single day while hiding empty past days. Primarily SUBTRACTIVE. Source: UAT section D.

### Shopping list — Phase 25

- [ ] **SHOP-02** (Phase 25) — **DECIDED 2026-07-21 by Kiran: only a household should share a shopping list.** Today `groceries` and `stores` are keyed on `user_id` with **no `household_id`** (`packages/db-schema/src/schema/{groceries,stores}.ts`), so members of a shared cookbook keep two separate lists — a real gap in the Phase 2 multi-household work, not an intentional design. Re-key the grocery/store surface onto `household_id` so a cookbook's members see and edit one list, with a migration that assigns each existing user's items to their own household (no data loss, no cross-household merge of pre-existing items). Isolation still applies: a member never sees a list for a household they don't belong to (HOUSE-06). **Settles the Phase 25 data model** — the aisle-category mapping (SHOP-01) keys on `household_id` too, so both land in one migration rather than two.

### Realtime correctness — Phase 22 (found 2026-07-21 while sequencing the roadmap)

- [ ] **REALTIME-ISO-01** (Phase 22) — **BUG, live today.** Realtime events do not honour per-cookbook isolation. `emitByPolicy` (`packages/shared-server/src/realtime/policy.ts`) maps `view: "everyone"` onto `emitter.broadcast()`; of the 54 `emitByPolicy(` call sites in `packages/queue/src` + `packages/trpc/src`, **34 resolve their policy from the server-wide `getRecipePermissionPolicy()`** rather than the recipe's own household. Live `server_config.recipe_permission_policy` is `{"edit":"household","view":"everyone","delete":"household"}` (queried against the live DB 2026-07-21), so the broadcast branch is the *active* branch in production, and the payloads are full dashboard DTOs (e.g. `emitByPolicy(..., "imported", { recipe: dashboardDto, ... })`) — not bare ids. Net effect: **every connected client is pushed every household's imports, updates, ratings and shares.** Phase 3 proved HOUSE-06 adversarially on the REST/tRPC path only; the socket path was never covered. Fix in code by resolving the policy from the recipe's OWN household (the `canAccessResource` / `getHouseholdPolicy` precedent) — **not** by flipping the live config, which would mask the bug while leaving `view: "everyone"` a foot-gun. Sequenced ahead of all feature work because Phases 24, 26 and 30 each add emit sites.

### Cookbook & import UX — Phases 23–24 (from the 2026-07-21 UAT)

- [ ] **CKBK-MOVE-01** (Phase 23) — A recipe must show which cookbook it belongs to, and be movable between cookbooks. Today the cookbook is an invisible scoping rule: nothing on the recipe view names it and there is no move affordance, so the multi-cookbook model shipped in Phase 2 is illegible to the user. Add the cookbook to the recipe detail view; tapping it offers a move to any cookbook the user may write to (edit rights on the source per POLICY-01, membership of the destination, never widening access per HOUSE-06); add a Cookbooks browser to the nav. **Open**: whether a moved recipe's ratings and share links travel with it — a move can otherwise silently expose or hide who rated what. Source: UAT section B3.
- [ ] **IMPORT-UX-01** (Phase 24) — A running import must report honest progress derived from real job state (fetch → parse → enrich), not a synthetic timer and not an indefinite skeleton card; where a stage's duration is genuinely unknown the UI should say so rather than fake a bar. Kiran: import "can feel a bit slow at times". Rides the realtime bus, so it **depends on REALTIME-ISO-01** — otherwise one user's import progress broadcasts to everyone. Source: UAT section B2.

### Deferred pending a product decision (not scheduled)

_(SHOP-02 previously sat here as an open decision. **Decided 2026-07-21 by Kiran** — shopping lists are HOUSEHOLD-scoped, not per-user — so it moved up into the "Shopping list — Phase 25" section above as a real requirement.)_

### Explicitly out of scope

| Feature | Reason |
|---------|--------|
| "I made this" log | Out of scope (recorded) |
| Activity feed | Out of scope (recorded) |
| Export / print | Out of scope (recorded) |
| Recipe requests | Out of scope (recorded) |
| Pantry / inventory | **Dropped** — "what can I make" is image-based (MAKE-01), not pantry-driven |
