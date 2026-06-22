#!/usr/bin/env bash
#
# Antigravity (Gemini) worker — default cross-AI executor for the norish fork.
#
# Runs Google's first-party Antigravity CLI (`agy`) on Kiran's PERSONAL Google
# subscription (Plus tier). ToS-clean: official tool + official login, not a
# third-party harness routing credentials — so subscription use is sanctioned and
# costs no extra (contrast: Anthropic bans subscription-via-proxy; DeepSeek needs a
# paid API key). Reads the worker prompt on STDIN, runs `agy` headless in the repo
# (edits + commits), prints the agent's final output (the SUMMARY) on STDOUT.
#
# Model: Gemini 3.5 Flash with aggressive ("--think") extended reasoning by default.
#
# Exit codes: 0 = done · 75 = quota exhausted (EX_TEMPFAIL; run-or-defer reschedules)
#             1 = empty/failed run · 2 = agy not installed
#
# Config (env):
#   NORISH_GEMINI_MODEL    default gemini-3.5-flash
#   NORISH_GEMINI_THINK    default "--think" (most aggressive). Set "" to disable, or
#                          e.g. "--thinking-level high" if your agy build uses levels.
#   NORISH_AGY_APPROVE     default "all" (--approve all → auto-approve writes + shell;
#                          agy auto-enables nsjail sandboxing on Linux for yolo/headless)
#   NORISH_AGY_BIN         default "agy"
#
# Auth: a one-time `agy` Google login as THIS user must already be done on the box.
set -euo pipefail

MODEL="${NORISH_GEMINI_MODEL:-gemini-3.5-flash}"
THINK="${NORISH_GEMINI_THINK:---think}"
APPROVE="${NORISH_AGY_APPROVE:-all}"
AGY="${NORISH_AGY_BIN:-agy}"

command -v "$AGY" >/dev/null 2>&1 || { echo "ERROR: '$AGY' (Antigravity CLI) not on PATH" >&2; exit 2; }

ROOT="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"
cd "$ROOT"

PROMPT="$(cat)"

# agy -p drops stdout under a non-TTY (cron/pipe/subprocess), exit 0 with no output
# (google-antigravity/antigravity-cli#76). Allocate a pty via `script` and capture
# that. Base64 the prompt so newlines/quotes survive embedding in the inner command.
B64="$(printf '%s' "$PROMPT" | base64 | tr -d '\n')"
INNER="$AGY -p \"\$(printf %s '$B64' | base64 -d)\" --headless --approve $APPROVE --model \"$MODEL\" $THINK"

RAW="$(script -qec "$INNER" /dev/null 2>/dev/null || true)"
# Strip ANSI escapes and CRs the pty injects.
OUT="$(printf '%s' "$RAW" | sed -r 's/\x1B\[[0-9;?]*[A-Za-z]//g' | tr -d '\r')"

# Quota exhaustion → tell run-or-defer when to retry (EX_TEMPFAIL 75).
if printf '%s' "$OUT" | grep -qiE 'individual quota reached|RESOURCE_EXHAUSTED|quota reached|"code"[[:space:]]*:[[:space:]]*429|429 Too Many Requests'; then
  # Best-effort parse of "Resets in 2h 13m" / "Resets in 45m" / "Resets in 3 hours".
  RESET_LINE="$(printf '%s' "$OUT" | grep -ioE 'resets in[^.)\n]*' | head -1 || true)"
  secs=0
  if [[ "$RESET_LINE" =~ ([0-9]+)[[:space:]]*h ]]; then secs=$(( secs + ${BASH_REMATCH[1]} * 3600 )); fi
  if [[ "$RESET_LINE" =~ ([0-9]+)[[:space:]]*m ]]; then secs=$(( secs + ${BASH_REMATCH[1]} * 60 )); fi
  # Fallback to the 5-hour sprint window when the string can't be parsed.
  [ "$secs" -eq 0 ] && secs=18000
  echo "CROSS_AI_QUOTA_RESET_SECONDS=$secs" >&2
  echo "Antigravity quota exhausted; retry in ${secs}s (${RESET_LINE:-no reset string parsed})" >&2
  exit 75
fi

if [ -z "${OUT//[[:space:]]/}" ]; then
  echo "ERROR: agy produced no output (non-TTY stdout drop, or a silent failure)" >&2
  exit 1
fi

printf '%s\n' "$OUT"
