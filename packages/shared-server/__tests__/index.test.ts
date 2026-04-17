import { afterEach, describe, expect, it, vi } from "vitest";

afterEach(() => {
  vi.resetModules();
  vi.restoreAllMocks();
});

describe("getAppVersions", () => {
  it("falls back when the mobile workspace is not present", async () => {
    vi.doMock("node:fs/promises", () => ({
      readFile: vi.fn(async (filePath: string) => {
        if (filePath === "package.json") {
          return JSON.stringify({ version: "1.2.3" });
        }

        if (filePath === "apps/web/package.json") {
          return JSON.stringify({ version: "4.5.6" });
        }

        if (filePath === "apps/mobile/package.json") {
          throw new Error("missing mobile package");
        }

        throw new Error(`unexpected path: ${filePath}`);
      }),
    }));

    vi.doMock("../src/lib/workspace-paths.ts", () => ({
      resolveExistingWorkspacePath: vi.fn((relativePath: string) => relativePath),
    }));

    const { getAppVersions } = await import("../src/index.ts");

    await expect(getAppVersions()).resolves.toEqual({
      app: "1.2.3",
      web: "4.5.6",
      mobile: "unavailable",
    });
  });
});
