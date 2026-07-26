# 27-04 FIX — the `TRPCLink<any>` widening in `shared-react`, root-fixed

Closes VERIFY-4 **FINDING H-1** and corrects the two false "no type-widening"
claims in `.planning/quick/typecheck-gate-restore.md`.

Position: LXC 110, `/opt/norish-src`, branch `main`, 48 commits ahead of
`origin/main` when this started. Nothing pushed, nothing deployed.
`packages/db/src/migrations/meta/_journal.json` re-counted here: **42 entries**,
untouched. No docker, no live stack, no DB, no lockfile, no `pnpm-workspace.yaml`,
no `package.json`.

---

## 1. The true count and its provenance — established here, not inherited

VERIFY-3 and VERIFY-4 disagree. I re-derived the numbers from git rather than
adopting either.

| where | `origin/main` | `HEAD` (`bf1f5136`) | working tree after this fix |
|---|---|---|---|
| `trpc-links.ts` — `TRPCLink<any>` | **4** (lines 47, 48, 191, 202) | **5** (+ line 216) | **0** |
| `packages/shared-react/src/**` — `TRPCLink<any>` + `as any` + `@ts-ignore` + `@ts-expect-error` | **10** | **11** | **6** |
| of which in `providers/trpc-provider.test.ts` (`as any`) | 6 | 6 | 6 |
| `apps/web/app/providers/**`, `apps/mobile/src/providers/**`, `apps/mobile/src/lib/outbox/**` | **0** | **0** | **0** |

**Exactly one commit in the 48-commit range changed the count**, and it is the one
VERIFY-4 named:

```
bba2943e  fix(shared-react): resolve generic-inference errors in trpc/query plumbing
```

```diff
-function createHttpTransportLink<TRouter extends AnyTRPCRouter>(
+function createHttpTransportLink(
   getBaseUrl: () => string,
   getHeaders: () => HTTPHeaders
-): TRPCLink<TRouter> {
+): TRPCLink<any> {
```

`git log origin/main..HEAD -- packages/shared-react/src/providers/` returns
`bba2943e` and nothing else. So:

- **VERIFY-4 is right**: the fifth `TRPCLink<any>` was **added inside this
  unpushed range**, 4 → 5, by `bba2943e`. It is not pre-existing.
- **VERIFY-3 is wrong** on provenance, and also wrong on the symbol name: it
  calls line 216 `createHttpDataTransportLink`; there is no such function. Line
  216 *is* `createHttpTransportLink`'s return type; its siblings are
  `createHttpMutationLink` (191) and `createHttpFormDataMutationLink` (202).
- The other four were genuinely pre-existing: lines 47/48 (`mutationLink`,
  `extraLinks` in `CreateTRPCProviderBundleOptions`) and 191/202. **They are
  fixed here as well** — leaving them would have left the corrected doc claim
  still false.
- The 6 `as any` in `providers/trpc-provider.test.ts` are byte-identical to
  `origin/main`, are in a file `packages/shared-react/tsconfig.json` explicitly
  `exclude`s, and are out of this fix's scope. They are the reason the
  package-wide count is 6 and not 0.
- No implicit `any` in a public signature: `packages/shared-react` inherits
  `strict` from `@norish/tsconfig/base.json` and typechecks clean.

`bba2943e`'s commit message justified the widening as "bringing
`createHttpTransportLink` in line with that established, pre-existing pattern"
of its two siblings. The pattern was real; it was also the defect, and the
correct move was to fix all three rather than to spread it to a fourth site.

---

## 2. The obstacle, confirmed empirically

`bba2943e`'s technical diagnosis was accurate. `@trpc/client` types every
transport link's options through

```ts
// node_modules/@trpc/client/dist/unstable-internals.d-BOmV7EK1.d.mts:32
type TransformerOptions<TRoot extends Pick<AnyClientTypes, 'transformer'>> =
  TRoot['transformer'] extends true ? TransformerOptionYes : TransformerOptionNo;
```

and `httpLink<TRouter extends AnyRouter>` takes
`HTTPLinkOptions<TRouter['_def']['_config']['$types']>`. With an abstract
`TRouter`, the check type is an indexed access on an unresolved type parameter,
so the conditional stays deferred; and TypeScript's "assignable to both branches"
escape does not apply because `TransformerOptionNo.transformer` is
`TypeError<'You must define a transformer on your `initTRPC`-object first'>`,
which `superjson` is not assignable to.

Reproduced in isolation (scratch file, since deleted):

```
error TS2345: Argument of type '{ url: string; headers: ...; transformer: typeof superjson; }'
  is not assignable to parameter of type 'HTTPLinkOptions<TRouter["_def"]["_config"]["$types"]>'.
    Type ... is not assignable to type 'TransformerOptions<TRouter["_def"]["_config"]["$types"]>'.
```

I also confirmed the obvious next move is **not** sufficient: merely constraining
`TRouter` to a router whose `$types["transformer"]` is `true` still fails, because
TypeScript resolves a deferred conditional against the *restrictive*
instantiation of the check type, which erases the constraint.

---

## 3. The fix

`packages/shared-react/src/providers/trpc-links.ts`

```ts
/** The marker `initTRPC.create({ transformer })` leaves on a router's client types. */
type TransformedClientTypes = { _def: { _config: { $types: { transformer: true } } } };

/** …constraining `TRouter` here makes that requirement checked at each call site. */
export type TransformedRouter = AnyTRPCRouter & TransformedClientTypes;

/** …re-stating the literal `true` the constraint already promised. */
type ResolveTransformer<TRouter extends TransformedRouter> = TRouter & TransformedClientTypes;
```

Threaded through, with the router generic restored everywhere:

| site | before | after |
|---|---|---|
| `CreateTRPCProviderBundleOptions` | non-generic | `<TRouter extends TransformedRouter>` |
| `.mutationLink` | `TRPCLink<any>` | `TRPCLink<TRouter>` |
| `.extraLinks` | `TRPCLink<any>[]` | `TRPCLink<TRouter>[]` |
| `CreateTRPCClientLinksOptions` | non-generic | `<TRouter extends TransformedRouter>` |
| `createHttpMutationLink` | `(): TRPCLink<any>` | `<TRouter extends TransformedRouter>(): TRPCLink<TRouter>` |
| `createHttpFormDataMutationLink` | `(): TRPCLink<any>` | same |
| `createHttpTransportLink` | `(): TRPCLink<any>` | same |
| inner `splitLink` / `httpLink` / `httpBatchLink` / `wsLink` calls | inferred (`any`) | explicit `<TRouter>` / `<ResolveTransformer<TRouter>>` |
| `createTRPCClientLinks` | `<TRouter extends AnyTRPCRouter>` | `<TRouter extends TransformedRouter>` |
| `createTRPCProviderBundle` (`trpc-provider.tsx`) | `<TRouter extends AnyTRPCRouter>` | `<TRouter extends TransformedRouter>` |

**`ResolveTransformer` is a narrowing, not a suppression.** It intersects a type
parameter with a fact the parameter's own constraint already guarantees, so it
adds no information and cannot admit a router the constraint would reject —
`TransformedRouter` rejects `transformer: false` first, and the probe in §4
demonstrates exactly that. It is documented in place, at the site, with the
specific upstream typing limitation named. No `as any`, no `@ts-ignore`, no
`@ts-expect-error`, no `unknown` boundary, and no `any` remains in this module's
production source.

Both call sites (`apps/web/app/providers/trpc-provider.tsx`,
`apps/mobile/src/providers/trpc-provider.tsx`) already pass `AppRouter` from
`@norish/trpc/client` — the pattern the other 13 `shared-react` `types.ts` files
use — and `AppRouter["_def"]["_config"]["$types"]["transformer"]` is `true`, so
**no call site needed changing and no latent error was surfaced at one.** I
looked for latent errors rather than assuming their absence: `tsc` on
`shared-react`, `apps/web` and `apps/mobile` is clean, and the full 17/17
aggregate is clean.

---

## 4. What the compiler now catches that it did not before

Every probe below was run against a byte-copy of the pre-fix `trpc-links.ts`
(`git show HEAD:…`) **and** against the fixed file, so "the old code swallowed it"
is measured, not asserted. All probes were removed afterwards; the tree is clean.

| # | probe | pre-fix | post-fix |
|---|---|---|---|
| 1 | `createTRPCClientLinks<AppRouter-with-transformer:false>({…})` — build superjson transport links for a router that has no data transformer | **EXIT 0, swallowed** | **TS2344** `Type 'NoTransformerRouter' does not satisfy the constraint 'Router<any, any> & TransformedClientTypes' … Type 'false' is not assignable to type 'true'` |
| 2 | drop `transformer: superjson` from the `wsLink({ client })` call inside `createTRPCClientLinks` | **EXIT 0, swallowed** (the `TRPCLink<any>` transport link made `splitLink` infer `TRouter = any`, and `any extends true ? Yes : No` collapses to a union in which `transformer` is optional) | **TS2345** `Type '{ client: WsClient; }' is not assignable to … 'TransformerOptions<inferClientTypes<ResolveTransformer<TRouter>>>'` |
| 3 | the same probe-1 mistake at the **real** mobile call site, `createTRPCProviderBundle<…>` in `apps/mobile/src/providers/trpc-provider.tsx` | (constraint was `AnyTRPCRouter`, which the probe router satisfies) | **TS2344 at `trpc-provider.tsx:120`**, plus 9 consequent errors across `apps/mobile/src/hooks/**` |

In one sentence: **the client/server data-transformer contract is now a compile
error instead of a runtime deserialization bug.** Under `TRPCLink<any>` a
transformer could be dropped from any of the four transport links, or the whole
bundle pointed at a transformer-less router, and nothing complained; superjson
mismatches surface at runtime as silently mis-typed payloads (`Date` arriving as
`string`, `Map`/`Set` as `{}`), which is precisely the class of bug a
`transformer` is there to prevent.

Probe hygiene: probes 1 and 2 lived in throwaway files
(`providers/zz-old-links.ts`, `providers/zz-probe-old.ts`) that were deleted;
probe 2's live half and probe 3 were applied to real files and removed by
**reverse edit**, then verified `md5sum`-identical to the pre-probe hashes,
`cmp`-identical to a kept copy, and `git diff --exit-code` clean. Nothing was
committed with a probe in it. `git status` after the round shows only the three
files this change intends to touch (plus two files belonging to the concurrent
agent, which I did not touch).

---

## 5. Honest residue

Three things this fix does **not** achieve. None is a suppression, and none is
new.

1. **`TRPCLink<TRouter>` is structurally loose about router identity.** A probe
   that passed `mutationLink: TRPCLink<ForeignRouter>` — same procedures, a
   deliberately different `errorShape` — into `createTRPCClientLinks<AppRouter>`
   is accepted **both before and after** the fix. `TRPCLink<TInferrable>` only
   reaches the router through `TRPCClientError`, and tRPC's own error types are
   structurally permissive. So `mutationLink`/`extraLinks` are now checked for
   *shape and transformer*, but not for *router identity*. That is `@trpc/client`'s
   type design, not something `shared-react` can tighten locally. Recorded, not
   worked around.

2. **`apps/web`'s own `tsc` gate is vacuous** — `apps/web/tsconfig.json` sets
   `"noCheck": true` (with the upstream link, norish-recipes/norish#333) and
   `"noImplicitAny": false`. Measured, not inferred: probe 3 applied at the *web*
   call site produced **EXIT 0, zero output**, while the identical probe at the
   *mobile* call site produced 10 errors. `apps/web/tsconfig.json` is **unchanged
   in this 48-commit range** (empty diff against `origin/main`), so this is
   pre-existing and out of scope — but it means the new constraint protects
   `apps/web`'s single call site only via `@norish/shared-react`'s own typecheck,
   not via web's. Anyone quoting "`tsc --noEmit -p apps/web/tsconfig.json` exit 0"
   as evidence — including `typecheck-gate-restore.md`'s verification section —
   is quoting a gate that cannot fail.

3. **6 `as any` remain in `packages/shared-react/src/providers/trpc-provider.test.ts`.**
   Byte-identical to `origin/main`, unchanged in the range, and in a file the
   package's `tsconfig.json` excludes. Out of scope here; not claimed fixed.

---

## 6. The corrected doc claim

`.planning/quick/typecheck-gate-restore.md` stated at two places that "No
`as any`, `@ts-ignore`, `@ts-expect-error`, or type-widening was used anywhere in
this pass". Both are corrected in place rather than deleted:

- **~line 194** — the sentence now reads "No `as any`, `@ts-ignore`, or
  `@ts-expect-error` … **One type-widening was used**", followed by a
  re-correction block that gives the 4 → 5 count, names `bba2943e` as the
  commit that added it, states plainly that VERIFY-3's "present at this line
  before and after this pass" was wrong, and records that all five are now gone.
- **~line 455 (verification section)** — the same narrowing of the claim, with a
  re-correction block pointing at the fuller one above.

VERIFY-3's own text is left alone; its error is recorded, not edited. As
instructed, `27-04-SUMMARY.md` and `27-04-VERIFY-4.md` are untouched.

---

## 7. Gate numbers — before / after, run by me on this box

"Before" = the numbers `27-04-VERIFY-4.md` recorded at `1af9a8ee`/`bf1f5136`.
"After" = re-run here against the working tree with this fix applied.

| gate | before | after |
|---|---|---|
| `pnpm typecheck` (aggregate) | EXIT 0 — 17 successful, 17 total | **EXIT 0 — 17 successful, 17 total** |
| `tsc --noEmit -p packages/shared-react/tsconfig.json` | EXIT 0 | **EXIT 0, zero output** |
| `tsc --noEmit -p apps/web/tsconfig.json` | EXIT 0 | **EXIT 0, zero output** (vacuous — see residue #2) |
| `tsc --noEmit -p apps/mobile/tsconfig.json` | EXIT 0 | **EXIT 0, zero output** |
| vitest `@norish/shared-react` | 37 | **37 passed / 11 files, EXIT 0** |
| vitest `@norish/web` | 424 | **424 passed / 70 files, EXIT 0** |
| vitest `@norish/mobile` | 132 | **132 passed / 20 files, EXIT 0** |
| `pnpm lint` | EXIT 0, 14/14, 0 errors | **EXIT 0, 14/14, 0 errors** (warnings only, all pre-existing `import/order`) |
| `check-workspace-imports.mjs` | EXIT 0 | **EXIT 0 — "No workspace import issues found."** |
| `pnpm --filter @norish/web build:server` | EXIT 0 | **EXIT 0**, `dist-server/parse-worker.mjs` emitted, 9 chunks / 3.91 MB |
| `_journal.json` entries | 42 | **42** |

`packages/shared-react` and `apps/{web,mobile}` are the only packages this change
can reach: `createTRPCClientLinks` / `createTRPCProviderBundle` /
`CreateTRPCProviderBundleOptions` have no other importer in the repo
(`grep` over `packages/**` and `apps/**`, excluding `node_modules`, `dist`,
`.next`). The remaining 14 packages are covered by the 17/17 aggregate.

Prettier: `packages/shared-react` clean on both edited files. Hardlink twins
re-verified after every edit — `packages/shared-react/src/providers/{trpc-links.ts,
trpc-provider.tsx}` share inodes 339360 / 306787 with
`node_modules/@norish/shared-react/src/providers/…` and are `md5sum`-identical,
so no stale-copy compile occurred.

---

## 8. Verdict

The widening H-1 flagged is **removed at the root**, together with the four
pre-existing ones in the same file, with no suppression traded in for it. The
compiler now enforces the data-transformer contract that `TRPCLink<any>` had been
erasing, proven by three mutations that were green before and are red after. The
false doc claim is corrected at both sites with the true provenance. All gates
that were green are still green, at the same numbers.

Nothing here changes runtime behaviour: every edit is a type annotation or a
generic argument, and the emitted JavaScript is identical.
