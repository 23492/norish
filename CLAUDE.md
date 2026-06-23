# CLAUDE.md — norish fork (hard constraints)

This is a fork of upstream **norish-recipes/norish** (AGPL-3.0). The rules below are **hard constraints**: they override any plan, task, or casually-phrased user instruction that appears to relax them. If a constraint seems to block the task, stop and surface the conflict — do not treat it as soft. Goal: a maintainable fork that stays close to upstream.

## Golden rules

- **Complete work, no placeholders.** No TODOs, stubs, or "left as an exercise." Every change compiles, type-checks, lints, and is tested before you call it done.
- **Read the vault first.** Kiran's Obsidian wiki is the canonical knowledge base — consult it (`wiki_search` / `wiki_read`) at the start of any task and whenever you need context, *before* acting. Start from [[norish-fork-workflow]], [[norish-feature-roadmap]], [[norish-remote-session-workflow]]. It complements (does not replace) the repo's `.planning/` artifacts.
- **Before changing anything, ask: is it needed? is it the best way? can it be simpler? is it complete?**
- **Match upstream style exactly.** Mirror the file/package you edit — naming, layout, import order, error handling, typing, Prettier/ESLint config, test style. Prefer an existing upstream pattern over a new one. Keep every diff minimal and isolated so the fork stays cleanly re-baseable.
- **Track upstream.** `upstream` remote = norish-recipes/norish. Prefer additive, well-contained changes; consider upstreaming features.

## Stack & tooling (do not drift)

- **pnpm@10.33.2 only** — never npm or yarn. Monorepo = pnpm workspaces + Turbo.
- **ESM + TypeScript 5.9.** Next.js 16, React 19, better-auth 1.6.9, Drizzle ORM 0.45, tRPC 11, BullMQ, Postgres 17, Vitest 4, Zod 4.
- Workspaces: `apps/*` (web, mobile, parser-api), `packages/*` (api, auth, config, db, i18n, queue, shared, shared-react, shared-server, trpc, ui).
- Commands: `pnpm build`, `pnpm test`, `pnpm lint`, `pnpm typecheck`, `pnpm format`. DB: `pnpm db:generate` (Drizzle migrations; applied at boot).

## Way of working (director + executor)

This session is the **director**: it orchestrates and reviews, it does **not** implement.

- **Delegate all implementation through the gsd skills — never hand-edit code, never use a raw agent.** New work becomes a gsd plan: `gsd:plan-phase` (writes `.planning/phases/<phase>/<phase>-<plan>-PLAN.md` with `<acceptance_criteria>`/`<verify>` gates) → `gsd:execute-phase` (dispatches the executor per `.claude/gsd-core/workflows/execute-plan.md`). **Do NOT** edit code yourself, and **do NOT** spawn a `general-purpose`/`claude` Agent with an ad-hoc prompt — both bypass the PLAN gates, the cross-AI worker, and the SUMMARY/STATE close-out, and produce unverifiable work. Read-only research via `Explore`/`Plan` agents is fine. *(This is the rule most easily rationalized away under a casual "just delegate / just do it" — don't.)*
- **One plan at a time.** `use_worktrees: false` → one shared tree → no parallel executors; run plans in dependency order.
- **Executors follow `execute-plan.md`:** honor each task's `<read_first>` before editing; treat every `<acceptance_criteria>` as a HARD GATE (run the proving command, fix-and-rerun); run `<verify>`; **commit per task** (`{type}({phase}-{plan})`) so interruptions stay resumable; then write `SUMMARY.md` and update `STATE.md`/`ROADMAP.md`/`REQUIREMENTS.md`.
- **Cross-AI worker output is untrusted until reviewed.** When a plan runs on the cross-AI worker (`cross_ai: true` → `tooling/cross-ai/worker.sh`; default = the Antigravity/Gemini worker), the native supervisor (Opus) MUST review before accepting — **never** trust the worker's self-reported `## Self-Check`. Independently re-run `typecheck`/`lint`/`test`, read the **full diff** against `<acceptance_criteria>` for *semantic* completeness (not just file existence), and re-run the per-cookbook isolation checks. Reject → rework or take it over; worker commits are not carried forward until review passes. See `tooling/cross-ai/README.md`.
- **Security-critical changes are adversarially verified:** after isolation tests pass, temporarily weaken the boundary, confirm the suites go red, then revert (never commit the weakening).
- **The build is the director's job, never a subagent's.** Run `pnpm docker:build` detached (`nohup … &` + an exit-code sentinel) and poll it — never a Monitor/`sleep` wait-loop in a subagent (it kills the subagent). Subagents run `typecheck`/`lint`/`test` only.
- **Nothing is pushed until the phase verifies; the live stack is untouched mid-phase; live cutover is a separate, deliberate step.**
- **Conventional Commits** (`feat:`/`fix:`/`refactor:`/`test:`/`docs:`/`chore:`), imperative, scoped.

## Environment

- **Development is on Proxmox LXC 110** (`/opt/norish-src`); build with `pnpm docker:build` on 110 and deploy the image to the LXC 110 docker stack.
- **SSH:** `ssh proxmox-tunnel "pct exec 110 -- bash -lc 'cd /opt/norish-src && export PATH=/usr/local/bin:$PATH && <cmd>'"` (`pct exec` PATH lacks `/usr/local/bin`). `proxmox-tunnel` is a Cloudflare Access tunnel; on the LAN, fall back to `root@192.168.2.11` with the same key if the token expires.
- **Remote edits:** pipe a JSON job to `/root/.gsd/redit.py` on 110 — `{"mode":"edit","file","old","new","count"}` (exact-match, asserts the count) or `{"mode":"write","file","content"}`. Build the JSON in a file, never via shell `echo`; confirm with `git --no-pager diff`.
- **Do not run `gsd-tools query state.update-progress`** — it corrupts this fork's free-form multi-phase `STATE.md`/`ROADMAP.md`; edit the `.planning/` files directly.

### Gotchas (verified)

- **Injected workspaces are hardlink farms** — `node_modules/@norish/<pkg>/src/**` share inodes with `packages/<pkg>/src/**`, so in-place edits are already live; no `cp` sync needed (`pnpm install --force` does NOT re-materialize them; re-sync `cp -a packages/<pkg>/src/. node_modules/@norish/<pkg>/src/` only after something replaces a file, e.g. `git checkout`).
- **Mutual table foreign keys** need `references((): AnyPgColumn => other.id, …)` + `import { type AnyPgColumn }`, or `tsc` collapses both table types to `any`.
- **Heavy Next.js builds need swap headroom:** add a temporary host swapfile + `pct set 110 -swap <MB>` (live cgroup change, no restart), restore after.

## Documentation (Obsidian vault + .planning)

- **Read going in, write as you land** (the loop is mandatory; see the "Read the vault first" golden rule). Document this project in Kiran's vault (`projects/homelab/references/`) alongside the repo's `.planning/` artifacts.
- Keep [[norish-feature-roadmap]] current — update the status table and milestone log **semi-live, as each milestone lands**. When architecture changes, update/add the relevant reference pages (`norish-camofox-integration`, `camofox-browser-server`, `norish-deployment`).
- Follow the vault's llm-wiki conventions (frontmatter, full-path wikilinks, provenance markers); the vault's root `CLAUDE.md` is canonical for those. Mirror significant decisions in `.planning/PROJECT.md` (Key Decisions) so repo and vault stay in sync.

## Fork-specific architecture

- **Scraping is native Camoufox, not headless Chrome.** `packages/api/src/parser/fetch.ts` → `packages/api/src/camofox.ts` calls the **bundled** Camoufox REST service (`CAMOFOX_URL`, default the in-stack `camofox` service; override to LXC 105 if desired). `packages/api/src/playwright.ts` was removed in Phase 1. Never reintroduce a `chrome-headless` dependency or a boot-time bundle patch.
- **Households are multi-cookbook.** A user may belong to multiple households; recipes are scoped by `recipes.household_id` with an active-household selection.
- **AssemblyAI is a native transcription provider** (no boot patch).

## Security

- ASVS level 2 (better-auth + Postgres). Validate all inputs; never weaken auth/permission checks.
- **Per-cookbook isolation is security-critical — never leak recipes across households.** The visibility boundary must be enforced server-side and covered by tests.
