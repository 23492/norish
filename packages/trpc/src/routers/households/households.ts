import type {
  HouseholdAdminSettingsDto,
  HouseholdSettingsDto,
  HouseholdSummaryDto,
} from "@norish/shared/contracts/dto/household";
import type { RecipePermissionPolicy } from "@norish/config/zod/server-config";
import type { HouseholdUserInfo } from "./types";

import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { getRecipePermissionPolicy } from "@norish/config/server-config-loader";
import { DEFAULT_RECIPE_PERMISSION_POLICY } from "@norish/config/zod/server-config";
import {
  addUserToHousehold,
  createHousehold,
  findHouseholdByJoinCode,
  generateInviteToken as generateInviteTokenRepo,
  getActiveHouseholdForUser,
  getActiveHouseholdId,
  getAllergiesForUsers,
  getHouseholdByInviteToken,
  getHouseholdForUser,
  getHouseholdPolicy,
  getHouseholdsForUser,
  getInviteToken,
  getUsersByHouseholdId,
  isUserHouseholdAdmin,
  joinHouseholdByInviteToken,
  kickUserFromHousehold,
  regenerateJoinCode,
  removeUserFromHousehold,
  renameHousehold,
  setActiveHousehold,
  setHouseholdPolicy,
  transferHouseholdAdmin,
} from "@norish/db";
import {
  invalidateHouseholdCache,
  invalidateHouseholdCacheForUsers,
} from "@norish/db/cached-household";
import { trpcLogger as log } from "@norish/shared-server/logger";
import {
  GenerateHouseholdInviteTokenInputSchema,
  GetHouseholdByInviteTokenInputSchema,
  JoinHouseholdByInviteTokenInputSchema,
  KickHouseholdUserInputSchema,
  LeaveHouseholdInputSchema,
  RegenerateHouseholdJoinCodeInputSchema,
  RenameHouseholdInputSchema,
  SetHouseholdPolicyInputSchema,
  TransferHouseholdAdminInputSchema,
} from "@norish/shared/contracts/zod";
import { HouseholdNameSchema, JoinCodeSchema } from "@norish/shared/lib/validation/schemas";


import { emitConnectionInvalidation } from "../../connection-manager";
import { authedProcedure } from "../../middleware";
import { publicProcedure, router } from "../../trpc";
import { permissionsEmitter } from "../permissions/emitter";

import { householdEmitter } from "./emitter";

/**
 * Transforms household data to DTO based on admin status.
 *
 * inviteToken AND the per-cookbook recipe permission policy are admin-only and
 * are NOT carried by the member resolver (HouseholdWithUsersNamesDto is
 * token-/policy-free). The admin branch therefore takes both explicitly (fetched
 * admin-gated by resolveHouseholdDto); the member branch never receives them.
 */
function toHouseholdDto(
  household: Awaited<ReturnType<typeof getHouseholdForUser>>,
  userId: string,
  allergies: string[],
  inviteToken: string | null = null,
  policy: RecipePermissionPolicy | null = null
): HouseholdSettingsDto | HouseholdAdminSettingsDto | null {
  if (!household) return null;

  const typedHousehold = household as typeof household & {
    version: number;
    users: Array<{ id: string; name: string | null; isAdmin?: boolean; version: number }>;
  };

  const isAdmin = typedHousehold.adminUserId === userId;
  const now = new Date();
  const isJoinCodeExpired =
    !typedHousehold.joinCodeExpiresAt || new Date(typedHousehold.joinCodeExpiresAt) < now;
  const typedUsers = typedHousehold.users as Array<{
    id: string;
    name: string | null;
    isAdmin?: boolean;
    version: number;
  }>;

  const users = typedUsers.map((u) => ({
    id: u.id,
    name: u.name ?? null,
    isAdmin: u.isAdmin ?? u.id === typedHousehold.adminUserId,
    version: u.version,
  }));

  if (isAdmin) {
    return {
      id: typedHousehold.id,
      name: typedHousehold.name,
      version: typedHousehold.version,
      joinCode: isJoinCodeExpired ? null : typedHousehold.joinCode,
      joinCodeExpiresAt: isJoinCodeExpired ? null : typedHousehold.joinCodeExpiresAt,
      inviteToken,
      viewPolicy: policy?.view ?? DEFAULT_RECIPE_PERMISSION_POLICY.view,
      editPolicy: policy?.edit ?? DEFAULT_RECIPE_PERMISSION_POLICY.edit,
      deletePolicy: policy?.delete ?? DEFAULT_RECIPE_PERMISSION_POLICY.delete,
      users,
      allergies,
    } as HouseholdAdminSettingsDto;
  }

  return {
    id: typedHousehold.id,
    name: typedHousehold.name,
    version: typedHousehold.version,
    users,
    allergies,
  } as HouseholdSettingsDto;
}

/**
 * Resolve the settings DTO for the requesting user, augmenting the ADMIN branch
 * with the current invite token AND the per-cookbook recipe permission policy
 * (both fetched admin-gated, so neither leaks into a member-facing payload). The
 * resolver itself stays token-/policy-free (HouseholdWithUsersNamesDto); they are
 * read separately only when the requester is the household admin.
 */
async function resolveHouseholdDto(
  household: Awaited<ReturnType<typeof getActiveHouseholdForUser>>,
  userId: string,
  allergies: string[]
): Promise<HouseholdSettingsDto | HouseholdAdminSettingsDto | null> {
  if (!household) return null;

  const isAdmin = household.adminUserId === userId;
  const inviteToken = isAdmin ? await getInviteToken(household.id) : null;
  const cookbookPolicy = isAdmin ? await getHouseholdPolicy(household.id) : null;

  return toHouseholdDto(household, userId, allergies, inviteToken, cookbookPolicy?.policy ?? null);
}

const get = authedProcedure.query(async ({ ctx }) => {
  log.debug({ userId: ctx.user.id }, "Getting household settings");

  // Settings reflect the ACTIVE cookbook (null = personal view).
  const household = await getActiveHouseholdForUser(ctx.user.id);
  const userIds = household?.users.map((u) => u.id) ?? [];
  const allergiesRows = await getAllergiesForUsers(userIds);
  const allergies = [...new Set(allergiesRows.map((a) => a.tagName))];
  const dto = await resolveHouseholdDto(household, ctx.user.id, allergies);

  log.debug({ userId: ctx.user.id, hasHousehold: !!dto }, "Household settings retrieved");

  return { household: dto, currentUserId: ctx.user.id };
});

/**
 * List all households the user is a member of, for the cookbook switcher.
 * Includes the user's active household id (null = personal cookbook).
 */
const list = authedProcedure.query(async ({ ctx }) => {
  log.debug({ userId: ctx.user.id }, "Listing households");

  const households = await getHouseholdsForUser(ctx.user.id);
  const activeHouseholdId = await getActiveHouseholdId(ctx.user.id);

  const householdSummaries: HouseholdSummaryDto[] = households.map((household) => ({
    id: household.id,
    name: household.name,
    isActive: household.id === activeHouseholdId,
    memberCount: household.users.length,
  }));

  return {
    households: householdSummaries,
    activeHouseholdId,
    currentUserId: ctx.user.id,
  };
});

/**
 * Switch the user's active household (or null = personal cookbook).
 * Validates membership (FORBIDDEN otherwise), invalidates the household cache,
 * and terminates the connection so subscriptions rebind to the new active key.
 */
const switchActive = authedProcedure
  .input(z.object({ householdId: z.string().nullable() }))
  .mutation(async ({ ctx, input }) => {
    log.info(
      { userId: ctx.user.id, householdId: input.householdId },
      "Switching active household"
    );

    try {
      await setActiveHousehold(ctx.user.id, input.householdId);
    } catch (err) {
      if (err instanceof Error && err.message === "FORBIDDEN") {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "You are not a member of this household",
        });
      }

      throw err;
    }

    // Cache holds the ACTIVE household; drop it so the next read reflects the switch.
    await invalidateHouseholdCache(ctx.user.id);

    // Rebind subscriptions to the new active household key.
    await emitConnectionInvalidation(ctx.user.id, "household-switched");

    return { success: true, activeHouseholdId: input.householdId };
  });

const create = authedProcedure
  .input(z.object({ name: HouseholdNameSchema }))
  .mutation(async ({ ctx, input }) => {
    const name = (input.name ?? "My Household").trim();
    const id = crypto.randomUUID();

    log.info({ userId: ctx.user.id, name }, "Creating household");

    // Multi-membership: a user may create/belong to many households (no guard).
    // Create household async and emit events
    createHousehold({ name, adminUserId: ctx.user.id })
      .then(async (household) => {
        await addUserToHousehold({ householdId: household.id, userId: ctx.user.id });

        // Auto-generate join code for new household
        await regenerateJoinCode(household.id);

        // The newly created household becomes the user's active cookbook.
        await setActiveHousehold(ctx.user.id, household.id);

        log.info({ userId: ctx.user.id, householdId: household.id }, "Household created");

        // Get full household data with users (after join code generated)
        const fullHousehold = await getActiveHouseholdForUser(ctx.user.id);
        const userIds = fullHousehold?.users.map((u) => u.id) ?? [];
        const allergiesRows = await getAllergiesForUsers(userIds);
        const allergies = [...new Set(allergiesRows.map((a) => a.tagName))];
        const dto = await resolveHouseholdDto(fullHousehold, ctx.user.id, allergies);

        // Emit to the user who created the household
        // This MUST happen before connection invalidation so client receives it
        householdEmitter.emitToUser(ctx.user.id, "created", { household: dto! });

        // Invalidate cache and terminate connection to rebind subscriptions
        // The client already has the household data from the event above
        await invalidateHouseholdCache(ctx.user.id);
        await emitConnectionInvalidation(ctx.user.id, "household-created");
      })
      .catch((err) => {
        log.error({ err, userId: ctx.user.id }, "Failed to create household");
        householdEmitter.emitToUser(ctx.user.id, "failed", {
          reason: "Failed to create household",
        });
      });

    return { id };
  });

const join = authedProcedure
  .input(z.object({ code: z.string() }))
  .mutation(async ({ ctx, input }) => {
    // Clean the code - only digits, max 6
    const cleaned = input.code.replace(/\D/g, "").slice(0, 6);

    log.info({ userId: ctx.user.id }, "Joining household by code");

    // Validate cleaned code format
    JoinCodeSchema.parse(cleaned);

    // Multi-membership: a user may join additional households (no guard).
    // Find household by code
    const household = await findHouseholdByJoinCode(cleaned);

    if (!household) {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: "Invalid join code",
      });
    }

    // Check if code is expired
    if (household.joinCodeExpiresAt && new Date(household.joinCodeExpiresAt) < new Date()) {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: "This join code has expired",
      });
    }

    const householdId = household.id;

    // Fetch existing member IDs for cache invalidation
    const existingMembers = await getUsersByHouseholdId(householdId);
    const existingMemberIds = existingMembers.map((u) => u.userId);

    // Add user async and emit events
    addUserToHousehold({ householdId, userId: ctx.user.id })
      .then(async (membership) => {
        log.info({ userId: ctx.user.id, householdId }, "User joined household");
        const versionedMembership = membership as typeof membership & { version: number };

        // The joined household becomes the user's active cookbook.
        await setActiveHousehold(ctx.user.id, householdId);

        // Get full household for the joining user
        const fullHousehold = await getActiveHouseholdForUser(ctx.user.id);
        const userIds = fullHousehold?.users.map((u) => u.id) ?? [];
        const allergiesRows = await getAllergiesForUsers(userIds);
        const allergies = [...new Set(allergiesRows.map((a) => a.tagName))];
        const dto = await resolveHouseholdDto(fullHousehold, ctx.user.id, allergies);

        // Emit to the joining user FIRST (before connection invalidation)
        householdEmitter.emitToUser(ctx.user.id, "created", { household: dto! });

        // Emit to existing household members
        const userInfo = {
          id: ctx.user.id,
          name: ctx.user.name ?? null,
          isAdmin: false,
          version: versionedMembership.version,
        } as HouseholdUserInfo;

        householdEmitter.emitToHousehold(householdId, "userJoined", { user: userInfo });

        // Invalidate cache and terminate connection AFTER events are sent
        await invalidateHouseholdCacheForUsers([ctx.user.id, ...existingMemberIds]);
        await emitConnectionInvalidation(ctx.user.id, "household-joined");
      })
      .catch((err) => {
        log.error({ err, userId: ctx.user.id }, "Failed to join household");
        householdEmitter.emitToUser(ctx.user.id, "failed", {
          reason: "Failed to join household",
        });
      });

    return { householdId };
  });

/**
 * Generate (or regenerate) the shareable invite link token for a household.
 * Admin-only. Returns the new token synchronously so the settings UI can build
 * the `${origin}/join/<token>` link immediately. Regenerating revokes any old
 * link. SAME security model as the join code (a logged-out visitor still goes
 * through the existing signup flow; no registration bypass).
 */
const generateInviteToken = authedProcedure
  .input(GenerateHouseholdInviteTokenInputSchema)
  .mutation(async ({ ctx, input }) => {
    const { householdId } = input;

    log.info({ userId: ctx.user.id, householdId }, "Generating household invite token");

    // Verify admin status (generating an invite link is admin-only).
    const isAdmin = await isUserHouseholdAdmin(householdId, ctx.user.id);

    if (!isAdmin) {
      throw new TRPCError({
        code: "FORBIDDEN",
        message: "Only the household admin can generate an invite link",
      });
    }

    let inviteToken: string;

    try {
      inviteToken = await generateInviteTokenRepo(householdId, ctx.user.id);
    } catch (err) {
      if (err instanceof Error && err.message === "FORBIDDEN") {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "Only the household admin can generate an invite link",
        });
      }

      throw err;
    }

    // The cached household holds the old token (version bumped); drop it for all
    // members so the admin settings view reflects the new link on next read.
    const members = await getUsersByHouseholdId(householdId);

    await invalidateHouseholdCacheForUsers(members.map((u) => u.userId));

    return { inviteToken };
  });

/**
 * PUBLIC (unauthenticated) lookup: resolve a valid invite token to the cookbook
 * NAME only. Returns null for an invalid/revoked token. NEVER exposes members,
 * recipes, ids, or any other household (per-cookbook isolation HOUSE-06 intact).
 * The token shape is validated by the input schema and is long+random, so it is
 * not enumerable. Deliberately on the public router surface.
 */
const getByInviteToken = publicProcedure
  .input(GetHouseholdByInviteTokenInputSchema)
  .query(async ({ input }) => {
    const household = await getHouseholdByInviteToken(input.token);

    if (!household) return null;

    // Name only — do NOT spread the household row.
    return { name: household.name };
  });

/**
 * Join a household via its shareable invite token (authenticated). Reuses the
 * SAME multi-membership path as join-by-code: addUserToHousehold (idempotent —
 * already a member is a no-op success) + setActiveHousehold + cache/connection
 * invalidation. Throws NOT_FOUND for an invalid/revoked token. Returns the
 * joined household id so the join page can redirect.
 */
const joinByInviteToken = authedProcedure
  .input(JoinHouseholdByInviteTokenInputSchema)
  .mutation(async ({ ctx, input }) => {
    log.info({ userId: ctx.user.id }, "Joining household by invite token");

    const household = await getHouseholdByInviteToken(input.token);

    if (!household) {
      throw new TRPCError({
        code: "NOT_FOUND",
        message: "This invite link is no longer valid",
      });
    }

    const householdId = household.id;

    // Fetch existing member IDs for cache invalidation (before the join).
    const existingMembers = await getUsersByHouseholdId(householdId);
    const existingMemberIds = existingMembers.map((u) => u.userId);

    const membership = await joinHouseholdByInviteToken(input.token, ctx.user.id);
    const versionedMembership = membership as typeof membership & { version: number };

    log.info({ userId: ctx.user.id, householdId }, "User joined household via invite token");

    // The joined household becomes the user's active cookbook (same as join-by-code).
    await setActiveHousehold(ctx.user.id, householdId);

    // Get full household for the joining user.
    const fullHousehold = await getActiveHouseholdForUser(ctx.user.id);
    const userIds = fullHousehold?.users.map((u) => u.id) ?? [];
    const allergiesRows = await getAllergiesForUsers(userIds);
    const allergies = [...new Set(allergiesRows.map((a) => a.tagName))];
    const dto = await resolveHouseholdDto(fullHousehold, ctx.user.id, allergies);

    // Emit to the joining user FIRST (before connection invalidation).
    householdEmitter.emitToUser(ctx.user.id, "created", { household: dto! });

    // Emit to existing household members.
    const userInfo = {
      id: ctx.user.id,
      name: ctx.user.name ?? null,
      isAdmin: false,
      version: versionedMembership.version,
    } as HouseholdUserInfo;

    householdEmitter.emitToHousehold(householdId, "userJoined", { user: userInfo });

    // Invalidate cache + terminate connection AFTER events are sent.
    await invalidateHouseholdCacheForUsers([ctx.user.id, ...existingMemberIds]);
    await emitConnectionInvalidation(ctx.user.id, "household-joined");

    return { householdId };
  });

const leave = authedProcedure.input(LeaveHouseholdInputSchema).mutation(async ({ ctx, input }) => {
  const { householdId, version } = input;

  log.info({ userId: ctx.user.id, householdId }, "Leaving household");

  // Multi-membership: resolve the SPECIFIC household being left (not "first").
  const memberships = await getHouseholdsForUser(ctx.user.id);
  const household = memberships.find((h) => h.id === householdId);

  if (!household) {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "You are not in this household",
    });
  }

  // Check if user is admin with other members
  if (household.adminUserId === ctx.user.id && household.users.length > 1) {
    throw new TRPCError({
      code: "FORBIDDEN",
      message:
        "You must transfer admin privileges before leaving. Go to Household Settings to assign a new admin.",
    });
  }

  // Store remaining member IDs from the already-fetched household data
  const remainingMemberIds = household.users.filter((u) => u.id !== ctx.user.id).map((u) => u.id);

  // Remove user async and emit events - fire and forget
  removeUserFromHousehold(householdId, ctx.user.id, version)
    .then(async (result) => {
      if (result.stale) {
        log.info(
          { userId: ctx.user.id, householdId, version },
          "Ignoring stale household leave mutation"
        );

        return;
      }

      log.info({ userId: ctx.user.id, householdId }, "User left household");

      // If the left household was the user's active one, reset to personal.
      const activeHouseholdId = await getActiveHouseholdId(ctx.user.id);

      if (activeHouseholdId === householdId) {
        await setActiveHousehold(ctx.user.id, null);
      }

      // Invalidate cache for leaving user AND remaining members (their user list changed)
      await invalidateHouseholdCacheForUsers([ctx.user.id, ...remainingMemberIds]);

      // Terminate connection to rebind subscriptions (now user-only channels)
      await emitConnectionInvalidation(ctx.user.id, "household-left");

      // Emit to remaining members
      for (const memberId of remainingMemberIds) {
        householdEmitter.emitToUser(memberId, "userLeft", { userId: ctx.user.id });
      }
    })
    .catch((err) => {
      log.error({ err, userId: ctx.user.id }, "Failed to leave household");
      householdEmitter.emitToUser(ctx.user.id, "failed", {
        reason: "Failed to leave household",
      });
    });

  return { success: true };
});

const kick = authedProcedure
  .input(KickHouseholdUserInputSchema)
  .mutation(async ({ ctx, input }) => {
    const { householdId, userId: userIdToKick, version } = input;

    log.info({ userId: ctx.user.id, householdId, userIdToKick }, "Kicking user from household");

    // Verify admin status
    const isAdmin = await isUserHouseholdAdmin(householdId, ctx.user.id);

    if (!isAdmin) {
      throw new TRPCError({
        code: "FORBIDDEN",
        message: "Only the household admin can kick members",
      });
    }

    if (userIdToKick === ctx.user.id) {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: "You cannot kick yourself",
      });
    }

    // Verify the user is actually in the household (resolve the SPECIFIC one).
    const memberships = await getHouseholdsForUser(ctx.user.id);
    const household = memberships.find((h) => h.id === householdId);
    const kickedUser = household?.users.find((u) => u.id === userIdToKick);

    if (!kickedUser) {
      throw new TRPCError({
        code: "NOT_FOUND",
        message: "User is not a member of this household",
      });
    }

    // Get remaining member IDs for cache invalidation
    const remainingMemberIds =
      household?.users.filter((u) => u.id !== userIdToKick).map((u) => u.id) ?? [];

    // Kick user async and emit events
    kickUserFromHousehold(householdId, userIdToKick, ctx.user.id, version)
      .then(async (result) => {
        if (result.stale) {
          log.info(
            { userId: ctx.user.id, householdId, userIdToKick, version },
            "Ignoring stale household kick mutation"
          );

          return;
        }

        log.info({ userId: ctx.user.id, householdId, userIdToKick }, "User kicked from household");

        // If the kicked household was the kicked user's active one, reset to personal.
        const kickedActiveHouseholdId = await getActiveHouseholdId(userIdToKick);

        if (kickedActiveHouseholdId === householdId) {
          await setActiveHousehold(userIdToKick, null);
        }

        // Emit to the kicked user FIRST (before their connection is terminated)
        householdEmitter.emitToUser(userIdToKick, "userKicked", {
          householdId,
          kickedBy: ctx.user.id,
        });

        // Emit policyUpdated to kicked user so their recipe view refreshes
        // (they lose access to household recipes)
        const recipePolicy = await getRecipePermissionPolicy();

        permissionsEmitter.emitToUser(userIdToKick, "policyUpdated", { recipePolicy });

        // Emit to remaining household members (household-scoped)
        householdEmitter.emitToHousehold(householdId, "memberRemoved", { userId: userIdToKick });

        // Invalidate cache and terminate connection AFTER events are sent
        await invalidateHouseholdCacheForUsers([userIdToKick, ...remainingMemberIds]);
        await emitConnectionInvalidation(userIdToKick, "household-kicked");
      })
      .catch((err) => {
        log.error({ err, userId: ctx.user.id }, "Failed to kick user");
        householdEmitter.emitToUser(ctx.user.id, "failed", {
          reason: "Failed to kick user from household",
        });
      });

    return { success: true };
  });

const regenerateCode = authedProcedure
  .input(RegenerateHouseholdJoinCodeInputSchema)
  .mutation(async ({ ctx, input }) => {
    const { householdId, version } = input;

    log.info({ userId: ctx.user.id, householdId }, "Regenerating join code");

    // Verify admin status
    const isAdmin = await isUserHouseholdAdmin(householdId, ctx.user.id);

    if (!isAdmin) {
      throw new TRPCError({
        code: "FORBIDDEN",
        message: "Only the household admin can regenerate the join code",
      });
    }

    // Regenerate code async and emit events
    regenerateJoinCode(householdId, version)
      .then((result) => {
        if (result.stale || !result.value) {
          log.info(
            { userId: ctx.user.id, householdId, version },
            "Ignoring stale household join-code regeneration"
          );

          return;
        }

        const household = result.value;

        log.info({ userId: ctx.user.id, householdId }, "Join code regenerated");

        // Emit to all household members
        householdEmitter.emitToHousehold(householdId, "joinCodeRegenerated", {
          joinCode: household.joinCode!,
          joinCodeExpiresAt: household.joinCodeExpiresAt!.toISOString(),
          version: household.version,
        });
      })
      .catch((err) => {
        log.error({ err, userId: ctx.user.id }, "Failed to regenerate join code");
        householdEmitter.emitToUser(ctx.user.id, "failed", {
          reason: "Failed to regenerate join code",
        });
      });

    return { success: true };
  });

const rename = authedProcedure
  .input(RenameHouseholdInputSchema)
  .mutation(async ({ ctx, input }) => {
    const { householdId, name, version } = input;

    log.info({ userId: ctx.user.id, householdId }, "Renaming household");

    // Verify admin status (rename is admin-only).
    const isAdmin = await isUserHouseholdAdmin(householdId, ctx.user.id);

    if (!isAdmin) {
      throw new TRPCError({
        code: "FORBIDDEN",
        message: "Only the household admin can rename the cookbook",
      });
    }

    // Capture members up-front so we can invalidate their caches after rename.
    const members = await getUsersByHouseholdId(householdId);
    const memberIds = members.map((u) => u.userId);

    // Rename async and refresh caches
    renameHousehold(householdId, ctx.user.id, name, version)
      .then(async (result) => {
        if (result.stale || !result.value) {
          log.info(
            { userId: ctx.user.id, householdId, version },
            "Ignoring stale household rename mutation"
          );

          return;
        }

        log.info({ userId: ctx.user.id, householdId }, "Household renamed");

        // The cached household holds the old name; drop it for all members so
        // the switcher + settings reflect the new name on their next read.
        await invalidateHouseholdCacheForUsers(memberIds);
      })
      .catch((err) => {
        log.error({ err, userId: ctx.user.id }, "Failed to rename household");
        householdEmitter.emitToUser(ctx.user.id, "failed", {
          reason: "Failed to rename household",
        });
      });

    return { success: true };
  });

const setPolicy = authedProcedure
  .input(SetHouseholdPolicyInputSchema)
  .mutation(async ({ ctx, input }) => {
    const { householdId, view, edit, delete: del, version } = input;

    log.info({ userId: ctx.user.id, householdId }, "Setting household recipe policy");

    // Verify admin status (setting the cookbook policy is admin-only).
    const isAdmin = await isUserHouseholdAdmin(householdId, ctx.user.id);

    if (!isAdmin) {
      throw new TRPCError({
        code: "FORBIDDEN",
        message: "Only the household admin can change the recipe permissions",
      });
    }

    const policy: RecipePermissionPolicy = { view, edit, delete: del };

    // Capture members up-front so we can invalidate their caches after the change.
    const members = await getUsersByHouseholdId(householdId);
    const memberIds = members.map((u) => u.userId);

    // Update async + refresh caches / nudge members' recipe views to refetch.
    setHouseholdPolicy(householdId, ctx.user.id, policy, version)
      .then(async (result) => {
        if (result.stale || !result.value) {
          log.info(
            { userId: ctx.user.id, householdId, version },
            "Ignoring stale household policy mutation"
          );

          return;
        }

        log.info({ userId: ctx.user.id, householdId }, "Household recipe policy updated");

        // The cached household holds the old policy; drop it for all members so
        // the settings card reflects the new policy on their next read.
        await invalidateHouseholdCacheForUsers(memberIds);

        // Nudge every member's recipe view to refetch under the new policy (reuse
        // the same permissionsEmitter path the kick handler uses). The payload
        // carries the GLOBAL default policy shape only as a generic refresh
        // trigger — the actual per-recipe access is re-resolved server-side.
        const recipePolicy = await getRecipePermissionPolicy();

        for (const memberId of memberIds) {
          permissionsEmitter.emitToUser(memberId, "policyUpdated", { recipePolicy });
        }
      })
      .catch((err) => {
        log.error({ err, userId: ctx.user.id }, "Failed to set household policy");
        householdEmitter.emitToUser(ctx.user.id, "failed", {
          reason: "Failed to set household recipe permissions",
        });
      });

    return { success: true };
  });

const transferAdmin = authedProcedure
  .input(TransferHouseholdAdminInputSchema)
  .mutation(async ({ ctx, input }) => {
    const { householdId, newAdminId, version } = input;

    log.info({ userId: ctx.user.id, householdId, newAdminId }, "Transferring admin");

    // Verify current admin status
    const isAdmin = await isUserHouseholdAdmin(householdId, ctx.user.id);

    if (!isAdmin) {
      throw new TRPCError({
        code: "FORBIDDEN",
        message: "Only the current admin can transfer admin privileges",
      });
    }

    if (newAdminId === ctx.user.id) {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: "You are already the admin",
      });
    }

    // Transfer admin async and emit events
    transferHouseholdAdmin(householdId, ctx.user.id, newAdminId, version)
      .then((result) => {
        if (result.stale || !result.value) {
          log.info(
            { userId: ctx.user.id, householdId, newAdminId, version },
            "Ignoring stale household admin transfer"
          );

          return;
        }

        const household = result.value;

        log.info({ userId: ctx.user.id, householdId, newAdminId }, "Admin transferred");

        // Emit to all household members
        householdEmitter.emitToHousehold(householdId, "adminTransferred", {
          oldAdminId: ctx.user.id,
          newAdminId,
          version: household.version,
        });
      })
      .catch((err) => {
        log.error({ err, userId: ctx.user.id }, "Failed to transfer admin");
        householdEmitter.emitToUser(ctx.user.id, "failed", {
          reason: "Failed to transfer admin privileges",
        });
      });

    return { success: true };
  });

export const householdsRouter = router({
  get,
  list,
  create,
  join,
  generateInviteToken,
  getByInviteToken,
  joinByInviteToken,
  leave,
  kick,
  switchActive,
  regenerateCode,
  rename,
  setPolicy,
  transferAdmin,
});
