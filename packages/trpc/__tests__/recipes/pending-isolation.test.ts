// @vitest-environment node
/**
 * PENDING-ISO-01 — `recipes.getPending` must not widen across households.
 *
 * `getPending`'s filter (`packages/trpc/src/routers/recipes/pending.ts:29-32`) reads:
 *
 *   case "everyone":
 *     // Everyone can see all pending imports
 *     return true;
 *
 * Live runs `view: "everyone"` — the shipped default — so this branch is the one
 * production actually executes: every authenticated caller was served EVERY
 * household's queued imports, `recipeId` AND the source `url`. This is the fourth
 * member of the family AGENTS.md documents (REALTIME-ISO-01, IMPORT-DEDUP-ISO-01,
 * LIST-ISO-01; TAGS-ISO-01 is a fifth) — a code path treating `everyone` as
 * *unscoped* instead of clamping it to the cookbook.
 *
 * This drives the REAL `pendingProcedures` router rather than a reimplementation
 * of its filter in a test router. Every leak in this family survived a green suite
 * that tested the layer below the defect.
 *
 * Every case here runs under `household`, `everyone` AND `owner` — the fork's rule
 * is that a policy-seeding test with no `everyone` sibling is worthless, because
 * `everyone` IS the live policy. Assertions are made on the disclosed `url`, not
 * only on row counts, because the url is the field that actually discloses what
 * another cookbook is importing.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { RecipeImportJobData } from "@norish/queue/contracts/job-types";

/** Minimal BullMQ `Job` shape — only `.data` and `.timestamp` are read by `pending.ts`. */
interface FakeJob<T> {
  data: T;
  timestamp: number;
}

const getRecipePermissionPolicyMock = vi.hoisted(() => vi.fn());
const recipeImportGetJobsMock = vi.hoisted(() => vi.fn());

// publicProcedure carries the logger middleware, which writes api_logs; without a
// DB that throws (caught, but noisy).
vi.mock("@norish/db/repositories/api-logs", () => ({ insertApiLog: vi.fn() }));

// The middleware is not what is under test here — it only builds ctx, and doing
// so for real needs a DB. Stubbing it to a pass-through keeps the REAL `pending`
// resolvers (the thing that contains the defect) executing verbatim.
vi.mock("@norish/trpc/middleware", async () => {
  const { publicProcedure } = await import("@norish/trpc/trpc");

  return { authedProcedure: publicProcedure };
});

vi.mock("@norish/shared-server/config/server-config-loader", () => ({
  getRecipePermissionPolicy: getRecipePermissionPolicyMock,
}));

vi.mock("@norish/queue/registry", () => ({
  getQueues: () => ({
    recipeImport: { getJobs: recipeImportGetJobsMock },
  }),
}));

/** The LIVE server-wide policy — kept named so the intent at each call site is explicit. */
const LIVE_SERVER_POLICY = { view: "everyone", edit: "household", delete: "household" } as const;

// Four distinct, recognisable urls so an assertion can name exactly which
// cookbook's job leaked into whose result.
const URL_A = "https://cookbook-a.example/recipe-a";
const URL_B = "https://cookbook-b.example/recipe-b";
const URL_A_IN_B = "https://cookbook-a.example/recipe-a-in-b";
const URL_PERSONAL = "https://personal.example/recipe-p";

/** Owned by user-a, queued into cookbook A. */
const JOB_A: FakeJob<RecipeImportJobData> = {
  data: {
    url: URL_A,
    recipeId: "recipe-a",
    userId: "user-a",
    householdKey: "cookbook-a",
    householdUserIds: ["user-a"],
    householdId: "cookbook-a",
  },
  timestamp: 1000,
};

/** Owned by user-b, queued into cookbook B — the job that must never reach cookbook A. */
const JOB_B: FakeJob<RecipeImportJobData> = {
  data: {
    url: URL_B,
    recipeId: "recipe-b",
    userId: "user-b",
    householdKey: "cookbook-b",
    householdUserIds: ["user-b"],
    householdId: "cookbook-b",
  },
  timestamp: 2000,
};

/** Owned by user-a but queued into cookbook B — pins that owner-view clamps on userId, not householdKey. */
const JOB_A_IN_B: FakeJob<RecipeImportJobData> = {
  data: {
    url: URL_A_IN_B,
    recipeId: "recipe-a-in-b",
    userId: "user-a",
    householdKey: "cookbook-b",
    householdUserIds: ["user-b"],
    householdId: "cookbook-b",
  },
  timestamp: 3000,
};

/** A personal import: no active household, so `householdKey === userId` (middleware.ts). */
const JOB_PERSONAL: FakeJob<RecipeImportJobData> = {
  data: {
    url: URL_PERSONAL,
    recipeId: "recipe-p",
    userId: "user-p",
    householdKey: "user-p",
    householdUserIds: null,
    householdId: null,
  },
  timestamp: 4000,
};

const ALL_JOBS = [JOB_A, JOB_B, JOB_A_IN_B, JOB_PERSONAL];

function ctxFor(userId: string, householdKey: string, isServerAdmin = false) {
  return { user: { id: userId }, householdKey, isServerAdmin };
}

const VIEWER_A = ctxFor("user-a", "cookbook-a");
const VIEWER_A_ADMIN = ctxFor("user-a", "cookbook-a", true);
const VIEWER_B = ctxFor("user-b", "cookbook-b");
/** No active cookbook: `householdKey === user.id` (middleware: `household?.id ?? user.id`). */
const VIEWER_PERSONAL = ctxFor("user-p", "user-p");

async function callGetPending(ctx: ReturnType<typeof ctxFor>) {
  const { pendingProcedures } = await import("@norish/trpc/routers/recipes/pending");

  return pendingProcedures.createCaller(ctx as never).getPending();
}

describe("recipes.getPending never widens across households (PENDING-ISO-01)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    recipeImportGetJobsMock.mockResolvedValue(ALL_JOBS);
  });

  describe.each(["household", "everyone", "owner"] as const)("under policy.view=%s", (view) => {
    beforeEach(() => {
      getRecipePermissionPolicyMock.mockResolvedValue({
        view,
        edit: "household",
        delete: "household",
      });
    });

    const isOwnerView = view === "owner";

    it("never discloses cookbook B's url to cookbook A's caller", async () => {
      const result = await callGetPending(VIEWER_A);
      const urls = result.map((r) => r.url);

      expect(urls).not.toContain(URL_B);

      if (isOwnerView) {
        // Owner-scoped: user-a's own jobs, including the one queued into cookbook B.
        expect(urls).toEqual(expect.arrayContaining([URL_A, URL_A_IN_B]));
        expect(urls).not.toContain(URL_PERSONAL);
      } else {
        // household/everyone share one clamp: only cookbook A's own job.
        expect(urls).toEqual([URL_A]);
      }
    });

    it("never discloses cookbook A's own job to cookbook B's caller", async () => {
      const result = await callGetPending(VIEWER_B);
      const urls = result.map((r) => r.url);

      expect(urls).not.toContain(URL_A);
      expect(urls).not.toContain(URL_PERSONAL);

      if (isOwnerView) {
        // Owner-scoped: user-b owns only JOB_B. JOB_A_IN_B belongs to user-a, not
        // user-b, so it must not appear under owner view either.
        expect(urls).toEqual([URL_B]);
      } else {
        // household/everyone clamp on householdKey alone: JOB_A_IN_B was queued
        // INTO cookbook B's household (its `householdKey` is "cookbook-b"), so
        // cookbook B legitimately sees it in their own queue — that is not a leak,
        // it is user-a's job showing up in the household it was actually queued
        // into. Only the `owner` level distinguishes by who queued it.
        expect(urls).toEqual(expect.arrayContaining([URL_B, URL_A_IN_B]));
      }
    });

    it("clamps a personal-scope caller (no active cookbook) to their own jobs only", async () => {
      const result = await callGetPending(VIEWER_PERSONAL);
      const urls = result.map((r) => r.url);

      expect(urls).toEqual([URL_PERSONAL]);
    });

    it("clamps an isServerAdmin caller identically to a normal caller — no admin escape hatch", async () => {
      const normal = await callGetPending(VIEWER_A);
      const admin = await callGetPending(VIEWER_A_ADMIN);

      expect(admin).toEqual(normal);
    });

    it("still returns the caller's OWN in-flight import (the dashboard skeleton case)", async () => {
      const result = await callGetPending(VIEWER_A);

      expect(result.map((r) => r.recipeId)).toContain("recipe-a");
    });

    it("maps recipeId/url/addedAt from job.data and job.timestamp, unchanged", async () => {
      const result = await callGetPending(VIEWER_A);
      const jobAEntry = result.find((r) => r.recipeId === "recipe-a");

      expect(jobAEntry).toEqual({ recipeId: "recipe-a", url: URL_A, addedAt: 1000 });
    });

    it('queries the queue with exactly ["waiting", "active", "delayed"]', async () => {
      await callGetPending(VIEWER_A);

      expect(recipeImportGetJobsMock).toHaveBeenCalledWith(["waiting", "active", "delayed"]);
    });
  });

  it("still serves the caller's own cookbook under the LIVE server-wide policy", async () => {
    getRecipePermissionPolicyMock.mockResolvedValue(LIVE_SERVER_POLICY);

    const result = await callGetPending(VIEWER_A);

    expect(result.map((r) => r.url)).toEqual([URL_A]);
  });
});
