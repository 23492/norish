# Deferred items — out of scope for the plan that discovered them

## From 27.1-03 (failure surfacing)

### Pre-existing `no` (Norwegian) locale translation backlog — 68 missing keys, unrelated to this plan

**Discovered during:** Task 3 (`pnpm i18n:check`).

**What:** `pnpm i18n:check` exits 1 because the `no` locale is missing 68 keys across
`auth`, `common` (one pre-existing key: `import.url.targetCookbook`), `navbar`, `recipes`,
and `settings` namespaces (household invite/permissions, WorkOS admin fields, the `join`
page, rating UI, share-panel visibility, etc.). None of the 68 are the new
`common.import.failure.*` keys this plan added — those are verified present and identical
in count across all 12 locales (see 27.1-03-SUMMARY.md).

**Why out of scope:** `git diff --stat` on every affected file (`no/auth.json`,
`no/navbar.json`, `no/recipes.json`, `no/settings.json`) is EMPTY — this plan touched only
`no/common.json`, adding exactly the 6 lines for the `failure` block. `git log` on
`no/common.json` shows its last substantive change was `dc59402f` (phase 27-05,
bulk-import progress), and `no/settings.json`'s last change was `1f684480` (an old
`Rc/0.19.0` release commit) — both long before this session. This is a pre-existing,
unrelated Norwegian-locale translation backlog spanning namespaces this plan never
touches (household settings, admin auth providers, the join flow, rating UI). Translating
68 unrelated keys into Norwegian is well outside IMPORT-REL-04's scope and was not
attempted, per the executor's scope-boundary rule (only auto-fix issues directly caused by
the current task's changes).

**Consequence for this plan's own gate:** the plan's `<verify>` block runs
`pnpm i18n:check` and expects EXIT 0; the command instead exits 1 due to this pre-existing
backlog. The plan's own, more specific acceptance-criteria commands (per-locale key-count
match for `import.failure`, and the de-formal/de-informal genuine-difference check) both
pass. See 27.1-03-SUMMARY.md for the full command output.

**Needs its own scheduling decision:** a dedicated `no` locale completeness pass (or a
decision to deprioritize Norwegian) is a separate piece of work, not scoped to any phase
27.1 plan.
