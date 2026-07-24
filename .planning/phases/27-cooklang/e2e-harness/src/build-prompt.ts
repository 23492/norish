// SPIKE — Phase 27 (COOK-01). Assembles the extraction prompt the way norish's
// `buildRecipeExtractionPrompt` does, but with the NEW step↔ingredient linkage
// fragment appended (as 27-EXTRACTION-PROMPT.md prescribes: pushed as one more
// `parts.push(...)` alongside allergy/language fragments).
//
// It reads the REAL base prompt (`recipe-extraction.txt`) and the linkage fragment
// straight from the repo tree so this harness exercises the actual shared prompt,
// not a paraphrase.

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
// harness/src -> repo root is five levels up (.../27-cooklang/e2e-harness/src)
const REPO_ROOT = join(HERE, "..", "..", "..", "..", "..");
const PHASE_DIR = join(HERE, "..", "..");

const BASE_PROMPT_PATH = join(
  REPO_ROOT,
  "packages",
  "shared-server",
  "src",
  "ai",
  "prompts",
  "recipe-extraction.txt"
);
const LINKAGE_FRAGMENT_PATH = join(
  PHASE_DIR,
  "extraction-skill",
  "assets",
  "linkage-fragment.txt"
);

export function loadBasePrompt(): string {
  return readFileSync(BASE_PROMPT_PATH, "utf-8");
}

export function loadLinkageFragment(): string {
  return readFileSync(LINKAGE_FRAGMENT_PATH, "utf-8");
}

export interface BuildOptions {
  url?: string;
  targetLanguage?: string;
}

/**
 * Mirror of `buildRecipeExtractionPrompt` with the linkage fragment appended. The
 * schema shape (per-step recipeInstructions) is enforced by the AI-SDK
 * `Output.object({ schema })` call; this fragment supplies the linking *judgement*
 * rules and the worked example.
 */
export function buildCooklangExtractionPrompt(content: string, options: BuildOptions = {}): string {
  const base = loadBasePrompt();
  const linkage = loadLinkageFragment();

  const parts = [base, linkage];

  if (options.targetLanguage) {
    parts.push(
      `LANGUAGE: Keep all free-text fields (name, description, step text, ingredient names) in the source content's language (${options.targetLanguage}). Do not translate to English.`
    );
  }
  if (options.url) {
    parts.push(`URL: ${options.url}`);
  }
  parts.push(`WEBPAGE TEXT:\n${content}`);

  return parts.join("\n");
}
