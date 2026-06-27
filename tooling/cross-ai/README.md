# cross-ai — model-split workers under an Opus supervisor

Wires the norish fork's gsd workflow into a **director/executor model split**:

- **Supervisor = native Claude Code (Opus) on Kiran's subscription.** Plans,
  orchestrates, verifies. Runs the normal way (`claude` via OAuth) — the official
  harness, used as intended. No proxy in front of it.
- **Workers = a cheaper/owned model**, invoked per plan via `worker.sh`.

### Why split at the orchestration layer (not a router in front of Opus)

Putting `claude-code-router` in front of Opus to translate your **subscription OAuth**
into API calls is the exact pattern Anthropic **bans** ("extracting OAuth tokens to use
in a third-party API client equals a ban", the early-2026 OpenClaw crackdown). So Opus
stays native/legit, and the worker is a *separate* model invoked as an external command.

## Workers

`worker.sh` is the gsd `workflow.cross_ai_command`. It wraps the plan task in shared
operating rules + a SUMMARY contract and dispatches to a provider by
`NORISH_CROSS_AI_WORKER`:

| Worker | Auth | Billing | Quota wall | Notes |
| --- | --- | --- | --- | --- |
| **`antigravity`** | Google login (personal **Plus** sub) | included in sub | **yes** (250/5h + 2,800/week) | First-party `agy` CLI → ToS-clean. Gemini 3.5 Flash, aggressive `--think`. |

**Antigravity / Gemini 3.5 Flash with aggressive thinking** is the sole cross-AI worker,
on the personal Google subscription: sanctioned (first-party tool + login), no extra
billing.

## Mandatory review of worker output (hard gate)

The worker model (Gemini Flash) is **lower-trust than the Opus supervisor**, and
their self-reported result can be wrong — gsd's own context-budget guidance warns of
"silent partial completion" where an agent claims done but the work is incomplete, and a
self-check that only proves file existence, not semantic correctness. So **everything a
worker produces is untrusted until the native supervisor has strictly reviewed it.** This
is a CLAUDE.md hard constraint, not a nicety.

Each worker SUMMARY ends with a `## Provenance` line flagging it as pending review. Before
those commits are carried forward, the supervisor MUST:

1. **Distrust the `## Self-Check`** — treat it as a claim, not evidence.
2. **Independently re-run the gates** — `pnpm typecheck`, `pnpm lint`, `pnpm test` in the
   real tree (don't take the worker's word).
3. **Read the full diff** against the plan's `<acceptance_criteria>` / must-haves for
   *semantic* completeness — not just that files changed.
4. **Re-run the per-cookbook isolation checks** (security-critical boundary); for
   security-relevant changes, the adversarial check (weaken → suites go red → revert).
5. **Real-row/DTO check** where a resolver or DTO changed — the fork's known blind spot
   (mocked suites miss zod-vs-real-Postgres mismatches); use a testcontainers parse test
   or a Chrome-verify.
6. **Decide: accept / rework / take over.** On any gap, send the plan back to the worker
   with specifics, or the supervisor finishes it. Worker commits are **not** merged into
   the trusted line until the review passes.

## Quota-aware overnight running (`run-or-defer.sh`)

Antigravity on Plus is rate-capped and `agy` can't pre-report remaining quota, so this is
**try-then-defer**, not pre-check:

```
run-or-defer.sh <task-file>   # enqueue a task, attempt it now
run-or-defer.sh --drain       # process the queue (what cron calls); honours cooldown
run-or-defer.sh --status      # queue + cooldown
```

- **success** → SUMMARY filed in `.cross-ai/done/`, cooldown cleared.
- **quota exhausted** (`agy` reports `Individual quota reached … Resets in …` / 429
  `RESOURCE_EXHAUSTED`) → the worker exits `75`; the runner records a `blocked-until`
  cooldown from the parsed reset, **leaves the task queued**, and arms a cron drainer.
- **other failure** → task moved to `.cross-ai/failed/` (no infinite retry).

### The cron "wake when usage returns" (`install-scheduler.sh`)

```
install-scheduler.sh            # install the drainer (idempotent)
install-scheduler.sh --print    # show the crontab line
install-scheduler.sh --uninstall
```

It installs (for the **current user** — the one with the `agy` login) a crontab line
that ticks `run-or-defer.sh --drain` every `NORISH_CROSS_AI_CRON_MIN` minutes
(default 15). Between ticks the drainer is **gated by the cooldown**, so it cheaply
no-ops until the quota window resets and then runs the queued work automatically —
i.e. it "wakes when there is usage again." `run-or-defer.sh` auto-arms it on the first
deferral. (No cron daemon? Use a systemd timer calling the same `--drain`.)

All runtime state lives under `.cross-ai/` (gitignored): `queue/`, `done/`, `failed/`,
`blocked-until`, `cron.log`.

## Configuration (env)

**Antigravity worker**
| Var | Default | Purpose |
| --- | --- | --- |
| `NORISH_CROSS_AI_WORKER` | `antigravity` | `antigravity` (the only worker) |
| `NORISH_GEMINI_MODEL` | `gemini-3.5-flash` | worker model |
| `NORISH_GEMINI_THINK` | `--think` | most-aggressive thinking. `""` disables; `--thinking-level high` if your `agy` uses levels |
| `NORISH_AGY_APPROVE` | `all` | `--approve` policy (auto-approve writes + shell; `agy` adds nsjail sandbox) |
| `NORISH_AGY_BIN` | `agy` | CLI binary |

**Scheduler**: `NORISH_CROSS_AI_CRON_MIN` (default 15).

## gsd integration

`.planning/config.json` → `workflow`:

```json
"cross_ai_execution": true,
"cross_ai_command": "tooling/cross-ai/worker.sh",
"cross_ai_timeout": 1800
```

gsd's `cross_ai_delegation` step pipes a plan's task to `worker.sh` on stdin and reads
the SUMMARY from stdout; a non-zero exit makes gsd fall back to the native Opus
executor for that plan. **Note:** gsd's path is *synchronous* — for unattended overnight
Antigravity runs where you want to *wait out* the quota instead of falling back to Opus,
drive execution through `run-or-defer.sh` + the cron drainer instead.

Which plans go to a worker: set `cross_ai: true` in a PLAN.md frontmatter, or run
`/gsd-execute-phase <phase> --cross-ai` (force all) / `--no-cross-ai` (disable).

## One-time box setup & "verify on LXC 110" items

- `agy` Google login as the user that runs the drainer (the personal Plus account).
- The worker inherits that user — run as a **non-root** user (the `agy` user on LXC 110).
- **Verify on the box** (can't be tested off-box): that `agy --headless --approve all`'s
  nsjail sandbox still permits repo writes, `git`, and `pnpm`'s network to the registry;
  and the exact `--think`/thinking-level flag for your installed `agy` version (the
  non-TTY stdout drop is already handled via a pty wrapper).
