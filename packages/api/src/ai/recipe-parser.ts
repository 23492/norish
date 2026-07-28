import { generateText, Output } from "ai";

import type { AIResult } from "@norish/shared-server/ai/types/result";
import { extractSanitizedBody } from "@norish/shared-server/ai/helpers";
import { getGenerationSettings, getModels } from "@norish/shared-server/ai/providers";
import {
  aiError,
  aiSuccess,
  getErrorMessage,
  mapErrorToCode,
} from "@norish/shared-server/ai/types/result";
import {
  getDefaultLocale,
  getUnits,
  isAIEnabled,
} from "@norish/shared-server/config/server-config-loader";
import { aiLogger } from "@norish/shared-server/logger";

import type { ExtractedRecipe } from "./features/recipe-extraction/normalizer";
import type { RecipeExtractionOutput } from "./schemas/recipe.schema";
import { extractImageCandidates } from "../parser/parsers";
import {
  buildCookFromExtraction,
  getExtractionLogContext,
  mirrorMeasurementSystems,
  normalizeExtractionOutput,
  validateExtractionOutput,
} from "./features/recipe-extraction/normalizer";
import { buildRecipeExtractionPrompt } from "./prompts/builder";
import { recipeExtractionSchema } from "./schemas/recipe.schema";

// Re-export type for consumers
export type { RecipeExtractionOutput };

/**
 * Optional per-call overrides for `extractRecipeWithAI`, used only by the
 * one-shot retry in `packages/api/src/parser/index.ts` (D-27.1-06).
 */
export interface ExtractRecipeWithAIOptions {
  /**
   * Raise the generation's `maxOutputTokens` floor for THIS call only. Never
   * lowers a configured value — see the `Math.max` below.
   */
  outputTokenFloor?: number;
}

/**
 * Extract recipe from HTML content using AI.
 *
 * @param html - The HTML content to extract recipe from.
 * @param url - Optional source URL of the recipe.
 * @param allergies - Optional list of allergens to detect.
 * @param options - Optional per-call overrides; only the retry passes one.
 * @returns AIResult with extracted recipe or error.
 */
export async function extractRecipeWithAI(
  html: string,
  recipeId: string,
  url?: string,
  allergies?: string[],
  originalHtml?: string,
  options?: ExtractRecipeWithAIOptions
): Promise<AIResult<ExtractedRecipe>> {
  // Guard: AI must be enabled
  const aiEnabled = await isAIEnabled();

  if (!aiEnabled) {
    aiLogger.info("AI features are disabled, skipping extraction");

    return aiError("AI features are disabled", "AI_DISABLED");
  }

  aiLogger.info({ url }, "Starting AI recipe extraction");

  try {
    const { model, providerName } = await getModels();
    const settings = await getGenerationSettings();

    // D-27.1-06: the DB `ai_config` row (read into `settings` above) is the
    // source of truth for `maxOutputTokens`. An unconditional floor here could
    // exceed a provider's per-request output cap, so the raised budget is only
    // ever applied when the CALLER explicitly asks for it — which happens only
    // on a retry that already followed a real failure (`parser/index.ts`).
    // `Math.max` guarantees this NEVER lowers a configured value.
    if (options?.outputTokenFloor !== undefined) {
      settings.maxOutputTokens = Math.max(settings.maxOutputTokens ?? 0, options.outputTokenFloor);
    }

    // Sanitize and truncate HTML content
    const sanitized = extractSanitizedBody(html);
    const truncated = sanitized.slice(0, 50000);

    // Keep the extracted recipe in the source language (fall back to the
    // configured default locale; the prompt also matches the source content).
    const targetLanguage = await getDefaultLocale();

    // Build prompt using shared builder
    const prompt = await buildRecipeExtractionPrompt(truncated, {
      url,
      allergies,
      strictAllergyDetection: true, // Use strict mode for HTML extraction
      targetLanguage,
    });

    aiLogger.debug(
      { url, promptLength: prompt.length, provider: providerName },
      "Sending prompt to AI provider"
    );

    const result = await generateText({
      model,
      output: Output.object({ schema: recipeExtractionSchema }),
      prompt,
      system:
        "You extract recipe data as JSON-LD with both metric and US measurements. Return valid JSON only.",
      ...settings,
    });

    // D-27.1-03: mirror the absent measurement half ONCE, here, so validate,
    // normalize AND buildCookFromExtraction below all read the SAME object.
    const jsonLd = mirrorMeasurementSystems(result.output);

    // Validate extraction output
    const validation = validateExtractionOutput(jsonLd);

    if (!validation.valid) {
      aiLogger.error({ url, ...validation.details }, validation.error);

      return aiError(validation.error!, "VALIDATION_ERROR");
    }

    aiLogger.debug({ url, ...getExtractionLogContext(jsonLd!, null) }, "AI response received");

    // Extract image candidates from HTML
    const imageCandidates = extractImageCandidates(originalHtml ?? html, url);

    // Normalize using shared normalizer
    const normalized = await normalizeExtractionOutput(jsonLd!, {
      url,
      imageCandidates,
      recipeId,
    });

    if (!normalized) {
      aiLogger.error({ url }, "Failed to normalize recipe from JSON-LD");

      return aiError("Failed to normalize recipe data", "VALIDATION_ERROR");
    }

    aiLogger.info(
      { url, ...getExtractionLogContext(jsonLd!, normalized) },
      "AI recipe extraction completed"
    );

    // D-27-W3-02: the `.cook` travels ALONGSIDE the DTO, never inside it.
    const cook = await buildCookFromExtraction(jsonLd!, normalized, await getUnits());

    return aiSuccess({ recipe: normalized, cook }, {
      inputTokens: result.usage?.inputTokens ?? 0,
      outputTokens: result.usage?.outputTokens ?? 0,
      totalTokens: result.usage?.totalTokens ?? 0,
    });
  } catch (error) {
    const code = mapErrorToCode(error);
    const message = getErrorMessage(code, error instanceof Error ? error.message : undefined);

    aiLogger.error({ err: error, url, code }, "Failed to extract recipe with AI");

    return aiError(message, code);
  }
}
