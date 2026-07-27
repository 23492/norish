// Phase 27 (COOK-01) W4 — verifier warning W4: the ~55-line cook-token
// branch in `inline-token-renderer.tsx` (the `norish-timer:`/
// `norish-ingredient:` href handling added for D-27-W4-11) had no test of
// its own. `smart-text-non-invocation.test.ts` proves `SmartText` calls the
// right shared helpers on the token branch, but it mocks
// `InlineTokenRenderer` to `() => null` — so the renderer's OWN behaviour
// (resolving a timer index against `cookTimers`, building the timer id,
// degrading to plain text on a null duration or `disableLinks`, and styling
// an unresolved `norish-ingredient:` link) was never exercised.
//
// Mobile has no RN render harness (D-27-W4-10: no
// @testing-library/react-native, no jsdom). Following the same pattern
// `smart-text-non-invocation.test.ts` established, this test calls the
// REAL, unmodified `InlineTokenRenderer` export directly as a plain
// function (not through a renderer) and inspects the returned React
// element tree — `react-native`, `heroui-native` and the `TimerChipInline`
// child are mocked only so their own transitive imports (expo-haptics,
// @expo/vector-icons, the timer store) never load; none of the assertions
// below are about those modules' internals.

import { describe, expect, it, vi } from "vitest";

import type { CookRenderTimer, InlineToken, TimerRenderContext } from "../../src/components/recipe-detail/text-renderer/types";

vi.mock("react-native", () => ({
  Linking: { openURL: vi.fn() },
  Text: (props: unknown) => props,
}));

vi.mock("heroui-native", () => ({
  useThemeColor: () => ["fg-color", "link-color"],
}));

vi.mock("../../src/components/recipe-detail/text-renderer/timer-chip-inline", () => ({
  TimerChipInline: (props: unknown) => props,
}));

async function loadRenderer() {
  const { InlineTokenRenderer } = await import(
    "../../src/components/recipe-detail/text-renderer/inline-token-renderer"
  );
  const { TimerChipInline } = await import(
    "../../src/components/recipe-detail/text-renderer/timer-chip-inline"
  );
  const { Text } = await import("react-native");

  return { InlineTokenRenderer, TimerChipInline, Text };
}

const TIMER_CONTEXT: TimerRenderContext = { recipeId: "r1", stepIndex: 2 };

function childrenOf(element: React.ReactElement): React.ReactElement[] {
  const children = (element.props as { children: unknown }).children;

  return Array.isArray(children) ? (children as React.ReactElement[]) : [children as React.ReactElement];
}

describe("InlineTokenRenderer — cook-token branch (Phase 27 W4, verifier warning W4)", () => {
  it("resolves a norish-timer: href against cookTimers by index and builds the recipeId-sN-index id", async () => {
    const { InlineTokenRenderer, TimerChipInline } = await loadRenderer();

    const cookTimers: CookRenderTimer[] = [{ index: 0, name: "pasta", durationMs: 600000 }];
    const tokens: InlineToken[] = [{ type: "link", label: "pasta", href: "norish-timer:0" }];

    const element = InlineTokenRenderer({
      tokens,
      baseStyle: {},
      cookTimers,
      timerContext: TIMER_CONTEXT,
    }) as React.ReactElement;

    const [chip] = childrenOf(element);

    expect(chip.type).toBe(TimerChipInline);
    expect(chip.props).toMatchObject({
      durationMs: 600000,
      label: "pasta",
      timerId: "r1-s2-0",
      recipeId: "r1",
      text: "pasta",
    });
  });

  it("degrades an unresolved timer index (out of range) to plain styled text, never a chip", async () => {
    const { InlineTokenRenderer, TimerChipInline } = await loadRenderer();

    const cookTimers: CookRenderTimer[] = [{ index: 0, name: "pasta", durationMs: 600000 }];
    const tokens: InlineToken[] = [{ type: "link", label: "sauce", href: "norish-timer:1" }];

    const element = InlineTokenRenderer({
      tokens,
      baseStyle: {},
      cookTimers,
      timerContext: TIMER_CONTEXT,
    }) as React.ReactElement;

    const [plain] = childrenOf(element);

    expect(plain.type).not.toBe(TimerChipInline);
    expect(childrenOf(plain)).toEqual(["sauce"]);
  });

  it("degrades a timer token with a null durationMs to plain text, never NaN", async () => {
    const { InlineTokenRenderer, TimerChipInline } = await loadRenderer();

    const cookTimers: CookRenderTimer[] = [{ index: 0, name: null, durationMs: null }];
    const tokens: InlineToken[] = [{ type: "link", label: "Timer", href: "norish-timer:0" }];

    const element = InlineTokenRenderer({
      tokens,
      baseStyle: {},
      cookTimers,
      timerContext: TIMER_CONTEXT,
    }) as React.ReactElement;

    const [plain] = childrenOf(element);

    expect(plain.type).not.toBe(TimerChipInline);
    expect(childrenOf(plain)).toEqual(["Timer"]);
  });

  it("degrades a resolvable timer to plain text when disableLinks is set", async () => {
    const { InlineTokenRenderer, TimerChipInline } = await loadRenderer();

    const cookTimers: CookRenderTimer[] = [{ index: 0, name: "pasta", durationMs: 600000 }];
    const tokens: InlineToken[] = [{ type: "link", label: "pasta", href: "norish-timer:0" }];

    const element = InlineTokenRenderer({
      tokens,
      baseStyle: {},
      cookTimers,
      disableLinks: true,
      timerContext: TIMER_CONTEXT,
    }) as React.ReactElement;

    const [plain] = childrenOf(element);

    expect(plain.type).not.toBe(TimerChipInline);
    expect(childrenOf(plain)).toEqual(["pasta"]);
  });

  it("falls back to timer-<index> when no timerContext is supplied", async () => {
    const { InlineTokenRenderer, TimerChipInline } = await loadRenderer();

    const cookTimers: CookRenderTimer[] = [{ index: 0, name: "pasta", durationMs: 600000 }];
    const tokens: InlineToken[] = [{ type: "link", label: "pasta", href: "norish-timer:0" }];

    const element = InlineTokenRenderer({
      tokens,
      baseStyle: {},
      cookTimers,
    }) as React.ReactElement;

    const [chip] = childrenOf(element);

    expect(chip.type).toBe(TimerChipInline);
    expect(chip.props).toMatchObject({ timerId: "timer-0", recipeId: undefined });
  });

  it("renders a norish-ingredient: href as non-interactive styled text (mobile has no ingredient-highlight target)", async () => {
    const { InlineTokenRenderer } = await loadRenderer();

    const tokens: InlineToken[] = [
      { type: "link", label: "brown sugar", href: "norish-ingredient:metric:brown sugar" },
    ];

    const element = InlineTokenRenderer({
      tokens,
      baseStyle: {},
    }) as React.ReactElement;

    const [span] = childrenOf(element);

    expect(childrenOf(span)).toEqual(["brown sugar"]);
    expect((span.props as { onPress?: unknown }).onPress).toBeUndefined();
  });

  it("leaves ordinary http links untouched by the cook-token schemes", async () => {
    const { InlineTokenRenderer } = await loadRenderer();
    const { Linking } = await import("react-native");

    const tokens: InlineToken[] = [
      { type: "link", label: "source", href: "https://example.com/recipe" },
    ];

    const element = InlineTokenRenderer({
      tokens,
      baseStyle: {},
    }) as React.ReactElement;

    const [link] = childrenOf(element);

    expect(childrenOf(link)).toEqual(["source"]);
    (link.props as { onPress: () => void }).onPress();
    expect(Linking.openURL).toHaveBeenCalledWith("https://example.com/recipe");
  });
});
