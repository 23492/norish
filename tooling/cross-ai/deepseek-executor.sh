#!/usr/bin/env bash
#
# gsd cross-AI executor — DeepSeek worker for the norish fork.
#
# Wired into gsd-core via .planning/config.json:
#   workflow.cross_ai_execution = true
#   workflow.cross_ai_command   = tooling/cross-ai/deepseek-executor.sh
#   workflow.cross_ai_timeout   = 1800
#
# Director/executor split: the NATIVE Claude Code supervisor (Opus, on Kiran's
# subscription) plans and orchestrates; any plan whose frontmatter sets
# `cross_ai: true` (or a `--cross-ai` run) is executed HERE on DeepSeek v4-pro.
#
# ToS-clean by construction: this calls DeepSeek's own native Anthropic-compatible
# endpoint with a DeepSeek API key. No Anthropic subscription / OAuth token is ever
# routed through a proxy — that pattern is what Anthropic bans (the early-2026
# "OpenClaw" crackdown). The Claude Code CLI is reused only as the local agent loop;
# the model, endpoint, and billing are entirely DeepSeek's.
#
# Contract (gsd execute-phase `cross_ai_delegation` step):
#   - reads the task prompt on STDIN,
#   - performs the work in the repo (edits + commits),
#   - prints a SUMMARY.md-shaped document on STDOUT.
#   A non-zero exit makes gsd fall back to the native (Opus) executor for the plan.
#
# Config (env, all optional except the key):
#   DEEPSEEK_API_KEY            DeepSeek key (preferred). OR:
#   NORISH_CROSS_AI_KEY_FILE    path to a file containing the key.
#   NORISH_CROSS_AI_BASE_URL    default https://api.deepseek.com/anthropic
#                               (set to http://127.0.0.1:3456 to reuse the box's
#                                claude-code-router instead of going direct)
#   NORISH_CROSS_AI_MODEL       default deepseek-v4-pro
set -euo pipefail

BASE_URL="${NORISH_CROSS_AI_BASE_URL:-https://api.deepseek.com/anthropic}"
MODEL="${NORISH_CROSS_AI_MODEL:-deepseek-v4-pro}"

# --- resolve the DeepSeek key (env wins, then key file); never echoed ---
KEY="${DEEPSEEK_API_KEY:-}"
if [ -z "$KEY" ] && [ -n "${NORISH_CROSS_AI_KEY_FILE:-}" ] && [ -f "$NORISH_CROSS_AI_KEY_FILE" ]; then
  KEY="$(tr -d '[:space:]' < "$NORISH_CROSS_AI_KEY_FILE")"
fi
if [ -z "$KEY" ]; then
  echo "ERROR: no DeepSeek key — set DEEPSEEK_API_KEY or NORISH_CROSS_AI_KEY_FILE" >&2
  exit 1
fi

command -v claude >/dev/null 2>&1 || { echo "ERROR: 'claude' CLI not on PATH" >&2; exit 2; }

# Claude Code refuses bypassPermissions as root — fail with an actionable hint
# instead of its generic message. On LXC 110 the supervisor runs as the non-root
# 'claude' / 'claude-ds' user, so the worker inherits that and this never trips.
if [ "$(id -u)" = "0" ]; then
  echo "ERROR: run as a non-root user — Claude Code refuses bypassPermissions as root (use the 'claude'/'claude-ds' user on LXC 110)" >&2
  exit 4
fi

# Run from the repo root so edits land in the right tree.
ROOT="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"
cd "$ROOT"

TASK="$(cat)"
if [ -z "${TASK//[[:space:]]/}" ]; then
  echo "ERROR: empty task prompt on stdin" >&2
  exit 3
fi

read -r -d '' PROMPT <<EOF || true
You are a DeepSeek execution worker for the norish fork, invoked by the gsd
supervisor. Operating rules (hard):
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
EOF

# Point the Claude Code harness at DeepSeek (key via x-api-key). Pinning the
# small/fast model too avoids stray calls to an Anthropic model the endpoint lacks.
ANTHROPIC_BASE_URL="$BASE_URL" \
ANTHROPIC_API_KEY="$KEY" \
ANTHROPIC_MODEL="$MODEL" \
ANTHROPIC_SMALL_FAST_MODEL="$MODEL" \
  claude -p \
    --model "$MODEL" \
    --permission-mode bypassPermissions \
    --output-format text <<<"$PROMPT"
