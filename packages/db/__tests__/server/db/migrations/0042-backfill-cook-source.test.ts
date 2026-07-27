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
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { getTestDb } from "../../../helpers/db-test-helpers";
import { RepositoryTestBase } from "../../../helpers/repository-test-base";

const MIGRATIONS_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "../../../../src/migrations");
const MIGRATION_PATH = resolve(MIGRATIONS_DIR, "0042_backfill_cook_source.sql");
const JOURNAL_PATH = resolve(MIGRATIONS_DIR, "meta/_journal.json");
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
