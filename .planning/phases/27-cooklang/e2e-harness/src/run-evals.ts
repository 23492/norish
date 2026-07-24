// SPIKE — Phase 27 (COOK-01). Eval suite runner.
// -----------------------------------------------------------------------------
// Runs every fixture through the assertion engine and prints a per-scenario +
// aggregate pass report, plus the D-7 confidence classification.
//
//   npm run evals            -> grade the Claude-generated STAND-IN extractions
//   npm run evals -- --live  -> re-extract each fixture's `content` with real
//                               DeepSeek (needs DEEPSEEK_API_KEY) and grade THAT
//
// The stand-in path is fully real: real serializer, real WASM parser, real zod.
// Only the extraction itself is stubbed until the key exists.

import { fixtures } from "./fixtures.js";
import { evaluate } from "./evaluate.js";
import { buildCooklangExtractionPrompt } from "./build-prompt.js";
import { hasDeepSeekKey, runDeepSeekExtraction } from "./deepseek.js";
import type { CooklangExtraction } from "./schema.js";

const live = process.argv.includes("--live");
const system = "metric" as const;

async function main() {
  if (live && !hasDeepSeekKey()) {
    console.error(
      "\n[--live] requested but no usable DEEPSEEK_API_KEY in env. Aborting.\n" +
        "Set a real key (>=16 chars) and re-run: DEEPSEEK_API_KEY=sk-... npm run evals -- --live\n"
    );
    process.exit(2);
  }

  const mode = live ? "LIVE DeepSeek (deepseek-v4-pro)" : "Claude-generated STAND-IN";
  console.log(`\n=== Phase 27 COOK-01 extraction eval suite ===`);
  console.log(`Extraction source: ${mode}`);
  console.log(`System under test: ${system}`);
  console.log(`Fixtures: ${fixtures.length}\n`);

  let totalChecks = 0;
  let passedChecks = 0;
  let fixturesFullyPassed = 0;
  const rows: string[] = [];
  const fragile: string[] = [];

  for (const fx of fixtures) {
    let extraction: CooklangExtraction = fx.standin;
    let note = "";

    if (live) {
      const prompt = buildCooklangExtractionPrompt(fx.content, {
        targetLanguage: fx.language,
      });
      try {
        const res = await runDeepSeekExtraction(prompt);
        extraction = res.extraction;
        note = ` (deepseek tokens=${res.usage.totalTokens})`;
      } catch (err) {
        console.log(`  ${fx.id}: DeepSeek call FAILED: ${String(err).slice(0, 160)}`);
        rows.push(`${pad(fx.id, 20)} ERROR`);
        continue;
      }
    }

    const result = evaluate(extraction, fx.expectation, system);
    totalChecks += result.total;
    passedChecks += result.passed;
    const allPass = result.passed === result.total;
    if (allPass) fixturesFullyPassed += 1;

    const confMatch = result.confidence === fx.expectedConfidence;

    console.log(`── ${fx.name} [${fx.id}] (${fx.language})${note}`);
    console.log(`   failure modes: ${fx.failureModes.join("; ")}`);
    for (const c of result.checks) {
      console.log(`   ${c.passed ? "PASS" : "FAIL"}  ${c.text}`);
      if (!c.passed) console.log(`         ↳ ${c.evidence}`);
    }
    console.log(
      `   confidence: ${result.confidence} (expected ${fx.expectedConfidence}) ${confMatch ? "OK" : "MISMATCH"}` +
        (result.confidenceReasons.length ? ` — ${result.confidenceReasons.join("; ")}` : "")
    );
    console.log("");

    rows.push(
      `${pad(fx.id, 20)} ${result.passed}/${result.total} checks  conf=${result.confidence}${
        confMatch ? "" : "(!)"
      }  ${allPass ? "PASS" : "FAIL"}`
    );
    if (!allPass) fragile.push(fx.id);
  }

  console.log(`=== Summary ===`);
  for (const r of rows) console.log(`  ${r}`);
  console.log("");
  console.log(
    `Fixtures fully passing: ${fixturesFullyPassed}/${fixtures.length}` +
      `   Checks passing: ${passedChecks}/${totalChecks} (${((100 * passedChecks) / totalChecks).toFixed(1)}%)`
  );
  if (fragile.length) console.log(`Fragile fixtures: ${fragile.join(", ")}`);
  console.log("");

  process.exit(passedChecks === totalChecks ? 0 : 1);
}

function pad(s: string, n: number): string {
  return s.length >= n ? s : s + " ".repeat(n - s.length);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
