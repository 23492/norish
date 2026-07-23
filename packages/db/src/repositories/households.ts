import type {
  HouseholdDto,
  HouseholdInsertDto,
  HouseholdUserDto,
  HouseholdUserInsertDto,
  HouseholdWithUsersNamesDto,
} from "@norish/shared/contracts/dto/household";
import type { RecipePermissionPolicy } from "@norish/config/zod/server-config";
import type { MutationOutcome } from "./mutation-outcomes";

import crypto from "node:crypto";

import {
  DEFAULT_RECIPE_PERMISSION_POLICY,
  ServerConfigKeys,
} from "@norish/config/zod/server-config";
import { and, asc, eq, sql } from "drizzle-orm";
import { db } from "@norish/db/drizzle";
import { households, householdUsers } from "@norish/db/schema";
import {
  HouseholdInsertBaseSchema,
  HouseholdSelectBaseSchema,
  HouseholdUserInsertBaseSchema,
  HouseholdUserSelectBaseSchema,
  HouseholdWithUsersNamesSchema,
} from "@norish/shared/contracts/zod/household";

import { appliedOutcome, staleOutcome } from "./mutation-outcomes";
import { getConfig } from "./server-config";
import { seedDefaultAislesForHousehold } from "./stores";
import { getActiveHouseholdId, getUsersByIds, setActiveHouseholdId } from "./users";

/**
 * The server-wide recipe_permission_policy, demoted to "default for new
 * cookbooks" (decision #4). Read at household-create time + written into the new
 * household's policy columns. Falls back to DEFAULT_RECIPE_PERMISSION_POLICY.
 */
async function getDefaultCookbookPolicy(): Promise<RecipePermissionPolicy> {
  const value = await getConfig<RecipePermissionPolicy>(ServerConfigKeys.RECIPE_PERMISSION_POLICY);
  const policy = value ?? DEFAULT_RECIPE_PERMISSION_POLICY;

  // ROOT-ISO-01: decision #5 disallows a per-cookbook `view = everyone`, and
  // `setHouseholdPolicy` has always rejected it. Inheriting the server-wide default
  // was the hole: it laundered an `everyone` straight into every new cookbook, which
  // is how both live cookbooks came to hold a value the setter would refuse. Clamp on
  // the way in, so a cookbook can never be BORN with something it cannot be SET to.
  return policy.view === "everyone" ? { ...policy, view: "household" } : policy;
}

export async function getUsersByHouseholdId(householdId: string): Promise<HouseholdUserDto[]> {
  const rows = await db.query.householdUsers.findMany({
    where: eq(householdUsers.householdId, householdId),
  });

  return rows;
}

export async function createHousehold(input: HouseholdInsertDto): Promise<HouseholdDto> {
  const parsed = HouseholdInsertBaseSchema.safeParse(input);

  if (!parsed.success) throw new Error("Invalid HouseholdInsertDto");

  // generate a unique 6-digit code with 10-minute expiration
  const code = await generateUniqueJoinCode();
  const expiresAt = new Date(Date.now() + 10 * 60 * 1000); // 10 minutes

  // New cookbooks inherit the server-wide policy as their default (decision #4).
  const defaultPolicy = await getDefaultCookbookPolicy();

  const [row] = await db
    .insert(households)
    .values({
      ...parsed.data,
      joinCode: code,
      joinCodeExpiresAt: expiresAt,
      viewPolicy: defaultPolicy.view,
      editPolicy: defaultPolicy.edit,
      deletePolicy: defaultPolicy.delete,
    })
    .returning();
  const validated = HouseholdSelectBaseSchema.safeParse(row);

  if (!validated.success) throw new Error("Failed to parse created household");

  // SHOP-01: a brand-new household (signup own-household, a new cookbook, or an
  // OIDC-claimed org household) is born with the built-in default aisles + the
  // ingredient->aisle mapping, so its shopping list is grouped with zero config.
  // Idempotent (skips if the household already has stores); failure to seed must
  // never break household creation.
  try {
    await seedDefaultAislesForHousehold(validated.data.id, validated.data.adminUserId);
  } catch {
    // best-effort seed; the household is fully usable without it.
  }

  return validated.data;
}

/**
 * SHOP-02 / D-25-03: resolve the household that OWNS a user's personal shopping
 * list — their auto-created OWN household (earliest household they admin; from
 * signup). Falls back to their earliest membership. Used to scope the shopping
 * list when the user is in the personal (no active household) view.
 */
export async function getOwnHouseholdId(userId: string): Promise<string | null> {
  const [adminRow] = await db
    .select({ id: households.id })
    .from(households)
    .where(eq(households.adminUserId, userId))
    .orderBy(asc(households.createdAt))
    .limit(1);

  if (adminRow?.id) return adminRow.id;

  const [memberRow] = await db
    .select({ id: households.id })
    .from(households)
    .innerJoin(householdUsers, eq(householdUsers.householdId, households.id))
    .where(eq(householdUsers.userId, userId))
    .orderBy(asc(households.createdAt))
    .limit(1);

  return memberRow?.id ?? null;
}

export async function deleteHousehold(id: string): Promise<void> {
  await db.delete(households).where(eq(households.id, id));
}

export async function getHouseholdById(id: string): Promise<HouseholdDto | null> {
  const rows = await db.select().from(households).where(eq(households.id, id)).limit(1);
  const parsed = HouseholdSelectBaseSchema.safeParse(rows[0]);

  return parsed.success ? parsed.data : null;
}

type HouseholdWithMembersRow = {
  id: string;
  name: string;
  adminUserId: string;
  version: number;
  createdAt: Date;
  updatedAt: Date;
  joinCode: string | null;
  joinCodeExpiresAt: Date | null;
  users?: Array<{ userId: string; version: number }> | null;
};

/**
 * Hydrate a raw household row (with its membership rows) into the
 * HouseholdWithUsersNamesDto shape, resolving member display names.
 * Shared by getHouseholdForUser / getHouseholdsForUser / getActiveHouseholdForUser.
 */
async function mapHouseholdRowToDto(
  h: HouseholdWithMembersRow
): Promise<HouseholdWithUsersNamesDto> {
  const members = (h.users ?? []) as Array<{ userId: string; version: number }>;
  const allUserIds = members.map((m) => m.userId);

  const usersRows = await getUsersByIds(allUserIds);
  const idToName = new Map(usersRows.map((u) => [u.id, u.name]));

  const mapped = {
    id: h.id,
    name: h.name,
    adminUserId: h.adminUserId,
    version: h.version,
    createdAt: h.createdAt,
    updatedAt: h.updatedAt,
    joinCode: h.joinCode,
    joinCodeExpiresAt: h.joinCodeExpiresAt,
    users: members.map((member) => ({
      id: member.userId,
      name: idToName.get(member.userId) ?? null,
      isAdmin: member.userId === h.adminUserId,
      version: member.version,
    })),
  };

  const parsed = HouseholdWithUsersNamesSchema.safeParse(mapped);

  if (!parsed.success) throw new Error("Failed to parse household for user");

  return parsed.data;
}

const HOUSEHOLD_WITH_MEMBERS_QUERY = {
  columns: {
    id: true,
    name: true,
    adminUserId: true,
    version: true,
    createdAt: true,
    updatedAt: true,
    joinCode: true,
    joinCodeExpiresAt: true,
  },
  with: {
    users: {
      columns: { userId: true, version: true },
    },
  },
} as const;

/**
 * Get the user's FIRST household (legacy single-household read).
 *
 * NOTE: This is no longer the scoping resolver. Active-household scoping uses
 * getActiveHouseholdForUser. A user may now belong to multiple households;
 * this returns whichever membership row findFirst yields and is retained only
 * for a few admin/transfer/legacy paths.
 */
export async function getHouseholdForUser(
  userId: string
): Promise<HouseholdWithUsersNamesDto | null> {
  const row = (await db.query.householdUsers.findFirst({
    where: eq(householdUsers.userId, userId),
    columns: { householdId: true },
    with: {
      household: HOUSEHOLD_WITH_MEMBERS_QUERY,
    },
  })) as { household: HouseholdWithMembersRow | null } | undefined;

  if (!row?.household) return null;

  return mapHouseholdRowToDto(row.household);
}

/**
 * Get ALL households a user is a member of (for the cookbook switcher).
 * Hydrates each to the same HouseholdWithUsersNamesDto shape getHouseholdForUser builds.
 */
export async function getHouseholdsForUser(
  userId: string
): Promise<HouseholdWithUsersNamesDto[]> {
  const rows = (await db.query.householdUsers.findMany({
    where: eq(householdUsers.userId, userId),
    columns: { householdId: true },
    with: {
      household: HOUSEHOLD_WITH_MEMBERS_QUERY,
    },
  })) as Array<{ household: HouseholdWithMembersRow | null }>;

  const householdsForUser = rows
    .map((r) => r.household)
    .filter((h): h is HouseholdWithMembersRow => h !== null);

  return Promise.all(householdsForUser.map((h) => mapHouseholdRowToDto(h)));
}

/**
 * Resolve the user's ACTIVE household (the single scoping resolver).
 *
 * Reads user.active_household_id; returns that household only if the user is
 * still a member of it. If the pointer is null OR membership is gone, returns
 * null (= personal cookbook view) and self-heals a stale non-null pointer.
 */
export async function getActiveHouseholdForUser(
  userId: string
): Promise<HouseholdWithUsersNamesDto | null> {
  const activeHouseholdId = await getActiveHouseholdId(userId);

  if (!activeHouseholdId) return null;

  const membership = await db.query.householdUsers.findFirst({
    where: and(
      eq(householdUsers.userId, userId),
      eq(householdUsers.householdId, activeHouseholdId)
    ),
    columns: { householdId: true },
    with: {
      household: HOUSEHOLD_WITH_MEMBERS_QUERY,
    },
  });

  const row = membership as { household: HouseholdWithMembersRow | null } | undefined;

  if (!row?.household) {
    // Stale non-null pointer (household deleted or user no longer a member): self-heal.
    await setActiveHouseholdId(userId, null);

    return null;
  }

  return mapHouseholdRowToDto(row.household);
}

/**
 * Set (or clear) the user's active household. When non-null, asserts the user
 * has a membership row for it (throws "FORBIDDEN" otherwise). Pass null to
 * switch back to the personal cookbook.
 */
export async function setActiveHousehold(
  userId: string,
  householdId: string | null
): Promise<void> {
  if (householdId !== null) {
    const membership = await db.query.householdUsers.findFirst({
      where: and(
        eq(householdUsers.userId, userId),
        eq(householdUsers.householdId, householdId)
      ),
      columns: { householdId: true },
    });

    if (!membership) throw new Error("FORBIDDEN");
  }

  await setActiveHouseholdId(userId, householdId);
}

/**
 * Gets all member IDs of a household.
 * Pass the household id (resolve the active household first if you want the
 * active cookbook's members).
 */
export async function getHouseholdMemberIds(householdId: string): Promise<string[]> {
  const rows = await db
    .select({ userId: householdUsers.userId })
    .from(householdUsers)
    .where(eq(householdUsers.householdId, householdId));

  return Array.from(new Set(rows.map((r) => r.userId)));
}

/**
 * Gets all household IDs that a user belongs to.
 * Used for multi-cookbook membership checks in permission resolution.
 */
export async function getUserHouseholdIds(userId: string): Promise<string[]> {
  const rows = await db
    .select({ householdId: householdUsers.householdId })
    .from(householdUsers)
    .where(eq(householdUsers.userId, userId));

  return rows.map((r) => r.householdId);
}

export async function addUserToHousehold(input: HouseholdUserInsertDto): Promise<HouseholdUserDto> {
  const parsed = HouseholdUserInsertBaseSchema.safeParse(input);

  if (!parsed.success) throw new Error("Invalid HouseholdUserInsertDto");

  // Multi-membership: a user may belong to many households (no single-household guard).
  const [row] = await db
    .insert(householdUsers)
    .values(parsed.data as any)
    .onConflictDoNothing()
    .returning();

  const resolved = row
    ? row
    : (
        await db
          .select()
          .from(householdUsers)
          .where(
            and(
              eq(householdUsers.householdId, parsed.data.householdId),
              eq(householdUsers.userId, parsed.data.userId)
            )
          )
          .limit(1)
      )[0];

  const validated = HouseholdUserSelectBaseSchema.safeParse(resolved);

  if (!validated.success) throw new Error("Failed to add user to household");

  return validated.data;
}

export async function removeUserFromHousehold(
  householdId: string,
  userId: string,
  version?: number
): Promise<MutationOutcome<void>> {
  return await db.transaction(async (tx) => {
    const whereConditions = [
      eq(householdUsers.householdId, householdId),
      eq(householdUsers.userId, userId),
    ];

    if (version) {
      whereConditions.push(eq(householdUsers.version, version));
    }

    const deletedMembership = await tx
      .delete(householdUsers)
      .where(and(...whereConditions))
      .returning({ userId: householdUsers.userId });

    if (deletedMembership.length === 0) {
      return staleOutcome();
    }

    const rows = await tx
      .select({ count: sql<number>`count(*)` })
      .from(householdUsers)
      .where(eq(householdUsers.householdId, householdId));

    const count = Number(rows?.[0]?.count ?? 0);

    if (count === 0) {
      await tx.delete(households).where(eq(households.id, householdId));
    }

    return appliedOutcome(undefined);
  });
}

export async function findHouseholdByJoinCode(code: string): Promise<HouseholdDto | null> {
  const rows = await db
    .select()
    .from(households)
    .where(eq(households.joinCode as any, code))
    .limit(1);
  const parsed = HouseholdSelectBaseSchema.safeParse(rows[0]);

  return parsed.success ? parsed.data : null;
}

export async function joinHouseholdByCode(
  userId: string,
  code: string
): Promise<HouseholdUserDto | null> {
  const household = await findHouseholdByJoinCode(code);

  if (!household) return null;

  return addUserToHousehold({ householdId: household.id, userId });
}

/**
 * Generate (or regenerate) the shareable invite token for a household.
 *
 * Admin-only: throws "FORBIDDEN" if the requester is not the household admin.
 * The token is long + crypto-random + url-safe (32 bytes base64url ~= 43 chars),
 * so it is unguessable and not enumerable. Replaces any existing token (so an
 * admin can revoke an old link by regenerating). Returns the new token.
 */
export async function generateInviteToken(
  householdId: string,
  requesterId: string
): Promise<string> {
  const household = await getHouseholdById(householdId);

  if (!household || household.adminUserId !== requesterId) {
    throw new Error("FORBIDDEN");
  }

  const token = await generateUniqueInviteToken();

  const [row] = await db
    .update(households)
    .set({
      inviteToken: token,
      updatedAt: new Date(),
      version: sql`${households.version} + 1`,
    })
    .where(eq(households.id, householdId))
    .returning({ inviteToken: households.inviteToken });

  if (!row?.inviteToken) throw new Error("Failed to generate invite token");

  return row.inviteToken;
}

/**
 * PUBLIC lookup by invite token — returns ONLY the household id + name for a
 * valid token, or null. The id is for the server-side join path; the public
 * tRPC query exposes the name only. Never returns members, recipes, or any
 * other household data (per-cookbook isolation HOUSE-06 stays intact).
 */
export async function getHouseholdByInviteToken(
  token: string
): Promise<{ id: string; name: string } | null> {
  if (!token) return null;

  const rows = await db
    .select({ id: households.id, name: households.name })
    .from(households)
    .where(eq(households.inviteToken, token))
    .limit(1);

  return rows[0] ?? null;
}

/**
 * Admin-gated read of a household's current invite token (or null if none).
 *
 * Columns-only fetch — does NOT go through the shared member resolver
 * (mapHouseholdRowToDto / HouseholdWithUsersNamesSchema stays token-free). The
 * caller MUST gate this on household-admin status; the token is admin-only (it
 * grants join access) and must never reach a member-facing payload.
 */
export async function getInviteToken(householdId: string): Promise<string | null> {
  const household = await db.query.households.findFirst({
    where: eq(households.id, householdId),
    columns: { inviteToken: true },
  });

  return household?.inviteToken ?? null;
}

/**
 * Join a household via its invite token. Reuses the SAME multi-membership path
 * as join-by-code (addUserToHousehold, which is idempotent via
 * onConflictDoNothing — already a member is a no-op success). Setting the joined
 * household active + cache invalidation is the caller's responsibility (the
 * router mirrors the join-by-code flow). Throws "NOT_FOUND" for an invalid token.
 */
export async function joinHouseholdByInviteToken(
  token: string,
  userId: string
): Promise<HouseholdUserDto> {
  const household = await getHouseholdByInviteToken(token);

  if (!household) throw new Error("NOT_FOUND");

  return addUserToHousehold({ householdId: household.id, userId });
}

/**
 * Regenerates the join code for a household with a new 10-minute expiration
 */
export async function regenerateJoinCode(
  householdId: string,
  version?: number
): Promise<MutationOutcome<HouseholdDto>> {
  const code = await generateUniqueJoinCode();
  const expiresAt = new Date(Date.now() + 10 * 60 * 1000); // 10 minutes

  const whereConditions = [eq(households.id, householdId)];

  if (version) {
    whereConditions.push(eq(households.version, version));
  }

  const [row] = await db
    .update(households)
    .set({
      joinCode: code,
      joinCodeExpiresAt: expiresAt,
      updatedAt: new Date(),
      version: sql`${households.version} + 1`,
    })
    .where(and(...whereConditions))
    .returning();

  if (!row) {
    return staleOutcome();
  }

  const validated = HouseholdSelectBaseSchema.safeParse(row);

  if (!validated.success) throw new Error("Failed to regenerate join code");

  return appliedOutcome(validated.data);
}

/**
 * Checks if a user is the admin of a household
 */
export async function isUserHouseholdAdmin(householdId: string, userId: string): Promise<boolean> {
  const household = await getHouseholdById(householdId);

  return household?.adminUserId === userId;
}

/**
 * Kicks a user from a household (admin only)
 */
export async function kickUserFromHousehold(
  householdId: string,
  userIdToKick: string,
  adminUserId: string,
  version?: number
): Promise<MutationOutcome<void>> {
  // Verify admin
  const isAdmin = await isUserHouseholdAdmin(householdId, adminUserId);

  if (!isAdmin) {
    throw new Error("Only the household admin can kick members");
  }

  // Cannot kick yourself
  if (userIdToKick === adminUserId) {
    throw new Error("Admin cannot kick themselves. Transfer admin first or leave the household.");
  }

  return await removeUserFromHousehold(householdId, userIdToKick, version);
}

/**
 * Transfers admin privileges to another member
 */
export async function transferHouseholdAdmin(
  householdId: string,
  currentAdminId: string,
  newAdminId: string,
  version?: number
): Promise<MutationOutcome<HouseholdDto>> {
  // Verify current admin
  const isAdmin = await isUserHouseholdAdmin(householdId, currentAdminId);

  if (!isAdmin) {
    throw new Error("Only the current admin can transfer admin privileges");
  }

  // Verify new admin is a member
  const members = await getUsersByHouseholdId(householdId);
  const isMember = members.some((m) => m.userId === newAdminId);

  if (!isMember) {
    throw new Error("New admin must be a member of the household");
  }

  const whereConditions = [eq(households.id, householdId)];

  if (version) {
    whereConditions.push(eq(households.version, version));
  }

  const [row] = await db
    .update(households)
    .set({
      adminUserId: newAdminId,
      updatedAt: new Date(),
      version: sql`${households.version} + 1`,
    })
    .where(and(...whereConditions))
    .returning();

  if (!row) {
    return staleOutcome();
  }

  const validated = HouseholdSelectBaseSchema.safeParse(row);

  if (!validated.success) throw new Error("Failed to transfer admin");

  return appliedOutcome(validated.data);
}

/**
 * Renames a household (admin only, optimistic-version).
 *
 * Asserts the requester is the household admin (throws "FORBIDDEN" otherwise),
 * validates the name (non-empty, trimmed, max 100 chars to match the create
 * flow), and bumps the version like the other household mutations. Returns a
 * stale outcome when the supplied version no longer matches.
 */
export async function renameHousehold(
  householdId: string,
  requesterId: string,
  name: string,
  version?: number
): Promise<MutationOutcome<HouseholdDto>> {
  const household = await getHouseholdById(householdId);

  if (!household || household.adminUserId !== requesterId) {
    throw new Error("FORBIDDEN");
  }

  const trimmedName = name.trim();

  if (trimmedName.length === 0 || trimmedName.length > 100) {
    throw new Error("Invalid household name");
  }

  const whereConditions = [eq(households.id, householdId)];

  if (version) {
    whereConditions.push(eq(households.version, version));
  }

  const [row] = await db
    .update(households)
    .set({
      name: trimmedName,
      updatedAt: new Date(),
      version: sql`${households.version} + 1`,
    })
    .where(and(...whereConditions))
    .returning();

  if (!row) {
    return staleOutcome();
  }

  const validated = HouseholdSelectBaseSchema.safeParse(row);

  if (!validated.success) throw new Error("Failed to rename household");

  return appliedOutcome(validated.data);
}

/**
 * Read a cookbook's per-cookbook recipe permission policy + its admin, for the
 * per-recipe access gate (resolveRecipeCookbookPolicy in @norish/auth). Returns
 * null when the household no longer exists (caller falls back to the global
 * default). Columns-only fetch — never the membership rows.
 */
export async function getHouseholdPolicy(
  householdId: string
): Promise<{ policy: RecipePermissionPolicy; adminUserId: string } | null> {
  const row = await db.query.households.findFirst({
    where: eq(households.id, householdId),
    columns: {
      adminUserId: true,
      viewPolicy: true,
      editPolicy: true,
      deletePolicy: true,
    },
  });

  if (!row) return null;

  return {
    adminUserId: row.adminUserId,
    policy: {
      view: row.viewPolicy,
      edit: row.editPolicy,
      delete: row.deletePolicy,
    },
  };
}

/**
 * Set a cookbook's per-cookbook recipe permission policy (admin only,
 * optimistic-version). Asserts the requester is the household admin (throws
 * "FORBIDDEN" otherwise) and bumps the version like the other household
 * mutations. Returns a stale outcome when the supplied version no longer
 * matches.
 *
 * SECURITY (decision #5): the per-cookbook `view` policy may only be
 * `household` or `owner` — a per-cookbook `view = everyone` is disallowed in v1
 * (only the global default may be `everyone`). The router input schema
 * (SetHouseholdPolicyInputSchema) enforces this; this repo re-asserts it so the
 * boundary holds even if a future caller skips the schema.
 */
export async function setHouseholdPolicy(
  householdId: string,
  requesterId: string,
  policy: RecipePermissionPolicy,
  version?: number
): Promise<MutationOutcome<HouseholdDto>> {
  const household = await getHouseholdById(householdId);

  if (!household || household.adminUserId !== requesterId) {
    throw new Error("FORBIDDEN");
  }

  if (policy.view === "everyone") {
    // A per-cookbook public view is not allowed in v1 (keeps the list scoping
    // reading only the active cookbook; HOUSE-06 trivially intact).
    throw new Error("Invalid household policy");
  }

  const whereConditions = [eq(households.id, householdId)];

  if (version) {
    whereConditions.push(eq(households.version, version));
  }

  const [row] = await db
    .update(households)
    .set({
      viewPolicy: policy.view,
      editPolicy: policy.edit,
      deletePolicy: policy.delete,
      updatedAt: new Date(),
      version: sql`${households.version} + 1`,
    })
    .where(and(...whereConditions))
    .returning();

  if (!row) {
    return staleOutcome();
  }

  const validated = HouseholdSelectBaseSchema.safeParse(row);

  if (!validated.success) throw new Error("Failed to set household policy");

  return appliedOutcome(validated.data);
}

/**
 * Find a household by name (case-insensitive)
 */
export async function findHouseholdByName(name: string): Promise<HouseholdDto | null> {
  const normalizedName = name.toLowerCase().trim();

  const rows = await db
    .select()
    .from(households)
    .where(sql`LOWER(${households.name}) = ${normalizedName}`)
    .limit(1);

  const parsed = HouseholdSelectBaseSchema.safeParse(rows[0]);

  return parsed.success ? parsed.data : null;
}

/**
 * Find existing household by name or create a new one
 * Used for OIDC claim-based household assignment
 */
export async function findOrCreateHouseholdByName(
  name: string,
  creatorUserId: string
): Promise<HouseholdDto> {
  const normalizedName = name.trim();

  // Try to find existing (case-insensitive)
  const existing = await findHouseholdByName(normalizedName);

  if (existing) return existing;

  // Create new household with this user as admin
  const code = await generateUniqueJoinCode();
  const expiresAt = new Date(Date.now() + 10 * 60 * 1000);

  // New cookbooks inherit the server-wide policy as their default (decision #4).
  const defaultPolicy = await getDefaultCookbookPolicy();

  const [row] = await db
    .insert(households)
    .values({
      name: normalizedName,
      adminUserId: creatorUserId,
      joinCode: code,
      joinCodeExpiresAt: expiresAt,
      viewPolicy: defaultPolicy.view,
      editPolicy: defaultPolicy.edit,
      deletePolicy: defaultPolicy.delete,
    })
    .returning();

  const validated = HouseholdSelectBaseSchema.safeParse(row);

  if (!validated.success) throw new Error("Failed to create household");

  return validated.data;
}

async function generateUniqueInviteToken(): Promise<string> {
  while (true) {
    const token = crypto.randomBytes(32).toString("base64url");

    const existing = await db
      .select({ id: households.id })
      .from(households)
      .where(eq(households.inviteToken, token))
      .limit(1);

    if (existing.length === 0) return token;
  }
}

async function generateUniqueJoinCode(): Promise<string> {
  while (true) {
    const code = Math.floor(Math.random() * 1_000_000)
      .toString()
      .padStart(6, "0");

    const existing = await db
      .select({ id: households.id })
      .from(households)
      .where(eq(households.joinCode as any, code))
      .limit(1);

    if (existing.length === 0) return code;
  }
}
