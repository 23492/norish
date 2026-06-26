# Phase 20: Incorporate upstream v0.19.0-beta - Context

**Gathered:** 2026-06-26
**Status:** Ready for planning

<domain>
## Phase Boundary

Bring upstream `norish-recipes/norish` **v0.19.0-beta** (PR #468, squashed commit `1f684480` on `upstream/main`; merge-base `6af3670a`, our fork +156 commits) onto a **dedicated integration branch off `main`** — re-asserting every fork hard constraint at each conflict, adopting upstream's new `@norish/db-schema` package split, and keeping the **live stack untouched throughout**. The phase delivers a green, isolation-safe, build-passing integration branch **and** a deployment of that branch to a NEW public **`norish-beta.knoppsmart.com`** environment for validation.

**In scope:** the merge + per-subsystem conflict resolution; the db-schema split adoption + per-table reconciliation; hard-constraint re-assertion; green hard gates (isolation + db/queue testcontainer suites under `sg docker`, typecheck/lint/test, director-owned `pnpm docker:build`); and standing up + deploying to `norish-beta.knoppsmart.com` against a duplicate testing DB.

**Out of scope:** cutover of 0.19.0 to the live `norish.knoppsmart.com` stack (stays on the phases-1–19 image — a separate, deliberate future decision); pulling in *other* upstream branches (`feature/add-site-auth-tokens`, `Offline-mode`, `rc/0.17.3-beta`, `feature/rss-feed`) — each its own future phase.

</domain>

<decisions>
## Implementation Decisions

### Merge mechanics
- **D-01:** Incorporate via **`git merge upstream/main`** onto a dedicated integration branch — NOT rebase (156× per-commit conflict re-resolution against a 996-file squash is brutal/error-prone), NOT squash-merge (loses per-phase commit granularity + the resumable per-task boundaries the workflow depends on).
- **D-02:** Branch name **`integ/upstream-0.19.0`** off `main` (`866f518e`). **Tag `main` first** (e.g. `pre-0.19.0-integration`) so the pre-merge state is recoverable independent of branch churn.
- **D-03:** **One `git merge`, then resolve conflicts in dependency-ordered plans by subsystem** — order: `db-schema` → `api`/`parser` → `auth`/`permissions` → `seed-config` → `web` UI. Each subsystem resolution is its own gsd plan with isolation/build gates and a reviewable diff (NOT one giant unreviewable resolution commit).

### db-schema split (`@norish/db-schema`)
- **D-04:** **Adopt the split.** Upstream 0.19.0 moved real schema definitions into the new versioned package `@norish/db-schema` (`workspace:*`); `packages/db/src/schema/*.ts` are now one-line re-export shims (`export * from "@norish/db-schema/schema/<table>"`). Re-port our fork's table definitions (multi-household columns, `recipe_shares` `visibility` enum, `recipe_ratings`, per-cookbook `permission_level` policy columns, `site-auth-tokens`) **into** `@norish/db-schema/src/schema/*` and let our `packages/db/src/schema/*` collapse to the upstream shims. Declining the split was rejected — it fights upstream structure, breaks imports, and guarantees painful future rebases (violates the CLAUDE.md "stay close to upstream / cleanly re-baseable" constraint).
- **D-05:** **Per-table 3-way re-apply** for shared tables (`households`, `household-users`, `recipe-shares`, `recipe-ratings`, `recipes`, `site-auth-tokens`, etc.): take upstream 0.19.0's `@norish/db-schema` file as the **base** and re-apply ONLY our fork's column/enum/constraint additions on top — preserving any 0.19.0 changes to those same tables. Wholesale-replacing with our versions was rejected (silently discards upstream fixes). Verified by the db testcontainer + per-cookbook isolation suites.
- **D-06 (finding, locks migration handling):** Upstream 0.19.0 tops out at migration **`0034`** (35 journal entries, 0000–0034) — identical to our shared base. Our fork's **`0035`–`0038`** sit on top with **NO numbering collision**, and the 0.19.0 schema split is **code-only (no new SQL migrations)**. Migrations `0035–0038` carry forward **unchanged**; the `_journal.json` extends linearly. The live DB is already at migration 39 → the integration applies **no new migrations from the merge**. Both sides keep migrations in `packages/db/src/migrations` + drizzle config at `packages/db/src/drizzle.config.ts`.

### Feature triage & conflict bias
- **D-07:** **Take-all, re-assert constraints.** Accept all of upstream's 0.19.0 features/refactors by default; override ONLY where a change collides with a fork hard constraint. Selective cherry-pick of upstream features was rejected (more work inside a merge, bespoke divergence, harder future rebase).
- **D-08:** **Default conflict bias = favor upstream** for files that are NOT fork hard-constraint / fork-feature files (generic UI, hooks, shared contracts, refactors): take upstream's 0.19.0 version, re-applying our delta only where we actually changed it. **Our code wins ONLY** in the hard-constraint + feature-bearing files (see D-09): Camoufox parser, auth/permissions/claim-processor, seed-config, households/sharing/ratings/visibility/policy schema + UI.
- **D-09 (hard constraints — MANDATORY re-assertion at every conflict; from CLAUDE.md + ROADMAP success criteria, not negotiable):**
  - Scraping stays **native Camoufox** — `packages/api/src/parser/fetch.ts` → `packages/api/src/camofox.ts`; **NEVER** reintroduce `packages/api/src/playwright.ts` or a `chrome-headless` dependency / boot-time bundle patch. (Verified current: `playwright.ts` absent, `camofox.ts` present.)
  - **Per-cookbook isolation (HOUSE-06)** suites stay green — recipes never leak across households; the boundary is server-side + adversarially verified (weaken → suites go red → revert, never commit the weakening).
  - **Config-as-code env sync** preserved in `seed-config.ts` (AI / video / WorkOS / admin / registration re-seed each boot; env wins).
  - **WorkOS + multi-household + per-cookbook permissions** preserved in `auth.ts` / `permissions.ts` / `claim-processor.ts`.

### Timing & deployment (`norish-beta.knoppsmart.com`)
- **D-10:** **Integrate the beta now** on `integ/upstream-0.19.0` (off the live stack) — do not wait for a stable 0.19.0 tag. Being merge-ready early caps drift; upstream betas can sit a long time.
- **D-11:** **Publish the integration to a NEW `norish-beta.knoppsmart.com` environment** (in scope for this phase, provisioned + deployed as the **final plan(s)** of Phase 20, after the merge/resolution plans pass their green gates). This is the validation surface for 0.19.0 — it does NOT touch live. Resolves the cutover-sequencing question that was otherwise deferred: live (`norish.knoppsmart.com`) **stays on the phases-1–19 image**; cutover of 0.19.0 to live is a separate future decision.
- **D-12:** `norish-beta` runs a **duplicate testing database** — a **clone of live** (e.g. restore the existing `pg_dump` at `/home/claude/norish-backups/norish-live-20260625-162541.dump`, or a fresh dump at provisioning time), **never** sharing the live Postgres. **Keep it refreshed:** re-clone from live whenever practical so beta never validates against a stale snapshot — explicitly **no long-lived divergent / old beta DB** going forward. Document the refresh expectation so future sessions re-seed rather than let beta drift.

### Claude's Discretion
- Exact subsystem plan count / split granularity within the dependency order of D-03 (planner decides, one plan at a time per `use_worktrees: false`).
- Mechanics of the beta provisioning (compose service name, Cloudflare tunnel/ingress wiring, DB restore scripting) — within the constraints of D-11/D-12.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Phase 20 scope & assessment
- `.planning/ROADMAP.md` § "Phase 20" + § "Upstream tracking" — phase goal, success criteria, overlap summary (~996 files, ~110 overlapping).
- `.planning/REQUIREMENTS.md` — requirement **UPSTREAM-019** (full hard-constraint + reconciliation statement).
- Obsidian vault `projects/homelab/references/norish-upstream-0.19.0-assessment.md` — the canonical incorporation assessment (scope, conflict surface, recommended approach).
- `.planning/STATE.md` § "Session log" (2026-06-26) — the push-to-live deploy state (live = `norish:live` image `8f6d14ba902e`, rollback tag `norish:rollback-20260625-pre`, DB at migration 39).

### Fork hard constraints & workflow
- `/opt/norish-src/CLAUDE.md` — fork hard constraints (Camoufox-not-Chrome, per-cookbook isolation, config-as-code, director/executor way of working, environment/SSH/remote-edit, build discipline).
- Obsidian vault `projects/homelab/references/norish-fork-workflow.md` — director + executor model, lead-owned build, verified env gotchas (hardlink farms, mutual-FK `AnyPgColumn`, swap headroom, the real-Postgres-parse-test mitigation).
- Obsidian vault `projects/homelab/references/norish-feature-roadmap.md` — keep current as the merge lands.

### Code surfaces touched by the merge (conflict hotspots)
- `packages/api/src/parser/fetch.ts`, `packages/api/src/camofox.ts` — Camoufox path to re-assert (no `playwright.ts`).
- `packages/auth/src/auth.ts`, `packages/auth/src/permissions.ts`, `packages/auth/src/claim-processor.ts` — WorkOS + multi-household + per-cookbook permissions.
- `packages/api/src/startup/seed-config.ts` — config-as-code env sync.
- `packages/db/src/schema/*` (→ shims) and the new `@norish/db-schema/src/schema/*` (→ real defs); migrations under `packages/db/src/migrations` (0035–0038); `packages/db/src/drizzle.config.ts`.
- `apps/web` household / ratings / recipe-page / auth-provider UI.

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- Existing `pg_dump` for the beta DB clone: `/home/claude/norish-backups/norish-live-20260625-162541.dump` (1.6M, 222 TOC objects, restorable; live DB at migration 39).
- Rollback image already tagged: `norish:rollback-20260625-pre` (old live `bae95ed366c2`); current live `norish:live` = `8f6d14ba902e`.
- The fork's per-cookbook isolation + db testcontainer suites (run under `sg docker`) are the security/regression gate that proves D-05/D-09 post-merge.

### Established Patterns
- **db-schema is now a re-export shim pattern upstream:** `packages/db/src/schema/<t>.ts` = `export * from "@norish/db-schema/schema/<t>"`; `packages/db/src/schema/index.ts` = `export * from "@norish/db-schema/schema"`; `packages/db` depends on `@norish/db-schema: workspace:*`. Adopting D-04 means mirroring exactly this.
- **Injected workspaces are hardlink farms** — `node_modules/@norish/<pkg>/src/**` share inodes with `packages/<pkg>/src/**`. After a `git merge`/`git checkout` replaces files, re-sync broken twins (`cp -a packages/<pkg>/src/. node_modules/@norish/<pkg>/src/`). The NEW `@norish/db-schema` package will need its workspace injection materialized after merge.
- **Mutual table FKs** (e.g. `user.active_household_id ↔ households.admin_user_id`) need `references((): AnyPgColumn => other.id, …)` + `import { type AnyPgColumn }` — re-verify after re-porting our household tables into `@norish/db-schema`.
- **Adversarial verification** for security-critical resolution: after isolation suites pass, weaken the boundary → confirm red → revert (never commit the weakening).

### Integration Points
- New `@norish/db-schema` workspace must be wired into pnpm-workspace + Turbo + the build; every `@norish/db` schema consumer keeps importing from `@norish/db` (the shims), so downstream import sites should be unaffected if D-04/D-05 are done right.
- `norish-beta` is a NEW docker-compose service + DNS + Cloudflare ingress on LXC 110, alongside (not replacing) `norish-app`.

</code_context>

<specifics>
## Specific Ideas

- The user explicitly wants `norish-beta.knoppsmart.com` as the 0.19.0 validation surface (a public beta domain), and a **refreshable** testing DB — "no old db in the future." Treat beta-DB staleness as a defect: prefer re-cloning from live over letting beta drift.
- `git merge` (not rebase) and "favor upstream on non-constraint conflicts" together encode the fork's north star: minimal, isolated, re-baseable diff.

</specifics>

<deferred>
## Deferred Ideas

- **Cutover of 0.19.0 to live `norish.knoppsmart.com`** — explicitly deferred; a separate deliberate step after beta validation (and likely a stable 0.19.0 tag).
- **Other upstream branches** — `feature/add-site-auth-tokens` (+60), `Offline-mode` (+34), `rc/0.17.3-beta` (+28), `feature/rss-feed` (+3): each its own future phase, NOT part of 0.19.0. (Note: `site-auth-tokens` schema already appears on both sides at 0.19.0 — confirm during research whether the feature is already incorporated.)
- **Promotion of beta → stable** once upstream tags a non-beta 0.19.0 — a re-merge/follow-up, tracked under Upstream tracking.

None of the above were in-scope creep into the merge itself — discussion stayed within the integration boundary.

</deferred>

---

*Phase: 20-incorporate-upstream-v0-19-0-beta*
*Context gathered: 2026-06-26*
