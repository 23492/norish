/**
 * Step-to-ingredient linkage fragment tests.
 *
 * Two things are proven here:
 *
 * 1. Every rule of the live-validated fragment survived the port. Each rule maps to
 *    an observed live failure mode, so each gets its own named assertion — a single
 *    `toContain("LINKING")` would pass while silently having dropped half the rules.
 * 2. D-27-W3-01: the instruction reaches the model as CODE, not as a
 *    `recipe-extraction.txt` edit. `loadPrompt` resolves through server config, so a
 *    `.txt` edit is a no-op on an existing install. The builder tests therefore mock
 *    `loadPrompt` to an UNRELATED base prompt and still require the fragment to be
 *    present, plus assert it lands before the untrusted content payload.
 *
 * @vitest-environment node
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  buildImageExtractionPrompt,
  buildRecipeExtractionPrompt,
  buildVideoExtractionPrompt,
} from "@norish/api/ai/prompts/builder";
import { buildLinkageInstruction } from "@norish/api/ai/prompts/fragments/linkage";
import { listAllTagNames } from "@norish/db/repositories/tags";
import { loadPrompt } from "@norish/shared-server/ai/prompts/loader";
import { getAutoTaggingMode } from "@norish/shared-server/config/server-config-loader";

vi.mock("@norish/shared-server/config/server-config-loader", () => ({
  getAutoTaggingMode: vi.fn(),
}));

vi.mock("@norish/db/repositories/tags", () => ({
  listAllTagNames: vi.fn(),
}));

vi.mock("@norish/shared-server/ai/prompts/loader", () => ({
  loadPrompt: vi.fn(),
  fillPrompt: vi.fn((template, _vars) => template),
}));

/**
 * A base prompt that shares NO wording with the linkage fragment and says nothing
 * about steps or ingredients. If the fragment shows up in a builder's output while
 * this is what `loadPrompt` returns, the fragment cannot have come from the template.
 */
const UNRELATED_BASE_PROMPT = "Zqx base template placeholder. Return a JSON object.";

/** A marker unique to the fragment's heading. */
const FRAGMENT_MARKER = "STEP↔INGREDIENT LINKING";

describe("buildLinkageInstruction", () => {
  const instruction = buildLinkageInstruction();

  it("is a leading-newline-delimited block, like the other fragments", () => {
    expect(instruction.startsWith("\n")).toBe(true);
    expect(instruction.endsWith("\n")).toBe(true);
    expect(instruction).toContain(FRAGMENT_MARKER);
  });

  it("takes no options and is stable across calls", () => {
    expect(buildLinkageInstruction()).toBe(instruction);
  });

  describe("rules ported from the live-validated fragment", () => {
    it("states the ANCHOR rule: the name must be a word in the step's own text", () => {
      expect(instruction).toContain(
        'an ingredient\'s "name" must be a word that actually appears in'
      );
      expect(instruction).toContain("Use the word from the SENTENCE");
      expect(instruction).toContain("A name with a\n   digit in it is always wrong.");
    });

    it("states the NO-CARRY-FORWARD rule", () => {
      expect(instruction).toContain("A step lists ONLY the ingredients its OWN text mentions");
      expect(instruction).toContain("Do NOT carry ingredients\n   forward");
      expect(instruction).toContain("leave it out of this step");
    });

    it("states AMOUNT-ON-FIRST-ADD, with null on later mentions", () => {
      expect(instruction).toContain("AMOUNT goes on the step where the ingredient is FIRST added");
      expect(instruction).toContain("the\n   amount belongs to the first add only");
      expect(instruction).toContain("Never repeat an ingredient's amount in two steps");
    });

    it("states UNITS AS WRITTEN, no conversion", () => {
      expect(instruction).toContain("UNITS AS WRITTEN");
      expect(instruction).toContain("do NOT convert");
      expect(instruction).toContain("norish does any\n   conversion later, deterministically");
    });

    it("states NULL for to-taste / garnish / unmeasured amounts", () => {
      expect(instruction).toContain("NO AMOUNT");
      expect(instruction).toContain('"salt to taste"');
      expect(instruction).toContain("Do not invent a quantity");
      expect(instruction).toContain("A\n   bare, amount-less ingredient is correct and expected");
    });

    it("states the `# Heading` SECTION rule", () => {
      expect(instruction).toContain("SECTIONS");
      expect(instruction).toContain('emit each heading as its OWN step whose "text" is');
      expect(instruction).toContain('exactly "# Heading"');
      expect(instruction).toContain("Do not put ingredients on a heading step");
    });

    it("states that GARNISHES attach to the finishing step", () => {
      expect(instruction).toContain('GARNISHES / "for serving"');
      expect(instruction).toContain("attach them\n   to the finishing step");
    });

    it("states the TIMER rule, including when to name a timer", () => {
      expect(instruction).toContain("TIMERS");
      expect(instruction).toContain("add a timer { name, amount, unit } to that step");
      expect(instruction).toContain("otherwise name null");
    });

    it("forbids rewriting the step text into token syntax", () => {
      expect(instruction).toContain("Do NOT rewrite it\n   into @token or ~timer syntax");
      expect(instruction).toContain("do NOT delete the ingredient words from the");
      expect(instruction).toContain("needs them present to anchor the tokens");
    });

    it("keeps the COMMON MISTAKES block", () => {
      expect(instruction).toContain("COMMON MISTAKES (do not do these)");
      expect(instruction).toContain('✗ name "100g plain flour"');
      expect(instruction).toContain('✓ name "butter", amount null, unit null');
      expect(instruction).toContain('✗ putting "500 g" of beef on step 2 AND step 4');
    });

    it("keeps the WORKED EXAMPLE, including its closing observations", () => {
      expect(instruction).toContain("WORKED EXAMPLE (metric)");
      expect(instruction).toContain('recipeIngredient.metric: ["1 onion", "2 cloves garlic"');
      expect(instruction).toContain('{ "name": "minced beef", "amount": 500, "unit": "gram" }');
      expect(instruction).toContain(
        '"timers": [{ "name": null, "amount": 30, "unit": "minutes" }]'
      );
      expect(instruction).toContain('Notice: every "name" is a word in its own step\'s text');
    });
  });

  describe("the two W3 additions", () => {
    it("tells the model a step may be an OBJECT or a plain STRING (D-27-W3-03)", () => {
      expect(instruction).toContain("SHAPE: emit each step EITHER as an object with");
      expect(instruction).toContain("OR — only when the linkage for that step genuinely cannot be");
      expect(instruction).toContain("as a plain string holding just the prose");
      expect(instruction).toContain("A plain string is accepted and");
    });

    it("requires FULL COVERAGE of recipeIngredient by the steps (D-27-W3-04)", () => {
      expect(instruction).toContain("COVER EVERY INGREDIENT");
      expect(instruction).toContain(
        'every single\n   entry in "recipeIngredient" MUST be referenced by at least one step'
      );
      expect(instruction).toContain(
        "leaving even one unreferenced makes the whole linkage unusable"
      );
    });
  });

  it("phrases the coverage requirement without leaking norish internals", () => {
    expect(instruction).not.toContain("cook_source");
    expect(instruction).not.toContain(".cook");
    expect(instruction).not.toContain("buildCookPayload");
  });
});

describe("the linkage fragment reaches the model from CODE, not the template (D-27-W3-01)", () => {
  const fragment = buildLinkageInstruction();

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(loadPrompt).mockResolvedValue(UNRELATED_BASE_PROMPT);
    vi.mocked(getAutoTaggingMode).mockResolvedValue("disabled");
    vi.mocked(listAllTagNames).mockResolvedValue([]);
  });

  it("buildRecipeExtractionPrompt includes it with an unrelated base prompt", async () => {
    const prompt = await buildRecipeExtractionPrompt("Some scraped webpage body.");

    expect(prompt).toContain(UNRELATED_BASE_PROMPT);
    expect(prompt).toContain(fragment.trim());
  });

  it("buildImageExtractionPrompt includes it with an unrelated base prompt", async () => {
    const prompt = await buildImageExtractionPrompt(["gluten"], "nl");

    expect(prompt).toContain(UNRELATED_BASE_PROMPT);
    expect(prompt).toContain(fragment.trim());
  });

  it("buildVideoExtractionPrompt includes it with an unrelated base prompt", async () => {
    const prompt = await buildVideoExtractionPrompt("Spoken transcript body.", {
      title: "How to make pasta",
      duration: 125,
      url: "https://example.com/watch",
    });

    expect(prompt).toContain(UNRELATED_BASE_PROMPT);
    expect(prompt).toContain(fragment.trim());
  });

  it("places the fragment BEFORE the untrusted webpage text (T-27-08)", async () => {
    const prompt = await buildRecipeExtractionPrompt("Some scraped webpage body.", {
      url: "https://example.com/recipe",
    });

    const fragmentIndex = prompt.indexOf(FRAGMENT_MARKER);
    const contentIndex = prompt.indexOf("WEBPAGE TEXT:");

    expect(fragmentIndex).toBeGreaterThan(-1);
    expect(contentIndex).toBeGreaterThan(-1);
    expect(fragmentIndex).toBeLessThan(contentIndex);
  });

  it("places the fragment BEFORE the untrusted video transcript (T-27-08)", async () => {
    const prompt = await buildVideoExtractionPrompt("Spoken transcript body.", {
      title: "How to make pasta",
      duration: 125,
      url: "https://example.com/watch",
    });

    const fragmentIndex = prompt.indexOf(FRAGMENT_MARKER);
    const contentIndex = prompt.indexOf("VIDEO TRANSCRIPT:");

    expect(fragmentIndex).toBeGreaterThan(-1);
    expect(contentIndex).toBeGreaterThan(-1);
    expect(fragmentIndex).toBeLessThan(contentIndex);
  });

  it("places the fragment BEFORE the image analysis instruction (T-27-08)", async () => {
    const prompt = await buildImageExtractionPrompt();

    const fragmentIndex = prompt.indexOf(FRAGMENT_MARKER);
    const contentIndex = prompt.indexOf("Analyze the provided images");

    expect(fragmentIndex).toBeGreaterThan(-1);
    expect(contentIndex).toBeGreaterThan(-1);
    expect(fragmentIndex).toBeLessThan(contentIndex);
  });
});
