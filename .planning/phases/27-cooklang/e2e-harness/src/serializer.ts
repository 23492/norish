// SPIKE — Phase 27 (COOK-01). Pure structured→.cook serializer.
// -----------------------------------------------------------------------------
// This is a copy of the validated `spike/structured-to-cooklang.ts` (the D-3/D-4
// pure serializer). In the real phase it lives fork-local in `@norish/shared` and
// reuses `formatIngredientLinkToken` + `formatUnit` from `@norish/shared-react`.
// It is duplicated here (not imported across dirs) so the harness stays a fully
// standalone node project outside the pnpm workspace graph.
//
// Confirmed parser facts (see 27-DECISIONS.md, re-verified this session):
//   * steps are separated by a BLANK line (`\n\n`); single newlines merge steps.
//   * `== Heading ==` = section; norish `#`-prefixed steps map to it.
//   * ingredient token `@name{qty%unit}`; multiword/amount-less multiword needs `{}`.
//   * canonical unit IDs (`gram`, `tablespoon`) survive VERBATIM as the opaque
//     `%unit` literal — BUT ONLY when the recipe is parsed WITHOUT a scale arg
//     (`parse(src)`); `parse(src, 1)` normalizes `gram`→`g`. The harness parses
//     without scale to preserve D-8 round-trip.
//   * timer `~{qty%unit}` or named `~name{qty%unit}`.
// -----------------------------------------------------------------------------

export type IngredientRef = {
  name: string;
  amount?: number | string | null;
  unit?: string | null;
};

export type TimerRef = {
  name?: string | null;
  amount: number | string;
  unit: string;
};

export type SerStep = {
  text: string;
  order: number;
  ingredients: IngredientRef[];
  timers?: TimerRef[];
};

export type SerRecipe = {
  name: string;
  servings?: number | null;
  prepMinutes?: number | null;
  cookMinutes?: number | null;
  totalMinutes?: number | null;
  source?: string | null;
  systemUsed: "metric" | "us";
  steps: SerStep[];
};

export type LinkOutcome = {
  stepOrder: number;
  ingredient: string;
  placement: "inline" | "appended";
};

export type SerializeResult = {
  cook: string;
  links: LinkOutcome[];
};

function normalizeName(name: string): string {
  return name.trim().replace(/\s+/g, " ").toLowerCase();
}

function formatAmount(amount: number | string | null | undefined): string {
  if (amount == null || amount === "") return "";
  const n = typeof amount === "string" ? Number(amount) : amount;
  if (!Number.isFinite(n)) return String(amount).trim();
  if (Number.isInteger(n)) return String(n);
  return String(n).replace(/\.?0+$/, "");
}

const SINGLE_WORD_STOP = /[\s@{}\[\]()~#,;:!?.]/;

export function formatCooklangIngredient(ref: IngredientRef): string {
  const name = ref.name.trim().replace(/\s+/g, " ").replace(/[@{}~#%]/g, "");
  const amount = formatAmount(ref.amount);
  const unit = ref.unit?.trim() ?? "";
  const isMultiWord = SINGLE_WORD_STOP.test(name);

  if (amount && unit) return `@${name}{${amount}%${unit}}`;
  if (amount) return `@${name}{${amount}}`;
  return isMultiWord ? `@${name}{}` : `@${name}`;
}

function formatCooklangTimer(timer: TimerRef): string {
  const name = timer.name?.trim().replace(/[@{}~#%]/g, "") ?? "";
  const amount = formatAmount(timer.amount);
  const unit = timer.unit.trim();
  return name ? `~${name}{${amount}%${unit}}` : `~{${amount}%${unit}}`;
}

function buildFrontmatter(recipe: SerRecipe): string {
  const meta: [string, string][] = [];
  if (recipe.name) meta.push(["title", recipe.name]);
  if (recipe.servings != null) meta.push(["servings", String(recipe.servings)]);
  if (recipe.prepMinutes != null) meta.push(["time.prep", `${recipe.prepMinutes} min`]);
  if (recipe.cookMinutes != null) meta.push(["time.cook", `${recipe.cookMinutes} min`]);
  if (recipe.source) meta.push(["source", recipe.source]);
  meta.push(["norish.system", recipe.systemUsed]);
  if (meta.length === 0) return "";
  const body = meta.map(([k, v]) => `${k}: ${quoteYaml(v)}`).join("\n");
  return `---\n${body}\n---\n`;
}

function quoteYaml(v: string): string {
  return /[:#]/.test(v) || /^\d/.test(v) ? `"${v.replace(/"/g, '\\"')}"` : v;
}

function serializeStepLine(step: SerStep, links: LinkOutcome[]): string {
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
    text = text.includes(t) ? text : `${text} ${t}`;
  }

  if (appended.length > 0) {
    text = `${text.trimEnd()} ${appended.join(" ")}`;
  }
  return text.trim();
}

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
    if (boundaryBefore && boundaryAfter && before !== "@") return i;
    from = i + needle.length;
  }
}

export function serializeWithReport(recipe: SerRecipe): SerializeResult {
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
  const cook = `${frontmatter}${lines.join("\n\n")}\n`;
  return { cook, links };
}

export function structuredToCooklang(recipe: SerRecipe): string {
  return serializeWithReport(recipe).cook;
}
