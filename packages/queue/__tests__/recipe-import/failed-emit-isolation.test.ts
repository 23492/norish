// @vitest-environment node
/**
 * Phase 27.1 / IMPORT-REL-04 (D-27.1-07) — the `failed` emit is UNCONDITIONAL and
 * fail-closed, proven under the LIVE `everyone` policy. SECURITY-CRITICAL.
 *
 * `handleJobFailed` (`packages/queue/src/recipe-import/worker.ts`) used to run unguarded
 * pre-emit work — `deleteRecipeImagesDir` and `resolveHouseholdRealtimeScope` — BEFORE the
 * `failed` emit. A throw in either was only LOGGED by
 * `packages/queue/src/lazy-worker-manager.ts:259-263` (`onFailed` rejection handling), which
 * is exactly how the event disappeared, leaving an eternal skeleton card. This suite drives
 * the REAL, exported `handleJobFailed` directly (a test-only export, not a duplicated copy
 * of its logic) against a mocked `resolveHouseholdRealtimeScope` and a mocked
 * `deleteRecipeImagesDir`, while the REAL `emitByPolicy` runs underneath — the boundary
 * clamp is the thing under test and must never be mocked away.
 *
 * EVERY policy-seeded case has a `view: "everyone"` sibling (AGENTS.md / D-22-01): three
 * prior cross-cookbook leaks all survived a green suite that seeded only `household`.
 */
import type { Job } from "bullmq";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { RecipeImportJobData } from "../../src/contracts/job-types";

type RecordedEmit = { method: "broadcast" | "emitToHousehold" | "emitToUser"; key?: string };
const recorded: RecordedEmit[] = [];

const mockResolveHouseholdRealtimeScope = vi.hoisted(() => vi.fn());
const mockDeleteRecipeImagesDir = vi.hoisted(() => vi.fn());
const loggerCalls = vi.hoisted(() => ({ error: [] as unknown[][] }));

vi.mock("@norish/shared-server/logger", () => ({
  trpcLogger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn(), trace: vi.fn() },
  redisLogger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn(), trace: vi.fn() },
  createLogger: () => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: (...args: unknown[]) => {
      loggerCalls.error.push(args);
    },
    trace: vi.fn(),
  }),
}));

// The emitter the handler publishes through — record method + target key, never Redis.
vi.mock("@norish/shared-server/realtime/recipes", () => ({
  recipeEmitter: {
    broadcast: () => {
      recorded.push({ method: "broadcast" });

      return Promise.resolve(true);
    },
    emitToHousehold: (key: string) => {
      recorded.push({ method: "emitToHousehold", key });

      return Promise.resolve(true);
    },
    emitToUser: (key: string) => {
      recorded.push({ method: "emitToUser", key });

      return Promise.resolve(true);
    },
  },
}));

// The REAL `emitByPolicy` (the boundary clamp under test) with ONLY the resolver mocked,
// so its rejection/resolution is fully controllable per test.
vi.mock("@norish/shared-server/realtime/policy", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@norish/shared-server/realtime/policy")>();

  return {
    ...actual,
    resolveHouseholdRealtimeScope: mockResolveHouseholdRealtimeScope,
  };
});

vi.mock("@norish/shared-server/media/storage", () => ({
  deleteRecipeImagesDir: mockDeleteRecipeImagesDir,
}));

const { handleJobFailed } = await import("../../src/recipe-import/worker");

const HOUSEHOLD_A = "hh-a";
const HOUSEHOLD_B = "hh-b";
const USER_A = "user-a";
const RECIPE_ID = "recipe-1";
const IMPORT_URL = "https://example.com/recipe";

type MinimalJob = {
  id: string;
  attemptsMade: number;
  opts: { attempts?: number };
  data: RecipeImportJobData;
};

function jobData(overrides: Partial<RecipeImportJobData> = {}): RecipeImportJobData {
  return {
    url: IMPORT_URL,
    recipeId: RECIPE_ID,
    userId: USER_A,
    householdKey: HOUSEHOLD_A,
    householdId: HOUSEHOLD_A,
    householdUserIds: [USER_A],
    ...overrides,
  };
}

function finalFailureJob(overrides: Partial<RecipeImportJobData> = {}): MinimalJob {
  return {
    id: "job-1",
    attemptsMade: 3,
    opts: { attempts: 3 },
    data: jobData(overrides),
  };
}

function nonFinalFailureJob(overrides: Partial<RecipeImportJobData> = {}): MinimalJob {
  return {
    id: "job-1",
    attemptsMade: 1,
    opts: { attempts: 3 },
    data: jobData(overrides),
  };
}

async function runHandleJobFailed(job: MinimalJob, error: Error): Promise<void> {
  await (handleJobFailed as unknown as (j: MinimalJob, e: Error) => Promise<void>)(job, error);
}

const err = new Error("boom");

describe("handleJobFailed: the failed emit is unconditional and fail-closed", () => {
  beforeEach(() => {
    recorded.length = 0;
    loggerCalls.error.length = 0;
    vi.clearAllMocks();
    mockDeleteRecipeImagesDir.mockResolvedValue(undefined);
    mockResolveHouseholdRealtimeScope.mockResolvedValue({
      viewPolicy: "household",
      ctx: { userId: USER_A, householdKey: HOUSEHOLD_A },
    });
  });

  // The "emit itself throws" test below spies on the shared `recipeEmitter` mock with
  // `mockImplementation`; `vi.clearAllMocks()` in `beforeEach` clears call history but does
  // NOT restore a spied implementation, so it must be explicitly restored after each test.
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("returns without throwing and without emitting when job is undefined", async () => {
    await expect(
      (handleJobFailed as unknown as (j: undefined, e: Error) => Promise<void>)(undefined, err)
    ).resolves.toBeUndefined();
    expect(recorded).toEqual([]);
  });

  it("non-final failure: no failed emit, cleanup still runs", async () => {
    await runHandleJobFailed(nonFinalFailureJob(), err);

    expect(recorded).toEqual([]);
    expect(mockDeleteRecipeImagesDir).toHaveBeenCalledWith(RECIPE_ID);
  });

  it("final failure, everything healthy: exactly one failed emit via emitToHousehold with the unchanged payload", async () => {
    await runHandleJobFailed(finalFailureJob(), err);

    expect(recorded).toEqual([{ method: "emitToHousehold", key: HOUSEHOLD_A }]);
    expect(mockDeleteRecipeImagesDir).toHaveBeenCalledWith(RECIPE_ID);
  });

  it("deleteRecipeImagesDir REJECTS: the failed emit still happens, and handleJobFailed resolves", async () => {
    mockDeleteRecipeImagesDir.mockRejectedValue(new Error("disk error"));

    await expect(runHandleJobFailed(finalFailureJob(), err)).resolves.toBeUndefined();

    const failedEmits = recorded.filter((r) => r.method !== undefined);

    expect(failedEmits).toHaveLength(1);
    expect(failedEmits[0]).toEqual({ method: "emitToHousehold", key: HOUSEHOLD_A });
  });

  it("resolveHouseholdRealtimeScope REJECTS: emits via emitToUser keyed on the job's userId (fail-closed owner scope), and resolves", async () => {
    mockResolveHouseholdRealtimeScope.mockRejectedValue(new Error("db down"));

    await expect(runHandleJobFailed(finalFailureJob(), err)).resolves.toBeUndefined();

    expect(recorded).toEqual([{ method: "emitToUser", key: USER_A }]);
  });

  it("BOTH cleanup and resolver reject: a failed emit is still recorded, and handleJobFailed resolves", async () => {
    mockDeleteRecipeImagesDir.mockRejectedValue(new Error("disk error"));
    mockResolveHouseholdRealtimeScope.mockRejectedValue(new Error("db down"));

    await expect(runHandleJobFailed(finalFailureJob(), err)).resolves.toBeUndefined();

    expect(recorded).toEqual([{ method: "emitToUser", key: USER_A }]);
  });

  it("the emit itself throws: handleJobFailed still resolves", async () => {
    const { recipeEmitter } = await import("@norish/shared-server/realtime/recipes");

    vi.spyOn(recipeEmitter, "emitToHousehold").mockImplementation(() => {
      throw new Error("emit exploded");
    });

    await expect(runHandleJobFailed(finalFailureJob(), err)).resolves.toBeUndefined();
  });

  describe.each(["household", "everyone"] as const)(
    "under view: %s — never broadcast, always the TARGET cookbook",
    (view) => {
      beforeEach(() => {
        mockResolveHouseholdRealtimeScope.mockResolvedValue({
          viewPolicy: view,
          ctx: { userId: USER_A, householdKey: HOUSEHOLD_A },
        });
      });

      it("emits to the target household, never broadcasts, never cookbook B", async () => {
        await runHandleJobFailed(finalFailureJob(), err);

        expect(recorded).toEqual([{ method: "emitToHousehold", key: HOUSEHOLD_A }]);
        expect(recorded.some((r) => r.method === "broadcast")).toBe(false);
        expect(recorded.some((r) => r.key === HOUSEHOLD_B)).toBe(false);
      });

      it("a personal import (householdId null) emits to the user, under both policies", async () => {
        mockResolveHouseholdRealtimeScope.mockResolvedValue({
          viewPolicy: view,
          ctx: { userId: USER_A, householdKey: USER_A },
        });

        await runHandleJobFailed(
          finalFailureJob({ householdId: null, householdKey: USER_A }),
          err
        );

        expect(recorded).toEqual([{ method: "emitToUser", key: USER_A }]);
        expect(recorded.some((r) => r.method === "broadcast")).toBe(false);
      });
    }
  );

  it("cookbook A's failure never produces an emit keyed on cookbook B", async () => {
    mockResolveHouseholdRealtimeScope.mockResolvedValue({
      viewPolicy: "everyone",
      ctx: { userId: USER_A, householdKey: HOUSEHOLD_A },
    });

    await runHandleJobFailed(finalFailureJob({ householdId: HOUSEHOLD_A }), err);

    expect(recorded.some((r) => r.key === HOUSEHOLD_B)).toBe(false);
  });
});
