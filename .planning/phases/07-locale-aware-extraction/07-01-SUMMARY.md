---
phase: 07-locale-aware-extraction
plan: 07-01
subsystem: api
status: code-complete
requirements: [LOCALE-01]
commits: [6f0bd61d, bbb63ac9, f38bc50d, f0f121c5]
---

# Phase 07 Plan 07-01 SUMMARY: Locale-aware recipe extraction

## Outcome: CODE-COMPLETE (human-verify pending with the lead)

AI recipe-extraction now preserves the source content's language instead of defaulting to English. Verified statically; end-to-end re-import owned by the lead.

## Root cause

The structured recipe-extraction prompt is built from `loadPrompt("recipe-extraction")` (template `packages/shared-server/src/ai/prompts/recipe-extraction.txt`, byte-identical twin in `packages/api/...`). That template is written **entirely in English and carries NO language directive**. The three builders in `packages/api/src/ai/prompts/builder.ts` (HTML `buildRecipeExtractionPrompt`, image `buildImageExtractionPrompt`, video `buildVideoExtractionPrompt`) and the per-call `system` strings in the call sites are all English, and none threaded any locale/source-language signal. With an all-English instruction surface and no "match the source language" rule, Gemini (gemini-2.5-flash) generated/normalized every free-text field (`description`, `recipeIngredient`, `recipeInstructions`, `notes`, `keywords`) in English; only `name` survived in Dutch because it is extracted near-verbatim from the captions. The bug's path: `youtube.ts` (captions+description first) -> `extractRecipeFromVideo` (`video/normalizer.ts`) -> `buildVideoExtractionPrompt` -> `generateText({ output: Output.object({ schema }) })`.

## The fix (4 commits on feat/phase-2-multi-household)

- **bbb63ac9** — NEW fragment `packages/api/src/ai/prompts/fragments/language.ts`:
  - `buildLanguageInstruction(targetLanguage?)` appends a `LANGUAGE:` block: produce name/description/notes/ingredients/steps/keywords in the SAME language as the source content, do NOT translate, name the resolved target language explicitly when known, and KEEP the `categories` enum in English (Breakfast/Lunch/Dinner/Snack) so the normalizer's English category matcher keeps working.
  - `localeToLanguageName(code?)` maps a locale code / BCP-47 tag -> human name via `LOCALE_CATALOG` (`@norish/i18n/locales`), base-subtag fallback, pass-through for unknown/already-named input, `undefined` for empty.
  - Added `targetLanguage?: string` to `RecipeExtractionPromptOptions` (inherited by the video/image option types) and appended the fragment in all three builders; `buildImageExtractionPrompt` gained an optional 2nd arg. Re-exported from the fragments + prompts barrels.
  - **Deliberately did NOT edit `recipe-extraction.txt`**: at runtime `loadPrompt` reads from `getPrompts()` (DB/config, seeded from the .txt), so editing the seed would NOT fix an already-seeded deployment (the verify stack). Threading the directive through the BUILDER guarantees it applies on every extraction regardless of config state — robust AND minimal.

- **f38bc50d** — threaded a real locale signal at the three call sites:
  - `video/normalizer.ts`: `targetLanguage = metadata.language || (await getDefaultLocale())` — prefers the video's own audio language (`VideoMetadata.language`, BCP-47), falls back to the configured default locale.
  - `recipe-parser.ts` (HTML) + `image-recipe-parser.ts` (images): `targetLanguage = await getDefaultLocale()` (no per-source signal there).
  - `getDefaultLocale()` is exported from `@norish/config/server-config-loader` and returns the deployment default (here `nl`, env-default `en`).

- **f0f121c5** — pure unit tests in `packages/api/__tests__/ai/prompts/builder.test.ts` (no mocks/network): the directive text + categories-English exception + explicit-language line + locale-code->name + base-subtag + undefined fallback. builder.test.ts 17 -> 25 tests.

- **6f0bd61d** — the PLAN.

## Locale signal: REAL, not just "match the source"

Threaded a real signal: the video's `metadata.language` (true source-audio language) with the configured default locale (`nl`) as fallback for video, and the default locale for HTML/image. The "match the source content's language" clause remains as the ultimate guard for mixed-language sources. So a Dutch YouTube short with the deployment default `nl` gets `Nederlands` named explicitly.

## Verification (static — LEAD owns docker build + Chrome e2e)

- `pnpm --filter @norish/api typecheck` (project's `tsc --noEmit --noCheck`): **EXIT 0**.
- Strict real `tsc --noEmit`: zero errors in any touched file; the only error files are `@norish/auth/src/auth.ts`, `@norish/shared-server/src/ai/utils/category-matcher.ts`, `@norish/shared-server/src/archive/parser.ts` — all PRE-EXISTING, none mine.
- `pnpm --filter @norish/api lint`: **0 errors** (1 pre-existing unrelated warning in `parser/python/adapter.ts`).
- `pnpm --filter @norish/api test`: **27 files / 342 tests passed, EXIT 0** (builder.test.ts 25/25).
- Pre-existing failures NOT in scope and NOT in @norish/api: `archive-import-overwrite` (shared-server), `updateRecipeWithRefs` normalization (db).

## Mechanics / notes

- New file `language.ts` was hardlinked into `node_modules/@norish/api/src/...` (hardlinks only mirror existing files; a brand-new source file must be linked so the injected copy resolves the import). Edits to existing files were already live via the inode-shared hardlinks.
- No env var, no new dependency, no schema/migration, no UI, no live-container/boot-patch touch, no docker:build.

## Human-verify (LEAD)

Re-import a Dutch source on the verify stack (http://192.168.2.47:3010, `norishp2`, working Gemini config) and confirm the **description, ingredients, and steps render in Dutch** (categories stay English by design). The original "Broodje Hete Kip" YouTube short id was not recoverable from the repo/logs on 110; any Dutch-captioned cooking short (or a Dutch recipe webpage) reproduces the path.
