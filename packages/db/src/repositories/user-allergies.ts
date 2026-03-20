import { eq, inArray, sql } from "drizzle-orm";
import { db } from "@norish/db/drizzle";
import { tags, userAllergies, users } from "@norish/db/schema";

import { getOrCreateManyTags } from "./tags";

export async function getUserAllergies(
  userId: string
): Promise<{ allergies: string[]; version: number }> {
  const [userRow, rows] = await Promise.all([
    db
      .select({ version: users.version })
      .from(users)
      .where(eq(users.id, userId))
      .limit(1)
      .then((result) => result[0] ?? null),
    db
      .select({ name: tags.name, version: userAllergies.version })
    .from(userAllergies)
    .innerJoin(tags, eq(userAllergies.tagId, tags.id))
    .where(eq(userAllergies.userId, userId))
      .orderBy(sql`lower(${tags.name})`),
  ]);

  const allergyVersion = rows.reduce((max, row) => Math.max(max, row.version), 0);

  return {
    allergies: rows.map((row) => row.name),
    version: Math.max(userRow?.version ?? 0, allergyVersion),
  };
}

export async function getAllergiesForUsers(
  userIds: string[]
): Promise<{ userId: string; tagName: string }[]> {
  if (userIds.length === 0) return [];

  const rows = await db
    .select({
      userId: userAllergies.userId,
      tagName: tags.name,
    })
    .from(userAllergies)
    .innerJoin(tags, eq(userAllergies.tagId, tags.id))
    .where(inArray(userAllergies.userId, userIds));

  return rows;
}

export async function updateUserAllergies(
  userId: string,
  allergyNames: string[],
  currentVersion: number
): Promise<void> {
  await db.transaction(async (tx) => {
    const [userRow] = await tx
      .select({ version: users.version })
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);

    const existingAllergies = await tx
      .select({ version: userAllergies.version })
      .from(userAllergies)
      .where(eq(userAllergies.userId, userId));

    const nextVersion = Math.max(
      currentVersion,
      userRow?.version ?? 0,
      ...existingAllergies.map((row) => row.version)
    ) + 1;

    await tx.update(users).set({ version: nextVersion }).where(eq(users.id, userId));

    // Delete existing allergies
    await tx.delete(userAllergies).where(eq(userAllergies.userId, userId));

    if (allergyNames.length === 0) return;

    // Get or create tags
    const tagRecords = await getOrCreateManyTags(allergyNames);

    // Insert new allergies
    const rows = tagRecords.map((tag) => ({
      userId,
      tagId: tag.id,
      version: nextVersion,
    }));

    await tx.insert(userAllergies).values(rows).onConflictDoNothing();
  });
}
