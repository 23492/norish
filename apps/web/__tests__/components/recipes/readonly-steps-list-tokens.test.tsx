import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import "@testing-library/jest-dom";

import { ReadonlyStepsList } from "@/components/recipes/readonly-steps-list";

import { resolveCookRenderSteps } from "@norish/shared/cooklang";
import { createIngredientLinkCandidates } from "@norish/shared-react/text";

vi.mock("@norish/shared/lib/logger", () => ({
  createClientLogger: () => () => ({ warn: () => {} }),
}));

vi.mock("@/hooks/config", () => ({
  useTimersEnabledQuery: () => ({ timersEnabled: false }),
  useTimerKeywordsQuery: () => ({
    timerKeywords: { enabled: true, hours: [], minutes: [], seconds: [] },
  }),
}));

vi.mock("@/hooks/use-unit-formatter", () => ({
  useUnitFormatter: () => ({
    formatAmountUnit: (amount: number | null, unit: string | null) => {
      if (amount == null || unit == null) return "";

      return `${amount} ${unit === "gram" ? "g" : unit}`;
    },
  }),
}));

vi.mock("@norish/shared-react/text", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@norish/shared-react/text")>();

  return {
    ...actual,
    createIngredientLinkCandidates: vi.fn(actual.createIngredientLinkCandidates),
  };
});

const createIngredientLinkCandidatesMock = vi.mocked(createIngredientLinkCandidates);

const TOKEN_STEPS: Parameters<typeof resolveCookRenderSteps>[0] = [
  {
    order: 1,
    section: null,
    tokens: [
      { type: "text", value: "Add " },
      { type: "ingredient", name: "brown sugar", amount: 200, unit: "gram" },
      { type: "text", value: " and stir in the sugar." },
    ],
  },
  {
    order: 2,
    section: "Sauce",
    tokens: [{ type: "text", value: "Simmer gently." }],
  },
];

const LEGACY_STEPS_PAIRED = [
  { step: "Add sugar and stir in the sugar.", systemUsed: "metric", order: 1 },
  { step: "Simmer gently.", systemUsed: "metric", order: 2 },
];

describe("ReadonlyStepsList — Cooklang token branch (Phase 27 W4, T2)", () => {
  beforeEach(() => {
    createIngredientLinkCandidatesMock.mockClear();
  });

  it("renders every step from tokens: the token's own amount/unit and section heading, and never calls the heuristic", () => {
    const cookSteps = resolveCookRenderSteps(TOKEN_STEPS, {
      baseServings: 4,
      servings: 8,
      systemUsed: "metric",
    });

    render(
      <ReadonlyStepsList
        cookSteps={cookSteps}
        enableTimers
        interactive
        ingredients={[]}
        recipeId="r1"
        recipeName="R"
        steps={LEGACY_STEPS_PAIRED}
        systemUsed="metric"
      />
    );

    // 200g doubles to 400g under baseServings 4 -> servings 8, the SAME
    // expression the ingredient list uses (D-27-W4-03).
    expect(screen.getByText("brown sugar (400 g)")).toBeInTheDocument();
    // The heuristic's bare "sugar" match never happens — no second chip.
    expect(screen.queryByText("sugar (400 g)")).toBeNull();
    expect(screen.getByRole("heading", { level: 3, name: "Sauce" })).toBeInTheDocument();
    expect(createIngredientLinkCandidatesMock).not.toHaveBeenCalled();
  });

  it("keeps the legacy #-heading render byte-for-byte when cookSteps is absent", () => {
    const legacyStepsWithHeading = [
      { step: "# Prep", systemUsed: "metric", order: 1 },
      { step: "Chop the onions.", systemUsed: "metric", order: 2 },
    ];

    render(
      <ReadonlyStepsList
        enableTimers
        interactive
        ingredients={[]}
        recipeId="r1"
        recipeName="R"
        steps={legacyStepsWithHeading}
        systemUsed="metric"
      />
    );

    expect(screen.getByRole("heading", { level: 3, name: "Prep" })).toBeInTheDocument();
    expect(screen.getByText(/Chop the onions\./)).toBeInTheDocument();
    expect(createIngredientLinkCandidatesMock).toHaveBeenCalled();
  });

  it("falls back to the legacy branch in full on a cookSteps/step count mismatch", () => {
    const mismatchedCookSteps = resolveCookRenderSteps(TOKEN_STEPS.slice(0, 1), {
      systemUsed: "metric",
    });

    render(
      <ReadonlyStepsList
        cookSteps={mismatchedCookSteps}
        enableTimers
        interactive
        ingredients={[]}
        recipeId="r1"
        recipeName="R"
        steps={LEGACY_STEPS_PAIRED}
        systemUsed="metric"
      />
    );

    // A stale/mismatched projection must not render a half-token step: no
    // "Sauce" section heading, and the heuristic runs for both rows.
    expect(screen.queryByRole("heading", { level: 3, name: "Sauce" })).toBeNull();
    expect(createIngredientLinkCandidatesMock).toHaveBeenCalled();
  });
});
