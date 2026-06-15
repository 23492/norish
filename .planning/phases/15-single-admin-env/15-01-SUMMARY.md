# Phase 15 — Single Admin via env (R2) — SUMMARY

**Goal:** replace norish's "first user = server-owner" with an env-driven `ADMIN_EMAILS` allowlist. Commercial SaaS: one operator (Kiran) is the only server-admin; everyone else — incl. the first to sign up — is a regular user who still owns/admins their OWN cookbooks.

## What shipped (5 commits, `feat/15-single-admin-env`)
- **`ADMIN_EMAILS` env** (comma-separated → normalized lowercased/trimmed string[]) in `packages/config/src/env-config-server.ts`.
- **`packages/auth/src/admin-allowlist.ts`** — pure, unit-testable module: `getAdminEmailSet`, `isAdminEmail` (case-insensitive/trim), `resolveServerAdminOnCreate` (allowlist configured ⇒ env wins, first user NOT admin unless listed; empty ⇒ legacy first-user-owner fallback), `applyServerAdminOnLogin` (per-login re-eval: promote if listed, **demote** if a former owner/admin is no longer listed; never throws).
- **`packages/auth/src/auth.ts`** — wiring at user-create + the `session.create.before` hook (provider-agnostic: WorkOS/OIDC/Google/password).
- **`packages/db/src/repositories/users.ts`** — `setUserServerRole` / `setUserAdminStatus`.
- This is the **SERVER-admin** flag only (`/settings/admin` gate). NOT household/cookbook ownership (POLICY-01 untouched).

## Verification
- typecheck config/db/auth/api EXIT 0.
- auth suite **129/129** (admin-allowlist 14).
- **Adversarial (admin access = security-critical):** weakened `isAdminEmail` → always-true → **5 tests RED** (incl. "email NOT in list ⇒ NOT admin", "FIRST user NOT in list ⇒ NOT auto-admin", demote, no-write) → reverted (clean tree, no residual diff).
- No new migration (uses existing `isServerOwner`/`isServerAdmin` columns).

## ⚠️ Lead follow-up before LIVE
- Deploy needs `ADMIN_EMAILS=mailkiranknoppert@gmail.com` in `/opt/norish/.env`, AND that value **must equal the email Kiran's WorkOS login arrives with**, or he loses server-admin (demoted on next login). Verify against his live user before deploying.
- Not merged/deployed. Build confirms compilation only.
