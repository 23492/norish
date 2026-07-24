import type { UnitsMap } from "@norish/config/zod/server-config";
import type {
  LinkOutcome,
  SerializeResult,
  StructuredIngredientRef,
  StructuredRecipe,
  StructuredStep,
  StructuredTimerRef,
} from "./types";

import { formatTokenAmount, normalizeIngredientLinkName } from "../lib/ingredient-token";
import { normalizeUnit } from "../lib/unit-localization";

/**
 * PURE serializer: a norish structured recipe -> a `.cook` string (D-3/D-4).
 *
 * No I/O, no DB, no network, no clock, no randomness and no locale: the same
 * input always yields a byte-identical string.
 *
 * Parser facts this encodes (confirmed against `@cooklang/cooklang@0.18.7`):
 *   * steps are separated by a BLANK line (`\n\n`) — single newlines MERGE steps;
 *   * `== Heading ==` is a section; norish `#`-prefixed steps map onto it;
 *   * ingredient token `@name{qty%unit}`; a multi-word amount-less name needs `{}`;
 *   * timer `~{qty%unit}` or named `~name{qty%unit}`;
 *   * metadata is YAML frontmatter (`---`); the legacy `>> k: v` form is deprecated.
 *
 * D-8: `%unit` carries the CANONICAL norish unit ID (`gram`, `tablespoon`), which
 * Cooklang treats as an opaque string and round-trips verbatim. Localization is a
 * READ-side concern (`formatUnit`); a localized label must never enter the `.cook`.
 */

const SINGLE_WORD_STOP = /[\s@{}\[\]()~#,;:!?.]/;

/** Strip the Cooklang metacharacters that would corrupt a token. */
function sanitizeTokenName(name: string): string {
  return name
    .trim()
    .replace(/\s+/g, " ")
    .replace(/[@{}~#%]/g, "");
}

/**
 * Run a raw unit through the REAL config-driven normalizer so `%unit` is
 * guaranteed to be a canonical norish unit ID ("gr" -> "gram", "EL" ->
 * "tablespoon"). Without a units config the function is identity-behaved.
 */
function canonicalUnit(unit: string | null | undefined, units?: UnitsMap): string {
  const raw = unit?.trim() ?? "";

  if (!raw) return "";

  return units ? normalizeUnit(raw, units) : raw;
}

/** Emit a Cooklang ingredient token `@name{qty%unit}`. */
export function formatCooklangIngredient(ref: StructuredIngredientRef, units?: UnitsMap): string {
  const name = sanitizeTokenName(ref.name);
  const amount = formatTokenAmount(ref.amount);
  const unit = canonicalUnit(ref.unit, units);
  const isMultiWord = SINGLE_WORD_STOP.test(name);

  if (amount && unit) return `@${name}{${amount}%${unit}}`;
  if (amount) return `@${name}{${amount}}`;

  // no amount ("salt to taste"): single-word bare `@salt`, multi-word needs `@sea salt{}`
  return isMultiWord ? `@${name}{}` : `@${name}`;
}

/**
 * Emit a Cooklang timer token. Timer units are Cooklang TIME units, a different
 * vocabulary from the norish ingredient units config, so they are NOT run through
 * `normalizeUnit` (which would leave them untouched anyway — the units config has
 * no time entries — but would be the wrong contract).
 */
export function formatCooklangTimer(timer: StructuredTimerRef): string {
  const name = sanitizeTokenName(timer.name ?? "");
  const amount = formatTokenAmount(timer.amount);
  const unit = timer.unit.trim();

  return name ? `~${name}{${amount}%${unit}}` : `~{${amount}%${unit}}`;
}

function quoteYaml(value: string): string {
  // A plain number MUST stay unquoted: Cooklang types `servings` as a number and
  // reports `Unsupported value for key: 'servings' — expected 'number' but got
  // 'string'` for `servings: "4"`. (Found by running the REAL parser over the
  // spike's output; the spike quoted every digit-leading value.)
  if (/^-?\d+(?:\.\d+)?$/.test(value)) return value;

  // Everything else that could confuse YAML ("15 min", "a: b") is quoted.
  return /[:#]/.test(value) || /^\d/.test(value) ? `"${value.replace(/"/g, '\\"')}"` : value;
}

function buildFrontmatter(recipe: StructuredRecipe): string {
  const meta: [string, string][] = [];

  if (recipe.name) meta.push(["title", recipe.name]);
  if (recipe.servings != null) meta.push(["servings", String(recipe.servings)]);
  if (recipe.prepMinutes != null) meta.push(["time.prep", `${recipe.prepMinutes} min`]);
  if (recipe.cookMinutes != null) meta.push(["time.cook", `${recipe.cookMinutes} min`]);
  if (recipe.source) meta.push(["source", recipe.source]);
  // D-2: record the single unit system this `.cook` is written in.
  meta.push(["norish.system", recipe.systemUsed]);

  if (meta.length === 0) return "";

  const body = meta.map(([key, value]) => `${key}: ${quoteYaml(value)}`).join("\n");

  return `---\n${body}\n---\n`;
}

/** case-insensitive, token-consuming, word-ish boundary match of `name` in `text` */
function findNameIndex(text: string, name: string): number {
  const hay = text.toLowerCase();
  const needle = normalizeIngredientLinkName(name);
  let from = 0;

  for (;;) {
    const index = hay.indexOf(needle, from);

    if (index < 0) return -1;

    const before = index === 0 ? "" : (hay[index - 1] ?? "");
    const after = hay[index + needle.length] ?? "";
    const boundaryBefore = before === "" || /[^a-z0-9]/.test(before);
    const boundaryAfter = after === "" || /[^a-z0-9]/.test(after);

    // don't re-tokenise an already-emitted `@token`
    if (boundaryBefore && boundaryAfter && before !== "@") return index;

    from = index + needle.length;
  }
}

/**
 * Inline a step's ingredient refs into its prose. For each ref, find the first
 * unconsumed case-insensitive occurrence of its name and replace it with a
 * Cooklang token. Refs with no textual anchor are appended as trailing tokens and
 * reported as `placement:"appended"` rather than silently dropped.
 */
function serializeStepLine(step: StructuredStep, links: LinkOutcome[], units?: UnitsMap): string {
  let text = step.text;
  const appended: string[] = [];
  // longest names first so "brown sugar" wins over "sugar"
  const refs = [...step.ingredients].sort((a, b) => b.name.length - a.name.length);

  for (const ref of refs) {
    const token = formatCooklangIngredient(ref, units);
    const index = findNameIndex(text, ref.name);

    if (index >= 0) {
      text = text.slice(0, index) + token + text.slice(index + ref.name.length);
      links.push({ stepOrder: step.order, ingredient: ref.name, placement: "inline" });
    } else {
      appended.push(token);
      links.push({ stepOrder: step.order, ingredient: ref.name, placement: "appended" });
    }
  }

  for (const timer of step.timers ?? []) {
    const token = formatCooklangTimer(timer);

    text = text.includes(token) ? text : `${text} ${token}`;
  }

  if (appended.length > 0) {
    text = `${text.trimEnd()} ${appended.join(" ")}`;
  }

  return text.trim();
}

/** Serialize and report, per ingredient ref, whether it landed inline or was appended. */
export function serializeWithReport(recipe: StructuredRecipe, units?: UnitsMap): SerializeResult {
  const links: LinkOutcome[] = [];
  const steps = [...recipe.steps].sort((a, b) => a.order - b.order);
  const lines: string[] = [];

  for (const step of steps) {
    const trimmed = step.text.trim();

    if (trimmed.startsWith("#")) {
      lines.push(`== ${trimmed.replace(/^#+\s*/, "")} ==`);
      continue;
    }

    lines.push(serializeStepLine(step, links, units));
  }

  // steps separated by a BLANK line so the parser keeps them distinct
  const cook = `${buildFrontmatter(recipe)}${lines.join("\n\n")}\n`;

  return { cook, links };
}

/** Pure serializer: norish structured recipe -> `.cook` string. */
export function structuredToCooklang(recipe: StructuredRecipe, units?: UnitsMap): string {
  return serializeWithReport(recipe, units).cook;
}
