#!/usr/bin/env bash
#
# Antigravity (Gemini) worker — default cross-AI executor for the norish fork.
#
# Runs Google's first-party Antigravity CLI (`agy`) on Kiran's PERSONAL Google
# subscription (Plus tier). ToS-clean: official tool + official login, not a
# third-party harness routing credentials — so subscription use is sanctioned and
# costs no extra (contrast: Anthropic bans subscription-via-proxy; a third-party
# API key would cost extra). Reads the worker prompt on STDIN, runs `agy` non-interactively in the
# repo (edits + commits), prints the agent's final output (the SUMMARY) on STDOUT.
#
# Model: Gemini 3.5 Flash (High) by default — in agy v1.0.10 the reasoning level is
# baked into the model variant (Low/Medium/High); there is no separate --think flag.
#
# Exit codes: 0 = done · 75 = quota exhausted (EX_TEMPFAIL; run-or-defer reschedules)
#             1 = empty/failed run · 2 = agy not installed
#
# Config (env):
#   NORISH_GEMINI_MODEL    default "Gemini 3.5 Flash (High)" — exact agy model display
#                          name (see `agy models`). High = most aggressive reasoning.
#   NORISH_AGY_SANDBOX     default "" (off). Set "--sandbox" to enable agy's restricted
#                          terminal sandbox (verify it still permits repo writes/git/pnpm).
#   NORISH_AGY_BIN         default "agy"
# Auto-approve: --dangerously-skip-permissions (v1.0.10's auto-approve; --approve/--headless
#   from earlier builds no longer exist).
#
# Auth: a one-time `agy` Google login (run `agy` with no args) as THIS user must already
# be done on the box.
set -euo pipefail

MODEL="${NORISH_GEMINI_MODEL:-Gemini 3.5 Flash (High)}"
SANDBOX="${NORISH_AGY_SANDBOX:-}"
AGY="${NORISH_AGY_BIN:-agy}"

command -v "$AGY" >/dev/null 2>&1 || { echo "ERROR: '$AGY' (Antigravity CLI) not on PATH" >&2; exit 2; }

ROOT="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"
cd "$ROOT"

PROMPT="$(cat)"

# agy -p drops stdout under a non-TTY (cron/pipe/subprocess), exit 0 with no output
# (google-antigravity/antigravity-cli#76). Allocate a pty via `script` and capture
# that. Base64 the prompt so newlines/quotes survive embedding in the inner command.
B64="$(printf '%s' "$PROMPT" | base64 | tr -d '\n')"
INNER="$AGY -p \"\$(printf %s '$B64' | base64 -d)\" --dangerously-skip-permissions --model \"$MODEL\" $SANDBOX"

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
