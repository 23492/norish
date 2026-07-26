// @vitest-environment node
/**
 * COOK-01 / Phase 27 W3 — per-cookbook isolation of a MINTED `.cook`, proven at the
 * WRITE and EMIT end (HOUSE-06 / POLICY-01). SECURITY-CRITICAL.
 *
 * W2's `packages/trpc/__tests__/recipes/cook-tokens-isolation.test.ts` proved the READ
 * boundary against a hand-seeded `cook_source`. W3 is the wave where a `cook_source`
 * first ARRIVES — through a background worker that also PUSHES a realtime event — so the
 * boundary has to be re-proven on the producing side. A read guard cannot help with a
 * push: `emitByPolicy` decides who receives the recipe, and nobody asked to receive it.
 *
 * THE BOUNDARY IS NOT MOCKED. `resolveHouseholdRealtimeScope`, `resolveRecipeRealtimeScope`
 * and `emitByPolicy` are the REAL implementations from
 * `@norish/shared-server/realtime/policy`; only their data sources (the cookbook policy
 * row, the recipe's owner row and the server-config row) are fixtures. The `.cook` under
 * test is minted by the REAL `buildCookPayload` — real serializer, real WASM parser, real
 * `CookTokensDTO` — so the leak assertions run against real token text rather than a
 * hand-written stand-in. `RecipeDashboardSchema` is the real contract schema.
 *
 * EVERY policy-seeded case has a `view: "everyone"` sibling (AGENTS.md). `everyone` is the
 * LIVE server policy and it answers "who may fetch this if they ask" WITHIN the recipe's
 * cookbook — it never widens a PUSH, a write or a list past the cookbook. FOUR separate
 * cross-cookbook leaks (Phases 22, 22.1, 22.2, 22.3) all survived a green isolation suite
 * that seeded only `view: "household"`. Phase 22.4 changed the shipped default to
 * `household`, which makes the `everyone` sibling the regression proof rather than the
 * production case — it is still mandatory.
 *
 * EVERY OWNERSHIP SHAPE IS COVERED, because W2's own verification found that its first
 * isolation pass seeded `householdId: "cookbook-a"` on every fixture and so never executed
 * the personal-recipe branch: a cookbook import, a PERSONAL import (`household_id IS
 * NULL`) and the `userId: null` orphan branch each get their own cases.
 */

import type { Job } from "bullmq";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { RecipePermissionPolicy } from "@norish/config/zod/server-config";
import type { RecipeCookPayload } from "@norish/db";
import type { CookPayload } from "@norish/shared-server/cooklang/build-payload";
import type { FullRecipeInsertDTO } from "@norish/shared/contracts/dto/recipe";
import type { StructuredRecipe } from "@norish/shared/cooklang";
import { RecipeDashboardSchema } from "@norish/shared/contracts/zod";

import type { RecipeImportJobData } from "../../src/contracts/job-types";

// `recipes.id` and `households.id` are `uuid` columns and `RecipeDashboardSchema` is
// derived from the drizzle model, so the DTO only parses with real UUIDs here.
const COOKBOOK_A = "a1111111-1111-4111-8111-111111111111";
const COOKBOOK_B = "b1111111-1111-4111-8111-111111111111";
const USER_IN_A = "user-in-a";
const MEMBER_OF_B = "member-of-b";
/** A logged-in user with no cookbook at all. */
const STRANGER = "stranger";
const PERSONAL_USER = "personal-importer";

const RECIPE_IN_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const RECIPE_IN_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const PERSONAL_RECIPE = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const ORPHAN_RECIPE = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";

const IMPORT_URL = "https://example.com/stollen";

const mockCreateLazyWorker = vi.hoisted(() => vi.fn());
const mockCreateRecipeWithRefs = vi.hoisted(() => vi.fn());
const mockGetHouseholdPolicy = vi.hoisted(() => vi.fn());
const mockGetRecipeOwnerAndHousehold = vi.hoisted(() => vi.fn());
const mockGetRecipePermissionPolicy = vi.hoisted(() => vi.fn());
const mockParseRecipeFromUrl = vi.hoisted(() => vi.fn());
const mockRecipeExistsByUrlForPolicy = vi.hoisted(() => vi.fn());

/** Every realtime delivery this suite causes, in order, with its full payload. */
type RecordedEmit = {
  method: "broadcast" | "emitToHousehold" | "emitToUser";
  key: string | null;
  event: string;
  payload: unknown;
};
const recorded = vi.hoisted(() => [] as RecordedEmit[]);

// ---------------------------------------------------------------------------
// The emitter surface is recorded, never reached: `emitByPolicy` (the boundary)
// stays real, and this is the only place a delivery can be observed.
// ---------------------------------------------------------------------------
vi.mock("@norish/shared-server/realtime/recipes", () => ({
  recipeEmitter: {
    broadcast: (event: string, payload: unknown) => {
      recorded.push({ method: "broadcast", key: null, event, payload });

      return Promise.resolve(true);
    },
    emitToHousehold: (key: string, event: string, payload: unknown) => {
      recorded.push({ method: "emitToHousehold", key, event, payload });

      return Promise.resolve(true);
    },
    emitToUser: (key: string, event: string, payload: unknown) => {
      recorded.push({ method: "emitToUser", key, event, payload });

      return Promise.resolve(true);
    },
  },
}));

// The two data sources of the REAL scope resolvers (`policy.ts`), and nothing else.
vi.mock("@norish/db/repositories/households", () => ({
  getHouseholdPolicy: mockGetHouseholdPolicy,
}));

vi.mock("@norish/db/repositories/recipes", () => ({
  getRecipeOwnerAndHousehold: mockGetRecipeOwnerAndHousehold,
}));

vi.mock("@norish/db", () => ({
  createRecipeWithRefs: mockCreateRecipeWithRefs,
  dashboardRecipe: (recipeId: string) => Promise.resolve(fakeDashboardRecipe(recipeId)),
  getAllergiesForUsers: vi.fn(() => Promise.resolve([])),
  recipeExistsByUrlForPolicy: mockRecipeExistsByUrlForPolicy,
}));

vi.mock("@norish/db/repositories/site-auth-tokens", () => ({
  getDecryptedTokensByUserId: vi.fn(() => Promise.resolve([])),
}));

vi.mock("@norish/shared-server/config/server-config-loader", () => ({
  getAIConfig: vi.fn(() => Promise.resolve({ autoTagAllergies: false })),
  getRecipePermissionPolicy: mockGetRecipePermissionPolicy,
}));

vi.mock("@norish/queue/api-handlers", () => ({
  requireQueueApiHandler: vi.fn(() => mockParseRecipeFromUrl),
}));

vi.mock("@norish/queue/lazy-worker-manager", () => ({
  createLazyWorker: mockCreateLazyWorker,
  stopLazyWorker: vi.fn(),
}));

vi.mock("@norish/queue/redis/bullmq", () => ({
  getBullClient: vi.fn(() => ({ duplicate: vi.fn() })),
}));

vi.mock("@norish/queue/registry", () => ({
  getQueues: vi.fn(() => ({
    autoTagging: {},
    allergyDetection: {},
    autoCategorization: {},
  })),
}));

vi.mock("@norish/queue/auto-tagging/producer", () => ({ addAutoTaggingJob: vi.fn() }));
vi.mock("@norish/queue/allergy-detection/producer", () => ({ addAllergyDetectionJob: vi.fn() }));
vi.mock("@norish/queue/auto-categorization/producer", () => ({
  addAutoCategorizationJob: vi.fn(),
}));

vi.mock("@norish/shared-server/media/storage", () => ({
  deleteRecipeImagesDir: vi.fn(() => Promise.resolve()),
}));

vi.mock("@norish/shared-server/logger", () => ({
  trpcLogger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn(), trace: vi.fn() },
  createLogger: () => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    trace: vi.fn(),
  }),
}));

// The REAL minter (real serializer + real WASM parser) and the REAL boundary.
const { buildCookPayload } = await import("@norish/shared-server/cooklang/build-payload");
const { emitByPolicy, resolveRecipeRealtimeScope } =
  await import("@norish/shared-server/realtime/policy");
const { startRecipeImportWorker } = await import("../../src/recipe-import/worker");

// ---------------------------------------------------------------------------
// The recipe under test, and the `.cook` a real mint produces for it.
// ---------------------------------------------------------------------------

const SECRET_RECIPE: StructuredRecipe = {
  name: "Grandma's Secret Stollen",
  servings: 8,
  systemUsed: "metric",
  steps: [
    {
      text: "Fold the marzipan into the dough with the secret spice.",
      order: 1,
      ingredients: [
        { name: "marzipan", amount: 200, unit: "gram" },
        { name: "dough", amount: 1, unit: "piece" },
      ],
    },
  ],
};

/** Minted ONCE by the real `buildCookPayload`, so every case shares real token text. */
const MINTED = await buildCookPayload(SECRET_RECIPE);

/**
 * Strings that may never appear in anything this suite records. `marzipan` is safe to
 * assert on because the dashboard DTO carries no ingredient list at all — only the
 * `.cook` and its tokens name it.
 */
const COOK_ONLY_STRINGS = ["marzipan", "%gram", "@marzipan", "norish.system"];

function extractedRecipe(): FullRecipeInsertDTO {
  return {
    name: SECRET_RECIPE.name,
    servings: 8,
    systemUsed: "metric",
    recipeIngredients: [
      {
        ingredientName: "marzipan",
        amount: 200,
        unit: "gram",
        systemUsed: "metric",
        order: 0,
      },
    ],
    steps: [{ step: SECRET_RECIPE.steps[0]!.text, order: 1, systemUsed: "metric" }],
    tags: [],
    categories: [],
    images: [],
    videos: [],
  };
}

// ---------------------------------------------------------------------------
// A faithful in-memory stand-in for the two repository functions the worker uses.
// ---------------------------------------------------------------------------

type StoredRow = {
  id: string;
  userId: string | null;
  householdId: string | null;
  name: string;
  updatedAt: Date;
  version: number;
  cookSource: string | null;
  cookTokens: RecipeCookPayload["cookTokens"] | null;
};

const store = new Map<string, StoredRow>();

function seedRow(overrides: Partial<StoredRow> & { id: string }): StoredRow {
  const row: StoredRow = {
    userId: null,
    householdId: null,
    name: "Seeded Recipe",
    updatedAt: new Date("2026-01-01T00:00:00.000Z"),
    version: 1,
    cookSource: null,
    cookTokens: null,
    ...overrides,
  };

  store.set(row.id, row);

  return row;
}

/**
 * Mirrors `createRecipeWithRefs`'s contract for the one property this suite is about:
 * the `.cook` lands on the row named by `recipeId`, in the cookbook named by
 * `householdId`, and on NO other row.
 */
function fakeCreateRecipeWithRefs(
  recipeId: string,
  userId: string | null | undefined,
  householdId: string | null,
  input: FullRecipeInsertDTO,
  cook?: RecipeCookPayload
): Promise<string | null> {
  seedRow({
    id: recipeId,
    userId: userId ?? null,
    householdId,
    name: input.name,
    updatedAt: new Date("2026-07-25T12:00:00.000Z"),
    version: 1,
    cookSource: cook ? cook.cookSource : null,
    cookTokens: cook ? cook.cookTokens : null,
  });

  return Promise.resolve(recipeId);
}

/**
 * Mirrors `dashboardRecipe`, with one DELIBERATE difference: it hands the schema BOTH
 * cook columns, which the repository's `select` does not. That makes the `.omit(...)` in
 * `RecipeDashboardSchema` — rather than the repository's column list — the thing this
 * suite pins, so a future `select` widening cannot quietly turn a per-cookbook `.cook`
 * into a socket push (<risks> R3).
 */
function fakeDashboardRecipe(recipeId: string): unknown {
  const row = store.get(recipeId);

  if (!row) return null;

  const parsed = RecipeDashboardSchema.safeParse({
    id: row.id,
    userId: row.userId,
    householdId: row.householdId,
    name: row.name,
    description: null,
    notes: null,
    url: IMPORT_URL,
    image: null,
    servings: 8,
    prepMinutes: null,
    cookMinutes: null,
    totalMinutes: null,
    calories: null,
    categories: [],
    createdAt: new Date("2026-07-25T12:00:00.000Z"),
    updatedAt: row.updatedAt,
    version: row.version,
    visibility: "private",
    tags: [],
    averageRating: null,
    ratingCount: 0,
    cookSource: row.cookSource,
    cookTokens: row.cookTokens,
  });

  return parsed.success ? parsed.data : null;
}

// ---------------------------------------------------------------------------
// Harness
// ---------------------------------------------------------------------------

function policy(view: "household" | "everyone"): RecipePermissionPolicy {
  return { view, edit: "household", delete: "household" };
}

type MinimalJob = {
  id: string;
  attemptsMade: number;
  opts: Record<string, never>;
  data: RecipeImportJobData;
};

/**
 * Run the REAL `processImportJob`. It is module-private, so it is captured from the
 * processor `startRecipeImportWorker` hands to `createLazyWorker` — the same route
 * `auto-categorization-queue.test.ts` uses. Cast once, to the minimal job shape the
 * processor actually reads, so no fixture needs a cast of its own.
 */
async function runImportJob(data: RecipeImportJobData): Promise<void> {
  await startRecipeImportWorker();

  const processor = mockCreateLazyWorker.mock.calls[0]![1] as (
    job: MinimalJob
  ) => Promise<void | unknown>;

  await processor({ id: "job-1", attemptsMade: 0, opts: {}, data });
}

function importJobData(overrides: Partial<RecipeImportJobData> = {}): RecipeImportJobData {
  return {
    url: IMPORT_URL,
    recipeId: RECIPE_IN_A,
    userId: USER_IN_A,
    householdKey: COOKBOOK_A,
    householdId: COOKBOOK_A,
    householdUserIds: [USER_IN_A],
    ...overrides,
  };
}

/** The keys every recorded delivery went to, in order. */
function deliveredKeys(): (string | null)[] {
  return recorded.map((r) => r.key);
}

function emitsFor(event: string): RecordedEmit[] {
  return recorded.filter((r) => r.event === event);
}

/**
 * Nothing recorded may carry the `.cook`, a token, or either column name — for ANY
 * channel, including the permitted one. A permitted viewer gets the `.cook` by ASKING
 * (`recipes.get`, after `canAccessResource`); it is never pushed.
 */
function expectNoCookAnywhere(): void {
  const serialized = JSON.stringify(recorded);

  expect(serialized).not.toContain("cookSource");
  expect(serialized).not.toContain("cookTokens");
  expect(serialized).not.toContain(MINTED!.cookSource);

  for (const needle of COOK_ONLY_STRINGS) {
    expect(serialized).not.toContain(needle);
  }
}

/** The row as stored, for a byte-identical before/after comparison. */
function snapshot(recipeId: string): string {
  return JSON.stringify(store.get(recipeId) ?? null);
}

describe("a minted cook_source never crosses a cookbook at the write or emit end", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    recorded.length = 0;
    store.clear();

    mockCreateRecipeWithRefs.mockImplementation(fakeCreateRecipeWithRefs);
    mockRecipeExistsByUrlForPolicy.mockResolvedValue({ exists: false });
    mockParseRecipeFromUrl.mockResolvedValue({
      recipe: extractedRecipe(),
      usedAI: true,
      cook: MINTED,
    });

    // Cookbook B already holds a recipe of its own. Nothing this suite does may touch it.
    seedRow({ id: RECIPE_IN_B, userId: MEMBER_OF_B, householdId: COOKBOOK_B, name: "B's Recipe" });
  });

  it("mints a REAL .cook for the fixture (harness self-check — the suite is not vacuous)", async () => {
    expect(MINTED).not.toBeNull();
    expect(MINTED!.cookSource).toContain("@marzipan{200%gram}");
    expect(MINTED!.cookTokens.length).toBeGreaterThan(0);
    expect(
      MINTED!.cookTokens.flatMap((step) =>
        step.tokens.filter((t) => t.type === "ingredient").map((t) => t.name)
      )
    ).toContain("marzipan");
  });

  // `everyone` is exercised alongside `household` for EVERY case below (AGENTS.md).
  for (const view of ["household", "everyone"] as const) {
    describe(`an import into cookbook A, with A's policy at view: "${view}"`, () => {
      beforeEach(() => {
        mockGetHouseholdPolicy.mockResolvedValue({ policy: policy(view), adminUserId: "admin-a" });
        mockGetRecipePermissionPolicy.mockResolvedValue(policy(view));
      });

      it("writes the cook_source on the imported recipe ONLY — cookbook B's row is byte-identical", async () => {
        const before = snapshot(RECIPE_IN_B);

        await runImportJob(importJobData());

        expect(store.get(RECIPE_IN_A)!.cookSource).toBe(MINTED!.cookSource);
        expect(store.get(RECIPE_IN_A)!.householdId).toBe(COOKBOOK_A);
        // Row id, updatedAt, version and cook_source all unchanged for the other cookbook.
        expect(snapshot(RECIPE_IN_B)).toBe(before);
        expect(store.get(RECIPE_IN_B)!.cookSource).toBeNull();
      });

      it("hands the write the job's OWN recipe id and cookbook, never another cookbook's", async () => {
        await runImportJob(importJobData());

        expect(mockCreateRecipeWithRefs).toHaveBeenCalledTimes(1);
        const [recipeId, userId, householdId, , cook] = mockCreateRecipeWithRefs.mock.calls[0] as [
          string,
          string,
          string | null,
          FullRecipeInsertDTO,
          CookPayload | undefined,
        ];

        expect(recipeId).toBe(RECIPE_IN_A);
        expect(userId).toBe(USER_IN_A);
        expect(householdId).toBe(COOKBOOK_A);
        expect(cook?.cookSource).toBe(MINTED!.cookSource);
      });

      it("delivers every import event to cookbook A's channel alone — never B, never broadcast", async () => {
        await runImportJob(importJobData());

        // importStarted, two importProgress stages and imported.
        expect(recorded.length).toBeGreaterThanOrEqual(4);
        expect(recorded.every((r) => r.method === "emitToHousehold")).toBe(true);
        expect(new Set(deliveredKeys())).toEqual(new Set([COOKBOOK_A]));
        expect(deliveredKeys()).not.toContain(COOKBOOK_B);
        expect(deliveredKeys()).not.toContain(MEMBER_OF_B);
        expect(deliveredKeys()).not.toContain(STRANGER);
        expect(recorded.some((r) => r.method === "broadcast")).toBe(false);
      });

      it("the `imported` payload carries neither cookSource, cookTokens nor any .cook text", async () => {
        await runImportJob(importJobData());

        const imported = emitsFor("imported");

        expect(imported).toHaveLength(1);
        // The recipe really does have a `.cook` — that is what makes this non-vacuous.
        expect(store.get(RECIPE_IN_A)!.cookSource).toBe(MINTED!.cookSource);

        const payload = imported[0]!.payload as { recipe: Record<string, unknown> };

        expect(payload.recipe).not.toHaveProperty("cookSource");
        expect(payload.recipe).not.toHaveProperty("cookTokens");
        expect(payload.recipe).not.toHaveProperty("cookConfidence");
        expect(payload.recipe).not.toHaveProperty("cookReviewNeeded");
        expectNoCookAnywhere();
      });

      /**
       * The dedup-hit branch is the OTHER place this worker emits a recipe DTO, and it
       * emits one it did not create. IMPORT-DEDUP-ISO-01: the worker's own
       * `recipeExistsByUrlForPolicy` call is a separate call site from the producer's
       * (which `dedup-isolation.test.ts` covers) and must stay cookbook-scoped even
       * under `everyone`, or a `.cook`-bearing recipe from another cookbook is what
       * gets pushed.
       */
      it("asks the dedup repository with a cookbook-scoped policy, never the seeded view", async () => {
        await runImportJob(importJobData());

        expect(mockRecipeExistsByUrlForPolicy).toHaveBeenCalledTimes(1);
        const viewPolicyArg = mockRecipeExistsByUrlForPolicy.mock.calls[0]![4];

        expect(viewPolicyArg).toBe("household");
        expect(viewPolicyArg).not.toBe("everyone");
      });

      it("a dedup HIT on a recipe that HAS a .cook emits it to cookbook A with no cook* key", async () => {
        // The recipe already exists in cookbook A, minted `.cook` and all.
        seedRow({
          id: RECIPE_IN_A,
          userId: USER_IN_A,
          householdId: COOKBOOK_A,
          name: SECRET_RECIPE.name,
          cookSource: MINTED!.cookSource,
          cookTokens: MINTED!.cookTokens,
        });
        mockRecipeExistsByUrlForPolicy.mockResolvedValue({
          exists: true,
          existingRecipeId: RECIPE_IN_A,
        });

        await runImportJob(importJobData({ recipeId: PERSONAL_RECIPE }));

        // No write at all on a dedup hit, and the push still stops at the cookbook.
        expect(mockCreateRecipeWithRefs).not.toHaveBeenCalled();
        expect(emitsFor("imported")).toHaveLength(1);
        expect(new Set(deliveredKeys())).toEqual(new Set([COOKBOOK_A]));
        expectNoCookAnywhere();
      });

      it("a recipe-bearing event resolved from the RECIPE's own cookbook stops at cookbook A", async () => {
        await runImportJob(importJobData());
        recorded.length = 0;

        // The post-write emit route (auto-tagging, allergy detection, nutrition): the
        // REAL resolver, keyed on the recipe's own cookbook, never the actor's.
        mockGetRecipeOwnerAndHousehold.mockResolvedValue({
          userId: USER_IN_A,
          householdId: COOKBOOK_A,
        });

        const { recipeEmitter } = await import("@norish/shared-server/realtime/recipes");
        const scope = await resolveRecipeRealtimeScope(RECIPE_IN_A, {
          userId: MEMBER_OF_B,
          householdKey: COOKBOOK_B,
        });

        emitByPolicy(recipeEmitter, scope.viewPolicy, scope.ctx, "imported", {
          recipe: fakeDashboardRecipe(RECIPE_IN_A) as never,
        });

        expect(deliveredKeys()).toEqual([COOKBOOK_A]);
        expect(recorded.some((r) => r.method === "broadcast")).toBe(false);
        expectNoCookAnywhere();
      });
    });

    describe(`a PERSONAL import (householdId: null), server-wide policy view: "${view}"`, () => {
      beforeEach(() => {
        mockGetRecipePermissionPolicy.mockResolvedValue(policy(view));
        mockGetHouseholdPolicy.mockResolvedValue(null);
      });

      const personalJob = () =>
        importJobData({
          recipeId: PERSONAL_RECIPE,
          userId: PERSONAL_USER,
          householdKey: PERSONAL_USER,
          householdId: null,
          householdUserIds: null,
        });

      it("stores the .cook for the importing user with household_id IS NULL", async () => {
        await runImportJob(personalJob());

        const row = store.get(PERSONAL_RECIPE)!;

        expect(row.householdId).toBeNull();
        expect(row.userId).toBe(PERSONAL_USER);
        expect(row.cookSource).toBe(MINTED!.cookSource);
      });

      it("delivers only to the importer's own user channel — no household channel, no broadcast", async () => {
        await runImportJob(personalJob());

        expect(recorded.every((r) => r.method === "emitToUser")).toBe(true);
        expect(new Set(deliveredKeys())).toEqual(new Set([PERSONAL_USER]));
        expect(recorded.some((r) => r.method === "emitToHousehold")).toBe(false);
        expect(recorded.some((r) => r.method === "broadcast")).toBe(false);
      });

      it("reaches neither a member of an unrelated cookbook nor a stranger with no cookbook", async () => {
        await runImportJob(personalJob());

        for (const outsider of [COOKBOOK_A, COOKBOOK_B, MEMBER_OF_B, STRANGER]) {
          expect(deliveredKeys()).not.toContain(outsider);
        }

        // Absence of the recipe TEXT, not merely of an error code.
        expectNoCookAnywhere();
      });

      it("a later recipe-bearing event reaches the OWNER only, never the actor who triggered it", async () => {
        await runImportJob(personalJob());
        recorded.length = 0;

        mockGetRecipeOwnerAndHousehold.mockResolvedValue({
          userId: PERSONAL_USER,
          householdId: null,
        });

        const { recipeEmitter } = await import("@norish/shared-server/realtime/recipes");
        // A stranger triggers the event; the scope must still key on the OWNER.
        const scope = await resolveRecipeRealtimeScope(PERSONAL_RECIPE, {
          userId: STRANGER,
          householdKey: COOKBOOK_B,
        });

        emitByPolicy(recipeEmitter, scope.viewPolicy, scope.ctx, "imported", {
          recipe: fakeDashboardRecipe(PERSONAL_RECIPE) as never,
        });

        expect(recorded).toHaveLength(1);
        expect(recorded[0]!.method).toBe("emitToUser");
        expect(recorded[0]!.key).toBe(PERSONAL_USER);
        expect(deliveredKeys()).not.toContain(STRANGER);
        expectNoCookAnywhere();
      });
    });

    describe(`the userId: null ORPHAN branch, view: "${view}"`, () => {
      beforeEach(() => {
        mockGetRecipePermissionPolicy.mockResolvedValue(policy(view));
        mockGetHouseholdPolicy.mockResolvedValue({ policy: policy(view), adminUserId: "admin-a" });
        seedRow({
          id: ORPHAN_RECIPE,
          userId: null,
          householdId: null,
          name: "Ownerless Recipe",
          cookSource: MINTED!.cookSource,
          cookTokens: MINTED!.cookTokens,
        });
        mockGetRecipeOwnerAndHousehold.mockResolvedValue({ userId: null, householdId: null });
      });

      it("fails closed to the ACTOR's own user channel and never a household channel", async () => {
        const { recipeEmitter } = await import("@norish/shared-server/realtime/recipes");
        const scope = await resolveRecipeRealtimeScope(ORPHAN_RECIPE, {
          userId: USER_IN_A,
          householdKey: COOKBOOK_A,
        });

        expect(scope.viewPolicy).toBe("owner");

        emitByPolicy(recipeEmitter, scope.viewPolicy, scope.ctx, "imported", {
          recipe: fakeDashboardRecipe(ORPHAN_RECIPE) as never,
        });

        expect(recorded).toEqual([
          { method: "emitToUser", key: USER_IN_A, event: "imported", payload: expect.anything() },
        ]);
        expect(recorded.some((r) => r.method === "emitToHousehold")).toBe(false);
        expect(recorded.some((r) => r.method === "broadcast")).toBe(false);
      });

      it("never consults a cookbook policy or the server-wide default for an orphan", async () => {
        await resolveRecipeRealtimeScope(ORPHAN_RECIPE, {
          userId: USER_IN_A,
          householdKey: COOKBOOK_A,
        });

        // The fail-closed branch returns before either policy read, so the seeded
        // `view` cannot widen it — which is exactly why both siblings assert the same.
        expect(mockGetHouseholdPolicy).not.toHaveBeenCalled();
        expect(mockGetRecipePermissionPolicy).not.toHaveBeenCalled();
      });

      it("leaks no .cook text even though the orphan row HAS one", async () => {
        const { recipeEmitter } = await import("@norish/shared-server/realtime/recipes");
        const scope = await resolveRecipeRealtimeScope(ORPHAN_RECIPE, {
          userId: USER_IN_A,
          householdKey: COOKBOOK_A,
        });

        emitByPolicy(recipeEmitter, scope.viewPolicy, scope.ctx, "imported", {
          recipe: fakeDashboardRecipe(ORPHAN_RECIPE) as never,
        });

        expect(store.get(ORPHAN_RECIPE)!.cookSource).toBe(MINTED!.cookSource);
        expectNoCookAnywhere();
      });
    });

    describe(`the list DTO for a recipe that HAS a cook_source, view: "${view}"`, () => {
      beforeEach(() => {
        mockGetHouseholdPolicy.mockResolvedValue({ policy: policy(view), adminUserId: "admin-a" });
        mockGetRecipePermissionPolicy.mockResolvedValue(policy(view));
      });

      it("RecipeDashboardSchema still parses it and exposes no cook* key", async () => {
        await runImportJob(importJobData());

        const dto = fakeDashboardRecipe(RECIPE_IN_A) as Record<string, unknown>;

        // Unchanged for a recipe that HAS a `.cook`: it parses, and the three `0041`
        // columns are absent — W2 `.omit`ed them while nothing populated them, and W3
        // is the first wave where that omission is load-bearing.
        expect(dto).not.toBeNull();
        expect(dto.id).toBe(RECIPE_IN_A);
        expect(dto.name).toBe(SECRET_RECIPE.name);
        expect(Object.keys(dto)).not.toContain("cookSource");
        expect(Object.keys(dto)).not.toContain("cookTokens");
        expect(Object.keys(dto)).not.toContain("cookConfidence");
        expect(Object.keys(dto)).not.toContain("cookReviewNeeded");
      });

      it("the list DTO carries no .cook text for a viewer who CAN see the recipe", async () => {
        await runImportJob(importJobData());

        const serialized = JSON.stringify(fakeDashboardRecipe(RECIPE_IN_A));

        expect(serialized).not.toContain(MINTED!.cookSource);

        for (const needle of COOK_ONLY_STRINGS) {
          expect(serialized).not.toContain(needle);
        }
      });
    });
  }
});
