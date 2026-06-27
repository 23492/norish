#!/usr/bin/env bash
#
# gsd cross-AI worker dispatcher (norish fork).
#
# This is the `workflow.cross_ai_command` gsd calls: it reads a plan task on STDIN,
# wraps it in the shared operating rules + SUMMARY contract, and hands it to the
# selected provider executor. STDOUT is the SUMMARY.md; exit code is the executor's
# (0 = done, 75 = quota-exhausted/try-later, other = failure).
#
# Antigravity (Gemini 3.5 Flash, aggressive thinking) on Kiran's personal
# Google subscription is the sole cross-AI worker — ToS-clean (first-party CLI + login),
# no extra billing.
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
WORKER="${NORISH_CROSS_AI_WORKER:-antigravity}"

EXECUTOR="$HERE/antigravity-executor.sh"
if [ -n "$WORKER" ] && [ "$WORKER" != "antigravity" ]; then
  echo "WARNING: NORISH_CROSS_AI_WORKER=$WORKER ignored; antigravity is the only cross-AI worker" >&2
fi
[ -x "$EXECUTOR" ] || { echo "ERROR: executor not found/executable: $EXECUTOR" >&2; exit 64; }

TASK="$(cat)"
if [ -z "${TASK//[[:space:]]/}" ]; then
  echo "ERROR: empty task prompt on stdin" >&2
  exit 65
fi

# Shared worker briefing — both providers get the same rules + output contract.
read -r -d '' PROMPT <<EOF || true
You are an execution worker for the norish fork, invoked by the gsd supervisor.
Operating rules (hard):
- Obey ./CLAUDE.md exactly. Read the vault (wiki_search / wiki_read) for context before acting.
- Implement the task below. Commit per task (Conventional Commits, scoped). Treat every
  acceptance criterion as a hard gate: run the proving command, fix-and-rerun until green.
- Stay on the CURRENT git branch — do NOT create/switch/force-push branches or rewrite
  history (the supervisor owns branching).
- Do NOT touch the live norish stack, deploy, run docker:build, or act outside this repo.

TASK:
$TASK

When finished, print ONLY a SUMMARY.md with this structure (nothing after it):
# Summary
## Commits
| hash | description |
| ---- | ----------- |
## Deviations
None (or a list)
## Self-Check
PASSED or FAILED — <one line: typecheck/lint/test status as evidence>
## Provenance
Produced by cross-AI worker (antigravity) — PENDING strict supervisor review. Do NOT
carry these commits forward until the native supervisor has independently reviewed
the diff and re-run typecheck/lint/test + acceptance criteria.
EOF

printf '%s' "$PROMPT" | exec "$EXECUTOR"
