// @vitest-environment node

import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

describe("PublicSmartInstruction boundary", () => {
  it("does not import authenticated hooks or private recipe context", () => {
    const file = readFileSync(
      path.resolve(process.cwd(), "components/recipe/public-smart-instruction.tsx"),
      "utf8"
    );

    expect(file).not.toContain("@/hooks/config");
    expect(file).not.toContain("@/context/user-context");
    expect(file).not.toContain("useRecipeContext");
  });

  // Phase 27 W4, T5 (D-27-W4-08 re-assertion, "not by inspection"): the
  // public share page keeps the legacy renderer. `PublicSmartInstruction`
  // never gains the cook-token machinery, and `ShareRecipeSteps` — its only
  // caller — never passes a `cookSteps` prop to `ReadonlyStepsList`, so
  // `useCookBranch` in that component is false by construction on the
  // public path, whatever a recipe's own `cookTokens` contain.
  it("never references the cook-token render model (cookStepToMarkdown/cookStepTimers/cookStep)", () => {
    const file = readFileSync(
      path.resolve(process.cwd(), "components/recipe/public-smart-instruction.tsx"),
      "utf8"
    );

    expect(file).not.toContain("@norish/shared/cooklang");
    expect(file).not.toContain("cookStep");
  });

  it("ShareRecipeSteps never passes cookSteps to ReadonlyStepsList — the public path stays on the legacy branch", () => {
    const file = readFileSync(
      path.resolve(process.cwd(), "app/share/[token]/components/share-recipe-steps.tsx"),
      "utf8"
    );

    expect(file).not.toContain("cookSteps");
    expect(file).not.toContain("cookTokens");
  });
});
