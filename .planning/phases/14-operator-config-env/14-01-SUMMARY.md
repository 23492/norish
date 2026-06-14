---
phase: 14-operator-config-env
plan: 14-01
subsystem: config
status: code-complete
requirements: [OPERATOR-CONFIG-ENV-01]
commits: [d666e519, 076ea683, bff90cc3, 7ab70bce]
---

# Phase 14 Plan 14-01 SUMMARY: AI provider + transcription via env (config-as-code) + env↔DB re-seed drift fixed

## Outcome: CODE-COMPLETE (human-verify pending: lead `pnpm docker:build` + set the AI env vars in `/opt/norish/.env` + redeploy; Kiran provides the real key)

The AI provider and video transcription are now configured PURELY via environment variables, re-seeded into the `server_config` DB on EVERY boot (env wins), mirroring phase 09's `syncWorkOSProvider`. A clean DB + the AI env vars → AI extraction works immediately with zero admin-UI clicks, and the live `PROVIDER_ERROR: "API Key is required for OpenAI provider"` regression cannot recur.

## The bug + why it happened (the drift, quoted)

`ai_config` (and `video_config`) lived in `REQUIRED_CONFIGS` in `packages/api/src/startup/seed-config.ts` and were seeded ONLY through `seedMissingConfigs()`, which is gated `if (!await configExists(key))` — i.e. **first-boot-only**. On the clean-DB cutover the row was seeded once from env; with `AI_API_KEY` unset it persisted an **empty-key** default `{provider:openai, model:gpt-5-mini, apiKey:undefined}`, and the AI factory (`packages/shared-server/src/ai/providers/factory.ts`, `case "openai"`) throws `"API Key is required for OpenAI provider"`. There was **no `syncAIConfigFromEnv()`** — WorkOS had `syncWorkOSProvider()` (insert / update-on-diff / delete, run on every boot inside `importEnvAuthProvidersIfMissing()`), but AI/video had nothing, so any later admin-UI edit DRIFTED and a stale DB row won on every subsequent boot.

A second latent gap: the AI factory already supports `deepseek`, `google`, `anthropic`, `mistral`, `perplexity`, `azure`, `groq` (phases 05/06) and `TranscriptionProviderSchema` already includes `assemblyai`, but the env `AI_PROVIDER` enum only allowed `["openai","ollama","lm-studio","generic-openai"]` and `TRANSCRIPTION_PROVIDER` omitted `assemblyai`. So `AI_PROVIDER=deepseek` would have FAILED zod env validation at boot.

## 1 · Env var names + where they are read

No new var NAMES were needed (they already existed in `packages/config/src/env-config-server.ts`); R1 widened their enums and made them authoritative. norish uses a **single `AI_API_KEY`** for all cloud providers (no per-provider keys) — that convention is kept.

AI provider (read in `syncAIConfigFromEnv()`):
- **`AI_ENABLED`** (bool), **`AI_PROVIDER`** (enum, now full set incl. `deepseek`/`google`/`anthropic`/`mistral`/`groq`/`perplexity`/`azure`/`ollama`/`lm-studio`/`generic-openai`), **`AI_MODEL`**, **`AI_API_KEY`** (cloud key, encrypted at rest), **`AI_ENDPOINT`** (local providers), **`AI_TEMPERATURE`**, **`AI_MAX_TOKENS`**, **`AI_TIMEOUT_MS`**.

Transcription (read in `syncVideoConfigFromEnv()`):
- **`TRANSCRIPTION_PROVIDER`** (enum, now incl. `assemblyai`+`groq`+`azure`), **`TRANSCRIPTION_API_KEY`** (encrypted), **`TRANSCRIPTION_ENDPOINT`**, **`TRANSCRIPTION_MODEL`**, plus **`VIDEO_PARSING_ENABLED`**, **`VIDEO_MAX_LENGTH_SECONDS`**, **`YT_DLP_VERSION`**, **`YT_DLP_PROXY`**, **`MAX_VIDEO_FILE_SIZE`**.

Definitions: `packages/config/src/env-config-server.ts` (`ServerConfigSchema`). Consumed at runtime by `createModelsFromConfig`/`getModels` (`packages/shared-server/src/ai/providers/factory.ts`) via `getAIConfig()`, and by the transcriber (`packages/api/src/ai/transcriber.ts`) via `getVideoConfig()` — both unchanged; they read the `ai_config`/`video_config` DB row that the new sync now keeps in lockstep with env.

## 2 · How `syncAIConfigFromEnv` re-seeds on every boot (env wins) + drift fixed

`seedServerConfig()` now calls `importEnvOperatorConfig()` (→ `syncAIConfigFromEnv()` + `syncVideoConfigFromEnv()`) right after `importEnvAuthProvidersIfMissing()`, so it runs on EVERY boot, AFTER `seedMissingConfigs()`/`normalizeExistingConfigs()` have ensured a default row exists.

`syncAIConfigFromEnv()`:
1. Gate `hasEnvConfig = !!(AI_API_KEY || AI_ENDPOINT)` — covers cloud (key) and local (endpoint). If unset → **no-op** (the DB/admin row stays authoritative; no regression for self-host installs).
2. Reads the existing decrypted row (`getConfig(AI_CONFIG, true)`), builds the operator subset `{enabled, provider, endpoint, model, apiKey, temperature, maxTokens, timeoutMs}` from env, and MERGES it over the existing row so admin-behavior fields `{visionModel, autoTagAllergies, alwaysUseAI, autoTaggingMode}` are PRESERVED.
3. Writes via `setConfig(AI_CONFIG, merged, null, /*sensitive*/ true)` — so `apiKey` is encrypted at rest (same as the WorkOS apiKey) — but ONLY when the result differs from the stored row, using a key-order-insensitive deep compare (`operatorConfigEqual`) so a no-change boot does not bump the row version.

**Drift fixed / env wins:** `AIConfig`/`VideoConfig` have NO `isOverridden` field, so unlike WorkOS there is no admin-override escape hatch — whenever the env gate is satisfied, env is UNCONDITIONALLY authoritative and overwrites a stale DB row on every boot (a unit test exercises exactly the "stale admin-edited row → env wins" case). `syncVideoConfigFromEnv()` is the analog, gated `TRANSCRIPTION_PROVIDER !== "disabled" && (TRANSCRIPTION_API_KEY || TRANSCRIPTION_ENDPOINT)`.

The admin-UI AI/transcription forms are **untouched** (their removal is R3); when env is unset the prior DB/admin behavior is exactly preserved.

## 3 · Files + commits / typecheck / tests

- `d666e519` docs(14-operator-config): `.planning/phases/14-operator-config-env/14-01-PLAN.md`.
- `076ea683` feat(14-operator-config): `packages/config/src/env-config-server.ts` — widened `AI_PROVIDER` (full `AIProviderSchema` set) + `TRANSCRIPTION_PROVIDER` (+`assemblyai`/`groq`/`azure`) enums.
- `bff90cc3` feat(14-operator-config): `packages/api/src/startup/seed-config.ts` — `AIConfig`/`VideoConfig` type imports, `operatorConfigEqual`, `importEnvOperatorConfig` + `syncAIConfigFromEnv` + `syncVideoConfigFromEnv`, wired into `seedServerConfig()`.
- `7ab70bce` test(14-operator-config): NEW `packages/api/__tests__/startup/ai-config-sync.test.ts` (10 tests) + `.env.example` + `docker/docker-compose.example.yml` AI/transcription block.

Verification (static + unit; LEAD owns docker:build + live deploy):
- typecheck **config / db / shared-server / api all EXIT 0** (config + db are real `tsc --noEmit`; api + shared-server use `--noCheck` per their package config — a strict `tsc --noEmit` on api shows ZERO `seed-config` errors, only the project's PRE-EXISTING errors in `@norish/auth/src/auth.ts`, `shared-server/.../category-matcher.ts`, `shared-server/.../archive/parser.ts`).
- Tests: NEW `ai-config-sync` **10/10**; `auth-provider-sync` **23/23** (no regression); full **`@norish/api` 359/359** (28 files); `transcriber-assemblyai` 4/4 green.
- lint: `@norish/api` 0 errors (1 PRE-EXISTING unrelated warning in `parser/python/adapter.ts`); `@norish/config` 0 issues. `i18n:check` EXIT 0.
- Pre-existing OUT-OF-SCOPE failures (confirmed, NOT touched here): `archive-import-overwrite` (shared-server, 4 failing) and `updateRecipeWithRefs`/`ingredient-unit-normalization` (db, 3 failing).
- Did NOT run `pnpm docker:build`. Did NOT enter any real key. Did NOT touch live / `/opt/norish/`.

## 4 · HUMAN-VERIFY — what the LEAD deploys

1. `pnpm docker:build` (lead-owned).
2. Set in `/opt/norish/.env` (or the compose `environment:`), kept out of git:
   - `AI_ENABLED=true`
   - `AI_PROVIDER=deepseek`
   - `AI_MODEL=deepseek-chat`  *(adjust to the exact DeepSeek model id you want, e.g. `deepseek-v4-pro` if that's the live name)*
   - `AI_API_KEY=<DeepSeek key — Kiran provides>`
   - (optional transcription) `VIDEO_PARSING_ENABLED=true` + `TRANSCRIPTION_PROVIDER=assemblyai` + `TRANSCRIPTION_API_KEY=<key>` + `TRANSCRIPTION_MODEL=best`
3. Redeploy → on boot `seedServerConfig()` re-seeds `ai_config` from env (log line `"Synced AI config from env (env is source of truth)"`), the empty-key row is overwritten, and recipe-import AI extraction succeeds with zero admin clicks.

**Fallback confirmed:** if the AI env vars are UNSET, `syncAIConfigFromEnv()` is a no-op and the existing DB/admin AI config remains authoritative — no behavior change for current self-host installs. Same for transcription when `TRANSCRIPTION_PROVIDER=disabled` or no key/endpoint.

## Mechanics

`packages/config/src/env-config-server.ts`, `packages/config/src/zod/server-config.ts`, and `packages/api/src/startup/seed-config.ts` were each re-linked to their `node_modules/@norish/*` twins with `ln -f` after editing (the twins were stale separate inodes), so the vitest runner resolves the new code (same pattern noted in the phase-09 SUMMARY). No new dependency; no schema/migration (`server_config` is a generic KV table; `AIConfigSchema`/`VideoConfigSchema` already carry all providers); the contracts copy `packages/shared/src/contracts/zod/server-config.ts` already had every provider and was not touched.

## Gaps / assumptions

- Provider/key gating intentionally requires `AI_API_KEY` OR `AI_ENDPOINT` (resp. transcription key/endpoint) as the "operator intends env config" signal — setting only `AI_PROVIDER`/`AI_MODEL` without a key/endpoint will NOT trigger the sync (avoids clobbering an admin row with a keyless config). Documented in `.env.example`.
- The admin AI/transcription forms remain (R3 removes them); they can still write the DB, but env re-seeds over them on the next boot whenever the env gate is set — i.e. env is the source of truth, as required.
