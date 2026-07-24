// SPIKE — Phase 27 (COOK-01). Vitest wrapper around the eval suite so the skill's
// tests run under `npm test` (and CI later). Each fixture becomes a test that
// asserts the Claude-generated stand-in extraction serializes to a parseable `.cook`
// with correct inline per-step amounts, and lands in the expected confidence bucket.
//
// Run: NODE_OPTIONS=--experimental-wasm-modules vitest run  (npm test wires the flag).

import { describe, expect, it } from "vitest";

import { fixtures } from "./fixtures.js";
import { e2eTargets } from "./e2e-targets.js";
import { evaluate } from "./evaluate.js";

describe("extraction eval suite (stand-in) — every failure mode round-trips", () => {
  for (const fx of fixtures) {
    describe(`${fx.name} [${fx.id}] — ${fx.failureModes.join("; ")}`, () => {
      const result = evaluate(fx.standin, fx.expectation, "metric");

      for (const check of result.checks) {
        it(check.text, () => {
          expect(check.passed, check.evidence).toBe(true);
        });
      }

      it(`confidence gate classifies as ${fx.expectedConfidence}`, () => {
        expect(result.confidence, result.confidenceReasons.join("; ")).toBe(fx.expectedConfidence);
      });
    });
  }
});

describe("E2E target stand-ins round-trip (real scraped recipes)", () => {
  for (const t of e2eTargets) {
    describe(t.url, () => {
      const result = evaluate(t.standin, t.expectation, "metric");
      for (const check of result.checks) {
        it(check.text, () => {
          expect(check.passed, check.evidence).toBe(true);
        });
      }
    });
  }
});
