#!/usr/bin/env bash
#
# Arm/disarm the cron drainer for the quota-aware cross-AI runner (norish fork).
#
# Installs a crontab line (for the CURRENT user — must be the user with the `agy`
# Google login) that ticks `run-or-defer.sh --drain` on an interval. The drainer is
# gated by the blocked-until cooldown, so between ticks it cheaply no-ops and only
# does real work once Antigravity quota has reset — i.e. it "wakes when there is
# usage again".
#
# Usage:
#   install-scheduler.sh            install (idempotent)
#   install-scheduler.sh --ensure   install only if not already present (quiet)
#   install-scheduler.sh --print    print the crontab line, install nothing
#   install-scheduler.sh --uninstall remove it
#
# Config (env):
#   NORISH_CROSS_AI_CRON_MIN   tick interval in minutes (default 15)
#   NORISH_CROSS_AI_WORKER     worker for the drain (default antigravity)
set -euo pipefail

ROOT="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"
INTERVAL="${NORISH_CROSS_AI_CRON_MIN:-15}"
WORKER="${NORISH_CROSS_AI_WORKER:-antigravity}"
MARKER="# norish-cross-ai-drain"
LINE="*/${INTERVAL} * * * * cd $ROOT && NORISH_CROSS_AI_WORKER=$WORKER tooling/cross-ai/run-or-defer.sh --drain >> $ROOT/.cross-ai/cron.log 2>&1 $MARKER"

print_line() { printf '%s\n' "$LINE"; }

current_crontab() { crontab -l 2>/dev/null || true; }

is_installed() { current_crontab | grep -qF "$MARKER"; }

install() {
  command -v crontab >/dev/null 2>&1 || { echo "ERROR: 'crontab' not available — install cron or use a systemd timer (see README)" >&2; exit 2; }
  if is_installed; then
    # Replace any existing marked line (interval/worker may have changed).
    current_crontab | grep -vF "$MARKER" | { cat; print_line; } | crontab -
    echo "updated cron drainer (every ${INTERVAL}m, worker=$WORKER)"
  else
    { current_crontab; print_line; } | crontab -
    echo "installed cron drainer (every ${INTERVAL}m, worker=$WORKER)"
  fi
}

uninstall() {
  command -v crontab >/dev/null 2>&1 || { echo "ERROR: 'crontab' not available" >&2; exit 2; }
  current_crontab | grep -vF "$MARKER" | crontab -
  echo "removed cron drainer"
}

case "${1:-}" in
  --print)     print_line ;;
  --uninstall) uninstall ;;
  --ensure)    is_installed || install ;;
  "" )         install ;;
  *) echo "usage: install-scheduler.sh [--ensure|--print|--uninstall]" >&2; exit 64 ;;
esac
