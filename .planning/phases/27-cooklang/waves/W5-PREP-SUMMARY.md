# Phase 27 — W5-PREP (the three unblocked prerequisites for W5) — SUMMARY

> Status: **CODE-COMPLETE**, gates green. Plan `27-06-PLAN.md`, single plan = whole wave.
> **NOT DEPLOYED.** Nothing pushed. NO `docker:build`, NO live stack, NO live DB access,
> **NO migration** — `packages/db/src/migrations/` and `meta/_journal.json` untouched, DB
> stays at **42**. `git diff pnpm-lock.yaml` is EMPTY — no dependency added.
>
> **This is NOT W5.** W5 (the live-data backfill, migration `0042`) remains PAUSED for
> Kiran's explicit sign-off and is not started, planned, or touched anywhere in this wave.

**Commits, in landing order** (base `d3e1ae1b`, the plan commit):

`f93eaf65` (T1 — `kilogram`/`fluid_ounce`/`pint` canonical unit IDs + `resolveUnitsMap`) →
`311eada3` (T2 — the US dry-goods volume preference, D-27-W5P-01, + `roundQuantity`,
D-27-W5P-03/04) → `d18f02d7` (T3 — reconciled the 5 W0 assertions the rounding rule
tightens) → `9d7b6b3e` (T4 — the Dutch alias + bilingual prep-stopword pass,
D-27-W5P-06/07). **Nothing pushed.**

---

## Why this wave existed

D-27-W3-07 (measured during W3) is the only evidence on record about the derived
opposite-system projection's quality, and its verdict was that the derived US output was
**WORSE than the AI's on 18 of 35 ingredients**, on two independent axes: (1) every dry
good the model measured in `cup` came back as `ounce` (`2 cup flour` → `8.81849 ounce`),
and `fl oz`/`pint` were never produced at all because the norish unit config had no such
canonical IDs; (2) every converted row carried an unrounded six-decimal value
(`14 ounce` → `14.109585 ounce`), an axis that survives any vocabulary fix.

A third prerequisite came from `27-W5-PREP-DENSITY-MEASUREMENT.md` (prior session): the
density-table flag rate on live-shaped data was **86.2% of distinct volume-authored
ingredient names, 100% of recipes**, and its key finding was that most of those names are
foods ALREADY in the table, failing only for a missing Dutch alias or an English-only
prep-word stopword list.

This wave closes the first two prerequisites (both pure, offline, in-repo code) and builds
on the third (already measured, not re-measured here).

## What shipped, per task

### Task 1 — the units-config vocabulary (`f93eaf65`)

`kilogram`, `fluid_ounce` and `pint` landed in `packages/config/src/units.default.json`
(67 units total, was 64), each with the file's full 7-locale shape and no collision with
`ounce`'s `oz`/`bottle`'s `fl` alternates. A new `packages/config/src/units-config.ts`
exports `resolveUnitsMap(value): UnitsMap` — the single door both units readers
(`getUnits` in `@norish/shared-server`, `getUnitsForNormalization` in `@norish/db`) now go
through, replacing a four-branch stored-value fallback that was duplicated verbatim in
each. The merge is READ-TIME: `{ ...defaultUnits, ...storedValue }`, so a stored key always
wins (T-27-W5P-01, tampering: an admin override can never be silently replaced) and a key
present only in the file — like the three just added — surfaces on an install whose
`server_config.units` row predates it. **No DB write, no boot-time mutation** —
`packages/api/src/startup/seed-config.ts`'s `syncUnits` is byte-for-byte untouched, verified
by an empty `git diff --stat` on it.

Discovered while wiring this in: 3 existing `server-config-loader.test.ts` tests asserted
the OLD no-op-trap behavior (a stored map with one key returned ONLY that key) — updated to
assert the correct merged result (Rule 1, documented in `27-06-SUMMARY.md`).

### Task 2 — the converter (`311eada3`)

`CANONICAL_UNIT_MAP` and `UNIT_SYNONYMS` gained the three IDs (`unit-dimensions.ts`), so
`dimensionOf("fluid_ounce")`/`dimensionOf("pint")` report `volume` and `dimensionOf("kilogram")`
reports `mass` where all three previously reported `count` (system-neutral, frozen). The
concrete payoff: `convertToSystem(8, "fl oz", "metric")` now returns `237 milliliter` where
it previously returned the measure UNCHANGED.

`roundQuantity` (D-27-W5P-03) — 3 significant digits, `Math.round` above 1000 to never
discard an integer digit, applied at exactly one site inside `convertToUnit`'s
`same-dimension`/`density` ok-results. `via: "identity"` keeps the pre-existing 1e-6 guard
only (D-27-W5P-04) — an unconverted measure is never re-rounded.

The US dry-goods volume preference (D-27-W5P-01) in `convertToSystem`: when
`targetSystem === "us"`, the source dimension is `mass`, and `findDensity(ingredient)`
returns a real entry, the target dimension becomes `volume` — computed by converting the
source quantity to grams, dividing by the density, then converting those millilitres into
each US volume candidate before applying the existing magnitude-threshold ladder. Every
other combination stays exactly as it was: no density ⇒ no crossing (`chicken breast` stays
`pound`), and metric never crosses (`1 cup flour -> metric` still returns a volume). The
flagship regression closes: `convertToSystem(250, "gram", "us", { ingredient: "flour" })`
now returns `2 cup` (`via: "density"`), byte-identical to the AI's own value D-27-W3-07
recorded as better than the derived `8.81849 ounce`.

Discovered while running the full `@norish/shared` suite for the first time: a
`cooklang/serialize.test.ts` fixture asserting `fl oz` stays literal in a `.cook` file broke,
because `fl oz` is now a real `fluid_ounce` alternate `normalizeUnit` recognizes — the
INTENDED vocabulary-gap closure, not a regression (Rule 1, fixture swapped to an
unrecognized custom unit to keep testing the escaping behavior it was written for).

### Task 3 — reconciling the W0 suite (`d18f02d7`)

`roundQuantity` tightens exactly 5 pre-existing `convert-measure.test.ts` assertions from an
absolute tolerance to an exact value or an explicit relative-error bound — never a
relaxation. The pre-edit red set, captured before any edit, matched the plan's prediction
byte-for-byte: `g → oz`, `tsp → ml`, the g/oz synonym case, the `gram → ounce → gram`
round-trip, and `2 cups → metric picks milliliter`. One new test,
`crosses mass -> US VOLUME when a density exists, and only in that direction`, pins
D-27-W5P-01's rule as a named assertion. 33 tests total (32 baseline + 1 new), every other
assertion in the file byte-identical and green.

### Task 4 — the Dutch alias + prep-stopword pass (`9d7b6b3e`)

36 Dutch prep/state descriptors joined the (previously English-only) `PREP_DESCRIPTORS`
set — mirroring the English list, plus `kokend` (boiling) and `vloeibaar`/`vloeibare`
(liquid), which the density measurement named and English has no counterpart for. Dutch
aliases landed on 24 existing `density-table.ts` entries covering every name the
measurement flagged; no density figure, `gramsPerCup`, `source` or entry id changed, and no
entry was added or removed (`DENSITY_TABLE.length` stays 29).

**The full-table alias-reachability invariant — written first, per the plan, before any
source edit — is the regression proof.** It iterates the real table at runtime (no
hand-written list) and asserts `findDensity(alias)?.id === entry.id` for every entry's every
alias. On the pre-change tree it failed for the plan's predicted `chopped_onion` (both
aliases begin with a word `PREP_DESCRIPTORS` already stripped — D-27-W5P-07) — repaired by
adding the reachable single-word `onion`/`ui` aliases. **It also caught a second,
previously-unknown dead alias: `"bicarbonate of soda"`**, unreachable because `"of"` was
already an English stopword from a much earlier wave, entirely unrelated to this task's
Dutch work — repaired the same way (a reachable reduced-form alias added, the stopword list
untouched). Both are Rule-1 findings, documented rather than silently absorbed. A frozen
81-pair pre-change English alias→id map and a frozen 29-pair id→`gramsPerCup` map back the
invariant as belt-and-braces (an entry's whole alias set being swapped would still pass the
invariant but not the frozen map).

D-27-W5P-06: generic Dutch `kaas`/feta/mozzarella stay unmapped — the only cheese entry
this table has a real figure for is grated parmesan specifically, and mapping a generic
word onto it would be exactly the "wrong density match" the module's own header rule
forbids. Only the Dutch names for PARMESAN (`parmezaan`, `parmezaanse kaas`) were added.

## Adversarial / regression posture

No adversarial weakening round ran in this wave (it is pure offline units-subsystem code
with no trust boundary crossing per the plan's own threat model — see `27-06-PLAN.md`
`<threat_model>`, "the adversarial revert-check is therefore a reasoned N/A for this wave,
exactly as it was for W1"). The regression posture instead rests on:
- the full-table alias-reachability invariant + frozen maps (Task 4), proving no
  pre-existing English density match moved;
- the 5 named, pre-recorded W0 assertion changes (Task 3), each a tightening;
- running every touched package's FULL test suite (not just the new files) after every
  task, which is how both Task 2's `serialize.test.ts` fixture break and Task 1's 3 stale
  `getUnits` tests surfaced.

## Gates (all green in one consistent run)

| Gate | Result |
|---|---|
| `@norish/config` test | 755/755 (745 predicted baseline + 10 `units-config.test.ts` cases) |
| `@norish/shared-server` test | 556/556 |
| real `tsc --noEmit` (shared-server) | clean |
| `@norish/shared` test | 564/564 (345 baseline + 219 new) |
| `@norish/db` test | 183/183 (Postgres ran for real) |
| `pnpm typecheck` | 17/17 EXIT 0 |
| lint (config/shared/db/shared-server) | 0 errors each; warnings at each package's pre-existing baseline |
| `pnpm deps:cycles` | 1 pre-existing, UNRELATED cycle (`db-schema`), logged to `deferred-items.md` |
| `git diff pnpm-lock.yaml` | EMPTY |
| `git diff --stat packages/api/src/startup/seed-config.ts` | EMPTY |
| migrations / `meta/_journal.json` | untouched, 42 entries, last tag `0041_add_cook_source` |

## What W5 can now assume

- The unit vocabulary (`kilogram`/`fluid_ounce`/`pint`) and the rounding rule
  (`roundQuantity`) are both real, tested, and in `main` — the two W5 prerequisites carried
  since W3-04 §15.5 are DISCHARGED.
- The density-table flag rate on live-shaped Dutch data drops sharply — every named
  measurement-flagged ingredient that has a real USDA figure now resolves; 14 of the 25
  measured names still return `null` (no fabricated density), a W5 table-expansion item.
- **W5 itself is NOT started.** The only remaining prerequisite is Kiran's explicit
  sign-off. No `0042`, no backfill runner, no `cook_confidence`/`cook_review_needed`
  read or write, no review queue, no repair tool, no single-system extraction change and
  no prompt change appear anywhere in this wave's diff.
- Open director decision points for W5: (a) D-27-W5P-02 — whether to add `fluid_ounce`/
  `pint` to the automatic US ladder (a 2-line change, deliberately not done here); (b)
  D-27-W5P-06 — sourcing real USDA figures for feta/mozzarella/generic-grated-cheese to
  close the remaining Dutch cheese gap.

See `.planning/phases/27-cooklang/27-06-SUMMARY.md` for the plan-level task-by-task record,
`.planning/phases/27-cooklang/27-DECISIONS.md` for the full decision log (D-27-W5P-01
through 07), and `.planning/phases/27-cooklang/deferred-items.md` for the one out-of-scope
finding.
