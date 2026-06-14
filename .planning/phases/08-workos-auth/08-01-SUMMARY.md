---
phase: 08-workos-auth
plan: 08-01
subsystem: auth
status: code-complete
requirements: [WORKOS-01]
commits: [fa044e42, 04ee4435, 9f916ff4, c43e44c2, f05f3baf, 2283fee2]
---

# Phase 08 Plan 08-01 SUMMARY: WorkOS AuthKit as an additional better-auth login provider

## Outcome: CODE-COMPLETE (human-verify pending: lead docker:build + recreate norishp2; Kiran WorkOS dashboard + keys)

WorkOS AuthKit is now an ADDITIONAL login provider that better-auth consumes via its `genericOAuth` plugin, reading the WorkOS Client ID + API Key from server-config at runtime (admin-configurable, NOT env, NOT hardcoded). better-auth remains the session/user/household core. Fully additive + reversible — email/password, Google, GitHub, and the generic-OIDC slot are untouched.

## Chosen approach + why (doc-verified, not guessed)

- **Mechanism: better-auth `genericOAuth` (NOT the `sso` plugin, NOT the existing OIDC slot).** norish's existing OIDC provider is already a `genericOAuth` provider (`plugins: [ genericOAuth({ config: buildOIDCProviders() }) ]`); the client already loads `genericOAuthClient()`; and the login button dispatch sends github/google → `signIn.social` and EVERYTHING ELSE → `signIn.oauth2({ providerId })`. So WorkOS slots in as a second `genericOAuth` provider with ZERO button-dispatch change.
- **Why NOT reuse the OIDC discovery slot:** WorkOS AuthKit / User Management is a non-standard OAuth2 API at `api.workos.com`, not a standard OIDC IdP with a usable discovery doc for this flow (verified: workos.com/docs). Its token endpoint returns the user profile DIRECTLY; there is NO standard `/userinfo`. So an explicit-URL genericOAuth provider with a custom `getToken` + `getUserInfo` is the documented path (better-auth docs: "Implement Custom Token Exchange and User Info Fetching for Generic OAuth").
- **The WorkOS flow (verified against workos.com/docs):**
  - Authorize: `GET https://api.workos.com/user_management/authorize` — required `client_id`, `redirect_uri`, `response_type=code`; we add `provider=authkit` (via `authorizationUrlParams`) to use the hosted AuthKit UI.
  - Token exchange: `POST https://api.workos.com/user_management/authenticate` with `client_id`, `client_secret` (= the WorkOS API Key), `grant_type=authorization_code`, `code`. Response returns `{ user, access_token, refresh_token, organization_id, ... }` — the `user` object directly (`id, first_name, last_name, email, email_verified, profile_picture_url`).
  - Implementation: `getToken` does the POST, returns `{ accessToken, refreshToken, raw: <full response> }`; `getUserInfo(tokens)` reads `tokens.raw.user` (no separate network call) and maps → `{ id, email, emailVerified, name, image }`.
- **Credentials:** WorkOS provides a **Client ID** (`client_...` / `project_...`) and an **API Key** (`sk_...`). The API Key maps to the OAuth `clientSecret`. Admin enters Client ID → `clientId`, API Key → `apiKey`.

## EXACT redirect/callback URI Kiran registers in the WorkOS dashboard (Redirects tab)

better-auth genericOAuth mounts the callback at `${baseURL}/api/auth/oauth2/callback/:providerId`. baseURL = `SERVER_CONFIG.AUTH_URL`. providerId = `workos`. So:

- **Production:** `https://norish.knoppsmart.com/api/auth/oauth2/callback/workos`
- **Verify stack equivalent:** `http://192.168.2.47:3010/api/auth/oauth2/callback/workos`

WorkOS redirect-URI rules (verified workos.com): **Production environments enforce HTTPS** on a controlled domain (only `http://127.0.0.1` is allowed, for native clients). **Sandbox allows `http://localhost`.** A private-LAN IP like `192.168.2.47` is NOT loopback, so WorkOS will likely REJECT the `http://192.168.2.47:3010` callback even in Sandbox. Practical testing options: (a) point AUTH_URL at the HTTPS prod domain `norish.knoppsmart.com` and register that, or (b) SSH-tunnel the verify stack to `http://localhost:3010` and register `http://localhost:3010/api/auth/oauth2/callback/workos` in a WorkOS **Sandbox** environment. Multiple redirect URIs can be registered, so prod + a localhost test URI can coexist.

## Admin fields added + which WorkOS key goes where

A new "WorkOS" accordion in Settings → Admin → Authentication Providers (reuses the GENERIC `AuthProviderForm`, same as Google/GitHub — NOT a custom form), with two fields:
- **Client ID** (plain text, placeholder `client_...`) → stored as `clientId`.
- **API Key** (masked SecretInput) → stored as `apiKey` (= the OAuth client_secret sent to the WorkOS authenticate endpoint).

Stored in `server_config` under the new key `auth_provider_workos`, encrypted at rest (`apiKey` is already in the repo's SENSITIVE_FIELDS → auto-encrypt + mask). Marked RESTART_REQUIRED (same as the other OAuth providers — the admin UI shows the "Requires restart" chip). The "Continue with WorkOS" button appears on the login page ONLY when `workos.clientId` is set (mirrors `google: !!google?.clientId`).

## Files changed + commit hashes

- **fa044e42** docs — the PLAN.
- **04ee4435** feat — core wiring:
  - `packages/config/src/zod/server-config.ts` + `packages/shared/src/contracts/zod/server-config.ts` (the two BYTE-IDENTICAL twins, identical edit): `AUTH_PROVIDER_WORKOS` key + `AuthProviderWorkOSSchema`/`Input` + types + `getSchemaForConfigKey` case + `SENSITIVE_CONFIG_KEYS` + `RESTART_REQUIRED_KEYS`.
  - `packages/auth/src/provider-cache.ts`: cache the workos provider + `getCachedWorkOSProvider`.
  - `packages/auth/src/auth.ts`: exported `buildWorkOSProviders()` (genericOAuth provider — providerId `workos`, authorizationUrl + `authorizationUrlParams:{provider:"authkit"}`, custom `getToken`→authenticate POST, `getUserInfo`→WorkOS user map); concat into the genericOAuth plugin config; `"workos"` added to `accountLinking.trustedProviders`.
  - `packages/api/src/startup/seed-config.ts`: load the workos provider into the startup cache (`loadAuthProvidersIntoCache`) + log it.
- **9f916ff4** feat — surface + admin router:
  - `packages/auth/src/providers.ts`: `getAvailableProviders` surfaces the WorkOS oauth button (`logos:workos-icon`) when configured; `getConfiguredProviders` reports `workos`.
  - `packages/auth/src/connection-tests.ts`: `testWorkOSProvider` (light Client-ID shape check, no network).
  - `packages/trpc/src/routers/admin/auth-providers.ts`: `updateWorkOS` mutation + `workos` in `deleteProvider`/`testProvider`.
- **c43e44c2** feat — admin UI + i18n:
  - `packages/shared-react/src/hooks/admin/use-admin-mutations.ts`: `updateAuthProviderWorkOS` + `workos` in the delete/test unions.
  - `apps/web/.../settings/admin/context.tsx`: `authProviderWorkOS` data + `updateAuthProviderWorkOS` action.
  - `apps/web/.../auth-providers/types.ts` + `auth-provider-form.tsx` + `auth-providers-card.tsx`: `workos` ProviderKey, CONFIG_KEYS, handleSave route, and the WorkOS accordion (Client ID + API Key).
  - `packages/i18n/src/messages/*/settings.json` (all 11 locales): `admin.authProviders.workos` (en+nl real, 9 EN-fallback). The login button reuses the existing parameterized `auth.provider.signInWith` — no new login i18n key.
- **f05f3baf** test — `packages/auth/__tests__/auth/workos-provider.test.ts` (hermetic, no real WorkOS network).
- **2283fee2** style — blank line before `authLogger.error` (lint).

## What the LEAD does next

1. `pnpm docker:build` (lead-owned; NOT run here) to bake the new source into `norish:local`.
2. Recreate the `norishp2` verify stack from the new image (no migration needed — `server_config` is a generic KV table, so NO schema/migration change in this phase).
3. Chrome-verify: with WorkOS configured (after Kiran's step) the login page shows a "Continue with WorkOS" button; the admin Authentication Providers card shows the WorkOS accordion with Client ID + API Key fields + the restart chip.

## What KIRAN does

1. In the WorkOS dashboard: activate User Management / AuthKit, register the redirect URI (prod `https://norish.knoppsmart.com/api/auth/oauth2/callback/workos`; for testing, a Sandbox `http://localhost:...` URI via tunnel since the LAN IP is not loopback), copy the **Client ID** and **API Key**.
2. In norish Settings → Admin → Authentication Providers → WorkOS: paste the Client ID + API Key, Save, then restart the server (RESTART_REQUIRED) so `loadAuthProvidersIntoCache` picks it up and better-auth builds the provider.

## signup→cookbook hook + account-linking for WorkOS users (confirmed)

- **Own-cookbook hook fires for WorkOS users:** `databaseHooks.user.create.after` in auth.ts is provider-AGNOSTIC — it keys on user creation + `getHouseholdsForUser(user.id).length === 0` (idempotent), with NO provider check. A WorkOS-provisioned new user gets their own "<name>'s Cookbook" created + set active, exactly like email/password and OIDC signups. (The OIDC claim-processor is the only provider-specific hook — it runs `if (account.providerId === "oidc")`, so WorkOS correctly does NOT trigger OIDC claim processing.)
- **Account-linking:** `"workos"` is in `accountLinking.trustedProviders` (`["oidc","google","github","workos"]`), so a user who already exists with the same (verified) email auto-links the WorkOS account instead of erroring.

## Verification (static + unit — LEAD owns docker:build + Chrome e2e + WorkOS dashboard)

- Typecheck EXIT 0: @norish/config, @norish/shared, @norish/db, @norish/web (all STRICT real `tsc --noEmit`), @norish/auth, @norish/trpc, @norish/shared-react, @norish/api.
- Strict real `tsc --noEmit` on @norish/auth: ZERO errors in any WorkOS-touched code; the only remaining error is the PRE-EXISTING `as AuthInstance` cast at auth.ts (baseline, predates this phase) — confirmed it also validates that better-auth's GenericOAuthConfig type accepts `authorizationUrlParams`/`getToken`/`pkce`/`responseType`.
- `pnpm i18n:check` EXIT 0 (all 11 locales have the workos keys; prettier reports the locale files unchanged).
- lint: @norish/auth 0 problems; @norish/trpc EXIT 0; the touched web files 0 errors.
- Tests (all green, no regressions): @norish/auth **106/106** (99 baseline + 7 new WorkOS), @norish/trpc 255/255, @norish/shared-react 27/27, @norish/web 379/379, @norish/config 726/726, @norish/shared 222/222.
- The two server-config zod twins remain BYTE-IDENTICAL after the edit (verified by diff).
- Pre-existing failures OUT OF SCOPE and NOT in any touched package: `archive-import-overwrite` (shared-server), `updateRecipeWithRefs` (db).

## Mechanics / notes

- All edits via `/root/.gsd/redit.py` (JSON-via-stdin, exact-match occurrence assertion). The edited src files (`auth.ts`, `provider-cache.ts`, `providers.ts`, `connection-tests.ts`, the shared-react mutations hook) are inode-shared hardlinks into `node_modules/@norish/<pkg>/src`, so edits are live in the injected copies. The NEW test file is under `__tests__/` (the test runner resolves it directly — no hardlink needed); no NEW src files were created, so no manual hardlink copying.
- No new dependency, no schema/migration, no env var, no live-container/boot-patch touch, no docker:build.

## Assumptions / gaps

- **`pkce: false`** for WorkOS (the authenticate endpoint uses `client_secret`; PKCE is optional in WorkOS and not needed for the confidential server-side flow). If a future PKCE-only WorkOS setup is wanted, `pkce: true` + `code_verifier` in `getToken` would be the change.
- **`getUserInfo` reads `tokens.raw.user`** — relies on better-auth's genericOAuth passing the `getToken` return's `raw` through to `getUserInfo` (documented + asserted in the unit test against a mocked flow, but the real end-to-end round-trip is the lead/Kiran Chrome verify).
- **WorkOS Client ID validation is intentionally light** (presence + `client_`/`project_` prefix) since the real credentials can't be validated without exposing the API key; the genuine check is the live login.
- **Login button icon** `logos:workos-icon` (Iconify `logos` set; `simple-icons:workos` does not exist). `ProviderIcon` has an initials fallback if the icon fails to load.
- **Multi-org WorkOS**: this wires single-tenant AuthKit login. WorkOS `organization_id` is returned in the token response and preserved in `raw` but not yet mapped to a norish household (the OIDC claim-processor's org→household path is separate and WorkOS-independent). Org→cookbook mapping for WorkOS would be a follow-up if Kiran wants enterprise SSO org provisioning.
