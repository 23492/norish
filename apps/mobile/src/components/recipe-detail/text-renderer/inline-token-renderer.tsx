import type { TextStyle } from "react-native";
import React from "react";
import { Linking, Text } from "react-native";
import { useThemeColor } from "heroui-native";

import type { CookRenderTimer, InlineToken, TimerRenderContext } from "./types";
import { TimerChipInline } from "./timer-chip-inline";

// ─── Cook-token href schemes (Phase 27 W4, D-27-W4-11) ──────────────────────
// `cookStepToMarkdown` (shared, `@norish/shared/cooklang`) emits the SAME
// `norish-timer:<i>`/`norish-ingredient:<key>` link markup the web renderer
// resolves — teach this renderer the two schemes, leave `id:`/http untouched.

const TIMER_HREF_PREFIX = "norish-timer:";
const INGREDIENT_HREF_PREFIX = "norish-ingredient:";

// ─── Props ───────────────────────────────────────────────────────────────────

type InlineTokenRendererProps = {
  tokens: InlineToken[];
  baseStyle: TextStyle;
  disableLinks?: boolean;
  /**
   * Cooklang token timers for the step this text belongs to (Phase 27 W4).
   * Indexed to match the `norish-timer:<i>` hrefs `cookStepToMarkdown`
   * emits — `cookTimers[i]` is always the token behind that href.
   */
  cookTimers?: CookRenderTimer[];
  /** Recipe context threaded to a resolved timer chip's store entry. */
  timerContext?: TimerRenderContext;
};

// ─── Component ───────────────────────────────────────────────────────────────

/**
 * Renders an array of InlineTokens as React Native <Text> nodes.
 */
export function InlineTokenRenderer({
  tokens,
  baseStyle,
  disableLinks = false,
  cookTimers,
  timerContext,
}: InlineTokenRendererProps) {
  const [foregroundColor, linkColor] = useThemeColor(["foreground", "link"] as const);

  return (
    <>
      {tokens.map((token, i) => {
        switch (token.type) {
          case "bold":
            return (
              <Text key={i} style={[baseStyle, { fontWeight: "700", color: foregroundColor }]}>
                {token.content}
              </Text>
            );
          case "italic":
            return (
              <Text key={i} style={[baseStyle, { fontStyle: "italic" }]}>
                {token.content}
              </Text>
            );
          case "bold-italic":
            return (
              <Text
                key={i}
                style={[
                  baseStyle,
                  { fontWeight: "700", fontStyle: "italic", color: foregroundColor },
                ]}
              >
                {token.content}
              </Text>
            );
          case "link": {
            if (token.href.startsWith(TIMER_HREF_PREFIX)) {
              const index = Number(token.href.slice(TIMER_HREF_PREFIX.length));
              const timer = cookTimers?.[index];

              // A null/non-finite duration or a missing/disabled context
              // degrades to plain styled text — never a chip showing NaN
              // (the same behaviour contract `cookTimerDurationMs` documents).
              if (!timer || timer.durationMs == null || disableLinks) {
                return (
                  <Text
                    key={i}
                    className="underline"
                    style={[baseStyle, { color: foregroundColor }]}
                  >
                    {token.label}
                  </Text>
                );
              }

              // Same `${recipeId}-s${stepIndex}-${idx}` shape the keyword
              // branch below builds (and web's actual shipped
              // `buildTokenTimerMap`/`parseTimerMatches` id scheme uses) —
              // `index` here is the token's position among this step's
              // TIMER tokens (`cookStepTimers`'s own `index`), so two token
              // timers in one step still get distinct ids.
              const timerId = timerContext
                ? `${timerContext.recipeId}-s${timerContext.stepIndex}-${index}`
                : `timer-${index}`;

              return (
                <TimerChipInline
                  key={i}
                  durationMs={timer.durationMs}
                  label={timer.name ?? token.label}
                  recipeId={timerContext?.recipeId}
                  recipeName={timerContext?.recipeName}
                  text={token.label}
                  timerId={timerId}
                />
              );
            }

            if (token.href.startsWith(INGREDIENT_HREF_PREFIX)) {
              // Mobile has no ingredient-highlight target today (D-27-W4-04
              // note; not W4 scope to invent one) — render as non-interactive
              // styled text, the same degrade the web renderer uses for an
              // unresolved candidate.
              return (
                <Text key={i} className="underline" style={[baseStyle, { color: foregroundColor }]}>
                  {token.label}
                </Text>
              );
            }

            const href = token.href.startsWith("id:")
              ? `/recipes/${token.href.slice(3)}`
              : token.href;

            if (disableLinks) {
              return (
                <Text key={i} className="underline" style={[baseStyle, { color: foregroundColor }]}>
                  {token.label}
                </Text>
              );
            }

            return (
              <Text
                key={i}
                className="underline"
                style={[baseStyle, { color: linkColor }]}
                onPress={() => {
                  if (href.startsWith("http")) {
                    Linking.openURL(href);
                  }
                }}
              >
                {token.label}
              </Text>
            );
          }
          case "text":
          default:
            return (
              <Text key={i} style={baseStyle}>
                {token.content}
              </Text>
            );
        }
      })}
    </>
  );
}
