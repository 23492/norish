---
phase: 20-incorporate-upstream-v0-19-0-beta
plan: "02"
subsystem: api
tags: ["merge", "upstream", "locale", "ai-parser", "camoufox", "LOCALE-01"]

requires:
  - phase: 20-incorporate-upstream-v0-19-0-beta
    plan: "01"
    provides: ["upstream-0.19.0-base", "db-schema-subsystem", "@norish/shared-server/config/server-config-loader move"]

provides:
  - "api/parser subsystem locale delta re-applied (getDefaultLocale/targetLanguage threading)"
  - "upstream @norish/shared-server/config/server-config-loader import path adopted in all three api parser files"
  - "Camoufox constraint re-verified on resolved tree"
  - "@norish/api test suite green (350/350) including AssemblyAI locale/language tests"

affects:
  - "20-03 (trpc/shared-react): may need similar server-config-loader mock path fixup in api-consuming tests"
  - "20-05 (queue/CI import fixup): any remaining @norish/config/server-config-loader mock paths in other test files"

tech-stack:
  added: []
  patterns:
    - "Locale threading pattern: getDefaultLocale() from @norish/shared-server/config/server-config-loader → targetLanguage → passed into buildRecipeExtractionPrompt/buildImageExtractionPrompt/buildVideoExtractionPrompt options"
    - "Video locale pattern: metadata.language || (await getDefaultLocale()) — prefer explicit audio language, fall back to default locale"

key-files:
  created: []
  modified:
    - packages/api/src/ai/recipe-parser.ts
    - packages/api/src/ai/image-recipe-parser.ts
    - packages/api/src/video/normalizer.ts
    - packages/api/__tests__/server/ai/transcriber-assemblyai.test.ts

key-decisions:
  - "Re-applied fork locale delta (getDefaultLocale + targetLanguage) onto upstream's committed-upstream base (Strategy B, no conflict markers) — both upstream import-path move and fork locale threading survive"
  - "Fixed transcriber-assemblyai.test.ts vi.mock path from deleted @norish/config/server-config-loader to @norish/shared-server/config/server-config-loader (in-scope per plan allowance)"
  - "Did NOT alter packages/api/src/ai/prompts/fragments/language.ts (fork-only, not in conflict, as specified)"

patterns-established:
  - "All api parser files now import getDefaultLocale from @norish/shared-server/config/server-config-loader (not the deleted @norish/config path)"
  - "Test mocks for server-config-loader must reference @norish/shared-server/config/server-config-loader"

requirements-completed: [UPSTREAM-019]

duration: ~20min
completed: 2026-06-28
---

# Phase 20 Plan 02: api/parser Locale Delta Re-application Summary

**Fork locale-aware recipe extraction (getDefaultLocale/targetLanguage threading) re-applied onto upstream 0.19.0's committed @norish/shared-server/config/server-config-loader import move in all three api parser files; @norish/api test suite 350/350 green.**

## Performance

- **Duration:** ~20 min
- **Started:** 2026-06-28T10:44:00Z
- **Completed:** 2026-06-28T10:48:00Z
- **Tasks:** 2
- **Files modified:** 4

## Accomplishments

- Re-applied fork's Phase 7 LOCALE-01 locale delta onto the committed-upstream base in `packages/api/src/ai/recipe-parser.ts`, `packages/api/src/ai/image-recipe-parser.ts`, and `packages/api/src/video/normalizer.ts`
- Adopted upstream's moved import path `@norish/shared-server/config/server-config-loader` (old `@norish/config/server-config-loader` is gone); all three files now correctly import `getDefaultLocale` and `isAIEnabled` from the new path
- Fixed fork-only test mock path in `transcriber-assemblyai.test.ts` (in-scope per plan allowance): `vi.mock("@norish/config/server-config-loader")` → `vi.mock("@norish/shared-server/config/server-config-loader")`
- Camoufox constraint re-confirmed: zero playwright/chrome-headless/CHROME_WS_ENDPOINT refs in `packages/api/src`, `playwright.ts` absent, `camofox.ts` present
- `pnpm --filter @norish/api typecheck` clean; `pnpm --filter @norish/api test` 350/350 passed (up from 346, the 4 previously-failing AssemblyAI tests now run correctly)

## Task Commits

1. **Task 1 + Task 2 (combined): re-apply locale delta + typecheck + test** — `23c826f1` (feat)

## Files Created/Modified

- `packages/api/src/ai/recipe-parser.ts` — Added `getDefaultLocale` to import, added `targetLanguage = await getDefaultLocale()` before prompt build, passed `targetLanguage` into `buildRecipeExtractionPrompt` options
- `packages/api/src/ai/image-recipe-parser.ts` — Same pattern: `getDefaultLocale` import, `targetLanguage` variable, `buildImageExtractionPrompt(allergies, targetLanguage)`
- `packages/api/src/video/normalizer.ts` — Added `getDefaultLocale` import, added `targetLanguage = metadata.language || (await getDefaultLocale())`, passed into `buildVideoExtractionPrompt` options
- `packages/api/__tests__/server/ai/transcriber-assemblyai.test.ts` — Fixed `vi.mock` path: `@norish/config/server-config-loader` → `@norish/shared-server/config/server-config-loader`

## Decisions Made

- Re-applied fork delta as minimal surgical additions onto the upstream committed base (no rewrite) — upstream's import path and refactor wins, fork's locale logic added on top
- Included `transcriber-assemblyai.test.ts` mock path fix in this plan (not deferred to 20-05) because it directly caused test suite failure and was explicitly in-scope per plan Task 2 language
- `packages/api/src/ai/prompts/fragments/language.ts` untouched (fork-only file, already present, not in conflict per plan directive)

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] transcriber-assemblyai.test.ts vi.mock path using deleted @norish/config/server-config-loader**
- **Found during:** Task 2 (test run)
- **Issue:** `vi.mock("@norish/config/server-config-loader", ...)` — this specifier was removed from `@norish/config` in upstream 0.19.0; Vitest threw `Error: Missing "./server-config-loader" specifier in "@norish/config" package` which caused the whole test file to fail (0 tests run)
- **Fix:** Changed mock path to `@norish/shared-server/config/server-config-loader` to match where `getVideoConfig`/`getAIConfig` now live
- **Files modified:** `packages/api/__tests__/server/ai/transcriber-assemblyai.test.ts`
- **Verification:** `pnpm --filter @norish/api test` 350/350 passed (AssemblyAI suite now runs 4 tests)
- **Committed in:** `23c826f1` (combined task commit)

---

**Total deviations:** 1 auto-fixed (blocking import path)
**Impact on plan:** In-scope per plan Task 2 language; no scope creep. The plan explicitly named this file as a potential fix target.

## Issues Encountered

- The `cp -a packages/api/src/. node_modules/@norish/api/src/` hardlink-sync command produces "same file" errors for files that remained hardlinked (not edited in this plan); this is expected behavior per CLAUDE.md — only the 3 edited source files broke their hardlinks and needed syncing. Not a real error.

## Verification Gates

### Task 1 — Conflict Resolution

```
git status --porcelain | grep -E "^(UU|AA|DU|UD) " | grep -E "packages/api/src/(ai|video)/" | wc -l
```
Result: **0** (no conflict markers)

```
grep -c "getDefaultLocale" packages/api/src/ai/recipe-parser.ts
```
Result: **2** (import + call site)

```
grep -c "targetLanguage" packages/api/src/video/normalizer.ts
```
Result: **2** (assignment + prompt option)

```
grep -c "@norish/config/server-config-loader" packages/api/src/ai/recipe-parser.ts packages/api/src/ai/image-recipe-parser.ts
```
Result: **0 / 0** (old path gone)

**Camoufox:**
- `grep -rE "playwright|chrome-headless|CHROME_WS_ENDPOINT" packages/api/src --include="*.ts"` → **0**
- `ls packages/api/src/camofox.ts` → **present**
- `ls packages/api/src/playwright.ts 2>/dev/null && echo FAIL || echo PASS` → **PASS**

### Task 2 — Typecheck + Test

```
pnpm --filter @norish/api typecheck
```
Result: **CLEAN** (zero errors)

```
pnpm --filter @norish/api test
```
Result: **350 passed, 28 test files, 0 failed**

```
grep -rE "playwright|chrome-headless|CHROME_WS_ENDPOINT" packages/api/src packages/api/package.json --include="*.ts" --include="*.json" | wc -l
```
Result: **0**

## Known Stubs

None — no placeholder data or TODO stubs in any file modified by this plan.

## Threat Flags

None — T-20-02-PW (playwright reintroduction) mitigated (grep proof 0); T-20-02-CFG (stale import path) mitigated (typecheck clean on moved path); T-20-02-LOC (locale dropped) mitigated (getDefaultLocale threading confirmed by grep + test suite).

## Self-Check

- [x] Commit `23c826f1` exists on `integ/upstream-0.19.0`
- [x] `grep -c "getDefaultLocale" packages/api/src/ai/recipe-parser.ts` = 2
- [x] `grep -c "targetLanguage" packages/api/src/video/normalizer.ts` = 2
- [x] `grep -c "@norish/config/server-config-loader" packages/api/src/ai/recipe-parser.ts packages/api/src/ai/image-recipe-parser.ts` = 0 / 0
- [x] Camoufox: 0 playwright refs, camofox.ts present, playwright.ts absent
- [x] `pnpm --filter @norish/api typecheck` clean
- [x] `pnpm --filter @norish/api test` 350/350 passed
- [x] `language.ts` fragment unchanged

## Self-Check: REPORTED (director will independently re-verify)

---
*Phase: 20-incorporate-upstream-v0-19-0-beta*
*Completed: 2026-06-28*
