import type {
  CookPayload,
  ExtractedRecipe,
} from "@norish/api/ai/features/recipe-extraction/normalizer";
import type { AIErrorCode } from "@norish/shared-server/ai/types/result";
import type { SiteAuthTokenDecryptedDto } from "@norish/shared/contracts/dto/site-auth-tokens";
import { extractRecipeWithAI } from "@norish/api/ai/recipe-parser";
import { isVideoUrl } from "@norish/api/helpers";
import { fetchViaPlaywright } from "@norish/api/parser/fetch";
import { extractRecipeNodesFromJsonLd } from "@norish/api/parser/jsonld";
import { tryLegacyStructuredRecipeParsing } from "@norish/api/parser/legacy";
import { adaptRecipeScrapersResponse } from "@norish/api/parser/python/adapter";
import { callRecipeScrapersParser } from "@norish/api/parser/python/client";
import { SERVER_CONFIG } from "@norish/config/env-config-server";
import {
  getContentIndicators,
  isAIEnabled,
  isVideoParsingEnabled,
  shouldAlwaysUseAI,
} from "@norish/shared-server/config/server-config-loader";
import { parserLogger as log } from "@norish/shared-server/logger";
import { FullRecipeInsertDTO } from "@norish/shared/contracts/dto/recipe";
import { hasRecipeName } from "@norish/shared/lib/helpers";

const parserEnvConfig = SERVER_CONFIG as typeof SERVER_CONFIG & {
  LEGACY_RECIPE_PARSER_ROLLBACK: boolean;
};

export interface ParseRecipeResult {
  recipe: FullRecipeInsertDTO;
  /** Whether AI was used for extraction (affects auto-tagging) */
  usedAI: boolean;
  /**
   * The server-authored `.cook`, when the extraction earned one (D-27-W3-02).
   *
   * `null` for every non-AI branch: JSON-LD, the python scraper, the legacy
   * parser and structured paste all give a flat step list with NO linkage, and the
   * only way to invent linkage from those is the heuristic name-matcher that D-6 /
   * D-7 ban from every runtime path (D-27-W3-08). Those recipes would be W5
   * backfill territory — but W5 is not started and pauses for explicit sign-off,
   * so today they simply stay on the legacy render path with `cook_source` NULL.
   * One code path, one shape, no special case.
   */
  cook: CookPayload | null;
}

interface StructuredParserFailure {
  code: string;
  message: string;
}

interface StructuredParseOutcome {
  recipe: FullRecipeInsertDTO | null;
  failure: StructuredParserFailure | null;
}

const NON_RECIPE_FAILURE_CODES = new Set(["NoSchemaFoundInWildMode", "RecipeSchemaNotFound"]);

function getStructuredFailureMessage(code: string): string {
  if (NON_RECIPE_FAILURE_CODES.has(code)) {
    return "Page does not appear to contain a recipe.";
  }

  return `Python parser failed: ${code}`;
}

/**
 * The AI error codes that get a retry (D-27.1-01 sub-causes 2 and 3,
 * D-27.1-06). Each of these is a TRANSIENT condition — a different attempt
 * has a real chance of a different outcome:
 *
 * - `PROVIDER_ERROR`, `EMPTY_RESPONSE`, `UNKNOWN` — the provider returned
 *   nothing usable, which is exactly the reasoning-token-exhaustion failure
 *   mode this plan exists to rescue (D-27.1-01 sub-cause 2).
 * - `TIMEOUT`, `NETWORK_ERROR`, `RATE_LIMIT` — infrastructure hiccups,
 *   unrelated to the input.
 * - `VALIDATION_ERROR` — after Task 1's relaxation, this fires only for
 *   genuinely unusable output (no name, or zero metric ingredients/steps);
 *   the observed live failures were a truncated/empty generation classified
 *   through this same code, so it belongs in the retryable set.
 *
 * Deliberately EXCLUDED, because retrying them burns tokens and latency on a
 * GUARANTEED second failure — nothing about a second attempt changes a
 * deterministic outcome:
 * - `AI_DISABLED` — a config state, not a transient condition.
 * - `AUTH_ERROR` — a bad/missing API key fails identically every time.
 * - `INVALID_INPUT` — a caller-side defect (e.g. no images provided) that a
 *   retry cannot fix.
 */
export const RETRYABLE_AI_EXTRACTION_CODES = new Set<AIErrorCode>([
  "PROVIDER_ERROR",
  "EMPTY_RESPONSE",
  "TIMEOUT",
  "NETWORK_ERROR",
  "RATE_LIMIT",
  "VALIDATION_ERROR",
  "UNKNOWN",
]);

// D-27.1-06: the retry's raised output-token headroom, expressed as three
// separately-named constants so the product intent (the target) and the
// provider-cap clamp are legible on their own, and a future provider swap
// cannot silently inherit a DeepSeek-specific number.
//
// `AI_RETRY_OUTPUT_TOKEN_TARGET` is an EXPLICIT PRODUCT DECISION by Kiran
// (2026-07-28): token cost is NOT a constraint here. It supersedes the
// 32 000 this plan originally carried. Evidence it answers: DeepSeek spent
// 470 reasoning tokens on a mere 104-token prompt (D-27.1-01); a dual-system
// recipe extraction emits several thousand output tokens on top of that; and
// the live `ai_config` budget is only 10 000 — comfortably exhausted by a
// large-HTML reasoning run.
export const AI_RETRY_OUTPUT_TOKEN_TARGET = 100_000;

// `AI_PROVIDER_MAX_OUTPUT_TOKENS` is the CLAMP. It exists because a request
// whose `max_tokens` exceeds the provider's per-request maximum is REJECTED
// OUTRIGHT — which would turn the retry, the mechanism meant to RESCUE a
// failed extraction, into a guaranteed hard failure. The figure is MEASURED,
// not guessed: probed against the live key on 2026-07-28
// (`api.deepseek.com/chat/completions`):
//   - deepseek-v4-pro  at max_tokens: 100000 -> HTTP 200, finish_reason "stop"
//   - deepseek-v4-flash at max_tokens: 100000 -> HTTP 200, finish_reason "stop"
//   - deepseek-v4-pro  at max_tokens: 393216 -> HTTP 200
//   - deepseek-v4-pro  at max_tokens: 393217 -> HTTP 400,
//     {"error":{"message":"Invalid max_tokens value, the valid range of
//     max_tokens is [1, 393216]","type":"invalid_request_error"}}
// So the ceiling is 393 216. It is DEAD CODE against today's provider — the
// clamp resolves to 100 000, Kiran's figure, unclamped — and is written for
// the NEXT one: a provider swap requires RE-MEASURING this constant, never
// assuming it.
export const AI_PROVIDER_MAX_OUTPUT_TOKENS = 393_216;

export const AI_RETRY_OUTPUT_TOKEN_FLOOR = Math.min(
  AI_RETRY_OUTPUT_TOKEN_TARGET,
  AI_PROVIDER_MAX_OUTPUT_TOKENS
);

/**
 * Attempt AI extraction. If requireAI = true, throws when AI is disabled.
 *
 * Makes at most TWO attempts (D-27.1-01 sub-cause 3, D-27.1-06). The retry
 * lives HERE rather than at the `useAIOnly` throw site in `parseRecipeFromUrl`
 * because this one edit covers BOTH the `useAIOnly` branch and the
 * structured-failure AI fallback below, whereas wrapping the throw site would
 * cover only the former and would re-run the JSON-LD-input attempt as well
 * (see `extractWithAIPreference`, which already tries JSON-LD then full HTML
 * — so a single job attempt now makes at most 4 model calls, and BullMQ's
 * `attempts: 3` (`packages/queue/src/config.ts`) bounds a job at 12; the
 * accepted cost of turning a hard failure into a retryable one).
 */
async function tryExtractWithAI(
  input: string,
  recipeId: string,
  url: string,
  allergies: string[] | undefined,
  requireAI: boolean,
  originalHtml?: string
): Promise<ExtractedRecipe | null> {
  const enabled = await isAIEnabled();

  if (!enabled) {
    if (requireAI) {
      throw new Error("AI-only import requested but AI is not enabled.");
    }

    return null;
  }

  log.info({ url }, "Attempting AI extraction");
  const result = await extractRecipeWithAI(input, recipeId, url, allergies, originalHtml);

  if (result.success) return result.data;

  log.warn({ url, error: result.error, code: result.code, attempt: 1 }, "AI extraction failed");

  if (!RETRYABLE_AI_EXTRACTION_CODES.has(result.code)) return null;

  log.info(
    { url, attempt: 2, code: result.code },
    "Retrying AI extraction with raised output-token headroom"
  );

  const retryResult = await extractRecipeWithAI(input, recipeId, url, allergies, originalHtml, {
    outputTokenFloor: AI_RETRY_OUTPUT_TOKEN_FLOOR,
  });

  if (retryResult.success) return retryResult.data;

  log.warn(
    { url, error: retryResult.error, code: retryResult.code, attempt: 2 },
    "AI extraction failed"
  );

  return null;
}

/**
 * Try AI extraction with smallest/cleanest input first (JSON-LD),
 * then fall back to full HTML.
 */
async function extractWithAIPreference(
  html: string,
  recipeId: string,
  url: string,
  allergies: string[] | undefined,
  requireAI: boolean
): Promise<ExtractedRecipe | null> {
  const jsonLdNodes = extractRecipeNodesFromJsonLd(html);

  if (jsonLdNodes.length > 0) {
    log.info({ url }, "AI: using extracted JSON-LD as input (fewer tokens)");
    const jsonLdInput = JSON.stringify(jsonLdNodes, null, 2);

    const fromJsonLd = await tryExtractWithAI(
      jsonLdInput,
      recipeId,
      url,
      allergies,
      requireAI,
      html
    );

    if (fromJsonLd) return fromJsonLd;
  }

  log.info({ url }, "AI: using full HTML as input");

  return tryExtractWithAI(html, recipeId, url, allergies, requireAI, html);
}

async function tryPythonStructuredParser(
  url: string,
  html: string,
  recipeId: string
): Promise<StructuredParseOutcome> {
  try {
    const response = await callRecipeScrapersParser({ url, html });

    if (!response.ok) {
      return {
        recipe: null,
        failure: {
          code: response.error,
          message: getStructuredFailureMessage(response.error),
        },
      };
    }

    const adapted = await adaptRecipeScrapersResponse(response, recipeId, url);

    if (hasRecipeName(adapted)) {
      return { recipe: adapted, failure: null };
    }

    return {
      recipe: null,
      failure: {
        code: "InvalidRecipeData",
        message: "Python parser returned recipe data without a valid title",
      },
    };
  } catch (error: unknown) {
    log.error({ err: error, url }, "Python parser request failed");

    return {
      recipe: null,
      failure: {
        code: "ParserServiceRequestFailed",
        message: "Python parser request failed",
      },
    };
  }
}

async function tryStructuredParser(
  url: string,
  html: string,
  recipeId: string
): Promise<StructuredParseOutcome> {
  if (parserEnvConfig.LEGACY_RECIPE_PARSER_ROLLBACK) {
    const legacy = await tryLegacyStructuredRecipeParsing(url, html, recipeId);

    return legacy
      ? { recipe: legacy, failure: null }
      : {
          recipe: null,
          failure: {
            code: "LegacyParserNoRecipe",
            message: "Legacy structured parser did not return a valid recipe",
          },
        };
  }

  return tryPythonStructuredParser(url, html, recipeId);
}

/**
 * Handles video URL parsing (YouTube, Instagram, TikTok, etc.).
 * Returns ParseRecipeResult if URL is a video, null if not a video URL.
 * Throws if video parsing is disabled or processing fails.
 */
async function tryHandleVideoUrl(
  url: string,
  recipeId: string,
  allergies?: string[],
  tokens?: SiteAuthTokenDecryptedDto[]
): Promise<ParseRecipeResult | null> {
  if (!isVideoUrl(url)) return null;

  if (!(await isVideoParsingEnabled())) {
    throw new Error("Video recipe parsing is not enabled.");
  }

  try {
    const { processVideoRecipe } = await import("@norish/api/video/processor");
    const extracted = await processVideoRecipe(url, recipeId, allergies, tokens);

    return { recipe: extracted.recipe, usedAI: true, cook: extracted.cook };
  } catch (error: unknown) {
    log.error({ err: error }, "Video processing failed");
    throw error;
  }
}

export async function parseRecipeFromUrl(
  url: string,
  recipeId: string,
  allergies?: string[],
  forceAI?: boolean,
  tokens?: SiteAuthTokenDecryptedDto[]
): Promise<ParseRecipeResult> {
  const videoResult = await tryHandleVideoUrl(url, recipeId, allergies, tokens);

  if (videoResult) return videoResult;

  const html = await fetchViaPlaywright(url, tokens);

  if (!html) throw new Error("Cannot fetch recipe page.");

  const useAIOnly = Boolean(forceAI || (await shouldAlwaysUseAI()));

  if (useAIOnly) {
    const extracted = await extractWithAIPreference(html, recipeId, url, allergies, true);

    if (!extracted) throw new Error("AI extraction failed");

    return { recipe: extracted.recipe, usedAI: true, cook: extracted.cook };
  }

  const structured = await tryStructuredParser(url, html, recipeId);

  // D-27-W3-08: the structured paths produce NO linkage, so no `.cook`.
  if (structured.recipe) return { recipe: structured.recipe, usedAI: false, cook: null };

  const aiEnabled = await isAIEnabled();

  if (aiEnabled && (await isPageLikelyRecipe(html))) {
    log.info(
      {
        url,
        failureCode: structured.failure?.code,
        legacyRollback: parserEnvConfig.LEGACY_RECIPE_PARSER_ROLLBACK,
      },
      "Structured parsing failed, attempting AI fallback"
    );

    const extracted = await extractWithAIPreference(html, recipeId, url, allergies, false);

    if (extracted) return { recipe: extracted.recipe, usedAI: true, cook: extracted.cook };
  }

  if (structured.failure) {
    log.error({ url, failureCode: structured.failure.code }, "Structured parsing failed");
    throw new Error(structured.failure.message);
  }

  log.error({ url }, "All extraction methods failed");
  throw new Error("Cannot parse recipe.");
}

export async function isPageLikelyRecipe(html: string): Promise<boolean> {
  const lowered = html.toLowerCase();
  const indicators = await getContentIndicators();

  const hasSchema = indicators.schemaIndicators.some((i) => lowered.includes(i.toLowerCase()));
  const contentHits = indicators.contentIndicators.filter((i) =>
    lowered.includes(i.toLowerCase())
  ).length;

  return hasSchema || contentHits >= 2;
}
