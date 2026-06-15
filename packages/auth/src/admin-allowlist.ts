import { SERVER_CONFIG } from "@norish/config/env-config-server";
import {
  getUserById,
  getUserServerRole,
  setUserAdminStatus,
  setUserServerRole,
} from "@norish/db/repositories/users";
import { authLogger } from "@norish/shared-server/logger";

/**
 * Env-driven SERVER-admin (operator) allowlist — R2 / phase 15.
 *
 * `ADMIN_EMAILS` (comma-separated, in .env) is the SINGLE source of truth for who
 * is a SERVER admin/operator: the person who can reach `/settings/admin` (AI config,
 * video/transcription, auth providers). Env-authoritative, mirroring R1's
 * `syncAIConfigFromEnv`: evaluated at user-create AND re-evaluated on EVERY login,
 * so it survives a clean DB and existing users get the correct status on next login.
 *
 * This is the SERVER-level flag (`users.isServerOwner` / `users.isServerAdmin`,
 * gated by `withServerAdmin` / `isUserServerAdmin`). It is NOT the per-cookbook /
 * household admin (`households.adminUserId`, POLICY-01 / `canAccessResource`) — that
 * is untouched; regular users still own + admin their OWN cookbooks.
 *
 * Pure functions live here (mirroring how `claim-processor.ts` is a separate,
 * unit-testable module from the un-mockable `betterAuth({...})` block); the side-
 * effecting `applyServerAdminOnLogin` reads the user's PLAINTEXT email (decrypted
 * via `getUserById`, since `users.email` is encrypted at rest) and writes the flag.
 */

/**
 * Build the lowercased/trimmed admin-email Set from `SERVER_CONFIG.ADMIN_EMAILS`.
 *
 * The env transform already normalizes to a lowercased/trimmed/de-empty string[],
 * but we re-normalize defensively so callers passing a raw value still behave.
 */
export function getAdminEmailSet(): Set<string> {
  const raw = SERVER_CONFIG.ADMIN_EMAILS ?? [];

  return new Set(raw.map((e) => e.trim().toLowerCase()).filter(Boolean));
}

/**
 * Case-insensitive + whitespace-trim membership test.
 * Empty/missing email is never an admin.
 */
export function isAdminEmail(
  email: string | null | undefined,
  adminSet: Set<string>
): boolean {
  if (!email) return false;

  return adminSet.has(email.trim().toLowerCase());
}

/** Whether an allowlist is configured at all (non-empty). */
export function isAllowlistConfigured(adminSet: Set<string>): boolean {
  return adminSet.size > 0;
}

export interface ServerAdminFlags {
  isServerOwner: boolean;
  isServerAdmin: boolean;
}

/**
 * The create-time server-admin decision.
 *
 * - allowlist CONFIGURED  => env wins: { owner:false, admin: email ∈ list }.
 *   The first signup is NOT owner/admin unless listed. We never grant isServerOwner
 *   via env (so a multi-email list can't violate the single-owner unique index); the
 *   server-admin gates are `owner || admin`, so admin alone fully enables /settings/admin.
 * - allowlist EMPTY/UNSET => fallback to the legacy first-user-owner behavior
 *   { owner:isFirstUser, admin:isFirstUser } so existing self-host installs never lock out.
 */
export function resolveServerAdminOnCreate(params: {
  email: string | null | undefined;
  isFirstUser: boolean;
  adminSet: Set<string>;
}): ServerAdminFlags {
  const { email, isFirstUser, adminSet } = params;

  if (isAllowlistConfigured(adminSet)) {
    return { isServerOwner: false, isServerAdmin: isAdminEmail(email, adminSet) };
  }

  // No allowlist configured: preserve legacy first-user-owner (self-host fallback).
  return { isServerOwner: isFirstUser, isServerAdmin: isFirstUser };
}

/**
 * Re-evaluate a user's SERVER-admin status against `ADMIN_EMAILS` on login.
 *
 * Provider-agnostic (fires for WorkOS / OIDC / Google / password via the
 * `session.create.before` better-auth hook). NO-OP when the allowlist is empty/unset
 * (don't churn self-host owners — the legacy first-user-owner stays authoritative).
 *
 * When configured:
 *  - email ∈ list & not already admin  => promote (setUserAdminStatus true).
 *  - email ∉ list & currently owner/admin => DEMOTE (setUserServerRole false,false) —
 *    a previously auto-owner who isn't the operator loses server-admin reach.
 *  - otherwise no write (avoid needless version bumps).
 *
 * Never throws: a login must not hard-fail on this (try/catch + log), mirroring the
 * claim-processor after-hook error handling.
 */
export async function applyServerAdminOnLogin(userId: string): Promise<void> {
  const adminSet = getAdminEmailSet();

  // No allowlist => env is not the source of truth; preserve existing flags.
  if (!isAllowlistConfigured(adminSet)) {
    return;
  }

  try {
    const user = await getUserById(userId);

    if (!user) {
      authLogger.warn({ userId }, "applyServerAdminOnLogin: user not found, skipping");

      return;
    }

    const shouldBeAdmin = isAdminEmail(user.email, adminSet);
    const role = await getUserServerRole(userId);
    const isCurrentlyServerAdmin = role.isOwner || role.isAdmin;

    if (shouldBeAdmin) {
      // Promote to admin if not already (leave isServerOwner as-is: the existing
      // single owner keeps it; we never grant owner via env).
      if (!role.isAdmin) {
        await setUserAdminStatus(userId, true);
        authLogger.info({ userId }, "Server-admin granted via ADMIN_EMAILS allowlist");
      }

      return;
    }

    // Not in the list: demote any server-admin reach (clears BOTH flags).
    if (isCurrentlyServerAdmin) {
      await setUserServerRole(userId, false, false);
      authLogger.info(
        { userId },
        "Server-admin revoked: email not in ADMIN_EMAILS allowlist (demoted)"
      );
    }
  } catch (error) {
    // Never block login on a re-eval failure.
    authLogger.error({ error, userId }, "applyServerAdminOnLogin failed");
  }
}
