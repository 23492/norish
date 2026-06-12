# CLAUDE.md — norish fork (hard constraints)

This is a fork of upstream **norish-recipes/norish** (AGPL-3.0). Treat the rules below as **hard constraints** that override any plan instruction. The goal is a maintainable fork that stays close to upstream.

## Golden rules

- **Complete work, no placeholders.** No TODOs, stubs, or "left as an exercise". Every change compiles, type-checks, lints, and is tested.
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

## Documentation (Obsidian vault)

- **Document this project in Kiran's Obsidian vault** (homelab knowledge base, `projects/homelab/references/`), in addition to the repo's `.planning/` artifacts.
- Keep [[norish-feature-roadmap]] current — update the status table and append to the milestone log **semi-live, as each milestone lands** (decisions made, phases shipped, deploys done).
- When architecture changes, update/add the relevant reference pages (e.g. `norish-camofox-integration`, `camofox-browser-server`, `norish-deployment`).
- Follow the vault's llm-wiki conventions (frontmatter with summary/sources/base_confidence/provenance/lifecycle; full-path wikilinks; provenance markers). The vault's own root `CLAUDE.md` is canonical for those rules.
- Mirror significant decisions in `.planning/PROJECT.md` (Key Decisions) so the repo and the vault stay in sync.

## Fork-specific architecture

- **Scraping is native Camoufox, not headless Chrome.** The browser fetch layer (`packages/api/src/parser/fetch.ts` + `packages/api/src/playwright.ts`) calls the Camoufox REST service (config `CAMOFOX_URL`, default the LXC 105 service). Do not reintroduce a `chrome-headless` dependency or a boot-time bundle patch.
- **Households are multi-cookbook.** A user may belong to multiple households; recipes are scoped by `recipes.household_id` with an active-household selection. Per-cookbook isolation is **security-critical** — never leak recipes across households.
- **AssemblyAI is a native transcription provider** (no boot patch).

## Security

- ASVS level 2 posture (better-auth + Postgres). Validate all inputs; never weaken auth/permission checks. The per-cookbook visibility boundary (Phase 2) must be enforced server-side and covered by tests.
