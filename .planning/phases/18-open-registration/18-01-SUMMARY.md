---
phase: 18-open-registration
plan: 18-01
subsystem: config
status: code-complete
requirements: [OPEN-REGISTRATION-ENV-01]
commits: [ffbffbd7, f7b2388c, 74d0442e]
---

# Phase 18 Plan 18-01 SUMMARY: registration_enabled + password_auth_enabled via env (config-as-code) + env↔DB re-seed drift fixed

## Outcome: CODE-COMPLETE (human-verify pending: lead `pnpm docker:build` + set the toggle env vars in `/opt/norish/.env` + redeploy)

The auth toggles `registration_enabled` and `password_auth_enabled` are now configured PURELY via environment variables, re-seeded into the `server_config` DB on EVERY boot (env wins), mirroring R1's `syncAIConfigFromEnv` (phase 14) and phase 09's `syncWorkOSProvider`. The commercial WorkOS-only launch (registration OPEN + password OFF) no longer needs a manual `UPDATE server_config` and cannot drift back after a clean DB.

## The drift + why it happened

`registration_enabled` and `password_auth_enabled` live in `REQUIRED_CONFIGS` in `packages/api/src/startup/seed-config.ts` and were seeded ONLY through `seedMissingConfigs()`, gated `if (!await configExists(key))` — i.e. **first-boot-only** (`registration_enabled => true`; `password_auth_enabled => !hasOAuthEnvConfigured()`). Env changes never propagated afterward. Compounding it, `packages/auth/src/auth.ts` (the `user.create.after` hook, ~line 494) sets `registration_enabled=false` after the FIRST user signs up — so for the WorkOS-only launch the operator had to run a MANUAL `UPDATE server_config` to keep signup open + password off. There was no `syncAuthTogglesFromEnv()` equivalent to WorkOS's `syncWorkOSProvider()` or R1's `syncAIConfigFromEnv()`.

A second gap: the env layer had a DEAD `ENABLE_REGISTRATION` var (`.default(false)`, **zero consumers** anywhere) and NO `PASSWORD_AUTH_ENABLED` env var at all — so neither toggle was reachable from env even in principle.

## 1 · Env var names + where they are read

NEW env vars in `packages/config/src/env-config-server.ts` (`ServerConfigSchema`):
- **`REGISTRATION_ENABLED`** — optional boolean. Open self-service signup.
- **`PASSWORD_AUTH_ENABLED`** — optional boolean. Enable/disable email+password auth.

Both are `z.string().transform(v => v === "true" || v === "1").pipe(z.boolean()).optional()` — parsing `"true"`/`"1"` => `true`, `"false"`/`"0"` (or anything else) => `false`. **`.optional()` (no `.default()`) is load-bearing**: it makes `SERVER_CONFIG.X === undefined` the "env unset" signal, so an explicit `false` (operator intent) is DISTINCT from unset (no-op). This mirrors how R1's AI sync gates on an optional `AI_API_KEY`. The dead `ENABLE_REGISTRATION` was REMOVED.

The values are CONSUMED at runtime (unchanged) by `isRegistrationEnabled()` (`packages/config/src/server-config-loader.ts`, used in `auth.ts` + the config trpc router) and `isPasswordAuthEnabled()` / `getAvailableProviders()` (`packages/auth/src/providers.ts`) — both read the `registration_enabled` / `password_auth_enabled` DB keys that the new sync now keeps in lockstep with env.

## 2 · How `syncAuthTogglesFromEnv` re-seeds on every boot (env wins) + the empty-env no-op

`seedServerConfig()` already calls `importEnvOperatorConfig()`; R4 adds `syncAuthTogglesFromEnv()` to it (after `syncAIConfigFromEnv()`/`syncVideoConfigFromEnv()`), so it runs on EVERY boot, AFTER `seedMissingConfigs()`/`normalizeExistingConfigs()` have ensured a default row exists.

`syncAuthTogglesFromEnv()` calls a small `syncBooleanToggleFromEnv(key, envValue, label)` helper once per toggle:
1. **Gate:** if `envValue === undefined` (env var UNSET) → **NO-OP** (leave the DB/admin row as-is; no regression for self-host installs, incl. registration still auto-disabling after the first user).
2. Else read the stored bool (`getConfig<boolean>(key)`) and write `setConfig(key, envValue, null, /*sensitive*/ false)` (plain boolean, not encrypted) **ONLY when `existing !== envValue`** (no needless version bump).

**Env wins / drift fixed:** `registration_enabled`/`password_auth_enabled` have NO `isOverridden` field, so — unlike WorkOS — there is no admin-override escape hatch. Whenever the env var is SET, env is UNCONDITIONALLY authoritative and overwrites a stale DB row on every boot, INCLUDING the value `auth.ts` writes when it auto-disables registration after the first user, and any admin-UI edit via the trpc `admin/general` router (`updateRegistration`/`updatePasswordAuth`). A unit test exercises exactly the "stale DB → env wins" case and the "env true beats the post-first-user false" case. The admin-UI toggles + `auth.ts` are **untouched**.

## 3 · Files + commits / typecheck / tests / lint

- `ffbffbd7` feat(18-open-registration): `packages/config/src/env-config-server.ts` — REMOVE dead `ENABLE_REGISTRATION`; ADD `REGISTRATION_ENABLED` + `PASSWORD_AUTH_ENABLED` optional booleans.
- `f7b2388c` feat(18-open-registration): `packages/api/src/startup/seed-config.ts` — `syncBooleanToggleFromEnv` helper + `syncAuthTogglesFromEnv`, wired into `importEnvOperatorConfig()`.
- `74d0442e` test(18-open-registration): NEW `packages/api/__tests__/startup/auth-toggles-sync.test.ts` (7 tests) + `.env.example` + `docker/docker-compose.example.yml` AUTH TOGGLES block.

Verification (static + unit; LEAD owns docker:build + live deploy):
- typecheck **@norish/config** EXIT 0 (`tsc --noEmit`); **@norish/api** EXIT 0 (`tsc --noEmit --noCheck`); a strict `tsc -p packages/api/tsconfig.json --noEmit` shows **ZERO `seed-config` errors** (only the project's PRE-EXISTING errors in `@norish/auth/src/auth.ts`, `shared-server/.../category-matcher.ts`, `shared-server/.../archive/parser.ts`, `trpc/.../ratings.ts`).
- Tests: NEW **auth-toggles-sync 7/7**; **ai-config-sync 10/10** (no regression); **auth-provider-sync 23/23** (no regression); full **@norish/api 366/366** (29 files); **@norish/config 726/726**.
- lint: `@norish/api` **0 errors** (1 PRE-EXISTING unrelated warning: `normalizeTags` unused in `parser/python/adapter.ts`); `@norish/config` **0 issues**.
- Pre-existing OUT-OF-SCOPE failures (confirmed, NOT touched here — none in the packages R4 changed): `updateRecipeWithRefs` / `ingredient-unit-normalization` (db, 3 failing) and `archive-import-overwrite` (shared-server).
- Did NOT run `pnpm docker:build`. Did NOT touch live / `/opt/norish/`.

## 4 · HUMAN-VERIFY — what the LEAD deploys

1. `pnpm docker:build` (lead-owned).
2. Set in `/opt/norish/.env` (or the compose `environment:`) for COMMERCIAL (WorkOS-only):
   - `REGISTRATION_ENABLED=true`
   - `PASSWORD_AUTH_ENABLED=false`
3. Redeploy → on boot `seedServerConfig()` re-seeds both toggles from env (log lines `"Synced registrationEnabled from env (env is source of truth)"` / `"Synced passwordAuthEnabled from env ..."`), overwriting the post-first-user auto-disable and any stale admin value — open signup + WorkOS-only auth with zero admin clicks / no manual SQL.

**Fallback confirmed:** if the toggle env vars are UNSET, `syncAuthTogglesFromEnv()` is a no-op and the existing DB/admin values remain authoritative — no behavior change for current self-host installs (registration still auto-disables after the first user).

## Mechanics

`packages/config/src/env-config-server.ts` and `packages/api/src/startup/seed-config.ts` were each re-synced to their `node_modules/@norish/*` twins with `cp -a` after editing (the twins are separate inodes), so the vitest runner resolves the new code — same pattern as the phase-09 / phase-14 SUMMARYs. No new dependency; no schema/migration (`server_config` is a generic KV table; both toggle schemas already exist as `z.boolean()` and `getSchemaForConfigKey` already maps `REGISTRATION_ENABLED → z.boolean()`).

## Gaps / assumptions

- The toggle gate is pure presence-of-the-env-var (optional → undefined = unset). Setting `REGISTRATION_ENABLED=anything-non-true` parses to `false` (the zod transform only treats `true`/`1` as true) and will be written as an explicit `false` — documented in `.env.example` as `true/1 or false/0`.
- The admin-UI toggles remain (no R3-style removal was in scope here); they can still write the DB, but env re-seeds over them on the next boot whenever the env var is set — i.e. env is the source of truth, as required.
