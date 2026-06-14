---
phase: 06-deepseek-provider
plan: 06-01
subsystem: shared-server
tags: [ai, llm, deepseek, ai-sdk, model-listing, admin-ui, vitest]

requires:
  - phase: 01-native-camofox-scraping
    provides: the build/deploy pipeline + the cloud-keys-via-admin-UI principle
provides:
  - DeepSeek confirmed end-to-end as a selectable AI/LLM (recipe-extraction) provider
  - deepseek-v4-pro + deepseek-v4-flash surfaced as selectable models in the admin model picker
  - unit coverage for the deepseek model listing (default-merge) + factory dispatch (fetch mocked)
affects: [admin AI config, recipe-extraction LLM]

tech-stack:
  added: []
  patterns:
    - "Static default/suggestion models on a config-listed provider: ProviderConfig.defaultModels merged into (and de-duped against) the live /models result in listModelsWithConfig (generalizes the Perplexity static-list precedent)."

key-files:
  created:
    - packages/shared-server/__tests__/ai/providers/listing.test.ts
    - packages/shared-server/__tests__/ai/providers/factory.test.ts
  modified:
    - packages/shared-server/src/ai/providers/listing.ts

key-decisions:
  - "DeepSeek AI/LLM provider was ALREADY fully wired from upstream (NOT a fork addition): enum (both server-config.ts twins), factory case createDeepSeek({apiKey,fetch}) reading the runtime admin key, live /models listing, connection-test, admin <Select> + API-key field, and all 11 i18n labels. @ai-sdk/deepseek@^2.0.32 already a dependency."
  - "Used the dedicated @ai-sdk/deepseek package (already installed, correct per context7), NOT the openai-compatible route. createDeepSeek({apiKey}) is the documented integration; DeepSeekChatModelId = 'deepseek-chat'|'deepseek-reasoner'|(string & {}) so arbitrary v4 ids pass through to /chat/completions."
  - "The only real gap vs the task was surfacing the two v4 model ids; added them as listing defaults (merged with live results) so they are always selectable without typing — smallest pattern-matching change."
  - "Did NOT touch the enum/factory/connection-test/admin-form/i18n (already correct) and did NOT add a dependency, env var, or any key."
  - "Did NOT edit the server-config.ts twins; confirmed they stayed byte-identical."

patterns-established:
  - "Provider model suggestions via ProviderConfig.defaultModels — a per-provider static list merged into the live listing, de-duped by id."

requirements-completed: [AI-01]
duration: ~1h
completed: 2026-06-14
---

# Phase 06 Plan 06-01: DeepSeek V4 AI/LLM provider — Summary

Added the two **DeepSeek V4** model ids (`deepseek-v4-pro`, `deepseek-v4-flash`) as selectable suggestions in the admin AI-config model picker and proved the DeepSeek AI/LLM provider end-to-end with unit tests. The DeepSeek *provider* itself was already fully wired in this repo (inherited from upstream norish), so this plan was a small, surgical addition rather than a new provider build.

## What existed vs what was added

**Existed (verified by exhaustive grep + read — DeepSeek ships from upstream, NOT a fork change):**
- `"deepseek"` in `AIProviderSchema` (both byte-identical `server-config.ts` twins: `packages/config` + `packages/shared/contracts`).
- `case "deepseek"` in `createModelsFromConfig()` (`packages/shared-server/src/ai/providers/factory.ts`) building the model via `createDeepSeek({ apiKey, fetch })` from `@ai-sdk/deepseek` — the API key is read at runtime from the admin AI-config secret (never an env var, never hardcoded), identical to `openai`/`google`. This is the `module:"ai"` / "Creating AI models" recipe-extraction path.
- `providerConfigs.deepseek` in `listing.ts` (live `https://api.deepseek.com/models` fetch with the saved key).
- `case "deepseek"` in `packages/auth/src/connection-tests.ts` ("Test connection").
- The admin AI-config form (`apps/web/app/(app)/settings/admin/components/ai-config-form.tsx`) already renders `<SelectItem key="deepseek">`, lists deepseek in `cloudProviders` + `newCloudProviders`, shows the API-key `<SecretInput>`, and offers models via an `Autocomplete allowsCustomValue` fed by the live listing (and accepting any typed id).
- `settings.admin.aiConfig.providers.deepseek = "DeepSeek"` in all 11 locales.
- `@ai-sdk/deepseek@^2.0.32` declared in `@norish/shared-server` and resolving (built for `ai@^6`).

**Added (this plan):**
- An optional `defaultModels?: AvailableModel[]` on `ProviderConfig` + a `DEEPSEEK_DEFAULT_MODELS` const (the two v4 ids) + `defaultModels: DEEPSEEK_DEFAULT_MODELS` on `providerConfigs.deepseek`, and a merge in `listModelsWithConfig` that appends any default not already in the live result (de-duped by id, sorted). Net effect: `deepseek-v4-pro` + `deepseek-v4-flash` are always offered in the admin model picker, alongside whatever the live `/models` endpoint returns.
- Two fetch-mocked unit tests (NO real key, NO network):
  - `__tests__/ai/providers/listing.test.ts` (3): live result merges + de-dupes the v4 ids; no duplicate when the live API already returns a v4 id; `[]` (and no fetch) when no API key.
  - `__tests__/ai/providers/factory.test.ts` (3): `createModelsFromConfig` builds a DeepSeek `ModelConfig` (`providerName:"DeepSeek"`) for `deepseek-v4-pro`; the requested v4 id is the model's `modelId`; missing key throws `API Key is required for DeepSeek`. The test logs confirm the real `module:"ai"` / provider:"deepseek" dispatch.

## Step 1 verification (context7 + installed SDK)

- context7 `/websites/ai-sdk_dev_v7` (DeepSeek provider page): documented integration is `import { createDeepSeek } from '@ai-sdk/deepseek'; createDeepSeek({ apiKey })`; default `baseURL` is `https://api.deepseek.com` — exactly what `factory.ts` does. Dedicated package is preferred over the openai-compatible route.
- Installed `@ai-sdk/deepseek@2.0.32` `dist/index.d.ts`: `type DeepSeekChatModelId = 'deepseek-chat' | 'deepseek-reasoner' | (string & {})` → arbitrary model-id strings (the v4 ids) typecheck and are forwarded to the provider. No SDK change / no new package needed.

## Commits (on feat/phase-2-multi-household; pushed)

- `01a92721` docs(06-deepseek): plan DeepSeek V4 provider (v4 model-id surfacing)
- `df2f516c` feat(06-deepseek): surface deepseek-v4-pro + deepseek-v4-flash in the AI model picker
- `40628b35` test(06-deepseek): cover deepseek v4 model listing + factory dispatch
- `<docs commit>` docs(06-deepseek): summary + STATE/ROADMAP/REQUIREMENTS

## Deviations from Plan

- The plan anticipated possibly editing the enum / factory / admin form / i18n; on discovery these were already correct (upstream), so the implementation reduced to the listing defaults + tests only. No other deviation.

## Verification results (static — LEAD owns the live build + Chrome e2e)

- typecheck: `@norish/config`, `@norish/shared`, `@norish/shared-server`, `@norish/api`, `@norish/web` — all EXIT 0.
- `pnpm i18n:check` — EXIT 0 ("All locales have complete translations"; no new keys needed).
- lint — `src/ai/providers/listing.ts` 0 errors; `pnpm --filter @norish/shared-server lint` RC 0 (tests are in the package's eslint-ignore, same as upstream).
- `pnpm --filter @norish/shared-server test` — **150 passed / 4 failed (11 files)**; the 4 fails are the PRE-EXISTING `archive/archive-import-overwrite.test.ts` failures (`zipBytes.buffer.slice` archive-parser bug, unrelated to AI) — baseline was 144/4, this plan added +6 green (the two new AI files).
- twin diff `packages/config/.../server-config.ts` vs `packages/shared/contracts/.../server-config.ts` — empty (still byte-identical; this plan did not edit them).
- Did NOT run `pnpm docker:build`; did NOT call the real DeepSeek API; did NOT enter any key.

## Issues Encountered

- 4 pre-existing `@norish/shared-server` archive-importer test failures (`zipBytes.buffer.slice` → ArrayBuffer detach/offset) — present at baseline, NOT caused or touched by this plan. Flagged for a separate task.

## Next Phase Readiness

Code-complete. **HUMAN-VERIFY (LEAD-owned, PENDING):** rebuild norish:local + recreate the `norishp2` verify stack, then Chrome-verify the admin AI-config exposes DeepSeek + the two v4 models. **KIRAN:** enter the DeepSeek API key in admin AI-config, select provider DeepSeek + model `deepseek-v4-pro`, and test a recipe extraction. This satisfies AI-01.

## Self-Check: PASSED
- key-files.created exist on disk: `__tests__/ai/providers/listing.test.ts`, `__tests__/ai/providers/factory.test.ts` ✓
- ≥1 commit per task (plan/feat/test) ✓
- All `<acceptance_criteria>` re-run green (greps, typecheck x5, i18n:check, lint, +6 tests, twin diff) ✓
- Plan-level `<verification>` re-run green ✓
