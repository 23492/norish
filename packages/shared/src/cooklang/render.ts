/**
 * Pure Cooklang token RENDER model (Phase 27, W4 — D-27-W4-02).
 *
 * Projects the `cookTokens` DTO (the parsed, plain-JSON `.cook` read model
 * W1 contracted and W3B mints server-side) into the shape both web and
 * mobile render steps from: ordered, numbered, section-aware steps,
 * servings-scaled ingredient amounts, and step-local timer sequencing.
 *
 * This module is pure — no UI framework, no server-config package, no I/O,
 * no locale formatting — so both clients can bundle it, including
 * `apps/mobile` (Expo/RN, D-27-W1-01). Locale-dependent label text
 * (amount+unit, timer labels) is supplied by the CALLER through the
 * `format` callbacks (D-27-W4-04); this module never calls `formatUnit`
 * and never reads a config itself.
 *
 * IMPORTANT: this module NEVER parses `.cook` and never imports
 * `@cooklang/cooklang`. It consumes only the already-bounded `cookTokens`
 * payload the pooled server-side parser (`@norish/shared-server/cooklang`)
 * produces — T-27-01 forbids re-parsing `.cook` on a hot path, which is
 * exactly why this model exists as a projection over already-parsed JSON.
 */

import type {
  CookStepTokensDTO,
  CookTokenDTO,
  CookTokensDTO,
} from "@norish/shared/contracts/dto/recipe";

import {
  escapeMarkdownLabel,
  getIngredientLinkCandidateKey,
  normalizeIngredientLinkName,
} from "../lib/ingredient-token";
import { timerUnitSeconds, type TimerKeywords } from "../lib/timer-parser";

export type CookRenderTextToken = Extract<CookTokenDTO, { type: "text" }>;

/**
 * The ingredient token as it comes back from `resolveCookRenderSteps`: the
 * same shape `cookTokens` carries, except `amount` has been servings-scaled
 * and a `key` has been precomputed so `cookStepToMarkdown` never needs to
 * know the recipe's `systemUsed` itself.
 */
export type CookRenderIngredientToken = Extract<CookTokenDTO, { type: "ingredient" }> & {
  /**
   * The `norish-ingredient:` candidate key
   * (`getIngredientLinkCandidateKey({ ingredientName, systemUsed })`,
   * D-27-W4-09) — the SAME key the heuristic `ingredient-links` markup
   * produces, so the chip's press event and the ingredient list's DOM
   * anchors keep matching. Built from `options.systemUsed`; when the
   * caller omits it (the whole `.cook` is one system per D-2, so a caller
   * that already knows it should pass it) the key degrades to the bare
   * normalized name with no `system:` prefix.
   */
  key: string;
};

export type CookRenderTimerToken = Extract<CookTokenDTO, { type: "timer" }>;

export type CookRenderToken =
  | CookRenderTextToken
  | CookRenderIngredientToken
  | CookRenderTimerToken;

export type CookRenderStep = {
  order: number;
  /** 1-based, assigned by array position AFTER sorting by `order`. */
  stepNumber: number;
  /** `== Heading ==` section this step belongs to, or `null`. */
  section: string | null;
  /** true on the first step of a NEW named section (never true for `null`). */
  isSectionStart: boolean;
  tokens: CookRenderToken[];
};

export type CookRenderTimer = {
  /** position among this step's timer tokens, in document order. */
  index: number;
  name: string | null;
  /** null when the amount is missing/non-finite — render as plain text, never `NaN`. */
  durationMs: number | null;
};

export type CookRenderScaleOptions = {
  /** the recipe's authored servings — the divisor in :332's expression. */
  baseServings?: number | null;
  /** the servings currently being viewed/cooked — the multiplier. */
  servings?: number | null;
  /**
   * the recipe's single Cooklang system (D-2). Only used to build the
   * ingredient token `key` (D-27-W4-09) — see `CookRenderIngredientToken`.
   */
  systemUsed?: string;
};

export type CookRenderFormat = {
  /**
   * Locale-dependent "amount unit" label, e.g. `useUnitFormatter().formatAmountUnit`
   * producing `"200 g"`. Return `""`/`null`/`undefined` for an amount-less
   * token — `cookStepToMarkdown` falls back to the bare ingredient name.
   */
  ingredientAmountLabel: (token: CookRenderIngredientToken) => string | null | undefined;
  /** Label for a timer token, e.g. its name or a formatted duration string. */
  timerLabel: (timer: CookRenderTimerToken) => string;
};

/**
 * `null | undefined | []` -> `null` — the single guard both clients branch
 * on (legacy heuristic render vs. token render, D-27-W4-01).
 *
 * Otherwise: steps sorted by `order`, numbered 1-based by their sorted
 * position, with ingredient token amounts servings-scaled through the
 * CHARACTER-FOR-CHARACTER same expression `recipe-detail-context.tsx:332`
 * uses (D-27-W4-03) — never a pre-divided `scale` multiplier.
 */
export function resolveCookRenderSteps(
  cookTokens: CookTokensDTO | null | undefined,
  options?: CookRenderScaleOptions
): CookRenderStep[] | null {
  if (!cookTokens || cookTokens.length === 0) return null;

  const sorted = [...cookTokens].sort((a, b) => a.order - b.order);
  let previousSection: string | null | undefined;

  return sorted.map((step, index) => {
    const isSectionStart =
      step.section != null && (index === 0 || step.section !== previousSection);

    previousSection = step.section;

    return {
      order: step.order,
      stepNumber: index + 1,
      section: step.section,
      isSectionStart,
      tokens: step.tokens.map((token) => resolveToken(token, options)),
    };
  });
}

function resolveToken(token: CookTokenDTO, options: CookRenderScaleOptions | undefined): CookRenderToken {
  if (token.type !== "ingredient") return token;

  return {
    ...token,
    amount: scaleIngredientAmount(token.amount, options),
    key: buildIngredientKey(token.name, options?.systemUsed),
  };
}

function buildIngredientKey(ingredientName: string, systemUsed: string | undefined): string {
  if (!systemUsed) return normalizeIngredientLinkName(ingredientName);

  return getIngredientLinkCandidateKey({ ingredientName, systemUsed });
}

/**
 * `Math.round((amount / baseServings) * servings * 10000) / 10000` — the
 * SAME expression as `recipe-detail-context.tsx:332`, not `amount * (servings
 * / baseServings)`, which is a different IEEE-754 computation and diverges
 * on a repeating decimal (D-27-W4-03). Mirrors :332's guards: a `NaN` or
 * `<= 0` amount passes through unscaled, and a falsy `baseServings` (never
 * expected in practice, but the options bag is optional input) is treated
 * as "no scaling" rather than a divide-by-zero producing `Infinity`.
 */
function scaleIngredientAmount(
  amount: number | null,
  options: CookRenderScaleOptions | undefined
): number | null {
  if (amount == null || !options) return amount;

  const { baseServings, servings } = options;

  if (!baseServings || servings == null || servings === baseServings) return amount;
  if (Number.isNaN(amount) || amount <= 0) return amount;

  return Math.round((amount / baseServings) * servings * 10000) / 10000;
}

/**
 * Renders a step's tokens into the SAME markup shape the heuristic
 * `applyIngredientLinkMarkup`/timer-keyword-scan pipeline produced
 * (D-27-W4-11), so it can feed straight into the existing
 * `SmartMarkdownRenderer`/`SmartText` pipeline unchanged:
 *
 * - text tokens are emitted VERBATIM (the user's prose, may contain markdown).
 * - ingredient tokens become `[<escaped label>](norish-ingredient:<encoded key>)`,
 *   label = `name` alone when `format.ingredientAmountLabel` returns nothing,
 *   or `name (amount unit)` when it doesn't.
 * - timer tokens become `[<escaped label>](norish-timer:<i>)`, where `i` is
 *   the token's position among this step's timer tokens (matching
 *   `cookStepTimers`'s `index`, so a caller resolving `norish-timer:<i>`
 *   against `cookStepTimers(step)[i]` gets the right token).
 *
 * The label is escaped (`escapeMarkdownLabel`) so a hostile ingredient/timer
 * name containing `[`, `]` or `\` cannot break out of the link.
 */
export function cookStepToMarkdown(step: CookRenderStep, format: CookRenderFormat): string {
  let timerIndex = 0;

  return step.tokens
    .map((token) => {
      if (token.type === "text") return token.value;

      if (token.type === "ingredient") {
        const amountLabel = format.ingredientAmountLabel(token)?.trim();
        const label = amountLabel ? `${token.name} (${amountLabel})` : token.name;
        const href = `norish-ingredient:${encodeURIComponent(token.key)}`;

        return `[${escapeMarkdownLabel(label)}](${href})`;
      }

      const index = timerIndex;

      timerIndex += 1;

      const label = escapeMarkdownLabel(format.timerLabel(token));

      return `[${label}](norish-timer:${index})`;
    })
    .join("");
}

/**
 * Dereferences a step's timer tokens into `{ index, name, durationMs }`, in
 * document order — the same order `cookStepToMarkdown` assigns `<i>` in a
 * `norish-timer:<i>` href, so `cookStepTimers(step)[i]` is always the token
 * that href points at.
 */
export function cookStepTimers(step: CookRenderStep, keywords?: TimerKeywords): CookRenderTimer[] {
  const timers: CookRenderTimer[] = [];

  for (const token of step.tokens) {
    if (token.type !== "timer") continue;

    timers.push({
      index: timers.length,
      name: token.name,
      durationMs: cookTimerDurationMs(token, keywords),
    });
  }

  return timers;
}

/**
 * A null/non-finite amount yields `null` (render as plain text, never a
 * chip with `NaN`). An unrecognized unit falls back to minutes, parity with
 * `timer-parser.ts`'s historical `?? 60` default. Unlike the prose scan,
 * this ALWAYS resolves keywords in UNION mode (D-27-W4-12): `unit` is an
 * unlocalized Cooklang TIME unit our own serializer writes (or an imported
 * `.cook` carries), not a word from the deployment's configured language,
 * so a configured `timerKeywords` list must never blot out the English
 * defaults here the way it correctly does for prose scanning.
 */
export function cookTimerDurationMs(
  token: Pick<CookRenderTimerToken, "amount" | "unit">,
  keywords?: TimerKeywords
): number | null {
  const { amount } = token;

  if (amount == null || !Number.isFinite(amount)) return null;

  const unit = token.unit ?? "minutes";
  const secondsPerUnit = timerUnitSeconds(unit, keywords, { union: true }) ?? 60;

  return amount * secondsPerUnit * 1000;
}

// Re-exported so consumers can name the per-step DTO shape without reaching
// into `@norish/shared/contracts/dto/recipe` directly.
export type { CookStepTokensDTO, CookTokenDTO, CookTokensDTO };
