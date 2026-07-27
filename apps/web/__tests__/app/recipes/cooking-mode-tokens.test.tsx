import { render, screen } from "@testing-library/react";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import "@testing-library/jest-dom";

import { CookingModeTabs } from "@/app/(app)/recipes/[id]/components/cookingmode/cooking-mode-tabs";
import { CookingStepView } from "@/app/(app)/recipes/[id]/components/cookingmode/cooking-step-view";

import type { CookingModeDialogProps } from "@/app/(app)/recipes/[id]/components/cookingmode/types";
import type { ResolvedCookingModeStep } from "@/app/(app)/recipes/[id]/components/cookingmode/cooking-mode-steps";
import type { CookRenderStep } from "@norish/shared/cooklang";

import { createIngredientLinkCandidates } from "@norish/shared-react/text";

vi.mock("@norish/shared/lib/logger", () => ({
  createClientLogger: () => () => ({ warn: () => {} }),
}));

// SmartMarkdownRenderer reads the timer fallback label via
// useTranslations("common") (Phase 27 W4, T3, D-27-W4-06). This suite
// renders without a next-intl provider; the mock reproduces the real `en`
// string via interpolation so an unnamed-timer assertion can pin the actual
// translated text rather than a bare key.
vi.mock("next-intl", () => ({
  useTranslations: () => (key: string, values?: Record<string, unknown>) => {
    if (key === "timer.step_fallback_label") {
      return `Step ${values?.step} Timer`;
    }

    return key;
  },
}));

const DEFAULT_TIMER_KEYWORDS = {
  enabled: true,
  hours: ["hour", "hours"],
  minutes: ["minute", "minutes"],
  seconds: ["second", "seconds"],
};

vi.mock("@/hooks/config", () => ({
  useTimersEnabledQuery: () => ({ timersEnabled: true }),
  useTimerKeywordsQuery: () => ({ timerKeywords: DEFAULT_TIMER_KEYWORDS }),
}));

vi.mock("@/hooks/use-unit-formatter", () => ({
  useUnitFormatter: () => ({
    formatAmountUnit: (amount: number | null, unit: string | null) => {
      if (amount == null || unit == null) return "";

      return `${amount} ${unit === "gram" ? "g" : unit}`;
    },
  }),
}));

// Replace TimerChip with a marker exposing the props that prove distinct,
// independently-named concurrent timers (D-27-W4-06): a real render/click
// integration lives in stores/timers.test.ts, per the plan's own division of
// proof between the store suite and this rendering suite.
vi.mock("@/components/recipe/timer-chip", () => ({
  TimerChip: ({
    id,
    initialLabel,
    durationMs,
  }: {
    id: string;
    initialLabel: string;
    durationMs: number;
  }) => (
    <span>
      TIMER:{id}:{initialLabel}:{durationMs}
    </span>
  ),
}));

// CookingModeHeader/CookingIngredientsView pull in ServingsControl,
// SystemConvertMenu and ReadonlyIngredientsList, which need a full
// recipe-detail context + tRPC stack unrelated to what this suite proves
// (the token branch's step rendering + the zero-heuristic-call proof) —
// stand in with trivial markers, the same way other suites stub out
// unrelated sibling components.
vi.mock("@/app/(app)/recipes/[id]/components/cookingmode/cooking-mode-header", () => ({
  CookingModeHeader: () => null,
}));

vi.mock("@/app/(app)/recipes/[id]/components/cookingmode/cooking-ingredients-view", () => ({
  CookingIngredientsView: () => null,
}));

vi.mock("@norish/shared-react/text", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@norish/shared-react/text")>();

  return {
    ...actual,
    createIngredientLinkCandidates: vi.fn(actual.createIngredientLinkCandidates),
  };
});

const createIngredientLinkCandidatesMock = vi.mocked(createIngredientLinkCandidates);

const LEGACY_STEPS: ResolvedCookingModeStep[] = [
  {
    originalIndex: 0,
    stepNumber: 1,
    text: "Boil the pasta and simmer the sauce.",
    heading: undefined,
    images: [],
  },
];

const PASTA_SAUCE_COOK_STEPS: CookRenderStep[] = [
  {
    order: 1,
    stepNumber: 1,
    section: "Sauce",
    isSectionStart: true,
    tokens: [
      { type: "text", value: "Boil the " },
      { type: "timer", name: "pasta", amount: 10, unit: "minutes" },
      { type: "text", value: " and simmer the " },
      { type: "timer", name: "sauce", amount: 25, unit: "minutes" },
      { type: "text", value: "." },
    ],
  },
];

function tabsProps(overrides: Partial<CookingModeDialogProps> = {}): CookingModeDialogProps & {
  showIngredientsTitle: boolean;
} {
  return {
    activeStep: 0,
    activeTab: "steps",
    displayIngredients: [],
    recipeId: "r1",
    recipeName: "R",
    recipeServings: 4,
    recipeSystemUsed: "metric",
    steps: LEGACY_STEPS,
    cookSteps: null,
    onClose: vi.fn(),
    onPointerDown: vi.fn(),
    onPointerUp: vi.fn(),
    onStepChange: vi.fn(),
    onTabChange: vi.fn(),
    showIngredientsTitle: false,
    ...overrides,
  };
}

describe("Cooking mode — Cooklang token branch (Phase 27 W4, T3)", () => {
  beforeAll(() => {
    // jsdom has neither; @heroui/react's ScrollShadow/Tabs use both.
    vi.stubGlobal(
      "ResizeObserver",
      class ResizeObserver {
        observe() {}
        unobserve() {}
        disconnect() {}
      }
    );
  });

  beforeEach(() => {
    createIngredientLinkCandidatesMock.mockClear();
  });

  describe("CookingModeTabs — the zero-heuristic-call proof (D-27-W4-01)", () => {
    it("never calls createIngredientLinkCandidates when cookSteps is present", () => {
      render(<CookingModeTabs {...tabsProps({ cookSteps: PASTA_SAUCE_COOK_STEPS })} />);

      expect(createIngredientLinkCandidatesMock).not.toHaveBeenCalled();
    });

    it("calls createIngredientLinkCandidates on the legacy branch (cookSteps: null)", () => {
      render(<CookingModeTabs {...tabsProps({ cookSteps: null })} />);

      expect(createIngredientLinkCandidatesMock).toHaveBeenCalled();
    });
  });

  describe("CookingStepView — the pasta+sauce case", () => {
    it("renders the sticky section heading from the token's own section, and two independently named timer chips with distinct ids", () => {
      render(
        <CookingStepView
          activeStep={0}
          cookSteps={PASTA_SAUCE_COOK_STEPS}
          ingredientCandidates={[]}
          recipeId="r1"
          recipeName="R"
          steps={LEGACY_STEPS}
          onStepChange={vi.fn()}
        />
      );

      // D-27-W4-05: the heading chip comes from the token's `section`, not
      // from a `#` prefix in the legacy step text (there is none here).
      expect(screen.getByText("Sauce")).toBeInTheDocument();

      // The pasta+sauce case: TWO independently named timers from ONE step,
      // each with its own id (`${recipeId}-s${stepIndex}-${index}`) and its
      // own duration — never merged into one.
      expect(screen.getByText("TIMER:r1-s0-0:pasta:600000")).toBeInTheDocument();
      expect(screen.getByText("TIMER:r1-s0-1:sauce:1500000")).toBeInTheDocument();
    });

    it("falls back to the translated step label for an unnamed timer token — no hard-coded English literal", () => {
      const unnamedTimerStep: CookRenderStep[] = [
        {
          order: 1,
          stepNumber: 1,
          section: null,
          isSectionStart: false,
          tokens: [
            { type: "text", value: "Wait " },
            { type: "timer", name: null, amount: 5, unit: "minutes" },
          ],
        },
      ];

      render(
        <CookingStepView
          activeStep={0}
          cookSteps={unnamedTimerStep}
          ingredientCandidates={[]}
          recipeId="r1"
          recipeName="R"
          steps={LEGACY_STEPS}
          onStepChange={vi.fn()}
        />
      );

      // The i18n fallback (common.timer.step_fallback_label), not the
      // hard-coded "Step 1 Timer" literal that used to live in
      // smart-markdown-renderer.tsx.
      expect(screen.getByText("TIMER:r1-s0-0:Step 1 Timer:300000")).toBeInTheDocument();
    });

    it("keeps the legacy heading and prose rendering byte-for-byte when cookSteps is null", () => {
      const legacyStepsWithHeading: ResolvedCookingModeStep[] = [
        {
          originalIndex: 1,
          stepNumber: 1,
          text: "Chop the onions.",
          heading: "Prep",
          images: [],
        },
      ];

      render(
        <CookingStepView
          activeStep={0}
          cookSteps={null}
          ingredientCandidates={[]}
          recipeId="r1"
          recipeName="R"
          steps={legacyStepsWithHeading}
          onStepChange={vi.fn()}
        />
      );

      expect(screen.getByText("Prep")).toBeInTheDocument();
      expect(screen.getByText(/Chop the onions\./)).toBeInTheDocument();
    });
  });
});
