---
phase: 27-cooklang
plan: 06
wave: W5-PREP
verified: 2026-07-27T15:55:00Z
status: passed
score: 13/13 must-haves verified
overrides_applied: 0
verifier: independent goal-backward re-derivation (adversarial; SUMMARY.md treated as untrusted)
baseline: a334d0e8
head: 5688039c
commits_reviewed: [f93eaf65, 311eada3, d18f02d7, 9d7b6b3e, 5688039c]
warnings:
  - id: W-1
    severity: warning
    item: "Plan gate `pnpm deps:cycles` EXIT 0 is NOT met (EXIT 1, one cycle)."
    evidence: "Independently reproduced at BASELINE a334d0e8 via a throwaway git worktree: `node tooling/monorepo/scripts/check-circular-deps.mjs` → `Found 1 circular dependency. - packages/db-schema/src/schema/auth.ts -> packages/db-schema/src/schema/households.ts`, EXIT 1. Identical at HEAD. `packages/db-schema/` is absent from the 27-06 diff."
    disposition: "Pre-existing; the PLAN pinned an incorrect baseline for this gate. Not introduced by 27-06. Honestly disclosed in the SUMMARY and logged to deferred-items.md."
  - id: W-2
    severity: warning
    item: "Injected `node_modules/@norish/config/package.json` is STALE — it lacks the new `./units-config` exports entry."
    evidence: "`require('/opt/norish-src/node_modules/@norish/config/package.json').exports['./units-config']` → undefined, while `packages/config/package.json` has it. The executor re-synced `src/` (per the PLAN's risk-6 instruction) but not `package.json`."
    disposition: "No functional impact today: every workspace consumer (shared-server, db, shared, api, trpc, apps/web) resolves `@norish/config` to the real `packages/config` symlink, whose package.json IS correct (verified by `require.resolve` and by `readlink -f` on each consumer). `pnpm docker:build` does a fresh install. Environment hygiene only — flagged so a later executor is not surprised."
  - id: W-3
    severity: warning
    item: "The root injected `@norish/config/src` is now a plain COPY, no longer hardlinked to `packages/config/src`."
    evidence: "`ls -li` shows distinct inodes (919768 vs 315510) with identical mtimes from this wave's `cp -a`; `diff -r packages/config/src node_modules/@norish/config/src` → IDENTICAL. `packages/shared/src/units/convert-measure.ts` IS still hardlinked (same inode 919772)."
    disposition: "Content is in sync and no consumer resolves through that copy. Latent hazard only: a future in-place edit to `packages/config/src` will not auto-propagate there."
  - id: W-4
    severity: note
    item: "`findDensity` gains three NEW English positives that were `null` before this wave."
    evidence: "Measured across all 81 pre-change aliases: `chopped onion` and `diced onion` → chopped_onion, `bicarbonate of soda` → baking_soda (all three previously null). Zero aliases LOST, zero REPOINTED."
    disposition: "Intended (D-27-W5P-07 + the newly found second dead row). Strictly additive. Worth stating precisely: the guarantee that holds is 'nothing that resolved stops resolving or re-points', NOT 'no English lookup changes at all' — `findDensity(\"onion\")` now returns chopped_onion (160 g/cup)."
  - id: W-5
    severity: note
    item: "The SERIALIZER's output for a user/model-supplied `fl oz` unit changed: `@milk{8%fl oz}` → `@milk{8%fluid_ounce}`."
    evidence: "Probed directly: `structuredToCooklang` → `canonicalUnit` → `normalizeUnit(raw, units)`; `normalizeUnit(\"fl oz\")` is now `fluid_ounce`."
    disposition: "NOT a regression. It is the pre-existing design applied consistently — `tbsp`→`tablespoon`, `oz`→`ounce`, `g`→`gram` already canonicalize; `.cook` deliberately stores canonical IDs (serialize.ts:29 comment) and `formatUnit`/`useUnitFormatter` localize on the read side (`formatUnit(\"fluid_ounce\",\"en\",…,2)` → \"fluid ounces\"). Live has 0 rows with a non-NULL `cook_source`, so no stored `.cook` is affected."
director_decision_points:
  - "D-27-W5P-02 — `fluid_ounce`/`pint` are deliberately OUT of `SYSTEM_TARGETS.volume.us`; reversible in two lines. Pinned by a named test."
  - "D-27-W5P-06 — 14 measured Dutch names stay uncovered; feta / mozzarella / generic grated cheese need three real USDA figures (a W5 table-expansion item)."
  - "D-27-W5P-05 — `syncUnits` still does not sync file CONTENT; the trap is closed at the read boundary only."
human_verification: []
---

# Phase 27 / Plan 27-06 (Wave W5-PREP) — Verification Report

**Phase goal under test:** close the three prerequisites blocking W5 — (1) the canonical-unit
vocabulary gap, (2) a deterministic rounding/presentation rule applied at one layer, (3) a
Dutch alias + prep-stopword pass over the density table with existing English behaviour
unchanged.

**Method:** goal-backward, adversarial. Every number in `27-06-SUMMARY.md` was treated as an
unverified claim and re-derived from the codebase. Every behavioural claim was executed, not
read. Pre-change behaviour was reconstructed from `a334d0e8` (extracted sources + a throwaway
git worktree) rather than taken from the SUMMARY narrative.

**Verdict: PASSED — 13/13 must-have truths verified. 3 warnings, 0 blockers.**

---

## A. Gates re-run independently (actual output, not SUMMARY claims)

| Gate | Command I ran | Actual result | Plan's pin | Verdict |
|---|---|---|---|---|
| typecheck | `pnpm typecheck --force` (cache defeated) | `17 successful, 17 total`, `Cached: 0 cached`, 2m8s | 17/17 EXIT 0 | REPRODUCES |
| real tsc | `pnpm exec tsc --noEmit` in `packages/shared-server` | EXIT 0, no output | clean | REPRODUCES |
| config test | `pnpm --filter @norish/config test` | **755 passed (755)**, 3 files | 745 (+ reconcile) | REPRODUCES (745 + 10 `units-config.test.ts` cases; per-file count re-measured: 10) |
| shared test | `pnpm --filter @norish/shared test` | **564 passed (564)**, 19 files | ≥345 + new | REPRODUCES (345 + 25 + 193 + 1; per-file counts re-measured: vocabulary 16, rounding 9, nl 193, convert-measure 33) |
| shared-server test | `pnpm --filter @norish/shared-server test` | **556 passed (556)**, 22 files | 556 | REPRODUCES exactly |
| db test | `pnpm --filter @norish/db test` | **183 passed (183)**, 23 files (Postgres ran for real) | 0 failed | REPRODUCES |
| lint shared | `pnpm --filter @norish/shared lint` | 0 errors, 45 warnings | 0 err / 45 w | REPRODUCES |
| lint config | `pnpm --filter @norish/config lint` | 0 errors, 1 warning | 0 err / 1 w | REPRODUCES |
| lint db | `pnpm --filter @norish/db lint` | 0 errors, 62 warnings | 0 err / 62 w | REPRODUCES |
| lint shared-server | `pnpm --filter @norish/shared-server lint` | 0 errors, 57 warnings | 0 err / 57 w | REPRODUCES |
| **deps:cycles** | `pnpm deps:cycles` | **EXIT 1** — 1 cycle (`db-schema` auth→households) | EXIT 0 | **DOES NOT MEET THE PIN — see W-1; proven pre-existing at `a334d0e8`** |

Every number the SUMMARY reported reproduced. The one gate that does not meet its pinned
expectation (`deps:cycles`) fails **identically on the pre-change tree** — I ran the checker
inside a throwaway worktree at `a334d0e8` and got the same single cycle and the same EXIT 1.

**Anti-pattern scan:** `grep -nE "\bTODO\b|\bFIXME\b|\bTBD\b|\bXXX\b|\bHACK\b|placeholder|not yet implemented"`
over every source and test file this plan touched → **no matches** (exit 1). No `as any`,
`@ts-ignore` or `@ts-expect-error` anywhere in the diff.

---

## B. Observable truths — each proven by execution

| # | Must-have truth | Status | How I proved it |
|---|---|---|---|
| 1 | `kilogram`/`fluid_ounce`/`pint` are real canonical IDs end to end | VERIFIED | `dimensionOf` → `mass`/`volume`/`volume`; `resolveCanonicalUnit("fl oz"\|"kg"\|"pt")` → `fluid_ounce`/`kilogram`/`pint`; `normalizeUnit` on the resolved map likewise; `formatUnit("fluid_ounce","en",…,2)` → `"fluid ounces"`, `formatUnit("kilogram","en",…)` → `"kg"`, `formatUnit("pint",…,2)` → `"pints"`. Config: 67 keys, all three appended at the END, `prefix identical: true` vs the 64 baseline keys, **existing-unit drift: 0**, all 7 locales on short AND plural, forbidden alternates (`oz`,`oz.`,`fl`,`fl.`) **absent** |
| 2 | `fl oz`/`pint` CONVERT instead of freezing | VERIFIED | Executed: `convertToSystem(8,"fl oz","metric")` → `{quantity:237, unit:"milliliter", via:"same-dimension"}`; `convertToSystem(1,"pint","metric")` → `473 milliliter`. Collision guards hold: `normalizeUnit("oz")`→`ounce`, `normalizeUnit("fl")`→`bottle` |
| 3 | Dry goods no longer degrade to `ounce` | VERIFIED | Executed: flour 250 g → `{quantity:2, unit:"cup", via:"density", ingredientId:"all_purpose_flour"}`; sugar 100 g → `0.5 cup`; grated parmesan 50 g → `0.5 cup`; rice 300 g → `1.62 cup`; salt 5 g → `0.822 teaspoon`; olive oil 30 g → `2.22 tablespoon`. **This is the D-27-W3-07 flagship row closing to the AI's own value** |
| 4 | Crossing is density-gated and one-directional | VERIFIED | `chicken breast` 500 g → `1.1 pound (same-dimension)`; `unobtainium puree` 500 g → `1.1 pound`; no-ingredient 500 g → `pound`, 100 g → `3.53 ounce`; `convertToSystem(1,"cup","metric",{flour})` → `237 milliliter` (still VOLUME); `convertToSystem(2,"cup","us",{flour})` → `2 cup (identity)`. Source: `const density = targetSystem === "us" && def.dimension === "mass" ? findDensity(opts.ingredient) : null` — no text heuristic, no invented figure |
| 5 | `roundQuantity` at exactly ONE site | VERIFIED | `grep -c "roundQuantity(" convert-measure.ts` → **3** = definition + 2 call sites (`same-dimension` ok-result, the shared `density` ok-result). **Zero** calls in `convertToSystem` or `deriveConversion` (read the full source). Executed the double-round probe: `convertToSystem(250,"gram","us",{flour}).quantity === convertToUnit(250,"gram","cup",{flour}).quantity` → `true`. `14.109585→14.1`, `1.102311→1.1`, `8.81849→8.82` |
| 6 | Rounding never destroys a value | VERIFIED | Executed: `1234→1234` (not 1230), `1000.4→1000`, `999.6→1000`, `0.0000012→0.0000012`, `1e-30→1e-30`, `-14.109585→-14.1`, `Object.is(roundQuantity(16.000000000000004),16)`→true, `NaN→NaN`, `Infinity→Infinity`, `0→0`. Identity untouched: `convertToUnit(3.14159,"gram","gram")` → `3.14159 (identity)`; `convertToSystem(2.5,"clove","us")` → `2.5 (identity)` |
| 7 | Full-table alias-reachability invariant, NON-VACUOUS | VERIFIED | The committed test iterates `DENSITY_TABLE` and `entry.aliases` at runtime and asserts `findDensity(alias)?.id === entry.id` into a `failures[]` array (`ingredient-density-nl.test.ts:27-37`) — no hand-list. **I ran the same invariant against the BASELINE table+matcher and it FAILS on 3 aliases** (`chopped onion`, `diced onion`, `bicarbonate of soda`) and passes with **0 violations** at HEAD. It would still fail if a row went dead |
| 8 | Measured Dutch names resolve | VERIFIED | 53 named pairs asserted individually with the expected entry id (not `not.toBeNull()`); 193 tests green in that file. Includes olijfolie / olijf olie / extra vierge olijfolie / traditionele olijfolie → `olive_oil`, kokend water → `water`, slagroom + verse slagroom → `heavy_cream`, honing + vloeibare honing → `honey`, zout → `table_salt` |
| 9 | Uncovered names stay uncovered | VERIFIED | 17 names asserted `null` individually (kaas, geraspte kaas, feta kaas, feta cheese, grated cheese, mozzarella, aubergine, basilicum, champignons, ham, gremolata, marshmallow, cheesecake, rode wijn, red wine, hearty cream, other herbs). `grep -n "kaas" density-table.ts` → only `pindakaas` and `parmezaanse kaas`. **Zero density drift** across all 29 entries (see D) |
| 10 | English lookup surface unchanged | VERIFIED | See section D — full empirical baseline-vs-HEAD diff over all 81 pre-existing aliases |
| 11 | A new units key is visible on a seeded install | VERIFIED | Executed `resolveUnitsMap` on all four stored shapes: stored `gram.short[0].name === "GRAMME"` survives in ALL of `{units,isOverridden}`, `{units,isOverwritten}` and the bare legacy map, while `fluid_ounce` comes back from the FILE, 67 keys each time. `undefined`/`null`/`"garbage"`/`{nonsense:1}` → 67 file defaults. Both readers delegate: `grep -n "isOverwritten"` on `server-config-loader.ts` + `ingredients.ts` → **no matches** |
| 12 | No migration, no live data | VERIFIED | See section F |
| 13 | Scope fence — W5/W6 untouched | VERIFIED | See section F |

---

## C. THE HIGH-RISK DEVIATION — `cooklang/serialize.test.ts` (scrutinized hardest)

**Question 1 — does the new vocabulary change the SERIALIZER or only the CONVERTER? Proven: BOTH, and here is exactly which.**

`packages/shared/src/cooklang/serialize.ts:115-120` — `canonicalUnit()` runs every unit through
`normalizeUnit(raw, units)` and emits the result. So closing the vocabulary gap DOES change
serializer output for real user/model-supplied text. Probed directly:

```
"fl oz"         => "Add @milk{8%fluid_ounce}."     <- CHANGED by this wave
"tbsp"          => "Add @milk{8%tablespoon}."      <- already canonicalized before this wave
"cup"           => "Add @milk{8%cup}."
"generous glug" => "Add @milk{8%generous glug}."   <- unrecognized, passes through
```

This is **not** a regression: it is the pre-existing design applied consistently. `tbsp`,
`oz`, `g`, `ml` already canonicalized; `.cook` stores canonical IDs by explicit design
(`serialize.ts:29` — "a localized label must never enter the `.cook`") and the read side
localizes via `formatUnit` / `useUnitFormatter` (`packages/shared-react/src/hooks/use-unit-formatter.ts`).
Live currently has **0 rows with a non-NULL `cook_source`**, so no stored `.cook` is affected.
Recorded as note **W-5** for the director.

**Question 2 — was the test's original intent preserved, or was a regression papered over? Proven: preserved.**

The test is `"keeps a legitimate multi-word amount and unit, which carry INTERNAL spaces"` in
the `no whitespace-only amount or unit (H2)` block. Its subject is an **unrecognized**
multi-word unit whose internal space must survive `escapeTokenText`'s whitespace collapse.
Once `fl oz` became recognized it normalizes to the single token `fluid_ounce` and the fixture
**stopped exercising the multi-word path at all** — i.e. leaving it in place would have made
the test vacuous. Swapping to `"generous glug"` (unrecognized, multi-word) restores the exact
property under test. The multi-word AMOUNT half (`@flour{1 1/2%cup}`) is unchanged.

**Question 3 — are the T-27-01 protections intact? Proven: byte-identical, all four.**

| T-27-01 protection | Evidence |
|---|---|
| `escapeCookText` escapes every metacharacter in non-authored text | `git diff --stat a334d0e8..HEAD -- packages/shared/src/cooklang/ packages/shared/src/lib/` → **EMPTY**. The escaper is byte-identical. Executed it anyway: `@`→`\@`, `#`→`\#`, `~`→`\~`, `{`/`}`→`\{`/`\}`, `%`→`\%`, `--`→`\-\-`, `>>`→`\>\>`, `=`→`\=`, and `@x{1%cup}`→`\@x\{1\%cup\}` |
| `extensions = 0` on the parser | `packages/shared-server/src/cooklang/parse-worker.ts:106` `const COOK_PARSER_EXTENSIONS = 0;` → `:116` `parser.extensions = COOK_PARSER_EXTENSIONS;`. `git diff --stat … packages/shared-server/src/cooklang/` → **EMPTY** |
| Frontmatter quoting by KEY | `serialize.ts:57` / `:271` intact; file untouched |
| `findCookSourceDefect` at both doors | `parse.ts:141` and `build-payload.ts:120` (plus `pool.ts:1023`) — all present, all in untouched files |
| Suites green | `pnpm --filter @norish/shared test cooklang` → **61 passed**; `pnpm --filter @norish/shared-server test cooklang` → **341 passed** (round-trip fidelity, limits, parse, pool) |

The only files this wave changed under `packages/shared-server/src` and `packages/db/src` are
`config/server-config-loader.ts` and `repositories/ingredients.ts`. **Nothing in the injection
defence surface was touched.** No FAIL.

---

## D. Alias-reachability invariant + English-regression proof (independently re-derived)

I extracted `density-table.ts` and `ingredient-density.ts` at `a334d0e8`, loaded them
side-by-side with the HEAD versions, and diffed the behaviour rather than the narrative.

**(i) The invariant genuinely iterates the real table and is non-vacuous:**

```
BASELINE invariant violations:
  BASE-DEAD baking_soda   :: "bicarbonate of soda" -> null
  BASE-DEAD chopped_onion :: "chopped onion"       -> null
  BASE-DEAD chopped_onion :: "diced onion"         -> null
HEAD invariant violations: 0
```

The committed assertion is `expect(failures).toEqual([])` over a runtime double loop — it
would go red the moment any row went dead. The SUMMARY's claim that the invariant caught a
**second, previously unknown** dead alias (`"bicarbonate of soda"`, killed by the long-standing
English stopword `"of"`) is **confirmed** — I reproduced the failure on the pre-change tree.

**(ii) Both repairs added a reachable alias; nothing was weakened.** The `PREP_DESCRIPTORS`
diff is **additions only** — 36 Dutch tokens appended, **zero English tokens removed**. The
`density-table.ts` diff touches `aliases` arrays only. The repairs are `onion`/`ui` on
`chopped_onion` and `bicarbonate soda` on `baking_soda`. The invariant assertion itself was
not loosened (no allow-list, no skip).

**(iii) The English regression proof, measured over all 81 pre-existing aliases:**

```
PRE-EXISTING ALIASES: same=78  lost=0  repointed=0  newly-resolving=3
  GAINED  bicarbonate of soda: null -> baking_soda
  GAINED  chopped onion:       null -> chopped_onion
  GAINED  diced onion:         null -> chopped_onion
density drift: 0   (29 entries both sides; gramsPerCup, gramsPerMilliliter and source all identical)
```

Spot-checks with baseline-vs-HEAD normalization side by side — `Whole Wheat Flour`,
`brown sugar`, `peanut butter`, `coconut flour`, `dragon fruit puree`, `saffron threads`,
`almond flour`, `extra virgin olive oil`, `room temperature butter`, `sea salt`,
`greek yogurt`, `old fashioned oats`, `corn flour`, `hearty cream`, `red wine`,
`grated cheese`, `feta cheese` — **normalized form and resolved id identical on both trees**.

**The frozen map is the real thing, not a rubber stamp:** I parsed `FROZEN_ALIAS_MAP` out of
the committed test and compared it against the baseline table — 81 pairs, **exactly** the
baseline alias set, no alias missing, no invented entry, and every pair points at the entry
that actually owns that alias in the baseline table. One precision note (W-4): 3 of those 81
pairs record the alias's OWNER rather than its pre-change *resolution* (which was `null`);
that is the correct assertion to make, but the test's comment "captured from the tree BEFORE
any Task 4 edit" is slightly imprecise for those three. No behavioural consequence.

**Safety of the new single-word aliases:** `findDensity` requires a single-word alias to equal
the WHOLE normalized name (`ingredient-density.ts:130`), so short tokens like `ui` cannot
match as substrings. Verified by reading the matcher, not assumed.

---

## E. Deviations 2 and 3 — is the merged `getUnits` behaviour CORRECT, or a test bent to fit a bug?

**Correct, and it is the plan's own specified behaviour.** D-27-W5P-05 explicitly requires
`resolveUnitsMap(storedValue) === { ...defaultUnits, ...stored }` — file defaults UNDER the
stored map, at READ time, in both readers. The rewritten tests assert
`{ ...defaultUnits, cup: storedCup }`, which is exactly that.

The decisive question — *does a customized stored map still WIN?* — I proved by execution
rather than by reading the test:

| Stored shape | stored `gram.short[0].name` | file-only `fluid_ounce` present | keys |
|---|---|---|---|
| `{units:{gram:GRAMME}, isOverridden:true}` | **`"GRAMME"`** (file's `"g"` did NOT win) | yes | 67 |
| `{units:{gram:GRAMME}, isOverwritten:false}` (pre-v0.16) | **`"GRAMME"`** | yes | 67 |
| `{gram:GRAMME}` (bare legacy) | **`"GRAMME"`** | yes | 67 |
| `undefined` / `null` / `"garbage"` / `{nonsense:1}` | n/a | file defaults | 67 |

`normalizeUnit("gramme", resolved)` → `"gram"`, i.e. the stored alternates are the ones in
force. Spread order in `units-config.ts:34/44/51` puts the stored map LAST in every branch —
T-27-W5P-01 (an admin override can never be silently replaced by a file value) holds. The
four-branch fallback was moved verbatim into one module and both readers now call it; the
duplicated code is gone from both (`grep -n "isOverwritten"` on both readers → no matches).
`seed-config.ts` is untouched, so nothing is written to `server_config`.

**Verdict: the 3 rewritten tests asserted the OLD no-op-trap behaviour that D-27-W5P-05 exists
to remove. Updating them was mandatory, and the replacement is a tightening.**

### Task 3's five reconciled assertions — independently re-derived, not taken on trust

The plan required the pre-edit red set to match its prediction exactly. I reconstructed it:
restored the **baseline** `convert-measure.test.ts` as a throwaway file, ran it against the
**HEAD** source, then deleted it (tree left clean).

```
× g → oz (100 g ≈ 3.5274 oz)                     expected 3.53 to be close to 3.5274
× tsp → ml (1 tsp ≈ 4.9289 ml)                   expected 4.93 to be close to 4.9289
× accepts common raw-unit synonyms (g, oz)       expected 3.53 to be close to 3.5274
× gram → ounce → gram preserves the value        expected 499 to be close to 500
× 2 cups → metric picks milliliter (< 1 L)       expected 473 to be close to 473.18
Tests  5 failed | 27 passed (32)
```

**Exactly the five the plan predicted, and nothing else.** All five edits replace a tolerance
with an exact `toBe` (a tightening); the round-trip one swaps an absolute `toBeCloseTo(500,3)`
for an explicit `<1%` relative bound with the 0.5%-per-hop justification written in the test.
The file is now 33 tests (32 + the new one-directional-crossing test). The `cook-projection`
change (`ounce`/(6,8) → `cup`/`toBe(1.6)`) is likewise a tightening, and its sibling
`unobtainium puree` case is untouched and still green.

---

## F. Scope fence — every item checked, all clean

| Fence item | Command | Result |
|---|---|---|
| `packages/db/src/migrations/` untouched | `git diff --stat a334d0e8..HEAD -- packages/db/src/migrations/` | **EMPTY** |
| `_journal.json` still 42 / `0041_add_cook_source` | `node -e` on the journal | **42, `0041_add_cook_source`** |
| `seed-config.ts` diff empty | `git diff --stat … packages/api/src/startup/seed-config.ts` | **EMPTY** |
| `pnpm-lock.yaml` diff empty | `git diff --stat … pnpm-lock.yaml` | **EMPTY** |
| No file under `apps/` | `git diff --stat … apps/` | **EMPTY** |
| `packages/config/src/units.default.json` count | `node -e` | **67** |
| No `0042` / backfill / `cook_confidence` / `cook_review_needed` in added lines | `git diff … \| grep '^+' \| grep -iE …` | **no matches** |
| No `as any` / `@ts-ignore` / `@ts-expect-error` | same grep | **no matches** |
| `unit-converter.ts`, `applyIngredientLinkMarkup`, `createIngredientLinkCandidates`, `SmartInstruction` not deleted | `git ls-tree` at both revs + `grep -rl` | **all still present** |
| Nothing pushed | `git log --oneline origin/main..HEAD \| wc -l` | **7 local commits ahead; origin/main = `a3c41845`** |
| No live data read or written | full diff is confined to `packages/{config,shared,shared-server,db}` units/config sources + tests + `.planning/` | **no `psql`, no migration runner, no data script, no deploy** |
| Working tree clean after verification | `git status --porcelain` | **empty** (my throwaway probe file and worktree removed) |

---

## G. Anti-pattern / quality scan

- No debt markers (`TODO`/`FIXME`/`TBD`/`XXX`/`HACK`/`placeholder`) in any file this plan
  touched — `grep` exits 1.
- No stub shapes: every new function has a real body; `roundQuantity`, `resolveUnitsMap` and
  the crossing branch were all executed and produce real values.
- Every new/changed density figure: **none** (drift 0) — the `27-DECISIONS.md` UNITS rule
  ("Unknown-density ingredients are flag-and-preserved, never fabricated") is honoured; the 14
  uncovered names are asserted to STAY `null`.
- `D-27-W5P-02` is pinned by an executable test (a 6-point `milliliter` sweep asserting the
  ladder never selects `fluid_ounce` or `pint`) — the decision cannot silently drift.

---

## Gaps

**None.** No must-have truth failed. The single unmet PLAN acceptance criterion
(`pnpm deps:cycles` EXIT 0) is a mis-pinned baseline: the cycle exists identically at
`a334d0e8`, `packages/db-schema/` is absent from the diff, and it is already logged to
`deferred-items.md`. It does not touch the phase goal.

## Warnings requiring no rework

W-1 `deps:cycles` pin was wrong in the PLAN (pre-existing failure).
W-2 stale injected `@norish/config/package.json` exports map (no consumer resolves through it).
W-3 root injected `@norish/config/src` de-hardlinked to a plain copy (content in sync).
W-4 three English names newly resolve (additive; the guarantee is "nothing regresses", not "nothing changes").
W-5 the serializer now emits `fluid_ounce` for `fl oz` (consistent with every other recognized unit; 0 live rows affected).

---

_Verified: 2026-07-27_
_Verifier: independent adversarial re-derivation. SUMMARY.md claims were not accepted as evidence; every gate was re-run and every behavioural claim was executed._
