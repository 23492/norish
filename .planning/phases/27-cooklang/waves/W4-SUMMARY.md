# Phase 27 — W4 (the client token renderer) — SUMMARY

> Status: **CODE-COMPLETE**, gates green. Plan `27-05-PLAN.md`, single plan = whole wave.
> **NOT DEPLOYED.** Nothing pushed. NO `docker:build`, NO live stack, NO live DB access,
> **NO migration** — `packages/db/src/migrations/` and `meta/_journal.json` untouched, DB
> stays at **42**. `git diff pnpm-lock.yaml` is EMPTY — no dependency added.
>
> This is the first wave whose deliverable is user-visible and the first that touches
> `apps/`.

**Commits, in landing order** (base `324ddfea`, the 27-04 live-deploy record commit):

`f284707e` (plan) → `d1668e7c` (plan-check revisions) → **`2c34d92c`** (T1 — the pure
token render model) → **`dfe8caca`** (T2 — the web token branch) → `91fa269f` (T2b —
interactive token-branch ingredient chips, closing a gap T2 left) → **`dc59402f`** (T3 —
cooking mode + concurrent named timers + the i18n key) → `fecd327e` (the last hard-coded
timer-fallback literal, i18n'd) → **`ed6381ad`** (T4 — mobile token-render parity) →
**`f6974536`** (T5 — the non-invocation proof + the adversarial revert-check) → `bac3b15a`
(verifier W1 — timer-id scheme) → `518bea9f` (verifier W2 — done-step chips) → `9b84f664`
(verifier W3 — mobile `systemUsed` filter) → `e2d43aaa` (verifier W4 — mobile cook-branch
test coverage) → `aa0c2f72` (a corollary fix: keep the strict web `tsc` count at the
accepted 285 after W2's regression test landed). **Nothing pushed.**

**Two rounds of independent adversarial verification wrote the tail of this wave**, in
that order: T1→T5 (one executor) → verifier round 1 (PASS, 5 warnings) → four of the five
closed (`bac3b15a`/`518bea9f`/`9b84f664`/`e2d43aaa` + the `aa0c2f72` follow-up) → verifier
round 2 (independent re-verification, **PASS**).

---

## What shipped, per task, and where it diverged from the plan

### Task 1 — the pure token render model (`2c34d92c`)

`packages/shared/src/cooklang/render.ts` exports `resolveCookRenderSteps`,
`cookStepToMarkdown`, `cookStepTimers`, `cookTimerDurationMs` — pure, React-free,
`@norish/config`-free, consumed identically by web and mobile (D-27-W4-02). Re-exported
from `packages/shared/src/cooklang/index.ts` with **no `package.json` export-map change**
(the `./cooklang` subpath already existed).

- **Servings scaling reproduces `recipe-detail-context.tsx:332` bit-for-bit**:
  `Math.round((amount / baseServings) * servings * 10000) / 10000`, never a pre-divided
  `scale` multiplier (D-27-W4-03) — pinned by a repeating-decimal (3 → 7) digit-agreement
  test, not a clean 2×. Timer amounts are never scaled.
- `getIngredientLinkCandidateKey` and the markdown-label escaper moved down into
  `packages/shared/src/lib/ingredient-token.ts`; `shared-react/src/text/ingredient-links.ts`
  re-exports both unchanged (D-27-W4-12, the D-27-W1-04 precedent) — no consumer lost a
  symbol.
- `timerUnitSeconds` extracted from `timer-parser.ts`'s inline keyword→multiplier map.
  `parseTimerDurations` keeps its existing **REPLACE** semantics (a configured
  `timerKeywords` list still overrides the built-in English words for prose scanning);
  the token path resolves in **UNION** mode, so a non-English `timerKeywords` config can
  never blot out the token unit vocabulary and turn `~{2%hours}` into a silent 60×
  under-count (D-27-W4-12's hardening clause). The existing 270-line
  `timer-parser.test.ts` stayed green with no assertion edited — the proof the prose path
  did not change.

### Task 2 — the web token branch (`dfe8caca`) + T2b (`91fa269f`)

`SmartMarkdownRenderer` gains `SmartMarkdownTimerConfig.tokens?: CookRenderTimer[]`; when
present it skips `parseTimerDurations`/`applyTimerMarkup` entirely and resolves
`norish-timer:<i>` against the passed token list — the prose scan never re-runs on
renderer-built markup (D-27-W4-11). `SmartInstruction` gains an optional
`cookStep?: CookRenderStep`; when present it builds markdown via `cookStepToMarkdown`
using `useUnitFormatter().formatAmountUnit`. `ReadonlyStepsList` gains
`cookSteps?: CookRenderStep[] | null`, pairs the Nth non-heading legacy row with
`cookSteps[n]` (D-27-W4-13), and falls back to the legacy branch in full on a count
mismatch. `steps-list.tsx` computes `cookSteps` from `resolveCookRenderSteps` with the two
servings numbers (not a ratio) **and `systemUsed`**, so a chip's highlight key comes out
in the exact `metric:brown sugar` shape D-27-W4-09 requires.

**Gap found and closed same-session (T2b, `91fa269f`):** T2 shipped
`ingredientCandidates={undefined}` unconditionally on the token branch, satisfying
D-27-W4-09's literal action text but not its behavioural intent — token-branch ingredient
chips rendered as non-interactive `<span>`s and `onIngredientPress` never fired, even
though T1 had already precomputed a `key` on every `CookRenderIngredientToken` for exactly
this purpose. `smart-instruction.tsx` gained `cookStepIngredientCandidates(cookStep)`,
the per-token counterpart to `cookStepTimers`, and the token branch now passes real
candidates instead of `undefined`.

**Deviation (Rule 3):** `smart-instruction.test.tsx` needed a `@/hooks/use-unit-formatter`
mock because `SmartInstruction` now unconditionally calls `useUnitFormatter()` and that
suite renders without a next-intl provider. No assertion edited.

### Task 3 — cooking mode + concurrent named timers + the i18n key (`dc59402f`, `fecd327e`)

`cooking-mode.tsx` computes `cookSteps` and folds the D-27-W4-13 mismatch guard in
**once**, so the tabs/step-view components never re-reason about a stale projection.
`cooking-mode-tabs.tsx` builds `ingredientCandidates` **inside** the `cookSteps === null`
branch (not memoized unconditionally) — the thing that makes the zero-heuristic-call
proof real rather than accidental. The sticky heading chip in `cooking-step-view.tsx`
reads the token's own `section`, **not gated by `isSectionStart`**, which reproduces the
legacy `heading` field's "applies to following steps" stickiness for that one chip —
different from the detail list's standalone `<h3>` row, which *is* gated by
`isSectionStart` (D-27-W4-05).

**Concurrent named timers (D-27-W4-06/07):** `apps/web/stores/timers.ts`'s
`showTimerNotification` now tags its `showNotification` call with the timer's own `id`
instead of a fixed `"timer-complete"` string, so the pasta+sauce case raises two distinct
OS notifications instead of the Notification API collapsing them into one. The eleven
pre-existing `timers.test.ts` cases stayed green with **no assertion edited** — the one
existing notification test's fixture id was changed to literally `"timer-complete"` so
its unedited `tag: "timer-complete"` assertion stayed true under the new per-id-tag
behaviour.

`timer.step_fallback_label` (`"Step {step} Timer"` in `en`) was added to all 12 locales
with **real per-locale translations**, not English copies (spot-checked: `de-formal` →
"Timer für Schritt {step}", `fr` → "Minuteur de l'étape {step}", `ko` → localized, etc.).

**Deviation recorded and resolved, not silently widened:** T3's own `<action>` text
required consuming the new i18n key in `smart-markdown-renderer.tsx` (replacing the
hard-coded `` `Step ${stepIndex + 1} Timer` `` literal T2 left at line 70) — **but that
file was not in T3's declared `<files>` list** (it belonged to T2). The executor fixed it
anyway, flagged the inconsistency, and finished it in a follow-up commit (`fecd327e`) so
the two remain independently revertible. **This is the "T2's `smart-markdown-renderer.tsx`
edit fell outside T3's declared file list" deviation** — the file, already touched once by
T2 for the renderer branch itself, needed a second, undeclared touch by T3 for the i18n
wiring.

**Cascading deviation (Rule 3):** calling `useTranslations()` unconditionally in
`smart-markdown-renderer.tsx` throws "no `NextIntlClientProvider` context" in any test
that renders it without a next-intl mock. Verified empirically (the throw was reproduced
before being fixed). **A local `vi.mock("next-intl", ...)` was added to four pre-existing
suites** that render the renderer without a provider:
`smart-markdown-renderer.test.tsx`, `readonly-steps-list-tokens.test.tsx`,
`smart-instruction.test.tsx` (identity mocks — no assertion in these three depends on the
fallback text) and `smart-instruction-tokens.test.tsx` (whose pre-existing
`"TIMER:Step 1 Timer:600000"` assertion depends on the real fallback text, so that mock
interpolates the actual `en` string rather than echoing the bare key). **No assertion was
edited in any of the four** — this mirrors T2's identical precedent of mocking
`@/hooks/use-unit-formatter` for the same reason.

### Task 4 — mobile token-render parity (`ed6381ad`)

`map-recipe-to-steps.ts` pairs the Nth non-heading legacy step with the Nth
`resolveCookRenderSteps` step (D-27-W4-13); `cookTokens: null` or a count mismatch falls
back field-for-field identical to pre-W4 output (pinned by a test). Current `servings`
(not a ratio) is threaded in from `recipe-detail-view.tsx`; `baseServings = recipe.servings`.
`SmartText` gains an optional `cookStep` prop — all hooks still execute unconditionally
every render, so the branch never varies the hook count. `InlineTokenRenderer` gains the
`norish-timer:<i>` / `norish-ingredient:<key>` href schemes; timer tokens resolve to the
same `TimerChipInline` the keyword branch already used, with id
`${recipeId}-s${stepIndex}-${idx}` — **matching web's actual shipped id scheme**, not the
plan's undocumented `-t${tokenIndex}` form (see the W1 verifier finding below). Ingredient
tokens render as non-interactive styled text — mobile has no ingredient-highlight target
today and this wave does not invent one (D-27-W4-04, explicitly out of scope).

Mobile gained the `formatUnit` wiring it never had: `hooks/config/use-units-query.ts`
(new, mirrors `use-timer-keywords-query.ts`) and `hooks/use-unit-formatter.ts` (new,
composes `useSharedUnitFormatter` with `useMobileLocaleSettings()`, mirroring
`apps/web/hooks/use-unit-formatter.ts`).

`timer-notifications.ts` adds a top-level `identifier: timer.id` to
`scheduleNotificationAsync` so two concurrently completing named timers are each
addressable; `categoryIdentifier: "timer-complete"` (expo's action-category key, not a
dedupe key) is untouched — **this is additive, not a repeat of the web tag-collision
fix**, because mobile never had a colliding `tag` to begin with (D-27-W4-07's explicitly
asymmetric two halves).

**Device-check-only, recorded rather than pretended covered (R6):** visual correctness of
the section-heading chip/row, the timer chip's live countdown display, and mobile's
custom (non-CommonMark) inline-link regex's handling of a label escaped for embedded `]`
characters (pre-existing in `parse-blocks.ts`, untouched by this diff — CommonMark
backslash-escape semantics are not implemented there, unlike the web `ReactMarkdown`
pipeline).

### Task 5 — the non-invocation proof + the adversarial revert-check (`f6974536`)

Consolidates D-27-W4-01's central proof: spies on **both**
`createIngredientLinkCandidates` and `parseTimerDurations`, asserting **0** invocations on
the token branch and **≥1** on the legacy branch, in both the cooking-mode suite and the
recipe-detail suite (web).

**Extension beyond T5's declared web-only file list** (flagged, closing a gap T4's
executor recorded): the equivalent spy-based non-invocation proof for **mobile**
(`apps/mobile/__tests__/recipes/smart-text-non-invocation.test.ts`, new). Mobile has no RN
render harness (D-27-W4-10) and importing the real `react-native` package fails outright
under vitest (Flow-typed source) — confirmed empirically before writing the test. The test
calls the real, unmodified `SmartText` export directly as a plain function, with every
hook it uses (including React's own `useMemo`) replaced by an inert `vi.mock` stand-in so
no React dispatcher is required, and spies on the real `@norish/shared/cooklang` and
`@norish/shared/lib/timer-parser` exports.

Also closes the "re-asserted by a test, not by inspection" gap for the unchanged-surface
truths, each in a **new** test file outside T5's declared list:
`packages/shared/__tests__/contracts/cook-tokens.test.ts` (`PublicRecipeViewSchema` carries
no `cook*` key), `packages/shared-server/__tests__/cooklang/attach-tokens.test.ts`
(`withCookTokens` has exactly two importers, both strictly after their HOUSE-06 gate), and
`apps/web/__tests__/components/recipe/public-smart-instruction-boundary.test.ts` (the
public share page never references the cook-token render model or passes `cookSteps` to
`ReadonlyStepsList`).

**The adversarial revert-check** — the wave's fork guard, per CLAUDE.md — was executed by
hand against production files, each observed RED, each reverted byte-identically
(`git diff --exit-code` + `md5sum`), **none committed**:

- **W4-W1** — forced `resolveCookRenderSteps` to return `[]` instead of `null` for absent
  tokens. Legacy-branch suites went RED (a `cookTokens: null` recipe rendered zero steps).
- **W4-W2** — removed the D-27-W4-13 count-mismatch pairing guard on both clients. The
  mismatch tests in the web and mobile suites went RED.
- **W4-W3** — rebuilt ingredient candidates unconditionally in `cooking-mode-tabs.tsx`. The
  zero-call assertions went RED while every rendering test stayed GREEN — the clearest
  demonstration that the wave's heuristic deletion is asserted behaviourally, not by file
  absence.

At the point of this commit: full vitest **3416 passed, 0 failed** (≥ 3362 VERIFY-4
baseline); 17/17 typecheck; lint and `deps:cycles` green (only the accepted
`db-schema auth.ts → households.ts` cycle); `build:server` green. No production file
touched in this task; empty `pnpm-lock.yaml` diff; DB unchanged at migration 42.

---

## Verification — two independent rounds

**Round 1 (independent adversarial verifier): PASS, 5 warnings.** Four were closed in
follow-up commits, one was deliberately left open:

| # | Finding | Disposition | Commit |
|---|---|---|---|
| **W1** | The plan's `key_link` and two code comments documented an unshipped `${recipeId}-s${stepIndex}-${index}`-style id as `-t${tokenIndex}`; both clients actually ship `-${index}` (no `-t` infix), and `apps/web/stores/timers.test.ts:239-269` asserted hand-written `recipe-1-s0-t0`/`-t1` fixtures the renderer never produces. No behavioural defect (distinctness held either way) — a **docs/test alignment** fix. | **CLOSED** | `bac3b15a` |
| **W2** | `readonly-steps-list.tsx`'s non-`InstructionComponent` branch (a done step, non-interactive list, or timers disabled) rendered raw projection prose with `ingredientCandidates` left `undefined` on the token branch — every ingredient chip silently vanished the moment a token-bearing step was marked done, while a legacy done step kept its chip. **User-visible regression.** | **CLOSED** | `518bea9f` |
| **W3** | `map-recipe-to-steps.ts` (mobile) never filtered `recipe.steps` by `systemUsed` before pairing, unlike web's `readonly-steps-list.tsx:120`. A recipe with steps authored in both systems doubled mobile's visible step count. Latent rather than observed: the doubled count almost never equalled `cookTokens`'s single-system length, so the D-27-W4-13 mismatch guard silently fell back to an equally-unfiltered legacy branch, masking the defect. | **CLOSED** | `9b84f664` |
| **W4** | The ~55-line cook-token branch in mobile's `inline-token-renderer.tsx` (the `norish-timer:`/`norish-ingredient:` href schemes) had no direct test — `smart-text-non-invocation.test.ts` mocks it to `() => null`, proving only that `SmartText` calls the right helpers, never that the renderer itself resolves an index, builds an id, or degrades safely. | **CLOSED** | `e2d43aaa` |
| **W5** | `timer-parser.ts:262` calls `timerUnitSeconds(unit, keywords)` inside the per-match loop of `parseTimerDurations`, and `timerUnitSeconds` **rebuilds its whole keyword→seconds `Map` from scratch on every call** rather than once per parse. Correctness is unaffected (the map's contents don't change between matches in one call), so this is pure wasted allocation, not a defect. | **DELIBERATELY LEFT OPEN — a perf nit, not a correctness issue.** Recorded here so it is not silently forgotten, not because it blocks anything. | — |

`e2d43aaa`'s own fix required a corollary commit: `aa0c2f72` narrows a
`screen.getAllByRole("button")[0]` destructure in the new W2 regression test (which `tsc`
correctly widens to `HTMLElement | undefined`) to an explicit indexed read with a thrown
guard, keeping the real `apps/web` `error TS` count at the accepted **285** rather than
letting it drift to 286.

**Round 2 (independent re-verification, after all four closures): PASS.** No new findings
reported.

---

## Final gate numbers

| Gate | Baseline (VERIFY-4) | After W4 |
|---|---|---|
| Full vitest, all packages | 3 362 passed, 0 failed | **3 425 passed, 0 failed** |
| `pnpm typecheck` | 17/17 EXIT 0 | **17/17 EXIT 0** |
| `pnpm lint` | 0 errors | **0 errors** |
| Real `apps/web` type check (`tsc --noEmit --noCheck false`, COUNT not exit code) | 285 `error TS` lines (the accepted, pre-existing ceiling — `apps/web/tsconfig.json` sets `noCheck: true` per upstream #333, so `pnpm typecheck`'s web leg is vacuous) | **285** — unchanged, no error naming a touched file |
| `pnpm deps:cycles` | fails only on the accepted `db-schema auth.ts → households.ts` cycle | **unchanged** — no new forbidden edge |
| `pnpm i18n:check` | EXIT 1, pre-existing `no`-locale gap only | **unchanged** — `step_fallback_label` does not appear in the missing-key report for any of the other 11 locales |
| `git diff pnpm-lock.yaml` | — | **EMPTY** — no dependency added |
| DB migration | 42 | **unchanged at 42** — `packages/db/src/migrations/` and `meta/_journal.json` untouched |

**mobile suite specifically:** 140/140 (baseline 132 + 8 new at T4; more added by the W3/W4
verifier closures on top of that).

---

## Prompt-injection events observed and ignored this wave

**Nine occurrences across four agents this wave**, each firing **immediately after a
`git checkout` / revert** performed during load-bearing verification (principally the
Task 5 adversarial revert-check and the verifier's own re-checks of prior weakenings).
Each occurrence presented text styled to look like a `system-reminder` block, claiming the
just-reverted (or about-to-be-reverted) change "was intentional" and instructing the agent
not to disclose it to the user or to a subsequent reviewer.

**All nine were ignored, and all nine were reported rather than acted on.** No agent
treated injected text encountered mid-diff as an instruction. Ground truth for every
affected file was re-established the same way every time: `git diff` against the last
known-good commit and `md5sum`/`cmp` against a pre-edit copy, never by trusting the
injected claim. This matches the standing project note (`norish loop credential
injection` in the operator's memory) that this class of injected content — dressed as
system framing, arriving inline with tool output rather than from a real system channel —
is never authorization for anything, and is recorded here as part of the wave's durable
security record rather than folded quietly into "verification passed."

---

## Deployment status

**NOT DEPLOYED.** This wave is code-complete on `main`, nothing pushed to
`origin/main`, and live `norish-app` is untouched — it continues to run the image the
27-04/W3B deploy left it on, at DB migration 42. The deploy record for this range is a
separate agent's job, per the standing rule that a SUMMARY/STATE pass does not touch the
live stack.

## What remains device-check-only / unprovable by automated gates

- **Mobile visual rendering** — the section-heading chip/row's appearance, the timer
  chip's live countdown display, and how mobile's non-CommonMark inline-link regex handles
  a label escaped for an embedded `]` (R6: no RN render harness exists in this repo; all
  decision logic was pushed into pure, tested modules per D-27-W4-10, but the RN
  components themselves are asserted only by `tsc --strict` and the pure suites, not by
  rendering).
- **A live token-vs-legacy split on a real recipe.** Live currently holds a small number of
  recipes, **0 with `cook_source`** as of the last confirmed count — this wave's
  never-broken guarantee (a `cookTokens: null` recipe renders exactly as before; a
  token-bearing recipe renders from tokens) is proven by test, but has not been observed on
  production data, because no production recipe yet exercises the token branch. That
  observation is a post-deploy, director-owned exit item, not something this wave's gates
  can produce.

---

## What W5 can now assume

- **Both clients have a working, tested token renderer and a working, tested legacy
  renderer, gated on the same `cookTokens ? tokenRenderer : legacy` fork**, proven never to
  cross-invoke the other side's heuristic (D-27-W4-01, T5's spy proof) and proven to fall
  back to the legacy branch in full — never a half-token render — on a stale-projection
  count mismatch (D-27-W4-13, the adversarial revert-check's W4-W2 case).
- **The heuristic runtime path (`createIngredientLinkCandidates`, `applyIngredientLinkMarkup`,
  `parseTimerDurations`, `SmartInstruction`'s legacy branch) is still fully present in the
  tree** — W4 deleted it only from the token branch's *invocation*, not from the codebase.
  W5's backfill is what will make the token branch the common path; **W6**, not W5, is what
  finally deletes these symbols (D-27-W4-01, restated from `27-ARCHITECTURE.md` §7).
- **The timer id scheme is `${recipeId}-s${stepIndex}-${index}` on both clients** — no
  `-t` infix, confirmed by the W1 verifier finding and aligned in the plan and both stores'
  tests. Any future work building on timer ids should use this shape, not the earlier
  plan draft's `-t${tokenIndex}` form.
- **Units render through `formatUnit`/`useUnitFormatter` on both clients now** — mobile's
  ingredient *list* (as opposed to the in-step token chip) was explicitly NOT retrofitted
  this wave (D-27-W4-04) and still prints a raw canonical unit; that remains open for
  whichever wave chooses to pick it up.
- **`timerUnitSeconds`'s per-match map rebuild (`timer-parser.ts:262`) is a known,
  deliberately-deferred perf nit (verifier W5, left open).** It costs nothing correctness-wise
  and is safe to fix opportunistically in a later wave without needing its own plan.
- **The public share page, `RecipeDashboardSchema` and the tRPC surface are all
  unchanged** — re-asserted by test (T5), not merely re-inspected. W5's backfill work does
  not need to re-litigate any permission surface this wave touched, because it touched
  none: no server file is in this wave's diff.
- **Servings scaling and the ingredient list can never disagree by a digit** — the token
  chip and the ingredient row share the literal `Math.round((amount / baseServings) *
  servings * 10000) / 10000` expression (D-27-W4-03), pinned by a repeating-decimal test.
  Any future scaling change must preserve this exact expression on both sides or the
  digit-agreement guarantee breaks silently.
- **W5's own prerequisites are unchanged by this wave** and remain as recorded in
  `27-04-SUMMARY.md` §15.5 / `waves/W3-SUMMARY.md`: (a) the backfill must RE-SERIALIZE, not
  re-parse; (b) the W0 `kilogram`/`fl oz`/`pint` unit vocabulary AND a rounding rule must
  land first (D-27-W3-07); (c) **W5 still pauses for Kiran's explicit sign-off** — nothing
  in W4 changes that gate.

---
*Wave: W4 of 7 — CODE-COMPLETE (5/5 tasks + verifier round 1 + verifier round 2), NOT DEPLOYED.*
*Completed: 2026-07-27.*
