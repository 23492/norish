import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import "@testing-library/jest-dom";

import SmartMarkdownRenderer from "@/components/shared/smart-markdown-renderer";

import { createIngredientLinkCandidates } from "@norish/shared-react/text";

// SmartMarkdownRenderer now reads the timer fallback label via
// useTranslations("common") (Phase 27 W4, T3, D-27-W4-06) instead of a
// hard-coded English string — this suite renders without a next-intl
// provider, so the hook needs a mock the same way its sibling suites
// already mock @/hooks/use-unit-formatter for the same reason (T2).
vi.mock("next-intl", () => ({
  useTranslations: () => (key: string) => key,
}));

vi.mock("@/components/recipe/timer-chip", () => ({
  TimerChip: ({ originalText }: { originalText: string }) => <span>timer:{originalText}</span>,
}));

const ingredientCandidates = createIngredientLinkCandidates(
  [
    { ingredientName: "Salt", systemUsed: "metric", order: 0 },
    { ingredientName: "Ground black pepper", systemUsed: "metric", order: 1 },
  ],
  "metric"
);

describe("SmartMarkdownRenderer", () => {
  it("renders known ingredient markers as actionable links", () => {
    const onIngredientPress = vi.fn();

    render(
      <SmartMarkdownRenderer
        ingredientCandidates={ingredientCandidates}
        text="Season with @salt."
        onIngredientPress={onIngredientPress}
      />
    );

    fireEvent.click(screen.getByRole("button", { name: "Salt" }));

    expect(onIngredientPress).toHaveBeenCalledWith(
      expect.objectContaining({ ingredientName: "Salt", key: "metric:salt" })
    );
  });

  it("keeps public recipe references as text", () => {
    render(<SmartMarkdownRenderer linkMode="public" text="See [Sauce](id:recipe-123)." />);

    expect(screen.getByText(/Sauce/)).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Sauce" })).toBeNull();
  });

  it("renders private recipe references as recipe links", () => {
    render(<SmartMarkdownRenderer text="See [Sauce](id:recipe-123)." />);

    expect(screen.getByRole("link", { name: "Sauce" })).toHaveAttribute(
      "href",
      "/recipes/recipe-123"
    );
  });

  it("renders timers and ingredient links together", () => {
    render(
      <SmartMarkdownRenderer
        ingredientCandidates={ingredientCandidates}
        text="Stir @ground black pepper{2 g} for 10 minutes."
        timerConfig={{
          enabled: true,
          recipeId: "recipe-1",
          recipeName: "Soup",
          stepIndex: 0,
        }}
      />
    );

    expect(screen.getByRole("button", { name: "Ground black pepper (2 g)" })).toBeInTheDocument();
    expect(screen.getByText("timer:10 minutes")).toBeInTheDocument();
  });
});
