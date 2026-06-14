---
phase: 12-workos-authkit-flow
plan: 12-01
subsystem: auth
status: code-complete
requirements: [WORKOS-AUTHKIT-FLOW-01]
supersedes: [WORKOS-OIDC-FIX-01]
commits: []
---

# Phase 12 Plan 12-01 SUMMARY: Fix BROKEN WorkOS login — first-party AuthKit flow (Option A), reverting the phase-11 OIDC-discovery surface

## Outcome: CODE-COMPLETE (human-verify pending: lead docker:build + REMOVE WORKOS_AUTHKIT_DOMAIN from the live compose + redeploy + live WorkOS round-trip)

The production "Authorization Error — The application you are trying to authorize was not found" (phase-11 result) is fixed by reconfiguring the `workos` genericOAuth provider from the WRONG `*.authkit.app` OIDC-discovery surface (WorkOS Connect / OAuth Applications) back to the FIRST-PARTY AuthKit flow against `api.workos.com/user_management` (Environment Client ID + `provider=authkit`), now WITH a `tokenUrl` placeholder so better-auth's `/sign-in/oauth2` no longer 400s with INVALID_OAUTH_CONFIGURATION (the phase-08 bug that drove the phase-11 detour). This is Option A from the task brief, taken because Step-1 source verification confirmed `getToken` takes precedence over `tokenUrl` in the callback.

## Step-1 source findings (installed better-auth@1.6.9, node_modules/better-auth/dist/plugins/generic-oauth/routes.mjs)

(a) SIGN-IN validity (`signInWithOAuth2`, lines 62-78) — providing BOTH authorizationUrl AND tokenUrl satisfies validation; tokenUrl is NEVER fetched at sign-in:
```js
const { discoveryUrl, authorizationUrl, tokenUrl, ... } = config;   // line 62
let finalAuthUrl = authorizationUrl;                                 // line 63
let finalTokenUrl = tokenUrl;                                        // line 64
if (discoveryUrl) { /* fetch overrides both */ }                    // lines 65-77
if (!finalAuthUrl || !finalTokenUrl) throw APIError$1.from("BAD_REQUEST", GENERIC_OAUTH_ERROR_CODES.INVALID_OAUTH_CONFIGURATION); // line 78
```
=> (a) = YES.

(b) CALLBACK precedence (`oAuth2Callback`, lines 178-208) — when getToken is set, the standard token POST to tokenUrl is in the `else` branch and is SKIPPED; getUserInfo receives the getToken result:
```js
if (providerConfig.getToken) tokens = await providerConfig.getToken({ code, redirectURI: ..., codeVerifier: ... });   // line 179
else {                                                                                                                // line 184
  if (!finalTokenUrl) throw APIError$1.from("BAD_REQUEST", GENERIC_OAUTH_ERROR_CODES.INVALID_OAUTH_CONFIG);           // line 185
  ...
  tokens = await validateAuthorizationCode({ ..., tokenEndpoint: finalTokenUrl, ... });                               // lines 187-200
}
...
const userInfo = providerConfig.getUserInfo ? await providerConfig.getUserInfo(tokens) : await getUserInfo(tokens, finalUserInfoUrl); // line 208
```
=> (b) = YES — `getToken` takes precedence over `tokenUrl` in the callback, and the custom `getUserInfo(tokens)` consumes the getToken output. (The `tokenUrl` / `finalTokenUrl` is consumed ONLY in the `else` branch at line 197, which never runs when getToken is present.)

CONCLUSION: Option A is sound. `tokenUrl` can be a static placeholder that exists only to pass the sign-in validity check (line 78); the real exchange runs through `getToken` (the api.workos.com/user_management/authenticate POST). **Option A taken.**

## Why phase 11 failed (the 3rd-iteration root cause)

Phase 11 used `discoveryUrl: https://<domain>/.well-known/openid-configuration` (the `*.authkit.app` OIDC doc). Those `/oauth2/*` endpoints are WorkOS **Connect / OAuth Applications** (third-party apps), which require a SEPARATELY-registered OAuth-Application client_id. The Environment Client ID (`client_01KV3ADWK7MYAD4FBM0N14RCCC`) is NOT one, so WorkOS returned "application not found" at the authorize step. First-party AuthKit login uses `api.workos.com/user_management/authorize` + the Environment Client ID (the phase-08 surface) — which we restore here, now fixed for the sign-in 400.

## The exact new provider config (buildWorkOSProviders, packages/auth/src/auth.ts)

Activates when `clientId && apiKey` (authkitDomain dropped). Returns:
```
{
  providerId: "workos",
  clientId,
  clientSecret: apiKey,                                                  // WorkOS API Key = OAuth client_secret
  scopes: [],
  pkce: false,
  responseType: "code",
  authorizationUrl: "https://api.workos.com/user_management/authorize",  // FIRST-PARTY AuthKit (not *.authkit.app Connect)
  tokenUrl: "https://api.workos.com/user_management/authenticate",       // placeholder ONLY — satisfies sign-in validation, never fetched
  authorizationUrlParams: { provider: "authkit" },                      // hosted AuthKit UI
  getToken: async ({ code, redirectURI }) => { POST authenticate {client_id, client_secret: apiKey, grant_type:"authorization_code", code, redirect_uri}; return {accessToken, refreshToken?, raw: <full response incl. user>} },
  getUserInfo: async (tokens) => tokens.raw.user -> {id, email, emailVerified, name:(first+last||email), image},
}
```
providerId stays `workos` => callback path stays `/api/auth/oauth2/callback/workos` (already registered in WorkOS) — CONFIRMED unchanged.

## Files

- `packages/auth/src/auth.ts` — `buildWorkOSProviders()` reconfigured to first-party AuthKit (Option A); gate `clientId && apiKey`; comment block rewritten (first-party rationale + tokenUrl-placeholder + getToken-precedence + phase-11-was-wrong-surface note).
- `packages/config/src/zod/server-config.ts` + `packages/shared/src/contracts/zod/server-config.ts` (byte-identical twins) — `authkitDomain` REMOVED from `AuthProviderWorkOSSchema`; comment restored to the api.workos.com first-party description.
- `packages/config/src/env-config-server.ts` — `WORKOS_AUTHKIT_DOMAIN` REMOVED from ServerConfigSchema; comment restored to two-var.
- `packages/api/src/startup/seed-config.ts` — `syncWorkOSProvider()` gate + envConfig + `hasOAuthEnvConfigured()` no longer reference WORKOS_AUTHKIT_DOMAIN/authkitDomain; doc-comment restored.
- `.env.example` + `docker/docker-compose.example.yml` — Option 5 WORKOS_AUTHKIT_DOMAIN + OIDC-discovery note REMOVED; restored to first-party (two-var) description.
- `packages/auth/__tests__/auth/workos-provider.test.ts` — rewritten for the first-party AuthKit shape (authorizationUrl/authorizationUrlParams/tokenUrl/clientSecret=apiKey/pkce=false/responseType/scopes=[]; getToken POSTs authenticate + preserves raw; getToken throws on non-OK; getUserInfo maps tokens.raw.user + name fallback + null; config-validity test mirroring better-auth's sign-in predicate proving both finalAuthUrl+finalTokenUrl present AND the authorize host is api.workos.com, not authkit.app).
- `packages/api/__tests__/startup/auth-provider-sync.test.ts` — fixtures dropped to the two-var shape; the "WORKOS_AUTHKIT_DOMAIN missing → not seeded" case became "only WORKOS_API_KEY set (Client ID missing) → not seeded".

## Verification (static + unit; LEAD owns docker:build + live WorkOS round-trip)

- typecheck EXIT 0: config, shared, auth, trpc, api, web (config + shared + web are real `tsc --noEmit`; auth/trpc/api use the repo's `--noCheck`).
- Tests: `@norish/auth` 115/115 (7 files; workos-provider 8/8 incl. the no-INVALID_OAUTH_CONFIGURATION sign-in-validity assertion AND the authorize-host=api.workos.com assertion; sso-auto-redirect 8/8 + claim-processor + password-auth UNCHANGED). `@norish/api` 349/349 (auth-provider-sync 23/23). `@norish/trpc` 255/255.
- `grep -rn "authkitDomain|WORKOS_AUTHKIT_DOMAIN" packages apps --include=*.ts` => NONE.
- Do NOT run `pnpm docker:build` (lead). Did NOT merge/deploy/touch live or `/opt/norish/`. No real key hardcoded.

## What the LEAD deploys

- `pnpm docker:build`, then redeploy.
- **REMOVE `WORKOS_AUTHKIT_DOMAIN` from the live compose** — YES, safe and recommended. It is no longer read anywhere (env-config-server.ts no longer declares it; SERVER_CONFIG drops unknown keys). Leaving it set is harmless (ignored) but cleaner to remove.
- `WORKOS_CLIENT_ID` + `WORKOS_API_KEY` UNCHANGED (both still required to activate the provider).
- No other env change. Auth-provider config is RESTART_REQUIRED, so the redeploy/restart re-seeds the `auth_provider_workos` row (now two-field) and rebuilds auth.ts.
- HUMAN-VERIFY: confirm `POST /api/auth/sign-in/oauth2 {providerId:workos}` returns 200 with a redirect `url` to `https://api.workos.com/user_management/authorize?...&provider=authkit&client_id=<env client id>` (NOT `*.authkit.app/oauth2/authorize`, NOT a 400), complete the AuthKit login, and confirm the callback `/api/auth/oauth2/callback/workos` (custom getToken -> authenticate -> getUserInfo maps tokens.raw.user) creates/links the user.

## Notes / assumptions

- getToken uses `Content-Type: application/json` (the phase-08 verified shape) — WorkOS `/user_management/authenticate` accepts JSON. (The plan text mentioned x-www-form-urlencoded; JSON is the proven phase-08 implementation and is what the rewritten config + tests use.)
- The two zod twins were kept byte-identical for the WorkOS block.
- The phase-09 env->DB->cache seed, phase-09 admin-card removal, and phase-10 SSO auto-redirect are all untouched. The genericOAuth OIDC/Google/GitHub providers + email/password are untouched.
- This supersedes WORKOS-OIDC-FIX-01 (phase 11): the OIDC-discovery surface was the wrong WorkOS product surface for the Environment Client ID.

## HUMAN-VERIFY (pending)

- **LEAD**: docker:build; REMOVE `WORKOS_AUTHKIT_DOMAIN` from the live compose (WORKOS_CLIENT_ID/WORKOS_API_KEY unchanged); redeploy; verify the sign-in returns 200 -> api.workos.com authorize (not 400, not authkit.app), and the full AuthKit login + callback round-trip succeeds.
