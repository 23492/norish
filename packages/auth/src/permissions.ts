import type { AIConfig, RecipePermissionPolicy } from "@norish/config/zod/server-config";
import {
  DEFAULT_RECIPE_PERMISSION_POLICY,
  ServerConfigKeys,
} from "@norish/config/zod/server-config";
import {
  getHouseholdForUser,
  getHouseholdPolicy,
} from "@norish/db/repositories/households";
import { getConfig } from "@norish/db/repositories/server-config";

export async function getRecipePermissionPolicy(): Promise<RecipePermissionPolicy> {
  const value = await getConfig<RecipePermissionPolicy>(ServerConfigKeys.RECIPE_PERMISSION_POLICY);

  return value ?? DEFAULT_RECIPE_PERMISSION_POLICY;
}

export async function isAIEnabled(): Promise<boolean> {
  const aiConfig = await getConfig<AIConfig>(ServerConfigKeys.AI_CONFIG);

  return aiConfig?.enabled ?? false;
}

export type PermissionAction = "view" | "edit" | "delete";

/**
 * The resolved policy + admin for the cookbook a recipe lives in. Callers
 * resolve this from the recipe's OWN household_id (never the active cookbook)
 * and pass it into canAccessResource, mirroring how 02-03 pushed householdId +
 * memberHouseholdIds into the signature instead of fetching inside the gate.
 * This keeps canAccessResource synchronous + pure (trivially unit-testable) and
 * keeps the per-cookbook boundary keyed strictly off the recipe's cookbook.
 */
export interface ResolvedCookbookPolicy {
  /** The recipe's cookbook policy, or the server-wide default for personal recipes. */
  policy: RecipePermissionPolicy;
  /** The recipe's cookbook admin userId, or null for personal (household_id NULL) recipes. */
  adminUserId: string | null;
}

/**
 * Resolve the policy + admin governing a recipe from its OWN cookbook.
 *
 * - household recipe -> that household's {view,edit,delete} policy + its adminUserId.
 * - personal recipe (householdId NULL) -> the retained server-wide default policy
 *   (decision: personal recipes follow the global default) + a null admin
 *   (admin-edits-any only applies inside a cookbook).
 *
 * Resolution is ALWAYS keyed off the recipe's own household, so a cookbook's
 * policy can never reach into another cookbook (HOUSE-06 invariant).
 */
export async function resolveRecipeCookbookPolicy(
  resourceHouseholdId: string | null
): Promise<ResolvedCookbookPolicy> {
  if (resourceHouseholdId === null) {
    return { policy: await getRecipePermissionPolicy(), adminUserId: null };
  }

  const cookbook = await getHouseholdPolicy(resourceHouseholdId);

  if (!cookbook) {
    // The recipe points at a household that no longer exists; fall back to the
    // global default and no admin (fail-safe: never widen access).
    return { policy: await getRecipePermissionPolicy(), adminUserId: null };
  }

  return { policy: cookbook.policy, adminUserId: cookbook.adminUserId };
}

/**
 * Per-recipe access gate, resolved against the RECIPE'S OWN cookbook policy.
 *
 * `cookbookPolicy`/`cookbookAdminId` come from resolveRecipeCookbookPolicy(
 * resourceHouseholdId) — the recipe's own household, NOT the active cookbook.
 *
 * Semantics:
 * - view = household  -> requester must be a MEMBER of the recipe's cookbook.
 * - edit/delete = household -> the recipe OWNER or the recipe's cookbook ADMIN
 *   (admin-edits-any / members-edit-own; no new role system — the existing
 *   single households.adminUserId is "the admin").
 * - everyone -> anyone; owner -> only the owner (the short-circuit above).
 *
 * A personal recipe (resourceHouseholdId NULL) has a null admin, so household-
 * level edit/delete collapses to owner-only — unchanged behavior.
 */
export function canAccessResource(
  action: PermissionAction,
  userId: string,
  ownerId: string,
  resourceHouseholdId: string | null,
  requesterMemberHouseholdIds: string[],
  isServerAdmin: boolean,
  cookbookPolicy: RecipePermissionPolicy,
  cookbookAdminId: string | null
): boolean {
  if (userId === ownerId || isServerAdmin) return true;

  const policyLevel = cookbookPolicy[action];

  switch (policyLevel) {
    case "everyone":
      return true;

    case "household": {
      // Per-cookbook isolation: a personal recipe (null household) is owner-only
      // and never shared via this branch.
      if (resourceHouseholdId === null) return false;

      if (action === "view") {
        // Any member of the recipe's cookbook may view it.
        return requesterMemberHouseholdIds.includes(resourceHouseholdId);
      }

      // edit/delete: only the recipe's cookbook ADMIN (owner already passed the
      // short-circuit above). Members editing OTHERS' recipes are denied.
      return cookbookAdminId !== null && userId === cookbookAdminId;
    }
    default:
      return false;
  }
}

export async function canAccessHouseholdResource(
  userId: string,
  resourceOwnerId: string
): Promise<boolean> {
  // Owner always has access
  if (userId === resourceOwnerId) return true;

  // Check if user shares a household with the owner
  const userHousehold = await getHouseholdForUser(userId);

  if (!userHousehold) return false;

  // Check if owner is in the user's household
  const householdUserIds = userHousehold.users.map((u) => u.id);

  return householdUserIds.includes(resourceOwnerId);
}

export async function assertHouseholdAccess(
  userId: string,
  resourceOwnerId: string
): Promise<void> {
  const hasAccess = await canAccessHouseholdResource(userId, resourceOwnerId);

  if (!hasAccess) {
    throw new Error("FORBIDDEN");
  }
}

export async function assertAIEnabled(): Promise<void> {
  const enabled = await isAIEnabled();

  if (!enabled) {
    throw new Error("AI features are disabled");
  }
}
