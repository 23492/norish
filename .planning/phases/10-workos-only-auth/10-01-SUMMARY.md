---
phase: 10-workos-only-auth
plan: 10-01
subsystem: auth
status: code-complete
requirements: [WORKOS-ONLY-01]
commits: [b1391406, 19875741, a3f2727e]
---

# Phase 10 Plan 10-01 SUMMARY: WorkOS as the sole sign-in path — disable norish-only auth + auto-redirect to AuthKit

## Outcome: CODE-COMPLETE (human-verify pending: lead sets `PASSWORD_AUTH_ENABLED=false` + WorkOS env in the live compose, docker:build, redeploy, Chrome e2e)

WorkOS AuthKit can now be the ONLY sign-in/sign-up path: the unauthenticated entry auto-redirects straight to the WorkOS hosted login (Google etc.), the norish login UI is never shown, and no norish email/password login or signup is reachable — while staying fully recoverable via config or `?sso=0`.

## Config-vs-code: norish ALREADY had most of this

Investigation found norish already shipped a built-in sole-OAuth-provider auto-redirect; this plan made it robust + testable and added the explicit escape, rather than building it from scratch:

- **Auto-redirect already existed.** `apps/web/app/(auth)/login/page.tsx` already computed `oauthProviders.length === 1 && !hasCredential && !justLoggedOut` and `login-client.tsx` already rendered `<AutoSignIn>`, which already calls `signIn.oauth2({providerId})` for non-google/github providers (i.e. WorkOS providerId `workos`) -> the AuthKit page.
- **norish-only signup already auto-disables.** `signup/page.tsx` already `redirect("/login")` when `!passwordEnabled`, and `getAvailableProviders()` only adds the `credential` provider when `PASSWORD_AUTH_ENABLED` is true. So turning password auth off removes both the email/password login form and the signup route — no code needed for the "no norish-only accounts" half.
- **Loop-safety already existed.** `apps/web/proxy.ts`'s matcher EXCLUDES `/login`, `/signup`, `/auth-error`, and `/api/auth` from the auth redirect, and the OAuth flow uses `errorCallbackURL:"/auth-error"` (which links back to `/login?logout=true`). The WorkOS callback `${AUTH_URL}/api/auth/oauth2/callback/workos` is under the excluded `api/auth`, so the post-auth callback can never bounce back into the auto-redirect.
- **Password default already correct.** `PASSWORD_AUTH_ENABLED` defaults to `!hasOAuthEnvConfigured()` (phase 09), so it defaults OFF when only WorkOS env is configured.

**What needed code:** (1) the existing redirect condition was inline + untestable; (2) the only escape was `?logout=true` (semantically wrong + undiscoverable) — the task asked for an explicit `?sso=0`; (3) the redirect spinner had no visible way out; (4) no tests covered the condition.

## What changed

1. **`packages/auth/src/providers.ts`** — NEW pure `shouldAutoRedirectToSso(providers, escapeRequested=false)`: `!escapeRequested && oauthProviders.length === 1 && !hasCredential`. Conservative + self-recovering by construction.
2. **`apps/web/app/(auth)/login/page.tsx`** — calls the helper; `searchParams` gains `sso?`; `escapeAutoRedirect = sso === "0" || logout === "true"`. Same runtime behavior as before PLUS the `?sso=0` escape.
3. **`apps/web/app/(auth)/signup/page.tsx`** — `searchParams` gains `sso?`; forwards `?sso=0` through the existing `redirect("/login")` so the escape survives the signup->login bounce.
4. **`apps/web/app/(auth)/login/components/auto-sign-in.tsx`** — a `next/link` "Use another sign-in method" -> `/login?sso=0` on the redirect spinner (visible recovery hatch if the provider is down).
5. **`packages/i18n/src/messages/*/auth.json`** (all 11 locales) — NEW `login.useAnotherMethod` (en/nl/de-formal/de-informal/fr/es/it translated; da/ko/pl/ru English fallback) to keep `check:locale-keys` parity.
6. **`packages/auth/__tests__/auth/sso-auto-redirect.test.ts`** — NEW, 8 tests.

NOT changed (deliberately): the genericOAuth WorkOS provider (`buildWorkOSProviders` in auth.ts), the proxy matcher, the better-auth callback, `login-client.tsx`'s defensive re-check, the auth-error page, any env-config schema, any live container.

## The exact env/config to flip (lead)

- **`PASSWORD_AUTH_ENABLED=false`** — removes the email/password login form + the signup route, leaving WorkOS as the sole provider, which triggers the auto-redirect. (Alternatively, omitting `PASSWORD_AUTH_ENABLED` defaults it OFF when WorkOS env is set — but the live DB row is currently `true`, so it must be set to `false` explicitly OR the `password_auth_enabled` server-config row reset; env is the clean lever.)
- **`WORKOS_CLIENT_ID` + `WORKOS_API_KEY`** must be set (phase 09) so WorkOS is the one configured provider. No other social/OIDC env should be set.
- NO new flag was introduced — the behavior is driven entirely by provider state. `?sso=0` is a URL param, not a config key.

## How redirect loops are avoided + the recovery escape

- **No loop:** the auto-redirect only lives on `/login` (and `/signup`->`/login`), all of which are proxy-excluded; the OAuth callback `/api/auth/...` is proxy-excluded; failures go to `/auth-error` (excluded, with a back link). The auto-redirect target is the external WorkOS authorize URL, never an internal route that re-enters the matcher.
- **Recovery escape (`?sso=0`):** `shouldAutoRedirectToSso(providers, escapeRequested)` returns false whenever `?sso=0` (or `?logout=true`) is present, so `/login?sso=0` always renders the normal login page. The escape is forwarded through signup and surfaced as a visible link on the spinner.
- **Config fallback:** because the decision is pure provider-state, re-enabling password auth OR unsetting WorkOS immediately returns the normal login page on next request — no code deploy, no lockout.

## Files + commits

- `b1391406` feat(10-workos-only): providers.ts (shouldAutoRedirectToSso) + login/page.tsx + signup/page.tsx.
- `19875741` feat(10-workos-only): auto-sign-in.tsx escape link + login.useAnotherMethod in all 11 locales.
- `a3f2727e` test(10-workos-only): sso-auto-redirect.test.ts (8 tests).

## Verification (static + unit; LEAD owns docker:build + Chrome + WorkOS dashboard)

- typecheck `@norish/auth` + `@norish/web` (real `tsc --noEmit`) both **EXIT 0**.
- `pnpm i18n:check` **EXIT 0** (all 11 locales complete).
- lint: `@norish/auth` 0 errors; eslint on the 3 touched web files 0 errors.
- Tests: `@norish/auth` full suite **114/114** (7 files), incl. NEW `sso-auto-redirect.test.ts` **8/8** and unchanged `workos-provider.test.ts` **7/7**; `password-auth.test.ts` **9/9** unchanged.
- Pre-existing OUT-OF-SCOPE failures (NOT touched, per phase 09): archive-import-overwrite (shared-server), updateRecipeWithRefs (db).
- Did NOT run `pnpm docker:build`; did NOT enter any real WorkOS key; did NOT touch live containers / `/opt/norish/`.

## HUMAN-VERIFY (pending)

- **LEAD**: set `PASSWORD_AUTH_ENABLED=false` (and `WORKOS_CLIENT_ID`/`WORKOS_API_KEY`) in the deploy env/compose; `pnpm docker:build`; redeploy. Confirm: visiting the app while logged out lands on the WorkOS AuthKit page (Google etc.), NOT the norish login UI; `/login?sso=0` shows the normal login page; `/signup` redirects to login (no norish-only signup). Confirm no redirect loop on auth cancel (lands on /auth-error with a back link).
- **RECOVERY CHECK**: with `PASSWORD_AUTH_ENABLED=true` again (or WorkOS unset), confirm the normal login page returns (no lockout).
- Callback URI in the WorkOS dashboard (unchanged): `${AUTH_URL}/api/auth/oauth2/callback/workos`.

## Gaps / assumptions

- Auth-provider + password config is `RESTART_REQUIRED` (phase-08/09 baseline): flipping `PASSWORD_AUTH_ENABLED` requires a container restart for `seedServerConfig`/cache to reload. Expected for config-as-code.
- The live `norishp2` test container currently has `PASSWORD_AUTH_ENABLED=true` and NO WorkOS env, so the auto-redirect is dormant there until the lead flips the config — this is the safe default (normal login page shows).
- `login-client.tsx` keeps its own defensive `autoRedirect && oauthProviders.length === 1 && !credentialProvider` re-check; left intact (belt-and-suspenders, still correct).
