import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import "@testing-library/jest-dom";

import { SmartInstruction } from "@/components/recipe/smart-instruction";

import type { CookRenderStep } from "@norish/shared/cooklang";

vi.mock("@norish/shared/lib/logger", () => ({
  createClientLogger: () => () => ({ warn: () => {} }),
}));

const DEFAULT_TIMER_KEYWORDS = {
  enabled: true,
  hours: ["hour", "hours"],
  minutes: ["minute", "minutes"],
  seconds: ["second", "seconds"],
};

const timersEnabledMock = vi.fn(() => ({ timersEnabled: true }));
const timerKeywordsMock = vi.fn(() => ({ timerKeywords: DEFAULT_TIMER_KEYWORDS }));

vi.mock("@/hooks/config", () => ({
  useTimersEnabledQuery: () => timersEnabledMock(),
  useTimerKeywordsQuery: () => timerKeywordsMock(),
}));

// A minimal, deterministic stand-in for the real `formatUnit`-backed hook —
// this suite is proving the token wiring in SmartInstruction, not
// unit-localization, which has its own tests.
vi.mock("@/hooks/use-unit-formatter", () => ({
  useUnitFormatter: () => ({
    formatAmountUnit: (amount: number | null, unit: string | null) => {
      if (amount == null || unit == null) return "";

      return `${amount} ${unit === "gram" ? "g" : unit}`;
    },
  }),
}));

vi.mock("@/components/recipe/timer-chip", () => ({
  TimerChip: ({
    initialLabel,
    durationMs,
  }: {
    initialLabel: string;
    durationMs: number;
  }) => (
    <span>
      TIMER:{initialLabel}:{durationMs}
    </span>
  ),
}));

function ingredientStep(): CookRenderStep {
  return {
    order: 1,
    stepNumber: 1,
    section: null,
    isSectionStart: false,
    tokens: [
      { type: "text", value: "Add " },
      {
        type: "ingredient",
        name: "brown sugar",
        amount: 200,
        unit: "gram",
        key: "metric:brown sugar",
      },
      { type: "text", value: " and stir in the sugar." },
    ],
  };
}

describe("SmartInstruction — Cooklang token branch (Phase 27 W4, T2)", () => {
  beforeEach(() => {
    timersEnabledMock.mockReturnValue({ timersEnabled: true });
    timerKeywordsMock.mockReturnValue({ timerKeywords: DEFAULT_TIMER_KEYWORDS });
  });

  it("renders the token ingredient's own name and localized amount, not the prose scan's match", () => {
    render(
      <SmartInstruction
        cookStep={ingredientStep()}
        recipeId="r1"
        recipeName="R"
        stepIndex={0}
        text="Add sugar and stir in the sugar."
      />
    );

    // The tokens mark "brown sugar" only — the heuristic would have matched
    // the bare "sugar" word too, but with cookStep present the prose scan
    // never runs (there is no createIngredientLinkCandidates call at this
    // layer to begin with — ReadonlyStepsList owns that proof).
    expect(screen.getByText("brown sugar (200 g)")).toBeInTheDocument();
  });

  // T2b (Phase 27 W4 gap-closure): T2 shipped this branch with
  // `ingredientCandidates={undefined}`, so the chip rendered as a
  // non-interactive `<span>` and `onIngredientPress` never fired — it only
  // satisfied D-27-W4-09's literal `<action>` text, not its `<behavior>`
  // (chips reuse the existing highlight-key contract). This test FAILS
  // against that code: there is no `button` role and `onIngredientPress` is
  // never called.
  it("renders the token ingredient chip as interactive and fires onIngredientPress with the legacy-compatible key", () => {
    const onIngredientPress = vi.fn();

    render(
      <SmartInstruction
        cookStep={ingredientStep()}
        recipeId="r1"
        recipeName="R"
        stepIndex={0}
        text="Add sugar and stir in the sugar."
        onIngredientPress={onIngredientPress}
      />
    );

    const chip = screen.getByRole("button", { name: "brown sugar (200 g)" });

    fireEvent.click(chip);

    // Same `"metric:brown sugar"` form the legacy `createIngredientLinkCandidates`
    // path and `readonly-ingredients-list.tsx`'s `data-ingredient-link-key`
    // anchors use (D-27-W4-09) — token and legacy branches must agree.
    expect(onIngredientPress).toHaveBeenCalledTimes(1);
    expect(onIngredientPress).toHaveBeenCalledWith(
      expect.objectContaining({ key: "metric:brown sugar", ingredientName: "brown sugar" })
    );
  });

  it("resolves a named timer token to a real duration via cookStepTimers, bypassing the prose scan", () => {
    const step: CookRenderStep = {
      order: 1,
      stepNumber: 1,
      section: null,
      isSectionStart: false,
      tokens: [
        { type: "text", value: "Simmer for " },
        { type: "timer", name: "sauce", amount: 10, unit: "minutes" },
        { type: "text", value: "." },
      ],
    };

    render(
      <SmartInstruction
        cookStep={step}
        recipeId="r1"
        recipeName="R"
        stepIndex={0}
        text="Simmer for 10 minutes."
      />
    );

    // 10 minutes -> 600000ms, resolved from the token's own amount/unit, not
    // from a regex match against "Simmer for 10 minutes.".
    expect(screen.getByText("TIMER:sauce:600000")).toBeInTheDocument();
  });

  it("falls back to a plain label and stays inert when timers are disabled", () => {
    timersEnabledMock.mockReturnValue({ timersEnabled: false });

    const step: CookRenderStep = {
      order: 1,
      stepNumber: 1,
      section: null,
      isSectionStart: false,
      tokens: [{ type: "timer", name: null, amount: 5, unit: "minutes" }],
    };

    render(
      <SmartInstruction
        cookStep={step}
        recipeId="r1"
        recipeName="R"
        stepIndex={0}
        text="Wait 5 minutes"
      />
    );

    expect(screen.getByText("Timer")).toBeInTheDocument();
    expect(screen.queryByText(/^TIMER:/)).toBeNull();
  });

  it("still renders from prose when no cookStep is supplied (legacy branch untouched)", () => {
    render(
      <SmartInstruction recipeId="r1" recipeName="R" stepIndex={0} text="Bake for 10 minutes" />
    );

    expect(screen.getByText("TIMER:Step 1 Timer:600000")).toBeInTheDocument();
  });
});
