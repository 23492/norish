// @vitest-environment node
/**
 * Phase 24 / BULK-01 — bulk import fan-out preserves per-cookbook isolation.
 *
 * The bulk procedure fans MANY URLs out over the SAME `addImportJob` path the single
 * import uses (one job per URL, each carrying the ACTOR's active cookbook). This test pins
 * the two isolation properties the fan-out must inherit from Phase 22.1, driving the REAL
 * `addImportJob` / `generateJobId` against a stateful in-memory queue + repository, with
 * the LIVE production policy `view: "everyone"` in place (the sibling case that caught the
 * whole family):
 *
 *   1. Two cookbooks importing the SAME URL never collide on a job id (a global id would
 *      let one household's bulk import silently block another's).
 *   2. Bulk dedup is scoped to the ACTOR's cookbook only — cookbook A already holding a URL
 *      must not turn cookbook B's bulk import of that URL into an `exists`.
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

const LIVE_SERVER_POLICY = { view: "everyone", edit: "household", delete: "household" } as const;

const SHARED_URL = "https://example.com/shared-recipe";
const COOKBOOK_A = "hh-a";
const COOKBOOK_B = "hh-b";
const USER_IN_A = "user-a";
const USER_IN_B = "user-b";
const RECIPE_IN_A = "recipe-owned-by-cookbook-a";

/** Cookbook A already holds SHARED_URL; cookbook B holds nothing (mirrors the real repo). */
function fakeRepository(
  _url: string,
  _userId: string,
  householdId: string | null,
  _householdUserIds: string[] | null,
  viewPolicy: string
): Promise<{ exists: boolean; existingRecipeId?: string }> {
  if (viewPolicy === "household") {
    return Promise.resolve(
      householdId === COOKBOOK_A ? { exists: true, existingRecipeId: RECIPE_IN_A } : { exists: false }
    );
  }

  // Any non-household scope here would be the leak; return "found everywhere" so a
  // cross-cookbook search would visibly fail the assertions below.
  return Promise.resolve({ exists: true, existingRecipeId: RECIPE_IN_A });
}

/** A stateful queue: records adds by jobId and reports them as in-queue for dedup checks. */
function createStatefulQueue() {
  const jobs = new Map<string, { id: string; data: unknown; getState: () => Promise<string> }>();

  return {
    add: vi.fn((_name: string, data: unknown, opts: { jobId: string }) => {
      const job = { id: opts.jobId, data, getState: () => Promise.resolve("waiting") };

      jobs.set(opts.jobId, job);

      return Promise.resolve(job);
    }),
    getJob: vi.fn((jobId: string) => Promise.resolve(jobs.get(jobId) ?? null)),
  } as never;
}

// Simulate the procedure's fan-out: one addImportJob per URL, all against one cookbook.
function bulkJob(url: string, cookbook: string, userId: string): never {
  return {
    url,
    recipeId: `pending-${url}-${cookbook}`,
    userId,
    householdKey: cookbook,
    householdId: cookbook,
    householdUserIds: [userId],
  } as never;
}

describe("bulk import fan-out never crosses a cookbook boundary", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetRecipePermissionPolicy.mockResolvedValue(LIVE_SERVER_POLICY);
    mockRecipeExistsByUrlForPolicy.mockImplementation(fakeRepository);
  });

  it("gives two cookbooks distinct job ids for the same URL (no collision)", async () => {
    const queue = createStatefulQueue();

    const forA = await addImportJob(queue, bulkJob(SHARED_URL, COOKBOOK_A, USER_IN_A));
    const forB = await addImportJob(queue, bulkJob(SHARED_URL, COOKBOOK_B, USER_IN_B));

    // A already holds the URL → exists; B does not → queued. Crucially B is NOT blocked.
    expect(forA.status).toBe("exists");
    expect(forB.status).toBe("queued");

    const addedJobIds = (queue as unknown as { add: { mock: { calls: unknown[][] } } }).add.mock
      .calls;

    expect(addedJobIds).toHaveLength(1); // only B enqueued
    const bJobId = (addedJobIds[0]![2] as { jobId: string }).jobId;

    expect(bJobId).toContain(COOKBOOK_B);
    expect(bJobId).not.toContain(COOKBOOK_A);
  });

  it("dedups within the ACTOR's cookbook only — B's bulk import of A's URL still queues", async () => {
    const queue = createStatefulQueue();

    const result = await addImportJob(queue, bulkJob(SHARED_URL, COOKBOOK_B, USER_IN_B));

    expect(result.status).not.toBe("exists");
    expect(JSON.stringify(result)).not.toContain(RECIPE_IN_A);

    // Never asked the repository to search across cookbooks.
    const viewPolicyArg = mockRecipeExistsByUrlForPolicy.mock.calls[0]![4];

    expect(viewPolicyArg).toBe("household");
  });

  it("dedups a URL repeated within one cookbook's own batch (second is a duplicate)", async () => {
    const queue = createStatefulQueue();

    // Two identical URLs in one cookbook-B batch: the first queues, the second is rejected
    // as already-in-queue — scoped to B's job id, so it can never affect cookbook A.
    const first = await addImportJob(queue, bulkJob(SHARED_URL, COOKBOOK_B, USER_IN_B));
    const second = await addImportJob(queue, bulkJob(SHARED_URL, COOKBOOK_B, USER_IN_B));

    expect(first.status).toBe("queued");
    expect(second.status).toBe("duplicate");
  });
});
