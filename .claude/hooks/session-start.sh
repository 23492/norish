#!/bin/bash
# SessionStart hook — Claude Code on the web (norish fork).
#
# Installs workspace dependencies so cloud/web sessions can immediately run
# `pnpm typecheck` / `pnpm lint` / `pnpm test`. Heavy build & deploy
# (`pnpm docker:build`) deliberately stay on LXC 110 — never run here.
#
# Remote-only: local SSH/LXC-110 + workstation sessions manage node_modules via
# their own flow (the hardlink-farm injected workspaces documented in CLAUDE.md),
# so this hook no-ops outside Claude Code on the web.
set -euo pipefail

# Only run inside Claude Code on the web (remote) environments.
if [ "${CLAUDE_CODE_REMOTE:-}" != "true" ]; then
  exit 0
fi

cd "${CLAUDE_PROJECT_DIR:-$(pwd)}"

LOG="/tmp/norish-session-start.log"

# Idempotent, lockfile-faithful install (mirrors the repo's `clean:install`).
# The remote container caches state after the hook completes, so re-runs are fast.
corepack enable >/dev/null 2>&1 || true
if pnpm install --frozen-lockfile >"$LOG" 2>&1; then
  echo "session-start: pnpm install --frozen-lockfile OK ($(date -u +%FT%TZ))"
else
  code=$?
  echo "session-start: pnpm install FAILED (exit $code) — see $LOG" >&2
  tail -n 20 "$LOG" >&2
  exit "$code"
fi
