import { generateText, Output } from "ai";

import type { ExtractedRecipe } from "@norish/api/ai/features/recipe-extraction/normalizer";
import type { AIResult } from "@norish/shared-server/ai/types/result";
import {
  buildCookFromExtraction,
  getExtractionLogContext,
  normalizeExtractionOutput,
  validateExtractionOutput,
} from "@norish/api/ai/features/recipe-extraction/normalizer";
import { buildVideoExtractionPrompt } from "@norish/api/ai/prompts/builder";
import { recipeExtractionSchema } from "@norish/api/ai/schemas/recipe.schema";
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
import { videoLogger } from "@norish/shared-server/logger";
import { downloadImage } from "@norish/shared-server/media/storage";

import type { VideoMetadata } from "./types";

/**
 * Extract recipe from video transcript using AI.
 *
 * @param transcript - The video transcript text.
 * @param metadata - Video metadata (title, description, duration, etc.).
 * @param url - Source URL of the video.
 * @param allergies - Optional list of allergens to detect.
 * @returns AIResult with extracted recipe or error.
 */
export async function extractRecipeFromVideo(
  transcript: string,
  metadata: VideoMetadata,
  recipeId: string,
  url: string,
  allergies?: string[]
): Promise<AIResult<ExtractedRecipe>> {
  // Guard: AI must be enabled
  const aiEnabled = await isAIEnabled();

  if (!aiEnabled) {
    videoLogger.info("AI features are disabled, skipping video extraction");

    return aiError("AI features are disabled", "AI_DISABLED");
  }

  videoLogger.info({ url, title: metadata.title }, "Starting AI video recipe extraction");

  try {
    const { model, providerName } = await getModels();
    const settings = await getGenerationSettings();

    // Prefer the video's own audio language; fall back to the configured
    // default locale so the extracted recipe stays in the source language.
    const targetLanguage = metadata.language || (await getDefaultLocale());

    // Build prompt using shared builder
    const prompt = await buildVideoExtractionPrompt(transcript, {
      url,
      title: metadata.title,
      description: metadata.description,
      duration: metadata.duration,
      uploader: metadata.uploader,
      allergies,
      targetLanguage,
    });

    videoLogger.debug(
      {
        url,
        promptLength: prompt.length,
        transcriptLength: transcript.length,
        provider: providerName,
      },
      "Sending video transcript to AI"
    );

    const result = await generateText({
      model,
      output: Output.object({ schema: recipeExtractionSchema }),
      prompt,
      system:
        "You extract recipe data from video transcripts as JSON-LD with both metric and US measurements. Return valid JSON only.",
      ...settings,
    });

    const jsonLd = result.output;

    videoLogger.debug(jsonLd, "Response");

    // Validate extraction output
    const validation = validateExtractionOutput(jsonLd);

    if (!validation.valid) {
      videoLogger.error({ url, ...validation.details }, validation.error);

      return aiError(validation.error!, "VALIDATION_ERROR");
    }

    videoLogger.debug(
      { url, ...getExtractionLogContext(jsonLd!, null) },
      "AI video response received"
    );

    // Download thumbnail as recipe image if available
    let thumbnailPath: string | undefined;

    if (metadata.thumbnail) {
      try {
        thumbnailPath = await downloadImage(metadata.thumbnail, recipeId);
      } catch (_error) {
        // Continue without image rather than failing
        videoLogger.debug({ url }, "Failed to download video thumbnail");
      }
    }

    // Normalize using shared normalizer
    const normalized = await normalizeExtractionOutput(jsonLd!, {
      url,
      image: thumbnailPath,
      recipeId,
    });

    if (!normalized) {
      videoLogger.error({ url }, "Failed to normalize recipe from JSON-LD");

      return aiError("Failed to normalize recipe data", "VALIDATION_ERROR");
    }

    videoLogger.info(
      { url, ...getExtractionLogContext(jsonLd!, normalized) },
      "Video recipe extraction completed"
    );

    // D-27-W3-02: the `.cook` travels ALONGSIDE the DTO, never inside it.
    const cook = buildCookFromExtraction(jsonLd!, normalized, await getUnits());

    return aiSuccess({ recipe: normalized, cook }, {
      inputTokens: result.usage?.inputTokens ?? 0,
      outputTokens: result.usage?.outputTokens ?? 0,
      totalTokens: result.usage?.totalTokens ?? 0,
    });
  } catch (error) {
    const code = mapErrorToCode(error);
    const message = getErrorMessage(code, error instanceof Error ? error.message : undefined);

    videoLogger.error({ err: error, url, code }, "Failed to extract recipe from video");

    return aiError(message, code);
  }
}
