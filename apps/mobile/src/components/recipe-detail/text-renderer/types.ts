import type { StyleProp, TextProps, TextStyle } from "react-native";
import type { CookRenderStep, CookRenderTimer } from "@norish/shared/cooklang";

// ─── Inline token types ──────────────────────────────────────────────────────

export type InlineToken =
  | { type: "text"; content: string }
  | { type: "bold"; content: string }
  | { type: "italic"; content: string }
  | { type: "bold-italic"; content: string }
  | { type: "link"; label: string; href: string };

// ─── Block token types ───────────────────────────────────────────────────────

export type BlockToken =
  | { type: "heading"; level: number; children: InlineToken[] }
  | { type: "paragraph"; children: InlineToken[] };

// ─── Timer segment types ─────────────────────────────────────────────────────

export type TimerSegment = {
  type: "timer";
  originalText: string;
  durationMs: number;
  timerId: string;
  label: string;
};

export type RichTextSegment = {
  type: "richtext";
  content: string;
};

export type TopSegment = RichTextSegment | TimerSegment;

// ─── Cook-token render context (Phase 27 W4, D-27-W4-02/06/10) ──────────────

/** Recipe context threaded down to a resolved timer chip's store entry. */
export type TimerRenderContext = {
  recipeId: string;
  recipeName?: string;
  stepIndex: number;
};

// ─── SmartText props ─────────────────────────────────────────────────────────

export type SmartTextProps = {
  /** The raw text with markdown-like formatting */
  children: string;
  /** Base text style to apply */
  style?: StyleProp<TextStyle>;
  /** If true, links are rendered as styled text but are not tappable */
  disableLinks?: boolean;
  /** If true, detect and highlight timer patterns (e.g. "15 minutes") */
  highlightTimers?: boolean;
  /**
   * Recipe context for timer IDs. Required when highlightTimers is true
   * to generate unique timer identifiers.
   */
  timerContext?: TimerRenderContext;
  /** Extra props forwarded to the root <Text> (only when no timers present) */
  textProps?: TextProps;
  /**
   * Cooklang token step for this row (Phase 27 W4, D-27-W4-01/10/11). When
   * present, `children` is IGNORED — the markup is built from the token via
   * `cookStepToMarkdown`/`cookStepTimers` instead of scanning prose for
   * ingredients/timers, and the keyword-scanning branch below never runs.
   * `null`/`undefined` (the common case until W5's backfill) keeps the
   * existing keyword-scan render, byte-for-byte.
   */
  cookStep?: CookRenderStep;
};

// Re-exported so `inline-token-renderer.tsx` can name the timer list's
// element type without reaching into `@norish/shared/cooklang` itself.
export type { CookRenderTimer };
