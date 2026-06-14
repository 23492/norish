---
phase: 09-workos-env-config
plan: 09-01
subsystem: auth
status: code-complete
requirements: [WORKOS-ENV-01]
commits: [bf6d57a7, e3d425a6, 2b10e323, 6693f7e1]
---

# Phase 09 Plan 09-01 SUMMARY: WorkOS auth provider via env (config-as-code) + admin-UI card removed

## Outcome: CODE-COMPLETE (human-verify pending: lead docker:build + set WORKOS_CLIENT_ID in the live compose + redeploy; owner sets WORKOS_API_KEY)

WorkOS AuthKit is now configured PURELY via environment variables (`WORKOS_CLIENT_ID` + `WORKOS_API_KEY`), set in the backend/compose at deploy time — never via the admin UI. The WorkOS card has been removed from Settings → Admin → Auth Providers. The phase-08 genericOAuth WorkOS provider logic is unchanged; only the CONFIG SOURCE moved from admin-runtime to env.

## How norish's env→provider pattern works (investigated) + how it was mirrored for WorkOS

norish does NOT read provider env directly into the provider; it **seeds the DB at boot**, then loads the DB into the in-memory cache that better-auth consumes:

1. `packages/api/src/startup/seed-config.ts::seedServerConfig()` (runs after migrations) calls `importEnvAuthProvidersIfMissing()` → `syncOIDCProvider()/syncGitHubProvider()/syncGoogleProvider()`.
2. Each `syncXProvider()` reads its env vars from `SERVER_CONFIG` (`packages/config/src/env-config-server.ts`) and writes the `auth_provider_*` row: **insert** if no row; **update** a non-overridden row when env differs (`configsDiffer`); **delete** a non-overridden row when env is removed; **never touch** an `isOverridden=true` row (admin-edited).
3. `loadAuthProvidersIntoCache()` then reads all `auth_provider_*` rows into the global provider cache (`setAuthProviderCache`), which `packages/auth/src/auth.ts` reads via `provider-cache.ts` getters (`getCachedWorkOSProvider`) when it builds better-auth.

WorkOS was the ONLY provider missing both the `WORKOS_*` env vars and a `syncWorkOSProvider()` — phase-08 deliberately made it admin-only. This plan added both, mirroring `syncGoogleProvider()` exactly.

**Precedence: env over DB.** `syncWorkOSProvider()` writes `isOverridden:false`. Since the admin UI is removed, no code path ever sets `isOverridden:true` on a fresh deployment, so env is always authoritative: on every boot the DB row is (re)seeded/updated from env, and on env change the row is overwritten. (A legacy admin-set `isOverridden:true` row would still be respected — defensive parity with OIDC/Google — but the UI that could set it is gone.) `WorkOS` was also added to `hasOAuthEnvConfigured()` so password-auth correctly defaults OFF when only WorkOS env is configured.

## Exact env var names + where they are read

- **`WORKOS_CLIENT_ID`** — the WorkOS Client ID (`client_...`/`project_...`).
- **`WORKOS_API_KEY`** — the WorkOS API Key (`sk_...`), used as the OAuth `client_secret`.
- **Defined** in `packages/config/src/env-config-server.ts` `ServerConfigSchema` (both `z.string().optional()`).
- **Read** in `packages/api/src/startup/seed-config.ts`: `syncWorkOSProvider()` (env→DB seed/update/delete) + `hasOAuthEnvConfigured()` (password-auth default). The genericOAuth provider itself still reads `clientId`/`apiKey` from the cached DB row via `getCachedWorkOSProvider()` in `auth.ts` — unchanged.

## WorkOS admin-UI card: REMOVED

`apps/web/app/(app)/settings/admin/components/auth-providers/auth-providers-card.tsx` — the `key="workos"` `AccordionItem` is deleted, along with the now-unused `tWorkos` translation hook, the `authProviderWorkOS` context destructure, and `workos:false` from `dirtySections`. `grep -ni workos` on the file returns NONE. The google/github/oidc cards and the shared generic `AuthProviderForm` are untouched (verified: web typecheck EXIT 0, web suite 379/379). The backend `auth_provider_workos` server-config key, `AuthProviderWorkOSSchema`, provider-cache, and the tRPC `updateWorkOS`/`testWorkOSProvider`/context plumbing were intentionally LEFT intact (harmless dead-ish admin path; removing them would be a larger, riskier change and the generic form is shared with google/github). The WorkOS i18n keys remain (still referenced by the tRPC/test paths; i18n:check EXIT 0).

## Files + commits

- `bf6d57a7` feat(09-workos-env): `packages/config/src/env-config-server.ts` (WORKOS_CLIENT_ID/WORKOS_API_KEY) + `packages/api/src/startup/seed-config.ts` (hasOAuthEnvConfigured, importEnvAuthProvidersIfMissing, NEW syncWorkOSProvider).
- `e3d425a6` feat(09-workos-env): `apps/web/.../auth-providers/auth-providers-card.tsx` (WorkOS card removed).
- `2b10e323` docs(09-workos-env): `.env.example` + `docker/docker-compose.example.yml` (Option 5: WorkOS AuthKit, env-only).
- `6693f7e1` test(09-workos-env): `packages/api/__tests__/startup/auth-provider-sync.test.ts` (WorkOS env-sync describe, +6 tests).

## Verification (static + unit; LEAD owns docker:build + Chrome + WorkOS dashboard)

- typecheck config/shared/db/auth/trpc/api/web all **EXIT 0** (web is a real `tsc --noEmit`).
- i18n:check **EXIT 0**; lint api 0 errors (1 pre-existing unrelated warning in parser/python/adapter.ts) + config 0 + the web card file EXIT 0.
- Tests: `@norish/api` **348/348** (auth-provider-sync 22/22 incl. the 6 new WorkOS cases — insert-from-env, env-over-DB precedence, no-rewrite-when-equal, isOverridden respected, clientId-only-not-seeded, delete-when-removed); `@norish/auth` **106/106** (workos-provider 7/7 unchanged — provider logic untouched); `@norish/web` **379/379**; `@norish/trpc` **255/255**.
- Pre-existing OUT-OF-SCOPE failures (NOT touched here): archive-import-overwrite (shared-server), updateRecipeWithRefs (db).

## Mechanics

`env-config-server.ts` is an inode-shared hardlink to its `node_modules/@norish/config` twin (edit propagated automatically). `seed-config.ts`'s `node_modules/@norish/api` twin was a STALE separate copy — re-linked with `ln -f` so the test runner resolves the new `syncWorkOSProvider`. No new dependency, no schema/migration (server_config is a generic KV table), no env-config validation change beyond the two optional vars, no live-container/boot-patch/`/opt/norish/` touch, no `pnpm docker:build`.

## HUMAN-VERIFY (pending)

- **LEAD**: `pnpm docker:build`; set `WORKOS_CLIENT_ID` in the live compose; redeploy; confirm the WorkOS card is gone from Settings → Admin → Auth Providers and the "Continue with WorkOS" login button appears once both env vars are set (the button gate is unchanged from phase 08 — shows when `workos.clientId` is in the cache, which is now env-seeded).
- **OWNER**: set `WORKOS_API_KEY` in the deploy env (kept out of the committed compose). Both vars must be present for the provider to activate (`hasEnvConfig = clientId && apiKey`).
- Callback URI to register in the WorkOS dashboard (unchanged from phase 08): `${AUTH_URL}/api/auth/oauth2/callback/workos`.

## Gaps / assumptions

- The admin tRPC `updateWorkOS` mutation + `testWorkOSProvider` + the shared-react/context WorkOS wiring remain in the codebase (only the UI card was removed). They are unreachable from the UI now; left in place to avoid a larger blast radius on the shared generic form. A follow-up could prune them.
- Auth-provider config is `RESTART_REQUIRED` (phase-08 baseline): changing the WorkOS env vars requires a container restart for `seedServerConfig` to re-seed and `auth.ts` to rebuild — expected for env-config-as-code.
