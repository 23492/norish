// SPIKE — Phase 27 (COOK-01). Full end-to-end pipeline harness.
// -----------------------------------------------------------------------------
// Given a recipe URL it runs the WHOLE norish import chain:
//   1. SCRAPE   — Camoufox REST (norish's real client) with plain-fetch fallback.
//   2. SANITIZE — the same `extractSanitizedBody` shape the model actually sees.
//   3. PROMPT   — the base recipe-extraction prompt + the NEW step↔ingredient
//                 linkage fragment (this phase's contribution).
//   4. EXTRACT  — live DeepSeek (`deepseek-v4-pro`) via norish's `createDeepSeek`
//                 factory shape IF DEEPSEEK_API_KEY is set; otherwise the
//                 Claude-generated stand-in for the same content (clearly labelled).
//   5. SERIALIZE + VERIFY — structuredToCooklang → parse the `.cook` back with the
//                 real WASM parser → assert every step's inline per-step amounts.
//   6. PRINT    — the final `.cook` recipe + a per-step amounts report.
//
// Usage:
//   npm run e2e                         # both default targets, stand-in extraction
//   npm run e2e -- <url>                # one URL (stand-in only if it's a known target)
//   DEEPSEEK_API_KEY=sk-... npm run e2e # THE real end-to-end (live DeepSeek)

import { scrape, extractSanitizedBody } from "./scrape.js";
import { buildCooklangExtractionPrompt } from "./build-prompt.js";
import { hasDeepSeekKey, runDeepSeekExtraction, DEEPSEEK_MODEL } from "./deepseek.js";
import { evaluate, type Expectation } from "./evaluate.js";
import { e2eTargets, type E2ETarget } from "./e2e-targets.js";
import type { CooklangExtraction } from "./schema.js";

const argUrl = process.argv.slice(2).find((a) => a.startsWith("http"));
const live = hasDeepSeekKey();

function targetsToRun(): E2ETarget[] {
  if (!argUrl) return e2eTargets;
  const known = e2eTargets.find((t) => t.url === argUrl);
  if (known) return [known];
  // Unknown URL: only usable with a live key (no stand-in exists for it).
  return [{ url: argUrl, language: "en", standin: null as any, expectation: { inlineAmounts: [] } }];
}

async function runOne(t: E2ETarget): Promise<boolean> {
  console.log(`\n${"═".repeat(78)}\nTARGET: ${t.url}\n${"═".repeat(78)}`);

  // 1 + 2: scrape + sanitize
  const scraped = await scrape(t.url);
  const content = extractSanitizedBody(scraped.html);
  console.log(
    `[1] scrape: via=${scraped.via}  camofoxReachable=${scraped.camofoxReachable}  (${scraped.camofoxNote})`
  );
  console.log(`[2] sanitize: ${content.length} chars of clean text`);

  // 3: prompt
  const prompt = buildCooklangExtractionPrompt(content, { url: t.url, targetLanguage: t.language });
  console.log(`[3] prompt built: ${prompt.length} chars (base + linkage fragment)`);

  // 4: extract (live DeepSeek OR Claude stand-in)
  let extraction: CooklangExtraction;
  let extractionSource: string;
  if (live) {
    console.log(`[4] extract: LIVE DeepSeek (${DEEPSEEK_MODEL})…`);
    const res = await runDeepSeekExtraction(prompt);
    extraction = res.extraction;
    extractionSource = `LIVE deepseek-v4-pro (tokens=${res.usage.totalTokens})`;
  } else {
    if (!t.standin) {
      console.log(
        `[4] extract: SKIPPED — no DEEPSEEK_API_KEY and no stand-in for this URL. ` +
          `Provide a key to extract it live.`
      );
      return false;
    }
    extraction = t.standin;
    extractionSource = "STUB: Claude-generated stand-in (no DEEPSEEK_API_KEY set)";
  }
  console.log(`    source: ${extractionSource}`);

  // 5: serialize + verify (real serializer, real WASM parser)
  const expectation: Expectation = t.expectation;
  const result = evaluate(extraction, expectation, "metric");
  console.log(`[5] serialize + reparse + verify:`);
  for (const c of result.checks) {
    console.log(`      ${c.passed ? "PASS" : "FAIL"}  ${c.text}`);
    if (!c.passed) console.log(`            ↳ ${c.evidence}`);
  }
  console.log(
    `      confidence gate: ${result.confidence}` +
      (result.confidenceReasons.length ? ` — ${result.confidenceReasons.join("; ")}` : "")
  );

  // 6: print the .cook + per-step amounts report
  console.log(`\n[6] FINAL .cook recipe (system=metric):\n${"-".repeat(78)}`);
  console.log(result.cook.replace(/\n/g, "\n"));
  console.log("-".repeat(78));
  console.log(`Per-step ingredient amounts (round-tripped through the WASM parser):`);
  result.parsed.steps.forEach((step, i) => {
    if (!step.ingredients.length && !step.timers.length) return;
    const ings = step.ingredients
      .map((ing) => `${ing.name}=${ing.amount ?? "—"}${ing.unit ? " " + ing.unit : ""}`)
      .join(", ");
    const timers = step.timers.map((tm) => `~${tm.amount ?? "?"} ${tm.unit ?? ""}`).join(", ");
    const sec = step.sectionName ? `[${step.sectionName}] ` : "";
    console.log(`   step ${i}: ${sec}${ings}${timers ? "  timers: " + timers : ""}`);
  });

  return result.passed === result.total;
}

async function main() {
  console.log(`\n### Phase 27 COOK-01 — full pipeline E2E harness ###`);
  console.log(
    live
      ? `MODE: LIVE (DEEPSEEK_API_KEY present) — real end-to-end extraction.`
      : `MODE: STUB extraction (no DEEPSEEK_API_KEY) — scrape + serialize + verify are REAL, only the DeepSeek call is replaced by a Claude stand-in.`
  );

  let allOk = true;
  for (const t of targetsToRun()) {
    try {
      const ok = await runOne(t);
      allOk = allOk && ok;
    } catch (err) {
      allOk = false;
      console.error(`\nTARGET FAILED: ${t.url}\n`, err);
    }
  }

  console.log(`\n### Done. ${allOk ? "All targets verified." : "Some targets had failures (see above)."} ###\n`);
  process.exit(allOk ? 0 : 1);
}

main();
