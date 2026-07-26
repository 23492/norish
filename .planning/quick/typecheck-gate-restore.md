# Typecheck gate integrity restore — shared-react & mobile

## Origin

Every phase since `bb003e9a` "RC v0.17.0 (#280)" (2026-03-11, a squashed
monorepo-migration merge) has been gated on `pnpm typecheck` reading 17/17
green — but 7 of the 17 per-package scripts never actually typecheck. The
merge commit message contains the line **"Disable typecheck for now in CI"**,
a deliberate, explicitly temporary change that was never revisited.

The seven `--noCheck` (or otherwise-neutered) scripts:

| package | script |
|---|---|
| `packages/api` | `pnpm exec tsc --noEmit --noCheck` |
| `packages/auth` | `pnpm exec tsc --noEmit --noCheck` |
| `packages/queue` | `pnpm exec tsc --noEmit --noCheck` |
| `packages/shared-react` | `pnpm exec tsc --noEmit --noCheck` (**fixed this pass**) |
| `packages/shared-server` | `pnpm exec tsc --noEmit --noCheck` |
| `apps/mobile` | `pnpm exec tsc --noEmit --noCheck` (**fixed this pass**) |
| `packages/trpc` | `rm -rf dist .cache && pnpm exec tsc -p tsconfig.json --noCheck` (no `--noEmit`, and deletes its own build output as a side effect) |

`--noCheck` makes `tsc` skip type-checking entirely — the compiler still runs
(and with `--noEmit` even reports exit 0) but performs no semantic analysis,
so real type errors, including a deliberately-planted one in
`packages/api/src`, still leave the aggregate `pnpm typecheck` reading green.

## Scope of this pass

Restore genuine typechecking for **`packages/shared-react`** and
**`apps/mobile`** only. The other five packages are explicitly out of scope —
other agents are working in them concurrently — and are recorded below as
follow-up.

## What a real `tsc --noEmit` found, and the fix for each

Before this pass: `shared-react` → 13 real errors, `apps/mobile` → 23 real
errors (9 of which were transitive duplicates of shared-react's own errors,
surfaced again because mobile's tsconfig maps `@norish/trpc/*` straight to
`packages/trpc/src/*`, source rather than dist). 27 unique real errors total.

### Mechanical (API renames / strictness artifacts) — fixed

- **`StyleSheet.absoluteFillObject` → `StyleSheet.absoluteFill`** (React
  Native rename; the replacement is still a plain style object, so
  `...StyleSheet.absoluteFill` spreads identically). 5 call sites:
  `apps/mobile/src/styles/recipe-card.styles.ts`,
  `apps/mobile/src/styles/todays-meals-section.styles.ts`,
  `apps/mobile/src/components/groceries/swipeable-grocery-row.tsx`,
  `apps/mobile/src/components/recipe-detail/timer-fab.tsx`,
  `apps/mobile/src/components/shell/sheet/add-recipe-sheet.styles.ts`.
- **`react-native-mmkv` v4 API rewrite**: `MMKV` is now a type-only interface;
  instances are created via `createMMKV(config)`, and `.delete(key)` was
  renamed to `.remove(key)`. Fixed the 3 instance-construction sites
  (`apps/mobile/src/lib/storage/{mmkv,outbox-mmkv,query-cache-mmkv}.ts`) and,
  once construction was correctly typed, the compiler revealed 4 previously
  type-suppressed `.delete()` call sites that needed the same rename
  (`apps/mobile/src/hooks/recipes/recipe-filters-storage-adapter.ts`,
  `apps/mobile/src/lib/outbox/outbox-store.ts`,
  `apps/mobile/src/lib/query-cache/mmkv-persister.ts` ×2,
  `apps/mobile/src/stores/timers.ts`), plus the matching test mocks in
  `apps/mobile/__tests__/{outbox/*,query-cache/*}.test.ts`.
- **Tuple over-indexing**: `apps/mobile/src/app/(tabs)/_layout.tsx` —
  `useSegments()` without an explicit type parameter resolves to a union of
  tuples of different lengths (one per typed route under this layout), so a
  literal numeric index is invalid for the union's shorter members. Switched
  `segments[1]`/`segments[2]` to `segments.at(1)`/`segments.at(2)`, which is
  bounds-safe across the whole union and preserves the existing
  "out of range → undefined" behavior exactly.

### Genuine bugs — root-caused and fixed

1. **Missing `householdId` in recipe optimistic updates**
   (`packages/shared-react/src/hooks/recipes/dashboard/use-recipes-mutations.ts:162,225`).
   `createOptimisticFullRecipe` (used by the create-recipe mutation's
   `onMutate`) built a `FullRecipeDTO`-shaped object omitting `householdId`,
   `visibility`, `cookSource`, `cookTokens`, `cookConfidence`, and
   `cookReviewNeeded` — all schema-required fields once cookbook-scoping
   (Phase 2/23) added `householdId`/`visibility` to the recipe row.
   `createOptimisticDashboardRecipe` then dropped `householdId` again when
   mapping the (now-complete) full recipe down to its dashboard-list shape.
   Root cause: the client genuinely cannot know the true `householdId` at
   create time — `RecipeInsertBaseSchema` explicitly omits it from client
   input ("set from active cookbook server-side") — so the fix mirrors the
   existing `userId: null` placeholder already used one line above for the
   same reason: `householdId: null`, `visibility: "private"` (matching the DB
   column default), `cookSource/cookTokens/cookConfidence: null`,
   `cookReviewNeeded: false`, and `householdId: recipe.householdId` restored
   in the dashboard mapping.
   **User-visible consequence**: purely cosmetic and momentary. React Query
   replaces the optimistic cache entry with the server's real data on
   mutation success (or invalidates on error), so the only symptom is that a
   newly-created recipe could flash with the wrong cookbook association (e.g.
   briefly not appear in, or briefly appear in, an active-cookbook-filtered
   view) until the round-trip completes. The server has always been
   authoritative for this field; no data was ever written with a wrong
   `householdId`.

2. **Calendar subscription client/server contract drift**
   (`packages/shared-react/src/hooks/calendar/use-calendar-subscription.ts:102,110,118,164`).
   All four `onData` handlers destructured `{ payload }` from a
   `SubscriptionEnvelope<T>` wrapper type that no longer matches what the
   server actually emits. Verified against the live contract in
   `packages/trpc/src/routers/calendar/{subscriptions.ts,types.ts}`: each
   subscription's `for await` loop yields
   `CalendarSubscriptionEvents[event]` directly (e.g. `{ item: ... }`), never
   wrapped in `{ payload: ... }`. Removed the stale `SubscriptionEnvelope<T>`
   type and the destructuring; handlers now receive the event data directly.

3. **Update-mutation optimistic merge dropped required sub-entity fields**
   (`packages/shared-react/src/hooks/recipes/dashboard/use-recipes-mutations.ts`,
   the `updateMutation`'s `onMutate`, originally surfacing as a single
   `recipeIngredients[].id` error at line 455). `FullRecipeUpdateDTO`
   intentionally allows `recipeIngredients`/`steps`/step `images`/`images`/
   `videos`/`tags` entries without `id`/`version` (a user can add a new
   ingredient/step/image/video/tag client-side before the save round-trip
   assigns server ids), but the optimistic cache entry is typed as a full,
   persisted `FullRecipeDTO`, whose sub-entities require those fields. The
   code was passing the raw partial update payload straight into the
   "full recipe" cache entry. Root-fixed by extracting normalizer helpers
   (`toOptimisticRecipeIngredient`, `toOptimisticStep`,
   `toOptimisticStepImage`, `toOptimisticRecipeImage`,
   `toOptimisticRecipeVideo`) that backfill missing ids via the existing
   `createOptimisticId()` and default `version: 1`, mirroring the pattern
   `createOptimisticFullRecipe` already uses for the create path. Same class
   of bug as (1), same "brief flash, server authoritative" consequence — a
   newly-added-but-unsaved ingredient/step/image/video could otherwise have
   briefly rendered with `id`/`version` as `undefined` in the optimistic
   cache (e.g. breaking a React list `key`) until the server response landed.

4. **Incomplete household-context wiring** (`apps/mobile/src/context/household-context.tsx`).
   Only wired `useHouseholdQuery`/`useHouseholdSubscription` into
   `createHouseholdContext`, silently leaving `useHouseholdsListQuery`,
   `useSwitchActive`, `useCreateHousehold`, `useJoinHousehold`, `useRename`,
   `useGenerateInviteToken`, and `useJoinByInviteToken` unimplemented on
   mobile. All the underlying hooks already exist and are exported by
   `apps/mobile/src/hooks/households/shared-household-hooks.tsx` via
   `createHouseholdHooks` — `useHouseholdsListQuery` just wasn't re-exported
   from `apps/mobile/src/hooks/households/index.ts`, and the context wiring
   itself was never completed. Fixed by mirroring `apps/web/context/household-context.tsx`
   (the working reference implementation) exactly: added the missing
   `useHouseholdsListQuery` export and wired all required options from
   `useHouseholdMutations()`.

### Real error, wrong bucket in the initial assessment — reclassified and fixed

`packages/shared-react/src/providers/trpc-links.ts:224` was flagged in the
initial assessment as likely "duplicate nested package versions" noise. On
inspection there is no duplicate `@trpc/client`/`@trpc/server`/`superjson` in
the tree (checked all resolved copies under `node_modules`) — the real cause
is a TS conditional-type limitation: `createHttpTransportLink<TRouter extends
AnyTRPCRouter>`'s generic `TRouter` can't resolve trpc's
`TransformerOptions<TRoot>` conditional type (`TRoot['transformer'] extends
true ? ... : ...`) against an abstract type parameter, so a concrete
`superjson` transformer object is rejected. The file's own two sibling
helpers (`createHttpMutationLink`, `createHttpFormDataMutationLink`) already
sidestep this exact limitation by returning `TRPCLink<any>` instead of a
generic `TRPCLink<TRouter>` — `createHttpTransportLink` was the one holdout
using a real generic. Brought it in line with its siblings (dropped the
generic, `TRPCLink<any>` return type). No behavior change: `TRPCLink<any>` is
assignable to the outer `TRPCLink<TRouter>[]` return type of the exported
`createTRPCClientLinks`, exactly as the two siblings already were.

### Left unfixed — genuine dependency-tree duplication, out of scope

Exactly 4 errors remain in `packages/shared-react` + `apps/mobile` combined
(2 each, and mobile's 2 are literal duplicates of shared-react's since they
share the same transitive path). Diagnosed precisely, **not** papered over
with a cast:

- **`better-auth` / `@better-auth/core` duplicate versions.**
  `node_modules/@norish/shared/node_modules/better-auth` resolves a different
  copy than the top-level `node_modules/better-auth`, so `AuthClient`'s
  plugin types (`HookEndpointContext`, etc.) are nominally distinct between
  the two copies. Surfaces as `TS2322` in
  `packages/shared/src/lib/auth/client.ts:12,13` — a file outside this pass's
  scope (`packages/shared/**` is not `packages/shared-react/**` or
  `apps/mobile/**`) even setting aside that the honest fix is a dependency
  version alignment, not a source edit.
- **`@tanstack/query-core` duplicate versions.** `@tanstack/react-query`
  depends on `@tanstack/query-core@5.100.11` (hoisted), while
  `apps/mobile`'s own direct dependency `@tanstack/query-persist-client-core@^5.100.8`
  pins an exact, older `@tanstack/query-core@5.100.10` that pnpm cannot dedupe
  against the newer one (verified via `node_modules/@tanstack/query-persist-client-core/node_modules/@tanstack/query-core/package.json`).
  The resulting two `QueryClient` classes are structurally near-identical but
  nominally distinct (private class fields don't unify across separate
  builds), surfacing as `TS2322` ("`Property '#private'` ... refers to a
  different member") in
  `apps/mobile/src/lib/query-cache/create-persisted-query-client.ts:52,66`.
  The honest fix is a `pnpm.overrides` entry or a version bump in the root
  `package.json` / lockfile — out of scope for a pass restricted to
  `packages/shared-react/**` and `apps/mobile/**`.

No `as any`, `@ts-ignore`, or `@ts-expect-error` was used anywhere in this pass,
including for these two. **One type-widening was used**, and it is described in
the correction below.

> **CORRECTED 2026-07-26 (Phase 27 VERIFY-3), RE-CORRECTED 2026-07-27 (Phase 27
> FIX-TYPEWIDENING):** the original blanket "no type-widening" claim was wrong,
> and VERIFY-3's correction to it was itself wrong about the provenance.
>
> The facts, established by reading the range rather than either record:
> `packages/shared-react/src/providers/trpc-links.ts` held **four** `TRPCLink<any>`
> occurrences at `origin/main` (lines 47, 48, 191, 202) and **five** at `bf1f5136`.
> The fifth — the return type of `createHttpTransportLink` — was **added by this
> pass**, in commit `bba2943e fix(shared-react): resolve generic-inference errors
> in trpc/query plumbing`, which replaced
> `createHttpTransportLink<TRouter extends AnyTRPCRouter>(): TRPCLink<TRouter>`
> with a non-generic `(): TRPCLink<any>`. It was **not** "present at this line
> before and after this pass", as VERIFY-3 stated; that mis-attribution is
> recorded as VERIFY-4 finding H-1.
>
> **All five are now gone.** `trpc-links.ts` constrains its router generic to
> `TransformedRouter` (a router whose `$types["transformer"]` is `true`) and
> threads it through `createHttpMutationLink`, `createHttpFormDataMutationLink`,
> `createHttpTransportLink`, `wsLink`, `createTRPCClientLinks`,
> `CreateTRPCProviderBundleOptions` (`mutationLink` / `extraLinks`) and
> `createTRPCProviderBundle`. The `ResolveTransformer<TRouter>` helper documented
> at that site is a *narrowing* restatement of what the constraint already
> guarantees, needed only because TypeScript cannot resolve
> `@trpc/client`'s `TransformerOptions<TRoot>` conditional against an unresolved
> type parameter. See `.planning/phases/27-cooklang/27-04-FIX-TYPEWIDENING.md`.

### Cross-package leak fixed with a scoped, non-invasive declaration

`apps/mobile`'s `tsconfig.json` maps `@norish/trpc/*` straight to
`packages/trpc/src/*` (source, not `dist`) so router types stay live during
development. That pulls `packages/shared-server/src/media/storage.ts`
(which imports the untyped `heic-convert` package) into `apps/mobile`'s own
type-check, but `packages/shared-server/src/global-modules.d.ts` — which
already declares `heic-convert` for shared-server's own compile — is never
loaded into mobile's program, since it isn't reachable via mobile's
`tsconfig.json` `include`. Rather than touch `packages/shared-server` (out of
scope) or the `@norish/trpc/*` path mapping (higher-risk, broad blast radius,
and this is a type-correctness pass, not a refactor), mirrored the exact same
ambient declaration in `apps/mobile/declarations.d.ts` (already part of
mobile's `include`), with a comment explaining why it's duplicated rather
than shared.

## Known downstream consequence in `apps/web` (out of scope, not fixed here)

`apps/web/__tests__/hooks/calendar/use-calendar-subscription.test.ts` mocks
`useSubscription` entirely (it stubs `@trpc/tanstack-react-query` and
`@/app/providers/trpc-provider` and drives the captured `onData` callback
directly with test-authored fixtures — it never exercises a real server), and
every fixture in that file hardcodes the stale `{ payload: {...} }` envelope
(`callback({ payload: { ... } })`, 12 call sites). That means this test
encodes the same wrong assumption that the real bug (genuine bug #2 above)
had baked into `use-calendar-subscription.ts` — it was never verifying real
behavior, only that the consumer matched its own (outdated) mock shape.

After removing the stale envelope in `packages/shared-react` (the correct,
server-contract-verified fix), 12/12 subscription-payload tests in this one
`apps/web` file fail — `onFailed` is unaffected since its handler ignores its
argument entirely. `apps/web` overall: **412/424 passing** (down from the
424/424 baseline), 100% attributable to this one file.

This is a direct, mechanical, and entirely predictable consequence of fixing
genuine bug #2, but `apps/web/**` is outside this pass's scope
(`packages/shared-react/**`, `apps/mobile/**`, and two `package.json` lines
only), so it was **not fixed here** per the "stop and report rather than
reach into another agent's files" instruction. The fix, for whoever owns
`apps/web`, is mechanical: drop the `payload:` wrapper from the 12
`callback({ payload: {...} })` call sites in that one test file so they match
the corrected (and now server-contract-accurate) hook.

## Verification

- `tsc --noEmit -p packages/shared-react/tsconfig.json`: 13 → 2 errors (the
  documented `better-auth` duplicate, out of scope).
- `tsc --noEmit -p apps/mobile/tsconfig.json`: 23 → 2 errors (the documented
  `@tanstack/query-core` duplicate, out of scope).
- `packages/shared-react` tests: 37/37 passing (baseline unchanged).
- `apps/mobile` tests: 132/132 passing (baseline unchanged; 4 tests needed
  their MMKV mocks renamed `delete` → `remove` to match the real v4 API this
  pass exposed).
- `apps/web` tests: verified separately (web consumes `shared-react`).
- Confirmed via `stat -c '%i'` that `node_modules/@norish/shared-react`'s
  hardlinked copy shares inodes with `packages/shared-react/src` after these
  edits — `apps/mobile` sees the real changes, not a stale farm copy.

## Follow-up: the remaining five `--noCheck` scripts

Explicitly left untouched this pass — other agents are actively working in
these packages, and flipping their gate mid-flight would corrupt their
measurements. Per the prior assessment, a real `tsc --noEmit` against each
gives **0 errors today**, so flipping these should be low-risk once those
streams land, but each script has its own wrinkle worth flagging to whoever
picks this up:

- `packages/api`: `pnpm exec tsc --noEmit --noCheck` → drop `--noCheck`.
- `packages/auth`: `pnpm exec tsc --noEmit --noCheck` → drop `--noCheck`.
- `packages/queue`: `pnpm exec tsc --noEmit --noCheck` → drop `--noCheck`.
- `packages/shared-server`: `pnpm exec tsc --noEmit --noCheck` → drop
  `--noCheck`. Note `packages/shared-server/src/global-modules.d.ts` already
  carries the `heic-convert` ambient declaration this pass had to duplicate
  into `apps/mobile/declarations.d.ts`; no action needed there beyond
  flipping the flag.
- `packages/trpc`: `rm -rf dist .cache && pnpm exec tsc -p tsconfig.json --noCheck`
  — two separate problems, not one: (a) missing `--noEmit`, so this script
  silently type-checks nothing meaningful even once `--noCheck` is removed
  unless emit is also either kept intentional (it's a build script that
  legitimately does emit — confirm whether this is meant to be a build step,
  not a typecheck step, before touching it) and (b) `rm -rf dist .cache`
  destroys the package's own build output as a side effect of what is
  labeled `typecheck` in scripts — any consumer relying on `packages/trpc/dist`
  (e.g. any package whose tsconfig path-maps to `../trpc/dist/*` rather than
  `src/*`, such as `packages/shared-react/tsconfig.json`) will break until
  `pnpm --filter @norish/trpc build` is re-run. This script needs a real
  decision (split "typecheck" from "build", or fix the path) rather than a
  one-line flag flip.

---

# Follow-up pass: the calendar `{ payload }` envelope — ground truth

Resolves the "Known downstream consequence in `apps/web`" section above
(`apps/web` 412/424). That section, and `18c242bc`'s commit message, both
assert that the `{ payload }` wrapper never existed and that calendar realtime
was therefore broken at runtime. **Both claims are wrong.** The wrapper is
real; it is added client-side, one layer above where the previous pass looked.

## Verdict: the wrapper is REAL (added by the tRPC provider proxy)

`packages/shared-react/src/providers/trpc-provider.tsx` defines
`withPayloadCompatibility()` and applies it through
`wrapSubscriptionObserverOptions()` → `wrapTrpcProxy()` →
`createNormalizedUseTRPC()`. Every `subscriptionOptions()` call made through a
`createTRPCProviderBundle()` `useTRPC` has its `onData` wrapped, and the shim
does this to each event:

```ts
const payload = unwrapPayload(data);          // strips RealtimeEventEnvelope if present
if ("payload" in payload) return payload;
return { ...(payload as Record<string, unknown>), payload };   // ← dual shape
```

So `onData` receives the domain payload's own keys **at the top level** *and* a
legacy `payload` self-reference. `data.item` and `data.payload.item` both
resolve, to the same object. This is deliberate and already regression-tested
in `packages/shared-react/src/providers/trpc-provider.test.ts` ("exposes
envelope payloads both at the top level and under payload", and the same for
raw payloads).

Both apps consume it: `apps/web/app/providers/trpc-provider.tsx` and
`apps/mobile/src/providers/trpc-provider.tsx` are both thin
`createTRPCProviderBundle<AppRouter>({ ... })` calls, so the proxy is always in
the path in production.

### Consequences

- **`18c242bc` did not break production.** Bare top-level access works, because
  the shim spreads the payload's own keys.
- **The code before `18c242bc` was not broken either.** `{ payload }`
  destructuring works, because the shim adds the alias.
- **Live calendar realtime was never broken.** No user-visible bug, no
  regression window, nothing to roll back. The claim in `18c242bc`'s message
  ("the client would have thrown or silently no-opped on undefined `payload` at
  runtime") is incorrect — it reasoned from the router alone and never checked
  the provider.
- **This was not a different code path either.** `apps/web/hooks/calendar/use-calendar-subscription.ts`
  is a one-line re-export of `createCalendarHooks(...).useCalendarSubscription`
  from `shared-react`, so the web test does exercise the shared hook.

## Server-side shapes, for the record

Two distinct server paths exist in `packages/trpc/src/helpers.ts`, and the
publisher (`packages/shared-server/src/redis/pubsub.ts` `publish()`) always
wraps in a `RealtimeEventEnvelope`:

| helper | yields | routers |
|---|---|---|
| `createSubscriptionIterable` (runs `unwrapPayload`) | bare domain payload | calendar, groceries, stores, households, archive, caldav, permissions |
| `createEnvelopeAwareSubscription` / `createPolicyAwareIterables` (assert + pass through) | `{ meta, payload }` | recipes, ratings |

`createSubscriptionIterable` gained its `unwrapPayload` call in `1f684480`
"Rc/0.19.0" (2026-06-19). Before that it passed the envelope straight through.
That is the real divergence point, and it is where the confusion came from:

- `80d8c1b8` "Rc/v0.18.0" (2026-04-14) introduced the envelope contract; every
  hook correctly moved to `({ payload }: any)`.
- `1f684480` (2026-06-19) made the server unwrap, and in the same release
  migrated the **groceries** hook `({ payload }: any)` → `(payload: Typed)`,
  switched **recipes/ratings** to the envelope-aware path (so their
  `{ payload }` stayed correct), and added `withPayloadCompatibility` so that
  neither style could break. The **calendar** hook was left on `{ payload }`
  and, in the same release, had it formalised into a named
  `SubscriptionEnvelope<T>` type — which is what later read as a deliberate
  contract rather than a leftover.

So the calendar hook was the one namespace not migrated, but the compat shim
meant nothing ever broke. `18c242bc` completed that migration; it is the
correct direction and is **kept**, because bare top-level access is the only
form the tRPC output types can express for this router (it typechecks with no
cast), and `payload` is documented in the shim as a legacy alias.

## Root cause of the 12 `apps/web` failures

Not the hook, and not the fixtures per se: **the test mocks
`@/app/providers/trpc-provider`, which replaces the normalised proxy with a
plain object, so `withPayloadCompatibility` never ran.** The fixtures then
hand-rolled one half of the shim's output (`{ payload: ... }`, no top-level
spread), so the test could only ever pass against a hook using the legacy half.
It was asserting against its own mock, not against the wire.

Every `apps/web` subscription test has this same gap, and they disagree with
each other about which half to fake — `emitPayload()` is defined locally in
four files, as `(p) => p` in `__tests__/hooks/groceries/`, and as
`(p) => ({ payload: p })` in `__tests__/hooks/{ratings,recipes}/`. Both are
half-fictions relative to the real `{ ...p, payload: p }`. The four that are
green are green because each happens to match its own hook's access style.

### Fix applied

`apps/web/__tests__/hooks/calendar/use-calendar-subscription.test.ts`:

1. The mocked `useTRPC` now routes each `subscriptionOptions()` call through the
   **real** `wrapSubscriptionObserverOptions` imported from
   `@norish/shared-react/providers`, instead of capturing `options.onData` raw.
2. All 13 fixtures (the 12 failing ones plus `onFailed`, which passed only
   because its handler ignores its argument) now carry the **true server wire
   shape** from `CalendarSubscriptionEvents` — `{ item }`,
   `{ itemId, date, slot }`, `{ item, targetSlotItems, ... }`, `{ reason }`.

The test now covers server wire shape → real provider shim → hook, so drift on
either side fails it, and neither half of the shim's output can go unexercised
again. No fixture encodes a shape the system doesn't produce.

Also added a contract comment to
`packages/shared-react/src/hooks/calendar/use-calendar-subscription.ts`
(comment only, no behaviour change) recording where the `payload` alias comes
from and why it must not be "restored" here — the omission that produced two
opposite wrong diagnoses in a row.

## Sibling drift audit — no other hook is affected

Checked every `onData` in `packages/shared-react/src/hooks/**`,
`apps/web/hooks/**` and `apps/mobile/**` against its router's yield path. All
consistent under the shim: recipes/ratings read `{ payload }` and are on the
envelope-aware path; groceries and calendar read the top level; stores,
households, archive and caldav read `{ payload }` on unwrapped routers, which
the shim's alias covers.

One genuine failure mode does exist and was checked explicitly:
`withPayloadCompatibility` returns the payload **untouched** when it is an
array, a primitive, or a non-plain-object, so no `payload` alias is added and a
`{ payload }` hook would read `undefined`. Audited every event payload type
(`CalendarSubscriptionEvents`, `RecipeSubscriptionEvents`,
`RatingSubscriptionEvents`, `StoreSubscriptionEvents`,
`HouseholdSubscriptionEvents`, `GrocerySubscriptionEvents`,
`CaldavSubscriptionEvents`): **all are plain objects at the top level** — arrays
appear only nested (`{ stores: StoreDto[] }`, `{ groceryIds: string[] }`). So
the latent trap is unreachable today. Worth keeping in mind for any future
event whose payload is a bare array.

## Verification

- `apps/web` tests: **424/424 passing (70 files)** — exact baseline restored.
- `packages/shared-react` tests: **37/37 passing**.
- `apps/mobile` tests: **132/132 passing**.
- `tsc --noEmit -p apps/web/tsconfig.json`: **exit 0, zero output**.
- `tsc --noEmit -p packages/shared-react/tsconfig.json`: exit 2, **the same 2
  pre-existing `better-auth` duplicate errors** documented above, in
  `node_modules/@norish/shared/src/lib/auth/client.ts:12,13`. Unchanged by this
  pass (a comment-only edit cannot affect it).
- `packages/trpc` tests: 326/337, **11 failing in
  `__tests__/recipes/cook-tokens-isolation.test.ts`** — all `cookTokens` coming
  back `null`. That file wraps the real
  `@norish/shared-server/cooklang/parse` `parseCookSource`, and
  `packages/shared-server/src/cooklang/**` is a concurrent agent's live working
  tree. **Not attributable to this pass**: nothing in `packages/trpc` imports
  `shared-react` or `apps/web`.
- Full monorepo gate deliberately **not** run (concurrent `shared`/
  `shared-server` edits in flight).
- No `as any`, `@ts-ignore`, or `@ts-expect-error`. The one cast in the new test
  mock is a narrowing `unknown` → `ObserverOptions`, guarded by a runtime
  `typeof`/`in` check that throws if the shim's contract changes. **One
  type-widening was used** — see the correction below.
  > **CORRECTED 2026-07-26 (Phase 27 VERIFY-3), RE-CORRECTED 2026-07-27 (Phase 27
  > FIX-TYPEWIDENING):** this line's blanket "no type-widening" claim was wrong at
  > the package level, and VERIFY-3's correction to it was wrong about the
  > provenance. This pass **did** introduce a type-widening: commit `bba2943e`
  > dropped the `<TRouter extends AnyTRPCRouter>` generic from
  > `createHttpTransportLink` and widened its return type to `TRPCLink<any>`,
  > taking `trpc-links.ts` from four `TRPCLink<any>` occurrences to five. It did
  > not "predate and survive" the pass. All five have since been removed and the
  > router generic properly threaded — see the fuller correction above near line
  > 194 and `.planning/phases/27-cooklang/27-04-FIX-TYPEWIDENING.md`.

## Recommended follow-up (not done here — out of scope)

The four `apps/web` subscription tests that still hand-roll `emitPayload()`
(`groceries`, `ratings`, `recipes` ×2) should adopt the same
`wrapSubscriptionObserverOptions` approach. They are green today, but each one
only exercises one of the shim's two access forms, so they would not catch a
hook migrated in either direction — exactly the blind spot that made this
incident take two passes to diagnose.
