// @vitest-environment node
/**
 * TAGS-ISO-01 — the tag list must not widen across households.
 *
 * `config.tags` chose its data source from the SERVER-WIDE view policy:
 *
 *   policy.view === "everyone" || ctx.isServerAdmin
 *     ? await listAllTagNames()          // every tag on the server
 *     : await listTagNamesForUsers(ctx.userIds)
 *
 * Live runs `view: "everyone"` — the shipped default — so every user was served every
 * household's tags. Tags are user-authored (diet labels, occasion names), so this is the
 * same family as REALTIME-ISO-01 / IMPORT-DEDUP-ISO-01 / LIST-ISO-01 / VIEW-ISO-01: a
 * server-wide `everyone` standing in for a per-cookbook boundary.
 *
 * Server admins keep the wide view — that is a role, not a policy level.
 *
 * This drives the REAL `configProcedures` router rather than a reimplementation of its
 * logic in a test router. Every leak in this family survived a green suite that tested
 * the layer below the defect.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const listAllTagNamesMock = vi.hoisted(() => vi.fn());
const listTagNamesForUsersMock = vi.hoisted(() => vi.fn());
const getRecipePermissionPolicyMock = vi.hoisted(() => vi.fn());

// publicProcedure carries the logger middleware, which writes api_logs; without a DB
// that throws (caught, but noisy).
vi.mock("@norish/db/repositories/api-logs", () => ({ insertApiLog: vi.fn() }));

vi.mock("@norish/db/repositories/tags", () => ({
  listAllTagNames: listAllTagNamesMock,
  listTagNamesForUsers: listTagNamesForUsersMock,
}));

// The middleware is not what is under test here — it only builds ctx, and doing so for
// real needs a DB. Stubbing it to a pass-through keeps the REAL `tags` resolver (the
// thing that contains the defect) executing verbatim.
vi.mock("@norish/trpc/middleware", async () => {
  const { publicProcedure } = await import("@norish/trpc/trpc");

  return { authedProcedure: publicProcedure };
});

vi.mock("@norish/shared-server/config/server-config-loader", () => ({
  getRecipePermissionPolicy: getRecipePermissionPolicyMock,
  getLocaleConfig: vi.fn(),
  getRecurrenceConfig: vi.fn(),
  getTimerKeywords: vi.fn(),
  getUnits: vi.fn(),
  isRegistrationEnabled: vi.fn(),
  isTimersEnabled: vi.fn(),
}));

const EVERY_TAG_ON_THE_SERVER = ["cookbook-a-tag", "cookbook-b-tag"];
const OWN_TAGS = ["cookbook-a-tag"];

/** The LIVE server-wide policy on 2026-07-21. */
const LIVE_SERVER_POLICY = { view: "everyone", edit: "household", delete: "household" } as const;

describe("config.tags never widens across households (TAGS-ISO-01)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    listAllTagNamesMock.mockResolvedValue(EVERY_TAG_ON_THE_SERVER);
    listTagNamesForUsersMock.mockResolvedValue(OWN_TAGS);
    getRecipePermissionPolicyMock.mockResolvedValue(LIVE_SERVER_POLICY);
  });

  async function callTags(ctx: Record<string, unknown>) {
    const { configProcedures } = await import("@norish/trpc/routers/config/procedures");

    return configProcedures.createCaller(ctx as never).tags();
  }

  it("does not serve every household's tags to a normal user under view=everyone", async () => {
    const result = await callTags({
      user: { id: "user-a" },
      userIds: ["user-a"],
      isServerAdmin: false,
    });

    expect(listAllTagNamesMock).not.toHaveBeenCalled();
    expect(result.tags).toEqual(OWN_TAGS);
  });

  it("still serves the full list to a server admin (a role, not a policy level)", async () => {
    const result = await callTags({
      user: { id: "admin" },
      userIds: ["admin"],
      isServerAdmin: true,
    });

    expect(result.tags).toEqual(EVERY_TAG_ON_THE_SERVER);
  });
});
