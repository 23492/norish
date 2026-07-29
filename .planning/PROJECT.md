# norish (Kiran's fork)

## What This Is

A self-hosted fork of [norish](https://github.com/norish-recipes/norish) (AGPL-3.0) — a recipe manager — tailored for Kiran's homelab. It keeps upstream's stack and style, adding: native Camoufox-based scraping (replacing headless Chrome), multi-household / multi-cookbook support, and AssemblyAI video transcription. The fork stays as close to upstream as possible so it remains maintainable and re-baseable.

## Core Value

Reliable recipe import & management for Kiran's groups — including bot-protected sources (AH.nl etc.) — with no more setup than the off-the-shelf norish. The package is self-contained: the Camoufox browser is bundled in the compose by default, so no external scraping service is required.

## Requirements

### Validated

- Native Camoufox scraping replaces headless Chrome (no boot-patch) — Phase 1, shipped + deployed.
- Multiple households per user (friend-group, partner, personal) with switching + per-cookbook recipe scoping — Phase 2, shipped + deployed. Per-cookbook isolation is security-critical and has since needed five follow-up fixes (Phases 22, 22.1, 22.2, 22.3, 22.4, 27.1-06, and two more scheduled in 27.4) — treat every new query over recipes as an isolation surface.
- AssemblyAI video transcription (native provider) — Phase 5 (renumbered from 3), shipped + deployed.
- Per-cookbook permission policies (POLICY-01) — Phase 3, shipped + deployed.
- Per-recipe sharing visibility + ratings (SHARE-01, RATE-01) — Phase 4, shipped + deployed.
- Upstream `v0.19.0-beta` incorporated — Phase 20 + 20.1, deployed live 2026-07-21.
- Cookbook context & moving recipes, bulk import + visible progress, household shopping list with aisles, what's-for-dinner suggester — Phases 23–26, all deployed 2026-07-23/24.

### Active

- [ ] **Recipe import actually works on non-JSON-LD pages** — Phase 27.2. The single largest live defect: 24 of 25 AI-extraction failures are upstream's `extractSanitizedBody` starving the model on `<br>`-separated pages.
- [ ] **Cooklang as the single source of truth** — Phase 27 (W0–W5 deployed) + Phase 27.6 (the contract). Kiran, 2026-07-28: *"Ik wil cooklang als de enige source of truth hebben. de rest mag er allemaal uitgesloopt worden."*
- [ ] **Honest verification gates** — Phase 27.3. 6 of 17 packages do not typecheck; `i18n:check` has been red on `main` continuously.
- [~] Per-phase Chrome e2e UAT against live for Phases 2–18 + 20/20.1 + 21 — code is deployed; the UAT gate is what remains.
- [x] Minimal setup parity with upstream; clean, re-baseable diff (ongoing constraint; Camoufox bundled self-contained)

### Out of Scope

- Mobile app (apps/mobile) feature work — web is the target
- Rewriting upstream's recipe parser / AI extraction — works; only the fetch layer changes
- Locale config — already NL-default + EN upstream; no change needed
- Phase 2 v2 extras: moving a recipe between cookbooks + per-cookbook permission-policy overrides (HOUSE-08)

## Context

- Upstream: norish-recipes/norish (AGPL-3.0, very active). Fork base `0.18.3-beta`; **`v0.19.0-beta` incorporated and live since 2026-07-21** (Phase 20), plus `rc/0.20.0-beta` (mobile-only). Monorepo: pnpm@10.33.2 + Turbo; Next.js 16, React 19, better-auth 1.6.9, Drizzle 0.45, tRPC 11, BullMQ, Postgres 17, Vitest 4, TS 5.9.
- Deploy target: LXC 110 (docker host, 192.168.2.47) — the live norish runs here. Camoufox REST service: LXC 105 (192.168.2.26:9377) or the bundled compose service.
- ~~The current live deploy uses a boot-time patch for Camoufox + AssemblyAI~~ — DONE: both are native source; the boot patch is gone.
- ~~Phase 2 grounding: this instance currently has 1 user / 9 recipes / 0 households~~ — historical; Phase 2 shipped and the instance now runs the multi-cookbook model.
- **Live stack (2026-07-28):** image `sha256:919a5e950735…` (Phase 27.1), DB at migration **43**, `CAMOFOX_URL` still pointing off-stack at LXC 105 (`192.168.2.26`) by deliberate choice — the in-stack compose from 27.1-04 is repo-tracked but not adopted (ROADMAP F-7). Camoufox itself is verified healthy and is NOT implicated in the import failures.

## Constraints

- **Process**: All work follows gsd-core (phase loop, .planning/ artifacts, verify-before-ship).
- **Style**: Match upstream norish conventions exactly (pnpm, ESM, TS). Minimal, isolated diffs; track upstream; consider upstreaming features.
- **Env**: All development via SSH on LXC 110. Build with `pnpm docker:build` on 110. Deploy the built image to 110.
- **Licensing**: AGPL-3.0 (private use fine; offer source if exposed publicly).
- **Quality**: Complete work, no placeholders. Per-cookbook isolation (Phase 2) is security-critical — enforced server-side + covered by dedicated tests.
- **Standalone**: Camoufox is bundled in the compose by default (overridable via `CAMOFOX_URL`); all cloud API keys (AI extraction, transcription, OAuth) are set in the admin UI — never required as env.
- **i18n**: `pnpm i18n:check` uses `en` as source of truth and fails on any missing key in any of the **12** locales (da, de-formal, de-informal, en, es, fr, it, ko, nl, **no**, pl, ru) — new UI keys must land in all 12. _(CORRECTED 2026-07-29: this line said "11 locales" and its list omitted `no`; `packages/i18n/src/messages/` has 12 locale directories, verified. `no` is exactly the locale F-9 / Phase 27.3 reports as missing 68 keys — which is why `pnpm i18n:check` exits 1 and `pr-quality.yml:46` has been red continuously. The "11" was not a scope decision; it was a stale count that made the failing locale invisible in this document. Older `.planning/` entries saying "all 11 locales" are historical and were accurate before `no` was added.)_

## Key Decisions

| Decision | Rationale | Outcome |
|----------|-----------|---------|
| Phase 20 upstream-0.19.0 merge uses **Strategy B** (commit the merge at 20-01, deferred subsystems on the upstream base, re-assert fork deltas per-plan) | The plans' literal "leave conflicted yet committed per subsystem" is git-impossible (can't commit with unmerged paths). Strategy B commits the single merge at 20-01 (db-schema re-ported; all other conflicts taken to upstream per D-08), then 20-02..20-05 re-apply each fork delta as its own reviewable commit — satisfies locked D-03 (per-subsystem commits) + D-08, and is resumable. Integration branch bases off main's live tip (not the stale `866f518e`). Director-confirmed 2026-06-28; plan git-state gates corrected accordingly. | Done (Phase 20) |
| Fork + rebuild (not boot-patch) | Maintainable, native, drops fragile bundle-patching | Done |
| Native Camoufox replaces Chrome in source | User directive; Camoufox beats bot-walls | Done (Phase 1) |
| AssemblyAI as native transcription provider | User choice; folds boot-patch into source | Done (Phase 5) |
| Dev+build on LXC 110, gh account 23492 | User directive | Done |
| gsd-core minimal profile | Adhere to gsd-core; minimal footprint | Done |
| Camoufox bundled via vendored camofox-browser v1.4.1, built in compose | Standalone package, no external browser service; published 1.8-1.11 images regressed on Akamai (fail AH.nl), so vendor + build the proven v1.4.1; overridable via CAMOFOX_URL | Done |
| Cloud keys via admin UI, not env | Zero-secret env; keys persisted encrypted in DB, configured post-install | Done |
| `recipes.household_id` (nullable FK, ON DELETE SET NULL; NULL=personal) for recipe scoping | A recipe lives in exactly one cookbook (or none); minimal 1:N FK beats a recipe↔cookbook join; mirrors existing `recipes.userId` | Done (Phase 2, D-01) |
| `user.active_household_id` (dedicated nullable FK) as the active-cookbook pointer | FK integrity (auto-null on household delete) + clean resolver; chosen over user.preferences JSONB | Done (Phase 2, D-04) |
| `getHouseholdForUser` → `getActiveHouseholdForUser` as the single scoping seam | Member-scoped secondary repos (groceries/calendar/allergies/caldav) follow the active cookbook automatically via `ctx.userIds`; narrows blast radius | Done (Phase 2, D-05) |
| Swap unique `(url,userId)` → `(url,household_id)` | Dedup is per-cookbook; NULL household rows (personal) never collide | Done (Phase 2, D-13) |
| `recipe_permission_policy` shape unchanged; `household` reinterpreted per-cookbook | v1 uses one server-wide policy scoped to the recipe's own cookbook + requester membership; per-household override deferred to v2 (HOUSE-08) | Done (Phase 2, D-09/D-10) |
| Per-cookbook isolation in permissions.ts + dedicated tests | Security-critical (HOUSE-06): `canAccessResource` keyed on recipe household_id + requester member household ids; DB + tRPC isolation suites | Done (Phase 2, D-11/D-12) — required follow-ups in 22, 22.1–22.4, 27.1-06; two more open in 27.4 |
| Cooklang adoption is **contributable to upstream #470** (not a hard fork) | Coordinate design with the maintainer; ship as the PR that closes #470 to stay re-baseable | In progress — W0–W5 deployed; contract re-scoped as Phase 27.6 |
| **Pantry dropped**; "what can I make" is **image-based** (AH GenAI seed) | Image + optional text → AI ingredient recognition beats maintaining an inventory; deep research deferred to build-time | Pending (MAKE-01) |
| **Per-household permission policies = critical** near-term phase | Each cookbook owns its view/edit/delete; Phase 2 keeps single-policy-reinterpreted for v1, dedicated phase follows | Done (Phase 3) |
| Recipe-in-multiple-households handled via **versions / lineage** | Phase 2 stays recipes-1:N-home; saving a shared recipe forks a version in a shared bucket (future lineage_id/parent_recipe_id) | Pending (VERSION-01) |
| Sharing is **per-link only** for now (no public gallery) | Per-recipe private/household/public on `recipe_shares`; public = token no-auth view; gallery/discovery deferred | Done (Phase 4) |
| **Remote (cloud) Claude Code sessions** complement the LXC-110 model | Phone-reachable, resumable web sessions own code + cheap-verify (install/typecheck/lint/test) and push the branch; build/deploy stay operator-run on LXC 110. SessionStart hook auto-installs deps; Homelab/Hermes bridge gives phone notifications + remote permission approvals. See `.planning/REMOTE-SESSION-WORKFLOW.md` | Done (2026-06-22) |
| **Cross-AI model split = Opus supervisor (subscription) + worker model**, via gsd `cross_ai` not a router | Routing subscription OAuth through claude-code-router/a proxy is the Anthropic-banned "OpenClaw" pattern (account-suspension risk). Instead split at the orchestration layer: native Opus plans/verifies; plans marked `cross_ai: true` execute on a worker via `tooling/cross-ai/worker.sh` (no Anthropic OAuth through a proxy → ToS-clean). See `tooling/cross-ai/README.md` | Done (2026-06-22) |
| **Sole worker = Antigravity (Gemini 3.5 Flash, aggressive `--think`) on the personal Plus sub** (superseded 2026-06-27: DeepSeek fully removed) | Google ships `agy` as a first-party CLI included in the subscription (sanctioned, no extra billing) — unlike Anthropic's banned subscription-via-proxy. Plus is rate-capped, so `tooling/cross-ai/run-or-defer.sh` + a cron drainer make it quota-aware: try → on `RESOURCE_EXHAUSTED` record a cooldown, keep the task queued, let cron resume when quota returns. DeepSeek executor and all `tooling/cross-ai/` DeepSeek references were FULLY REMOVED (2026-06-27), superseding the earlier keep-disabled decision — antigravity is now the sole cross-AI worker. | Done (2026-06-22; updated 2026-06-27) |
| **Worker output is untrusted until strictly reviewed by the native supervisor** | Worker models are lower-trust; self-checks miss semantic gaps ("silent partial completion"). Hard gate (CLAUDE.md): supervisor distrusts the worker Self-Check, independently re-runs typecheck/lint/test, reads the full diff vs acceptance_criteria, re-runs per-cookbook isolation + real-row/DTO checks; worker commits aren't carried forward until review passes. SUMMARYs carry a `## Provenance` pending-review flag. | Done (2026-06-22) |
| **Import root cause is upstream's HTML sanitizer**, not the AI normalizer/retry (corrects the 2026-07-28 morning diagnosis) | `extractSanitizedBody` (packages/shared-server/src/ai/helpers.ts:93) harvests text only from h2-h6,p,li,dt,dd,figcaption. Blogger pages put the recipe in bare text nodes separated by `<br>` inside `div.post-body` — zero `<p>`, zero `<li>` — so the model receives 86–585 chars of nav chrome and correctly returns `{}` per the prompt's "Return {} if data cannot be extracted" rule. 24 of 25 live AI failures. 7/7 correlation: the only 2 pages that succeeded are the only 2 with `<li>` in the post body. Restoring the post-body text produced a valid 11-ingredient extraction. helpers.ts is byte-identical to upstream/main. | Owned by Phase 27.2; upstreaming candidate |
| **A passing gate is not evidence until it is proven to exercise the changed path** | Phase 27.1's 24/24 empirical gate certified the structured parser path, which 27.1 did not modify — all 24 logged parserPath:"structured", usedAI:false. Independently, 6 of 17 packages do not typecheck (5 via script-level --noCheck, plus apps/web via "noCheck": true in tsconfig while its script reads as an honest tsc --noEmit; a real run yields 285 errors), and the Cooklang build assertion checked only the tsdown bundle while the Next.js bundle was broken. Every defect found on 2026-07-28 was hiding behind a green gate. | Owned by Phase 27.3 |
| **Cooklang is the single source of truth; the legacy render fork, unit-converter, heuristic ingredient-link markup and timer-keyword scan all get removed** | Kiran, 2026-07-28: "Ik wil cooklang als de enige source of truth hebben. de rest mag er allemaal uitgesloopt worden." But 27-ARCHITECTURE.md:320's W6 is not executable as written — its justification "Safe because W5 guaranteed 100% coverage" is false (W5 covered existing rows: candidates:6, derived:1, flagged:5; it says nothing about future inserts or the read path). As written it breaks the structured URL-import, paste-import, Mealie-archive and manual-create write paths, and renders zero steps on 100% of recipes. | Re-scoped as Phase 27.6 with its prerequisites as hard gates |

---
*Last updated: 2026-07-28 — roadmap revamped around the real import root cause (upstream's HTML sanitizer starving the AI extractor, not the normalizer/retry); Phases 27.2–27.6 inserted (honest verification gates, Cooklang-as-source-of-truth contract); Key Decisions refreshed after five weeks of drift.*
