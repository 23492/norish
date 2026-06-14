import type { SubscriptionMultiplexer } from "@norish/queue/redis/subscription-multiplexer";
import type { FullRecipeDTO, HouseholdWithUsersNamesDto, User } from "@norish/shared/contracts";
import type { RecipeShareDto } from "@norish/shared/contracts/dto/recipe-shares";
import type { OperationId } from "@norish/shared/contracts/realtime-envelope";
import type { Context } from "./context";

import { TRPCError } from "@trpc/server";
import { getHouseholdsForUser, isUserServerAdmin } from "@norish/db";
import { getCachedHouseholdForUser } from "@norish/db/cached-household";
import { getActiveRecipeShareByToken } from "@norish/db/repositories/recipe-shares";
import { getRecipeFull } from "@norish/db/repositories/recipes";
import { getOrCreateMultiplexer } from "@norish/queue/redis/subscription-multiplexer";
import { runWithOperationContext } from "@norish/shared-server/lib/operation-context";
import { ResolveSharedRecipeInputSchema } from "@norish/shared/contracts/zod/recipe-shares";


import { middleware, publicProcedure } from "./trpc";

/**
 * Middleware that enforces authentication and provides full context:
 * - User authentication
 * - Household resolution
 */
const withAuth = middleware(async ({ ctx, next }) => {
  if (!ctx.user) {
    throw new TRPCError({
      code: "UNAUTHORIZED",
      message: "You must be logged in to access this resource",
    });
  }

  const user = ctx.user;

  const household = ctx.household ?? (await getCachedHouseholdForUser(user.id));

  const householdUserIds = household?.users.map((u: { id: string }) => u.id) ?? [];
  const allUserIds = [user.id, ...householdUserIds].filter((id, i, arr) => arr.indexOf(id) === i);
  const householdKey = household?.id ?? user.id;
  const isServerAdmin = user.isServerAdmin ?? false;

  // All household ids the user is a member of — the set permissions use for the
  // per-cookbook isolation check (Plan 02-03).
  const memberHouseholds = await getHouseholdsForUser(user.id);
  const memberHouseholdIds = memberHouseholds.map((h) => h.id);

  // Get or create the subscription multiplexer for this WebSocket connection
  // The multiplexer consolidates all Redis subscriptions into a single connection
  let multiplexer: SubscriptionMultiplexer | null = ctx.multiplexer;

  if (!multiplexer && ctx.connectionId) {
    multiplexer = getOrCreateMultiplexer(ctx.connectionId, user.id, householdKey);
  }

  const operationId = ctx.operationId ?? undefined;

  return runWithOperationContext({ operationId }, () =>
    next({
      ctx: {
        ...ctx,
        user,
        household,
        householdKey,
        userIds: allUserIds,
        householdUserIds: householdUserIds.length > 0 ? householdUserIds : null,
        memberHouseholdIds,
        isServerAdmin,
        multiplexer,
        operationId: ctx.operationId,
      },
    })
  );
});

/**
 * Authenticated procedure with full context:
 * - User must be logged in
 * - Household context available (ctx.household, ctx.householdKey, ctx.userIds)
 * - Use canAccessResource from @norish/auth/permissions for permission checks
 */
export const authedProcedure = publicProcedure.use(withAuth);

export type SharedRecipeProcedureContext = Context & {
  sharedRecipe: {
    share: RecipeShareDto;
    token: string;
    recipe: FullRecipeDTO;
  };
};

/**
 * Resolve a `/share/<token>` token to its recipe and enforce the SHARE-01
 * public-visibility gate, attaching the result as `ctx.sharedRecipe`.
 *
 * SHARE-01: the public surface is gated on the recipe's explicit visibility.
 * A private/household recipe is NOT reachable via /share/<token>, even with a
 * valid active token. Every failure (missing/expired/revoked token OR a
 * non-public recipe) is the SAME opaque NOT_FOUND, so a probe cannot
 * distinguish "no such token" from "not public" (no enumeration).
 *
 * This is the SINGLE token->recipe choke point. It backs both the anonymous
 * public procedures (getShared, sharePublicConfig) and the authenticated
 * save-to-cookbook procedure (SHARE-02 saveShared): a user can only save a
 * recipe reachable via a valid PUBLIC share token — never an arbitrary or
 * private recipe id. Weakening this gate is adversarially tested.
 */
async function resolveSharedRecipe(
  input: unknown
): Promise<SharedRecipeProcedureContext["sharedRecipe"]> {
  const { token } = ResolveSharedRecipeInputSchema.parse(input);

  const share = await getActiveRecipeShareByToken(token, { touchLastAccessedAt: true });

  if (!share) {
    throw new TRPCError({ code: "NOT_FOUND", message: "Shared recipe not found" });
  }

  const recipe = await getRecipeFull(share.recipeId);

  if (!recipe) {
    throw new TRPCError({ code: "NOT_FOUND", message: "Shared recipe not found" });
  }

  if (recipe.visibility !== "public") {
    throw new TRPCError({ code: "NOT_FOUND", message: "Shared recipe not found" });
  }

  return { share, token, recipe };
}

/**
 * Anonymous (no-auth) procedure for the public /share/<token> view. Resolves
 * the token to a PUBLIC recipe via the shared gate above.
 */
export const sharedRecipeProcedure = publicProcedure
  .input(ResolveSharedRecipeInputSchema)
  .use(async ({ ctx, input, next }) => {
    const sharedRecipe = await resolveSharedRecipe(input);

    return next({ ctx: { ...ctx, sharedRecipe } as SharedRecipeProcedureContext });
  });

/**
 * Authenticated counterpart of `sharedRecipeProcedure` (SHARE-02): the caller
 * must be logged in (authedProcedure) AND the token must resolve to a PUBLIC
 * recipe through the SAME `resolveSharedRecipe` gate. The inline middleware
 * keeps the authed context (ctx.user, ctx.household, ...) so the save resolver
 * can copy the recipe into the saver's active cookbook.
 */
export const authedSharedRecipeProcedure = authedProcedure
  .input(ResolveSharedRecipeInputSchema)
  .use(async ({ ctx, input, next }) => {
    const sharedRecipe = await resolveSharedRecipe(input);

    return next({ ctx: { ...ctx, sharedRecipe } });
  });

export type AuthedProcedureContext = Context & {
  user: User;
  household: HouseholdWithUsersNamesDto | null;
  householdKey: string;
  userIds: string[];
  householdUserIds: string[] | null;
  memberHouseholdIds: string[];
  isServerAdmin: boolean;
  multiplexer: SubscriptionMultiplexer | null;
  operationId: OperationId | null;
};

/**
 * Middleware that enforces server admin access.
 * Checks both authentication and admin role.
 */
const withServerAdmin = middleware(async ({ ctx, next }) => {
  if (!ctx.user) {
    throw new TRPCError({
      code: "UNAUTHORIZED",
      message: "You must be logged in to access this resource",
    });
  }

  const user = ctx.user;

  const isAdmin = await isUserServerAdmin(user.id);

  if (!isAdmin) {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "Server admin access required",
    });
  }

  return next({
    ctx: {
      ...ctx,
      user,
    },
  });
});

/**
 * Admin procedure that enforces server admin access:
 * - User must be logged in
 * - User must be a server admin (owner or admin role)
 */
export const adminProcedure = publicProcedure.use(withServerAdmin);

export type AdminProcedureContext = Context & {
  user: User;
};
