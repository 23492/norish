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
 *
 * EVERY OWNERSHIP SHAPE IS COVERED, not just the household one. A first pass seeded
 * `householdId: "cookbook-a"` on every fixture, which left the PERSONAL-recipe
 * (`household_id IS NULL`) branch of `findRecipeForViewer` — a whole arm of the
 * access check — unexecuted, and `getEditable` was asserted through
 * `assertRecipeAccess` standalone, which can never see the PROCEDURE's own ordering.
 * So: personal (denied stranger AND permitted owner — a suite that only denies is
 * satisfied by denying everyone), orphaned (`userId: null`), household, and
 * `getEditable` driven through the real `recipesProcedures` caller.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

import type { RecipePermissionPolicy } from "@norish/config/zod/server-config";
import type { FullRecipeDTO } from "@norish/shared/contracts";

import { createMockFullRecipe, createMockUser } from "./test-utils";

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
const getUserHouseholdIdsMock = vi.hoisted(() => vi.fn());
const getConfigMock = vi.hoisted(() => vi.fn());
const parseCookSourceSpy = vi.hoisted(() => vi.fn());

// `getEditable` is exercised through the REAL `recipesProcedures` router (its own
// wiring — the ORDER of `assertRecipeAccess` and `withCookTokens` — is what these
// tests pin), so the rest of the `@norish/db` surface `recipes.ts` imports has to
// stay real. Only the two reads the boundary depends on are swapped for fixtures.
vi.mock("@norish/db", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@norish/db")>();

  return {
    ...actual,
    getRecipeFull: getRecipeFullMock,
    getRecipeOwnerAndHousehold: getRecipeOwnerAndHouseholdMock,
  };
});

vi.mock("@norish/db/repositories/households", () => ({
  getHouseholdForUser: vi.fn(),
  getHouseholdPolicy: getHouseholdPolicyMock,
  // `authedProcedure`'s withAuth middleware resolves membership from here.
  getUserHouseholdIds: getUserHouseholdIdsMock,
}));

// withAuth falls back to the household cache when ctx.household is null (the
// no-cookbook viewers below); keep it off the real Redis/DB path.
vi.mock("@norish/shared-server/cache/household", () => ({
  getCachedHouseholdForUser: vi.fn(() => Promise.resolve(null)),
  invalidateHouseholdCache: vi.fn(),
  invalidateHouseholdCacheForUsers: vi.fn(),
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
const { findRecipeForViewer } = await import("../../src/routers/recipes/helpers");
// …and the REAL router, so `getEditable` is driven through the procedure itself
// rather than through the helper it happens to call.
const { recipesProcedures } = await import("../../src/routers/recipes/recipes");

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

/** Seed the SERVER-WIDE default policy — the one a PERSONAL recipe resolves to. */
function setGlobalPolicy(p: Partial<RecipePermissionPolicy>): void {
  getConfigMock.mockResolvedValue(policy(p));
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

/**
 * A PERSONAL recipe: `householdId: null`. This is an entirely separate branch of
 * the access check — `resolveRecipeCookbookPolicy(null)` falls back to the
 * SERVER-WIDE policy and `canAccessResource` denies the `household`/`everyone`
 * branch outright, so a personal recipe is owner-only. Nothing about the `.cook`
 * may change that.
 */
function personalCookedRecipe() {
  return createMockFullRecipe({
    id: "personal-recipe",
    userId: "owner-id",
    householdId: null,
    cookSource: SECRET_COOK_SOURCE,
  });
}

/** An ORPHANED recipe: `userId: null` — no owner, so there is no owner to gate on. */
function orphanCookedRecipe() {
  return createMockFullRecipe({
    id: "orphan-recipe",
    userId: null,
    householdId: null,
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
/** A logged-in user with no cookbook at all. */
const STRANGER = { user: { id: "stranger" }, memberHouseholdIds: [], isServerAdmin: false };

type Viewer = typeof OWNER;

const RECIPE_IN_A_UUID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

/** `getEditable` validates its output against `FullRecipeSchema`, so the fixture must satisfy it. */
function schemaValidCookedRecipe(overrides: Partial<FullRecipeDTO> = {}): FullRecipeDTO {
  return createMockFullRecipe({
    id: RECIPE_IN_A_UUID,
    userId: "owner-id",
    householdId: "cookbook-a",
    cookSource: SECRET_COOK_SOURCE,
    notes: "",
    version: 1,
    tags: [{ name: "dinner", version: 1 }],
    recipeIngredients: [
      {
        id: "44444444-4444-4444-8444-444444444444",
        ingredientId: "55555555-5555-4555-8555-555555555555",
        ingredientName: "Flour",
        amount: 200,
        unit: "g",
        systemUsed: "metric",
        order: 0,
        version: 1,
      },
    ],
    steps: [{ step: "Mix all ingredients", systemUsed: "metric", order: 0, images: [], version: 1 }],
    author: { id: "owner-id", name: "Recipe Owner", image: null, version: 1 },
    ...overrides,
  });
}

/**
 * Drive the REAL `getEditable` procedure as `viewer`. The withAuth middleware
 * re-derives `memberHouseholdIds` from `getUserHouseholdIds`, so membership is
 * seeded there rather than on the context object.
 */
function editableCaller(viewer: Viewer) {
  getUserHouseholdIdsMock.mockResolvedValue(viewer.memberHouseholdIds);

  const householdId = viewer.memberHouseholdIds[0] ?? null;

  return recipesProcedures.createCaller({
    user: createMockUser({ id: viewer.user.id, isServerAdmin: viewer.isServerAdmin }),
    household: householdId
      ? { id: householdId, name: householdId, users: [{ id: viewer.user.id, name: "Viewer" }] }
      : null,
    connectionId: null,
    multiplexer: null,
    operationId: null,
  });
}

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
        const recipe = await findRecipeForViewer(STRANGER, "recipe-in-a");

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

  /**
   * PERSONAL recipes (`household_id IS NULL`) are a SEPARATE branch of
   * `findRecipeForViewer` and of `canAccessResource`: the cookbook policy is the
   * server-wide one and the `household`/`everyone` branch denies outright, so the
   * recipe is owner-only. The suite used to seed `householdId: "cookbook-a"`
   * everywhere, which left that branch — and therefore a whole class of `.cook`
   * disclosure — completely untested.
   */
  describe("a PERSONAL recipe (householdId: null) is owner-only", () => {
    // A personal recipe resolves the SERVER-WIDE policy, so THAT is what is seeded
    // here; `everyone` is the live production value (AGENTS.md).
    for (const view of ["household", "everyone"] as const) {
      describe(`with the server-wide policy at view: "${view}"`, () => {
        beforeEach(() => {
          setGlobalPolicy({ view });
          getRecipeFullMock.mockResolvedValue(personalCookedRecipe());
          getRecipeOwnerAndHouseholdMock.mockResolvedValue({
            userId: "owner-id",
            householdId: null,
          });
        });

        it("gives the OWNER the cookSource and a non-null cookTokens", async () => {
          const recipe = await findRecipeForViewer(OWNER, "personal-recipe");

          expect(recipe).not.toBeNull();
          expect(recipe!.cookSource).toBe(SECRET_COOK_SOURCE);
          expect(recipe!.cookTokens).not.toBeNull();
          expect(
            recipe!.cookTokens!.flatMap((step) =>
              step.tokens.filter((t) => t.type === "ingredient").map((t) => t.name)
            )
          ).toContain("marzipan");
        });

        it("denies a STRANGER and leaks neither the .cook nor a token", async () => {
          const recipe = await findRecipeForViewer(STRANGER, "personal-recipe");

          expect(recipe).toBeNull();
          expectNoCookLeak(recipe);
        });

        it("denies a member of an unrelated cookbook", async () => {
          const recipe = await findRecipeForViewer(MEMBER_OF_B, "personal-recipe");

          expect(recipe).toBeNull();
          expectNoCookLeak(recipe);
        });

        it("does NOT even PARSE a personal recipe's .cook for a denied stranger", async () => {
          await findRecipeForViewer(STRANGER, "personal-recipe");

          expect(parseCookSourceSpy).not.toHaveBeenCalled();
        });
      });
    }
  });

  /**
   * An ORPHANED recipe (`user_id IS NULL`) has no owner to gate on, so both
   * `findRecipeForViewer` and `assertRecipeAccess` skip the permission check by
   * design. That is pre-existing behaviour; it is pinned here so that the `.cook`
   * riding along on that branch is a DELIBERATE, visible property rather than an
   * accident nobody has ever asserted.
   */
  describe("an ORPHANED recipe (userId: null) keeps its documented ownerless behaviour", () => {
    for (const view of ["household", "everyone"] as const) {
      it(`serves the .cook with no permission check under view: "${view}"`, async () => {
        setGlobalPolicy({ view });
        setCookbookPolicy({ view }, "cookbook-a-admin");
        getRecipeFullMock.mockResolvedValue(orphanCookedRecipe());
        getRecipeOwnerAndHouseholdMock.mockResolvedValue({ userId: null, householdId: null });

        const recipe = await findRecipeForViewer(STRANGER, "orphan-recipe");

        expect(recipe).not.toBeNull();
        expect(recipe!.cookSource).toBe(SECRET_COOK_SOURCE);
        expect(recipe!.cookTokens).not.toBeNull();
        // No owner means no policy lookup at all — the ownerless branch returns early.
        expect(getHouseholdPolicyMock).not.toHaveBeenCalled();
      });
    }
  });

  describe("a recipe with no .cook is unaffected", () => {
    for (const view of ["household", "everyone"] as const) {
      it(`returns cookSource: null and cookTokens: null without parsing under view: "${view}"`, async () => {
        setCookbookPolicy({ view }, "cookbook-a-admin");
        getRecipeFullMock.mockResolvedValue(
          createMockFullRecipe({ id: "recipe-in-a", userId: "owner-id", householdId: "cookbook-a" })
        );

        const recipe = await findRecipeForViewer(MEMBER_OF_A, "recipe-in-a");

        expect(recipe!.cookSource).toBeNull();
        expect(recipe!.cookTokens).toBeNull();
        expect(parseCookSourceSpy).not.toHaveBeenCalled();
      });
    }
  });

  /**
   * `getEditable` is driven through the REAL procedure, not through the helper it
   * happens to call. The invariant under test is the procedure's OWN wiring — that
   * `withCookTokens` sits strictly BELOW `assertRecipeAccess(..., "edit")` at that
   * call site. Asserting on `assertRecipeAccess` standalone can never see that
   * ordering, so it left the call site unpinned.
   */
  describe("getEditable — the same treatment for `edit` rights, through the procedure", () => {
    beforeEach(() => {
      getRecipeFullMock.mockResolvedValue(schemaValidCookedRecipe());
      getRecipeOwnerAndHouseholdMock.mockResolvedValue({
        userId: "owner-id",
        householdId: "cookbook-a",
      });
    });

    for (const view of ["household", "everyone"] as const) {
      it(`FORBIDs a view-but-not-edit viewer under view: "${view}"`, async () => {
        // The recipe's cookbook grants view broadly but restricts edit to the OWNER,
        // so a plain member of cookbook A may see it and may NOT edit it.
        setCookbookPolicy({ view, edit: "owner" }, "cookbook-a-admin");

        // Sanity: this user CAN view it — so a FORBIDDEN below is about edit alone.
        expect(await findRecipeForViewer(MEMBER_OF_A, RECIPE_IN_A_UUID)).not.toBeNull();
        parseCookSourceSpy.mockClear();

        await expect(
          editableCaller(MEMBER_OF_A).getEditable({ id: RECIPE_IN_A_UUID })
        ).rejects.toMatchObject({ code: "FORBIDDEN" });

        // `getEditableProcedure` calls `withCookTokens` only AFTER this gate, so a
        // rejected edit never produces tokens — and never spends the WASM parser.
        expect(parseCookSourceSpy).not.toHaveBeenCalled();
      });

      it(`FORBIDs a member of an unrelated cookbook under view: "${view}"`, async () => {
        setCookbookPolicy({ view, edit: "household" }, "cookbook-a-admin");

        await expect(
          editableCaller(MEMBER_OF_B).getEditable({ id: RECIPE_IN_A_UUID })
        ).rejects.toMatchObject({ code: "FORBIDDEN" });
        expect(parseCookSourceSpy).not.toHaveBeenCalled();
      });

      it(`FORBIDs a stranger on a PERSONAL recipe under view: "${view}"`, async () => {
        setGlobalPolicy({ view, edit: view });
        getRecipeFullMock.mockResolvedValue(
          schemaValidCookedRecipe({ householdId: null, author: undefined })
        );
        getRecipeOwnerAndHouseholdMock.mockResolvedValue({ userId: "owner-id", householdId: null });

        await expect(
          editableCaller(STRANGER).getEditable({ id: RECIPE_IN_A_UUID })
        ).rejects.toMatchObject({ code: "FORBIDDEN" });
        expect(parseCookSourceSpy).not.toHaveBeenCalled();
      });

      it(`lets the OWNER edit — and gives them the cookSource + cookTokens — under view: "${view}"`, async () => {
        setCookbookPolicy({ view, edit: "owner" }, "cookbook-a-admin");

        const recipe = await editableCaller(OWNER).getEditable({ id: RECIPE_IN_A_UUID });

        expect(recipe.cookSource).toBe(SECRET_COOK_SOURCE);
        expect(recipe.cookTokens).not.toBeNull();
        expect(parseCookSourceSpy).toHaveBeenCalledTimes(1);
      });
    }

    it("does not leak the .cook through the thrown error payload", async () => {
      setCookbookPolicy({ view: "everyone", edit: "owner" }, "cookbook-a-admin");

      const error = await editableCaller(MEMBER_OF_B)
        .getEditable({ id: RECIPE_IN_A_UUID })
        .then(
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
