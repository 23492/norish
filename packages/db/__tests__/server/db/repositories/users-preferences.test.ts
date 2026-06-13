// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

import { getUserPreferences, updateUserPreferences } from "@norish/db/repositories/users";

// Use hoisted factories so the mocks are available to the hoisted vi.mock call.
const mockFindFirst = vi.hoisted(() => vi.fn());
const mockReturning = vi.hoisted(() => vi.fn());
const mockWhere = vi.hoisted(() => vi.fn(() => ({ returning: mockReturning })));
const mockSet = vi.hoisted(() => vi.fn(() => ({ where: mockWhere })));
const mockUpdate = vi.hoisted(() => vi.fn(() => ({ set: mockSet })));

vi.mock("@norish/db/drizzle", () => ({
  db: {
    query: { users: { findFirst: mockFindFirst } },
    update: mockUpdate,
  },
}));

describe("user preferences repository", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Re-establish the chainable builder after clearing call state.
    mockWhere.mockReturnValue({ returning: mockReturning });
    mockSet.mockReturnValue({ where: mockWhere });
    mockUpdate.mockReturnValue({ set: mockSet });
    mockReturning.mockResolvedValue([{ id: "user-1" }]);
  });

  it("returns empty object when preferences row missing", async () => {
    mockFindFirst.mockResolvedValue(undefined);

    const prefs = await getUserPreferences("user-1");

    expect(prefs).toEqual({});
    expect(mockFindFirst).toHaveBeenCalled();
  });

  it("calls db.update to merge preferences", async () => {
    mockReturning.mockResolvedValue([{ id: "user-1" }]);

    await expect(
      updateUserPreferences("user-1", { timersEnabled: false })
    ).resolves.toEqual({ applied: true, stale: false, value: undefined });

    expect(mockUpdate).toHaveBeenCalled();
    expect(mockSet).toHaveBeenCalled();
  });

  it("rethrows if db.update fails", async () => {
    mockReturning.mockRejectedValue(new Error("boom"));

    await expect(updateUserPreferences("user-1", { showConversionButton: true })).rejects.toThrow(
      "boom"
    );
  });
});
