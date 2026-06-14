---
phase: 11-workos-oidc-fix
plan: 11-01
subsystem: auth
status: code-complete
requirements: [WORKOS-OIDC-FIX-01]
commits: [66893d4f, 47205a94, bd2a1787]
---

# Phase 11 Plan 11-01 SUMMARY: Fix BROKEN WorkOS login — standard OIDC via AuthKit discovery

## Outcome: CODE-COMPLETE (human-verify pending: lead docker:build + set WORKOS_AUTHKIT_DOMAIN in the live compose + redeploy + live WorkOS round-trip)

The production 400 `INVALID_OAUTH_CONFIGURATION` on `POST /api/auth/sign-in/oauth2 {providerId:workos}` is fixed by reconfiguring the `workos` genericOAuth provider from the phase-08 non-standard api.workos.com flow to a STANDARD OIDC provider driven by AuthKit's OIDC discovery document.

## Why INVALID_OAUTH_CONFIGURATION (root cause, confirmed in installed better-auth@1.6.9)

The `/sign-in/oauth2` endpoint handler (`node_modules/better-auth/dist/plugins/generic-oauth/routes.mjs`, `signInWithOAuth2`) destructures `{ discoveryUrl, authorizationUrl, tokenUrl, ... }` from the matched provider config and resolves:
```js
let finalAuthUrl = authorizationUrl;
let finalTokenUrl = tokenUrl;
if (discoveryUrl) { /* betterFetch; finalAuthUrl = data.authorization_endpoint; finalTokenUrl = data.token_endpoint */ }
if (!finalAuthUrl || !finalTokenUrl) throw APIError.from("BAD_REQUEST", GENERIC_OAUTH_ERROR_CODES.INVALID_OAUTH_CONFIGURATION);
```
The sign-in endpoint requires BOTH an auth URL AND a token URL UP FRONT and does NOT consult `getToken` here. (`getToken` IS supported by genericOAuth, but only in the CALLBACK's `validateAuthorizationCode` — `if (c.getToken) return c.getToken(data)` in the plugin's `init`. It is never reached at sign-in.) The phase-08 WorkOS config had `authorizationUrl: https://api.workos.com/user_management/authorize` (so `finalAuthUrl` was set) but NO `tokenUrl` and NO `discoveryUrl`, so `finalTokenUrl` stayed `undefined` → the 400 fired at sign-in, before the custom `getToken` could ever run. The hypothesis in the task brief was right that a valid config needs `discoveryUrl` OR `authorizationUrl`+`tokenUrl`; the precise trigger is the missing token URL at the sign-in stage.

## Fix path taken: OIDC-discovery (PREFERRED)

WorkOS AuthKit exposes a valid OIDC discovery doc at `https://<authkit-domain>/.well-known/openid-configuration`. Verified reachable from LXC 110 (HTTP 200) for `manageable-invention-37-staging.authkit.app`:
- issuer `https://manageable-invention-37-staging.authkit.app`
- authorization_endpoint `.../oauth2/authorize`, token_endpoint `.../oauth2/token`, userinfo_endpoint `.../oauth2/userinfo`, jwks_uri `.../oauth2/jwks`
- `token_endpoint_auth_methods_supported: ["none", "client_secret_basic", "client_secret_post"]`

`buildWorkOSProviders()` (`packages/auth/src/auth.ts`) now returns, when `clientId && apiKey && authkitDomain`:
```
{
  providerId: "workos",
  discoveryUrl: `https://${normalizedDomain}/.well-known/openid-configuration`,
  clientId,
  clientSecret: apiKey,          // WorkOS API Key = OAuth client_secret (client_secret_post)
  scopes: ["openid", "email", "profile"],
  pkce: true,
}
```
(`normalizedDomain` strips a stray `https://` prefix and trailing slash so the `.well-known` path is always correct.) The custom `getToken`/`getUserInfo`/`authorizationUrl`/`authorizationUrlParams`/`responseType`/`scopes:[]`/`pkce:false` are all DROPPED. better-auth now resolves BOTH `finalAuthUrl` + `finalTokenUrl` from discovery → no more INVALID_OAUTH_CONFIGURATION. The token exchange goes through better-auth's default `validateAuthorizationCode`, which sends `client_id` + `client_secret` in the body (client_secret_post — advertised by the discovery doc) plus `code_verifier` for PKCE. The default OIDC `getUserInfo` maps claims natively (`sub`→`id`, `email`, `name`, `picture`→`image`, `email_verified`→`emailVerified` — verified in `routes.mjs::getUserInfo`), so no custom mapping is needed.

providerId stays `workos`, so the callback stays `/api/auth/oauth2/callback/workos` (already registered in WorkOS) — confirmed unchanged.

## Is WORKOS_API_KEY the correct OIDC client_secret for AuthKit? YES.

Confirmed via the WorkOS API reference (context7 `/websites/workos_reference`, source https://workos.com/docs/reference/authkit/authentication): the AuthKit authorization_code exchange cURL is
```json
{ "client_id": "client_123456789", "client_secret": "sk_example_123456789", "grant_type": "authorization_code", "code": "..." }
```
i.e. the `sk_...` API Key IS the `client_secret`. The AuthKit `/oauth2/token` discovery endpoint "is authenticated by providing the WorkOS Application's client ID and client secret in the body" and advertises `client_secret_post` (used by better-auth's default). The discovery doc also advertises `none` (public client + PKCE) — so PKCE-only would also work — but sending the API key as client_secret via client_secret_post is the documented and simplest path, and PKCE is layered on top (additive). No SEPARATE OAuth secret is needed for first-party AuthKit login. (Note: WorkOS Connect / third-party OAuth Applications DO issue a separate client_id/client_secret credential, but that is a different surface — not used here.)

## Env var(s) to set on live

- **NEW: `WORKOS_AUTHKIT_DOMAIN=manageable-invention-37-staging.authkit.app`** — per-environment, NON-SECRET. Provides the OIDC discovery URL.
- **`WORKOS_CLIENT_ID`** — UNCHANGED (the WorkOS Client ID, `client_.../project_...`).
- **`WORKOS_API_KEY`** — UNCHANGED (the `sk_...` API Key; now sent as the OIDC client_secret).

The provider activates only when ALL THREE are set (`hasEnvConfig = WORKOS_CLIENT_ID && WORKOS_API_KEY && WORKOS_AUTHKIT_DOMAIN`). The phase-09 env→DB→cache seed mechanism is preserved: `syncWorkOSProvider()` seeds/updates/deletes the `auth_provider_workos` row from env at boot, now including `authkitDomain`. The admin-card removal (phase 09) and SSO auto-redirect (phase 10) are untouched.

## Files + commits

- `66893d4f` fix(11-workos-oidc): `packages/auth/src/auth.ts` (buildWorkOSProviders → OIDC discovery), `packages/config/src/env-config-server.ts` (WORKOS_AUTHKIT_DOMAIN), `packages/config/src/zod/server-config.ts` + `packages/shared/src/contracts/zod/server-config.ts` (authkitDomain on AuthProviderWorkOSSchema — both parallel copies), `packages/api/src/startup/seed-config.ts` (syncWorkOSProvider gate + envConfig + hasOAuthEnvConfigured).
- `47205a94` docs(11-workos-oidc): `.env.example` + `docker/docker-compose.example.yml` (WORKOS_AUTHKIT_DOMAIN + OIDC-discovery note).
- `bd2a1787` test(11-workos-oidc): `packages/auth/__tests__/auth/workos-provider.test.ts` (rewritten for the OIDC shape + sign-in-validity predicate + domain normalization), `packages/api/__tests__/startup/auth-provider-sync.test.ts` (authkitDomain fixtures + domain-missing case).

## Verification (static + unit; LEAD owns docker:build + live WorkOS round-trip)

- Discovery doc reachable from LXC 110: **HTTP 200**, token/authorization/userinfo endpoints present, `client_secret_post` advertised.
- typecheck **EXIT 0**: config, shared, auth, trpc, api, web (web is a real `tsc --noEmit`).
- Tests: `@norish/auth` **113/113** (workos-provider **6/6** incl. the no-INVALID_OAUTH_CONFIGURATION sign-in-validity assertion + domain normalization); `@norish/api` **349/349** (auth-provider-sync **23/23** incl. the new domain-missing case — was 348/22 in phase 09); `@norish/trpc` **255/255**.
- Do NOT run `pnpm docker:build` (lead). Did NOT merge/deploy/touch live or `/opt/norish/`. No real key hardcoded.

## Config-validity test (Step 3)

`workos-provider.test.ts` builds the provider via `genericOAuth({ config: buildWorkOSProviders() })` and then replicates better-auth's exact sign-in predicate — resolving `finalAuthUrl`/`finalTokenUrl` from the (mocked) discovery doc and asserting `!finalAuthUrl || !finalTokenUrl === false`. This directly proves the regression (missing token URL) is fixed: with discovery both URLs resolve, so the config is accepted at `/sign-in/oauth2`. (A full DB-backed `auth.api.signInWithOAuth2` round-trip needs the encrypted-email drizzle adapter + redis secondary storage + cookie/state plumbing — out of scope for a unit test; the predicate test isolates the exact validation the fix targets, and the live round-trip is the lead's human-verify step.)

## Notes / assumptions

- Two parallel `AuthProviderWorkOSSchema` definitions exist (`@norish/config/.../server-config.ts` consumed by the tRPC router + connection-tests; `@norish/shared/contracts/.../server-config.ts` consumed by the admin context + shared-react). Both were updated in lockstep with the required `authkitDomain`. The admin `updateWorkOS` tRPC mutation + `testWorkOSProvider` + context wiring are dead UI-wise (card removed phase 09) but still type-checked; the now-required `authkitDomain` on the input schema is harmless there (no caller) and keeps the two type copies consistent.
- `code_challenge_methods_supported` is absent from the AuthKit discovery doc, but PKCE is documented as supported and `client_secret_post` (the better-auth default, no PKCE dependency) is advertised — so the config is valid regardless of how AuthKit advertises PKCE methods.
- Auth-provider config is RESTART_REQUIRED (phase-08 baseline): changing WORKOS_* env requires a container restart for `seedServerConfig` to re-seed and `auth.ts` to rebuild.

## HUMAN-VERIFY (pending)

- **LEAD**: `pnpm docker:build`; set `WORKOS_AUTHKIT_DOMAIN=manageable-invention-37-staging.authkit.app` in the live compose (WORKOS_CLIENT_ID/WORKOS_API_KEY already present and unchanged); redeploy; confirm `POST /api/auth/sign-in/oauth2 {providerId:workos}` now returns a 200 with a redirect `url` to `<domain>/oauth2/authorize` (NOT 400), complete the AuthKit login, and confirm the callback `/api/auth/oauth2/callback/workos` creates/links the user.
