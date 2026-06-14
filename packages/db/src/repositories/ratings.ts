import { and, avg, count, desc, eq, sql } from "drizzle-orm";
import { decrypt } from "@norish/auth/crypto";

import { db } from "../drizzle";
import { recipeRatings, users } from "../schema";

export interface RatingStats {
  averageRating: number | null;
  ratingCount: number;
}

export interface RecipeRater {
  userId: string;
  name: string | null;
  rating: number;
  updatedAt: Date;
}

export async function rateRecipe(
  userId: string,
  recipeId: string,
  rating: number,
  version?: number
): Promise<{ rating: number; isNew: boolean; stale?: boolean }> {
  const existing = await db
    .select({ id: recipeRatings.id })
    .from(recipeRatings)
    .where(and(eq(recipeRatings.userId, userId), eq(recipeRatings.recipeId, recipeId)))
    .limit(1);

  if (existing.length > 0) {
    const whereConditions = [
      eq(recipeRatings.userId, userId),
      eq(recipeRatings.recipeId, recipeId),
    ];

    if (version) {
      whereConditions.push(eq(recipeRatings.version, version));
    }

    const result = await db
      .update(recipeRatings)
      .set({ rating, updatedAt: new Date(), version: sql`${recipeRatings.version} + 1` })
      .where(and(...whereConditions));

    if (result.rowCount === 0 && version) {
      // Version mismatch — stale write, safe no-op
      return { rating, isNew: false, stale: true };
    }

    return { rating, isNew: false };
  }

  await db.insert(recipeRatings).values({ userId, recipeId, rating });

  return { rating, isNew: true };
}

export async function getUserRating(userId: string, recipeId: string): Promise<number | null> {
  const result = await db
    .select({ rating: recipeRatings.rating })
    .from(recipeRatings)
    .where(and(eq(recipeRatings.userId, userId), eq(recipeRatings.recipeId, recipeId)))
    .limit(1);

  return result[0]?.rating ?? null;
}

export async function getUserRatingWithVersion(
  userId: string,
  recipeId: string
): Promise<{ rating: number | null; version: number | null }> {
  const result = await db
    .select({ rating: recipeRatings.rating, version: recipeRatings.version })
    .from(recipeRatings)
    .where(and(eq(recipeRatings.userId, userId), eq(recipeRatings.recipeId, recipeId)))
    .limit(1);

  return {
    rating: result[0]?.rating ?? null,
    version: result[0]?.version ?? null,
  };
}

export async function getAverageRating(recipeId: string): Promise<RatingStats> {
  const result = await db
    .select({
      averageRating: avg(recipeRatings.rating),
      ratingCount: count(recipeRatings.id),
    })
    .from(recipeRatings)
    .where(eq(recipeRatings.recipeId, recipeId));

  const row = result[0];

  return {
    averageRating: row?.averageRating ? parseFloat(row.averageRating) : null,
    ratingCount: Number(row?.ratingCount ?? 0),
  };
}

/**
 * RATE-01: every user who rated this recipe, with their display name and stars,
 * most-recent rating first. The user's `name` is encrypted at rest (mirrors
 * getUsersByIds), so it is decrypted here; a missing/undecryptable name yields
 * null so the UI can fall back gracefully. Access control is the CALLER'S job —
 * the ratings router gates this on assertRecipeAccess(view) before exposing any
 * name, so a user who cannot view the recipe cannot read its raters.
 */
export async function getRecipeRaters(recipeId: string): Promise<RecipeRater[]> {
  const rows = await db
    .select({
      userId: recipeRatings.userId,
      name: users.name,
      rating: recipeRatings.rating,
      updatedAt: recipeRatings.updatedAt,
    })
    .from(recipeRatings)
    .innerJoin(users, eq(recipeRatings.userId, users.id))
    .where(eq(recipeRatings.recipeId, recipeId))
    .orderBy(desc(recipeRatings.updatedAt));

  return rows.map((row) => ({
    userId: row.userId,
    name: row.name ? decrypt(row.name) : null,
    rating: row.rating,
    updatedAt: row.updatedAt,
  }));
}
