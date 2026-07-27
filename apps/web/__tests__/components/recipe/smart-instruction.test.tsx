import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import "@testing-library/jest-dom";

import { SmartInstruction } from "@/components/recipe/smart-instruction";

vi.mock("@norish/shared/lib/logger", () => ({
  createClientLogger: () => () => ({ warn: () => {} }),
}));

// SmartMarkdownRenderer now reads the timer fallback label via
// useTranslations("common") (Phase 27 W4, T3, D-27-W4-06) instead of a
// hard-coded English string — this suite renders without a next-intl
// provider, so the hook needs a mock the same way @/hooks/use-unit-formatter
// is already mocked below for the identical reason (T2).
vi.mock("next-intl", () => ({
  useTranslations: () => (key: string) => key,
}));

vi.mock("@/hooks/config", () => ({
  useTimersEnabledQuery: () => ({ timersEnabled: false }),
  useTimerKeywordsQuery: () => ({
    timerKeywords: { enabled: true, hours: [], minutes: [], seconds: [] },
  }),
}));

// SmartInstruction gained the Cooklang token branch (Phase 27 W4, T2), which
// unconditionally calls useUnitFormatter() to have formatAmountUnit ready
// for a cookStep — this suite renders without a next-intl provider, so the
// hook needs a mock the same way @/hooks/config already has one above.
vi.mock("@/hooks/use-unit-formatter", () => ({
  useUnitFormatter: () => ({
    formatAmountUnit: () => "",
  }),
}));

// Replace the TimerChip with a simple marker to detect it if rendered
vi.mock("@/components/recipe/timer-chip", () => ({
  TimerChip: ({ _children }: any) => <span>TIMER_CHIP</span>,
}));

describe("SmartInstruction", () => {
  beforeEach(() => vi.clearAllMocks());

  it("does not render timers when timers are disabled", () => {
    render(
      <SmartInstruction recipeId="r1" recipeName="R" stepIndex={0} text={"Bake for 10 minutes"} />
    );

    expect(screen.queryByText("TIMER_CHIP")).toBeNull();
    expect(screen.getByText(/Bake for 10 minutes/)).toBeInTheDocument();
  });
});
