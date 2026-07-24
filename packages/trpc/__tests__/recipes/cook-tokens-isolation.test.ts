// @vitest-environment node
/**
 * COOK-01 / Phase 27 W2 — per-cookbook isolation of `cookSource` + `cookTokens`
 * (HOUSE-06 / POLICY-01). SECURITY-CRITICAL.
 *
 * W2 is the first Cooklang wave that puts data on a permission-scoped path, so the
 * gate W1 legitimately recorded as N/A is back in force. The `.cook` is a lossless
 * re-encoding of `steps` + `recipe_ingredients` — the same response already carries
 * that data — but it is a NEW ENCODING on a NEW field, and a field that rides out
 * of the wrong procedure is content disclosure, not merely an authz slip.
 *
 * THE BOUNDARY IS NOT MOCKED. `canAccessResource` and `resolveRecipeCookbookPolicy`
 * are the REAL implementations; only their data sources (the household policy row
 * and the server-config row) are mocked. `withCookTokens` has no authorization of
 * its own — its POSITION below the guard is the whole control — so these tests
 * exist to pin that position.
 *
 * EVERY policy-seeded case has a `view: "everyone"` sibling (AGENTS.md). `everyone`
 * is the LIVE production policy and it answers "who may fetch this if they ask"
 * WITHIN the recipe's cookbook; it never widens a read past the cookbook. All three
 * historical leaks (REALTIME-ISO-01, IMPORT-DEDUP-ISO-01, LIST-ISO-01) survived a
 * green suite that only seeded `view: "household"`.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

import type { RecipePermissionPolicy } from "@norish/config/zod/server-config";

import { createMockFullRecipe } from "./test-utils";

const SECRET_COOK_SOURCE = [
  "---",
  "title: Grandma's Secret Stollen",
  "norish.system: metric",
  "---",
  "Fold the @marzipan{200%gram} into the @dough{1%piece} with the secret spice.",
  "",
].join("\n");

const getRecipeFullMock = vi.hoisted(() => vi.fn());
const getRecipeOwnerAndHouseholdMock = vi.hoisted(() => vi.fn());
const getHouseholdPolicyMock = vi.hoisted(() => vi.fn());
const getConfigMock = vi.hoisted(() => vi.fn());
const parseCookSourceSpy = vi.hoisted(() => vi.fn());

vi.mock("@norish/db", () => ({
  getRecipeFull: getRecipeFullMock,
  getRecipeOwnerAndHousehold: getRecipeOwnerAndHouseholdMock,
}));

vi.mock("@norish/db/repositories/households", () => ({
  getHouseholdForUser: vi.fn(),
  getHouseholdPolicy: getHouseholdPolicyMock,
}));

vi.mock("@norish/db/repositories/server-config", () => ({
  getConfig: getConfigMock,
}));

vi.mock("@norish/shared-server/config/server-config-loader", () => ({
  getUnits: () => Promise.resolve({}),
  getRecipePermissionPolicy: vi.fn(() => Promise.resolve({ view: "household" })),
}));

// The parse util is SPIED, not stubbed: it delegates to the real parser so a
// permitted read gets real tokens, while a denied read can be proven never to have
// reached it. (An unauthorized request must not even cause a parse.)
vi.mock("@norish/shared-server/cooklang/parse", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@norish/shared-server/cooklang/parse")>();

  return {
    ...actual,
    parseCookSource: (...args: Parameters<typeof actual.parseCookSource>) => {
      parseCookSourceSpy(...args);

      return actual.parseCookSource(...args);
    },
  };
});

vi.mock("@norish/shared-server/logger", () => ({
  parserLogger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
  trpcLogger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
  createLogger: () => ({ debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }),
}));

vi.mock("@norish/trpc/routers/recipes/emitter", () => ({
  recipeEmitter: { emit: vi.fn(), emitToHousehold: vi.fn(), emitToUser: vi.fn() },
}));

vi.mock("../../src/helpers", () => ({
  emitByPolicy: vi.fn(),
  resolveRecipeRealtimeScope: vi.fn((_recipeId: string, fallback: unknown) =>
    Promise.resolve({ viewPolicy: "household", ctx: fallback })
  ),
  resolveHouseholdRealtimeScope: vi.fn((householdId: string | null, fallback: { userId: string }) =>
    Promise.resolve({
      viewPolicy: "household",
      ctx: { userId: fallback.userId, householdKey: householdId ?? fallback.userId },
    })
  ),
}));

// Import the REAL helpers (which call the REAL canAccessResource) after the mocks.
const { assertRecipeAccess, findRecipeForViewer } = await import("../../src/routers/recipes/helpers");

const GLOBAL_DEFAULT: RecipePermissionPolicy = {
  view: "everyone",
  edit: "household",
  delete: "household",
};

function policy(p: Partial<RecipePermissionPolicy>): RecipePermissionPolicy {
  return {
    view: p.view ?? "everyone",
    edit: p.edit ?? "household",
    delete: p.delete ?? "household",
  };
}

function setCookbookPolicy(p: Partial<RecipePermissionPolicy>, adminUserId: string): void {
  getHouseholdPolicyMock.mockResolvedValue({ policy: policy(p), adminUserId });
}

/** The recipe under test: in cookbook A, owned by `owner-id`, carrying a `.cook`. */
function cookedRecipeInCookbookA() {
  return createMockFullRecipe({
    id: "recipe-in-a",
    userId: "owner-id",
    householdId: "cookbook-a",
    cookSource: SECRET_COOK_SOURCE,
  });
}

const OWNER = { user: { id: "owner-id" }, memberHouseholdIds: ["cookbook-a"], isServerAdmin: false };
const MEMBER_OF_A = {
  user: { id: "member-of-a" },
  memberHouseholdIds: ["cookbook-a"],
  isServerAdmin: false,
};
/** A real user, in a real cookbook — just not this one. */
const MEMBER_OF_B = {
  user: { id: "member-of-b" },
  memberHouseholdIds: ["cookbook-b"],
  isServerAdmin: false,
};

/** Assert that nothing anywhere in `value` leaks the recipe's `.cook` or its tokens. */
function expectNoCookLeak(value: unknown): void {
  const serialized = JSON.stringify(value ?? null);

  expect(serialized).not.toContain("marzipan");
  expect(serialized).not.toContain("Secret Stollen");
  expect(serialized).not.toContain("%gram");
  expect(serialized).not.toContain("cookTokens");
}

describe("cookSource / cookTokens per-cookbook isolation (HOUSE-06, POLICY-01)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getConfigMock.mockResolvedValue(GLOBAL_DEFAULT);
    getRecipeFullMock.mockResolvedValue(cookedRecipeInCookbookA());
    getRecipeOwnerAndHouseholdMock.mockResolvedValue({
      userId: "owner-id",
      householdId: "cookbook-a",
    });
  });

  // Both policies are exercised for EVERY case below. `everyone` is what production
  // actually runs; `household` is the historically-tested value.
  for (const view of ["household", "everyone"] as const) {
    describe(`with the recipe's cookbook at view: "${view}"`, () => {
      beforeEach(() => {
        setCookbookPolicy({ view }, "cookbook-a-admin");
      });

      it("gives the OWNER the cookSource and a non-null cookTokens", async () => {
        const recipe = await findRecipeForViewer(OWNER, "recipe-in-a");

        expect(recipe).not.toBeNull();
        expect(recipe!.cookSource).toBe(SECRET_COOK_SOURCE);
        expect(recipe!.cookTokens).not.toBeNull();
        expect(
          recipe!.cookTokens!.flatMap((step) =>
            step.tokens.filter((t) => t.type === "ingredient").map((t) => t.name)
          )
        ).toContain("marzipan");
      });

      it("gives a MEMBER of the recipe's cookbook the cookSource and cookTokens", async () => {
        const recipe = await findRecipeForViewer(MEMBER_OF_A, "recipe-in-a");

        expect(recipe).not.toBeNull();
        expect(recipe!.cookSource).toBe(SECRET_COOK_SOURCE);
        expect(recipe!.cookTokens).not.toBeNull();
      });

      it("denies a member of an UNRELATED cookbook and leaks neither the .cook nor a token", async () => {
        const recipe = await findRecipeForViewer(MEMBER_OF_B, "recipe-in-a");

        // `recipes.get` turns this null into NOT_FOUND.
        expect(recipe).toBeNull();
        expectNoCookLeak(recipe);
      });

      it("denies a total stranger with no cookbook at all", async () => {
        const recipe = await findRecipeForViewer(
          { user: { id: "stranger" }, memberHouseholdIds: [], isServerAdmin: false },
          "recipe-in-a"
        );

        expect(recipe).toBeNull();
        expectNoCookLeak(recipe);
      });

      it("does NOT even PARSE the .cook for a denied viewer", async () => {
        await findRecipeForViewer(MEMBER_OF_B, "recipe-in-a");

        // The parse must sit below the guard: an unauthorized request must not be
        // able to spend server CPU on the WASM parser, let alone receive the result.
        expect(parseCookSourceSpy).not.toHaveBeenCalled();
      });

      it("DOES parse the .cook for a permitted viewer (the spy is wired correctly)", async () => {
        await findRecipeForViewer(MEMBER_OF_A, "recipe-in-a");

        expect(parseCookSourceSpy).toHaveBeenCalledTimes(1);
      });
    });
  }

  describe("view=everyone is never 'no boundary' (AGENTS.md)", () => {
    it("does not turn the token projection into an unscoped read", async () => {
      // The exact mistake behind LIST-ISO-01: treating `everyone` as unfiltered.
      setCookbookPolicy({ view: "everyone" }, "cookbook-a-admin");

      expect(await findRecipeForViewer(MEMBER_OF_B, "recipe-in-a")).toBeNull();
      expect(parseCookSourceSpy).not.toHaveBeenCalled();
    });

    it("still serves the recipe's OWN cookbook members", async () => {
      setCookbookPolicy({ view: "everyone" }, "cookbook-a-admin");

      const recipe = await findRecipeForViewer(MEMBER_OF_A, "recipe-in-a");

      expect(recipe?.cookTokens).not.toBeNull();
    });
  });

  describe("a recipe with no .cook is unaffected", () => {
    it("returns cookSource: null and cookTokens: null without parsing", async () => {
      setCookbookPolicy({ view: "household" }, "cookbook-a-admin");
      getRecipeFullMock.mockResolvedValue(
        createMockFullRecipe({ id: "recipe-in-a", userId: "owner-id", householdId: "cookbook-a" })
      );

      const recipe = await findRecipeForViewer(MEMBER_OF_A, "recipe-in-a");

      expect(recipe!.cookSource).toBeNull();
      expect(recipe!.cookTokens).toBeNull();
      expect(parseCookSourceSpy).not.toHaveBeenCalled();
    });
  });

  describe("getEditable — the same treatment for `edit` rights", () => {
    for (const view of ["household", "everyone"] as const) {
      it(`FORBIDs a view-but-not-edit viewer under view: "${view}"`, async () => {
        // The recipe's cookbook grants view broadly but restricts edit to the OWNER,
        // so a plain member of cookbook A may see it and may NOT edit it.
        setCookbookPolicy({ view, edit: "owner" }, "cookbook-a-admin");

        // Sanity: this user CAN view it — so a FORBIDDEN below is about edit alone.
        expect(await findRecipeForViewer(MEMBER_OF_A, "recipe-in-a")).not.toBeNull();
        parseCookSourceSpy.mockClear();

        await expect(assertRecipeAccess(MEMBER_OF_A, "recipe-in-a", "edit")).rejects.toMatchObject({
          code: "FORBIDDEN",
        });

        // `getEditableProcedure` calls `withCookTokens` only AFTER this gate, so a
        // rejected edit never produces tokens.
        expect(parseCookSourceSpy).not.toHaveBeenCalled();
      });

      it(`FORBIDs a member of an unrelated cookbook under view: "${view}"`, async () => {
        setCookbookPolicy({ view, edit: "household" }, "cookbook-a-admin");

        await expect(assertRecipeAccess(MEMBER_OF_B, "recipe-in-a", "edit")).rejects.toMatchObject({
          code: "FORBIDDEN",
        });
        expect(parseCookSourceSpy).not.toHaveBeenCalled();
      });

      it(`lets the OWNER edit under view: "${view}"`, async () => {
        setCookbookPolicy({ view, edit: "owner" }, "cookbook-a-admin");

        await expect(assertRecipeAccess(OWNER, "recipe-in-a", "edit")).resolves.toBeUndefined();
      });
    }

    it("does not leak the .cook through the thrown error payload", async () => {
      setCookbookPolicy({ view: "everyone", edit: "owner" }, "cookbook-a-admin");

      const error = await assertRecipeAccess(MEMBER_OF_B, "recipe-in-a", "edit").then(
        () => null,
        (err: unknown) => err
      );

      expect(error).not.toBeNull();
      expectNoCookLeak({
        message: (error as Error).message,
        ...(error as Record<string, unknown>),
      });
    });
  });
});
