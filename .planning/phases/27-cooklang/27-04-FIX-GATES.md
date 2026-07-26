# 27-04 — the three gate problems, root-fixed

**Scope.** VERIFY-3's `## VERIFY-3 — open blockers before deploy` →
"The three gate problems (from the consolidated pass)". Nothing else in VERIFY-3
(the six open blockers, the minor findings) is touched here.

**Position.** 3 commits on `main`, **45 commits ahead of `origin/main`**.
**Nothing pushed. Nothing deployed.** Live image still `516c52576a5f`, DB still at
migration **42**, `_journal.json` still 42 entries ending `0041_add_cook_source`,
no file under `packages/db/src/migrations/` and nothing under `docker/` touched.
Working tree clean.

| commit | gate | subject |
|---|---|---|
| `c3a3e73e` | **G3** | `test(27-04): report the D-27-W3-07 measurement via vitest annotate, not console` |
| `bd6b3071` | **G1** | `test(27-04): take the module load out of migrate-gallery-images' test budget` |
| `9cf78c18` | **G2** | `fix(27-04): dedupe @tanstack/query-core and refresh the stale lockfile` |

Total diff: 4 files, 321 insertions / 601 deletions (the deletions are almost
entirely `pnpm-lock.yaml` shrinking as duplicates collapse).

---

## Gate numbers, before → after

| gate | before | after |
|---|---|---|
| **`pnpm typecheck`** | **EXIT 1** — 14 successful / 15 total, `@norish/shared-react` FAILED (2 errors); `@norish/web` + `@norish/mobile` never ran (behind `shared-react` in turbo's graph); `apps/mobile` alone = 2 errors | **EXIT 0 — 17 successful / 17 total** |
| `tsc --noEmit` `packages/shared-react` | 2 errors | **0**, zero output |
| `tsc --noEmit` `apps/mobile` | 2 errors | **0**, zero output |
| vitest `@norish/api` | 408 passed (30 files) — but 2 fail under load, see G1 | **408 passed (30 files)**, 0 timeouts under the same load |
| vitest `@norish/web` | — | **424 passed (70 files)** |
| vitest `@norish/mobile` | — | **132 passed (20 files)** |
| vitest `@norish/shared-react` | — | **37 passed (11 files)** |
| vitest `@norish/shared` / `shared-server` / `db` / `trpc` / `queue` / `auth` / `config` | — | **319 / 554 / 183 / 337 / 123 / 133 / 712 passed** |
| **vitest total** | — | **3 362 passed, 251 files, 11 packages, 0 failed** |
| **`pnpm lint`** | 0 errors | **EXIT 0 — 14/14 tasks, 0 errors, 2 233 warnings** |
| `check-workspace-imports.mjs` | EXIT 0 | **EXIT 0** — "No workspace import issues found." |
| `pnpm --filter @norish/web build:server` | EXIT 0 | **EXIT 0**, `dist-server/parse-worker.mjs` re-emitted (6 942 B) after being deleted first, so the check is not vacuous |
| `pnpm i18n:check` | EXIT 1 (known baseline) | **EXIT 1** — unchanged, not made worse |
| `pnpm format:check` | EXIT 1 (known baseline) | **EXIT 1** — unchanged; turbo aborts at `@norish/db-schema` (`src/schema/{auth,recipes}.ts`), neither touched here. All **4** files this pass changed are prettier-clean. |
| `check-circular-deps.mjs` | EXIT 1 (1 cycle) | **EXIT 1**, same single pre-existing cycle `db-schema/src/schema/auth.ts -> households.ts` (the intentional mutual-table-FK pattern in `CLAUDE.md`). Not in the required gate set; recorded so it is not mistaken for new. |

Box: LXC 110, 4 cores, 5 000 MB RAM, Node v22.22.3, pnpm 10.33.2, vitest 4.1.6.

---

## G3 — the `no-console` disable

### Reproduction

`packages/api/__tests__/ai/features/recipe-extraction/cook-payload.test.ts:619`
carried `// eslint-disable-next-line no-console` above a `console.log` of the
D-27-W3-07 measurement report.

```
$ pnpm exec eslint --flag unstable_native_nodejs_ts_config \
    __tests__/ai/features/recipe-extraction/cook-payload.test.ts
0:0  warning  File ignored because of a matching ignore pattern.
✖ 1 problem (0 errors, 1 warning)
```

### Root cause

**The disable directive suppressed nothing.** `tooling/eslint/base.ts:50-62`
ignores `**/__tests__/**`, `**/*.test.ts`, `**/*.test.tsx`, `**/*.spec.ts`
repo-wide, so ESLint never lints this file at all. `no-console` is additionally
only `"warn"` (`base.ts:100`) and no lint script passes `--max-warnings`. So the
comment was pure noise whose only effect was to imply to a reader that
`no-console` is in force inside tests, which it is not.

### The fix, and why it is not a bandaid

The measurement itself is **not** leftover debugging: the file's own docblock
justifies it — "unit differences are accepted and REPORTED, because that report is
the evidence for whether W0's unit-vocabulary work must land before W5" — and W5
is not started (§15.5/§15.7). So deleting the report would have removed a
deliberate evidence channel; adding a second disable would have been a bandaid.

Instead the report moves onto **`TestContext.annotate`**, Vitest 4's own reporting
channel. The measurement is attached to the test result that produced it rather
than written to process stdout, so there is no `console` call and therefore
nothing to suppress. The non-vacuity assertion
(`expect(report).toHaveLength(fixtures.length)`) is unchanged.

### Evidence

- 25/25 tests pass before and after.
- `--reporter=verbose` renders the annotation under the test that produced it
  (`↳ D-27-W3-07 MEASUREMENT` followed by the five fixtures' unit differences).
- The file now contains **zero** `eslint-disable` directives (`grep -c` = 0).
- Prettier clean.

### Decisions taken

- **Honest limitation, verified rather than claimed:** the *default* reporter
  hides annotations for a passing test — exactly as it already hid the
  `console.log`. So this is parity on the default reporter and a strict gain on
  `--reporter=verbose`; it is **not** a new always-visible channel.
- `--reporter=json` (jest-compatible) does **not** carry annotations
  (`total annotations: 0` when probed). The in-code comment was corrected to claim
  only what was measured.

---

## G1 — the flaky `migrate-gallery-images` test

### Reproduction (BEFORE the fix)

The "hardcoded 5 000 ms timeout" is **vitest's default `testTimeout`** —
`packages/api/vitest.config.ts` sets no `testTimeout`, so the default applies.

Isolated, idle box:

```
✓ skips recipe and gallery URL rewrites when referenced files are missing  2747ms
✓ rewrites old URLs when the referenced files exist on disk                199ms
```

**2 747 ms against a 5 000 ms budget = 1.8x of headroom.**

Full `@norish/api` suite (408 tests, 30 files), idle, 5 consecutive runs — all
green, the flaky test at **2 098 / 2 400 / 2 625 / 2 703 / 3 030 ms**.

Under contention manufactured with §13.1's methodology (eight busy-loop spinners
on 4 cores), 3 consecutive full runs:

| run | result | flaky test |
|---|---|---|
| 1 | **exit 1** — 4 failed / 404 passed | `× ... 6035ms` → `Test timed out in 5000ms` (and the sibling at `5090ms`) |
| 2 | **exit 1** — 2 failed / 406 passed | `× ... 5159ms` → `Test timed out in 5000ms` |
| 3 | **exit 1** — 2 failed / 406 passed | `× ... 5300ms` → `Test timed out in 5000ms` (and the sibling at `5054ms`) |

**3/3 reproduced**, exactly the signature VERIFY-3 recorded.

### Root cause

The subject was `await import()`ed **inside each test**, behind
`vi.resetModules()` and a per-test `vi.doMock` of the uploads directory (needed
because the subject freezes `RECIPES_DIR = join(SERVER_CONFIG.UPLOADS_DIR,
"recipes")` at module load). That charged the transform + evaluation of the whole
`@norish/db/repositories/recipes` graph to the **per-test wall budget**.

Measured attribution, with two throwaway probe files (created, measured, deleted;
`git status` clean afterwards):

| what was imported | cold import cost |
|---|---:|
| the subject with `@norish/db/drizzle` + `@norish/db/schema` mocked (the file's actual shape) | **1 833 ms** |
| the subject with the `@norish/db/repositories/recipes` seam mocked instead | **196 ms** |

So ~1.8 s of the 2.7 s was module loading, and the 199 ms second test is
re-*evaluation* only (Vite's transform cache warm, `vi.resetModules()` forcing a
fresh evaluate). **Nothing in this file asserts anything about time.** The 5 000 ms
was bounding module loading, not the URL-rewrite contract — the same
wall-clock-under-contention disease D-27-W3B-03a diagnosed for the parse bound
(§13) and §15.3 for the pool's latency assertion, at *worse* headroom than either
(1.8x here vs §15.3's already-insufficient 5.9x), on a quantity §13.1 measured
inflating **7.5x–11.6x** under host load.

### The fix, and why it is not a bandaid

Raising 5 000 → 10 000 ms would have picked a different point on the same axis;
observed inflation here was already 2.2x (2 747 → 6 035 ms) and §13.1's ceiling is
11.6x. **The load-dependent quantity leaves the bounded region instead of getting
a larger bound** — §13's cure, applied literally:

- the subject is imported **once, at file scope**, via a top-level `await import`.
  That runs during file **COLLECTION**, which neither `testTimeout` nor
  `hookTimeout` bounds — so the cost is not merely moved to a bigger budget, it is
  moved out of every budget, and paid once instead of twice;
- the uploads dir is therefore created **synchronously** (`mkdtempSync`) before the
  import, which lets the `SERVER_CONFIG` mock be a static `vi.mock` — placed after
  the dir's declaration, so the hoisted factory body runs on the `await import`
  below it and there is no temporal-dead-zone hazard;
- `vi.resetModules()` and the per-test `vi.doMock`/`doUnmock` go with it. The
  subject's only module state is the frozen `RECIPES_DIR`; `beforeEach` re-creates
  an empty `<uploadsDir>/recipes`, the only state either test reads;
- `afterEach`'s `fs.rm` becomes `afterAll`.

**Every mock seam and every assertion is byte-for-byte unchanged.** The
`@norish/db/drizzle` + `@norish/db/schema` seam was deliberately *kept* even
though moving to the `@norish/db/repositories/recipes` seam would have been the
repo's dominant convention (20+ files mock the repository layer; the drizzle seam
otherwise appears only in `packages/db/__tests__/server/db/repositories/*`, i.e.
tests *of* the repositories) and would have cut the import cost 9.4x on its own.
It was rejected because it would have dropped the incidental coverage that
`updateRecipeImageUrl`/`updateGalleryImageUrl` write `{image}` to `recipes` /
`recipe_images` — a coverage trade this fix does not need to make. **No coverage
was traded.**

The rule is written into the file's own docblock, with the measurement and the
reason, so it cannot be silently re-nested (§15.3's convention).

### Evidence (AFTER)

Isolated:

```
✓ skips recipe and gallery URL rewrites when referenced files are missing  14ms
✓ rewrites old URLs when the referenced files exist on disk                 7ms
```

**2 747 ms → 14 ms and 199 ms → 7 ms. Headroom 1.8x → 357x.**

Five consecutive full `@norish/api` runs under the **identical eight-spinner
load** that produced 3/3 failures before:

| run | result | flaky test | `Test timed out` count |
|---|---|---|---:|
| 1 | 408 passed | 120 ms / 19 ms | **0** |
| 2 | 408 passed | 35 ms / 9 ms | **0** |
| 3 | 408 passed | 69 ms / 22 ms | **0** |
| 4 | 2 failed / 406 — **a different file, see below** | 76 ms / 38 ms | 2 (not this file) |
| 5 | 408 passed | 100 ms / 27 ms | **0** |

**0 timeouts on this file in 5/5 contended runs.** Three consecutive *uncontended*
full runs: 408/408, 30/30 files, flaky test at 56/48, 20/10, 19/9 ms.

Not vacuous — two mutations of the subject, each executed and RED, each reverted
**by reverse edit** and never committed:

| mutation | result |
|---|---|
| `if (false && !(await canRewriteThumbnailUrl(...)))` — defeat the on-disk guard | test 1 **RED**: `expected [ { …(2) } ] to deeply equal []`; test 2 still green |
| `` const newUrl = `/recipes/${record.id}/WRONG/${filename}` `` | test 2 **RED**: `expected [ { …(2) }, { …(2) } ] to deeply equal [ { …(2) }, { …(2) } ]`; test 1 still green |

Revert verified three ways: `md5sum -c` **OK**, `cmp` against a pre-mutation copy
**IDENTICAL**, `git diff -- packages/api/src/startup/migrate-gallery-images.ts`
**empty**.

Isolation re-proved, because the two tests now share one uploads dir: each passes
alone under `-t`, and 3/3 `--sequence.shuffle` runs are green.

`/tmp` leaves **0** `norish-migrate-images-*` directories behind (`afterAll` works).

### Decisions taken

- **Out of scope, pre-existing, and recorded rather than fixed:**
  `packages/api/__tests__/server/parser/import-flow.test.ts` has **the same
  disease** on a hardcoded 15 000 ms timeout — 2 742 ms isolated = **5.5x**
  headroom, and it hit **15 125 ms** under the eight-spinner load. It failed in the
  contended **baseline** too (before any change here), so it is not a regression.
  VERIFY-3's gate problem 1 names only `migrate-gallery-images.test.ts`; expanding
  is the director's call. It is the run-4 failure in the table above.

---

## G2 — the red `pnpm typecheck`

### Reproduction

`pnpm typecheck` → **EXIT 1**, `Tasks: 14 successful, 15 total`,
`Failed: @norish/shared-react#typecheck`.

```
packages/shared-react (2 errors, both in ../../node_modules/@norish/shared/src/lib/auth/client.ts):
  (12,7) TS2322  Property 'apiKey' is missing … but required in type '{ apiKey: unknown; }'
  (13,13) TS2322 … Type 'import(".../node_modules/@norish/shared/node_modules/better-auth/
                       node_modules/@better-auth/core/dist/types/plugin").HookEndpointContext'
                   is not assignable to type
                   'import(".../node_modules/@better-auth/core/dist/types/plugin").HookEndpointContext'
```

`apps/web` and `apps/mobile` **never ran** — they sit behind `shared-react` in
turbo's `^typecheck` graph, which is why the aggregate showed 15 tasks and not 17.
Run directly:

```
apps/mobile (2 errors):
  src/lib/query-cache/create-persisted-query-client.ts(52,5) and (66,9)  TS2322
    'node_modules/@tanstack/query-core/…QueryClient' is not assignable to
    'node_modules/@tanstack/query-persist-client-core/node_modules/@tanstack/query-core/…QueryClient'
    Property '#private' … refers to a different member
```

Both are the same shape: two nominally distinct classes from two copies of one
package.

### Root cause — TWO different causes, measured separately

A lockfile reachability analysis (BFS from every importer over `snapshots`) and a
version census of every on-disk copy separated them:

**1. `@tanstack/query-core` — a real, unavoidable lockfile duplicate.**
`@tanstack/query-persist-client-core@5.100.10` (pulled by `apps/mobile` at
`^5.100.8`) declares `"@tanstack/query-core": "5.100.10"` — an **exact pin**, not a
range. No amount of re-resolution can collapse it onto the root `5.100.11` (which
the existing `@tanstack/react-query: 5.100.11` override forces). **This one needs
an override.**

**2. The whole `better-auth` family — lockfile STALENESS, not a resolution
requirement.** The `packages/shared` *importer* entry already said `better-auth`
`catalog:` → `1.6.9`, but all **nine** `@norish/shared@file:packages/shared(...)`
**injected** snapshots still pinned `better-auth: 1.5.4` and
`@better-auth/api-key: 1.5.4`. That subtree is reachable from `apps/web`,
`apps/mobile`, `packages/api`, `packages/db` and `packages/shared-react`, and it
materialised on disk as `node_modules/@norish/shared/node_modules/better-auth@1.5.4`
→ `.../node_modules/@better-auth/core@1.5.4`, i.e. exactly the second class in the
error. pnpm itself was flagging it: `✕ unmet peer @better-auth/core@1.5.4: found
1.6.9` under `@norish/shared`.

**Proven by experiment, not assumed:** with **no override at all**, a plain
`pnpm install --lockfile-only` refresh removes **all 12** of those duplicates.

### The fix, and why it is not a bandaid

No `--noCheck`, no cast, no `as any`/`@ts-ignore`/`@ts-expect-error`, no type
widening — the two red packages keep their `--noCheck` OFF and now genuinely pass.
`packages/shared-react/src/providers/trpc-links.ts:216`'s pre-existing
`TRPCLink<any>` was left alone and nothing here depends on it.

**One line of manifest change:** `"@tanstack/query-core": 5.100.11` added to
`pnpm-workspace.yaml`'s `overrides:` block. No `better-auth` override was added —
one that merely restates the catalog's `1.6.9` would be a second source of truth
and a live drift hazard (bump the catalog, forget the override, and the override
silently wins). VERIFY-3's "a `pnpm.overrides` entry to dedupe **both** packages"
is therefore implemented as one override plus a lockfile refresh, which is what
the measurement supports.

### ⚠ WHERE THE OVERRIDE GOES — VERIFY-3's prescription was wrong for this repo

VERIFY-3 said root `package.json`'s `pnpm.overrides`. **Measured:
`package.json#pnpm.overrides` REPLACES `pnpm-workspace.yaml#overrides`.** Adding
one entry to `package.json` and refreshing the lockfile dropped **all five**
existing overrides from the lockfile's `overrides:` block:

```
 overrides:
-  '@tanstack/react-query': 5.100.11
-  '@trpc/client': 11.17.0
-  '@trpc/server': 11.17.0
-  '@trpc/tanstack-react-query': 11.17.0
-  zod: 4.4.2
+  '@tanstack/query-core': 5.100.11
```

The resolved versions happened not to move (the catalog pins the same numbers), but
the *override* — which forces every **transitive** consumer onto that version, not
just workspace packages that write `catalog:` — was gone. That is precisely the
unintended drift this change was told to prevent. Reverted, byte-identity
confirmed (`md5sum -c`: all three manifests OK), and the entry placed in
`pnpm-workspace.yaml` beside the existing five.

**Corollary the director should know:** root `package.json` also carries
`pnpm.onlyBuiltDependencies` (`heroui-pro`, `@heroui-pro/react`,
`heroui-native-pro`) while `pnpm-workspace.yaml` carries a **different**
`onlyBuiltDependencies` (`@tailwindcss/oxide`, `@heroui/shared-utils`, `esbuild`,
`ffmpeg-static`, `sharp`, `unrs-resolver`). If the same precedence applies to that
key as it demonstrably does to `overrides`, the `pnpm-workspace.yaml` list is
currently being **ignored**. **This was NOT verified** (it cannot be without a real
install) and NOT changed — flagged as a suspicion, not a finding.

### How the install was performed — and what was refused

Investigated before running anything:

- `.npmrc` = `node-linker=hoisted`; `pnpm-workspace.yaml` = `nodeLinker: hoisted`
  + `injectWorkspacePackages: true`.
- **`node_modules/.modules.yaml` does not exist.** That is *why* a plain
  `pnpm install` aborts with `ERR_PNPM_ABORTED_REMOVE_MODULES_DIR_NO_TTY`: pnpm
  cannot recognise the tree as its own and wants to purge it.
- **`node_modules` has 1 105 root-owned top-level entries** (vs 909 mine), all
  `drwxr-xr-x root:root`, and I am `claude` (uid 1000) with **no usable sudo**
  (`sudo -n` → "a password is required"). Deleting inside a root-owned directory
  requires write permission on *that* directory, so a purge would fail EPERM
  **partway** — the unrecoverable outcome. `rm -rf node_modules`, `sudo` and
  `--force` were therefore never used.
- `pnpm-workspace.yaml` itself is `root:root 0644`, so it is not writable by me —
  but `/opt/norish-src` is `claude:claude drwxrwxr-x`, so the file was replaced via
  write-temp + `os.replace` in the directory I own. **Side effect recorded: the
  file's owner changed `root:root` → `claude:claude`, mode unchanged (0644).**
  Content is what git tracks; recovery is `git checkout`.

**The mechanism chosen: `pnpm install --lockfile-only`.** Proven safe before use —
run on the *unchanged* tree it exits 0 in 1.2 s, leaves `pnpm-lock.yaml`
**byte-identical** (`md5sum -c` OK) and does not create `.modules.yaml` or touch
any package directory. It updates only the lockfile.

### The lockfile delta, enumerated

`pnpm-lock.yaml`: **270 insertions / 597 deletions** — a net shrink, because
duplicate subtrees collapse. Computed by parsing both lockfiles and diffing the
`name → {versions}` map:

| category | count | detail |
|---|---:|---|
| **duplicate resolved** | **13** | `better-auth` `[1.5.4,1.6.9] → 1.6.9`; `@better-auth/api-key`, `@better-auth/core`, `@better-auth/drizzle-adapter`, `@better-auth/kysely-adapter`, `@better-auth/memory-adapter`, `@better-auth/mongo-adapter`, `@better-auth/prisma-adapter`, `@better-auth/telemetry` all `[1.5.4,1.6.9] → 1.6.9`; `@better-auth/utils` `[0.3.1,0.4.0] → 0.4.0`; `better-call` `[1.3.2,1.3.5] → 1.3.5`; `defu` `[6.1.4,6.1.7] → 6.1.7`; `@tanstack/query-core` `[5.100.10,5.100.11] → 5.100.11` |
| **version changed** | **0** | — |
| **package added** | **0** | — |
| **package removed** | **0** | — |
| **duplicate introduced** | **0** | — |
| **importer resolution drift** | **1** | `packages/shared-react` → `@norish/shared`: `file:packages/shared(5feaa770…)` → `link:../shared` |

**Every surviving version is the version that was already at the root.** No major
or minor drift rode along; every other package stayed exactly where it was.

The single importer change is a *simplification*: with the duplicate gone,
`shared-react`'s peer context for `@norish/shared` no longer differs from the plain
link, so pnpm stops injecting a separate copy for it — putting it alongside
`@norish/config` and `@norish/i18n`, which were already `link:` there. Counted
across all 11 injected workspace packages, this is the only `file:`↔`link:` change
(`shared` 16 `file:` → 15 `file:` + 1 `link:`; every other package unchanged).

**Rejected as worse:** an earlier attempt with three overrides
(`better-auth`, `@better-auth/api-key`, `@tanstack/query-core`) deduped the same 13
packages but added **7 extra importer specifier changes** (`catalog:` → a literal
`1.6.9`) because the overrides shadowed the catalog. The single-override version
produces a strictly smaller, cleaner delta for the same result.

### Materializing it on disk — the least destructive mechanism found

`--lockfile-only` deliberately does not touch `node_modules`, so the two duplicate
*shadows* had to be removed by hand for `tsc` to see one copy. A dedupe under the
hoisted linker is exactly "delete the nested copy so resolution falls through to
the hoisted root one", so both operations reproduce what a deduped install
materializes. **Recovery was established and rehearsed before each one.**

**M1 — `better-auth` family.** `node_modules/@norish/shared/node_modules/` is
`claude:claude`, so its entries are removable.

- Backup: `tar -czf /tmp/g2-backup/norish-shared-nm.tgz` (1.3 MB, 4 153 entries).
- **Recovery rehearsed first:** extracted to a scratch dir; listing `diff` clean and
  the md5-of-all-file-md5s identical (`f6adfa04140bb11cff9effe1e6cad541`).
- Removed `better-auth`, `@better-auth`, `better-call`, `defu`; kept `@norish`
  (the `config` / `tsconfig` symlinks). → `shared-react` `tsc` **EXIT 0**.

**M2 — `@tanstack/query-core`.** The whole chain
`node_modules/@tanstack/…/query-persist-client-core/node_modules/@tanstack/query-core`
is `root:root`, so nothing inside it can be removed or renamed. The *only*
permitted operation is at the `node_modules/@tanstack` level (renaming within
`node_modules`, which I own).

- A cross-parent `mv` of the root-owned dir was tried first and **denied**
  (`Permission denied`) — moving a directory to a new parent needs write permission
  on the directory itself. Verified nothing was mutated: 1 052-file md5 set and
  1 102-entry listing both identical to the pre-attempt snapshot.
- **Recovery rehearsed:** a same-parent rename round-trip (`@tanstack` →
  `.g2-rehearse-tanstack` → `@tanstack`) is permitted and content-identical. A
  second recovery path exists as a verified-identical `cp -a` backup at
  `/home/claude/g2-quarantine/tanstack-backup`.
- Then: `cp -a` to a `claude`-owned copy → `rm -rf`
  `query-persist-client-core/node_modules` **in the copy** → two same-parent
  renames to swap it in. The swapped tree is byte-identical to the original except
  the removed nested duplicate. → `apps/mobile` `tsc` **EXIT 0**.

### Adversarial verification of G2

| # | weakening | result |
|---|---|---|
| A1 | swap the duplicate `@tanstack` tree back in | `apps/mobile` `tsc` **EXIT 1, exactly the 2 original errors**; swapping the deduped tree back → **EXIT 0, zero output** |
| A2 | restore `better-auth@1.5.4` from the tarball into `@norish/shared/node_modules` | `shared-react` `tsc` **EXIT 1, exactly the 2 original errors**; removing again → **EXIT 0, zero output** |
| B | remove the `@tanstack/query-core` override and refresh the lockfile | `@tanstack/query-core@5.100.10` **returns** (2 occurrences) — the override is load-bearing. `better-auth@1.5.4` does **not** return — which is what established cause 2 as staleness rather than a resolution requirement. Override re-added; final lockfile regenerated. |

None committed; the tree is clean and the final state was re-verified after each
round-trip.

### Known residue, stated rather than hidden

1. **`node_modules/.g2-quarantine-tanstack-with-dup/` (4.2 MB) cannot be
   deleted** — it is the original root-owned `@tanstack` tree, and removing it
   needs root. It is dot-prefixed, so Node/TS/pnpm/eslint never resolve into it
   (`require.resolve('@tanstack/query-core', {paths:['apps/mobile']})` →
   `node_modules/@tanstack/query-core` @ `5.100.11`). It disappears on the next real
   install. **It is the one piece of cruft this pass leaves behind.**
2. **`node_modules/.norish-injected/shared/node_modules/` still holds the stale
   1.5.4 copies** — `root:root`, not removable. Verified unreachable: no symlink
   anywhere in the tree points into `.norish-injected/shared`, and it has a
   different inode set from `node_modules/@norish/shared`.
3. **`node_modules` still does not match the lockfile in unrelated places** (e.g.
   `node_modules/h3/node_modules/defu@6.1.4`,
   `node_modules/better-auth/node_modules/defu@6.1.4`, both root-owned). That drift
   is pre-existing, out of scope, and untouched. The materialization here was
   deliberately limited to the two shadows that produce the four type errors.
4. **`pnpm-workspace.yaml` is now `claude:claude`** instead of `root:root` (see
   above).

### Decisions taken

1. Override in `pnpm-workspace.yaml`, **not** root `package.json`, against
   VERIFY-3's literal wording — because `package.json` silently deletes the five
   existing overrides (measured).
2. **One** override, not three — `better-auth`/`@better-auth/api-key` were
   demonstrated unnecessary, and a redundant override shadowing the catalog is a
   drift hazard.
3. `--lockfile-only` for the lockfile, hand-surgery for the two shadows. A purging
   install was refused: no `.modules.yaml`, 1 105 root-owned subtrees, no sudo →
   a purge fails partway and is unrecoverable, which the brief ranks strictly worse
   than a red gate.
4. The lockfile diff is large **and expected** — it is the dedupe, and it is
   enumerated above line by category.

---

## What this pass did NOT do

- Nothing pushed, nothing built into an image, nothing deployed; docker, the live
  stack and the live DB untouched. DB stays at **42**.
- None of VERIFY-3's **six open blockers** addressed.
- `trpc-links.ts:216`'s pre-existing `TRPCLink<any>` widening left alone
  (explicitly out of scope).
- `import-flow.test.ts`'s 15 000 ms flake (same class as G1) left alone —
  pre-existing, outside gate problem 1's stated scope, and it fails in the
  contended baseline too.
- The 5 remaining `--noCheck` flags, `packages/trpc`'s missing `--noEmit` and its
  destructive `rm -rf dist .cache`, and the other queued follow-ups untouched.
- `pnpm i18n:check` (EXIT 1) and `pnpm format:check` (EXIT 1) left at their
  documented baselines; neither made worse.
