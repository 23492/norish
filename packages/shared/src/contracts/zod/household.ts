import { createInsertSchema, createSelectSchema, createUpdateSchema } from "drizzle-zod";
import { z } from "zod";
import { PermissionLevelSchema } from "@norish/config/zod/server-config";
import { households, householdUsers } from "@norish/db/schema";

export const HouseholdSelectBaseSchema = createSelectSchema(households);
export const HouseholdInsertBaseSchema = createInsertSchema(households).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
  joinCode: true,
  joinCodeExpiresAt: true,
  inviteToken: true,
});
export const HouseholdUpdateBaseSchema = createUpdateSchema(households).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
  joinCode: true,
  joinCodeExpiresAt: true,
  inviteToken: true,
});

export const HouseholdUserSelectBaseSchema = createSelectSchema(householdUsers);
export const HouseholdUserInsertBaseSchema = createInsertSchema(householdUsers).omit({
  createdAt: true,
});

export const HouseholdUserSchema = z.object({
  id: z.string(),
  name: z.string().nullable().optional(),
  isAdmin: z.boolean().optional(),
  version: z.number(),
});

export const HouseholdEventUserSchema = z.object({
  id: z.string(),
  name: z.string().nullable(),
  isAdmin: z.boolean(),
  version: z.number().int().positive(),
});

// inviteToken + the per-cookbook policy columns are admin-only and NOT provided
// by the shared member resolver (mapHouseholdRowToDto); omit them here so the
// resolver DTO parses. The policy surfaces only on the admin settings DTO
// (HouseholdAdminSettingsSchema), fetched admin-gated by resolveHouseholdDto.
export const HouseholdWithUsersNamesSchema = HouseholdSelectBaseSchema.omit({
  inviteToken: true,
  viewPolicy: true,
  editPolicy: true,
  deletePolicy: true,
}).extend({
  users: z.array(HouseholdUserSchema).default([]),
});

// Lightweight household entry for the cookbook switcher (households.list)
export const HouseholdSummarySchema = z.object({
  id: z.string(),
  name: z.string(),
  isActive: z.boolean(),
  memberCount: z.number().int().nonnegative(),
});

// Schema for household settings view - omits sensitive fields and unused timestamp fields
// Users can determine admin from the isAdmin flag in the users array
// inviteToken + the per-cookbook policy columns are admin-only, so they are
// omitted from the member-facing settings DTO (the admin DTO carries policy).
export const HouseholdSettingsSchema = HouseholdSelectBaseSchema.omit({
  adminUserId: true,
  createdAt: true,
  updatedAt: true,
  joinCode: true,
  joinCodeExpiresAt: true,
  inviteToken: true,
  viewPolicy: true,
  editPolicy: true,
  deletePolicy: true,
}).extend({
  users: z.array(HouseholdUserSchema).default([]),
  allergies: z.array(z.string()).default([]),
});

// Schema for admin household settings view - includes joinCode/expiration +
// inviteToken + the per-cookbook recipe permission policy (viewPolicy /
// editPolicy / deletePolicy come through from HouseholdSelectBaseSchema; the
// admin Recipe-Permissions card reads + edits them).
export const HouseholdAdminSettingsSchema = HouseholdSelectBaseSchema.omit({
  adminUserId: true,
  createdAt: true,
  updatedAt: true,
}).extend({
  users: z.array(HouseholdUserSchema).default([]),
  allergies: z.array(z.string()).default([]),
});

export const LeaveHouseholdInputSchema = z.object({
  householdId: z.string().uuid(),
  version: z.number().int().positive(),
});

export const KickHouseholdUserInputSchema = z.object({
  householdId: z.string().uuid(),
  userId: z.string(),
  version: z.number().int().positive(),
});

export const RegenerateHouseholdJoinCodeInputSchema = z.object({
  householdId: z.string().uuid(),
  version: z.number().int().positive(),
});

export const RenameHouseholdInputSchema = z.object({
  householdId: z.string().uuid(),
  name: z.string().trim().min(1, "Name is required").max(100, "Name too long"),
  version: z.number().int().positive(),
});

// Invite-token shape: a long, crypto-random, url-safe string (base64url of 32
// bytes ~= 43 chars). Used both as the generate-mutation input guard and the
// public lookup guard so an attacker cannot probe with short/garbage tokens.
export const InviteTokenSchema = z
  .string()
  .trim()
  .min(32, "Invalid invite token")
  .max(128, "Invalid invite token")
  .regex(/^[A-Za-z0-9_-]+$/, "Invalid invite token");

export const GenerateHouseholdInviteTokenInputSchema = z.object({
  householdId: z.string().uuid(),
});

export const JoinHouseholdByInviteTokenInputSchema = z.object({
  token: InviteTokenSchema,
});

export const GetHouseholdByInviteTokenInputSchema = z.object({
  token: InviteTokenSchema,
});

// PUBLIC (unauthenticated) lookup payload: ONLY the cookbook name is exposed for
// a valid token — never members, recipes, ids, or any other household.
export const HouseholdInviteInfoSchema = z.object({
  name: z.string(),
});

// Per-cookbook recipe permission policy input (admin-only mutation, optimistic
// version). DECISION #5: the per-cookbook `view` policy may only be `household`
// or `owner` — a per-cookbook `view = everyone` is DISALLOWED in v1 (only the
// global default may be `everyone`). This keeps the list scoping reading only
// the active cookbook (no cross-cookbook widening) and HOUSE-06 trivially intact.
export const HouseholdViewPolicySchema = z.enum(["household", "owner"]);

export const SetHouseholdPolicyInputSchema = z.object({
  householdId: z.string().uuid(),
  view: HouseholdViewPolicySchema,
  edit: PermissionLevelSchema,
  delete: PermissionLevelSchema,
  version: z.number().int().positive(),
});

export const TransferHouseholdAdminInputSchema = z.object({
  householdId: z.string().uuid(),
  newAdminId: z.string(),
  version: z.number().int().positive(),
});

export const HouseholdUserJoinedEventSchema = z.object({
  user: HouseholdEventUserSchema,
});

export const HouseholdUserLeftEventSchema = z.object({
  userId: z.string(),
});

export const HouseholdUserKickedEventSchema = z.object({
  householdId: z.string(),
  kickedBy: z.string(),
});

export const HouseholdMemberRemovedEventSchema = z.object({
  userId: z.string(),
});

export const HouseholdAdminTransferredEventSchema = z.object({
  oldAdminId: z.string(),
  newAdminId: z.string(),
  version: z.number().int().positive(),
});

export const HouseholdJoinCodeRegeneratedEventSchema = z.object({
  joinCode: z.string(),
  joinCodeExpiresAt: z.string(),
  version: z.number().int().positive(),
});

export const HouseholdAllergiesUpdatedEventSchema = z.object({
  allergies: z.array(z.string()),
});

export const HouseholdFailedEventSchema = z.object({
  reason: z.string(),
});
