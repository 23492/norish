// @vitest-environment node
/**
 * Migration `0042_backfill_cook_source` (COOK-01 / Phase 27 W5).
 *
 * `0042` carries NO DML — the mutation runs as `backfillCookSource()` at boot
 * (D-27-W5-02). All this migration does is assert its own precondition: `0041`'s
 * natural-key unique index must already exist, because the backfill's UPSERT is
 * meaningless without it. The precondition statement is read OUT OF THE
 * MIGRATION FILE by its `-- [0042:precondition]` marker, so this test can never
 * drift from what actually runs on live.
 */

import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createHousehold, getOrCreateIngredientByName } from "@norish/db";
import { groceries, recipeIngredients, recipes } from "@norish/db/schema";

import { createTestUser, getTestDb } from "../../../helpers/db-test-helpers";
import { RepositoryTestBase } from "../../../helpers/repository-test-base";

const MIGRATIONS_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "../../../../src/migrations");
const MIGRATION_PATH = resolve(MIGRATIONS_DIR, "0042_backfill_cook_source.sql");
const JOURNAL_PATH = resolve(MIGRATIONS_DIR, "meta/_journal.json");
const POSTCHECK_PATH = resolve(MIGRATIONS_DIR, "checks/0042-postcheck.sql");
const UNIQUE_INDEX = "uq_recipe_ingredients_recipe_system_ingredient";

async function readJournal(): Promise<{
  entries: { idx: number; version: string; when: number; tag: string; breakpoints: boolean }[];
}> {
  return JSON.parse(await readFile(JOURNAL_PATH, "utf8"));
}

async function precondition(): Promise<string> {
  const source = await readFile(MIGRATION_PATH, "utf8");
  const statements = source.split("--> statement-breakpoint");
  const statement = statements.find((s) => s.includes("[0042:precondition]"));

  if (!statement) {
    throw new Error("0042 lost its [0042:precondition] marker");
  }

  return statement;
}

describe("migration 0042_backfill_cook_source", () => {
  const testBase = new RepositoryTestBase("migration_0042");

  beforeAll(async () => {
    await testBase.setup();
  });

  afterAll(async () => {
    await testBase.teardown();
  });

  it("_journal.json has 43 entries with last tag 0042_backfill_cook_source", async () => {
    const journal = await readJournal();

    expect(journal.entries).toHaveLength(43);
    expect(journal.entries.at(-1)).toEqual({
      idx: 42,
      version: "7",
      when: 1785369600000,
      tag: "0042_backfill_cook_source",
      breakpoints: true,
    });
  });

  it("has no 0042_snapshot.json", async () => {
    await expect(readFile(resolve(MIGRATIONS_DIR, "meta/0042_snapshot.json"))).rejects.toThrow();
  });

  it("carries no UPDATE, INSERT or DELETE statement (case-insensitive) — the mutation is deliberately not in SQL", async () => {
    const source = await readFile(MIGRATION_PATH, "utf8");
    // Mirrors the acceptance-criteria grep exactly: a STATEMENT starts a line
    // (after whitespace) with one of these verbs. A comment prose mentioning
    // "delete" mid-sentence (as this file's own header does, describing what
    // the natural key protects against) is not a DML statement.
    const dmlLines = source
      .split("\n")
      .filter((line) => /^\s*(update|insert|delete)\b/i.test(line));

    expect(dmlLines).toEqual([]);
  });

  it("executes cleanly on a database that has the 0041 unique index, and changes no row", async () => {
    // `RepositoryTestBase.setup()` applies EVERY `packages/db/src/migrations/*.sql`
    // in filename order, so the unique index already exists here.
    const db = getTestDb();

    await expect(db.execute(sql.raw(await precondition()))).resolves.not.toThrow();
  });

  it("raises when the 0041 natural-key index is missing", async () => {
    const db = getTestDb();

    await db.execute(sql.raw(`DROP INDEX "${UNIQUE_INDEX}"`));

    await expect(db.execute(sql.raw(await precondition()))).rejects.toThrow(/0042 precondition failed/);

    // Recreate it so later tests in this file (and this database's teardown) see
    // the schema unchanged from what every other migration test expects.
    await db.execute(
      sql.raw(
        `CREATE UNIQUE INDEX "${UNIQUE_INDEX}" ON "recipe_ingredients" USING btree ("recipe_id","system_used","ingredient_id")`
      )
    );
  });
});

/**
 * `checks/0042-postcheck.sql` (G1 fix). The PRE and POST sections USED to
 * select `groceries.id` under the alias `recipe_ingredient_id_at_risk` —
 * `groceries.id` and `recipe_ingredients.id` are different uuid spaces, so the
 * POST anti-join (which joins that list against `recipe_ingredients.id`)
 * returned every row as "missing" regardless of whether anything actually
 * broke, making the "zero rows" acceptance criterion unsatisfiable. This
 * suite proves the CORRECTED column both reads right and actually catches a
 * real loss — not just that the alias name looks right.
 */
describe("0042-postcheck.sql: the grocery-link anti-join (G1 fix)", () => {
  const testBase = new RepositoryTestBase("postcheck_0042");

  beforeAll(async () => {
    await testBase.setup();
  });

  afterAll(async () => {
    await testBase.teardown();
  });

  it("PRE and POST both select recipe_ingredient_id, not id, under the recipe_ingredient_id_at_risk alias", async () => {
    const source = await readFile(POSTCHECK_PATH, "utf8");
    const selects = [
      ...source.matchAll(/SELECT\s+"([a-z_]+)"\s+AS\s+recipe_ingredient_id_at_risk/gi),
    ].map((match) => match[1]);

    // One in [PRE], one in [POST].
    expect(selects).toEqual(["recipe_ingredient_id", "recipe_ingredient_id"]);
  });

  it("the corrected anti-join returns the orphaned row when a grocery-linked recipe_ingredients row is gone", async () => {
    const testDb = getTestDb();
    const user = await createTestUser();
    const household = await createHousehold({ name: "G1 fixture", adminUserId: user.id });
    const ingredient = await getOrCreateIngredientByName("orphan-proof flour");
    const [recipe] = await testDb
      .insert(recipes)
      .values({
        userId: user.id,
        householdId: household.id,
        name: "G1 fixture recipe",
        systemUsed: "metric",
      })
      .returning({ id: recipes.id });
    const [ingredientRow] = await testDb
      .insert(recipeIngredients)
      .values({
        recipeId: recipe!.id,
        ingredientId: ingredient.id,
        amount: "1",
        unit: "gram",
        order: "0",
        systemUsed: "metric",
      })
      .returning({ id: recipeIngredients.id });

    await testDb.insert(groceries).values({
      userId: user.id,
      householdId: household.id,
      name: "orphan-proof flour",
      recipeIngredientId: ingredientRow!.id,
    });

    // The [PRE] query as literally written in the .sql file (the corrected
    // column, under its alias).
    const preResult = await testDb.execute(
      sql`SELECT "recipe_ingredient_id" AS recipe_ingredient_id_at_risk FROM "groceries" WHERE "recipe_ingredient_id" IS NOT NULL ORDER BY "id"`
    );
    const preIds = preResult.rows.map(
      (row) => (row as { recipe_ingredient_id_at_risk: string }).recipe_ingredient_id_at_risk
    );

    expect(preIds).toContain(ingredientRow!.id);

    // Simulate the exact failure mode the grocery-link guard exists to
    // prevent: the `recipe_ingredients` row a `groceries` row points at is
    // deleted out from under it (what an unguarded retirement DELETE would do).
    await testDb.delete(recipeIngredients).where(eq(recipeIngredients.id, ingredientRow!.id));

    // The [POST] anti-join from the .sql file, with a real VALUES list in
    // place of the director's manual paste-and-run step.
    const antiJoin = await testDb.execute(sql`
      SELECT v.id
      FROM (VALUES (${ingredientRow!.id}::uuid)) AS v(id)
      LEFT JOIN "recipe_ingredients" ri ON ri."id" = v.id
      WHERE ri."id" IS NULL
    `);

    expect(antiJoin.rows).toHaveLength(1);
    expect((antiJoin.rows[0] as { id: string }).id).toBe(ingredientRow!.id);
  });
});
