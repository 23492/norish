/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

import defaultUnits from "@norish/config/units.default.json";
import { ServerConfigKeys } from "@norish/config/zod/server-config";

const mockGetConfig = vi.fn();

vi.mock("@norish/db/repositories/server-config", () => ({
  getConfig: mockGetConfig,
}));

vi.mock("@norish/db/logger", () => ({
  serverLogger: { info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

describe("isVideoParsingEnabled", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
  });

  it("returns true when both AI and video are enabled", async () => {
    // Arrange
    mockGetConfig.mockImplementation((key: string) => {
      if (key === ServerConfigKeys.AI_CONFIG) {
        return Promise.resolve({ enabled: true });
      }
      if (key === ServerConfigKeys.VIDEO_CONFIG) {
        return Promise.resolve({ enabled: true });
      }

      return Promise.resolve(null);
    });

    const { isVideoParsingEnabled } =
      await import("@norish/shared-server/config/server-config-loader");

    // Act
    const result = await isVideoParsingEnabled();

    // Assert
    expect(result).toBe(true);
  });

  it("returns false when AI is enabled but video is disabled", async () => {
    // Arrange
    mockGetConfig.mockImplementation((key: string) => {
      if (key === ServerConfigKeys.AI_CONFIG) {
        return Promise.resolve({ enabled: true });
      }
      if (key === ServerConfigKeys.VIDEO_CONFIG) {
        return Promise.resolve({ enabled: false });
      }

      return Promise.resolve(null);
    });

    const { isVideoParsingEnabled } =
      await import("@norish/shared-server/config/server-config-loader");

    // Act
    const result = await isVideoParsingEnabled();

    // Assert
    expect(result).toBe(false);
  });

  it("returns false when AI is disabled but video is enabled", async () => {
    // Arrange
    mockGetConfig.mockImplementation((key: string) => {
      if (key === ServerConfigKeys.AI_CONFIG) {
        return Promise.resolve({ enabled: false });
      }
      if (key === ServerConfigKeys.VIDEO_CONFIG) {
        return Promise.resolve({ enabled: true });
      }

      return Promise.resolve(null);
    });

    const { isVideoParsingEnabled } =
      await import("@norish/shared-server/config/server-config-loader");

    // Act
    const result = await isVideoParsingEnabled();

    // Assert
    expect(result).toBe(false);
  });

  it("returns false when both AI and video are disabled", async () => {
    // Arrange
    mockGetConfig.mockImplementation((key: string) => {
      if (key === ServerConfigKeys.AI_CONFIG) {
        return Promise.resolve({ enabled: false });
      }
      if (key === ServerConfigKeys.VIDEO_CONFIG) {
        return Promise.resolve({ enabled: false });
      }

      return Promise.resolve(null);
    });

    const { isVideoParsingEnabled } =
      await import("@norish/shared-server/config/server-config-loader");

    // Act
    const result = await isVideoParsingEnabled();

    // Assert
    expect(result).toBe(false);
  });

  it("returns false when AI config is null", async () => {
    // Arrange
    mockGetConfig.mockImplementation((key: string) => {
      if (key === ServerConfigKeys.AI_CONFIG) {
        return Promise.resolve(null);
      }
      if (key === ServerConfigKeys.VIDEO_CONFIG) {
        return Promise.resolve({ enabled: true });
      }

      return Promise.resolve(null);
    });

    const { isVideoParsingEnabled } =
      await import("@norish/shared-server/config/server-config-loader");

    // Act
    const result = await isVideoParsingEnabled();

    // Assert
    expect(result).toBe(false);
  });

  it("returns false when video config is null", async () => {
    // Arrange
    mockGetConfig.mockImplementation((key: string) => {
      if (key === ServerConfigKeys.AI_CONFIG) {
        return Promise.resolve({ enabled: true });
      }
      if (key === ServerConfigKeys.VIDEO_CONFIG) {
        return Promise.resolve(null);
      }

      return Promise.resolve(null);
    });

    const { isVideoParsingEnabled } =
      await import("@norish/shared-server/config/server-config-loader");

    // Act
    const result = await isVideoParsingEnabled();

    // Assert
    expect(result).toBe(false);
  });

  it("returns false when both configs are null", async () => {
    // Arrange
    mockGetConfig.mockResolvedValue(null);

    const { isVideoParsingEnabled } =
      await import("@norish/shared-server/config/server-config-loader");

    // Act
    const result = await isVideoParsingEnabled();

    // Assert
    expect(result).toBe(false);
  });
});

describe("isAIEnabled", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
  });

  it("returns true when AI is enabled", async () => {
    // Arrange
    mockGetConfig.mockImplementation((key: string) => {
      if (key === ServerConfigKeys.AI_CONFIG) {
        return Promise.resolve({ enabled: true });
      }

      return Promise.resolve(null);
    });

    const { isAIEnabled } = await import("@norish/shared-server/config/server-config-loader");

    // Act
    const result = await isAIEnabled();

    // Assert
    expect(result).toBe(true);
  });

  it("returns false when AI is disabled", async () => {
    // Arrange
    mockGetConfig.mockImplementation((key: string) => {
      if (key === ServerConfigKeys.AI_CONFIG) {
        return Promise.resolve({ enabled: false });
      }

      return Promise.resolve(null);
    });

    const { isAIEnabled } = await import("@norish/shared-server/config/server-config-loader");

    // Act
    const result = await isAIEnabled();

    // Assert
    expect(result).toBe(false);
  });

  it("returns false when AI config is null", async () => {
    // Arrange
    mockGetConfig.mockResolvedValue(null);

    const { isAIEnabled } = await import("@norish/shared-server/config/server-config-loader");

    // Act
    const result = await isAIEnabled();

    // Assert
    expect(result).toBe(false);
  });
});

describe("getUnits", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
  });

  // D-27-W5P-05: the stored map wins per key, but a key present only in the
  // FILE (e.g. a canonical unit added after this install was seeded) still
  // falls through — `resolveUnitsMap` merges the file defaults UNDER the
  // stored map instead of the old wrapped-only-wins-and-nothing-else-appears
  // behavior. So a stored map with exactly one key (`cup`) now returns every
  // other unit from the file, with `cup` overridden by the stored value.
  it("returns wrapped units from config, merged with file defaults", async () => {
    const storedCup = {
      short: [{ locale: "en", name: "cup" }],
      plural: [{ locale: "en", name: "cups" }],
      alternates: ["cups"],
    };

    mockGetConfig.mockResolvedValue({
      units: { cup: storedCup },
      isOverridden: true,
    });

    const { getUnits } = await import("@norish/shared-server/config/server-config-loader");
    const result = await getUnits();

    expect(result).toEqual({ ...defaultUnits, cup: storedCup });
  });

  it("returns legacy flat units map from config, merged with file defaults", async () => {
    const storedCup = {
      short: [{ locale: "en", name: "cup" }],
      plural: [{ locale: "en", name: "cups" }],
      alternates: ["cups"],
    };

    mockGetConfig.mockResolvedValue({ cup: storedCup });

    const { getUnits } = await import("@norish/shared-server/config/server-config-loader");
    const result = await getUnits();

    expect(result).toEqual({ ...defaultUnits, cup: storedCup });
  });

  it("returns legacy wrapped units map from config, merged with file defaults", async () => {
    const storedCup = {
      short: [{ locale: "en", name: "cup" }],
      plural: [{ locale: "en", name: "cups" }],
      alternates: ["cups"],
    };

    mockGetConfig.mockResolvedValue({
      units: { cup: storedCup },
      isOverwritten: true,
    });

    const { getUnits } = await import("@norish/shared-server/config/server-config-loader");
    const result = await getUnits();

    expect(result).toEqual({ ...defaultUnits, cup: storedCup });
  });

  it("falls back to default units when config is missing", async () => {
    mockGetConfig.mockResolvedValue(null);

    const { getUnits } = await import("@norish/shared-server/config/server-config-loader");
    const result = await getUnits();

    expect(result).toEqual(defaultUnits);
  });
});
