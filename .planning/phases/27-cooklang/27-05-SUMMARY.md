---
phase: 27-cooklang
plan: 05
subsystem: client
tags: [cooklang, cook-tokens, renderer, cooking-mode, timers, i18n, mobile, web]

requires:
  - phase: 27-cooklang (W1)
    provides: CookTokens contract, structuredToCooklang, parseCookSource read model
  - phase: 27-cooklang (W2)
    provides: cook_source/cookTokens on recipes.get/getEditable, strictly post-access-check
  - phase: 27-cooklang (W3/W3B)
    provides: the first real .cook producer (extraction), the bounded pooled-child parse, escaping at the serializer
provides:
  - "@norish/shared/cooklang render.ts — resolveCookRenderSteps / cookStepToMarkdown / cookStepTimers / cookTimerDurationMs, pure, shared by web + mobile"
  - "The web token branch: SmartMarkdownRenderer, SmartInstruction, ReadonlyStepsList, cooking mode, all conditional on cookTokens"
  - "Concurrent NAMED timers in cooking mode (web) with per-timer notification identity on both clients"
  - "Mobile token-render parity: map-recipe-to-steps pairing, SmartText/InlineTokenRenderer token branch, formatUnit wiring mobile never had"
  - "The proof that the heuristic runtime path is provably UNCALLED on the token branch (D-27-W4-01), and that a cookTokens:null recipe is byte-for-byte unchanged"
affects: [27-cooklang W5 backfill, 27-cooklang W6 contract]

tech-stack:
  added: []   # no new dependency; git diff pnpm-lock.yaml is empty
  patterns:
    - "Conditional token branch, never a parallel renderer — cookStepToMarkdown feeds the EXISTING markdown pipeline (D-27-W4-11)"
    - "Delete the heuristic from the DEFAULT, not from the tree, until backfill makes it safe (D-27-W4-01)"
    - "Pure render/pairing modules so mobile (no RN render harness) still gets real test coverage (D-27-W4-10)"

key-files:
  created:
    - packages/shared/src/cooklang/render.ts
    - packages/shared/src/lib/ingredient-token.ts
    - apps/mobile/src/hooks/config/use-units-query.ts
    - apps/mobile/src/hooks/use-unit-formatter.ts
  modified:
    - apps/web/components/shared/smart-markdown-renderer.tsx
    - apps/web/components/recipe/smart-instruction.tsx
    - apps/web/components/recipes/readonly-steps-list.tsx
    - apps/web/app/(app)/recipes/[id]/components/steps-list.tsx
    - apps/web/app/(app)/recipes/[id]/components/cookingmode/*.tsx
    - apps/web/stores/timers.ts
    - apps/mobile/src/lib/recipes/map-recipe-to-steps.ts
    - apps/mobile/src/components/recipe-detail/text-renderer/*.tsx
    - apps/mobile/src/stores/timer-notifications.ts
    - packages/shared/src/lib/timer-parser.ts
    - packages/shared-react/src/text/ingredient-links.ts
    - packages/i18n/src/messages/*/common.json (all 12 locales)

key-decisions:
  - "The shipped timer id is ${recipeId}-s${stepIndex}-${index} on BOTH clients — no -t infix. The plan draft's -t${tokenIndex} form was never implemented; a verifier caught the docs/tests still describing it and it was aligned to the shipped form (bac3b15a), not the other way around."
  - "T2's ingredientCandidates={undefined} literal instruction was corrected same-session (T2b) to pass real per-token candidates via the new cookStepIngredientCandidates helper — chips must stay interactive, not just visually correct."
  - "next-intl mocks were added to 4 pre-existing test files (smart-markdown-renderer.test.tsx, readonly-steps-list-tokens.test.tsx, smart-instruction.test.tsx, smart-instruction-tokens.test.tsx) because T3 made smart-markdown-renderer.tsx call useTranslations() unconditionally; no assertion in any of the four was edited."
---

# 27-05 — Wave W4: the client token renderer — SUMMARY

**Status: CODE-COMPLETE, all 5 tasks + two independent verification rounds. NOT DEPLOYED.**
Requirement: COOK-01. Nothing pushed to `origin/main`. No `docker:build`, no live stack, no
live DB touched. **NO MIGRATION** — DB stays at **42**. `git diff pnpm-lock.yaml` EMPTY.

This plan **is** the whole of wave W4 (unlike W3, which spanned plans 27-03 and 27-04).
**The substantive record — every task's mechanism, the plan divergences, both verification
rounds' findings, the full gate table, the prompt-injection record and the "What W5 can now
assume" hand-off — lives in
[`waves/W4-SUMMARY.md`](waves/W4-SUMMARY.md)**, continuing the wave-summary convention
`waves/W3-SUMMARY.md` established. This file is the plan-level index.

## Tasks → commits

| Task | Commit | Result |
|---|---|---|
| 1. Pure token render model (`render.ts`, `ingredient-token.ts`, `timerUnitSeconds`) | `2c34d92c` | New `render.test.ts`; `timer-parser.test.ts` unedited and green; two helpers moved down and re-exported, no symbol lost. |
| 2. Web token branch — renderer, `SmartInstruction`, `ReadonlyStepsList` | `dfe8caca` | Token branch renders from `cookTokens`; legacy branch unedited and green. |
| 2b. Interactive token-branch ingredient chips (gap closure) | `91fa269f` | Chips regain `onIngredientPress` via `cookStepIngredientCandidates`. |
| 3. Cooking mode + concurrent named timers + i18n key | `dc59402f` | Two named timers per step, distinct notification tags; `timer.step_fallback_label` in all 12 locales. |
| — the last hard-coded English timer-fallback literal | `fecd327e` | `smart-instruction.tsx`'s fallback now goes through the same i18n key. |
| 4. Mobile token-render parity | `ed6381ad` | `map-recipe-to-steps` pairing, `SmartText`/`InlineTokenRenderer` token branch, `formatUnit` wiring mobile never had. |
| 5. Non-invocation proof + adversarial revert-check | `f6974536` | Zero-call spy proof on both clients; W4-W1/W4-W2/W4-W3 weakenings executed, RED, reverted byte-identically, none committed. |
| verifier W1 | `bac3b15a` | Timer-id scheme docs/tests aligned to the shipped `-${index}` form. |
| verifier W2 | `518bea9f` | Ingredient chips no longer vanish on a done token step. |
| verifier W3 | `9b84f664` | Mobile step pairing filters by `systemUsed` before mapping (was double-counting). |
| verifier W4 | `e2d43aaa` | Direct test coverage added for mobile's `InlineTokenRenderer` cook-token branch. |
| corollary | `aa0c2f72` | Keeps the strict `apps/web` `tsc` count at the accepted 285 after W2's regression test. |

Base `324ddfea` (the 27-04 live-deploy record commit).

## must_haves — status

| Truth | Status |
|---|---|
| A token-bearing recipe renders every step from `cookTokens`, not a prose scan; the heuristic (`createIngredientLinkCandidates`, `parseTimerDurations`) is called **zero** times on that branch | **MET** — spy-proven in both cooking-mode and recipe-detail suites, web and mobile |
| A `cookTokens: null` recipe renders byte-for-byte as before | **MET** — no pre-existing assertion edited; W4-W1 weakening proved the guard is load-bearing |
| Servings scaling never disagrees with the ingredient list by a digit | **MET** — identical `Math.round((amount/baseServings)*servings*10000)/10000` expression, repeating-decimal test |
| Two named timers from one step run concurrently and notify independently | **MET** — web (tag fix) and mobile (additive `identifier`) both proven, D-27-W4-07's two different mechanisms |
| Units render through `formatUnit` on both clients | **MET** — mobile gained the wiring it lacked; mobile's ingredient *list* deliberately NOT retrofitted (D-27-W4-04) |
| No migration, no lockfile change, no permission surface moved, no W5/W6 artefact in the diff | **MET** |
| Both fork guards watched to fail and restored byte-identically | **MET** — W4-W1/W4-W2/W4-W3, none committed |

## Verification, in one line

**Round 1 (independent adversarial verifier): PASS, 5 warnings — 4 closed** (timer-id
scheme alignment, done-step chip regression, mobile `systemUsed` double-count, missing
mobile renderer-branch test coverage) **and 1 deliberately left open** (a per-match
keyword-map rebuild in `timer-parser.ts:262` — a perf nit, not a defect). **Round 2
(independent re-verification): PASS**, no new findings. Full detail, including the exact
finding text and disposition table: `waves/W4-SUMMARY.md` § "Verification — two independent
rounds".

## Gates

Full vitest **3 425 passed / 0 failed** (VERIFY-4 baseline: 3 362); `pnpm typecheck` 17/17;
`pnpm lint` 0 errors; real `apps/web` `tsc --noEmit --noCheck false` error-line count **285**
(the accepted, pre-existing ceiling — `noCheck: true` in `apps/web/tsconfig.json` per
upstream #333 makes the normal typecheck leg vacuous for web); `pnpm deps:cycles` fails only
on the accepted `db-schema auth.ts → households.ts` cycle; `pnpm i18n:check` fails only on
the pre-existing `no`-locale gap; `git diff pnpm-lock.yaml` EMPTY; DB unchanged at migration
**42**.

## Prompt-injection events (durable record)

**Nine occurrences across four agents this wave**, each firing immediately after a `git
checkout`/revert performed during load-bearing verification, presenting fake
`system-reminder`-styled text claiming the reverted change "was intentional" and
instructing the agent not to disclose it. **All nine were ignored and reported**; ground
truth was re-established each time via `git diff`/`md5sum` against the known-good commit,
never by trusting the injected text. Full detail: `waves/W4-SUMMARY.md` § "Prompt-injection
events observed and ignored this wave".

## Deployment status

**NOT DEPLOYED.** Code-complete on `main`, nothing pushed, live `norish-app` untouched at
the image the 27-04/W3B deploy left it on, DB at migration 42. The deploy record is a
separate agent's responsibility.

## Device-check-only / unprovable by automated gates

Mobile visual rendering (the section-heading chip/row's appearance, the timer chip's live
countdown, mobile's non-CommonMark inline-link escaping) and a live token-vs-legacy split
observed on a real recipe — live currently has 0 recipes with `cook_source`, so this
wave's never-broken guarantee is proven by test but not yet observed in production. Both
are director/post-deploy exit items, not something this wave's own gates can produce.

---
*Plan 27-05 = Wave W4 of 7 — CODE-COMPLETE (5/5 tasks), NOT DEPLOYED.*
*Completed: 2026-07-27.*
