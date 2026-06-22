# cross-ai — DeepSeek workers under an Opus supervisor

Wires the norish fork's gsd workflow into a **director/executor model split**:

- **Supervisor = native Claude Code (Opus) on Kiran's subscription.** Plans,
  orchestrates, verifies. Runs the normal way (`claude` logged in via OAuth) — the
  official harness, used as intended. No proxy in front of it.
- **Workers = DeepSeek v4-pro**, via `deepseek-executor.sh`, for any plan that opts in.

### Why this shape (and not a router in front of Opus)

The tempting alternative — `claude-code-router` translating your *subscription OAuth*
token into Anthropic API calls so subagents can be a different model — is the exact
pattern Anthropic **bans** ("extracting OAuth tokens to use in a third-party API
client equals a ban", early-2026 OpenClaw crackdown). Subscription OAuth is for the
native harness only; anything programmatic must use an `sk-ant-api03` API key.

So we split at the **orchestration layer** instead of the harness layer: Opus stays
native/legit, and DeepSeek is invoked as an external worker using **DeepSeek's own
key + native Anthropic-compatible endpoint** (`api.deepseek.com/anthropic`). No
Anthropic credential ever transits a proxy. ToS-clean, no extra Anthropic billing.

### How gsd uses it

`.planning/config.json` → `workflow`:

```json
"cross_ai_execution": true,
"cross_ai_command": "tooling/cross-ai/deepseek-executor.sh",
"cross_ai_timeout": 1800
```

During `execute-phase`, gsd's `cross_ai_delegation` step pipes a plan's task prompt to
the command on **stdin**; the command does the work in the repo and prints a
SUMMARY.md on **stdout**. A non-zero exit makes gsd fall back to the native Opus
executor for that plan — so a missing key or a worker failure degrades gracefully.

**Which plans go to DeepSeek:**
- per-plan: set `cross_ai: true` in the PLAN.md frontmatter (the supervisor decides
  which plans are worker-suitable), or
- whole run: `/gsd-execute-phase <phase> --cross-ai` (force all), `--no-cross-ai` (disable).

Plans without `cross_ai: true` run on the native Opus executor as usual.

### Configuration (env)

| Var | Default | Purpose |
| --- | --- | --- |
| `DEEPSEEK_API_KEY` | — | DeepSeek key (preferred). **Never commit it.** |
| `NORISH_CROSS_AI_KEY_FILE` | — | Alternative: path to a file holding the key. |
| `NORISH_CROSS_AI_BASE_URL` | `https://api.deepseek.com/anthropic` | Set to `http://127.0.0.1:3456` to reuse the box's existing `claude-code-router` instead of going direct. |
| `NORISH_CROSS_AI_MODEL` | `deepseek-v4-pro` | Worker model. |

On LXC 110, export `DEEPSEEK_API_KEY` (or point `NORISH_CROSS_AI_KEY_FILE` at a
root-only file) in the environment the gsd supervisor runs in. The key lives only in
the environment / a gitignored file — never in the repo.

**Run as a non-root user.** Claude Code refuses `bypassPermissions` as root, so the
worker (which inherits the supervisor's user) must run as the non-root `claude` /
`claude-ds` user on LXC 110. The script fails fast with a clear hint if run as root.

### Boundaries (inherited by the worker prompt)

The worker is told to obey `./CLAUDE.md`, read the vault first, commit per task, stay
on the current branch (the supervisor owns branching), and never touch the live
stack / deploy / `docker:build` / anything outside the repo.
