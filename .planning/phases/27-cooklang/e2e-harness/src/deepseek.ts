// SPIKE — Phase 27 (COOK-01). The REAL DeepSeek extraction call, wired exactly like
// norish's `recipe-parser.ts`: `createDeepSeek({ apiKey, fetch })` (the norish
// factory shape) + `generateText({ model, output: Output.object({ schema }) })`,
// model id `deepseek-v4-pro`.
//
// The API key is read from `process.env.DEEPSEEK_API_KEY` ONLY. It is never logged,
// never written to disk, and never committed. If it is absent the caller SKIPS this
// path and uses the Claude-generated stand-in instead.

import { createDeepSeek } from "@ai-sdk/deepseek";
import { generateText, Output } from "ai";

import { cooklangExtractionSchema, type CooklangExtraction } from "./schema.js";

export const DEEPSEEK_MODEL = "deepseek-v4-pro";

export function hasDeepSeekKey(): boolean {
  const k = process.env.DEEPSEEK_API_KEY;
  // The live config placeholder is 8 chars; a real key is much longer. Treat an
  // obviously-placeholder value as "no key" so a stale placeholder can't half-run.
  return typeof k === "string" && k.trim().length >= 16;
}

export interface DeepSeekResult {
  extraction: CooklangExtraction;
  usage: { inputTokens: number; outputTokens: number; totalTokens: number };
}

/**
 * Run the live DeepSeek extraction. Throws if the key is missing so callers must
 * gate on `hasDeepSeekKey()` first.
 */
export async function runDeepSeekExtraction(prompt: string): Promise<DeepSeekResult> {
  const apiKey = process.env.DEEPSEEK_API_KEY;
  if (!apiKey) throw new Error("DEEPSEEK_API_KEY not set");

  const deepseek = createDeepSeek({ apiKey });
  const model = deepseek(DEEPSEEK_MODEL);

  const result = await generateText({
    model,
    output: Output.object({ schema: cooklangExtractionSchema }),
    prompt,
    system:
      "You extract recipe data as JSON with both metric and US measurements, and with per-step ingredient linkage. Return valid JSON only.",
    temperature: 0,
  });

  return {
    extraction: result.output as CooklangExtraction,
    usage: {
      inputTokens: result.usage?.inputTokens ?? 0,
      outputTokens: result.usage?.outputTokens ?? 0,
      totalTokens: result.usage?.totalTokens ?? 0,
    },
  };
}
