/**
 * Language / locale prompt fragments.
 *
 * These fragments are appended to recipe extraction prompts so the AI
 * produces the recipe in the SAME language as the source content instead
 * of defaulting to English. The base extraction prompt template is written
 * in English, which (without an explicit directive) biases the model toward
 * English output for every field it generates or normalizes.
 */

import { LOCALE_CATALOG } from "@norish/i18n/locales";

/**
 * Resolve a locale/language hint to a human-readable language name.
 *
 * Accepts either:
 * - A locale code present in the bundled catalog (e.g. "nl" -> "Nederlands",
 *   "de-formal" -> "Deutsch (Sie)").
 * - A BCP-47 code whose base subtag is in the catalog (e.g. "nl-NL" -> "Nederlands").
 * - An already human-readable name, which is passed through unchanged.
 *
 * @param localeOrLang - A locale code, BCP-47 tag, or language name.
 * @returns The human-readable language name, or undefined when nothing was provided.
 */
export function localeToLanguageName(localeOrLang?: string): string | undefined {
  const value = localeOrLang?.trim();

  if (!value) {
    return undefined;
  }

  // Exact catalog match (covers "nl", "de-formal", etc.).
  const exact = LOCALE_CATALOG[value as keyof typeof LOCALE_CATALOG];

  if (exact) {
    return exact.name;
  }

  // Fall back to the base subtag of a BCP-47 tag (e.g. "nl-NL" -> "nl").
  const base = value.split("-")[0];

  if (base && base !== value) {
    const baseMatch = LOCALE_CATALOG[base as keyof typeof LOCALE_CATALOG];

    if (baseMatch) {
      return baseMatch.name;
    }
  }

  // Unknown code or an already human-readable name: pass through unchanged.
  return value;
}

/**
 * Build the language-preservation instruction fragment for recipe extraction.
 *
 * The directive tells the model to keep every free-text recipe field in the
 * source content's language (no translation), with the resolved target
 * language named explicitly when known. The fixed `categories` enum is
 * deliberately excepted because the normalizer matches it against the English
 * values Breakfast/Lunch/Dinner/Snack.
 *
 * @param targetLanguage - A locale code, BCP-47 tag, or language name for the
 *   source content (e.g. the configured default locale or a video's audio
 *   language). When resolvable it is named explicitly as the target language.
 * @returns A prompt fragment to append to the main extraction prompt.
 *
 * @example
 * ```ts
 * const instruction = buildLanguageInstruction("nl");
 * const fullPrompt = `${basePrompt}${instruction}`;
 * ```
 */
export function buildLanguageInstruction(targetLanguage?: string): string {
  const languageName = localeToLanguageName(targetLanguage);

  const explicitLine = languageName
    ? `\n- The source content is in ${languageName}; produce all of the above fields in ${languageName}.`
    : "";

  return `
LANGUAGE:
- Produce the name, description, notes, ingredients, cooking steps and keywords in the SAME language as the source content. Do NOT translate the recipe to English (or any other language).
- Preserve the source language exactly as written; only normalize formatting and measurements, never the language.${explicitLine}
- EXCEPTION: the "categories" values MUST stay in English (one or more of: Breakfast, Lunch, Dinner, Snack), regardless of the source language.
`;
}
