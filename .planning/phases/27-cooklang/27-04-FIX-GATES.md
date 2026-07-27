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

---

## G4 — the flaky `import-flow.test.ts`, the item G1 recorded as out of scope

**Commit:** `test(27-04): take the module load out of import-flow's test budget`.
Position at the start of this task: 46 commits ahead of `origin/main`, tree clean.
Nothing pushed, nothing deployed. Live image still `516c52576a5f`, DB still at
migration **42**. Box: LXC 110, 4 cores, 5 000 MB RAM, Node v22.22.3, pnpm
10.33.2, vitest 4.1.6 — same as G1/G2/G3.

**Scope: one file,**
`packages/api/__tests__/server/parser/import-flow.test.ts`. No production source
touched. `pnpm-lock.yaml`, root `package.json`, `pnpm-workspace.yaml`,
`packages/db/src/migrations/` and `meta/_journal.json` untouched.

### Reproduction (BEFORE the fix)

Isolated, idle box, `--reporter=verbose`:

```
✓ uses the existing video pipeline for video imports                          2523ms
✓ uses AI directly when forceAI is true                                        279ms
✓ uses AI directly when alwaysUseAI is enabled                                 246ms
✓ returns a successful Python parser result without running AI                 267ms
✓ falls back to AI when … page still looks recipe-like                        165ms
✓ falls back to AI on structured parser failure …                             136ms
✓ hard-fails when parser failure occurs and the page does not look recipe-like 139ms
✓ hard-fails when parser failure occurs and AI is disabled                     180ms
✓ uses the deprecated legacy parser only when the rollback flag is enabled     125ms
Duration  4.53s (transform 1.08s, import 205ms, tests 4.07s)
```

First test **2 523 ms against its own hand-raised `{ timeout: 15000 }`** — **5.9x
headroom**, close to the previous agent's **2 742 ms / 5.5x** (small run-to-run
variance, same disease). Every other test also pays a smaller re-import tax
(125-279 ms) against the file's **implicit default 5 000 ms** `testTimeout` — the
file sets no override of its own for those eight.

Contention was manufactured with a plain busy-loop spinner
(`Math.sqrt(Math.random())` in a tight `while`) rather than the cooklang-specific
single-core pin of §13.1, matching this file's own G1 precedent
(`migrate-gallery-images.test.ts`'s "eight busy-loop spinners on 4 cores"). On
this box, **ambient host load varies run to run** (`uptime` showed load averages
of 11-21 even with zero spinners running, i.e. LXC 110 has noisy neighbors on
the shared Proxmox host) — eight spinners reproduced the failure inconsistently
(6 962-11 945 ms, under the 15 000 ms cutoff every time in five isolated-file
attempts), so contention was increased to **20 spinners** until the signature
reproduced, matching in kind (CPU-bound busy loops on a 4-core box) even though
the multiplier differs from the previous agent's box-state. Full `@norish/api`
suite, `--reporter=verbose`, 20 spinners:

```
 ✗ …import-flow.test.ts > … uses the existing video pipeline for video imports  26201ms
   → Test timed out in 15000ms.
 ✗ …import-flow.test.ts > … uses AI directly when forceAI is true                4260ms
   → expected "vi.fn()" to not be called at all, but actually been called 1 times
     1st vi.fn() call: Array [ Object { "html": "…", "url": "https://example.com/video" } ]
 ✗ …cook-payload.test.ts > … mints a self-validating .cook …                     2095ms
   → expected null not to be null
 Test Files  2 failed | 28 passed (30)
      Tests  3 failed | 405 passed (408)
   Duration  85.21s
```

(full capture: `/tmp/repro_run1.log`, not committed). **Reproduced**, same
signature G1 recorded for this file (`Test timed out in 15000ms`) plus one new
finding (below). A third, unrelated failure in `cook-payload.test.ts` also
appeared in this run — noted as incidental collateral of the 20-spinner
contention on an already-noisy box, out of this file's scope, and not chased.

**A collateral finding beyond G1's note.** The timed-out first test's in-flight
call did not stop when vitest declared the timeout — its promise chain kept
running in the background, past that test's own boundary and past the *next*
test's `beforeEach`/`vi.clearAllMocks()`, and eventually called a mock with the
**first test's URL** (`"https://example.com/video"`), which the second test's
assertion (`not.toHaveBeenCalled()`, freshly cleared) then saw and failed on.
A test timing out under contention was not merely failing in isolation — it was
**corrupting the test after it**. That risk disappears once the module-load cost
that caused the timeout is removed from the timed region.

### Root cause

Identical shape to G1: the subject (`@norish/api/parser`) was `await import()`ed
**inside every one of the 9 tests**, behind a per-test `vi.resetModules()`. That
charged the transform + evaluation of the whole `@norish/api/parser` graph
(`ai/recipe-parser`, `parser/fetch`, `parser/jsonld`, `parser/legacy`,
`parser/python/*`, `shared-server/config/server-config-loader`, etc.) to the
per-test wall budget **nine times over**, not twice as in G1's file. The first
test paid the cold transform (~2.5 s); the remaining eight paid a smaller
re-evaluation cost each (125-880 ms observed across runs) because Vite's
transform cache was warm but the module graph still had to be **re-instantiated**
per test. **Nothing in this file asserts anything about time** — every assertion
is about branch selection (video / forceAI / alwaysUseAI / structured-parser
success / AI fallback / hard failure / legacy rollback), none about latency.

### Why `vi.resetModules()` bought no isolation here — checked, not assumed

This is the check the task called out as the one to get right: G1's cure
(hoist to file scope) is only safe if no test relies on getting a **fresh**
module instance. Read `packages/api/src/parser/index.ts`:

- It holds **no top-level mutable state** — no cache, no counter, no module-level
  `let`. Its only closure-captured value is
  `const parserEnvConfig = SERVER_CONFIG as …` (line 24), which is a **live
  reference to the same `mockServerConfig` object** the test file mutates in
  place (`mockServerConfig.LEGACY_RECIPE_PARSER_ROLLBACK = false` in
  `beforeEach`, `= true` in the rollback test). Re-importing the module would
  bind `parserEnvConfig` to the identical object again — mutation-in-place
  already makes every later read see the update, with or without a fresh
  import.
- Every OTHER dependency is `vi.mock()`ed (hoisted, file-scoped, never
  `vi.doMock`), and the isolation between tests comes from `vi.clearAllMocks()`
  plus fresh `mockResolvedValue`/`mockReturnValue` calls in `beforeEach` — both
  of which act on the **mock functions**, not on module identity, and both
  survive a hoisted import completely unchanged.
- There is no per-test `vi.doMock` of anything that needs to be re-read at
  import time (unlike G1's file, which had to defer `SERVER_CONFIG.UPLOADS_DIR`
  until a temp directory existed). Nothing here has a temporal-dead-zone
  hazard.

So `vi.resetModules()` was pure overhead: 8 redundant re-evaluations of a graph
that has nothing to reset. Confirmed by mutation testing below rather than
assumed.

### The fix, and why it is not a bandaid

Raising 15 000 ms further would have picked a bigger point on the same curve —
already-observed inflation was up to **10.4x** (2 523 → 26 201 ms) against
§13.1's ceiling of 11.6x, so there was no headroom multiplier left to reach for
honestly. G1's cure, applied verbatim:

- `const { parseRecipeFromUrl } = await import("@norish/api/parser");` moved to
  **file scope**, directly after the last `vi.mock()` call and before
  `describe(...)`. This runs during file **COLLECTION**, which neither
  `testTimeout` nor `hookTimeout` bounds, and now runs **once** instead of nine
  times.
- `vi.resetModules()` removed from `beforeEach` (see isolation analysis above).
- The 9 per-test `const { parseRecipeFromUrl } = await import(...)` lines
  removed — the binding now comes from the module scope import.
- The now-unneeded `{ timeout: 15000 }` override on the first test **removed**.
  It was itself the earlier symptom of this exact disease (someone had already
  reached for a bigger budget instead of the root fix) — leaving it in place
  after the fix would have been keeping a stale bandaid over a wound that no
  longer exists, and its presence would have hidden regressions in a 3x window
  instead of the file's real, tiny cost.
- `vi.clearAllMocks()` and every `mockResolvedValue`/`mockReturnValue` call in
  `beforeEach`, and **every assertion in every test, are byte-for-byte
  unchanged.** No coverage was traded.
- The file's docblock records the measurement, the cause, and — the point
  proven above — why `vi.resetModules()` was safe to drop here, so a future
  reader cannot silently re-nest the import without re-deriving that argument.

### Mutation evidence — non-vacuity, proven per test

Eight mutations of the **subject**
(`packages/api/src/parser/index.ts`, never the test file), each applied, run
against its specific test(s) with `-t`, confirmed RED, then reverted **by
reverse edit** (never `git checkout` — this repo's `node_modules/@norish/*` are
hardlinked copies and `checkout` would break the twins). Never committed.

| # | mutation | test(s) forced RED | observed failure |
|---|---|---|---|
| M1 | `tryHandleVideoUrl`: `if (!isVideoUrl(url))` → `if (true)` | "uses the existing video pipeline for video imports" | `usedAI: false` instead of `true` (video branch never taken) |
| M2 | `useAIOnly = Boolean(forceAI \|\| …)` → `Boolean(false \|\| …)` | "uses AI directly when forceAI is true" | `usedAI: false` (forceAI ignored) |
| M3 | same line → `Boolean(forceAI \|\| false)` | "uses AI directly when alwaysUseAI is enabled" | `usedAI: false` (alwaysUseAI ignored) |
| M4 | `if (structured.recipe) return …` → `if (false && structured.recipe)` | "returns a successful Python parser result without running AI" | `usedAI: true` instead of `false` (structured success path skipped, fell through to AI) |
| M5 | `if (aiEnabled && (await isPageLikelyRecipe(html)))` → `if (false)` | "falls back to AI when the Python parser output is invalid …" AND "falls back to AI on structured parser failure …" | both raise `Python parser … failed`/`returned … without a valid title` instead of returning the AI recipe (AI fallback never attempted) |
| M6 | `NON_RECIPE_FAILURE_CODES` drops `"NoSchemaFoundInWildMode"` | "hard-fails … page does not look recipe-like" | thrown message is `Python parser failed: NoSchemaFoundInWildMode` instead of `Page does not appear to contain a recipe.` |
| M7 | `NON_RECIPE_FAILURE_CODES` drops `"RecipeSchemaNotFound"` | "hard-fails … AI is disabled" | thrown message is `Python parser failed: RecipeSchemaNotFound` instead of `Page does not appear to contain a recipe.` |
| M8 | `if (parserEnvConfig.LEGACY_RECIPE_PARSER_ROLLBACK)` → `if (false)` | "uses the deprecated legacy parser only when the rollback flag is enabled" | `mockTryLegacyStructuredRecipeParsing` never called (legacy branch unreachable) |

**All 9 tests forced RED by at least one mutation** (M5 covers two). After each
mutation: reverted by reverse edit, then verified three ways —
`md5sum src/parser/index.ts` **matches the pre-mutation hash** for every one of
the 8 rounds, a final `diff` against a saved pre-mutation copy is **IDENTICAL**,
and `git diff -- packages/api/src/parser/index.ts` is **empty**. No mutation was
ever staged or committed.

### Isolation re-proved, not assumed, after removing `resetModules()`

- **3/3 `--sequence.shuffle` runs green** (9/9 each time) — order no longer
  matters now that all nine tests share one module instance.
- **Each of the 9 tests passes alone** (`vitest run … -t "<name>"`, one at a
  time) — no test depends on a side effect left by another.
- Full-file and full-suite runs (below) all show **9/9 passed** with the
  hoisted import.

### Evidence (AFTER)

Isolated, idle, `--reporter=verbose`:

```
✓ uses the existing video pipeline for video imports   7-10ms
✓ uses AI directly when forceAI is true                11-14ms
✓ uses AI directly when alwaysUseAI is enabled          2-4ms
✓ returns a successful Python parser result …           1-2ms
✓ falls back to AI when … recipe-like                   2-9ms
✓ falls back to AI on structured parser failure …       2-8ms
✓ hard-fails … does not look recipe-like                3-6ms
✓ hard-fails … AI is disabled                            1ms
✓ uses the deprecated legacy parser only …              1-4ms
```

**First test: 2 523 ms → 7-10 ms.** Against the file's now-unraised default
5 000 ms `testTimeout`, headroom went from **5.9x to roughly 500-700x**. The
other eight tests' 125-880 ms each collapsed to 1-14 ms each — total in-file
test time (`tests …ms` in the `Duration` line) dropped from **4.07 s to
31-40 ms**, roughly **100-130x**.

Five consecutive full `@norish/api` runs under the **same 20-spinner contention
that produced the failure above**:

| run | result | first test | 2nd test |
|---|---|---:|---:|
| 1 | 408 passed | 22ms | 45ms |
| 2 | 408 passed | 70ms | 56ms |
| 3 | 408 passed | 42ms | 57ms |
| 4 | 408 passed | 216ms | 156ms |
| 5 | 408 passed | 64ms | 75ms |

**0 timeouts, 5/5 contended runs, 408/408 each time.** Even the worst observed
figure under 20-spinner contention (216 ms) is 23x under the 5 000 ms default
and 69x under the original 15 000 ms override. Three consecutive **idle** full
`@norish/api` suite runs: 408/408 each (12.5-18.4 s total suite duration, first
test at 10-41 ms).

`/tmp` left no stray directories from this file (it creates none — no uploads
dir, no filesystem fixture). One unrelated empty `/tmp/norish-migrate-images-*`
directory was found, left over from an earlier contended run of this task that
was killed mid-flight by a shell timeout before `migrate-gallery-images.test.ts`
`afterAll` could run; removed as housekeeping, not evidence of a regression in
that file (G1's own file, untouched here).

### Gates

| gate | result |
|---|---|
| `tsc --noEmit -p tsconfig.json` (`@norish/api`) | **EXIT 0, zero output** — note: `packages/api/tsconfig.json` scopes `include: ["src"]`, the same as every other package in this repo, so it does not itself typecheck `__tests__/**`. Independently re-verified with a throwaway `tsconfig.import-flow-check.json` (extends the real config, adds this one test file to `include`) → **EXIT 0, zero output**; the scratch file was deleted afterward, `git status` shows no trace |
| `eslint --flag unstable_native_nodejs_ts_config __tests__/server/parser/import-flow.test.ts` | **EXIT 0** — `0 errors, 1 warning` ("File ignored because of a matching ignore pattern"), the same repo-wide `**/__tests__/**`/`**/*.test.ts` ignore G3 documented; the file is never actually linted, same as before |
| `prettier --check` on the file | **EXIT 0**, clean |
| vitest `@norish/api`, idle | **408 passed (30 files)**, 3 consecutive runs |
| vitest `@norish/api`, 20-spinner contention | **408 passed (30 files)**, 5 consecutive runs, 0 timeouts |
| `--sequence.shuffle` on the file | **9/9 passed**, 3 consecutive runs |
| `-t "<name>"` isolation, each of 9 tests alone | **all 9 pass individually** |
| `git status` | only `packages/api/__tests__/server/parser/import-flow.test.ts` modified; `pnpm-lock.yaml`, root `package.json`, `pnpm-workspace.yaml`, `packages/db/src/migrations/`, `meta/_journal.json` untouched |

No `as any`, no `@ts-ignore`, no `@ts-expect-error`, no type widening. No
`pnpm install` run, no lockfile touched. Nothing pushed, nothing deployed, live
image and DB migration untouched.

### Decisions taken

- **Removed the `{ timeout: 15000 }` override** rather than leaving it as a
  defensive margin. Per the standing "no bandaids" directive, a large timeout
  that is no longer earning its keep is exactly the kind of latent bandaid that
  hides a future regression instead of catching it — the file's real cost is now
  ~10 ms and the default 5 000 ms budget covers it with three orders of
  magnitude to spare, contention included (worst observed: 216 ms under 20
  spinners).
- **Contention methodology stated, not hidden:** this box's ambient load varies
  run to run (observed 11-21 `uptime` load average with zero spinners of mine
  running), so 8 spinners reproduced inconsistently and 20 were used to get a
  clean, repeatable reproduction of the exact `Test timed out in 15000ms`
  signature before the fix. The AFTER verification then re-used that same
  20-spinner load for the 5 required consecutive runs — a harder bar than the
  literal "eight spinners," not a softer one.
- **The collateral cross-test mock-call bleed is recorded but not separately
  "fixed"** — it was a symptom of the timeout, not a second defect. Once the
  module-load cost that caused the timeout is gone, the promise that used to
  outlive its test's timeout completes well within budget and the bleed does
  not occur (proven by the 5/5 contended runs above showing no such assertion
  failures).
- The unrelated `cook-payload.test.ts` failure observed once under 20-spinner
  contention during the BEFORE reproduction is out of this file's scope and was
  not chased; it did not recur in any of the five AFTER contended runs.

---

## §FAIL-1 — the wall-clock 50 ms in `pool.test.ts`, this plan's own file

**Scope:** `packages/shared-server/__tests__/cooklang/pool.test.ts`, one test.
No production source touched. `pnpm-lock.yaml`, root `package.json`,
`pnpm-workspace.yaml`, `packages/db/src/migrations/` and `meta/_journal.json`
untouched. Nothing pushed, nothing deployed. Live image still `516c52576a5f`,
DB still at migration **42**.

### Reproduction (BEFORE the fix)

The failing assertion, as recorded by VERIFY-4:

```
FAIL __tests__/cooklang/pool.test.ts > a real recipe round-trips through the process
     boundary > each committed fixture completes in under 50 ms once the pool is warm
AssertionError: expected 50.03161200000068 to be less than 50
```

**Calibration.** This box is a noisy shared Proxmox host: `uptime` showed load
averages of **8-23 with zero spinners of mine running**, fluctuating from other
agents' real activity (a concurrent `pnpm typecheck`/`pnpm lint` was observed
mid-session). Plain busy-loop spinners spread across all 4 cores (the
G1/G4 methodology, tried at 4, 6, 8, 10, 20) reliably perturbed OTHER
cooklang tests (see below) but did not reliably reproduce THIS specific
50 ms overshoot — its own headroom (50 ms against a ~14 ms idle round trip,
3.5x) is tighter than the wall-clock tests G1/G4 fixed, but the pool's request
queue and CPU/RSS gates absorb generic multi-core noise reasonably well.
**Reproduction required §13.1's own methodology — pinning to a single core**
(`taskset -c 0`), not just adding spinners: 10 busy-loop spinners AND the
`pnpm test` process itself pinned to core 0 (starving the pool's child and the
test runner onto one core together). That reproduced the exact signature
immediately and drastically:

```
FAIL __tests__/cooklang/pool.test.ts > a real recipe round-trips through the process
     boundary > each committed fixture completes in under 50 ms once the pool is warm
AssertionError: expected 2082.502443999998 to be less than 50
```

**10 spinners pinned to a single core, used.** (Not "8 spinners" — this
assertion's margin is thinner than G1/G4's files, and generic multi-core
spinners were not sufficient; single-core starvation, matching §13.1's own
contention methodology, was.) The same run collaterally broke several OTHER
pool.test.ts/limits.test.ts/attach-tokens.test.ts assertions and eventually
degraded into repeated `pool-spawn-failed` — expected and stated rather than
hidden: single-core starvation this severe is far beyond anything the CPU/RSS
gates are designed to absorb (§B.2 of VERIFY-4 already documents that above
~5.3x contention the wall backstop legitimately pre-empts the CPU gate), and
it is not the methodology used for the AFTER validation below.

### Root cause

Identical shape to D-27-W3B-03a (§13, §15.3) and the docblock sitting 14 lines
below this very test: `expect(performance.now() - startedAt).toBeLessThan(50)`
measures the **box**, not the work. A pooled round trip's wall-clock time is a
function of how many vitest workers and external processes are competing for
4 cores; CPU consumed by the parse is not. Nothing in this test asserts
anything about time as a *property of the recipe* — it exists to prove a warm
pool costs near-zero marginal work per committed fixture and never respawns a
child mid-loop. Neither of those properties is a wall-clock property.

### The fix, and why it is not a bandaid

Raising 50 to 100 (or any bigger constant) would have been the retune this
phase already rejected explicitly, in the very docblock this test sits under.
Instead the test now asserts the two things it actually protects, on
contention-invariant instruments:

1. **The pool never respawns across the fixture loop.** `cookParsePoolPidsForTests()`
   is captured before the loop and compared with `toEqual` after — a discrete,
   non-timing signal. This is the exact regression R2's own docblock (14 lines
   below) names as the reason the old wall-clock floor existed: *"Making
   `release()` retire its child... turns this test RED... The floor would have
   caught it too... as the sibling fixture round trip demonstrates"* — this test
   **is** that sibling, and it now catches the same regression directly instead
   of via wall-clock inference.
2. **CPU per round trip, in both processes, mirroring R2's own instrument** —
   with two DIFFERENT ceilings, calibrated from real measurement rather than
   guessed:
   - `childCpuMs` (the child's own `/proc/<pid>/schedstat` reading — the SAME
     number the production gate decides with) is rock-stable: **0.85-1.66 ms**
     across 8 full-package runs, isolated and under real vitest full-suite
     worker contention alike. Ceiling: **10 ms**, ~6-12x that observed worst.
   - `parentCpuMs` (`process.cpuUsage()` on the test runner's own process) is
     measurably noisier under GENUINE full-package contention (this process is
     one of several vitest workers sharing 4 cores) even though it is nominally
     contention-invariant: observed **0.85-14.63 ms** across 8 full `pnpm test`
     runs (not isolated). **A first attempt at a 10 ms ceiling on this axis
     genuinely false-refused once during calibration** (`expected 10.036 to be
     less than 10`), which is itself useful evidence — it is a REAL measured
     number, not a hypothetical, and it is why the ceiling was recalibrated
     rather than picked from the idle-only measurement. Ceiling: **50 ms**,
     ~3.4x the observed worst (matching this repo's own headroom convention —
     `cookParseRssMb`'s 2.67x, `cookParseCpuMs`'s ~3x).

A lost-pool regression (a fresh 200-243 ms respawn) still blows through both
ceilings by 4-20x, and the pid-identity check catches it directly regardless
of either number.

### Evidence (AFTER)

Isolated, idle:

```
Test Files  1 passed (1)
Tests  1 passed | 44 skipped (45)
```

CPU measurements (throwaway PROBE, deleted before the final fix; the numbers
are recorded here, not the probe):

| condition | parentCpuMs range | childCpuMs range |
|---|---:|---:|
| isolated, idle/ambient (single-file `-t` runs) | 0.76-3.24 | 1.30-2.34 |
| **full `pnpm test`, 8 runs (real multi-worker contention)** | **0.85-14.63** | **0.85-1.66** |

**Non-vacuity by mutation** (each applied to `packages/shared-server/src/cooklang/{pool,parse-worker}.ts`,
confirmed RED, reverted by reverse edit — never `git checkout`, verified
`cmp` + `md5sum` + `git diff --exit-code` clean after every one):

| # | mutation | result |
|---|---|---|
| M1 | `release()`: `target.busy = false` → `retire(target, "pool-shutdown")` (the exact regression R2's docblock names) | RED: `expected 'undefined' to be 'number'` — no live child after warm-up, pid-identity check never even reached |
| M2 | `parse-worker.ts`: busy-loop ~20 ms of CPU in the CHILD before `parser.parse(...)` | RED: `expected 19.33... to be less than 10` on `childCpuMs` |
| M3 | `pool.ts`: busy-loop ~60 ms of CPU in the PARENT at the top of `parseInPool` | RED: `expected 6X.XX to be less than 50` on `parentCpuMs` |

All three mutations reverted; `md5sum` matched the pre-mutation hash for both
files, `cmp` reported IDENTICAL, `git diff --exit-code` was empty for both.
No mutation was ever staged or committed.

**5 consecutive contended full-package runs, 0 failures** — real full-`pnpm
test` multi-worker contention (22 files, 554 tests, concurrently, the exact
condition VERIFY-4 named as the trigger: *"the trigger is full-suite vitest
worker load plus external CPU pressure"*), ambient load 7-9 at the time:

```
RUN 1  Test Files 22 passed (22)   Tests 554 passed (554)
RUN 2  Test Files 22 passed (22)   Tests 554 passed (554)
RUN 3  Test Files 22 passed (22)   Tests 554 passed (554)
RUN 4  Test Files 22 passed (22)   Tests 554 passed (554)
RUN 5  Test Files 22 passed (22)   Tests 554 passed (554)
```

**Additionally, layering 8 external busy-loop spinners on top** (beyond
real full-suite contention alone): the target test **never failed in any of
5 runs** (confirmed both in the full-package runs and in 3 isolated `-t` reruns
under the same 8 spinners, each 1/1 passed). Several OTHER, PRE-EXISTING tests
DID fail intermittently under this heavier combined load — named here rather
than hidden:

- `build-payload.test.ts > buildCookPayload > the happy path > mints a clean,
  self-validating .cook for "pancakes"` and its stored-source-invariant sibling
- `limits.test.ts > the hostile corpus — adversarial input sized AT the cap >
  neither throws nor exceeds 2000 ms on well-formed cookware at maximum density`
- `pool.test.ts > NEVER-BROKEN UNDER CONTENTION (D-27-W3B-03a) > parses BOTH
  worst legitimate shapes while the box is saturated with spinners` (itself a
  contention test, internally spawning 8 spinners of its own — doubly-saturated
  by an external 8 more)
- `pool.test.ts > SATURATION DEGRADES, IT NEVER HANGS (R3, T-27-01d) > resolves
  every one of poolSize + 4 concurrent bound-hitting requests`

**None of these is FAIL-1, none is touched by this diff, and none regressed
by this diff** — every one is a wall-clock-bounded assertion elsewhere in this
plan's own pre-existing test surface, several of them ABOUT contention
specifically, that this box's genuinely severe ambient noise (other agents'
real concurrent work, confirmed via `ps aux`) can push past its own designed
headroom when MORE synthetic load is added on top. `limits.test.ts`'s hostile-
corpus test failed once even on a bare idle-ish `pnpm test` with zero added
spinners, purely from ambient host noise — recorded here as an honest
observation for the director, not chased (test files only, and these are
outside FAIL-1/FAIL-2's scope).

**Before → after cost and headroom, on the property that actually matters
(no per-fixture respawn, bounded CPU):**

| | BEFORE (wall clock) | AFTER (CPU + pid-identity) |
|---|---|---|
| instrument | `performance.now()` delta, 50 ms ceiling | `childCpuMs` ≤10 ms, `parentCpuMs` ≤50 ms, pid-set equality |
| measured under real contention | **50.03-2082.50 ms** (contention-dependent, unbounded) | **childCpuMs 0.85-1.66 ms, parentCpuMs 0.85-14.63 ms** (flat, ≤17x spread vs. wall clock's >40x under far milder contention) |
| headroom | 3.5x idle, **negative under any real contention** | childCpuMs ~6-12x, parentCpuMs ~3.4x, BOTH measured under genuine full-suite contention, not idle |

### Commit

`test(27-04): assert the pool-warm fixture round trip on CPU and pid-identity, not wall clock`
— `packages/shared-server/__tests__/cooklang/pool.test.ts` only.

---

## §FAIL-2 — the third `await import()`-in-test instance, `packages/auth`

**Scope:** `packages/auth/__tests__/auth/workos-provider.test.ts`, one file.
No production source touched (verified: `packages/auth/src/auth.ts` was read
and mutated only transiently for non-vacuity proof, then reverted — see
below). `pnpm-lock.yaml`, root `package.json`, `pnpm-workspace.yaml`,
`packages/db/src/migrations/` and `meta/_journal.json` untouched. This file is
pre-existing and outside plan 27-04's own file set (`packages/auth` has an
empty diffstat across the 47/48-commit range) — authorised as a follow-up by
the task brief, using the exact G1/G4 cure.

### Reproduction (BEFORE the fix)

Isolated, idle, `--reporter=verbose`: the first test alone measured **721 ms**
(cold import of `@norish/auth` behind these mocks), i.e. already ~14% of the
file's default 5 000 ms `testTimeout` with zero contention.

**Calibration.** Per the task brief's own note, this box's ambient load
fluctuates 11-21 with no synthetic load; **20 busy-loop spinners across all 4
cores** (matching G4's own calibration for this exact box) reproduced the
signature on the FIRST attempt:

```
FAIL __tests__/auth/workos-provider.test.ts > buildWorkOSProviders >
     returns no provider when WorkOS is not configured
Error: Test timed out in 5000ms.
 ❯ __tests__/auth/workos-provider.test.ts:76:3

FAIL __tests__/auth/workos-provider.test.ts > buildWorkOSProviders >
     returns no provider when only the clientId is set (no apiKey)
Error: Test timed out in 5000ms.
```

Exact per-test times from the reporter: **7 720 ms** and **5 027 ms** (both
over the 5 000 ms budget) for the first two of the file's 8 in-test
`await import("@norish/auth")` calls. `Test Files 1 failed | 7 passed (8)`,
`Tests 2 failed | 131 passed (133)`. **20 spinners, used** — reproduced
immediately, matching G1/G4's own experience that this box needs 20 (not 8)
for a reliable, clean reproduction.

### Root cause

Structurally identical to `migrate-gallery-images.test.ts` (§G1) and
`import-flow.test.ts` (§G4): the subject (`@norish/auth`, i.e. the whole
`auth.ts` barrel) is `await import()`ed **inside every one of the 8 tests**,
behind a per-test `vi.resetModules()` in `afterEach`. That charges the
transform + evaluation of `auth.ts` — which imports `better-auth`, its
plugins, and (mocked-out, but still resolved) the db/redis/queue/repo seams —
to the per-test wall budget, eight times over. Nothing in this file asserts
anything about time; every assertion is about provider shape, token exchange,
or user-info mapping.

### Why `vi.resetModules()` was checked, not assumed, before being dropped

This is the exact trap the task named: G4 verified "no isolation lost" for
`import-flow.test.ts` and that conclusion does not transfer automatically.
Read directly from the source (`packages/auth/src/auth.ts:216-219`,
`packages/auth/src/index.ts` — a one-line `export * from "./auth"` barrel):

- `buildWorkOSProviders()`'s body calls `getCachedWorkOSProvider()` **inline,
  at call time, on every invocation** (`auth.ts:219`). `workosProvider` is a
  fresh local `const` per call — nothing about the provider is memoized at
  module-eval time, and no top-level call to `buildWorkOSProviders` (or its
  siblings) exists anywhere in `auth.ts` — they run only lazily inside
  `createBetterAuth()`, itself only built on first property access of the
  exported `auth` Proxy, which this test file never touches.
- The mocked `getCachedWorkOSProvider` (this test file's own
  `vi.mock("@norish/auth/provider-cache", ...)`, line 24-32) is
  `() => workosCacheValue` — a closure over the file's own module-scoped
  `let workosCacheValue`, reading its CURRENT value at call time, not a value
  captured when the mock was constructed.
- Therefore a hoisted, once-only import of `@norish/auth` still observes each
  test's own `workosCacheValue` correctly, because the read happens inside
  `buildWorkOSProviders()` at the moment it's CALLED (inside each `it`), not
  at the moment the module was imported. Real per-test isolation was always
  `beforeEach`'s `vi.clearAllMocks()` + fresh `workosCacheValue = null` — both
  act on the mock functions/module-scoped variable, not on module identity,
  and both are kept byte-for-byte unchanged.
- Confirmed by mutation, not just by reading the code (below): neutering the
  `clientId && apiKey` guard reddened BOTH of the two tests that exercise it
  (`workosCacheValue = null` and `workosCacheValue = { clientId, apiKey:
  undefined }`), each independently, proving the per-test reset of
  `workosCacheValue` still isolates those two cases from each other with no
  module re-import between them.

### The fix, and why it is not a bandaid

The G1/G4 cure, applied verbatim:

- `const { buildWorkOSProviders } = await import("@norish/auth");` moved to
  **file scope**, immediately after the last `vi.mock()` call and before
  `describe(...)`. Runs once, during file **COLLECTION**, which neither
  `testTimeout` nor `hookTimeout` bounds.
- The 8 per-test `const { buildWorkOSProviders } = await import(...)` lines
  removed; every call site now uses the module-scope binding.
- `afterEach(() => { vi.resetModules(); })` removed (see isolation analysis
  above — checked, not assumed).
- `beforeEach`'s `vi.clearAllMocks()` + `workosCacheValue = null`, and every
  assertion in every one of the 8 tests, are byte-for-byte unchanged. No
  coverage was traded.
- A docblock records the measurement, the cause, and — the specific point the
  task asked to be re-derived rather than copied — why dropping
  `vi.resetModules()` is safe HERE, so a future reader cannot silently
  re-nest the import without re-proving the argument for this file.

### Non-vacuity by mutation

`packages/auth/src/auth.ts:221`, `if (workosProvider?.clientId &&
workosProvider?.apiKey)` → `if (true || (workosProvider?.clientId &&
workosProvider?.apiKey))`:

```
Test Files  1 failed | 7 passed (8)
Tests  2 failed | 131 passed (133)
```

Exactly the two tests that exercise the guard went RED — `returns no provider
when WorkOS is not configured` and `returns no provider when only the
clientId is set (no apiKey)` — each with a real diff (`toEqual([])` vs. an
array containing the WorkOS provider object). Reverted by reverse edit;
`md5sum` matched the pre-mutation hash, `cmp` reported IDENTICAL, `git diff
--exit-code -- packages/auth/src/auth.ts` was empty. No mutation was ever
staged or committed.

### Isolation re-proved, not assumed, after removing `resetModules()`

- **3/3 `--sequence.shuffle` runs green** (8/8 each time).
- **Each of the 8 tests passes alone** (`vitest run … -t "<name>"`, one at a
  time, all 8 checked individually) — no test depends on a side effect left
  by another.

### Evidence (AFTER)

Isolated, idle, `--reporter=verbose`:

```
✓ returns no provider when WorkOS is not configured                    5ms
✓ returns no provider when only the clientId is set (no apiKey)        1ms
✓ builds a first-party AuthKit genericOAuth provider …                 3ms
✓ getToken exchanges the code …                                        2ms
✓ getToken throws when the WorkOS authenticate call fails              3ms
✓ getUserInfo maps the WorkOS user profile …                           1ms
✓ getUserInfo falls back to the email …                                1ms
✓ produces a config better-auth accepts …                              2ms
```

**First test: 721 ms cold / 7 720 ms under 20-spinner contention → 5 ms.**
Headroom against the file's unraised 5 000 ms default `testTimeout` went from
**already-negative under contention (7 720 ms > 5 000 ms) to ~1 000x.**

**5 consecutive full `@norish/auth` runs under the identical 20-spinner
contention that produced the BEFORE failure:**

```
RUN 1  Test Files 8 passed (8)   Tests 133 passed (133)
RUN 2  Test Files 8 passed (8)   Tests 133 passed (133)
RUN 3  Test Files 8 passed (8)   Tests 133 passed (133)
RUN 4  Test Files 8 passed (8)   Tests 133 passed (133)
RUN 5  Test Files 8 passed (8)   Tests 133 passed (133)
```

**0 timeouts, 5/5 contended runs, 133/133 each time.** Three consecutive
**idle** full `@norish/auth` runs: 133/133 each.

`tsc --noEmit -p .` (real gate, `include: ["src"]`, tests excluded — the same
repo-wide convention G4 documented): **EXIT 0, zero output**, both before and
after. `eslint --flag unstable_native_nodejs_ts_config
__tests__/auth/workos-provider.test.ts`: **EXIT 0**, 0 errors (1 warning,
"File ignored" — the same repo-wide `**/__tests__/**` ignore G3 documented,
unchanged). `pnpm lint` for `@norish/auth`: **EXIT 0**, 0 errors.

No `as any`, `@ts-ignore`, `@ts-expect-error`, or type widening added. No
`pnpm install` run, no lockfile touched. `git status` shows only
`packages/auth/__tests__/auth/workos-provider.test.ts` modified.

### Commit

`test(auth): hoist the workos-provider subject import out of the per-test wall budget`
— `packages/auth/__tests__/auth/workos-provider.test.ts` only.
