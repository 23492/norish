# norish (Kiran's fork)

## What This Is

A self-hosted fork of [norish](https://github.com/norish-recipes/norish) (AGPL-3.0) — a recipe manager — tailored for Kiran's homelab. It keeps upstream's stack and style, adding: native Camoufox-based scraping (replacing headless Chrome), multi-household / multi-cookbook support, and AssemblyAI video transcription. The fork stays as close to upstream as possible so it remains maintainable and re-baseable.

## Core Value

Reliable recipe import & management for Kiran's groups — including bot-protected sources (AH.nl etc.) — with no more setup than the off-the-shelf norish. The package is self-contained: the Camoufox browser is bundled in the compose by default, so no external scraping service is required.

## Requirements

### Validated

(None yet — fork just created)

### Active

- [ ] Native Camoufox scraping replaces headless Chrome (no boot-patch)
- [ ] Multiple households per user (friend-group, partner, personal) with switching + per-cookbook recipe scoping
- [ ] AssemblyAI video transcription (native provider) for TikTok/Instagram/YouTube
- [ ] Minimal setup parity with upstream; clean, re-baseable diff

### Out of Scope

- Mobile app (apps/mobile) feature work — web is the target
- Rewriting upstream's recipe parser / AI extraction — works; only the fetch layer changes
- Locale config — already NL-default + EN upstream; no change needed

## Context

- Upstream: norish-recipes/norish (AGPL-3.0, very active, latest v0.18.3-beta). Monorepo: pnpm@10.33.2 + Turbo; Next.js 16, React 19, better-auth 1.6.9, Drizzle 0.45, tRPC 11, BullMQ, Postgres 17, Vitest 4, TS 5.9.
- Deploy target: LXC 110 (docker host, 192.168.2.47) — the live norish runs here. Camoufox REST service: LXC 105 (192.168.2.26:9377).
- The current live deploy uses a boot-time patch for Camoufox + AssemblyAI; this fork makes both native source, removing the patch.

## Constraints

- **Process**: All work follows gsd-core (phase loop, .planning/ artifacts, verify-before-ship).
- **Style**: Match upstream norish conventions exactly (pnpm, ESM, TS). Minimal, isolated diffs; track upstream; consider upstreaming features.
- **Env**: All development via SSH on LXC 110. Build with `pnpm docker:build` on 110. Deploy the built image to 110.
- **Licensing**: AGPL-3.0 (private use fine; offer source if exposed publicly).
- **Quality**: Complete work, no placeholders. Per-cookbook isolation (Phase 2) is security-critical.
- **Standalone**: Camoufox is bundled in the compose by default (overridable via `CAMOFOX_URL`); all cloud API keys (AI extraction, transcription, OAuth) are set in the admin UI — never required as env.

## Key Decisions

| Decision | Rationale | Outcome |
|----------|-----------|---------|
| Fork + rebuild (not boot-patch) | Maintainable, native, drops fragile bundle-patching | — Pending |
| Native Camoufox replaces Chrome in source | User directive; Camoufox beats bot-walls | — Pending |
| recipes.household_id + active-household | Enables multi-cookbook scoping; M:N join already exists | — Pending |
| AssemblyAI as native transcription provider | User choice; folds boot-patch into source | — Pending |
| Dev+build on LXC 110, gh account 23492 | User directive | Done |
| gsd-core minimal profile | Adhere to gsd-core; minimal footprint | Done |
| Camoufox bundled by default (ghcr.io/jo-inc/camofox-browser) | Standalone package, no external browser service; overridable via CAMOFOX_URL | Done |
| Cloud keys via admin UI, not env | Zero-secret env; keys persisted encrypted in DB, configured post-install | Done |

---
*Last updated: 2026-06-12 after fork setup*
