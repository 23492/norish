// @vitest-environment node
/**
 * Phase 22.1 / IMPORT-DEDUP-ISO-01 — import dedup must not cross cookbooks.
 *
 * `households.isolation.test.ts` already proves `recipeExistsByUrlForPolicy` is
 * cookbook-scoped WHEN CALLED WITH `"household"`. The defect is one layer up: the import
 * producer/worker resolve their argument from the SERVER-WIDE
 * `getRecipePermissionPolicy()`, which is `{"view":"everyone",...}` in production — and
 * the repository's `everyone` branch matches `recipes.url` with no cookbook predicate at
 * all. Same shape as the Phase 22 realtime leak: the invariant was tested at the layer
 * below, and the layer above never passed the right argument.
 *
 * These tests drive the REAL `addImportJob` / `generateJobId` against a faithful in-memory
 * stand-in for the repository, with the live server-wide policy in place.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const mockRecipeExistsByUrlForPolicy = vi.hoisted(() => vi.fn());
const mockGetRecipePermissionPolicy = vi.hoisted(() => vi.fn());

vi.mock("@norish/db", () => ({
  recipeExistsByUrlForPolicy: mockRecipeExistsByUrlForPolicy,
}));

vi.mock("@norish/shared-server/config/server-config-loader", () => ({
  getRecipePermissionPolicy: mockGetRecipePermissionPolicy,
}));

vi.mock("@norish/shared-server/logger", () => ({
  createLogger: () => ({ debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }),
}));

const { addImportJob } = await import("@norish/queue/recipe-import/producer");
const { generateJobId } = await import("@norish/queue/helpers");

/** The policy live in production on 2026-07-21 — the reason the leak is active. */
const LIVE_SERVER_POLICY = { view: "everyone", edit: "household", delete: "household" } as const;

const SHARED_URL = "https://example.com/shared-recipe";
const COOKBOOK_A = "hh-a";
const COOKBOOK_B = "hh-b";
const USER_IN_A = "user-a";
const USER_IN_B = "user-b";
const RECIPE_IN_A = "recipe-owned-by-cookbook-a";

/**
 * A faithful stand-in for `recipeExistsByUrlForPolicy`, mirroring the real branch logic
 * in packages/db/src/repositories/recipes.ts. Fixture: cookbook A already holds SHARED_URL;
 * cookbook B holds nothing.
 */
function fakeRepository(
  _url: string,
  userId: string,
  householdId: string | null,
  _householdUserIds: string[] | null,
  viewPolicy: string
): Promise<{ exists: boolean; existingRecipeId?: string }> {
  if (viewPolicy === "everyone") {
    // No cookbook predicate at all — matches the URL wherever it lives.
    return Promise.resolve({ exists: true, existingRecipeId: RECIPE_IN_A });
  }

  if (viewPolicy === "household") {
    const found = householdId === COOKBOOK_A;

    return Promise.resolve(
      found ? { exists: true, existingRecipeId: RECIPE_IN_A } : { exists: false }
    );
  }

  // owner
  const found = userId === USER_IN_A;

  return Promise.resolve(
    found ? { exists: true, existingRecipeId: RECIPE_IN_A } : { exists: false }
  );
}

function jobData(overrides: Record<string, unknown> = {}): never {
  return {
    url: SHARED_URL,
    recipeId: "pending-recipe-id",
    userId: USER_IN_B,
    householdKey: COOKBOOK_B,
    householdId: COOKBOOK_B,
    householdUserIds: [USER_IN_B],
    ...overrides,
  } as never;
}

const fakeQueue = {
  add: vi.fn(() => Promise.resolve({ id: "job-1" })),
  getJob: vi.fn(() => Promise.resolve(null)),
} as never;

describe("import dedup never crosses a cookbook boundary", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetRecipePermissionPolicy.mockResolvedValue(LIVE_SERVER_POLICY);
    mockRecipeExistsByUrlForPolicy.mockImplementation(fakeRepository);
  });

  it("does not return cookbook A's recipe when cookbook B imports the same URL", async () => {
    const result = await addImportJob(fakeQueue, jobData());

    // The leak: `status: "exists"` handing back RECIPE_IN_A, a recipe in a cookbook
    // user-b is not a member of.
    expect(result.status).not.toBe("exists");
    expect(JSON.stringify(result)).not.toContain(RECIPE_IN_A);
  });

  it("never asks the repository to search across cookbooks", async () => {
    await addImportJob(fakeQueue, jobData());

    expect(mockRecipeExistsByUrlForPolicy).toHaveBeenCalled();
    const viewPolicyArg = mockRecipeExistsByUrlForPolicy.mock.calls[0]![4];

    expect(viewPolicyArg).not.toBe("everyone");
  });

  it("still dedups within the importer's OWN cookbook", async () => {
    const result = await addImportJob(
      fakeQueue,
      jobData({ userId: USER_IN_A, householdKey: COOKBOOK_A, householdId: COOKBOOK_A })
    );

    expect(result.status).toBe("exists");
    expect(result).toMatchObject({ existingRecipeId: RECIPE_IN_A });
  });

  it("gives two cookbooks distinct job ids for the same URL", () => {
    // A globally-scoped job id made household B's import collide with household A's and
    // get rejected as a duplicate — one household silently blocking another's import.
    const idForA = generateJobId(SHARED_URL, USER_IN_A, COOKBOOK_A, "household");
    const idForB = generateJobId(SHARED_URL, USER_IN_B, COOKBOOK_B, "household");

    expect(idForA).not.toBe(idForB);
    expect(idForA).toContain(COOKBOOK_A);
    expect(idForB).toContain(COOKBOOK_B);
  });

  it("the producer asks for a cookbook-scoped job id", async () => {
    await addImportJob(fakeQueue, jobData());

    const addedWithJobId = (fakeQueue as unknown as { add: { mock: { calls: unknown[][] } } }).add
      .mock.calls[0]![2] as { jobId: string };

    // Not the bare `import_${url}` global form.
    expect(addedWithJobId.jobId).toContain(COOKBOOK_B);
  });
});
