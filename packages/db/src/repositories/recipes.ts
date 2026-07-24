import { and, asc, desc, eq, gt, ilike, inArray, isNull, like, lte, or, sql } from "drizzle-orm";
import z from "zod";

import type { RecipePermissionPolicy } from "@norish/config/zod/server-config";
import type {
  CookTokensDTO,
  FullRecipeDTO,
  FullRecipeInsertDTO,
  FullRecipeUpdateDTO,
  MeasurementSystem,
  RecipeCategory,
  RecipeDashboardDTO,
  RecipeVisibility,
} from "@norish/shared/contracts/dto/recipe";
import type {
  RecipeIngredientInsertDto,
  RecipeIngredientsDto,
} from "@norish/shared/contracts/dto/recipe-ingredient";
import type { StepDto, StepInsertDto } from "@norish/shared/contracts/dto/steps";
import type { FilterMode, SearchField, SortOrder } from "@norish/shared/contracts/store-types";
import {
  DEFAULT_RECIPE_PERMISSION_POLICY,
  ServerConfigKeys,
} from "@norish/config/zod/server-config";
import { db } from "@norish/db/drizzle";
import { dbLogger } from "@norish/db/logger";
import { stripHtmlTags } from "@norish/shared/lib/helpers";
import { normalizeUnit } from "@norish/shared/lib/unit-localization";

import type { MutationOutcome } from "./mutation-outcomes";
import {
  households,
  ingredients,
  recipeImages,
  recipeIngredients,
  recipes,
  recipeShares,
  recipeTags,
  recipeVideos,
  stepImages,
  steps as stepsTable,
  tags,
} from "../schema";
import {
  FullRecipeInsertSchema,
  FullRecipeSchema,
  FullRecipeUpdateSchema,
  RecipeDashboardSchema,
} from "../zodSchemas";
import { deriveProjectionTx } from "./cook-projection";
import {
  attachIngredientsToRecipeByInputTx,
  collapseDuplicateIngredientRows,
  getOrCreateManyIngredientsTx,
  getUnitsForNormalization,
} from "./ingredients";
import { appliedOutcome, staleOutcome } from "./mutation-outcomes";
import { getConfig } from "./server-config";
import { createManyRecipeStepsTx } from "./steps";
import { attachTagsToRecipeByInputTx } from "./tags";

type RecipeViewPolicy = RecipePermissionPolicy["view"];

/**
 * Resolve the VIEW policy that scopes a recipe list, from the ACTIVE cookbook.
 *
 * POLICY-01: the list is always isolated to the active cookbook (HOUSE-06), so
 * the view policy is read from THAT cookbook's `view_policy` column — not the
 * global server-wide row. Decision #5 disallows a per-cookbook `view = everyone`,
 * so the active cookbook's policy can only be `household` or `owner`; the list
 * therefore never widens across cookbooks (no cross-cookbook read needed).
 *
 * The personal view (no active household) falls back to the retained server-wide
 * default policy (decision #4) — unchanged behavior for single-user instances.
 */
async function getRecipeViewPolicy(activeHouseholdId: string | null): Promise<RecipeViewPolicy> {
  if (activeHouseholdId === null) {
    const policy = await getConfig<RecipePermissionPolicy>(
      ServerConfigKeys.RECIPE_PERMISSION_POLICY
    );

    return policy?.view ?? DEFAULT_RECIPE_PERMISSION_POLICY.view;
  }

  const cookbook = await db.query.households.findFirst({
    where: eq(households.id, activeHouseholdId),
    columns: { viewPolicy: true },
  });

  // A missing cookbook falls back to the global default (fail-safe; the list is
  // still isolated to activeHouseholdId via the SQL term below).
  if (!cookbook) {
    const policy = await getConfig<RecipePermissionPolicy>(
      ServerConfigKeys.RECIPE_PERMISSION_POLICY
    );

    return policy?.view ?? DEFAULT_RECIPE_PERMISSION_POLICY.view;
  }

  return cookbook.viewPolicy;
}

function nonEmpty(s: string | null | undefined): s is string {
  return typeof s === "string" && s.trim().length > 0;
}

export async function GetTotalRecipeCount(): Promise<number> {
  const result = await db.select({ count: sql<number>`count(*)` }).from(recipes);

  return Number(result?.[0]?.count ?? 0);
}

export async function deleteRecipeById(
  id: string,
  version?: number
): Promise<MutationOutcome<void>> {
  const whereConditions = [eq(recipes.id, id)];

  if (version) {
    whereConditions.push(eq(recipes.version, version));
  }

  const deleted = await db
    .delete(recipes)
    .where(and(...whereConditions))
    .returning({ id: recipes.id });

  if (deleted.length === 0 && version) {
    return staleOutcome();
  }

  return appliedOutcome(undefined);
}

/**
 * Get the owner userId for a recipe (for permission checks)
 */
export async function getRecipeOwnerId(recipeId: string): Promise<string | null> {
  const [row] = await db
    .select({ userId: recipes.userId })
    .from(recipes)
    .where(eq(recipes.id, recipeId))
    .limit(1);

  return row?.userId ?? null;
}

export async function getRecipeOwnerAndHousehold(
  recipeId: string
): Promise<{ userId: string | null; householdId: string | null } | null> {
  const [row] = await db
    .select({ userId: recipes.userId, householdId: recipes.householdId })
    .from(recipes)
    .where(eq(recipes.id, recipeId))
    .limit(1);

  if (!row) return null;

  return { userId: row.userId ?? null, householdId: row.householdId ?? null };
}

/**
 * Thrown when a move would violate `uq_recipes_url_household` — the destination
 * cookbook already holds a recipe with this URL. The router maps it to a CONFLICT.
 */
export const MOVE_DESTINATION_URL_CONFLICT = "DESTINATION_URL_CONFLICT" as const;

function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: unknown }).code === "23505"
  );
}

/**
 * Move a recipe to another cookbook (CKBK-MOVE-01).
 *
 * Writes ONLY `recipes.household_id` (a null destination = Personal). The owner
 * (`recipes.userId`) is deliberately UNCHANGED — ownership is identity, the
 * cookbook is location (Phase 2 D-01/D-09), so the move never orphans the recipe
 * and the owner keeps edit rights in the destination. Version-guarded like the
 * other recipe mutations (returns a stale outcome on a version mismatch).
 *
 * Authorization is the CALLER's responsibility (assertRecipeMoveAllowed in the
 * router) — this repo only performs the write and surfaces the URL-uniqueness
 * collision (moving a URL-bearing recipe into a cookbook that already has that
 * URL) as MOVE_DESTINATION_URL_CONFLICT. A null destination never collides
 * (Postgres treats NULLs as distinct, matching Phase 2 D-13).
 */
export async function moveRecipeToHousehold(
  id: string,
  destinationHouseholdId: string | null,
  version?: number
): Promise<MutationOutcome<void>> {
  const whereConditions = [eq(recipes.id, id)];

  if (version) {
    whereConditions.push(eq(recipes.version, version));
  }

  try {
    const [row] = await db
      .update(recipes)
      .set({
        householdId: destinationHouseholdId,
        updatedAt: new Date(),
        version: sql`${recipes.version} + 1`,
      })
      .where(and(...whereConditions))
      .returning({ id: recipes.id });

    if (!row && version) {
      return staleOutcome();
    }

    return appliedOutcome(undefined);
  } catch (error) {
    if (isUniqueViolation(error)) {
      throw new Error(MOVE_DESTINATION_URL_CONFLICT);
    }

    throw error;
  }
}

export async function getRecipeByUrl(url: string): Promise<FullRecipeDTO | null> {
  const rows = await db.query.recipes.findFirst({
    where: eq(recipes.url, url),
    columns: { id: true },
  });

  if (!rows) return null;
  const recipe = await getRecipeFull(rows.id);

  return FullRecipeSchema.parse(recipe);
}

export async function getRecipeVisibility(
  recipeId: string
): Promise<{ visibility: RecipeVisibility; version: number } | null> {
  const [row] = await db
    .select({ visibility: recipes.visibility, version: recipes.version })
    .from(recipes)
    .where(eq(recipes.id, recipeId))
    .limit(1);

  if (!row) return null;

  return { visibility: row.visibility, version: row.version };
}

/**
 * Set a recipe's visibility with an optimistic version check. The visibility
 * boundary sits ON TOP of the per-cookbook policy (POLICY-01): the caller must
 * already have edit access (the tRPC layer enforces assertRecipeAccess edit).
 */
export async function setRecipeVisibility(
  recipeId: string,
  visibility: RecipeVisibility,
  version: number
): Promise<MutationOutcome<{ visibility: RecipeVisibility; version: number }>> {
  const [row] = await db
    .update(recipes)
    .set({
      visibility,
      updatedAt: new Date(),
      version: sql`${recipes.version} + 1`,
    })
    .where(and(eq(recipes.id, recipeId), eq(recipes.version, version)))
    .returning({ visibility: recipes.visibility, version: recipes.version });

  if (!row) {
    return staleOutcome();
  }

  return appliedOutcome({ visibility: row.visibility, version: row.version });
}

/**
 * Count the ACTIVE share links for a recipe (not revoked, not expired). Used to
 * decide whether a recipe should revert to `private` after its last live public
 * link is revoked/deleted.
 */
export async function countActiveRecipeShares(recipeId: string): Promise<number> {
  const now = new Date();
  const [row] = await db
    .select({ count: sql<number>`count(*)` })
    .from(recipeShares)
    .where(
      and(
        eq(recipeShares.recipeId, recipeId),
        isNull(recipeShares.revokedAt),
        or(isNull(recipeShares.expiresAt), gt(recipeShares.expiresAt, now))
      )
    );

  return Number(row?.count ?? 0);
}

/**
 * Check if recipe URL exists, scoped per-cookbook. Used for queue deduplication before
 * creating new recipes.
 *
 * - "household": Any recipe in the TARGET cookbook with this URL (per-cookbook dedup)
 * - "owner": Any recipe with this URL owned by the user
 *
 * IMPORT-DEDUP-ISO-01: there is deliberately NO "everyone" scope. It used to match
 * `recipes.url` with no cookbook predicate, so with the server-wide default at
 * `view: "everyone"` an import into cookbook B would be deduped against — and handed
 * back — a recipe living in cookbook A, which the importer may not be a member of.
 * Dedup is a per-cookbook question by definition: "do I already have this?" is asked of
 * the cookbook being imported into, never of the whole server. Mirrors HOUSE-06 and the
 * Phase 22 decision that a server-wide `everyone` must not widen a per-cookbook boundary.
 */
export async function recipeExistsByUrlForPolicy(
  url: string,
  userId: string,
  householdId: string | null,
  householdUserIds: string[] | null,
  viewPolicy: "household" | "owner"
): Promise<{ exists: boolean; existingRecipeId?: string }> {
  let whereCondition: ReturnType<typeof and> | ReturnType<typeof or> | ReturnType<typeof eq>;

  switch (viewPolicy) {
    case "household":
      // Check if the URL already exists in the target cookbook.
      if (householdId) {
        whereCondition = and(eq(recipes.url, url), eq(recipes.householdId, householdId));
      } else {
        // Personal cookbook: the user's own household-less recipe.
        whereCondition = and(
          eq(recipes.url, url),
          isNull(recipes.householdId),
          eq(recipes.userId, userId)
        );
      }
      break;

    case "owner":
      // Check if URL exists for this specific user
      whereCondition = and(eq(recipes.url, url), eq(recipes.userId, userId));
      break;

    default:
      whereCondition = and(eq(recipes.url, url), eq(recipes.userId, userId));
  }

  const existing = await db.query.recipes.findFirst({
    where: whereCondition,
    columns: { id: true },
  });

  if (existing) {
    dbLogger.debug(
      { url, recipeId: existing.id, viewPolicy },
      "Found existing recipe by URL for policy"
    );
  }

  return { exists: existing != null, existingRecipeId: existing?.id };
}

/**
 * Check if a recipe already exists within the TARGET cookbook.
 * First checks by URL (if provided), then falls back to exact title match.
 * Dedup scope is the cookbook (recipes.household_id): the target household when
 * householdId is non-null, otherwise the importing user's personal recipes.
 * Returns the existing recipe ID if found, null otherwise.
 */
export async function findExistingRecipe(
  householdId: string | null,
  userIds: string[],
  url: string | null | undefined,
  title: string
): Promise<string | null> {
  const cookbookScope = householdId
    ? eq(recipes.householdId, householdId)
    : and(isNull(recipes.householdId), inArray(recipes.userId, userIds));

  // First try to find by URL if provided (most reliable)
  if (url && url.trim()) {
    const byUrl = await db.query.recipes.findFirst({
      where: and(cookbookScope, eq(recipes.url, url.trim())),
      columns: { id: true },
    });

    if (byUrl) {
      dbLogger.debug({ url, recipeId: byUrl.id }, "Found existing recipe by URL");

      return byUrl.id;
    }
  }

  // Fall back to exact title match (case-insensitive)
  const trimmedTitle = title.trim();

  if (trimmedTitle) {
    const byTitle = await db.query.recipes.findFirst({
      where: and(cookbookScope, ilike(recipes.name, trimmedTitle)),
      columns: { id: true },
    });

    if (byTitle) {
      dbLogger.debug(
        { title: trimmedTitle, recipeId: byTitle.id },
        "Found existing recipe by title"
      );

      return byTitle.id;
    }
  }

  return null;
}

export interface RecipeListContext {
  userId: string;
  householdUserIds: string[] | null;
  activeHouseholdId: string | null;
  memberHouseholdIds: string[];
  isServerAdmin: boolean;
}

/**
 * Build SQL condition for view-policy filtering, scoped per-cookbook
 * (recipes.household_id). POLICY-01 reads the view level from the ACTIVE
 * cookbook (getRecipeViewPolicy(ctx.activeHouseholdId)).
 *
 * HOUSE-06 INVARIANT (security-critical): when an active cookbook is selected,
 * the list is ALWAYS scoped to that one cookbook — it can NEVER widen across
 * cookbooks, regardless of that cookbook's view policy. Decision #5 disallows a
 * per-cookbook `view = everyone`, but a freshly-created cookbook may still carry
 * a seeded `everyone` (inherited from a default-`everyone` global). So in the
 * active-cookbook branch BOTH `everyone` and `household` collapse to
 * active-cookbook scoping; only `owner` narrows further (to the viewer's own
 * recipes within that cookbook).
 *
 * LIST-ISO-01: there is NO unfiltered branch. `everyone` never means "no
 * where-clause" — in the personal view (no active household) it clamps to the
 * viewer's own recipes plus orphans. That branch used to return `undefined`,
 * which leaked every recipe on the server to any user who cleared their active
 * cookbook.
 */
async function buildViewPolicyCondition(ctx: RecipeListContext) {
  const viewLevel = await getRecipeViewPolicy(ctx.activeHouseholdId);

  // Server admin sees all
  if (ctx.isServerAdmin) {
    return undefined;
  }

  // Active cookbook selected: the list is hard-scoped to THAT cookbook. This is
  // the HOUSE-06 boundary — never widen beyond ctx.activeHouseholdId here.
  if (ctx.activeHouseholdId) {
    if (viewLevel === "owner") {
      // Only the viewer's own recipes within the active cookbook, plus orphans.
      return or(
        and(eq(recipes.householdId, ctx.activeHouseholdId), eq(recipes.userId, ctx.userId)),
        isNull(recipes.userId)
      );
    }

    // "household" (and a seeded "everyone", clamped) -> all of the active
    // cookbook's recipes, plus orphans (null userId).
    return or(eq(recipes.householdId, ctx.activeHouseholdId), isNull(recipes.userId));
  }

  // Personal view (no active household). LIST-ISO-01: this branch must never widen
  // beyond the viewer either — `switchActive({ householdId: null })` makes it reachable
  // by any authenticated user, so an unfiltered read here is a cross-cookbook leak.
  switch (viewLevel) {
    case "everyone":
      // `everyone` is the widest policy, so it gets the widest ISOLATION-SAFE personal
      // view: everything the viewer owns (in any cookbook) plus orphans. On the
      // single-user instance this default was retained for, that is the same list as the
      // old unfiltered read; on a multi-user instance it stops at the viewer.
      return or(eq(recipes.userId, ctx.userId), isNull(recipes.userId));

    case "household":
      // The viewer's own household-less recipes, plus orphans.
      return or(
        and(isNull(recipes.householdId), eq(recipes.userId, ctx.userId)),
        isNull(recipes.userId)
      );

    case "owner":
    default:
      // Only own recipes + orphaned recipes (null userId).
      return or(eq(recipes.userId, ctx.userId), isNull(recipes.userId));
  }
}

export async function listRecipes(
  ctx: RecipeListContext,
  limit: number,
  offset: number = 0,
  search?: string,
  searchFields: SearchField[] = ["title", "ingredients"],
  tagNames?: string[],
  filterMode: FilterMode = "OR",
  sortMode: SortOrder = "dateDesc",
  minRating?: number,
  maxCookingTime?: number,
  categories?: RecipeCategory[]
): Promise<{ recipes: RecipeDashboardDTO[]; total: number }> {
  const whereConditions: any[] = [];

  // Apply view policy filtering
  const policyCondition = await buildViewPolicyCondition(ctx);

  if (policyCondition) {
    whereConditions.push(policyCondition);
  }

  // Build full-text search with weighted ranking
  // Priority: title (A) > tags (B) > ingredients (C) > description/steps (D)
  let searchRank: ReturnType<typeof sql<number>> | null = null;

  if (search && searchFields.length > 0) {
    // Convert search terms to tsquery format with prefix matching
    // Each term gets :* suffix for partial word matching (e.g., "om" matches "oma")
    // Sanitize terms to remove PostgreSQL tsquery special characters: & | ! ( ) : * \ ' "
    const sanitizeTsqueryTerm = (term: string): string =>
      term.replace(/[&|!():<>*\\'"]/g, "").trim();

    const searchTerms = search
      .trim()
      .split(/\s+/)
      .map(sanitizeTsqueryTerm)
      .filter((t) => t.length > 0)
      .map((t) => `${t}:*`)
      .join(" | ");

    // Skip search if all terms were filtered out (e.g., search was only special characters)
    if (!searchTerms) {
      // Fall through without adding search conditions
    } else {
      // Build weighted tsvector components based on selected fields
      const tsvectorParts: ReturnType<typeof sql>[] = [];

      for (const field of searchFields) {
        switch (field) {
          case "title":
            // Weight A (highest) for title
            tsvectorParts.push(
              sql`setweight(to_tsvector('simple', coalesce(${recipes.name}, '')), 'A')`
            );
            break;
          case "tags":
            // Weight B for tags - aggregate from related table
            tsvectorParts.push(
              sql`setweight(to_tsvector('simple', coalesce((
              SELECT string_agg(t.name, ' ')
              FROM ${recipeTags} rt
              INNER JOIN ${tags} t ON rt.tag_id = t.id
              WHERE rt.recipe_id = ${recipes.id}
            ), '')), 'B')`
            );
            break;
          case "ingredients":
            // Weight C for ingredients - aggregate from related table
            tsvectorParts.push(
              sql`setweight(to_tsvector('simple', coalesce((
              SELECT string_agg(i.name, ' ')
              FROM ${recipeIngredients} ri
              INNER JOIN ${ingredients} i ON ri.ingredient_id = i.id
              WHERE ri.recipe_id = ${recipes.id}
            ), '')), 'C')`
            );
            break;
          case "description":
            // Weight D for description
            tsvectorParts.push(
              sql`setweight(to_tsvector('simple', coalesce(${recipes.description}, '')), 'D')`
            );
            break;
          case "steps":
            // Weight D for steps - aggregate from related table
            tsvectorParts.push(
              sql`setweight(to_tsvector('simple', coalesce((
              SELECT string_agg(s.step, ' ')
              FROM ${stepsTable} s
              WHERE s.recipe_id = ${recipes.id}
            ), '')), 'D')`
            );
            break;
        }
      }

      if (tsvectorParts.length > 0) {
        // Combine all tsvector parts with ||
        const combinedTsvector = sql.join(tsvectorParts, sql` || `);
        const tsQuery = sql`to_tsquery('simple', ${searchTerms})`;

        // Add search condition using @@ operator
        whereConditions.push(sql`(${combinedTsvector}) @@ ${tsQuery}`);

        // Build rank expression for ordering
        searchRank = sql<number>`ts_rank(${combinedTsvector}, ${tsQuery})`;
      }
    }
  }

  let tagFilteredIds: string[] | undefined;

  if (tagNames?.length) {
    const normalizedTags = tagNames.map((t) => t.toLowerCase());
    const tagRelations = await db.query.recipeTags.findMany({
      columns: { recipeId: true },
      with: { tag: { columns: { name: true } } },
    });

    const recipeTagMap = new Map<string, Set<string>>();

    for (const rel of tagRelations) {
      const tagName = rel.tag?.name?.toLowerCase();

      if (!tagName) continue;
      if (!recipeTagMap.has(rel.recipeId)) {
        recipeTagMap.set(rel.recipeId, new Set());
      }
      recipeTagMap.get(rel.recipeId)!.add(tagName);
    }

    tagFilteredIds = Array.from(recipeTagMap.entries())
      .filter(([_, tagSet]) =>
        filterMode === "AND"
          ? normalizedTags.every((t) => tagSet.has(t))
          : normalizedTags.some((t) => tagSet.has(t))
      )
      .map(([recipeId]) => recipeId);

    if (!tagFilteredIds.length) {
      return { recipes: [], total: 0 };
    }

    whereConditions.push(inArray(recipes.id, tagFilteredIds));
  }

  if (categories?.length) {
    const categoryArray = `{${categories.join(",")}}`;

    whereConditions.push(sql`${recipes.categories} && ${categoryArray}::recipe_category[]`);
  }

  if (maxCookingTime !== undefined) {
    const hasTime = sql`(${recipes.totalMinutes} IS NOT NULL OR ${recipes.prepMinutes} IS NOT NULL OR ${recipes.cookMinutes} IS NOT NULL)`;
    const effectiveMinutes = sql<number>`CASE WHEN ${recipes.totalMinutes} IS NOT NULL THEN ${recipes.totalMinutes} ELSE COALESCE(${recipes.prepMinutes}, 0) + COALESCE(${recipes.cookMinutes}, 0) END`;

    whereConditions.push(and(hasTime, lte(effectiveMinutes, maxCookingTime)));
  }

  const whereClause = whereConditions.length ? and(...whereConditions) : undefined;

  const sortMap = {
    titleAsc: asc(recipes.name),
    titleDesc: desc(recipes.name),
    dateAsc: asc(recipes.createdAt),
    dateDesc: desc(recipes.createdAt),
    none: undefined,
  };
  const baseOrderBy = sortMap[sortMode as keyof typeof sortMap] ?? desc(recipes.createdAt);

  // When searching, order by relevance rank first (descending), then by the selected sort
  const orderBy = searchRank
    ? baseOrderBy
      ? [desc(searchRank), baseOrderBy]
      : desc(searchRank)
    : baseOrderBy;

  const [rows, totalCount] = await Promise.all([
    db.query.recipes.findMany({
      columns: {
        id: true,
        userId: true,
        name: true,
        description: true,
        notes: true,
        url: true,
        image: true,
        servings: true,
        prepMinutes: true,
        cookMinutes: true,
        totalMinutes: true,
        calories: true,
        categories: true,
        createdAt: true,
        updatedAt: true,
        version: true,
        householdId: true,
        visibility: true,
      },
      with: {
        recipeTags: {
          with: { tag: { columns: { id: true, name: true, version: true } } },
          orderBy: (rt, { asc }) => [asc(rt.order)],
        },
        ratings: {
          columns: { rating: true },
        },
      },
      where: whereClause,
      orderBy,
      limit,
      offset,
    }),
    db
      .select({ count: sql<number>`count(*)` })
      .from(recipes)
      .where(whereClause),
  ]);

  const formatted = rows.map((r) => {
    // Compute average rating
    const ratingValues = (r.ratings ?? []).map((rating) => rating.rating);
    const ratingCount = ratingValues.length;
    const averageRating =
      ratingCount > 0 ? ratingValues.reduce((sum, val) => sum + val, 0) / ratingCount : null;

    return {
      id: r.id,
      userId: r.userId,
      name: r.name,
      description: r.description ?? null,
      notes: r.notes ?? null,
      url: r.url ?? null,
      image: r.image ?? null,
      servings: r.servings ?? 1,
      prepMinutes: r.prepMinutes ?? null,
      cookMinutes: r.cookMinutes ?? null,
      totalMinutes: r.totalMinutes ?? null,
      calories: r.calories ?? null,
      categories: r.categories ?? [],
      createdAt: r.createdAt,
      updatedAt: r.updatedAt,
      version: r.version,
      householdId: r.householdId ?? null,
      visibility: r.visibility ?? "private",
      tags: (r.recipeTags ?? []).flatMap(
        (rt: { tag?: { name?: string; version?: number } | null }) =>
          rt.tag && typeof rt.tag.name === "string" && typeof rt.tag.version === "number"
            ? [{ name: rt.tag.name, version: rt.tag.version }]
            : []
      ),
      averageRating,
      ratingCount,
    };
  });

  const parsed = z.array(RecipeDashboardSchema).safeParse(formatted);

  if (!parsed.success) throw new Error("RecipeDashboardDTO parse failed");

  // Filter by minimum rating if specified (post-fetch since rating is computed)
  let filteredRecipes = parsed.data;

  if (minRating !== undefined) {
    filteredRecipes = parsed.data.filter(
      (r) => r.averageRating != null && r.averageRating >= minRating
    );
  }

  return {
    recipes: filteredRecipes,
    total: minRating !== undefined ? filteredRecipes.length : Number(totalCount?.[0]?.count ?? 0),
  };
}

export async function dashboardRecipe(id: string): Promise<RecipeDashboardDTO | null> {
  const rows = await db.query.recipes.findMany({
    where: eq(recipes.id, id),
    columns: {
      id: true,
      userId: true,
      name: true,
      description: true,
      notes: true,
      url: true,
      image: true,
      servings: true,
      prepMinutes: true,
      cookMinutes: true,
      totalMinutes: true,
      calories: true,
      categories: true,
      createdAt: true,
      updatedAt: true,
      version: true,
      householdId: true,
      visibility: true,
    },
    with: {
      recipeTags: {
        columns: {},
        with: {
          tag: { columns: { id: true, name: true, version: true } },
        },
        orderBy: (rt, { asc }) => [asc(rt.order)],
      },
      ratings: {
        columns: { rating: true },
      },
    },
    limit: 1,
  });

  if (rows.length === 0) return null;
  const r = rows[0];

  if (!r) return null;

  // Compute average rating
  const ratingValues = (r.ratings ?? []).map((rating) => rating.rating);
  const ratingCount = ratingValues.length;
  const averageRating =
    ratingCount > 0 ? ratingValues.reduce((sum, val) => sum + val, 0) / ratingCount : null;

  const dto = {
    id: r.id,
    userId: r.userId,
    name: r.name,
    description: r.description ?? null,
    notes: r.notes ?? null,
    url: r.url ?? null,
    image: r.image ?? null,
    servings: r.servings ?? null,
    prepMinutes: r.prepMinutes ?? null,
    cookMinutes: r.cookMinutes ?? null,
    totalMinutes: r.totalMinutes ?? null,
    calories: r.calories ?? null,
    categories: r.categories ?? [],
    createdAt: r.createdAt,
    updatedAt: r.updatedAt,
    version: r.version,
    householdId: r.householdId ?? null,
    visibility: r.visibility ?? "private",
    tags: (r.recipeTags ?? [])
      .map((rt: any) => rt.tag)
      .filter((tag: { name?: string; version?: number } | null | undefined) => tag?.name)
      .map((tag: { name: string; version: number }) => ({ name: tag.name, version: tag.version })),
    averageRating,
    ratingCount,
  };

  const parsed = RecipeDashboardSchema.safeParse(dto);

  return parsed.success ? parsed.data : null;
}

/**
 * Phase 27 (COOK-01 / W2, D-27-W2-01) — the optional server-authored `.cook`.
 *
 * This is a REPOSITORY argument, never a tRPC input (D-27-W2-02): only a
 * server-side producer (`buildCookPayload`, from W3's extraction/import) can fill
 * it, so untrusted client text never reaches the WASM parser (T-27-01).
 *
 * It is the LAST parameter and optional, so every existing call site keeps
 * compiling and keeps its exact behaviour. Omitted -- which is every call site
 * that exists at the end of W2 -- the legacy projection write runs unchanged and
 * `recipes.cook_source` stays NULL.
 */
export interface RecipeCookPayload {
  cookSource: string;
  cookTokens: CookTokensDTO;
}

export async function createRecipeWithRefs(
  recipeId: string,
  userId: string | null | undefined,
  householdId: string | null,
  input: FullRecipeInsertDTO,
  cook?: RecipeCookPayload
): Promise<string | null> {
  const parsed = FullRecipeInsertSchema.safeParse(input);

  dbLogger.debug({ parsed }, "Parsed full recipe insert");
  if (!parsed.success) {
    throw new Error("Could not parse recipe data.");
  }

  const payload = parsed.data;

  const toInsert = {
    id: recipeId,
    name: stripHtmlTags(payload.name),
    userId,
    householdId,
    description: payload.description ? stripHtmlTags(payload.description) : null,
    notes: payload.notes ?? null,
    url: payload.url ?? null,
    image: payload.image ?? null,
    servings: payload.servings ?? 1,
    systemUsed: payload.systemUsed,
    prepMinutes: payload.prepMinutes ?? null,
    cookMinutes: payload.cookMinutes ?? null,
    totalMinutes: payload.totalMinutes ?? null,
    calories: payload.calories ?? null,
    fat: payload.fat ?? null,
    carbs: payload.carbs ?? null,
    protein: payload.protein ?? null,
    categories: payload.categories ?? [],
    // Only written when a server-side producer supplied one; otherwise the column
    // is not in the insert at all and takes its NULL default (unchanged behaviour).
    ...(cook ? { cookSource: cook.cookSource } : {}),
  };

  const finalRecipeId = await db.transaction(async (tx) => {
    const [inserted] = await tx
      .insert(recipes)
      .values(toInsert)
      .onConflictDoNothing({ target: [recipes.url, recipes.householdId] })
      .returning({ id: recipes.id });

    if (!inserted) {
      const existing = await tx.query.recipes.findFirst({
        where: and(
          eq(recipes.url, toInsert.url!),
          householdId ? eq(recipes.householdId, householdId) : isNull(recipes.householdId)
        ),
        columns: { id: true },
      });

      if (!existing) {
        throw new Error("Failed to save recipe");
      }

      return existing.id;
    }

    const rid = inserted.id;

    if (payload.tags.length) {
      await attachTagsToRecipeByInputTx(
        tx,
        rid,
        (payload.tags as { name: string }[]).map((t) => t.name)
      );
    }

    if (cook) {
      // The `.cook` is authoritative: ingredients and steps are DERIVED from it in
      // this same transaction, so the source and its projection commit atomically.
      await deriveProjectionTx(tx, {
        // `systemUsed` is optional on the insert schema (the column defaults);
        // fall back to the same default the column would take.
        systemUsed: payload.systemUsed ?? "metric",
        recipeId: rid,
        cookTokens: cook.cookTokens,
        units: await getUnitsForNormalization(),
      });
    } else {
      if (payload.recipeIngredients.length) {
        await attachIngredientsToRecipeByInputTx(
          tx,
          (payload.recipeIngredients as any[]).map((ri) => ({
            ...ri,
            recipeId: rid,
            systemUsed: ri.systemUsed ?? payload.systemUsed,
          }))
        );
      }

      if (payload.steps.length) {
        await createManyRecipeStepsTx(
          tx,
          (payload.steps as any[]).map((s) => ({
            ...s,
            recipeId: rid,
          }))
        );
      }
    }

    // Insert gallery images if provided
    if (payload.images && payload.images.length > 0) {
      await tx.insert(recipeImages).values(
        payload.images.map((img) => ({
          recipeId: rid,
          image: img.image,
          order: String(img.order ?? 0),
        }))
      );
    }

    // Insert videos if provided
    if (payload.videos && payload.videos.length > 0) {
      await tx.insert(recipeVideos).values(
        payload.videos.map((v) => ({
          recipeId: rid,
          video: v.video,
          thumbnail: v.thumbnail ?? null,
          duration: v.duration != null ? String(v.duration) : null,
          order: String(v.order ?? 0),
        }))
      );
    }

    return rid;
  });

  return finalRecipeId;
}

export async function setActiveSystemForRecipe(
  recipeId: string,
  system: MeasurementSystem,
  version?: number
): Promise<MutationOutcome<void>> {
  const whereConditions = [eq(recipes.id, recipeId)];

  if (version) {
    whereConditions.push(eq(recipes.version, version));
  }

  const updated = await db
    .update(recipes)
    .set({ systemUsed: system, version: sql`${recipes.version} + 1` })
    .where(and(...whereConditions))
    .returning({ id: recipes.id });

  if (updated.length === 0 && version) {
    return staleOutcome();
  }

  return appliedOutcome(undefined);
}

export async function updateRecipeCategories(
  recipeId: string,
  categories: RecipeCategory[],
  version?: number
): Promise<MutationOutcome<void>> {
  const whereConditions = [eq(recipes.id, recipeId)];

  if (version) {
    whereConditions.push(eq(recipes.version, version));
  }

  const updated = await db
    .update(recipes)
    .set({ categories, updatedAt: new Date(), version: sql`${recipes.version} + 1` })
    .where(and(...whereConditions))
    .returning({ id: recipes.id });

  if (updated.length === 0 && version) {
    return staleOutcome();
  }

  return appliedOutcome(undefined);
}

export async function getRecipesWithoutCategories(): Promise<{ id: string; name: string }[]> {
  const rows = await db
    .select({ id: recipes.id, name: recipes.name })
    .from(recipes)
    .where(sql`cardinality(${recipes.categories}) = 0`);

  return rows;
}

export async function getRecipeFull(id: string): Promise<FullRecipeDTO | null> {
  const full = await db.query.recipes.findFirst({
    where: eq(recipes.id, id),
    columns: {
      id: true,
      userId: true,
      householdId: true,
      visibility: true,
      name: true,
      description: true,
      notes: true,
      url: true,
      image: true,
      servings: true,
      prepMinutes: true,
      cookMinutes: true,
      totalMinutes: true,
      systemUsed: true,
      calories: true,
      fat: true,
      carbs: true,
      protein: true,
      categories: true,
      createdAt: true,
      updatedAt: true,
      version: true,
      // Phase 27 (W2): the `.cook` rides on the SINGLE-recipe read only. It is
      // deliberately NOT added to `listRecipes` / `dashboardRecipe` — a blob per row
      // on a list endpoint is dead weight (§2.8, <risks> R9). `cookTokens` stays
      // null here: `@norish/db` must never parse (D-27-W2-09); the read-side parse
      // is `withCookTokens`, called after the access check.
      cookSource: true,
    },
    with: {
      recipeTags: {
        columns: {},
        with: { tag: { columns: { id: true, name: true, version: true } } },
        orderBy: (rt, { asc }) => [asc(rt.order)],
      },
      ingredients: {
        columns: {
          id: true,
          ingredientId: true,
          amount: true,
          unit: true,
          systemUsed: true,
          order: true,
          version: true,
        },
        with: { ingredient: { columns: { name: true } } },
        orderBy: (ingredients, { asc }) => [asc(ingredients.order)],
      },
      steps: {
        columns: { step: true, systemUsed: true, order: true, version: true },
        with: {
          images: {
            columns: { id: true, image: true, order: true, version: true },
            orderBy: (images, { asc }) => [asc(images.order)],
          },
        },
        orderBy: (steps, { asc }) => [asc(steps.order)],
      },
      images: {
        columns: { id: true, image: true, order: true, version: true },
        orderBy: (images, { asc }) => [asc(images.order)],
      },
      videos: {
        columns: {
          id: true,
          video: true,
          thumbnail: true,
          duration: true,
          order: true,
          version: true,
        },
        orderBy: (videos, { asc }) => [asc(videos.order)],
      },
    },
  });

  if (!full) return null;

  // fetch author if exists
  let author:
    | { id: string; name: string | null; image: string | null; version: number }
    | undefined;

  if (full.userId) {
    const { getUserAuthorInfo } = await import("./users");
    const userInfo = await getUserAuthorInfo(full.userId!);

    if (userInfo) {
      author = userInfo;
    }
  }

  const dto = {
    id: full.id,
    userId: full.userId,
    householdId: full.householdId ?? null,
    visibility: full.visibility ?? "private",
    name: full.name,
    description: full.description ?? null,
    notes: full.notes ?? null,
    url: full.url ?? null,
    image: full.image ?? null,
    servings: full.servings ?? 1,
    prepMinutes: full.prepMinutes ?? null,
    cookMinutes: full.cookMinutes ?? null,
    totalMinutes: full.totalMinutes ?? null,
    systemUsed: full.systemUsed,
    calories: full.calories ?? null,
    fat: full.fat ?? null,
    carbs: full.carbs ?? null,
    protein: full.protein ?? null,
    categories: full.categories ?? [],
    steps: (full.steps ?? []).map((s: any) => ({
      step: s.step,
      systemUsed: s.systemUsed,
      order: s.order,
      version: s.version,
      images: (s.images ?? []).map((img: any) => ({
        id: img.id,
        image: img.image,
        order: Number(img.order) || 0,
        version: img.version,
      })),
    })),
    createdAt: full.createdAt,
    updatedAt: full.updatedAt,
    version: full.version,
    cookSource: full.cookSource ?? null,
    tags: (full.recipeTags ?? [])
      .map((rt: any) => rt.tag)
      .filter((tag: { name?: string; version?: number } | null | undefined) => tag?.name)
      .map((tag: { name: string; version: number }) => ({ name: tag.name, version: tag.version })),
    recipeIngredients: (full.ingredients ?? []).map((ri: any) => ({
      id: ri.id,
      ingredientId: ri.ingredientId,
      amount: ri.amount ? Number(ri.amount) : null,
      unit: ri.unit ?? null,
      systemUsed: ri.systemUsed,
      ingredientName: ri.ingredient?.name ?? "",
      order: ri.order,
      version: ri.version,
    })),
    author,
    images: (full.images ?? []).map((img: any) => ({
      id: img.id,
      image: img.image,
      order: Number(img.order) || 0,
      version: img.version,
    })),
    videos: (full.videos ?? []).map((vid: any) => ({
      id: vid.id,
      video: vid.video,
      thumbnail: vid.thumbnail ?? null,
      duration: vid.duration ?? null,
      order: Number(vid.order) || 0,
      version: vid.version,
    })),
  };

  const parsed = FullRecipeSchema.safeParse(dto);

  if (!parsed.success) {
    dbLogger.error({ err: parsed.error }, "Failed to parse FullRecipeDTO");

    throw new Error("Failed to parse FullRecipeDTO");
  }

  return parsed.data;
}

export async function addStepsAndIngredientsToRecipeByInput(
  steps: StepInsertDto[],
  ingredients: RecipeIngredientInsertDto[]
): Promise<{ steps: StepDto[]; ingredients: RecipeIngredientsDto[] }> {
  if (!steps?.length && !ingredients?.length) {
    return { steps: [], ingredients: [] };
  }

  return db.transaction(async (tx) => {
    let createdSteps: StepDto[] = [];
    let createdIngredients: RecipeIngredientsDto[] = [];

    if (steps?.length) {
      createdSteps = await createManyRecipeStepsTx(tx, steps);
    }

    if (ingredients?.length) {
      createdIngredients = await attachIngredientsToRecipeByInputTx(tx, ingredients);
    }

    return {
      steps: createdSteps,
      ingredients: createdIngredients,
    };
  });
}

async function resolveRecipeIngredientIdsTx(
  tx: any,
  inputs: NonNullable<FullRecipeUpdateDTO["recipeIngredients"]>
) {
  const typedInputs = inputs as any[];
  const names = Array.from(
    new Set(typedInputs.map((item) => item.ingredientName?.trim() ?? "").filter(Boolean))
  );
  const resolvedIngredients = names.length > 0 ? await getOrCreateManyIngredientsTx(tx, names) : [];

  return typedInputs.map((item) => ({
    ...item,
    ingredientId:
      item.ingredientId ??
      resolvedIngredients.find(
        (ingredient) =>
          ingredient.name.toLowerCase().trim() === item.ingredientName?.toLowerCase().trim()
      )?.id ??
      null,
  }));
}

async function syncRecipeIngredientsTx(
  tx: any,
  recipeId: string,
  systemUsed: MeasurementSystem,
  inputs: NonNullable<FullRecipeUpdateDTO["recipeIngredients"]>
): Promise<void> {
  const existing = await tx
    .select({ id: recipeIngredients.id, ingredientId: recipeIngredients.ingredientId })
    .from(recipeIngredients)
    .where(
      and(eq(recipeIngredients.recipeId, recipeId), eq(recipeIngredients.systemUsed, systemUsed))
    );
  // Phase 27 (W2): `0041` makes `(recipe_id, system_used, ingredient_id)` the
  // IDENTITY of a projection row, so retention is matched on THAT, not on the
  // surrogate `id` the client echoed back. Two consequences, both wanted:
  //  - an UPDATE never changes `ingredient_id`, so reordering or swapping two
  //    ingredient lines can never produce a transient unique violation (a plain
  //    unique index is not deferrable, so a swap keyed on `id` would 500);
  //  - a row's id — and therefore its `groceries.recipe_ingredient_id` link —
  //    follows the INGREDIENT, which is exactly what "this grocery came from the
  //    flour line" means. Same rule as `deriveProjectionTx`; one identity, two writers.
  const existingByIngredientId = new Map<string, string>(
    existing.map((row: { id: string; ingredientId: string }) => [row.ingredientId, row.id])
  );
  const resolvedInputs = await resolveRecipeIngredientIdsTx(tx, inputs);
  const units = await getUnitsForNormalization();
  // Collapse duplicates in the PAYLOAD before writing: a user may legitimately list
  // the same ingredient twice, and a blind insert would now raise (<risks> R4).
  const collapsed = collapseDuplicateIngredientRows(
    resolvedInputs.map((ingredient: any, index: number) => ({
      ...ingredient,
      recipeId,
      systemUsed,
      amount: ingredient.amount ?? null,
      unit: ingredient.unit ? normalizeUnit(ingredient.unit, units) : null,
      order: ingredient.order ?? index,
    }))
  );
  const retainedIds = new Set<string>();

  for (const ingredient of collapsed) {
    if (!ingredient.ingredientId) continue;

    const values = {
      ingredientId: ingredient.ingredientId,
      amount: ingredient.amount,
      unit: ingredient.unit,
      order: ingredient.order,
      systemUsed,
    };
    const existingId = existingByIngredientId.get(ingredient.ingredientId);

    if (existingId) {
      retainedIds.add(existingId);
      await tx
        .update(recipeIngredients)
        .set({ ...values, version: sql`${recipeIngredients.version} + 1` })
        .where(eq(recipeIngredients.id, existingId));
      continue;
    }

    await tx
      .insert(recipeIngredients)
      .values({ recipeId, ...values })
      .onConflictDoUpdate({
        target: [
          recipeIngredients.recipeId,
          recipeIngredients.systemUsed,
          recipeIngredients.ingredientId,
        ],
        set: {
          amount: sql`excluded."amount"`,
          unit: sql`excluded."unit"`,
          order: sql`excluded."order"`,
          updatedAt: new Date(),
          version: sql`${recipeIngredients.version} + 1`,
        },
      });
  }

  const idsToDelete = existing
    .map((row: { id: string }) => row.id)
    .filter((id: string) => !retainedIds.has(id));

  if (idsToDelete.length > 0) {
    await tx.delete(recipeIngredients).where(inArray(recipeIngredients.id, idsToDelete));
  }
}

async function syncStepImagesTx(
  tx: any,
  stepId: string,
  images: Array<{ id?: string; image: string; order?: unknown; version?: number }>
): Promise<void> {
  const existing = await tx
    .select({ id: stepImages.id })
    .from(stepImages)
    .where(eq(stepImages.stepId, stepId));
  const existingById = new Map(existing.map((row: { id: string }) => [row.id, row]));
  const retainedIds = new Set<string>();

  for (const [index, image] of images.entries()) {
    const values = {
      image: image.image,
      order: String(typeof image.order === "number" ? image.order : index),
    };

    if (image.id && existingById.has(image.id)) {
      retainedIds.add(image.id);
      await tx
        .update(stepImages)
        .set({ ...values, version: sql`${stepImages.version} + 1` })
        .where(eq(stepImages.id, image.id));
      continue;
    }

    await tx.insert(stepImages).values({ stepId, ...values });
  }

  const idsToDelete = existing
    .map((row: { id: string }) => row.id)
    .filter((id: string) => !retainedIds.has(id));

  if (idsToDelete.length > 0) {
    await tx.delete(stepImages).where(inArray(stepImages.id, idsToDelete));
  }
}

async function syncRecipeStepsTx(
  tx: any,
  recipeId: string,
  systemUsed: MeasurementSystem,
  inputs: NonNullable<FullRecipeUpdateDTO["steps"]>
): Promise<void> {
  const normalized = (inputs as any[])
    .map((step, index) => ({
      ...step,
      order: step.order ?? index,
      step: stripHtmlTags(step.step),
    }))
    .filter((step) => step.step.length > 0);
  const existing = await tx
    .select({ id: stepsTable.id })
    .from(stepsTable)
    .where(and(eq(stepsTable.recipeId, recipeId), eq(stepsTable.systemUsed, systemUsed)))
    .orderBy(asc(stepsTable.order));

  for (const [index, step] of normalized.entries()) {
    const existingStep = existing[index];
    const values = {
      recipeId,
      step: step.step,
      order: index,
      systemUsed,
    };

    if (existingStep) {
      await tx
        .update(stepsTable)
        .set({ ...values, version: sql`${stepsTable.version} + 1` })
        .where(eq(stepsTable.id, existingStep.id));
      await syncStepImagesTx(tx, existingStep.id, step.images ?? []);
      continue;
    }

    const [insertedStep] = await tx
      .insert(stepsTable)
      .values(values)
      .returning({ id: stepsTable.id });

    if (insertedStep) {
      await syncStepImagesTx(tx, insertedStep.id, step.images ?? []);
    }
  }

  const idsToDelete = existing.slice(normalized.length).map((row: { id: string }) => row.id);

  if (idsToDelete.length > 0) {
    await tx.delete(stepsTable).where(inArray(stepsTable.id, idsToDelete));
  }
}

async function syncRecipeImagesTx(
  tx: any,
  recipeId: string,
  images: NonNullable<FullRecipeUpdateDTO["images"]>
): Promise<void> {
  const existing = await tx
    .select({ id: recipeImages.id })
    .from(recipeImages)
    .where(eq(recipeImages.recipeId, recipeId));
  const existingById = new Map(existing.map((row: { id: string }) => [row.id, row]));
  const retainedIds = new Set<string>();

  for (const [index, image] of images.entries()) {
    const values = {
      image: image.image,
      order: String(image.order ?? index),
    };

    if (image.id && existingById.has(image.id)) {
      retainedIds.add(image.id);
      await tx
        .update(recipeImages)
        .set({ ...values, version: sql`${recipeImages.version} + 1` })
        .where(eq(recipeImages.id, image.id));
      continue;
    }

    await tx.insert(recipeImages).values({ recipeId, ...values });
  }

  const idsToDelete = existing
    .map((row: { id: string }) => row.id)
    .filter((id: string) => !retainedIds.has(id));

  if (idsToDelete.length > 0) {
    await tx.delete(recipeImages).where(inArray(recipeImages.id, idsToDelete));
  }
}

async function syncRecipeVideosTx(
  tx: any,
  recipeId: string,
  videos: NonNullable<FullRecipeUpdateDTO["videos"]>
): Promise<void> {
  const existing = await tx
    .select({ id: recipeVideos.id })
    .from(recipeVideos)
    .where(eq(recipeVideos.recipeId, recipeId));
  const existingById = new Map(existing.map((row: { id: string }) => [row.id, row]));
  const retainedIds = new Set<string>();

  for (const [index, video] of videos.entries()) {
    const values = {
      video: video.video,
      thumbnail: video.thumbnail ?? null,
      duration: video.duration != null ? String(video.duration) : null,
      order: String(video.order ?? index),
    };

    if (video.id && existingById.has(video.id)) {
      retainedIds.add(video.id);
      await tx
        .update(recipeVideos)
        .set({ ...values, version: sql`${recipeVideos.version} + 1` })
        .where(eq(recipeVideos.id, video.id));
      continue;
    }

    await tx.insert(recipeVideos).values({ recipeId, ...values });
  }

  const idsToDelete = existing
    .map((row: { id: string }) => row.id)
    .filter((id: string) => !retainedIds.has(id));

  if (idsToDelete.length > 0) {
    await tx.delete(recipeVideos).where(inArray(recipeVideos.id, idsToDelete));
  }
}

export async function updateRecipeWithRefs(
  recipeId: string,
  userId: string,
  input: FullRecipeUpdateDTO,
  version?: number,
  cook?: RecipeCookPayload
): Promise<MutationOutcome<void>> {
  const parsed = FullRecipeUpdateSchema.safeParse(input);

  if (!parsed.success) {
    throw new Error("Invalid FullRecipeUpdateDTO");
  }

  const payload = parsed.data;

  return await db.transaction(async (tx) => {
    // Update recipe base fields
    const updateData: any = {};

    if (payload.name !== undefined) updateData.name = stripHtmlTags(payload.name);
    if (payload.description !== undefined)
      updateData.description = payload.description ? stripHtmlTags(payload.description) : null;
    if (payload.notes !== undefined) updateData.notes = payload.notes;
    if (payload.url !== undefined) updateData.url = payload.url;
    if (payload.image !== undefined) updateData.image = payload.image;
    if (payload.servings !== undefined) updateData.servings = payload.servings;
    if (payload.prepMinutes !== undefined) updateData.prepMinutes = payload.prepMinutes;
    if (payload.cookMinutes !== undefined) updateData.cookMinutes = payload.cookMinutes;
    if (payload.totalMinutes !== undefined) updateData.totalMinutes = payload.totalMinutes;
    if (payload.systemUsed !== undefined) updateData.systemUsed = payload.systemUsed;
    if (payload.calories !== undefined) updateData.calories = payload.calories;
    if (payload.categories !== undefined && payload.categories?.length > 0)
      updateData.categories = payload.categories;
    if (payload.fat !== undefined) updateData.fat = payload.fat;
    if (payload.carbs !== undefined) updateData.carbs = payload.carbs;
    if (payload.protein !== undefined) updateData.protein = payload.protein;

    // Phase 27 (W2): only a server-side producer can set this; see RecipeCookPayload.
    if (cook) updateData.cookSource = cook.cookSource;

    updateData.updatedAt = new Date();

    const whereConditions = [eq(recipes.id, recipeId)];

    if (version) {
      whereConditions.push(eq(recipes.version, version));
    }

    const [updatedRecipeRow] = await tx
      .update(recipes)
      .set({ ...updateData, version: sql`${recipes.version} + 1` })
      .where(and(...whereConditions))
      .returning({ id: recipes.id });

    if (!updatedRecipeRow && version) {
      return staleOutcome();
    }

    // Replace tags if provided
    if (payload.tags !== undefined) {
      await attachTagsToRecipeByInputTx(
        tx,
        recipeId,
        (payload.tags as { name: string }[]).map((t) => t.name)
      );
    }

    // Phase 27 (W2): with a server-authored `.cook`, ingredients and steps are a
    // DERIVED projection of it — the authored-input handlers below are bypassed
    // entirely and the projection is rebuilt UPSERT-stably in this transaction.
    if (cook) {
      const current = await tx.query.recipes.findFirst({
        where: eq(recipes.id, recipeId),
        columns: { systemUsed: true },
      });

      await deriveProjectionTx(tx, {
        recipeId,
        systemUsed: (payload.systemUsed ?? current?.systemUsed ?? "metric") as MeasurementSystem,
        cookTokens: cook.cookTokens,
        units: await getUnitsForNormalization(),
      });

      if (payload.images !== undefined) {
        await syncRecipeImagesTx(tx, recipeId, payload.images);
      }

      if (payload.videos !== undefined) {
        await syncRecipeVideosTx(tx, recipeId, payload.videos);
      }

      return appliedOutcome(undefined);
    }

    // Replace ingredients if provided
    if (payload.recipeIngredients !== undefined) {
      // Determine which system is being updated
      let systemToUpdate = payload.systemUsed;

      // If systemUsed is not provided at top level, infer it from the ingredients themselves
      if (!systemToUpdate && payload.recipeIngredients.length > 0) {
        const inferredSystems = new Set(
          (payload.recipeIngredients as any[]).map((ri) => ri.systemUsed).filter(Boolean)
        );

        // If all ingredients use the same system, use that
        if (inferredSystems.size === 1) {
          systemToUpdate = Array.from(inferredSystems)[0];
        }
      }

      // Only delete ingredients for the system being updated (preserve other systems)
      if (systemToUpdate) {
        await syncRecipeIngredientsTx(
          tx,
          recipeId,
          systemToUpdate,
          (payload.recipeIngredients as any[]).map((ri) => ({
            ...ri,
            recipeId,
            ingredientId: ri.ingredientId ?? null,
            amount: ri.amount ?? null,
            order: ri.order ?? 0,
          }))
        );
      } else {
        // If we still can't determine the system, this is an error
        throw new Error("Cannot determine which measurement system to update.");
      }
    }

    // Replace steps if provided
    if (payload.steps !== undefined) {
      // Determine which system is being updated
      let systemToUpdate = payload.systemUsed;

      // If systemUsed is not provided at top level, infer it from the steps themselves
      if (!systemToUpdate && payload.steps.length > 0) {
        const inferredSystems = new Set((payload.steps as any[]).map((s) => s.systemUsed).filter(Boolean));

        // If all steps use the same system, use that
        if (inferredSystems.size === 1) {
          systemToUpdate = Array.from(inferredSystems)[0];
        }
      }

      // Only delete steps for the system being updated (preserve other systems)
      if (systemToUpdate) {
        await syncRecipeStepsTx(tx, recipeId, systemToUpdate, payload.steps);
      } else {
        // If we still can't determine the system, this is an error
        throw new Error("Cannot determine which measurement system to update.");
      }
    }

    // Replace images if provided
    if (payload.images !== undefined) {
      await syncRecipeImagesTx(tx, recipeId, payload.images);
    }

    // Replace videos if provided
    if (payload.videos !== undefined) {
      await syncRecipeVideosTx(tx, recipeId, payload.videos);
    }

    return appliedOutcome(undefined);
  });
}

export interface RandomRecipeCandidate {
  id: string;
  name: string;
  image: string | null;
  categories: RecipeCategory[];
  householdFavoriteCount: number;
  householdAverageRating: number | null;
}

export async function getRandomRecipeCandidates(
  ctx: RecipeListContext,
  category?: RecipeCategory
): Promise<RandomRecipeCandidate[]> {
  const whereConditions: any[] = [];

  const policyCondition = await buildViewPolicyCondition(ctx);

  if (policyCondition) {
    whereConditions.push(policyCondition);
  }

  if (category) {
    whereConditions.push(sql`${category} = ANY(${recipes.categories})`);
  }

  const whereClause = whereConditions.length ? and(...whereConditions) : undefined;

  const householdUserIds = ctx.householdUserIds ?? [ctx.userId];

  const rows = await db
    .select({
      id: recipes.id,
      name: recipes.name,
      image: recipes.image,
      categories: recipes.categories,
    })
    .from(recipes)
    .where(whereClause);

  if (rows.length === 0) return [];

  const recipeIds = rows.map((r) => r.id);

  const { recipeFavorites } = await import("../schema/recipe-favorites");
  const { recipeRatings } = await import("../schema/recipe-ratings");

  const [favoriteCounts, ratingAverages] = await Promise.all([
    db
      .select({
        recipeId: recipeFavorites.recipeId,
        count: sql<number>`count(*)::int`,
      })
      .from(recipeFavorites)
      .where(
        and(
          inArray(recipeFavorites.recipeId, recipeIds),
          inArray(recipeFavorites.userId, householdUserIds)
        )
      )
      .groupBy(recipeFavorites.recipeId),

    db
      .select({
        recipeId: recipeRatings.recipeId,
        avgRating: sql<number>`avg(${recipeRatings.rating})::float`,
      })
      .from(recipeRatings)
      .where(
        and(
          inArray(recipeRatings.recipeId, recipeIds),
          inArray(recipeRatings.userId, householdUserIds)
        )
      )
      .groupBy(recipeRatings.recipeId),
  ]);

  const favoriteMap = new Map(favoriteCounts.map((f) => [f.recipeId, f.count]));
  const ratingMap = new Map(ratingAverages.map((r) => [r.recipeId, r.avgRating]));

  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    image: r.image,
    categories: r.categories ?? [],
    householdFavoriteCount: favoriteMap.get(r.id) ?? 0,
    householdAverageRating: ratingMap.get(r.id) ?? null,
  }));
}

export interface DinnerSuggestionCandidate {
  id: string;
  name: string;
  image: string | null;
  tags: string[];
  householdAverageRating: number | null;
  householdRatingCount: number;
  lastRatedAt: Date | null;
}

/**
 * DINNER-01 candidate set for the "what's for dinner" suggester. Scoped per
 * cookbook via the SAME `buildViewPolicyCondition` the recipe list uses, so the
 * HOUSE-06 boundary is inherited here — a viewer NEVER sees another cookbook's
 * recipes as a candidate, including under the live `view: "everyone"` policy
 * (which the active-cookbook branch clamps to the active cookbook). Returns each
 * accessible recipe with its OWN tags (for the season signal) plus the
 * household-scoped ratings aggregate + last-rated timestamp (for the recency
 * signal). The pure ranking lives in
 * `@norish/shared-server/recipes/dinner-suggester`.
 */
export async function getDinnerSuggestionCandidates(
  ctx: RecipeListContext,
  limit: number = 200
): Promise<DinnerSuggestionCandidate[]> {
  const whereConditions: any[] = [];

  const policyCondition = await buildViewPolicyCondition(ctx);

  if (policyCondition) {
    whereConditions.push(policyCondition);
  }

  const whereClause = whereConditions.length ? and(...whereConditions) : undefined;

  const rows = await db.query.recipes.findMany({
    columns: { id: true, name: true, image: true },
    with: {
      recipeTags: {
        with: { tag: { columns: { name: true } } },
        orderBy: (rt, { asc }) => [asc(rt.order)],
      },
    },
    where: whereClause,
    limit,
  });

  if (rows.length === 0) return [];

  const recipeIds = rows.map((r) => r.id);
  const householdUserIds = ctx.householdUserIds ?? [ctx.userId];

  const { recipeRatings } = await import("../schema/recipe-ratings");

  const ratingAggregates = await db
    .select({
      recipeId: recipeRatings.recipeId,
      avgRating: sql<number>`avg(${recipeRatings.rating})::float`,
      ratingCount: sql<number>`count(*)::int`,
      lastRatedAt: sql<string>`max(${recipeRatings.updatedAt})`,
    })
    .from(recipeRatings)
    .where(
      and(
        inArray(recipeRatings.recipeId, recipeIds),
        inArray(recipeRatings.userId, householdUserIds)
      )
    )
    .groupBy(recipeRatings.recipeId);

  const ratingMap = new Map(ratingAggregates.map((r) => [r.recipeId, r]));

  return rows.map((r) => {
    const agg = ratingMap.get(r.id);

    return {
      id: r.id,
      name: r.name,
      image: r.image,
      tags: (r.recipeTags ?? []).flatMap((rt: { tag?: { name?: string } | null }) =>
        rt.tag && typeof rt.tag.name === "string" ? [rt.tag.name] : []
      ),
      householdAverageRating: agg?.avgRating ?? null,
      householdRatingCount: agg?.ratingCount ?? 0,
      lastRatedAt: agg?.lastRatedAt ? new Date(agg.lastRatedAt) : null,
    };
  });
}

export async function searchRecipesByName(
  ctx: RecipeListContext,
  query: string,
  limit: number = 10
): Promise<{ id: string; name: string; image: string | null }[]> {
  const whereConditions: any[] = [];

  const policyCondition = await buildViewPolicyCondition(ctx);

  if (policyCondition) {
    whereConditions.push(policyCondition);
  }

  whereConditions.push(ilike(recipes.name, `%${query}%`));
  const whereClause = whereConditions.length ? and(...whereConditions) : undefined;
  const rows = await db
    .select({ id: recipes.id, name: recipes.name, image: recipes.image })
    .from(recipes)
    .where(whereClause)
    .orderBy(asc(recipes.name))
    .limit(limit);

  return rows.map((r) => ({ id: r.id, name: r.name, image: r.image }));
}

// --- Recipe Images Management ---

export interface RecipeImageInput {
  image: string;
  order: number;
}

/**
 * Add images to a recipe
 */
export async function addRecipeImages(
  recipeId: string,
  images: RecipeImageInput[]
): Promise<{ id: string; image: string; order: number; version: number }[]> {
  if (!images.length) return [];

  const inserted = await db
    .insert(recipeImages)
    .values(
      images.map((img) => ({
        recipeId,
        image: img.image,
        order: String(img.order),
      }))
    )
    .returning({
      id: recipeImages.id,
      image: recipeImages.image,
      order: recipeImages.order,
      version: recipeImages.version,
    });

  return inserted.map((row) => ({
    id: row.id,
    image: row.image,
    order: Number(row.order) || 0,
    version: row.version,
  }));
}

/**
 * Delete a recipe image by ID
 */
export async function deleteRecipeImageById(
  imageId: string,
  version?: number
): Promise<MutationOutcome<void>> {
  const whereConditions = [eq(recipeImages.id, imageId)];

  if (version) {
    whereConditions.push(eq(recipeImages.version, version));
  }

  const deleted = await db
    .delete(recipeImages)
    .where(and(...whereConditions))
    .returning({ id: recipeImages.id });

  if (deleted.length === 0 && version) {
    return staleOutcome();
  }

  return appliedOutcome(undefined);
}

/**
 * Get all images for a recipe
 */
export async function getRecipeImages(
  recipeId: string
): Promise<{ id: string; image: string; order: number; version: number }[]> {
  const rows = await db
    .select({
      id: recipeImages.id,
      image: recipeImages.image,
      order: recipeImages.order,
      version: recipeImages.version,
    })
    .from(recipeImages)
    .where(eq(recipeImages.recipeId, recipeId))
    .orderBy(asc(recipeImages.order));

  return rows.map((row) => ({
    id: row.id,
    image: row.image,
    order: Number(row.order) || 0,
    version: row.version,
  }));
}

/**
 * Update order of recipe images
 */
export async function updateRecipeImageOrder(imageId: string, newOrder: number): Promise<void> {
  await db
    .update(recipeImages)
    .set({ order: String(newOrder), version: sql`${recipeImages.version} + 1` })
    .where(eq(recipeImages.id, imageId));
}

/**
 * Get recipe image by ID (for permission checking)
 */
export async function getRecipeImageById(
  imageId: string
): Promise<{ id: string; recipeId: string; image: string } | null> {
  const [row] = await db
    .select({ id: recipeImages.id, recipeId: recipeImages.recipeId, image: recipeImages.image })
    .from(recipeImages)
    .where(eq(recipeImages.id, imageId))
    .limit(1);

  return row ?? null;
}

/**
 * Replace all images for a recipe (used during update)
 */
export async function replaceRecipeImages(
  recipeId: string,
  images: RecipeImageInput[]
): Promise<{ id: string; image: string; order: number; version: number }[]> {
  return db.transaction(async (tx) => {
    // Delete existing images
    await tx.delete(recipeImages).where(eq(recipeImages.recipeId, recipeId));

    if (!images.length) return [];

    // Insert new images
    const inserted = await tx
      .insert(recipeImages)
      .values(
        images.map((img) => ({
          recipeId,
          image: img.image,
          order: String(img.order),
        }))
      )
      .returning({
        id: recipeImages.id,
        image: recipeImages.image,
        order: recipeImages.order,
        version: recipeImages.version,
      });

    return inserted.map((row) => ({
      id: row.id,
      image: row.image,
      order: Number(row.order) || 0,
      version: row.version,
    }));
  });
}

/**
 * Count images for a recipe
 */
export async function countRecipeImages(recipeId: string): Promise<number> {
  const [result] = await db
    .select({ count: sql<number>`count(*)` })
    .from(recipeImages)
    .where(eq(recipeImages.recipeId, recipeId));

  return Number(result?.count ?? 0);
}

// --- Recipe Videos Management ---

export interface RecipeVideoInput {
  video: string;
  thumbnail?: string | null;
  duration?: number | null;
  order: number;
}

/**
 * Count videos for a recipe
 */
export async function countRecipeVideos(recipeId: string): Promise<number> {
  const [result] = await db
    .select({ count: sql<number>`count(*)` })
    .from(recipeVideos)
    .where(eq(recipeVideos.recipeId, recipeId));

  return Number(result?.count ?? 0);
}

/**
 * Add videos to a recipe
 */
export async function addRecipeVideos(
  recipeId: string,
  videos: RecipeVideoInput[]
): Promise<
  {
    id: string;
    video: string;
    thumbnail: string | null;
    duration: number | null;
    order: number;
    version: number;
  }[]
> {
  if (!videos.length) return [];

  const inserted = await db
    .insert(recipeVideos)
    .values(
      videos.map((v) => ({
        recipeId,
        video: v.video,
        thumbnail: v.thumbnail ?? null,
        duration: v.duration != null ? String(v.duration) : null,
        order: String(v.order),
      }))
    )
    .returning({
      id: recipeVideos.id,
      video: recipeVideos.video,
      thumbnail: recipeVideos.thumbnail,
      duration: recipeVideos.duration,
      order: recipeVideos.order,
      version: recipeVideos.version,
    });

  return inserted.map((row) => ({
    id: row.id,
    video: row.video,
    thumbnail: row.thumbnail,
    duration: row.duration != null ? Number(row.duration) : null,
    order: Number(row.order) || 0,
    version: row.version,
  }));
}

/**
 * Delete a recipe video by ID
 */
export async function deleteRecipeVideoById(
  videoId: string,
  version?: number
): Promise<MutationOutcome<void>> {
  const whereConditions = [eq(recipeVideos.id, videoId)];

  if (version) {
    whereConditions.push(eq(recipeVideos.version, version));
  }

  const deleted = await db
    .delete(recipeVideos)
    .where(and(...whereConditions))
    .returning({ id: recipeVideos.id });

  if (deleted.length === 0 && version) {
    return staleOutcome();
  }

  return appliedOutcome(undefined);
}

/**
 * Get all videos for a recipe
 */
export async function getRecipeVideos(recipeId: string): Promise<
  {
    id: string;
    video: string;
    thumbnail: string | null;
    duration: number | null;
    order: number;
    version: number;
  }[]
> {
  const rows = await db
    .select({
      id: recipeVideos.id,
      video: recipeVideos.video,
      thumbnail: recipeVideos.thumbnail,
      duration: recipeVideos.duration,
      order: recipeVideos.order,
      version: recipeVideos.version,
    })
    .from(recipeVideos)
    .where(eq(recipeVideos.recipeId, recipeId))
    .orderBy(asc(recipeVideos.order));

  return rows.map((row) => ({
    id: row.id,
    video: row.video,
    thumbnail: row.thumbnail,
    duration: row.duration != null ? Number(row.duration) : null,
    order: Number(row.order) || 0,
    version: row.version,
  }));
}

/**
 * Update order of recipe video
 */
export async function updateRecipeVideoOrder(videoId: string, newOrder: number): Promise<void> {
  await db
    .update(recipeVideos)
    .set({ order: String(newOrder), version: sql`${recipeVideos.version} + 1` })
    .where(eq(recipeVideos.id, videoId));
}

/**
 * Get recipe video by ID (for permission checking)
 */
export async function getRecipeVideoById(
  videoId: string
): Promise<{ id: string; recipeId: string; video: string } | null> {
  const [row] = await db
    .select({ id: recipeVideos.id, recipeId: recipeVideos.recipeId, video: recipeVideos.video })
    .from(recipeVideos)
    .where(eq(recipeVideos.id, videoId))
    .limit(1);

  return row ?? null;
}

/**
 * Replace all videos for a recipe (used during update)
 */
export async function replaceRecipeVideos(
  recipeId: string,
  videos: RecipeVideoInput[]
): Promise<
  {
    id: string;
    video: string;
    thumbnail: string | null;
    duration: number | null;
    order: number;
    version: number;
  }[]
> {
  return db.transaction(async (tx) => {
    // Delete existing videos
    await tx.delete(recipeVideos).where(eq(recipeVideos.recipeId, recipeId));

    if (!videos.length) return [];

    // Insert new videos
    const inserted = await tx
      .insert(recipeVideos)
      .values(
        videos.map((v) => ({
          recipeId,
          video: v.video,
          thumbnail: v.thumbnail ?? null,
          duration: v.duration != null ? String(v.duration) : null,
          order: String(v.order),
        }))
      )
      .returning({
        id: recipeVideos.id,
        video: recipeVideos.video,
        thumbnail: recipeVideos.thumbnail,
        duration: recipeVideos.duration,
        order: recipeVideos.order,
        version: recipeVideos.version,
      });

    return inserted.map((row) => ({
      id: row.id,
      video: row.video,
      thumbnail: row.thumbnail,
      duration: row.duration != null ? Number(row.duration) : null,
      order: Number(row.order) || 0,
      version: row.version,
    }));
  });
}

/**
 * List all media references stored in the database (recipe cover images,
 * gallery images, and videos). Used by startup media cleanup to detect
 * orphaned files on disk.
 */
export async function listAllRecipeMediaReferences(): Promise<{
  recipes: { id: string; image: string | null }[];
  galleryImageUrls: string[];
  videoUrls: string[];
}> {
  const [allRecipes, galleryImages, videos] = await Promise.all([
    db.select({ id: recipes.id, image: recipes.image }).from(recipes),
    db.select({ image: recipeImages.image }).from(recipeImages),
    db.select({ video: recipeVideos.video }).from(recipeVideos),
  ]);

  return {
    recipes: allRecipes,
    galleryImageUrls: galleryImages.map((row) => row.image),
    videoUrls: videos.map((row) => row.video),
  };
}

/**
 * Legacy image migration helpers. Used only by the startup gallery image
 * migration (`@norish/api/startup/migrate-gallery-images`).
 */
export async function listRecipeIdsAndImages(): Promise<{ id: string; image: string | null }[]> {
  return await db.select({ id: recipes.id, image: recipes.image }).from(recipes);
}

export async function listRecipesWithLegacyImageUrls(
  urlPrefix: string
): Promise<{ id: string; image: string | null }[]> {
  return await db
    .select({ id: recipes.id, image: recipes.image })
    .from(recipes)
    .where(like(recipes.image, `${urlPrefix}%`));
}

export async function updateRecipeImageUrl(recipeId: string, imageUrl: string): Promise<void> {
  await db.update(recipes).set({ image: imageUrl }).where(eq(recipes.id, recipeId));
}

export async function listGalleryImagesWithLegacyUrls(): Promise<
  { id: string; recipeId: string; image: string }[]
> {
  return await db
    .select({ id: recipeImages.id, recipeId: recipeImages.recipeId, image: recipeImages.image })
    .from(recipeImages)
    .where(
      or(like(recipeImages.image, "/recipes/images/%"), like(recipeImages.image, "%/gallery/%"))
    );
}

export async function updateGalleryImageUrl(imageId: string, imageUrl: string): Promise<void> {
  await db.update(recipeImages).set({ image: imageUrl }).where(eq(recipeImages.id, imageId));
}

function rewriteSavedRecipeMediaUrl(
  url: string | null | undefined,
  fromRecipeId: string,
  toRecipeId: string
): string | null {
  if (!url || !url.startsWith(`/recipes/${fromRecipeId}/`)) {
    return url ?? null;
  }

  return `/recipes/${toRecipeId}${url.slice(`/recipes/${fromRecipeId}`.length)}`;
}

/**
 * Deep-copy a (public, share-resolved) recipe into a target user's ACTIVE
 * cookbook as a brand-new recipe they OWN (SHARE-02 "save to my cookbook").
 *
 * - `userId` = the saver; `householdId` = the saver's active cookbook
 *   (`ctx.household?.id ?? null`) — never the source recipe's cookbook, so a
 *   saved recipe always lands in the saver's own cookbook and never widens
 *   cross-cookbook visibility.
 * - Copies name, description, notes, image(s), ingredients, steps (+ step
 *   images), times, nutrition, categories and tags. Media URLs are rewritten
 *   from the source recipe id onto `newRecipeId`; the matching files are copied
 *   by the caller before this runs.
 * - `url` is cleared: the source URL points at the original external source and
 *   the `uq_recipes_url_household` unique constraint would otherwise dedup the
 *   copy against the saver's own imports. A saved copy is a fresh owned recipe.
 * - Visibility is intentionally NOT carried over: `createRecipeWithRefs` never
 *   writes the column, so the copy lands at the DB default `private`. The saver
 *   opts in to sharing their own copy separately (it never inherits the
 *   source's `public`).
 *
 * Returns the new recipe id, or `null` if the insert could not be persisted.
 */
export async function copyRecipeForSave(
  source: FullRecipeDTO,
  userId: string,
  householdId: string | null,
  newRecipeId: string
): Promise<string | null> {
  const insert: FullRecipeInsertDTO = {
    name: source.name,
    description: source.description ?? null,
    notes: source.notes ?? null,
    // Cleared on a saved copy — see the doc comment (avoids URL-dedup collision).
    url: null,
    image: rewriteSavedRecipeMediaUrl(source.image, source.id, newRecipeId),
    servings: source.servings,
    systemUsed: source.systemUsed,
    prepMinutes: source.prepMinutes ?? null,
    cookMinutes: source.cookMinutes ?? null,
    totalMinutes: source.totalMinutes ?? null,
    calories: source.calories ?? null,
    fat: source.fat ?? null,
    carbs: source.carbs ?? null,
    protein: source.protein ?? null,
    categories: source.categories ?? [],
    tags: (source.tags ?? []).map((tag) => ({ name: tag.name })),
    recipeIngredients: (source.recipeIngredients ?? []).map((ingredient) => ({
      ingredientName: ingredient.ingredientName,
      ingredientId: null,
      amount: ingredient.amount,
      unit: ingredient.unit ?? null,
      systemUsed: ingredient.systemUsed,
      order: ingredient.order,
    })),
    steps: (source.steps ?? []).map((step) => ({
      step: step.step,
      systemUsed: step.systemUsed,
      order: step.order,
      images: (step.images ?? []).map((image) => ({
        image: rewriteSavedRecipeMediaUrl(image.image, source.id, newRecipeId) ?? image.image,
        order: image.order,
      })),
    })),
    images: (source.images ?? []).map((image) => ({
      image: rewriteSavedRecipeMediaUrl(image.image, source.id, newRecipeId) ?? image.image,
      order: image.order,
    })),
    videos: (source.videos ?? []).map((video) => ({
      video: rewriteSavedRecipeMediaUrl(video.video, source.id, newRecipeId) ?? video.video,
      thumbnail: rewriteSavedRecipeMediaUrl(video.thumbnail, source.id, newRecipeId),
      duration: video.duration ?? null,
      order: video.order,
    })),
  };

  // SHARE-02 / §2.11: carry the source's `.cook` across, but NEVER its projection
  // rows — the copy gets a freshly derived projection with brand-new
  // `recipe_ingredients.id`s, so a grocery FK can never point across two recipes.
  const cook =
    source.cookSource && source.cookTokens
      ? { cookSource: source.cookSource, cookTokens: source.cookTokens }
      : undefined;

  return createRecipeWithRefs(newRecipeId, userId, householdId, insert, cook);
}
