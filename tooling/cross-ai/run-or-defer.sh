#!/usr/bin/env bash
#
# Quota-aware runner for the cross-AI worker (norish fork).
#
# Antigravity (Gemini) on a Plus subscription is rate-capped (250-unit/5h sprint +
# 2,800-unit weekly), and `agy` cannot pre-report remaining quota. So this is
# try-then-defer, not pre-check:
#
#   - run the worker on a queued task;
#   - success            -> file the SUMMARY in done/, clear the cooldown;
#   - quota exhausted (75)-> record a "blocked-until" cooldown from the parsed reset,
#                            leave the task queued, and ensure a cron drainer is armed
#                            so it runs automatically once quota returns;
#   - other failure      -> move the task to failed/ (no infinite retry).
#
# The cron drainer ticks on a schedule but is GATED by blocked-until, so it
# effectively "wakes when there is usage again" — which is the requested behaviour.
#
# Usage:
#   run-or-defer.sh <task-file>     enqueue a task file, then attempt to drain
#   run-or-defer.sh --drain         drain the queue (used by cron); honours cooldown
#   run-or-defer.sh --status        show queue + cooldown
#
# A task file is a plain-text prompt for the worker (e.g. a gsd plan task).
set -euo pipefail

ROOT="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
STATE="$ROOT/.cross-ai"
QUEUE="$STATE/queue"; DONE="$STATE/done"; FAILED="$STATE/failed"
BLOCKED="$STATE/blocked-until"
WORKER_CMD="${NORISH_CROSS_AI_WORKER_CMD:-$HERE/worker.sh}"   # overridable for tests
COOLDOWN_BUFFER=120
mkdir -p "$QUEUE" "$DONE" "$FAILED"

now() { date +%s; }

cooldown_remaining() {
  [ -f "$BLOCKED" ] || { echo 0; return; }
  local until; until="$(cat "$BLOCKED" 2>/dev/null || echo 0)"
  local rem=$(( until - $(now) ))
  [ "$rem" -gt 0 ] && echo "$rem" || echo 0
}

enqueue() {
  local src="$1"
  [ -f "$src" ] || { echo "ERROR: task file not found: $src" >&2; exit 66; }
  local dst="$QUEUE/$(date -u +%Y%m%dT%H%M%SZ)-$$-$(basename "$src")"
  cp "$src" "$dst"
  echo "queued: $dst"
}

# Process exactly one (the oldest) queued task. Returns: 0 done, 75 quota-blocked,
# 1 failure, 3 nothing-to-do.
process_one() {
  local task; task="$(find "$QUEUE" -maxdepth 1 -type f | sort | head -1)"
  [ -n "$task" ] || return 3

  local out err; out="$(mktemp)"; err="$(mktemp)"
  local code=0
  "$WORKER_CMD" < "$task" > "$out" 2> "$err" || code=$?

  if [ "$code" -eq 0 ]; then
    mv "$out" "$DONE/$(basename "$task").summary"
    mv "$task" "$DONE/$(basename "$task").done"
    rm -f "$err" "$BLOCKED"
    echo "done: $(basename "$task")"
    return 0
  fi

  if [ "$code" -eq 75 ]; then
    local secs; secs="$(grep -oE 'CROSS_AI_QUOTA_RESET_SECONDS=[0-9]+' "$err" | head -1 | cut -d= -f2)"
    [ -n "${secs:-}" ] || secs=18000
    echo $(( $(now) + secs + COOLDOWN_BUFFER )) > "$BLOCKED"
    rm -f "$out" "$err"
    echo "deferred: quota exhausted; cooling down ~$(( (secs + COOLDOWN_BUFFER) / 60 ))m (task stays queued)"
    "$HERE/install-scheduler.sh" --ensure >/dev/null 2>&1 || \
      echo "  NOTE: could not auto-arm cron — run tooling/cross-ai/install-scheduler.sh manually" >&2
    return 75
  fi

  mv "$task" "$FAILED/$(basename "$task").failed"
  mv "$err" "$FAILED/$(basename "$task").err"
  rm -f "$out"
  echo "FAILED ($code): $(basename "$task") — see $FAILED/$(basename "$task").err" >&2
  return 1
}

drain() {
  local rem; rem="$(cooldown_remaining)"
  if [ "$rem" -gt 0 ]; then
    echo "cooling down: ${rem}s until quota reset — skipping this tick"
    return 0
  fi
  # Process tasks until the queue empties or quota blocks again.
  while true; do
    local code=0; process_one || code=$?
    case "$code" in
      0) continue ;;            # task done, try the next
      3) echo "queue empty"; break ;;
      75) break ;;              # blocked; cron will retry after cooldown
      *) break ;;               # hard failure; stop draining
    esac
  done
}

status() {
  echo "queue:   $(find "$QUEUE" -maxdepth 1 -type f | wc -l | tr -d ' ') pending"
  echo "done:    $(find "$DONE" -maxdepth 1 -name '*.done' | wc -l | tr -d ' ')"
  echo "failed:  $(find "$FAILED" -maxdepth 1 -name '*.failed' | wc -l | tr -d ' ')"
  local rem; rem="$(cooldown_remaining)"
  if [ "$rem" -gt 0 ]; then echo "cooldown: ${rem}s remaining (~$(( rem / 60 ))m)"; else echo "cooldown: none (quota assumed available)"; fi
}

case "${1:-}" in
  --drain)  drain ;;
  --status) status ;;
  "" | -h | --help)
    echo "usage: run-or-defer.sh <task-file> | --drain | --status" >&2; exit 64 ;;
  *) enqueue "$1"; drain ;;
esac
