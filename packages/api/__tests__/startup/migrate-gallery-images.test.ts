// @vitest-environment node
/**
 * `migrateGalleryImages` — the boot-time recipe-image URL migration.
 *
 * WHAT THIS FILE ASSERTS is a pure rewrite contract: given rows carrying legacy
 * image URLs and a real uploads directory, which URLs get rewritten and which are
 * refused because the file is not on disk. Nothing here is about time.
 *
 * ⚠ THE SUBJECT IS IMPORTED AT FILE SCOPE, ONCE — DO NOT MOVE IT BACK INTO A TEST
 * OR A HOOK. It used to be `await import()`ed inside each test, behind
 * `vi.resetModules()` + a per-test `vi.doMock` of the uploads dir. That charged the
 * transform and evaluation of the whole `@norish/db/repositories/recipes` graph to
 * the per-test wall budget: **2 747 ms measured against vitest's default 5 000 ms
 * `testTimeout`, i.e. 1.8x of headroom**, on a quantity §13.1 of
 * `27-04-SUMMARY.md` measured inflating **7.5x-11.6x under host load**. It failed
 * `Test timed out in 5000ms` in 3 of 3 full-suite runs under contention and passed
 * every time in isolation — the same wall-clock-under-contention disease
 * D-27-W3B-03a diagnosed for the parse bound and §15.3 for the pool's latency
 * assertion. The cure is theirs: take the load-dependent quantity OUT of what is
 * being bounded, do not re-budget it. A top-level `await import` runs during file
 * COLLECTION, which neither `testTimeout` nor `hookTimeout` bounds, and it runs
 * once instead of once per test. Every mock seam and every assertion below is
 * unchanged; what changed is only where the module load is accounted.
 *
 * Consequences of importing once, both deliberate:
 *   - ONE uploads dir for the file, created synchronously before the import so the
 *     `SERVER_CONFIG` mock can be static (the subject freezes `RECIPES_DIR` at
 *     module load). `beforeEach` re-creates an empty `<uploadsDir>/recipes`, which
 *     is the only state either test reads, so the tests stay isolated.
 *   - no `vi.resetModules()`: the subject holds no module-level mutable state, only
 *     the frozen `RECIPES_DIR`, and re-evaluating the graph per test was the cost
 *     this file exists to stop paying.
 */
import { mkdtempSync } from "node:fs";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

const mockInfo = vi.fn();
const mockWarn = vi.fn();
const mockDebug = vi.fn();
const mockError = vi.fn();
const mockSelect = vi.fn();
const mockUpdate = vi.fn();

const recipesTable = { table: "recipes" };
const recipeImagesTable = { table: "recipe_images" };

vi.mock("@norish/shared-server/logger", () => ({
  dbLogger: {
    info: mockInfo,
    warn: mockWarn,
    debug: mockDebug,
    error: mockError,
  },
}));

vi.mock("@norish/db/schema", () => ({
  recipes: recipesTable,
  recipeImages: recipeImagesTable,
}));

vi.mock("@norish/db/drizzle", () => ({
  db: {
    select: mockSelect,
    update: mockUpdate,
  },
}));

/**
 * Created synchronously, before the subject is imported, because the subject
 * freezes `RECIPES_DIR = join(SERVER_CONFIG.UPLOADS_DIR, "recipes")` at module
 * load. The `vi.mock` factory above reads this binding when the subject pulls
 * `@norish/config/env-config-server` in, which is on the `await import` below —
 * after this line, so there is no temporal-dead-zone hazard.
 */
const uploadsDir = mkdtempSync(path.join(os.tmpdir(), "norish-migrate-images-"));

vi.mock("@norish/config/env-config-server", () => ({
  SERVER_CONFIG: {
    MASTER_KEY: "QmFzZTY0RW5jb2RlZE1hc3RlcktleU1pbjMyQ2hhcnM=",
    UPLOADS_DIR: uploadsDir,
  },
}));

const { migrateGalleryImages } = await import("@norish/api/startup/migrate-gallery-images");

describe("migrateGalleryImages", () => {
  let selectResults: unknown[][];
  const updates: Array<{ table: unknown; values: unknown }> = [];

  beforeEach(async () => {
    vi.clearAllMocks();
    updates.length = 0;
    selectResults = [];

    await fs.rm(path.join(uploadsDir, "recipes"), { recursive: true, force: true });
    await fs.mkdir(path.join(uploadsDir, "recipes"), { recursive: true });

    mockSelect.mockImplementation(() => ({
      from: () => ({
        where: async () => selectResults.shift() ?? [],
      }),
    }));

    mockUpdate.mockImplementation((table: unknown) => ({
      set: (values: unknown) => ({
        where: async () => {
          updates.push({ table, values });
        },
      }),
    }));
  });

  afterAll(async () => {
    await fs.rm(uploadsDir, { recursive: true, force: true });
  });

  it("skips recipe and gallery URL rewrites when referenced files are missing", async () => {
    selectResults = [
      [
        {
          id: "11111111-1111-1111-1111-111111111111",
          image: "/recipes/images/missing-cover.jpg",
        },
      ],
      [
        {
          id: "image-1",
          recipeId: "11111111-1111-1111-1111-111111111111",
          image: "/recipes/11111111-1111-1111-1111-111111111111/gallery/missing-gallery.jpg",
        },
      ],
    ];

    await migrateGalleryImages();

    expect(updates).toEqual([]);
    expect(mockWarn).toHaveBeenCalledWith(
      expect.objectContaining({
        recipeId: "11111111-1111-1111-1111-111111111111",
        oldUrl: "/recipes/images/missing-cover.jpg",
        expectedFilename: "missing-cover.jpg",
      }),
      "Skipping thumbnail URL migration because the image file was not found on disk"
    );
    expect(mockWarn).toHaveBeenCalledWith(
      expect.objectContaining({
        imageId: "image-1",
        recipeId: "11111111-1111-1111-1111-111111111111",
        oldUrl: "/recipes/11111111-1111-1111-1111-111111111111/gallery/missing-gallery.jpg",
        expectedFilename: "missing-gallery.jpg",
      }),
      "Skipping recipe image URL migration because the image file was not found on disk"
    );
    expect(mockWarn).toHaveBeenCalledWith(
      expect.objectContaining({ skipped: 2, uploadsDir }),
      "Recipe image migration skipped database URL updates because referenced files are missing"
    );
  });

  it("rewrites old URLs when the referenced files exist on disk", async () => {
    const recipeId = "22222222-2222-2222-2222-222222222222";

    await fs.mkdir(path.join(uploadsDir, "recipes", recipeId, "gallery"), { recursive: true });
    await fs.writeFile(path.join(uploadsDir, "recipes", recipeId, "cover.jpg"), "cover");
    await fs.writeFile(
      path.join(uploadsDir, "recipes", recipeId, "gallery", "gallery.jpg"),
      "gallery"
    );

    selectResults = [
      [
        {
          id: recipeId,
          image: "/recipes/images/cover.jpg",
        },
      ],
      [
        {
          id: "image-2",
          recipeId,
          image: `/recipes/${recipeId}/gallery/gallery.jpg`,
        },
      ],
    ];

    await migrateGalleryImages();

    expect(updates).toEqual([
      {
        table: recipesTable,
        values: { image: `/recipes/${recipeId}/cover.jpg` },
      },
      {
        table: recipeImagesTable,
        values: { image: `/recipes/${recipeId}/gallery.jpg` },
      },
    ]);
    expect(mockWarn).not.toHaveBeenCalledWith(
      expect.anything(),
      expect.stringContaining("was not found on disk")
    );
  });
});
