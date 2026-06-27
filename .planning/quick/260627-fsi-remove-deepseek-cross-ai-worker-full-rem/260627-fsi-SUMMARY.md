---
phase: 260627-fsi
plan: "01"
subsystem: tooling/cross-ai
tags: [cross-ai, deepseek, cleanup, antigravity]
dependency_graph:
  requires: []
  provides: [antigravity-only-cross-ai-worker]
  affects: [tooling/cross-ai/worker.sh, .planning/PROJECT.md]
tech_stack:
  added: []
  patterns: [antigravity-only-dispatcher, stale-env-warn-and-proceed]
key_files:
  created: []
  modified:
    - tooling/cross-ai/worker.sh
    - tooling/cross-ai/install-scheduler.sh
    - tooling/cross-ai/README.md
    - tooling/cross-ai/antigravity-executor.sh
    - .planning/PROJECT.md
  deleted:
    - tooling/cross-ai/deepseek-executor.sh
decisions:
  - Antigravity is now the sole cross-AI worker; stale NORISH_CROSS_AI_WORKER warns and proceeds (never exits non-zero in worker-selection path)
  - deepseek-executor.sh removed via git rm; all DeepSeek references purged from tooling/cross-ai/
  - PROJECT.md Key Decisions row updated to record full removal (2026-06-27), superseding the 2026-06-22 keep-disabled decision
metrics:
  duration: ~5 minutes
  completed: 2026-06-27
  tasks_completed: 3
  files_changed: 6
---

# Phase 260627-fsi Plan 01: Remove DeepSeek Cross-AI Worker (Full Removal) Summary

**One-liner:** Fully removed the DeepSeek cross-AI worker — antigravity-executor.sh is now the unconditional dispatcher target; stale env vars warn to stderr and proceed, eliminating the exit-64 footgun.

## Tasks Completed

| Task | Name | Commit | Files |
|------|------|--------|-------|
| 1 | Make worker.sh antigravity-only, delete deepseek-executor.sh | ccaf371c | worker.sh (modified), deepseek-executor.sh (deleted) |
| 2 | Strip DeepSeek from install-scheduler.sh, README.md, antigravity-executor.sh | a943462c | install-scheduler.sh, README.md, antigravity-executor.sh |
| 3 | Update PROJECT.md Key Decisions row | 1daebc8c | .planning/PROJECT.md |

## What Changed

### Task 1 — worker.sh + deepseek-executor.sh

- Removed the `case "$WORKER" in ... esac` block entirely (antigravity, deepseek, and catch-all `*) exit 64` branches).
- Replaced with: `EXECUTOR="$HERE/antigravity-executor.sh"` unconditionally.
- Added stale-env-var guard: if `$WORKER` is non-empty and not `antigravity`, prints `WARNING: NORISH_CROSS_AI_WORKER=$WORKER ignored; antigravity is the only cross-AI worker` to stderr and proceeds. Never exits non-zero on an unknown value — this was the bug that broke phase execution when `NORISH_CROSS_AI_WORKER=deepseek` was left in the environment.
- Kept the `[ -x "$EXECUTOR" ] || { ... exit 64; }` guard immediately after.
- Hard-coded `antigravity` in the SUMMARY provenance heredoc line (was `$WORKER`).
- Removed header comment lines about worker selection and DeepSeek.
- Deleted `tooling/cross-ai/deepseek-executor.sh` via `git rm`.

### Task 2 — install-scheduler.sh, README.md, antigravity-executor.sh

- **install-scheduler.sh**: Rewrote the `NORISH_CROSS_AI_WORKER` comment from "worker for the drain (default antigravity)" to "(kept for cron-line compatibility; antigravity is the only worker)". Comment-only change; script logic and crontab line unchanged.
- **README.md**:
  - Removed the `deepseek` row from the Workers table.
  - Rewrote the "Default = Antigravity..." paragraph to state antigravity is the sole worker (dropped DeepSeek disabled clause).
  - Fixed the "Mandatory review" intro: "Worker models (Gemini Flash / DeepSeek)" → "The worker model (Gemini Flash)".
  - Fixed `NORISH_CROSS_AI_WORKER` purpose cell: `` `antigravity` \| `deepseek` `` → `antigravity (the only worker)`.
  - Removed the entire **DeepSeek worker** env-var sub-table (DEEPSEEK_API_KEY, NORISH_CROSS_AI_BASE_URL, NORISH_CROSS_AI_MODEL rows + heading).
  - Rewrote "One-time box setup" bullet to drop the `claude` (DeepSeek path) root-caveat, keeping only the agy/non-root guidance.
- **antigravity-executor.sh**: Rewrote comment parenthetical from "DeepSeek needs a paid API key" to "a third-party API key would cost extra". Comment-only; no logic touched.

### Task 3 — PROJECT.md

Updated the 2026-06-22 "Sole worker = Antigravity..." Key Decisions row:
- Title now includes "(superseded 2026-06-27: DeepSeek fully removed)".
- Rationale trail records: "DeepSeek executor and all `tooling/cross-ai/` DeepSeek references were FULLY REMOVED (2026-06-27), superseding the earlier keep-disabled decision — antigravity is now the sole cross-AI worker."
- Removed the `NORISH_CROSS_AI_ALLOW_DEEPSEEK=1` clause.
- Original agy/quota-aware rationale retained verbatim.

## Acceptance Gates — All PASSED

| Gate | Command | Result |
|------|---------|--------|
| 1 | `grep -rni deepseek tooling/cross-ai/` | No output (PASS) |
| 2 | `bash -n tooling/cross-ai/worker.sh tooling/cross-ai/install-scheduler.sh` | Exit 0 (PASS) |
| 3 | `bash -n tooling/cross-ai/antigravity-executor.sh` | Exit 0 (PASS) |
| 4 | `test ! -e tooling/cross-ai/deepseek-executor.sh` | File absent (PASS) |
| 5 | `git status --porcelain packages/ apps/` | Empty (PASS) |
| 6 | `grep -q 'antigravity-executor.sh' worker.sh && grep -q '[ -x "$EXECUTOR" ]' worker.sh` | Both present (PASS) |
| 7 | `printf '' \| NORISH_CROSS_AI_WORKER=deepseek bash worker.sh; echo exit=$?` | WARNING to stderr, exit=65 (empty-stdin guard), not 64 (PASS) |

## Deviations from Plan

None — plan executed exactly as written.

## Known Stubs

None.

## Threat Flags

None — this change is a pure removal of disabled/dead code; no new network endpoints, auth paths, or trust boundaries introduced.

## Self-Check: PASSED

- `grep -rni deepseek tooling/cross-ai/` → no output
- `bash -n` on all three modified scripts → exit 0
- `git status --porcelain packages/ apps/` → empty (norish application untouched)
- Stale-env sanity: `NORISH_CROSS_AI_WORKER=deepseek` emits WARNING + exits 65 (not 64)
- All 3 task commits exist: ccaf371c, a943462c, 1daebc8c
