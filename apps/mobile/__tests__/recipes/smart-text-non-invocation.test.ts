// Phase 27 (COOK-01) W4/T5 — the MOBILE half of D-27-W4-01's non-invocation
// proof, extending T5's declared web-only file list (T4's executor flagged
// this gap: mobile's non-invocation previously rested on the `!cookStep`
// branch in `SmartText` never being reached, with no spy proving it —
// map-recipe-to-steps.test.ts only proves the DATA-layer pairing, not that
// the rendering layer (`SmartText`) actually skips the prose scan).
//
// Mobile has no RN render harness (D-27-W4-10: no @testing-library/react-native,
// no jsdom, no setup file — `apps/mobile/vitest.config.ts` is plain node-env).
// Importing the REAL `react-native` package here reproduces exactly that
// constraint: it is a Flow-typed source file vite/esbuild cannot parse
// (`import typeof * as ... from "*.js.flow"`), confirmed empirically before
// writing this test. Building a full RN render harness (react-test-renderer,
// jest-expo, etc.) is the "tooling change W4 does not need" per D-27-W4-10,
// and none of those packages are installed (`git diff pnpm-lock.yaml` must
// stay empty for this plan).
//
// This test instead calls the REAL, unmodified `SmartText` export directly
// as a plain function — not through a renderer — with every hook it uses
// replaced by an inert stand-in via `vi.mock` (including `react`'s own
// `useMemo`, so no React dispatcher is required). `react-native`'s `Text`/
// `StyleSheet` and the three child renderer components are mocked so their
// own transitive imports (heroui-native, expo-haptics, @expo/vector-icons)
// never load — JSX referencing them only builds a plain element-descriptor
// object; it never calls them. `parse-blocks.ts` (pure, no react-native
// import) and `@norish/shared/cooklang`/`@norish/shared/lib/timer-parser`
// (the real production modules, spied) run for real, so the assertions
// below exercise SmartText's actual production branching, not a
// reimplementation of it.

import { describe, expect, it, vi } from "vitest";

import type { CookRenderStep } from "@norish/shared/cooklang";

vi.mock("react", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react")>();

  // `useMemo` is the only real React hook SmartText calls directly (every
  // other hook it uses is mocked below to a plain function). Calling a
  // function component outside a renderer means no dispatcher is installed,
  // so the real `useMemo` would throw "Invalid hook call" — this collapses
  // it to a synchronous passthrough. `react/jsx-runtime` (a separate module)
  // is untouched, so JSX element creation is completely unaffected.
  return {
    ...actual,
    useMemo: <T,>(factory: () => T) => factory(),
  };
});

vi.mock("react-native", () => ({
  StyleSheet: { flatten: (style: unknown) => style ?? {} },
  Text: () => null,
}));

vi.mock("react-intl", () => ({
  useIntl: () => ({
    formatMessage: (
      descriptor: { id: string },
      values?: Record<string, unknown>
    ) => `${descriptor.id}:${JSON.stringify(values ?? {})}`,
  }),
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

// These three are referenced only as JSX element TYPES on the branch taken
// (never invoked as plain functions by this test, since nothing here
// actually renders the tree) — mocked so their own imports of
// heroui-native/expo-haptics/@expo/vector-icons never load.
vi.mock("../../src/components/recipe-detail/text-renderer/inline-token-renderer", () => ({
  InlineTokenRenderer: () => null,
}));

vi.mock("../../src/components/recipe-detail/text-renderer/rich-text-block", () => ({
  RichTextBlock: () => null,
}));

vi.mock("../../src/components/recipe-detail/text-renderer/timer-chip-inline", () => ({
  TimerChipInline: () => null,
}));

vi.mock("../../src/components/recipe-detail/text-renderer/parse-blocks", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../../src/components/recipe-detail/text-renderer/parse-blocks")>();

  return {
    ...actual,
    stripMarkdownForTimerDetection: vi.fn(actual.stripMarkdownForTimerDetection),
  };
});

vi.mock("@norish/shared/lib/timer-parser", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@norish/shared/lib/timer-parser")>();

  return {
    ...actual,
    parseTimerDurations: vi.fn(actual.parseTimerDurations),
  };
});

vi.mock("@norish/shared/cooklang", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@norish/shared/cooklang")>();

  return {
    ...actual,
    cookStepTimers: vi.fn(actual.cookStepTimers),
    cookStepToMarkdown: vi.fn(actual.cookStepToMarkdown),
  };
});

async function loadMocks() {
  const { SmartText } = await import("../../src/components/recipe-detail/text-renderer/smart-text");
  const { parseTimerDurations } = await import("@norish/shared/lib/timer-parser");
  const { stripMarkdownForTimerDetection } = await import(
    "../../src/components/recipe-detail/text-renderer/parse-blocks"
  );
  const { cookStepTimers, cookStepToMarkdown } = await import("@norish/shared/cooklang");

  return {
    SmartText,
    parseTimerDurationsMock: vi.mocked(parseTimerDurations),
    stripMarkdownMock: vi.mocked(stripMarkdownForTimerDetection),
    cookStepTimersMock: vi.mocked(cookStepTimers),
    cookStepToMarkdownMock: vi.mocked(cookStepToMarkdown),
  };
}

function ingredientAndTimerStep(): CookRenderStep {
  return {
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
}

describe("SmartText — mobile non-invocation proof (Phase 27 W4, T5 extension)", () => {
  it("on the token branch (cookStep present), never calls parseTimerDurations or stripMarkdownForTimerDetection, and DOES call cookStepTimers/cookStepToMarkdown", async () => {
    const {
      SmartText,
      parseTimerDurationsMock,
      stripMarkdownMock,
      cookStepTimersMock,
      cookStepToMarkdownMock,
    } = await loadMocks();

    parseTimerDurationsMock.mockClear();
    stripMarkdownMock.mockClear();
    cookStepTimersMock.mockClear();
    cookStepToMarkdownMock.mockClear();

    SmartText({
      children: "Simmer for 10 minutes.",
      cookStep: ingredientAndTimerStep(),
      highlightTimers: true,
      timerContext: { recipeId: "r1", stepIndex: 0 },
    });

    expect(parseTimerDurationsMock).not.toHaveBeenCalled();
    expect(stripMarkdownMock).not.toHaveBeenCalled();
    expect(cookStepTimersMock).toHaveBeenCalledTimes(1);
    expect(cookStepToMarkdownMock).toHaveBeenCalledTimes(1);
  });

  it("on the legacy branch (no cookStep), calls parseTimerDurations and stripMarkdownForTimerDetection, and never calls cookStepTimers/cookStepToMarkdown", async () => {
    const {
      SmartText,
      parseTimerDurationsMock,
      stripMarkdownMock,
      cookStepTimersMock,
      cookStepToMarkdownMock,
    } = await loadMocks();

    parseTimerDurationsMock.mockClear();
    stripMarkdownMock.mockClear();
    cookStepTimersMock.mockClear();
    cookStepToMarkdownMock.mockClear();

    SmartText({
      children: "Simmer for 10 minutes.",
      highlightTimers: true,
      timerContext: { recipeId: "r1", stepIndex: 0 },
    });

    expect(parseTimerDurationsMock).toHaveBeenCalledTimes(1);
    expect(stripMarkdownMock).toHaveBeenCalledTimes(1);
    expect(cookStepTimersMock).not.toHaveBeenCalled();
    expect(cookStepToMarkdownMock).not.toHaveBeenCalled();
  });
});
