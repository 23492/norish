// @vitest-environment node

import { GET as getSharedRecipeMedia } from "@/app/share/[token]/media/[filename]/route";
import { GET as getSharedStepMedia } from "@/app/share/[token]/steps/[filename]/route";
import { beforeEach, describe, expect, it, vi } from "vitest";

const statMock = vi.hoisted(() => vi.fn());
const readFileMock = vi.hoisted(() => vi.fn());
const getActiveRecipeShareByTokenMock = vi.hoisted(() => vi.fn());
const getSessionMock = vi.hoisted(() => vi.fn());
const getRecipeOwnerAndHouseholdMock = vi.hoisted(() => vi.fn());
const getUserHouseholdIdsMock = vi.hoisted(() => vi.fn());
const getHouseholdPolicyMock = vi.hoisted(() => vi.fn());

vi.mock("node:fs/promises", () => ({
  default: {
    stat: statMock,
    readFile: readFileMock,
  },
}));

vi.mock("@norish/db/repositories/recipe-shares", () => ({
  getActiveRecipeShareByToken: getActiveRecipeShareByTokenMock,
}));

vi.mock("@norish/auth/auth", () => ({
  auth: { api: { getSession: getSessionMock } },
}));

vi.mock("@norish/db/repositories/recipes", () => ({
  getRecipeOwnerAndHousehold: getRecipeOwnerAndHouseholdMock,
}));

vi.mock("@norish/db/repositories/households", () => ({
  getUserHouseholdIds: getUserHouseholdIdsMock,
  getHouseholdPolicy: getHouseholdPolicyMock,
  getHouseholdForUser: vi.fn(),
}));

describe("recipe media share access", () => {
  const recipeId = "123e4567-e89b-12d3-a456-426614174000";

  beforeEach(() => {
    vi.clearAllMocks();
    statMock.mockResolvedValue({ size: 12 });
    readFileMock.mockResolvedValue(Buffer.from("file-bytes"));
  });

  it("serves shared recipe media anonymously with no-store cache headers", async () => {
    getActiveRecipeShareByTokenMock.mockResolvedValue({ id: "share-1", recipeId });

    const response = await getSharedRecipeMedia(
      new Request("http://localhost/share/public-token/media/cover.jpg"),
      { params: Promise.resolve({ token: "public-token", filename: "cover.jpg" }) }
    );

    expect(response.status).toBe(200);
    expect(getActiveRecipeShareByTokenMock).toHaveBeenCalledWith("public-token", {
      touchLastAccessedAt: true,
    });
    expect(response.headers.get("Cache-Control")).toBe("no-store");
  });

  it("returns not found for invalid shared media tokens", async () => {
    getActiveRecipeShareByTokenMock.mockResolvedValue(null);

    const response = await getSharedRecipeMedia(
      new Request("http://localhost/share/bad-token/media/cover.jpg"),
      {
        params: Promise.resolve({ token: "bad-token", filename: "cover.jpg" }),
      }
    );

    expect(response.status).toBe(404);
  });

  it("serves shared step media anonymously with no-store cache headers", async () => {
    getActiveRecipeShareByTokenMock.mockResolvedValue({ id: "share-1", recipeId });

    const response = await getSharedStepMedia(
      new Request("http://localhost/share/public-token/steps/step.jpg"),
      { params: Promise.resolve({ token: "public-token", filename: "step.jpg" }) }
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
  });
});

/**
 * MEDIA-AUTHZ-01 — the AUTHENTICATED media routes must authorize, not just authenticate.
 *
 * `apps/web/proxy.ts` covers these paths but checks `session?.user` only — i.e. *any*
 * logged-in user, not *this* user. The route handlers and `lib/recipe-media.ts` carry no
 * access check at all (grep for `canAccess|getSession|household|auth` in either: 0 hits).
 *
 * Paired with VIEW-ISO-01 this composes: `getById` returns FullRecipeSchema, which carries
 * `images`/`videos`, so an attacker who can read the recipe also learns the filenames.
 */
describe("recipe media authorization (MEDIA-AUTHZ-01)", () => {
  const recipeInA = "123e4567-e89b-12d3-a456-426614174000";

  beforeEach(() => {
    vi.clearAllMocks();
    statMock.mockResolvedValue({ size: 12 });
    readFileMock.mockResolvedValue(Buffer.from("file-bytes"));
    getSessionMock.mockResolvedValue({ user: { id: "user-in-B", isServerAdmin: false } });
    getRecipeOwnerAndHouseholdMock.mockResolvedValue({
      userId: "user-in-A",
      householdId: "cookbook-A",
    });
    getUserHouseholdIdsMock.mockResolvedValue(["cookbook-B"]);
    // Cookbook A carries the SHIPPED default, exactly as both live cookbooks do.
    getHouseholdPolicyMock.mockResolvedValue({
      policy: { view: "everyone", edit: "household", delete: "household" },
      adminUserId: "admin-of-A",
    });
  });

  it("denies a member of cookbook B the media of a recipe in cookbook A", async () => {
    const { GET } = await import("@/app/(app)/recipes/[id]/[filename]/route");

    const response = await GET(
      new Request(`http://localhost/recipes/${recipeInA}/cover.jpg`),
      { params: Promise.resolve({ id: recipeInA, filename: "cover.jpg" }) }
    );

    expect(response.status).not.toBe(200);
    expect(readFileMock).not.toHaveBeenCalled();
  });

  it("denies an anonymous caller outright", async () => {
    getSessionMock.mockResolvedValue(null);

    const { GET } = await import("@/app/(app)/recipes/[id]/[filename]/route");

    const response = await GET(
      new Request(`http://localhost/recipes/${recipeInA}/cover.jpg`),
      { params: Promise.resolve({ id: recipeInA, filename: "cover.jpg" }) }
    );

    expect(response.status).not.toBe(200);
    expect(readFileMock).not.toHaveBeenCalled();
  });

  it("still serves a MEMBER of the recipe's own cookbook", async () => {
    getUserHouseholdIdsMock.mockResolvedValue(["cookbook-A"]);

    const { GET } = await import("@/app/(app)/recipes/[id]/[filename]/route");

    const response = await GET(
      new Request(`http://localhost/recipes/${recipeInA}/cover.jpg`),
      { params: Promise.resolve({ id: recipeInA, filename: "cover.jpg" }) }
    );

    expect(response.status).toBe(200);
  });

  it("still serves the OWNER their own recipe media", async () => {
    getSessionMock.mockResolvedValue({ user: { id: "user-in-A", isServerAdmin: false } });
    getUserHouseholdIdsMock.mockResolvedValue([]);

    const { GET } = await import("@/app/(app)/recipes/[id]/[filename]/route");

    const response = await GET(
      new Request(`http://localhost/recipes/${recipeInA}/cover.jpg`),
      { params: Promise.resolve({ id: recipeInA, filename: "cover.jpg" }) }
    );

    expect(response.status).toBe(200);
  });

  it("denies cross-cookbook access to STEP media too", async () => {
    const { GET } = await import("@/app/(app)/recipes/[id]/steps/[filename]/route");

    const response = await GET(
      new Request(`http://localhost/recipes/${recipeInA}/steps/step.jpg`),
      { params: Promise.resolve({ id: recipeInA, filename: "step.jpg" }) }
    );

    expect(response.status).not.toBe(200);
    expect(readFileMock).not.toHaveBeenCalled();
  });
});
