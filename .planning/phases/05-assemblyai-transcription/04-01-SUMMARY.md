---
phase: 05-assemblyai-transcription
plan: 04-01
subsystem: api
tags: [transcription, assemblyai, video, zod, admin-ui, next-intl, vitest]

requires:
  - phase: 01-native-camofox-scraping
    provides: the build/deploy pipeline + cloud-keys-via-admin-UI principle (SETUP-05)
provides:
  - AssemblyAI as a first-class, admin-UI-selectable transcription provider
  - a native transcribeWithAssemblyAI (upload -> request -> poll) reading video_config.transcriptionApiKey (no env, no boot-patch)
  - the assemblyai provider label in all 11 locales
  - unit coverage for the assemblyai dispatch + config gating (fetch mocked)
affects: [video-import pipeline, admin video config]

tech-stack:
  added: []
  patterns:
    - "Non-AI-SDK transcription provider: a bespoke fetch upload+poll fn returning AIResult, dispatched from the same transcribeAudio switch as the Whisper/AI-SDK providers"

key-files:
  created:
    - packages/api/__tests__/server/ai/transcriber-assemblyai.test.ts
  modified:
    - packages/config/src/zod/server-config.ts
    - packages/shared/src/contracts/zod/server-config.ts
    - packages/api/src/ai/transcriber.ts
    - apps/web/app/(app)/settings/admin/components/video-processing-form.tsx
    - packages/i18n/src/messages/{da,de-formal,de-informal,en,es,fr,it,ko,nl,pl,ru}/settings.json

key-decisions:
  - "AssemblyAI is a CLOUD provider (added to TRANSCRIPTION_PROVIDERS_CLOUD) -> API-key required + auto-shown in the admin UI; no env var."
  - "No endpoint field, no dynamic model listing (AssemblyAI has a fixed API base + no Whisper /models endpoint)."
  - "transcriptionModel maps to AssemblyAI speech_model; only \"best\"|\"nano\" are sent, otherwise omitted (AssemblyAI default). Satisfies the required-model UI without breaking transcription."
  - "Error contract matches the source providers (return aiError on non-ok HTTP / error-status / timeout), not the boot-patch's bare throws."
  - "Edited BOTH byte-identical server-config.ts twins (packages/config + packages/shared/contracts) to prevent re-base drift."

patterns-established:
  - "Provider added end-to-end via the existing seams (enum + cloud-list helper drive the UI; one switch case drives the dispatch) — no pipeline re-architecture."

requirements-completed: [VIDEO-01]
duration: ~1h
completed: 2026-06-14
---

# Phase 05 Plan 04-01: AssemblyAI native transcription provider + admin-UI config — Summary

Added **AssemblyAI** as a native, config-driven transcription provider for norish's existing video-import pipeline, replacing the fragile live boot-patch with real, re-baseable source. The API key is read from `video_config.transcriptionApiKey` (encrypted DB config set in the admin UI), never an env var.

## What existed vs what was added

**Existed:** a complete video pipeline (yt-dlp+ffmpeg → audio → transcribe → caption-aware AI extraction), a `TranscriptionProviderSchema` (openai/groq/azure/generic-openai/ollama/disabled), the `transcribeAudio` dispatch `switch`, and the admin Video Processing form. `assemblyai` was **NOT** present anywhere in source (verified by exhaustive grep) — only as the live `/opt/norish/camofox-patch/apply-patch.mjs` boot-patch.

**Added:**
- `"assemblyai"` in `TranscriptionProviderSchema`, `TRANSCRIPTION_PROVIDERS_ENABLED`, and `TRANSCRIPTION_PROVIDERS_CLOUD` — in BOTH the canonical `packages/config/src/zod/server-config.ts` and its byte-identical twin `packages/shared/src/contracts/zod/server-config.ts` (kept identical).
- `transcribeWithAssemblyAI(audioPath, apiKey, model)` + a `case "assemblyai"` in `transcribeAudio` (`packages/api/src/ai/transcriber.ts`). Ports the proven flow: upload (`/v2/upload`, octet-stream, `duplex:"half"`, 300s) → create transcript (`/v2/transcript`, `{audio_url, language_detection:true, [speech_model]}`, 30s) → poll (`/v2/transcript/{id}`, 3s interval, 30s/poll, 600s deadline). Returns `AIResult` via `validateTranscript`/`aiError`, matching the other providers' contract.
- An AssemblyAI `<SelectItem>` in the admin video-processing form; the API-key field shows automatically via `isCloudTranscriptionProvider`.
- The `settings.admin.videoConfig.transcriptionProviders.assemblyai` label in all 11 locales (brand string).
- A unit test (`packages/api/__tests__/server/ai/transcriber-assemblyai.test.ts`) covering the dispatch + config gating with `fetch` mocked.

## Commits (on feat/phase-2-multi-household; NOT pushed)

- `0b38333d` feat(api): add AssemblyAI transcription provider
- `cdc07ecd` feat(web): expose AssemblyAI in video config UI
- `f0f5b858` test(api): cover AssemblyAI transcription dispatch

## Deviations from Plan

None - plan executed exactly as written. (Confirmed `TIMEOUT` is a valid `AIErrorCode`, so the timeout case uses it as specified.)

## Verification results (static — LEAD owns the live e2e)

- typecheck: `@norish/config`, `@norish/shared`, `@norish/api`, `@norish/web` — all EXIT 0.
- `pnpm i18n:check` — EXIT 0 ("All locales have complete translations").
- lint — 0 errors on every touched file (touched web file `eslint` EXIT 0; api/config/shared/i18n package lint = 0 errors, only pre-existing unrelated warnings).
- `pnpm --filter @norish/api test` — **334/334 pass (27 files)**, incl. the new `transcriber-assemblyai.test.ts` 4/4; NO real network (fetch mocked).
- `diff` of the two `server-config.ts` twins — empty (still identical).
- Did NOT run `pnpm docker:build`; did NOT call the real AssemblyAI API.

## Issues Encountered

None.

## Next Phase Readiness

Code-complete. **HUMAN-VERIFY (LEAD-owned, PENDING):** rebuild norish:local + recreate the `norishp2` verify stack, set a real AssemblyAI key in the admin UI, and import a short YouTube clip to confirm end-to-end transcription. See `/tmp/PHASE4-VIDEO-SUMMARY.md` for the verify recipe. This satisfies VIDEO-01; VIDEO-02 (TikTok/IG) is exercised by the same path at verify time (may need cookies for bot-walls); VIDEO-03/04 are retained (caption-aware extraction unchanged; no boot-patch).

## Self-Check: PASSED
- key-files.created exists on disk: `packages/api/__tests__/server/ai/transcriber-assemblyai.test.ts` ✓
- ≥1 commit per the plan grep: `0b38333d`, `cdc07ecd`, `f0f5b858` ✓
- All `<acceptance_criteria>` re-run green (counts, typecheck, i18n:check, test) ✓
- Plan-level `<verification>` re-run green ✓
