import type { ExtractedRecipe } from "@norish/api/ai/features/recipe-extraction/normalizer";
import type { SiteAuthTokenDecryptedDto } from "@norish/shared/contracts/dto/site-auth-tokens";

export interface VideoMetadata {
  title: string;
  description: string;
  duration: number; // in seconds
  thumbnail: string;
  uploader?: string;
  uploadDate?: string;
  /** BCP-47 language code of the video's original audio (e.g. "en", "es") */
  language?: string;
}

/**
 * Context passed to video processors for recipe extraction.
 */
export interface VideoProcessorContext {
  url: string;
  recipeId: string;
  allergies?: string[];
  tokens?: SiteAuthTokenDecryptedDto[];
}

/**
 * Interface for platform-specific video processors.
 * Each processor handles a specific platform's extraction strategy.
 */
export interface VideoProcessor {
  /**
   * Human-readable name of the processor for logging.
   */
  readonly name: string;

  /**
   * Process a video URL and extract recipe data.
   *
   * D-27-W3-02: returns the DTO paired with the optional server-authored `.cook`,
   * so the linkage the model produced survives all the way to the write path.
   */
  process(context: VideoProcessorContext): Promise<ExtractedRecipe>;
}

/**
 * Supported video platforms.
 */
export type VideoPlatform = "instagram" | "facebook" | "youtube" | "generic";
