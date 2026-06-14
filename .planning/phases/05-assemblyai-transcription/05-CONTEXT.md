# Phase 5: AssemblyAI transcription provider - Context

**Gathered:** 2026-06-14
**Status:** Ready for planning (scope is tight + fully grounded in existing code + the proven boot-patch flow)

> Scope: add **AssemblyAI** as a first-class, admin-UI-selectable transcription provider for the EXISTING video-import pipeline. Do NOT re-architect the pipeline. This brings the live boot-patch (`/opt/norish/camofox-patch/apply-patch.mjs`, READ-ONLY reference) in as real source.

<domain>
## Phase Boundary

norish ALREADY ships a complete video-import pipeline (yt-dlp + ffmpeg download → audio extraction → transcription → caption-aware AI recipe extraction) for YouTube/Instagram/generic platforms, plus a `TranscriptionProviderSchema` enum and a provider-dispatch `switch` in `transcribeAudio()`. Existing providers: `openai`, `groq`, `azure` (cloud/Whisper via the Vercel AI SDK), `generic-openai` (local OpenAI-compatible Whisper servers), `ollama` (native), and `disabled`.

**VIDEO-01** makes **AssemblyAI** a selectable native transcription provider whose API key is configured in the admin UI (persisted encrypted in the DB `video_config`, per SETUP-05), NOT an env var. AssemblyAI is NOT Whisper/AI-SDK-compatible — it has its own upload→request→poll REST flow, so it needs a bespoke `transcribeWithAssemblyAI` implementation rather than the shared `experimental_transcribe` path.

**In scope:**
- Add `"assemblyai"` to `TranscriptionProviderSchema` (the canonical `packages/config` copy + the byte-identical `packages/shared/src/contracts/zod` duplicate) and to `TRANSCRIPTION_PROVIDERS_CLOUD` (it requires an API key).
- A real `transcribeWithAssemblyAI(audioPath, apiKey, model)` in `packages/api/src/ai/transcriber.ts` + a `case "assemblyai"` in the `transcribeAudio` switch, porting the proven upload→poll flow from the boot-patch (sane timeouts + error handling matching the other providers, returning `AIResult`).
- Make AssemblyAI selectable in the admin Video Processing form (one `<SelectItem>`); the cloud-provider API-key field shows automatically via the existing `isCloudTranscriptionProvider` helper.
- i18n string `settings.admin.videoConfig.transcriptionProviders.assemblyai` in ALL 11 locales (nl+en real; the other 9 EN-fallback — "AssemblyAI" is a brand name, identical everywhere).
- A focused unit test for the dispatch + config gating (mock `fetch`; NO real AssemblyAI calls).

**Out of scope / deferred:**
- Re-architecting the video pipeline, processor-factory, or download/ffmpeg layer.
- Dynamic AssemblyAI model listing (it has no Whisper-style `/models` endpoint; not added to `TRANSCRIPTION_PROVIDERS_WITH_MODEL_LISTING`).
- A transcription-endpoint field for AssemblyAI (the API base is fixed; not added to `TRANSCRIPTION_PROVIDERS_NEED_ENDPOINT`).
- The real live-key configuration + docker build + Chrome end-to-end verification — LEAD-owned (this executor does source + static verify + unit tests only).
- TikTok-specific hardening (VIDEO-05, v2).
</domain>

<current_state>
## Current State (ground truth — quoted from the actual code)

### The enum + helpers — `packages/config/src/zod/server-config.ts` (canonical; `packages/shared/src/contracts/zod/server-config.ts` is a byte-identical git-tracked twin — different inode, NOT a hardlink, must be edited in lockstep)

```ts
export const TranscriptionProviderSchema = z.enum([
  "openai", "groq", "azure", "generic-openai", "ollama", "disabled",
]);

export const TRANSCRIPTION_PROVIDERS_CLOUD = [
  "openai", "groq", "azure",
] as const satisfies readonly TranscriptionProvider[];

export function isCloudTranscriptionProvider(provider: TranscriptionProvider): boolean {
  return (TRANSCRIPTION_PROVIDERS_CLOUD as readonly string[]).includes(provider);
}
```

`VideoConfigSchema.transcriptionApiKey` is `z.string().optional()`; `transcriptionModel` is `z.string().min(1)` (REQUIRED for every enabled provider). All real consumers import from `@norish/config/zod/server-config`; nothing imports the `@norish/shared/contracts/zod/server-config` path directly, and `packages/db/src/zodSchemas/server-config.ts` is `export * from "@norish/config/zod/server-config"`. Keep the two source files identical to avoid re-base drift.

### The dispatch — `packages/api/src/ai/transcriber.ts`

`transcribeAudio(audioPath)` reads `getVideoConfig(true)` + `getAIConfig(true)`, derives `provider`, `model = videoConfig.transcriptionModel || "whisper-1"`, `endpoint`, `apiKey = videoConfig.transcriptionApiKey || aiConfig?.apiKey || ""`, blocks cloud providers with no key (`isCloudTranscriptionProvider`), then a `switch (provider)`. Provider fns return `AIResult<string>` via `validateTranscript(text)` / `aiError(...)`; the outer `try/catch` maps thrown errors via `mapErrorToCode`. The Ollama fn shows the fetch pattern: it returns `aiError(...)` on `!response.ok`. Imports already include `createReadStream` from `node:fs`, `aiLogger`, `aiError`/`aiSuccess`/`validateTranscript`-style helpers, and `logStart`.

Called from 3 processors: `packages/api/src/video/processors/{youtube,instagram,generic}.ts` — all `await transcribeAudio(audioPath)`.

### The admin UI — `apps/web/app/(app)/settings/admin/components/video-processing-form.tsx`

A `<Select>` lists providers (`disabled/openai/groq/azure/ollama/generic-openai`). `needsTranscriptionApiKey = isCloudTranscriptionProvider(provider)` drives the `<SecretInput>` API-key field; `needsTranscriptionEndpoint`/`supportsModelListing` drive the endpoint + model controls. Adding AssemblyAI to `TRANSCRIPTION_PROVIDERS_CLOUD` makes the API-key field appear automatically. AssemblyAI is NOT in the endpoint/model-listing lists, so the form renders the plain-text "Model" `Input` (the `!supportsModelListing` branch) — used as the AssemblyAI `speech_model`.

### i18n — `packages/i18n/src/messages/<locale>/settings.json`

`settings.admin.videoConfig.transcriptionProviders` = `{ disabled, openai, groq, azure, ollama, genericOpenai }` in all 11 locales. `i18n:check` uses `en` as source-of-truth and **fails (exit 1) on any key present in `en` but missing in a target locale** — so the new `assemblyai` key must be added to ALL 11.

### The proven flow — `/opt/norish/camofox-patch/apply-patch.mjs` (lines ~194-252, READ-ONLY)

`transcribeWithAssemblyAI(audioPath, apiKey)`:
1. `POST https://api.assemblyai.com/v2/upload` — headers `authorization: apiKey`, `content-type: application/octet-stream`; body `createReadStream(audioPath)`; `duplex: "half"`; `AbortSignal.timeout(300000)` → `{ upload_url }`.
2. `POST .../v2/transcript` — JSON `{ audio_url: upload_url, language_detection: true }`; 30s timeout → `{ id }`.
3. Poll loop: 600s deadline; each iteration sleeps 3s then `GET .../v2/transcript/{id}` (auth header, 30s timeout); `completed` → `validateTranscript(data.text)`; `error` → throw `data.error`; deadline → throw "timed out".

Non-ok responses throw with `\`AssemblyAI <stage> error: <status> - <text>\``.
</current_state>

<decisions>
## Decisions (defaults chosen; consistent with the boot-patch + existing source)

- **D-1: AssemblyAI is a CLOUD provider.** Add to `TRANSCRIPTION_PROVIDERS_CLOUD` → API key required + auto-shown in the UI. (Matches the boot-patch, which added it to the cloud list.)
- **D-2: No endpoint, no dynamic model listing.** The API base is fixed; AssemblyAI has no Whisper `/models` endpoint. Do NOT add to `_NEED_ENDPOINT` / `_WITH_MODEL_LISTING`.
- **D-3: `transcriptionModel` is mapped to AssemblyAI's `speech_model`.** The schema requires a non-empty model for every enabled provider and the UI renders a model text-input for AssemblyAI. Pass it as `speech_model` (AssemblyAI accepts `"best"` | `"nano"`). The fn signature becomes `transcribeWithAssemblyAI(audioPath, apiKey, model)`; an empty/garbage model is tolerated by sending `speech_model` only when it is `"best"`/`"nano"` (otherwise omit → AssemblyAI default). This keeps the boot-patch behavior (which hardcoded the default) forward-compatible without breaking the required-model UI.
- **D-4: Match the source error contract, not the boot-patch's bare throws.** Return `aiError(...)` for non-ok HTTP (like `transcribeWithOllama`) and for the timeout/error-status cases, so failures surface as typed `AIResult` rather than relying solely on the outer catch. `language_detection: true` retained (mirrors the existing providers' language-agnostic behavior).
- **D-5: Edit BOTH `server-config.ts` files identically.** Avoids re-base drift even though only the `@norish/config` copy is consumed today.
</decisions>

<verification>
## How this phase is verified (static only — LEAD owns the live e2e)

- `pnpm --filter @norish/config typecheck` + `@norish/shared` + `@norish/api` + `@norish/web` EXIT 0.
- `pnpm lint` clean on every touched file.
- `pnpm i18n:check` EXIT 0 (the `assemblyai` key present in all 11 locales).
- A new `packages/api/__tests__/server/ai/transcriber-assemblyai.test.ts` passes with `fetch` mocked: (a) `assemblyai` with no key → `AUTH_ERROR`; (b) full upload→create→poll happy path returns the transcript; (c) a non-ok upload → `aiError`. NO real network.
- `isCloudTranscriptionProvider("assemblyai") === true` (grep/asserted in the test).

**LEAD verify recipe (NOT run here):** set `video_config.transcriptionProvider="assemblyai"` + a real `transcriptionApiKey` in `norishp2` admin → Settings → Video Processing; import a short YouTube clip (safest smoke; TikTok/IG may hit bot-walls needing cookies) → confirm the recipe extracts with a transcription.
</verification>

## Related

- `.planning/REQUIREMENTS.md` — VIDEO-01..04, SETUP-05
- `.planning/ROADMAP.md` — Phase 5: AssemblyAI transcription (plans 04-01 provider+enum, 04-02 config/verify)
- `/opt/norish/camofox-patch/apply-patch.mjs` — the proven boot-patch flow (READ-ONLY reference)
