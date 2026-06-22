# CLAUDE.md — norish fork (hard constraints)

This is a fork of upstream **norish-recipes/norish** (AGPL-3.0). Treat the rules below as **hard constraints** that override any plan instruction. The goal is a maintainable fork that stays close to upstream.

## Golden rules

- **Complete work, no placeholders.** No TODOs, stubs, or "left as an exercise". Every change compiles, type-checks, lints, and is tested.
- **Always read the vault.** Kiran's Obsidian wiki is the canonical knowledge base for this fork — consult it (`wiki_search` / `wiki_read`) at the start of any task and whenever you need context, *before* acting. Start from [[norish-fork-workflow]], [[norish-feature-roadmap]], and [[norish-remote-session-workflow]]; it complements (does not replace) the repo's `.planning/` artifacts.
- **Before changing anything, ask: is it needed? is it the best way? can it be simpler? is it complete?**
- **Stay as close as possible to the original repo's code style.** Match upstream norish conventions exactly: naming, file/module layout, import ordering, error handling, typing, formatting (the repo's Prettier/ESLint config), and test style. Mirror the style of the file/package you are editing, and prefer an existing upstream pattern over inventing a new one. Keep every diff minimal and well-isolated so the fork stays cleanly re-baseable against upstream.
- **Track upstream.** `upstream` remote = norish-recipes/norish. Prefer additive, well-contained changes; consider upstreaming features.

## Stack & tooling (do not drift)

- **Package manager: pnpm@10.33.2 only.** Never npm or yarn. Monorepo = pnpm workspaces + Turbo.
- **ESM + TypeScript 5.9.** Next.js 16, React 19, better-auth 1.6.9, Drizzle ORM 0.45, tRPC 11, BullMQ, Postgres 17, Vitest 4, Zod 4.
- Workspaces: `apps/*` (web, mobile, parser-api), `packages/*` (api, auth, config, db, i18n, queue, shared, shared-react, shared-server, trpc, ui).
- Commands: `pnpm build`, `pnpm test`, `pnpm lint`, `pnpm typecheck`, `pnpm format`. DB: `pnpm db:generate` (Drizzle migrations; applied at boot).

## Environment & workflow

- **All development happens via SSH on Proxmox LXC 110** (`/opt/norish-src`). Build with `pnpm docker:build` on LXC 110; deploy the built image to the LXC 110 docker stack.
- **Follow gsd-core**: work through the phase loop (Discuss → Plan → Execute → Verify → Ship); keep `.planning/` artifacts current; verify-before-ship.
- **Conventional Commits** (`feat:`, `fix:`, `refactor:`, `test:`, `docs:`, `chore:`), imperative, scoped where useful.

## Way of working (director + executor subagents)

The repo lives on **LXC 110**; the orchestrating session runs on the operator's workstation and applies gsd-core as a **director + executor** pattern:

- **The director stays lean and does not hand-edit code.** For each gsd plan (`.planning/phases/<phase>/<phase>-<plan>-PLAN.md`) it dispatches **one fresh-context execution subagent** that owns the plan end-to-end. Waves run **one plan at a time** in dependency order (`use_worktrees: false` -> one shared tree -> no parallel executors).
- **Executors follow `.claude/gsd-core/workflows/execute-plan.md`**: honor each task's `<read_first>` before editing; treat every `<acceptance_criteria>` as a HARD GATE (run the proving command, fix-and-rerun); run `<verify>`; **commit per task** (`{type}({phase}-{plan})`) so interruptions stay resumable; then write the `SUMMARY.md` and update `STATE.md`/`ROADMAP.md`/`REQUIREMENTS.md`.
- **Cross-AI worker output is untrusted until strictly reviewed.** When a plan is delegated to a cross-AI worker (`cross_ai: true` → `tooling/cross-ai/worker.sh`; default = the Antigravity/Gemini worker), the native supervisor (Opus) MUST review the result before accepting it — **never** trust the worker's self-reported `## Self-Check`. Independently re-run `typecheck`/`lint`/`test`, read the **full diff** against the plan's `<acceptance_criteria>` for *semantic* completeness (not just file existence), and re-run the per-cookbook isolation checks. Reject → send back for rework or take it over; worker commits are not carried forward until the review passes. See `tooling/cross-ai/README.md`.
- **Security-critical changes are adversarially verified**: after isolation tests pass, temporarily weaken the boundary, confirm the suites go red, then revert (never commit the weakening).
- **The resource-sensitive build is the director's job, never a subagent's.** Run `pnpm docker:build` detached (`nohup ... &` + an exit-code sentinel) and poll it; **never** a Monitor/`sleep` wait-loop inside a subagent (it kills the subagent). Subagents run `typecheck`/`lint`/`test` only -- never `pnpm build`/`docker:build`.
- **Nothing is pushed until the phase verifies; the live stack is untouched mid-phase; live cutover is a separate, deliberate step.**

### SSH + remote-edit mechanics

- Every command: `ssh proxmox-tunnel "pct exec 110 -- bash -lc 'cd /opt/norish-src && export PATH=/usr/local/bin:$PATH && <cmd>'"` (`pct exec` PATH lacks `/usr/local/bin`). `proxmox-tunnel` is a Cloudflare Access tunnel; on the LAN, fall back to `root@192.168.2.11` directly with the same key if the token expires.
- Reliable remote edits: pipe a JSON job to `/root/.gsd/redit.py` on 110 -- `{"mode":"edit","file","old","new","count"}` (exact-match, asserts the occurrence count) or `{"mode":"write","file","content"}`. Build the JSON in a file, never via shell `echo`; confirm with `git --no-pager diff`.

### Environment gotchas (verified)

- **Injected workspaces are hardlink farms** -- `node_modules/@norish/<pkg>/src/**` share inodes with `packages/<pkg>/src/**`, so in-place edits are already live; no `cp` sync needed (`pnpm install --force` does NOT re-materialize them; re-sync `cp -a packages/<pkg>/src/. node_modules/@norish/<pkg>/src/` only after something replaces a file, e.g. `git checkout`).
- **Do not run `gsd-tools query state.update-progress`** -- it corrupts this fork's free-form multi-phase `STATE.md`/`ROADMAP.md`; edit the `.planning/` files directly.
- **Mutual table foreign keys** need `references((): AnyPgColumn => other.id, ...)` + `import { type AnyPgColumn }` or `tsc` collapses both table types to `any`.
- **Heavy Next.js builds need swap headroom**: add a temporary host swapfile + `pct set 110 -swap <MB>` (live cgroup change, no restart), restore after.

## Documentation & knowledge base (Obsidian vault)

- **Read the vault for context, always** (`wiki_search` / `wiki_read`) — ground every task in the relevant reference pages before editing (see the "Always read the vault" golden rule). The read-then-write loop is mandatory: consult it going in, update it as you land work.
- **Document this project in Kiran's Obsidian vault** (homelab knowledge base, `projects/homelab/references/`), in addition to the repo's `.planning/` artifacts.
- Keep [[norish-feature-roadmap]] current — update the status table and append to the milestone log **semi-live, as each milestone lands** (decisions made, phases shipped, deploys done).
- When architecture changes, update/add the relevant reference pages (e.g. `norish-camofox-integration`, `camofox-browser-server`, `norish-deployment`). The development **way of working** is documented at [[norish-fork-workflow]].
- Follow the vault's llm-wiki conventions (frontmatter with summary/sources/base_confidence/provenance/lifecycle; full-path wikilinks; provenance markers). The vault's own root `CLAUDE.md` is canonical for those rules.
- Mirror significant decisions in `.planning/PROJECT.md` (Key Decisions) so the repo and the vault stay in sync.

## Fork-specific architecture

- **Scraping is native Camoufox, not headless Chrome.** The browser fetch layer (`packages/api/src/parser/fetch.ts` -> `packages/api/src/camofox.ts`) calls the **bundled** Camoufox REST service (config `CAMOFOX_URL`, default the in-stack `camofox` service; override to the LXC 105 instance if desired). `packages/api/src/playwright.ts` was removed in Phase 1. Do not reintroduce a `chrome-headless` dependency or a boot-time bundle patch.
- **Households are multi-cookbook.** A user may belong to multiple households; recipes are scoped by `recipes.household_id` with an active-household selection. Per-cookbook isolation is **security-critical** — never leak recipes across households.
- **AssemblyAI is a native transcription provider** (no boot patch).

## Security

- ASVS level 2 posture (better-auth + Postgres). Validate all inputs; never weaken auth/permission checks. The per-cookbook visibility boundary (Phase 2) must be enforced server-side and covered by tests.
