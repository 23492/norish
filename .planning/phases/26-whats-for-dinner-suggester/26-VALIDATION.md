# 26-VALIDATION — Phase 26 evidence (DINNER-01)

All commands on LXC 110 at `/opt/norish-src`, branch `main`, 2026-07-24.
`sg docker -c` is required for the trpc/db testcontainer suites (the `claude` user is not
in the docker group in-process).

## 1. What is security-critical here

The suggester touches the per-cookbook READ boundary: its candidate set must never surface a
recipe from a cookbook the viewer can't access. `getDinnerSuggestionCandidates` reuses
`buildViewPolicyCondition` WHOLESALE, so the HOUSE-06 scoping is INHERITED (the recommended
reuse). A suggester-level isolation suite proves it anyway, including under the LIVE
`view: "everyone"` policy.

The rater path (avatars/stars/thought-bubble) is UNCHANGED: the suggester fetches NO rater
names — the UI composes with the already-gated `ratings.getRaters`
(`assertRecipeAccess(view)` first, RATE-01), covered by
`packages/trpc/__tests__/ratings/raters.test.ts`.

## 2. Isolation suite — green (per-cookbook boundary + `everyone` sibling)

```
$ sg docker -c 'pnpm --filter @norish/db test dinner-suggester.isolation'
 Test Files  1 passed (1)
      Tests  6 passed (6)
```

What is proven BLOCKED (each under `household` AND the LIVE `everyone` sibling):
- U active on cookbook A gets A's recipes as candidates but NOT B's.
- Personal view (no active cookbook) excludes another cookbook's recipe AND another user's
  personal recipe; still surfaces the viewer's own recipes + orphans.
- (Smoke) the candidate carries the recipe's OWN tags + a household-scoped ratings aggregate.

## 3. Revert-check — weaken the candidate-query scoping, observe RED, revert byte-identical

Pre-weaken SHA-256 of `packages/db/src/repositories/recipes.ts`:
`8ef1b72a796729864af4ce39341fe4750c8da9b05954862d2314f29c0849dc3c`

Weakening (NOT committed) — drop the per-cookbook predicate in
`getDinnerSuggestionCandidates`:

```diff
   if (policyCondition) {
-    whereConditions.push(policyCondition);
+    // dropped: candidate query no longer scoped to the viewer's cookbook
+    void policyCondition;
   }
```

```
$ sg docker -c 'pnpm --filter @norish/db test dinner-suggester.isolation'
 Test Files  1 failed (1)
      Tests  4 failed | 2 passed (6)
   # the 4 cross-cookbook assertions go RED; the 2 non-exclusion smokes stay green
```

### Restore verified byte-identical

```
$ sha256sum packages/db/src/repositories/recipes.ts
8ef1b72a796729864af4ce39341fe4750c8da9b05954862d2314f29c0849dc3c   # matches pre-weaken
$ git diff --stat        # (no change to recipes.ts vs the committed version)
$ sg docker -c 'pnpm --filter @norish/db test dinner-suggester.isolation'
      Tests  6 passed (6)
```

## 4. Rater path stays RATE-01-gated

No new name-fetching path was added — the suggester returns only scoped recipe fields; the
UI's rater bubble reads `ratings.getRaters`, which throws FORBIDDEN for a non-viewer. That
gate is unchanged and remains covered:

```
$ sg docker -c 'pnpm --filter @norish/trpc test raters'   # (part of the 294 below)
      # ratings.getRaters returns raters for a viewer, FORBIDS a non-viewer (no name leak)
```

## 5. Gates

```
$ pnpm typecheck                                    # 17 successful, 17 total — EXIT 0
$ pnpm --filter @norish/shared-server test dinner-suggester   # 11 passed (pure ranking)
$ sg docker -c 'pnpm --filter @norish/db test dinner-suggester.isolation'   # 6 passed
$ sg docker -c 'pnpm --filter @norish/trpc test'    # 294 passed (30 files) — baseline
$ pnpm --filter @norish/shared-react test           # 37 passed
$ pnpm --filter @norish/web test                    # 424 passed (baseline; no net-new failures)
$ pnpm lint                                          # 14 tasks, 0 errors (warnings at baseline)
$ pnpm i18n:check                                    # EXIT 1 — ONLY the pre-existing `no` gap
                                                     #   (68 keys); ZERO new gaps
$ pnpm --filter @norish/web build                    # ✓ Compiled successfully — EXIT 0
```

### db suite note
The full `@norish/db` suite reports 2 failed files —
`__tests__/server/db/cleanup/cleanup-workflows.test.ts` and
`__tests__/server/db/repositories/timer-keywords-config.test.ts` — both failing on
`ECONNREFUSED :5432` (they need a fixed localhost Postgres, not a testcontainer). These are
the two KNOWN pre-existing sandbox failures; neither imports anything Phase 26 touches. The
new `dinner-suggester.isolation` suite (testcontainer-based) passes 6/6.

### i18n note
The base commit already fails `i18n:check` because the abandoned `no` locale is missing 68
keys. Phase 26 adds its new `recipes.dinner.*` keys to ALL 12 locale dirs INCLUDING `no`, so
the missing set stays exactly those 68 pre-existing keys (verified: `stash` baseline = 68
missing, after = 68 missing; the only flagged locale is `no`, and none of the missing keys
are `recipes.dinner.*`).

### hoisted-linker note (env)
`node_modules/@norish/{shared-server,shared-react}` are root-owned injected copies. The NEW
`dinner-suggester.ts` / `use-dinner-suggestion.ts` modules and the `shared-server`
`package.json` export change went STALE there and had to be re-synced (existing `src` files
are hardlinked, but new files + `package.json` are separate copies) before the cross-package
trpc suite and the web build resolved them. Re-sync only — no source change.

## 6. No schema change / no live action

No migration — the suggester reads only `recipes`, `recipe_tags`/`tags`, `recipe_ratings`.
DB stays at migration 41. The live stack was not touched; nothing was built into an image or
deployed.
