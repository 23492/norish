# Remote Session Workflow — Claude Code on the web

How to drive the norish fork from a **cloud (remote) Claude Code session** —
the kind you start at <https://claude.ai/code> and can reach from your phone.
This is a **second, complementary** way of working alongside the established
LXC-110 director/executor model (`.planning/` + the
[[norish-fork-workflow]] wiki page). It does **not** replace it; it covers the
cases where you are away from the workstation and want to keep moving.

> TL;DR — A remote session is a fresh, throwaway clone in the cloud. It can
> **edit, install, typecheck, lint, test, commit, and push** to its feature
> branch. It **cannot** reach LXC 110, run `pnpm docker:build`, or touch the
> live stack. Build & deploy remain a deliberate, operator-run step on LXC 110.

## 1. What a remote session is (and isn't)

| | Remote session (Claude Code on the web) | Local session (LXC 110 / workstation) |
|---|---|---|
| Where the code lives | Fresh `git clone` in an **ephemeral cloud container** (`/home/user/norish`) | `/opt/norish-src` on **LXC 110** |
| How it reaches the repo | Managed git proxy → GitHub `23492/norish` | Local checkout on the host |
| SSH to LXC 110 / `pct exec` / `redit.py` | ❌ no `ssh` binary, no keys, network-policy gated | ✅ the documented path |
| `pnpm install` / typecheck / lint / test | ✅ (registry reachable; see §3) | ✅ |
| `pnpm docker:build` / deploy / live stack | ❌ never here | ✅ operator-owned |
| Lifespan | Reclaimed after inactivity — **commit & push or lose it** | Persistent |
| GitHub ops (PRs, CI, comments) | via **GitHub MCP tools**, not `gh` CLI | `gh` / web |

The container is reclaimed when the session goes idle, so **nothing is real
until it is pushed** to the feature branch.

## 2. Phone access & restarting the session

The whole point of a remote session is that it outlives any single device.

- **Resume from anywhere.** Open the Claude Code app / <https://claude.ai/code>
  on your phone, pick the norish session, and continue the same conversation —
  full history intact. If the container was reclaimed, starting the session
  again re-clones the repo and (thanks to the SessionStart hook, §3) re-installs
  dependencies automatically, so you land verification-ready.
- **Push early, push often.** Because the container is ephemeral, the durable
  state is the branch on GitHub (`claude/serene-planck-rc2zj7`) plus the
  `.planning/` + wiki artifacts. Treat a push as the save point.
- **Hermes Telegram bridge (notifications + approvals from your phone).** The
  Homelab connector exposes a messaging bridge (see §4) with a live Telegram DM
  to you. A session can send you status pings, and — critically — when a tool
  needs a permission decision, you can **approve/deny from your phone**
  (`allow-once` / `allow-always` / `deny`) instead of being at the keyboard.

## 3. Verification in a remote session (the SessionStart hook)

`.claude/hooks/session-start.sh` (registered in `.claude/settings.json`) runs on
every web session boot and does `pnpm install --frozen-lockfile`, so
`typecheck` / `lint` / `test` work immediately.

- **Remote-only.** The hook no-ops unless `CLAUDE_CODE_REMOTE=true`, so local
  LXC-110 / workstation sessions — which manage `node_modules` via the
  hardlink-farm injected workspaces — are untouched.
- **Synchronous** by default: the session waits for install to finish (~30 s on
  a warm container) so it never races ahead of its dependencies. Switch to async
  (`{"async": true, ...}`) only if faster boot matters more than that guarantee.
- The hook applies to **future** sessions once merged to the default branch.

Verification commands a remote session may run (and nothing heavier):

```bash
pnpm typecheck      # turbo run typecheck
pnpm lint           # turbo run lint --concurrency=1
pnpm test           # turbo run test (vitest)
pnpm --filter @norish/<pkg> run test   # scope to one package
```

**Never** run `pnpm docker:build`, `docker:*`, or anything that assumes the live
Postgres/stack — those belong to the operator on LXC 110.

## 4. The Homelab connector (what this session can reach)

The remote session is wired to a **Homelab MCP server** with three tool
families. Full inventory lives in the wiki ([[homelab-mcp-connector]]); the
short version:

- **Hermes** — agent/messaging bridge (Telegram, Discord, Slack, webhooks):
  `hermes_channels_list`, `hermes_conversations_list`, `hermes_conversation_get`,
  `hermes_messages_read`, `hermes_messages_send`, `hermes_events_poll`,
  `hermes_events_wait`, `hermes_attachments_fetch`, `hermes_permissions_list_open`,
  `hermes_permissions_respond`. This is the phone channel + remote-approval path.
  A live Telegram DM to Kiran already exists
  (`agent:main:telegram:dm:8508851351`).
- **Home Assistant** — full smart-home control surface (`homeassistant_ha_*`):
  entities, automations, scripts, scenes, helpers, dashboards, history, logs,
  system health, HACS, add-ons, backups, traces, Assist pipelines. Not used for
  norish dev, but available on the same connector.
- **Vane** — AI web search (`vane_search`, `vane_search_with_context`).

## 5. Division of labour: cloud ⇄ LXC 110

The remote session and the LXC-110 build host meet at the **branch**:

```
remote session (cloud)                         operator on LXC 110
─────────────────────────                      ──────────────────────────
edit + typecheck/lint/test  ──push branch──▶   git pull the branch
commit per task                                pnpm docker:build (lead-owned)
update .planning/ + wiki                       deploy image → verify stack
                                               Chrome-verify the real UI
                                               live cutover (deliberate)
```

Everything in the existing model still holds — security-critical changes are
adversarially verified, DTO/zod-vs-real-row mismatches need a real-Postgres
parse test, the live stack is untouched mid-phase, and cutover is separate. The
remote session simply owns the **code + cheap-verification** half and hands off a
clean, pushed branch.

## 6. House rules (unchanged from the fork constraints)

- Develop on `claude/serene-planck-rc2zj7`; `git push -u origin <branch>`.
  **Never** push to a different branch without explicit permission.
- **No PRs unless explicitly asked.** GitHub interactions go through the
  GitHub MCP tools (scope: `23492/norish`).
- Conventional Commits, minimal & cleanly re-baseable diffs, complete work
  (no stubs) — same hard constraints as `CLAUDE.md`.
- Keep `.planning/` (`STATE.md` / `ROADMAP.md`) and the Obsidian wiki current;
  mirror significant decisions into `.planning/PROJECT.md`.
