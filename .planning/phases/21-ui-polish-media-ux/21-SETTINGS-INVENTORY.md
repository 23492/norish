# Settings inventory — the decision Kiran needs to make (criterion 3)

**Written:** 2026-07-21, against `main` @ `fb31ea49`.
**Purpose:** `21-CONTEXT.md` concluded that "strip settings to essentials" is not plannable
without a card-by-card call, because Phases 14/15 moved *some* operator config to env and
cutting a card that is the only way to set something is a regression. This is that
card-by-card call, pre-worked so the decision is a review rather than an investigation.

**The one thing that decides each row:** *is there a non-UI way to set this?* If a setting
is env-backed, removing its card costs nothing but reach. If it is UI-only, removing the
card makes it **permanently unsettable** on a running instance.

---

## Two findings that came out of this, both corrections

### 1. `view: "everyone"` is the SHIPPED DEFAULT, not a choice made on this instance

`packages/shared/src/contracts/zod/server-config.ts:381`:

```ts
export const DEFAULT_RECIPE_PERMISSION_POLICY: RecipePermissionPolicy = {
  view: "everyone",
  edit: "household",
  delete: "household",
};
```

I had assumed — and it would be natural for anyone reading the session log to assume —
that live's `view: "everyone"` was an admin setting somebody had changed. It is not. It is
what every Norish instance seeds with on first boot.

**This materially changes how Phases 22 / 22.1 / 22.2 read.** Those three leaks were not
consequences of a misconfigured instance; they were **default-on for every deployment of
this fork**, and would have been default-on for anyone else running it. The fixes are
correspondingly more valuable than "we had a bad config".

### 2. The seed description for that key is factually wrong

`packages/api/src/startup/seed-config.ts:141`:

```ts
description: "Recipe permission policy (default: household)",
```

The default is `everyone`, not `household`. This string is surfaced as operator-facing
description text, so it actively tells an admin the opposite of the truth about the single
most security-relevant setting in the app. **One-line fix, worth doing regardless of what
happens to the settings UI.**

---

## The inventory

Legend for **Non-UI path**: ✅ = env var exists, so the card is a convenience;
❌ = no env var, so the card is the **only** way to change this on a running instance.

### Tab: `admin` — the source of the "self-hostable software" feel

| Card | Config key | Non-UI path | Proposed disposition |
|---|---|---|---|
| `ai-config-form` / `ai-processing-card` | `ai_config` | ✅ `AI_PROVIDER`, `AI_API_KEY`, `AI_ENDPOINT`, `AI_MODEL`, `AI_MAX_TOKENS`, `AI_TEMPERATURE`, `AI_TIMEOUT_MS`, `AI_ENABLED` | **env-only** — safe to cut |
| `video-processing-form` | `video_config` | ✅ `VIDEO_PARSING_ENABLED`, `VIDEO_MAX_LENGTH_SECONDS` | **env-only** — safe to cut |
| `content-detection-card` | `content_indicators` | ✅ `CONTENT_INDICATORS`, `CONTENT_INGREDIENTS` | **env-only** — safe to cut |
| `auth-providers/*` (10 files) | `auth_provider_{oidc,github,google,workos}` | ✅ `OIDC_*`, `GITHUB_*`, `GOOGLE_*`, `WORKOS_*` | **env-only** — safe to cut. Already ships an `EnvManagedBadge`, i.e. the env path is the acknowledged primary |
| `general-card` (registration, password auth, cleanup months) | `registration_enabled`, `password_auth_enabled`, `scheduler_cleanup_months` | ✅ `REGISTRATION_ENABLED`, `PASSWORD_AUTH_ENABLED`, `SCHEDULER_CLEANUP_MONTHS` | **env-only** — but see note ‡ |
| `prompts-form` | `prompts` | ❌ file default via `loadDefaultPrompts()`, no env | **KEEP or add env** — cutting makes AI prompts unchangeable |
| `timer-keywords-editor` | `timer_keywords` | ❌ file default via `defaultTimerKeywords` | **KEEP or add env** |
| `permission-policy-card` (admin) | `recipe_permission_policy` | ❌ constant default, no env | **KEEP — highest stakes** ‡‡ |
| `json-editor` | — (editor widget) | n/a | follows whatever it edits |
| `system-card` + `restart-confirmation-modal` | — (restart action) | n/a — action, not config | **operator-only** — strongest "self-hosty" signal |
| `bulk-categorization-form` | — (3 mutations, action) | n/a | **judgement call** — a genuine data operation, not config |
| `share-links-card` (admin) | — (read-only listing) | n/a | judgement call |
| `restart-required-chip`, `unsaved-changes-chip` | — (UI affordances) | n/a | follow their parents |

‡ `general-card` bundles `registration_enabled` with `scheduler_cleanup_months`. The first
is a thing a normal admin plausibly toggles; the second is pure operator config. If the
card is cut wholesale, registration goes env-only too — which interacts with the
**unscheduled INVITE-02 decision** (should an invite let someone sign up while
registration is off?). Flagging so the two are not decided in contradiction.

‡‡ `recipe_permission_policy` is the setting behind Phases 22, 22.1 and 22.2. Cutting this
card would remove the only way to move an instance off the leaky-by-default
`view: "everyone"`. If it is cut, an env var **must** land in the same change. Note the
per-cookbook `household/permission-policy-card` is a *different* control (POLICY-01,
per-cookbook) and is user-facing — keep it regardless.

### Tab: `user` — mostly legitimate end-user surface

| Card | Verdict |
|---|---|
| `profile-card`, `preferences-card`, `allergies-card` | **keep** — core user settings |
| `danger-zone-card` | **keep** — account deletion |
| `share-links-card` (user) | **keep** — user's own shares |
| `archive-import-card` | **keep** — user-facing data import |
| `api-token-card`, `site-auth-tokens-card` | **judgement call** — two separate token surfaces. Reads developer-y; likely the biggest "not a polished app" contributor outside admin |

### Tab: `household` — keep entirely

`household-info-card`, `members-card`, `join-code-card`,
`permission-policy-card` (per-cookbook), `no-household-view`/`household-view`.
All user-facing collaboration features and the subject of Phases 2/3. **No cuts proposed.**

### Tab: `caldav` — judgement call, but self-contained

6 components. Calendar sync is a real user feature, but it is niche and its config
(server URL, credentials) reads technical. Either keep as-is or demote behind a
"connected services" entry point. **No regression risk either way** — it is
self-contained and DB-backed per user.

---

## The actual decision, in one question

Everything above reduces to: **for the four ❌ rows — `prompts`, `timer_keywords`,
`recipe_permission_policy`, and (partly) `general-card` — do you want them kept in the UI,
or cut *with* env vars added in the same change?**

Every other row is either safe to cut today (env already exists) or a keep.

**Recommended default if you want one:** cut the four env-backed admin cards
(`ai`, `video`, `content-detection`, `auth-providers`) and `system-card`; keep the four
❌ cards for now; leave `user` and `household` alone; defer `caldav` and the two token
cards to a second pass once you have seen how much quieter it feels.

That is roughly a 60% reduction in admin surface with **zero** functional regression, and
it needs no new env plumbing — so it is plannable immediately, and the ❌ rows can be
revisited without blocking it.
