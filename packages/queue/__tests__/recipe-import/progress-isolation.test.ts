// @vitest-environment node
/**
 * Phase 24 / IMPORT-UX-01 — import-progress fan-out isolation.
 *
 * `emitImportProgress` is the ONLY new realtime emit site this phase adds. It is a
 * resource-bearing push, so it inherits the REALTIME-ISO-01 / HOUSE-06 invariant: a
 * running import's progress must stop at the TARGET cookbook and must NEVER broadcast —
 * otherwise, under the production default `view: "everyone"`, cookbook A's import progress
 * would surface on every connected client (the exact leak Phase 22 closed).
 *
 * These tests drive the REAL `emitImportProgress` + REAL `emitByPolicy`. The scope the
 * worker resolves (via `resolveHouseholdRealtimeScope`, keyed on the import's TARGET
 * cookbook) is constructed here directly — that resolver is itself pinned by
 * `packages/shared-server/__tests__/realtime/fan-out-isolation.test.ts`. Only the emitter
 * surface is recorded. Every policy case includes the LIVE `everyone` sibling — the rule
 * that caught the whole Phase 22 family.
 */
import type { RecipeRealtimeScope } from "@norish/shared-server/realtime/policy";
import { beforeEach, describe, expect, it, vi } from "vitest";

type RecordedEmit = { method: "broadcast" | "emitToHousehold" | "emitToUser"; key?: string };
const recorded: RecordedEmit[] = [];

vi.mock("@norish/shared-server/logger", () => ({
  trpcLogger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn(), trace: vi.fn() },
  redisLogger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn(), trace: vi.fn() },
  createLogger: () => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    trace: vi.fn(),
  }),
}));

// The emitter the helper publishes through — record method + target key, never Redis.
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

const { emitImportProgress } = await import("@norish/queue/recipe-import/progress");

const HOUSEHOLD_A = "hh-a";
const HOUSEHOLD_B = "hh-b";
const USER_A = "user-a";

/** A scope keyed on cookbook A, as `resolveHouseholdRealtimeScope(HOUSEHOLD_A, …)` returns. */
function scopeForCookbookA(view: "household" | "everyone"): RecipeRealtimeScope {
  return { viewPolicy: view, ctx: { userId: USER_A, householdKey: HOUSEHOLD_A } };
}

describe("import progress never crosses a cookbook boundary", () => {
  beforeEach(() => {
    recorded.length = 0;
  });

  it("scopes progress to the TARGET household, never broadcast (view: household)", () => {
    emitImportProgress(scopeForCookbookA("household"), {
      recipeId: "r1",
      url: "https://x",
      stage: "fetching",
    });

    expect(recorded).toEqual([{ method: "emitToHousehold", key: HOUSEHOLD_A }]);
    // Cookbook B's channel is never touched, and nothing is broadcast.
    expect(recorded.some((r) => r.key === HOUSEHOLD_B)).toBe(false);
    expect(recorded.some((r) => r.method === "broadcast")).toBe(false);
  });

  it("still stops at the household under the LIVE `everyone` policy (sibling case)", () => {
    // `everyone` is not a licence to broadcast — it must clamp to the target household.
    emitImportProgress(scopeForCookbookA("everyone"), { recipeId: "r1", stage: "saving" });

    expect(recorded).toEqual([{ method: "emitToHousehold", key: HOUSEHOLD_A }]);
    expect(recorded.some((r) => r.method === "broadcast")).toBe(false);
  });

  it("scopes a personal import to the importer alone (owner scope / personal key)", () => {
    // Personal import: householdKey === userId, so emitByPolicy routes to the user channel.
    const personalScope: RecipeRealtimeScope = {
      viewPolicy: "everyone",
      ctx: { userId: USER_A, householdKey: USER_A },
    };

    emitImportProgress(personalScope, { recipeId: "r1", stage: "fetching" });

    expect(recorded).toEqual([{ method: "emitToUser", key: USER_A }]);
    expect(recorded.some((r) => r.method === "broadcast")).toBe(false);
    expect(recorded.some((r) => r.method === "emitToHousehold")).toBe(false);
  });
});
