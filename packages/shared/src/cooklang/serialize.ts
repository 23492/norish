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
 *
 * ESCAPING IS THE SECURITY BOUNDARY (T-27-01 root-cause fix).
 * `.cook` is a SYNTAX-BEARING format and `@ # ~ { } % = > -` are its
 * metacharacters. Everything this module writes that norish did not author as a
 * token is untrusted: step prose, heading text, ingredient names, amounts and
 * units all originate in a language model that a scraped page, an uploaded photo
 * or a video transcript steered. Emitting any of it VERBATIM is injection, in the
 * same family as SQL or HTML injection — the earlier mitigation tried to *predict*
 * which injected prose the WASM parser would object to, which is necessarily both
 * incomplete (a brace-closed-but-invalid token such as `@a{1%}` slipped through and
 * cost 11 s of parse time on a 64 KiB source) and over-broad (ordinary US shorthand
 * "Preheat the oven @ 325" was refused although it parses in 13 ms).
 *
 * So: every metacharacter in non-token text is ESCAPED here, which makes
 * "norish's own `.cook` contains exactly the tokens norish intended" true BY
 * CONSTRUCTION rather than hoped-for. Verified against `@cooklang/cooklang@0.18.7`:
 * `\X` is a general escape — the parser drops the backslash and keeps `X` as
 * literal text, inside prose, inside a section heading, inside a token name and
 * inside a `{amount%unit}` body alike — so the escaping is LOSSLESSLY REVERSIBLE
 * and the round trip is byte-identical (`round-trip-fidelity.test.ts`).
 *
 * FRONTMATTER IS A CLOSED SHAPE, NOT "SOME YAML" (W3B, D-27-W3B-06 — H1).
 * Escaping fixed the BODY and left the frontmatter unconstrained: the recognizer's
 * `key: value` line pattern accepted arbitrary YAML, so a 65 417-byte
 * `---\na: [[[[…\n---\n` passed every gate and cost the parser 24-38 SECONDS with a
 * 131 218-byte "recursion limit exceeded" report. This module is the other half of
 * that fix: it emits a CLOSED set of keys (`COOK_FRONTMATTER_KEYS`) whose values are
 * either a DOUBLE-QUOTED scalar or a plain YAML NUMBER, and nothing else — so the
 * recognizer can accept exactly that shape and refuse every other YAML construct
 * (anchors, aliases, tags, block scalars, flow collections, comments, multi-document
 * markers) by grammar rather than by prediction.
 */

const SINGLE_WORD_STOP = /[\s@{}\[\]()~#,;:!?.]/;

/**
 * Every character the Cooklang dialect norish writes attaches meaning to:
 * `\` (the escape itself, which MUST be in the class), `@` ingredient,
 * `#` cookware, `~` timer, `{}` quantity, `%` unit separator, `--`/`[-`/`-]`
 * comments, `==` section, `>>` metadata. A single character class is safe in one
 * `String.replace` pass: the backslashes it inserts are never re-examined.
 */
const COOK_METACHARACTERS = /[\\@#~{}%=>-]/g;

/**
 * CR/LF only. A newline inside step prose would not be a corrupt character, it
 * would be a STRUCTURAL injection — `\n\n` starts a new step and `\n== x ==`
 * starts a new section — so line terminators are folded to a space rather than
 * escaped. This is the one deliberate, documented normalization in the escaping
 * scheme (a sibling to the pre-existing `.trim()`); every other character,
 * including TAB and NUL, survives byte-identically.
 */
const COOK_LINE_TERMINATORS = /\r\n|\r|\n/g;

/**
 * Neutralize every Cooklang metacharacter in text norish did not author as a
 * token. Reversed by the parser itself, so `escapeCookText` loses nothing.
 */
export function escapeCookText(text: string): string {
  return text.replace(COOK_LINE_TERMINATORS, " ").replace(COOK_METACHARACTERS, "\\$&");
}

/**
 * A token's name/amount/unit is untrusted text too, so it is ESCAPED rather than
 * stripped: stripping `#` from "jalapeño #2" silently rewrote the name the user
 * typed, and because the token replaces that name in the prose it corrupted the
 * displayed step as well. `@jalapeño \#2{2%piece}` parses back to the exact name.
 */
function escapeTokenText(value: string): string {
  return escapeCookText(value).trim().replace(/\s+/g, " ");
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
  const name = escapeTokenText(ref.name);
  const amount = escapeTokenText(formatTokenAmount(ref.amount));
  const unit = escapeTokenText(canonicalUnit(ref.unit, units));
  // an escaped name carries a `\`, which a BARE `@name` cannot express — the brace
  // form is the only one that delimits the name unambiguously.
  const needsBraces = name.includes("\\") || SINGLE_WORD_STOP.test(name);

  if (amount && unit) return `@${name}{${amount}%${unit}}`;
  if (amount) return `@${name}{${amount}}`;

  // no amount ("salt to taste"): single-word bare `@salt`, multi-word needs `@sea salt{}`
  return needsBraces ? `@${name}{}` : `@${name}`;
}

/**
 * Emit a Cooklang timer token. Timer units are Cooklang TIME units, a different
 * vocabulary from the norish ingredient units config, so they are NOT run through
 * `normalizeUnit` (which would leave them untouched anyway — the units config has
 * no time entries — but would be the wrong contract).
 *
 * Returns "" for a timer Cooklang cannot express. `~{%minutes}` (no amount) and
 * `~{5%}` (no unit) both make the parser emit a diagnostic, which would cost the
 * WHOLE recipe its `cook_source`; the step's own prose still carries the time, so
 * dropping just the token is the cheapest correct outcome.
 */
export function formatCooklangTimer(timer: StructuredTimerRef): string {
  const name = escapeTokenText(timer.name ?? "");
  const amount = escapeTokenText(formatTokenAmount(timer.amount));
  const unit = escapeTokenText(timer.unit);

  if (!amount || !unit) return "";

  return name ? `~${name}{${amount}%${unit}}` : `~{${amount}%${unit}}`;
}

/**
 * THE CLOSED SET OF FRONTMATTER KEYS norish can emit, in emission order (W3B,
 * D-27-W3B-06).
 *
 * This tuple is the SINGLE SOURCE OF TRUTH for the frontmatter key set:
 * `@norish/shared-server/cooklang/limits`'s recognizer imports it rather than
 * restating it, so a key added here without teaching the recognizer fails a
 * two-way test loudly instead of silently refusing every new recipe. It is a
 * SECURITY boundary, not documentation — H1 was an unconstrained key/value pattern.
 *
 * `buildFrontmatter` below is typed against it, so `tsc` refuses a key that is not
 * a member.
 */
export const COOK_FRONTMATTER_KEYS = [
  "title",
  "servings",
  "time.prep",
  "time.cook",
  "source",
  "norish.system",
] as const;

export type CookFrontmatterKey = (typeof COOK_FRONTMATTER_KEYS)[number];

/**
 * The keys emitted as a BARE YAML NUMBER rather than a quoted scalar.
 *
 * Cooklang TYPES `servings` as a number and reports `Unsupported value for key:
 * 'servings' — expected 'number' but got 'string'` for `servings: "4"`, so that one
 * key must stay unquoted. Every other key is quoted unconditionally (see
 * `quoteYaml`).
 */
export const COOK_FRONTMATTER_NUMERIC_KEYS = ["servings"] as const satisfies readonly CookFrontmatterKey[];

/**
 * Exactly the numbers `String(Number(x))` can produce for a finite value in plain
 * decimal notation. Exponential forms (`1e+21`, `1e-7`) do NOT match, and a key
 * whose value does not match is OMITTED rather than emitted in a shape the
 * recognizer would refuse — see `frontmatterLine`.
 */
const FRONTMATTER_NUMBER = /^-?\d+(?:\.\d+)?$/;

/**
 * The maximum number of CHARACTERS a frontmatter value may occupy once emitted,
 * quotes and escapes included.
 *
 * Derived, not guessed: the longest legitimate value is a quoted `title`, whose
 * plaintext is capped at `COOK_LIMITS.maxRecipeNameChars` (500) by
 * `checkStructuredRecipeLimits`, and quoting at most DOUBLES it (a value of nothing
 * but `"` or `\`) plus the two delimiters — 2 x 500 + 2. The number is duplicated
 * here rather than imported because `@norish/shared` must not depend on
 * `@norish/shared-server`; `limits.ts` imports THIS constant, and a test asserts the
 * two agree so the derivation cannot silently drift.
 *
 * It is load-bearing for H1: the recognizer's frontmatter block cap is this number
 * times the size of the closed key set, which is what refuses a 65 KB frontmatter
 * BY ARITHMETIC, before any value grammar is even considered.
 */
export const COOK_FRONTMATTER_MAX_VALUE_CHARS = 1_002;

/**
 * Every character a YAML scalar may not carry raw: the C0 controls except TAB, the
 * C1 controls, and the Unicode line/paragraph separators.
 *
 * Written as a code-point test rather than a regular expression on purpose — a
 * character class of literal control escapes is what `no-control-regex` exists to
 * flag, and disabling the rule to keep a regex would be the wrong trade.
 */
function isYamlForbidden(code: number): boolean {
  if (code === 0x09) return false;

  return code <= 0x1f || (code >= 0x7f && code <= 0x9f) || code === 0x2028 || code === 0x2029;
}

/** Fold every run of YAML-forbidden characters down to a single space. */
function foldYamlForbidden(value: string): string {
  let folded = "";
  let pending = false;

  for (const char of value) {
    if (isYamlForbidden(char.codePointAt(0) ?? 0)) {
      pending = true;
      continue;
    }

    if (pending) {
      folded += " ";
      pending = false;
    }

    folded += char;
  }

  return pending ? `${folded} ` : folded;
}

/**
 * Frontmatter is YAML, not Cooklang, so metadata values are QUOTED rather than
 * backslash-escaped — but they are untrusted all the same. An unquoted `title:
 * @@@@ ####` makes the parser report `Invalid YAML frontmatter syntax`, and a
 * value carrying a NEWLINE would break out of the frontmatter block entirely and
 * inject arbitrary `.cook` body (the structural half of the same injection bug the
 * escaping above fixes). Line terminators are therefore folded first, and the value
 * is then double-quoted UNCONDITIONALLY.
 *
 * UNCONDITIONALLY IS THE W3B CHANGE (D-27-W3B-06 — H1). This used to emit a value
 * VERBATIM when it looked like a "provably plain scalar" (`^[\p{L}\p{N}][^\r\n:#"]*$`),
 * which meant `title: a [[[[[…` was serializer output — a plain scalar carrying
 * 65 000 flow-sequence characters. The recognizer then had to accept plain scalars,
 * i.e. accept nearly arbitrary YAML, which is exactly the hole H1 exploited. Quoting
 * every non-numeric value collapses the frontmatter value grammar to TWO shapes
 * (`"…"` or a plain number), which a recognizer can assert instead of predict. The
 * cost is two bytes per metadata line and a changed byte string for a plain title;
 * `title: "Pancakes"` was verified to parse with an EMPTY report.
 *
 * YAML also forbids RAW CONTROL CHARACTERS outright, quoted or not ("control
 * characters are not allowed at position N"), so they are folded to a space here.
 * That is why frontmatter needs its own normalization and cannot simply reuse
 * `escapeCookText`: step prose keeps a TAB or a NUL byte-identically, a YAML scalar
 * cannot. TAB is the one control character YAML does allow, so it survives.
 *
 * Returns `null` — meaning OMIT THE KEY — when the value folds to nothing (an
 * all-whitespace title is not a title) or when the quoted form would exceed
 * `COOK_FRONTMATTER_MAX_VALUE_CHARS`. Omitting optional metadata keeps the recipe's
 * `cook_source`; emitting a value the recognizer refuses would cost the recipe the
 * whole read model, and the DB columns remain the source of truth for every one of
 * these fields.
 */
function quoteYaml(value: string): string | null {
  const flat = foldYamlForbidden(value).trim();

  if (flat === "") return null;

  const quoted = `"${flat.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;

  return quoted.length > COOK_FRONTMATTER_MAX_VALUE_CHARS ? null : quoted;
}

/**
 * Render one frontmatter line, or `null` to omit the key.
 *
 * The value shape is decided BY THE KEY, never by the value. Deciding from the
 * value was an earlier bug: a recipe literally titled "1.50" produced `title: 1.50`,
 * YAML read it as a number and the parser reported `Unsupported value for key:
 * 'title'` — costing that recipe its `cook_source` for a name the user chose.
 */
function frontmatterLine(key: CookFrontmatterKey, value: string): string | null {
  if ((COOK_FRONTMATTER_NUMERIC_KEYS as readonly string[]).includes(key)) {
    // A number outside plain decimal notation ("1e+21") is not a shape the
    // recognizer accepts, so the key is dropped rather than emitted unrecognizably.
    return FRONTMATTER_NUMBER.test(value) && value.length <= COOK_FRONTMATTER_MAX_VALUE_CHARS
      ? `${key}: ${value}`
      : null;
  }

  const quoted = quoteYaml(value);

  return quoted === null ? null : `${key}: ${quoted}`;
}

function buildFrontmatter(recipe: StructuredRecipe): string {
  const meta: { key: CookFrontmatterKey; value: string }[] = [];

  if (recipe.name) meta.push({ key: "title", value: recipe.name });
  if (recipe.servings != null && Number.isFinite(Number(recipe.servings))) {
    meta.push({ key: "servings", value: String(Number(recipe.servings)) });
  }
  if (recipe.prepMinutes != null) meta.push({ key: "time.prep", value: `${recipe.prepMinutes} min` });
  if (recipe.cookMinutes != null) meta.push({ key: "time.cook", value: `${recipe.cookMinutes} min` });
  if (recipe.source) meta.push({ key: "source", value: recipe.source });
  // D-2: record the single unit system this `.cook` is written in.
  meta.push({ key: "norish.system", value: recipe.systemUsed });

  const lines = meta
    .map(({ key, value }) => frontmatterLine(key, value))
    .filter((line): line is string => line !== null);

  if (lines.length === 0) return "";

  return `---\n${lines.join("\n")}\n---\n`;
}

/** case-insensitive, token-consuming, word-ish boundary match of `name` in `text` */
function findNameIndex(text: string, name: string): number {
  const hay = text.toLowerCase();
  const needle = normalizeIngredientLinkName(name);

  // A BLANK name has no textual anchor, and searching for the empty string would
  // spin forever (`indexOf("", 0)` is always 0, so the loop below never advances).
  // Such a ref cannot be expressed as a token either, so `findCookSourceDefect`
  // refuses the whole source and the recipe keeps its legacy projection.
  if (needle === "") return -1;

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
 * A step line under construction, as an alternating sequence of untrusted PROSE
 * runs and norish-authored TOKENS.
 *
 * The line is built as fragments rather than by mutating one string, because the
 * two halves need opposite treatment: prose must be escaped, a token must not be
 * (escaping it would turn it into literal text). Keeping them apart also means an
 * ingredient name can no longer be matched INSIDE an already-emitted token — with
 * a single mutable string a ref named "gram" matched the `%gram}` of a previous
 * token, which silently corrupted it.
 */
type StepFragment = { kind: "prose"; value: string } | { kind: "token"; value: string };

/** Replace `[index, length)` of a prose fragment with a token, in place. */
function splitFragment(
  fragments: StepFragment[],
  at: number,
  prose: string,
  index: number,
  length: number,
  token: string
): void {
  fragments.splice(
    at,
    1,
    { kind: "prose", value: prose.slice(0, index) },
    { kind: "token", value: token },
    { kind: "prose", value: prose.slice(index + length) }
  );
}

/**
 * Inline a step's ingredient refs into its prose. For each ref, find the first
 * unconsumed case-insensitive occurrence of its name and replace it with a
 * Cooklang token. Refs with no textual anchor are appended as trailing tokens and
 * reported as `placement:"appended"` rather than silently dropped.
 */
function serializeStepLine(step: StructuredStep, links: LinkOutcome[], units?: UnitsMap): string {
  const fragments: StepFragment[] = [{ kind: "prose", value: step.text }];
  const appended: string[] = [];
  // longest names first so "brown sugar" wins over "sugar"
  const refs = [...step.ingredients].sort((a, b) => b.name.length - a.name.length);

  for (const ref of refs) {
    const token = formatCooklangIngredient(ref, units);
    let placed = false;

    for (let at = 0; at < fragments.length; at += 1) {
      const fragment = fragments[at];

      if (fragment?.kind !== "prose") continue;

      const index = findNameIndex(fragment.value, ref.name);

      if (index < 0) continue;

      splitFragment(fragments, at, fragment.value, index, ref.name.length, token);
      placed = true;
      break;
    }

    if (placed) {
      links.push({ stepOrder: step.order, ingredient: ref.name, placement: "inline" });
    } else {
      appended.push(token);
      links.push({ stepOrder: step.order, ingredient: ref.name, placement: "appended" });
    }
  }

  for (const timer of step.timers ?? []) {
    const token = formatCooklangTimer(timer);

    if (token === "") continue;
    if (fragments.some((fragment) => fragment.kind === "token" && fragment.value === token)) {
      continue;
    }

    fragments.push({ kind: "prose", value: " " }, { kind: "token", value: token });
  }

  const line = fragments
    .map((fragment) => (fragment.kind === "prose" ? escapeCookText(fragment.value) : fragment.value))
    .join("");

  if (appended.length > 0) {
    return `${line.trimEnd()} ${appended.join(" ")}`.trim();
  }

  return line.trim();
}

/** Serialize and report, per ingredient ref, whether it landed inline or was appended. */
export function serializeWithReport(recipe: StructuredRecipe, units?: UnitsMap): SerializeResult {
  const links: LinkOutcome[] = [];
  const steps = [...recipe.steps].sort((a, b) => a.order - b.order);
  const lines: string[] = [];

  for (const step of steps) {
    const trimmed = step.text.trim();

    if (trimmed.startsWith("#")) {
      // heading TEXT is untrusted prose too: an unescaped `=` in it makes the
      // parser report "A section block is invalid and it will be a step".
      lines.push(`== ${escapeCookText(trimmed.replace(/^#+\s*/, ""))} ==`);
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
