import type { AIResult } from "@norish/shared-server/ai/types/result";
import type { CookPayload } from "@norish/shared-server/cooklang/build-payload";
import type { RecipeCategory, Slot } from "@norish/shared/contracts";
import type { FullRecipeInsertDTO } from "@norish/shared/contracts/dto/recipe";
import type { SiteAuthTokenDecryptedDto } from "@norish/shared/contracts/dto/site-auth-tokens";

import type { ImageImportFile } from "./contracts/job-types";

/**
 * The extraction channel's payload, mirrored structurally from
 * `@norish/api`'s `ExtractedRecipe` (D-27-W3-02).
 *
 * Mirrored rather than imported: `@norish/queue` must not depend on
 * `@norish/api` (the dependency runs the other way, and the handlers are
 * registered at runtime through `registerQueueApiHandlers`). `CookPayload` comes
 * from `@norish/shared-server`, which both packages already depend on, so the
 * two shapes cannot silently drift — the registration in
 * `packages/api/src/startup/register-queue-api-handlers.ts` is checked against
 * this interface.
 */
export interface QueueExtractedRecipe {
  recipe: FullRecipeInsertDTO;
  cook: CookPayload | null;
}

export interface QueueParseRecipeResult {
  recipe: FullRecipeInsertDTO;
  usedAI: boolean;
  /** The server-authored `.cook`, when the extraction earned one. */
  cook: CookPayload | null;
}

export interface QueueNutritionEstimate {
  calories: number;
  fat: number;
  carbs: number;
  protein: number;
}

export interface QueueRecipeSummary {
  title: string;
  description: string | null;
  ingredients: string[];
}

export interface QueueSyncResult {
  uid: string;
  isNew: boolean;
}

export interface QueueMediaCleanupResult {
  deleted: number;
  errors: number;
}

export interface QueueApiHandlers {
  extractRecipeNodesFromJsonValue(input: unknown): Record<string, unknown>[];
  normalizeRecipeFromJson(json: unknown, recipeId: string): Promise<FullRecipeInsertDTO | null>;
  parseCategories(recipeCategory: unknown): RecipeCategory[];
  parseTags(keywords: unknown): { name: string }[];
  extractRecipeWithAI(
    html: string,
    recipeId: string,
    url?: string,
    allergies?: string[],
    originalHtml?: string
  ): Promise<AIResult<QueueExtractedRecipe>>;
  parseRecipeFromUrl(
    url: string,
    recipeId: string,
    allergies?: string[],
    forceAI?: boolean,
    tokens?: SiteAuthTokenDecryptedDto[]
  ): Promise<QueueParseRecipeResult>;
  extractRecipeFromImages(
    recipeId: string,
    files: ImageImportFile[],
    allergies?: string[]
  ): Promise<AIResult<QueueExtractedRecipe>>;
  estimateNutritionFromIngredients(
    recipeName: string,
    servings: number,
    ingredients: Array<{
      ingredientName: string;
      amount: number | null;
      unit: string | null;
    }>
  ): Promise<AIResult<QueueNutritionEstimate>>;
  generateTagsForRecipe(recipe: QueueRecipeSummary): Promise<AIResult<string[]>>;
  categorizeRecipe(recipe: QueueRecipeSummary): Promise<AIResult<RecipeCategory[]>>;
  detectAllergiesInRecipe(
    recipe: QueueRecipeSummary,
    allergiesToDetect: string[]
  ): Promise<AIResult<string[]>>;
  syncPlannedItem(
    userId: string,
    itemId: string,
    eventTitle: string,
    date: string,
    slot: Slot,
    recipeId?: string
  ): Promise<QueueSyncResult>;
  deletePlannedItem(userId: string, itemId: string): Promise<void>;
  truncateErrorMessage(error: string): string;
  cleanupOrphanedImages(): Promise<QueueMediaCleanupResult>;
  cleanupOrphanedAvatars(): Promise<QueueMediaCleanupResult>;
  cleanupOrphanedStepImages(): Promise<QueueMediaCleanupResult>;
  cleanupOldTempFiles(maxAgeMs?: number): Promise<void>;
}

const globalForQueueApiHandlers = globalThis as typeof globalThis & {
  __norishQueueApiHandlers__?: Partial<QueueApiHandlers>;
};

function getRegisteredHandlers(): Partial<QueueApiHandlers> {
  if (!globalForQueueApiHandlers.__norishQueueApiHandlers__) {
    globalForQueueApiHandlers.__norishQueueApiHandlers__ = {};
  }

  return globalForQueueApiHandlers.__norishQueueApiHandlers__;
}

export function registerQueueApiHandlers(handlers: Partial<QueueApiHandlers>): void {
  globalForQueueApiHandlers.__norishQueueApiHandlers__ = {
    ...getRegisteredHandlers(),
    ...handlers,
  };
}

export function requireQueueApiHandler<K extends keyof QueueApiHandlers>(
  name: K
): QueueApiHandlers[K] {
  const handler = getRegisteredHandlers()[name];

  if (!handler) {
    throw new Error(`Queue API handler not registered: ${String(name)}`);
  }

  return handler as QueueApiHandlers[K];
}

export function resetQueueApiHandlersForTests(): void {
  globalForQueueApiHandlers.__norishQueueApiHandlers__ = {};
}
