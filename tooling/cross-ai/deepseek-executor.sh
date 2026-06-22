#!/usr/bin/env bash
#
# DeepSeek worker — alternative cross-AI executor for the norish fork.
#
# Runs the Claude Code harness pointed at DeepSeek's own native Anthropic-compatible
# endpoint with a DeepSeek API key. ToS-clean: no Anthropic subscription/OAuth token
# is routed through a proxy (the Anthropic-banned pattern); the model, endpoint, and
# billing are entirely DeepSeek's. No quota wall (pay-per-token), so it needs no
# run-or-defer scheduling — useful when the Antigravity weekly cap is spent.
#
# Reads the worker prompt on STDIN (worker.sh has already wrapped it in the operating
# rules + SUMMARY contract), runs in the repo, prints the SUMMARY on STDOUT.
#
# Exit codes: 0 = done · 1 = no key · 2 = claude not installed · 4 = running as root
#
# Config (env):
#   DEEPSEEK_API_KEY / NORISH_CROSS_AI_KEY_FILE   DeepSeek key (never commit it)
#   NORISH_CROSS_AI_BASE_URL   default https://api.deepseek.com/anthropic
#                              (or http://127.0.0.1:3456 to reuse claude-code-router)
#   NORISH_CROSS_AI_MODEL      default deepseek-v4-pro
set -euo pipefail

BASE_URL="${NORISH_CROSS_AI_BASE_URL:-https://api.deepseek.com/anthropic}"
MODEL="${NORISH_CROSS_AI_MODEL:-deepseek-v4-pro}"

KEY="${DEEPSEEK_API_KEY:-}"
if [ -z "$KEY" ] && [ -n "${NORISH_CROSS_AI_KEY_FILE:-}" ] && [ -f "$NORISH_CROSS_AI_KEY_FILE" ]; then
  KEY="$(tr -d '[:space:]' < "$NORISH_CROSS_AI_KEY_FILE")"
fi
[ -n "$KEY" ] || { echo "ERROR: no DeepSeek key — set DEEPSEEK_API_KEY or NORISH_CROSS_AI_KEY_FILE" >&2; exit 1; }

command -v claude >/dev/null 2>&1 || { echo "ERROR: 'claude' CLI not on PATH" >&2; exit 2; }

# Claude Code refuses bypassPermissions as root — fail with an actionable hint.
if [ "$(id -u)" = "0" ]; then
  echo "ERROR: run as a non-root user — Claude Code refuses bypassPermissions as root (use the 'claude'/'claude-ds' user on LXC 110)" >&2
  exit 4
fi

ROOT="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"
cd "$ROOT"

PROMPT="$(cat)"

ANTHROPIC_BASE_URL="$BASE_URL" \
ANTHROPIC_API_KEY="$KEY" \
ANTHROPIC_MODEL="$MODEL" \
ANTHROPIC_SMALL_FAST_MODEL="$MODEL" \
  claude -p \
    --model "$MODEL" \
    --permission-mode bypassPermissions \
    --output-format text <<<"$PROMPT"
