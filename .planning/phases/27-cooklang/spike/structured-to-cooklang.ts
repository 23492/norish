// SPIKE — Phase 27 (COOK-01), NOT yet wired into the live extraction/cooking path.
// -----------------------------------------------------------------------------
// Prototype of the D-3/D-4 serializer: pure `structuredToCooklang(recipe)` that
// turns a norish FullRecipe-shaped input (flat steps + structured ingredient list
// + per-step ingredient linkage refs) into a valid `.cook` string.
//
// In the REAL phase this lives fork-local in `@norish/shared` and REUSES the
// existing helpers `formatIngredientLinkToken` + `formatUnit` from
// `@norish/shared-react/text/ingredient-links` (see §D-4). Here those helpers are
// vendored/minimised inline so the spike stays a standalone node project outside
// the pnpm workspace graph (cannot affect `pnpm typecheck`).
//
// Key parser facts CONFIRMED against the REAL installed `@cooklang/cooklang@0.18.7`
// (WASM) this session — see 27-EXPERIMENT.md / 27-DECISIONS.md:
//   * steps are separated by a BLANK line (`\n\n`), NOT a single newline — single
//     newlines merge into one step. The serializer MUST emit `\n\n` between steps.
//   * `== Heading ==` is a section; norish `#`-prefixed steps map to it.
//   * ingredient token `@name{qty%unit}`; multiword or amount-less multiword needs
//     `{}`; canonical unit IDs survive verbatim as the opaque `%unit` literal (D-8).
//   * timer `~{qty%unit}` or named `~name{qty%unit}`.
//   * metadata is YAML frontmatter (`---`); the legacy `>> k: v` form is deprecated.
// -----------------------------------------------------------------------------

export type SpikeIngredientRef = {
  /** ingredient display name, e.g. "all-purpose flour" */
  name: string;
  /** structured quantity from recipe_ingredients.amount (may be null: "to taste") */
  amount?: number | string | null;
  /** canonical unit ID from recipe_ingredients.unit, e.g. "gram" (may be null) */
  unit?: string | null;
};

export type SpikeTimerRef = {
  name?: string | null;
  amount: number | string;
  unit: string;
};

export type SpikeStep = {
  /** free-text instruction; a leading `#` marks a section heading (norish convention) */
  text: string;
  order: number;
  /** THE LINKAGE norish lacks today: which ingredients (with amounts) this step uses */
  ingredients: SpikeIngredientRef[];
  timers?: SpikeTimerRef[];
};

export type SpikeRecipe = {
  name: string;
  servings?: number | null;
  prepMinutes?: number | null;
  cookMinutes?: number | null;
  totalMinutes?: number | null;
  source?: string | null;
  /** one `.cook` carries ONE unit system (D-2) — this records which one */
  systemUsed: "metric" | "us";
  steps: SpikeStep[];
};

/** Per-ingredient outcome, surfaced so the AI-backfill experiment can measure quality. */
export type LinkOutcome = {
  stepOrder: number;
  ingredient: string;
  /** "inline" = name found in prose and replaced; "appended" = ref had no textual
   *  anchor so it was appended as a trailing token (garnish/implicit failure mode) */
  placement: "inline" | "appended";
};

export type SerializeResult = {
  cook: string;
  links: LinkOutcome[];
};

// --- vendored/minimised norish helpers (real impl imports these) -------------

/** mirrors normalizeIngredientLinkName from @norish/shared-react */
function normalizeName(name: string): string {
  return name.trim().replace(/\s+/g, " ").toLowerCase();
}

/** format a numeric amount cleanly (mirrors formatTokenAmount) */
function formatAmount(amount: number | string | null | undefined): string {
  if (amount == null || amount === "") return "";
  const n = typeof amount === "string" ? Number(amount) : amount;
  if (!Number.isFinite(n)) return String(amount).trim();
  if (Number.isInteger(n)) return String(n);
  return String(n).replace(/\.?0+$/, "");
}

const SINGLE_WORD_STOP = /[\s@{}\[\]()~#,;:!?.]/;

/**
 * Emit a Cooklang ingredient token `@name{qty%unit}`.
 * Real impl reuses formatIngredientLinkToken's name-sanitisation + formatUnit for
 * the `%unit`; here we emit the CANONICAL unit ID directly (D-8: %unit is opaque,
 * canonical IDs round-trip verbatim; render-time localisation via formatUnit).
 */
export function formatCooklangIngredient(ref: SpikeIngredientRef): string {
  const name = ref.name.trim().replace(/\s+/g, " ").replace(/[@{}~#%]/g, "");
  const amount = formatAmount(ref.amount);
  const unit = ref.unit?.trim() ?? "";
  const isMultiWord = SINGLE_WORD_STOP.test(name);

  if (amount && unit) return `@${name}{${amount}%${unit}}`;
  if (amount) return `@${name}{${amount}}`;
  // no amount ("salt to taste"): single-word bare `@salt`, multiword needs `@a b{}`
  return isMultiWord ? `@${name}{}` : `@${name}`;
}

function formatCooklangTimer(timer: SpikeTimerRef): string {
  const name = timer.name?.trim().replace(/[@{}~#%]/g, "") ?? "";
  const amount = formatAmount(timer.amount);
  const unit = timer.unit.trim();
  return name ? `~${name}{${amount}%${unit}}` : `~{${amount}%${unit}}`;
}

// --- frontmatter -------------------------------------------------------------

function buildFrontmatter(recipe: SpikeRecipe): string {
  const meta: [string, string][] = [];
  if (recipe.name) meta.push(["title", recipe.name]);
  if (recipe.servings != null) meta.push(["servings", String(recipe.servings)]);
  if (recipe.prepMinutes != null) meta.push(["time.prep", `${recipe.prepMinutes} min`]);
  if (recipe.cookMinutes != null) meta.push(["time.cook", `${recipe.cookMinutes} min`]);
  if (recipe.source) meta.push(["source", recipe.source]);
  // D-2: record the single unit system the .cook is written in.
  meta.push(["norish.system", recipe.systemUsed]);
  if (meta.length === 0) return "";
  const body = meta.map(([k, v]) => `${k}: ${quoteYaml(v)}`).join("\n");
  return `---\n${body}\n---\n`;
}

function quoteYaml(v: string): string {
  // servings "4" etc. — quote to keep the value a string and avoid YAML surprises
  return /[:#]/.test(v) || /^\d/.test(v) ? `"${v.replace(/"/g, '\\"')}"` : v;
}

// --- step serialisation ------------------------------------------------------

/**
 * Inline a step's ingredient refs into its prose. For each ref, find the first
 * unconsumed case-insensitive occurrence of its name in the text and replace it
 * with a Cooklang token. Refs with no textual anchor are collected as `appended`
 * (the honest failure mode: garnish / "season with X" where X isn't named).
 */
function serializeStepLine(step: SpikeStep, links: LinkOutcome[]): string {
  let text = step.text;
  const appended: string[] = [];
  // longest names first so "brown sugar" wins over "sugar"
  const refs = [...step.ingredients].sort((a, b) => b.name.length - a.name.length);

  for (const ref of refs) {
    const token = formatCooklangIngredient(ref);
    const idx = findNameIndex(text, ref.name);
    if (idx >= 0) {
      text = text.slice(0, idx) + token + text.slice(idx + ref.name.length);
      links.push({ stepOrder: step.order, ingredient: ref.name, placement: "inline" });
    } else {
      appended.push(token);
      links.push({ stepOrder: step.order, ingredient: ref.name, placement: "appended" });
    }
  }

  for (const timer of step.timers ?? []) {
    const t = formatCooklangTimer(timer);
    // try to anchor onto a bare number+unit mention; else append
    text = text.includes(t) ? text : `${text} ${t}`;
  }

  if (appended.length > 0) {
    text = `${text.trimEnd()} ${appended.join(" ")}`;
  }
  return text.trim();
}

/** case-insensitive, token-consuming, word-ish boundary match of `name` in `text` */
function findNameIndex(text: string, name: string): number {
  const hay = text.toLowerCase();
  const needle = normalizeName(name);
  let from = 0;
  while (true) {
    const i = hay.indexOf(needle, from);
    if (i < 0) return -1;
    const before = i === 0 ? "" : hay[i - 1];
    const after = hay[i + needle.length] ?? "";
    const boundaryBefore = before === "" || /[^a-z0-9]/.test(before);
    const boundaryAfter = after === "" || /[^a-z0-9]/.test(after);
    // don't re-tokenise an already-emitted `@token`
    if (boundaryBefore && boundaryAfter && before !== "@") return i;
    from = i + needle.length;
  }
}

// --- public API --------------------------------------------------------------

export function serializeWithReport(recipe: SpikeRecipe): SerializeResult {
  const links: LinkOutcome[] = [];
  const steps = [...recipe.steps].sort((a, b) => a.order - b.order);
  const lines: string[] = [];

  for (const step of steps) {
    const trimmed = step.text.trim();
    if (trimmed.startsWith("#")) {
      lines.push(`== ${trimmed.replace(/^#+\s*/, "")} ==`);
      continue;
    }
    lines.push(serializeStepLine(step, links));
  }

  const frontmatter = buildFrontmatter(recipe);
  // steps separated by BLANK line so the parser keeps them distinct
  const cook = `${frontmatter}${lines.join("\n\n")}\n`;
  return { cook, links };
}

/** Pure serializer: norish structured recipe → `.cook` string. */
export function structuredToCooklang(recipe: SpikeRecipe): string {
  return serializeWithReport(recipe).cook;
}
