import type { PermissionLevel } from "@norish/config/zod/server-config";
import type { TypedRedisEmitter } from "@norish/shared-server/redis/pubsub";
import { getHouseholdPolicy } from "@norish/db/repositories/households";
import { getRecipeOwnerAndHousehold } from "@norish/db/repositories/recipes";
import { getRecipePermissionPolicy } from "@norish/shared-server/config/server-config-loader";
import { trpcLogger as log } from "@norish/shared-server/logger";

export interface PolicyEmitContext {
  userId: string;
  householdKey: string;
}

export interface RecipeRealtimeScope {
  viewPolicy: PermissionLevel;
  ctx: PolicyEmitContext;
}

/**
 * Resolve the realtime scope of an event from the RECIPE'S OWN cookbook.
 *
 * This is the realtime sibling of `resolveRecipeCookbookPolicy`
 * (packages/auth/src/permissions.ts) and follows the same invariant: resolution is
 * always keyed off the recipe's own household, so a cookbook's policy can never reach
 * into another cookbook (HOUSE-06 / REALTIME-ISO-01, decision D-22-02).
 *
 * It resolves BOTH halves of the emission, because either one alone leaks:
 * - the view policy (previously the server-wide default at all 54 emit sites), and
 * - the target `householdKey` (previously the ACTOR's active cookbook, which is the
 *   wrong cookbook whenever the actor is working on a recipe from another one — the
 *   `saveShared` and cross-cookbook rating flows).
 *
 * Resolution:
 * - household recipe  -> that household's `view` policy, keyed on that household.
 * - personal recipe   -> the server-wide default policy, keyed on the OWNER's user id
 *                        (matching the `household?.id ?? user.id` key convention in
 *                        packages/trpc/src/middleware.ts), so it can only reach the owner.
 * - unknown / orphaned recipe -> FAIL CLOSED: `owner` scope against the caller-supplied
 *                        actor context. Never widen access for a recipe we cannot resolve.
 *
 * Call this ONCE per job/procedure and reuse the result across that handler's emissions —
 * it is a DB read, and some workers emit a dozen times.
 *
 * @param recipeId  the recipe the event is ABOUT (for `saveShared`, the newly created
 *                  recipe in the saver's cookbook — not the source recipe).
 * @param fallback  the acting user's context, used only on the fail-closed path.
 */
export async function resolveRecipeRealtimeScope(
  recipeId: string,
  fallback: PolicyEmitContext
): Promise<RecipeRealtimeScope> {
  const owner = await getRecipeOwnerAndHousehold(recipeId);

  if (owner === null || owner.userId === null) {
    log.debug({ recipeId }, "Realtime scope: unresolvable recipe, failing closed to actor");

    return { viewPolicy: "owner", ctx: fallback };
  }

  if (owner.householdId === null) {
    const serverDefault = await getRecipePermissionPolicy();

    return {
      viewPolicy: serverDefault.view,
      ctx: { userId: owner.userId, householdKey: owner.userId },
    };
  }

  const cookbook = await getHouseholdPolicy(owner.householdId);

  if (!cookbook) {
    // The recipe points at a household that no longer exists. Keep the recipe's own
    // household as the key (never the actor's) and fall back to the default policy.
    const serverDefault = await getRecipePermissionPolicy();

    return {
      viewPolicy: serverDefault.view,
      ctx: { userId: owner.userId, householdKey: owner.householdId },
    };
  }

  return {
    viewPolicy: cookbook.policy.view,
    ctx: { userId: owner.userId, householdKey: owner.householdId },
  };
}

/**
 * Resolve the realtime scope from a COOKBOOK, for events that precede the recipe row.
 *
 * The import workers emit `importStarted` (and may emit `failed`) before the recipe
 * exists, so there is nothing for `resolveRecipeRealtimeScope` to look up. The job
 * still carries the cookbook the import targets, which is the recipe's household-to-be —
 * use that, never the actor's active cookbook.
 *
 * A null `householdId` (a personal import) keys on the actor's own user id, so it can
 * only reach them.
 */
export async function resolveHouseholdRealtimeScope(
  householdId: string | null | undefined,
  fallback: PolicyEmitContext
): Promise<RecipeRealtimeScope> {
  if (!householdId) {
    const serverDefault = await getRecipePermissionPolicy();

    return {
      viewPolicy: serverDefault.view,
      ctx: { userId: fallback.userId, householdKey: fallback.userId },
    };
  }

  const cookbook = await getHouseholdPolicy(householdId);
  const viewPolicy = cookbook ? cookbook.policy.view : (await getRecipePermissionPolicy()).view;

  return { viewPolicy, ctx: { userId: fallback.userId, householdKey: householdId } };
}

/**
 * Emit an event scoped by a view policy.
 *
 * DECISION D-22-01 — `view: "everyone"` does NOT mean socket broadcast.
 *
 * This function used to map `everyone` onto `emitter.broadcast()`, which publishes to a
 * channel every authenticated connection subscribes to (see `createPolicyAwareIterables`
 * in packages/trpc/src/helpers.ts). With the production default
 * `recipe_permission_policy.view = "everyone"`, that pushed every cookbook's full recipe
 * DTOs to every connected client.
 *
 * "Everyone may FETCH this if they know its id" is an authorisation statement — it is
 * `canAccessResource`'s to make, and it is unchanged. It is not a licence to PUSH the
 * resource, unsolicited, to every open socket. So `everyone` now emits at household
 * scope, and at user scope when the scope has no cookbook.
 *
 * `TypedRedisEmitter.broadcast()` itself is retained and remains correct for genuinely
 * global, non-resource events (server-config changes, connection invalidation). It is
 * only this policy-driven, resource-bearing path that must never reach it.
 *
 * @param viewPolicy resolved via `resolveRecipeRealtimeScope` — NOT the server-wide default.
 */
export function emitByPolicy<
  TEvents extends Record<string, unknown>,
  K extends keyof TEvents & string,
>(
  emitter: TypedRedisEmitter<TEvents>,
  viewPolicy: PermissionLevel,
  ctx: PolicyEmitContext,
  event: K,
  data: TEvents[K]
): void {
  log.debug(
    { event, viewPolicy, householdKey: ctx.householdKey, userId: ctx.userId },
    "Emitting event via policy"
  );

  // A personal scope is keyed on the user id (middleware.ts: `household?.id ?? user.id`),
  // so household-scoped emission would put it on a channel named after a user. Route it
  // to the user channel instead — a personal recipe can only ever reach its owner.
  const isPersonalScope = ctx.householdKey === ctx.userId;

  if (viewPolicy === "owner" || isPersonalScope) {
    emitter.emitToUser(ctx.userId, event, data);
    log.debug({ event, userId: ctx.userId }, "User event emitted");

    return;
  }

  // `everyone` and `household` both stop at the cookbook boundary (D-22-01).
  emitter.emitToHousehold(ctx.householdKey, event, data);
  log.debug({ event, householdKey: ctx.householdKey }, "Household event emitted");
}
