---
phase: 260627-fsi
plan: 01
type: execute
wave: 1
depends_on: []
files_modified:
  - tooling/cross-ai/worker.sh
  - tooling/cross-ai/deepseek-executor.sh
  - tooling/cross-ai/install-scheduler.sh
  - tooling/cross-ai/README.md
  - tooling/cross-ai/antigravity-executor.sh
  - .planning/PROJECT.md
autonomous: true
requirements: [FSI-RM-DEEPSEEK-01]

must_haves:
  truths:
    - "antigravity is the only cross-AI worker; worker.sh always dispatches to antigravity-executor.sh"
    - "A stale NORISH_CROSS_AI_WORKER env var (anything not antigravity/empty) warns to stderr and proceeds with antigravity — it never exits non-zero"
    - "No file under tooling/cross-ai/ contains the string 'deepseek' (case-insensitive)"
    - "deepseek-executor.sh no longer exists"
    - "The norish APPLICATION DeepSeek recipe-extraction provider (packages/, apps/) is completely untouched"
  artifacts:
    - path: "tooling/cross-ai/worker.sh"
      provides: "antigravity-only dispatcher with stale-env-var warning fallback"
      contains: "antigravity-executor.sh"
    - path: ".planning/PROJECT.md"
      provides: "Key Decisions row updated to record full DeepSeek removal (2026-06-27)"
  key_links:
    - from: "tooling/cross-ai/worker.sh"
      to: "tooling/cross-ai/antigravity-executor.sh"
      via: "EXECUTOR assignment + [ -x \"$EXECUTOR\" ] guard"
      pattern: "antigravity-executor\\.sh"
---

<objective>
Fully remove the DeepSeek cross-AI worker from `tooling/cross-ai/`, making `antigravity` the sole cross-AI worker. This supersedes the 2026-06-22 Key Decision that kept the DeepSeek executor "in place but disabled". After this plan, the worker dispatcher unconditionally uses antigravity, the DeepSeek executor file is deleted, and all DeepSeek references (docs, env-var tables, comments) are gone from `tooling/cross-ai/`.

Purpose: The keep-disabled DeepSeek branch caused real failures — a stale `NORISH_CROSS_AI_WORKER` env var would hit `exit 64` and break phase execution. Removing it eliminates that footgun and a never-used pay-per-token path.

Output: An antigravity-only `worker.sh`, a deleted `deepseek-executor.sh`, cleaned `install-scheduler.sh` + `README.md`, a one-word comment fix in `antigravity-executor.sh`, and an updated PROJECT.md Key Decisions row.
</objective>

<execution_context>
@/opt/norish-src/.claude/gsd-core/workflows/execute-plan.md
@/opt/norish-src/.claude/gsd-core/templates/summary.md
</execution_context>

<context>
@.planning/PROJECT.md
@.planning/STATE.md
@./CLAUDE.md

@tooling/cross-ai/worker.sh
@tooling/cross-ai/antigravity-executor.sh
@tooling/cross-ai/install-scheduler.sh
@tooling/cross-ai/README.md
</context>

<hard_scope_guard>
**SCOPE IS LIMITED TO `tooling/cross-ai/` + the single PROJECT.md Key Decisions row.**

DO NOT touch the norish APPLICATION DeepSeek recipe-extraction AI provider. Specifically, make ZERO changes under:
- `packages/shared-server`, `packages/config`, `packages/shared`
- `apps/web` (including the ai-config-form)
- the `@ai-sdk/deepseek` dependency, `AIProviderSchema`, `factory.ts`, `listing.ts`, `connection-tests.ts`
- any Phase 6 planning artifacts

Those are an unrelated, in-product feature and stay EXACTLY as-is. `git status --porcelain packages/ apps/` MUST show no changes after this plan. The ONLY files this plan may modify are the five `tooling/cross-ai/*` files and `.planning/PROJECT.md`.
</hard_scope_guard>

<tasks>

<task type="auto">
  <name>Task 1: Make worker.sh antigravity-only with a stale-env-var warning fallback, and delete deepseek-executor.sh</name>
  <files>tooling/cross-ai/worker.sh, tooling/cross-ai/deepseek-executor.sh</files>
  <action>
Edit `tooling/cross-ai/worker.sh` so antigravity is the only worker:

1. Header comment block (lines ~10-15): Remove the "Worker selection (env): NORISH_CROSS_AI_WORKER antigravity (default) | deepseek" lines, and remove the final sentence "DeepSeek (its own key) remains available as a no-quota-wall fallback." Keep the "Default = Antigravity (Gemini 3.5 Flash...)" description but reword so it reads as a statement of the SOLE worker (e.g. drop "Default =" framing if it now implies alternatives). The header must contain NO occurrence of the string "deepseek" (case-insensitive) and must not reference worker selection.

2. Replace the entire `case "$WORKER" in ... esac` block (the antigravity branch, the deepseek branch with its `NORISH_CROSS_AI_ALLOW_DEEPSEEK` guard and `exit 64`, and the `*) ... exit 64` catch-all) with logic that:
   - Always sets `EXECUTOR="$HERE/antigravity-executor.sh"`.
   - Reads `WORKER="${NORISH_CROSS_AI_WORKER:-antigravity}"` (keep the existing assignment) and, if `$WORKER` is non-empty AND not equal to `antigravity`, prints a WARNING to stderr such as: `WARNING: NORISH_CROSS_AI_WORKER=$WORKER ignored; antigravity is the only cross-AI worker` and then PROCEEDS. It MUST NOT exit non-zero on a stale/unknown value — this is the bug being fixed (the old `*) exit 64` and deepseek `exit 64` broke phase execution when the env var was stale).
   - Keeps the existing `[ -x "$EXECUTOR" ] || { echo "ERROR: executor not found/executable: $EXECUTOR" >&2; exit 64; }` guard immediately after.

3. SUMMARY provenance line in the heredoc (line ~65): change `Produced by cross-AI worker ($WORKER)` to hard-code the literal `antigravity` — i.e. `Produced by cross-AI worker (antigravity)` — so it no longer interpolates `$WORKER`.

4. Leave the shared worker briefing PROMPT, the empty-task guard, and the final `printf '%s' "$PROMPT" | exec "$EXECUTOR"` line unchanged.

Then delete the DeepSeek executor with `git rm tooling/cross-ai/deepseek-executor.sh` (use `git rm`, not a plain `rm`, so the deletion is staged).

Do NOT reintroduce any worker-selection abstraction — antigravity is hard-wired.
  </action>
  <verify>
    <automated>bash -n tooling/cross-ai/worker.sh && grep -q 'antigravity-executor.sh' tooling/cross-ai/worker.sh && grep -q '\[ -x "\$EXECUTOR" \]' tooling/cross-ai/worker.sh && grep -q 'antigravity is the only' tooling/cross-ai/worker.sh && ! grep -qi deepseek tooling/cross-ai/worker.sh && ! grep -q 'exit 64' <(grep -A2 -i 'NORISH_CROSS_AI_WORKER' tooling/cross-ai/worker.sh) && test ! -e tooling/cross-ai/deepseek-executor.sh && git status --porcelain tooling/cross-ai/deepseek-executor.sh | grep -q '^D'</automated>
  </verify>
  <done>worker.sh parses (`bash -n` exit 0), unconditionally sets EXECUTOR to antigravity-executor.sh, keeps the `[ -x "$EXECUTOR" ]` guard, warns-and-proceeds (never exits non-zero) on a stale NORISH_CROSS_AI_WORKER, hard-codes `antigravity` in the provenance line, and contains no "deepseek" string. deepseek-executor.sh is deleted and staged for removal (`git status` shows `D`).</done>
</task>

<task type="auto">
  <name>Task 2: Strip DeepSeek from install-scheduler.sh, README.md, and the antigravity-executor.sh comment</name>
  <files>tooling/cross-ai/install-scheduler.sh, tooling/cross-ai/README.md, tooling/cross-ai/antigravity-executor.sh</files>
  <action>
Remove every remaining DeepSeek reference from `tooling/cross-ai/` while keeping all antigravity documentation intact and coherent.

1. `tooling/cross-ai/install-scheduler.sh` — In the `NORISH_CROSS_AI_WORKER` comment (around line 19, `worker for the drain (default antigravity)`), remove any implication of a deepseek alternative; antigravity is the only worker. Reword to e.g. `# (kept for cron-line compatibility; antigravity is the only worker)` or simply state antigravity is the sole worker. Keep the script fully functional — do NOT remove the `WORKER` variable, the `NORISH_CROSS_AI_WORKER=$WORKER` crontab line, or any logic; this is a comment-only change. `bash -n` must still pass.

2. `tooling/cross-ai/README.md` — make these edits, keeping all antigravity content:
   - In the "## Workers" table (~lines 23-26): remove the entire `deepseek` row (the `| \`deepseek\` _(disabled for now)_ | ... |` line). Keep the antigravity row.
   - Remove the paragraph sentence(s) about DeepSeek (~lines 30-31): the "**DeepSeek is disabled for now** (the executor stays in place; set `NORISH_CROSS_AI_ALLOW_DEEPSEEK=1`...)" note. Keep the "**Default = Antigravity / Gemini 3.5 Flash...**" sentence but reword if it now implies a non-existent alternative (antigravity is the sole worker, not a "default").
   - In the "## Mandatory review" intro (~line 35): change "Worker models (Gemini Flash / DeepSeek) are..." to reference only Gemini Flash (e.g. "The worker model (Gemini Flash) is lower-trust than the Opus supervisor").
   - In "## Configuration (env)" → "**Antigravity worker**" table (~line 99): change the `NORISH_CROSS_AI_WORKER` row's Purpose from `\`antigravity\` \| \`deepseek\`` to antigravity-only (e.g. `antigravity (the only worker)`).
   - Remove the entire "**DeepSeek worker**" env-var sub-table (~lines 105-110: the `DEEPSEEK_API_KEY` / `NORISH_CROSS_AI_BASE_URL` / `NORISH_CROSS_AI_MODEL` rows and their `**DeepSeek worker**` heading).
   - In "## One-time box setup" (~line 138): remove the root-bypass DeepSeek-path bullet — the sentence "The worker inherits that user — and `claude` (DeepSeek path) refuses bypass as root, so use a **non-root** user." Since antigravity (`agy`) is the only worker, drop the `claude`/DeepSeek-specific root caveat. If a non-root reminder is still relevant to `agy`, keep ONLY the antigravity-relevant part and remove the DeepSeek clause; otherwise remove the bullet.
   - Sweep the whole file: NO occurrence of "deepseek" (case-insensitive) may remain. The document must still read coherently end-to-end.

3. `tooling/cross-ai/antigravity-executor.sh` — line ~8 has a parenthetical comment `(contrast: Anthropic bans subscription-via-proxy; DeepSeek needs a paid API key).` Reword this comment ONLY to drop the literal word "DeepSeek" while preserving the contrast (e.g. `(contrast: Anthropic bans subscription-via-proxy; a third-party API key would cost extra)`). This is a COMMENT-ONLY edit to satisfy the `grep -rni deepseek tooling/cross-ai/` gate — DO NOT change any logic, variable, exit code, or `agy` invocation in this file. `bash -n` must still pass.
  </action>
  <verify>
    <automated>bash -n tooling/cross-ai/install-scheduler.sh && bash -n tooling/cross-ai/antigravity-executor.sh && grep -q 'antigravity' tooling/cross-ai/install-scheduler.sh && grep -q 'agy' tooling/cross-ai/antigravity-executor.sh && grep -q 'antigravity' tooling/cross-ai/README.md && ! grep -rniq deepseek tooling/cross-ai/</automated>
  </verify>
  <done>install-scheduler.sh and antigravity-executor.sh still parse and retain their antigravity/agy logic; README.md still documents antigravity coherently; and `grep -rni deepseek tooling/cross-ai/` returns nothing (no DeepSeek string anywhere under tooling/cross-ai/).</done>
</task>

<task type="auto">
  <name>Task 3: Update the PROJECT.md Key Decisions row to record full DeepSeek removal</name>
  <files>.planning/PROJECT.md</files>
  <action>
In `.planning/PROJECT.md`, find the 2026-06-22 Key Decisions row (the "Sole worker = Antigravity..." row, ~line 71) whose rationale currently ends with "DeepSeek executor stays in place but disabled (`NORISH_CROSS_AI_ALLOW_DEEPSEEK=1` to re-enable)."

Update that trailing clause to state that DeepSeek has now been FULLY REMOVED from the cross-AI worker (2026-06-27) — antigravity is the sole cross-AI worker — superseding the earlier keep-disabled decision. For example, replace the final sentence with: "DeepSeek executor and all `tooling/cross-ai/` DeepSeek references were FULLY REMOVED (2026-06-27), superseding the earlier keep-disabled decision — antigravity is now the sole cross-AI worker." Optionally update the row's title/status to reflect the supersession (e.g. note "(superseded 2026-06-27)").

Preserve the REST of that row's rationale (the `agy` first-party-CLI / sanctioned-no-extra-billing reasoning and the quota-aware run-or-defer/cron description) verbatim. Do NOT alter any other Key Decisions row, and do NOT touch the unrelated norish-application DeepSeek AI-provider feature anywhere.
  </action>
  <verify>
    <automated>grep -q '2026-06-27' .planning/PROJECT.md && grep -iq 'removed' .planning/PROJECT.md && grep -q 'run-or-defer' .planning/PROJECT.md && ! grep -q 'NORISH_CROSS_AI_ALLOW_DEEPSEEK' .planning/PROJECT.md</automated>
  </verify>
  <done>The Antigravity Key Decisions row records the 2026-06-27 full DeepSeek removal (antigravity = sole worker, earlier keep-disabled decision superseded), retains the original `agy`/quota-aware rationale, and no longer mentions `NORISH_CROSS_AI_ALLOW_DEEPSEEK`.</done>
</task>

</tasks>

<verification>
Run the full acceptance gate from the repo root after all three tasks:

1. `grep -rni deepseek tooling/cross-ai/` returns NOTHING (no output, exit 1).
2. `bash -n tooling/cross-ai/worker.sh tooling/cross-ai/install-scheduler.sh` exits 0.
3. `bash -n tooling/cross-ai/antigravity-executor.sh` exits 0.
4. `test ! -e tooling/cross-ai/deepseek-executor.sh` (file is gone, deletion staged).
5. `git status --porcelain packages/ apps/` shows NO changes (norish app DeepSeek provider untouched).
6. `grep -q 'antigravity-executor.sh' tooling/cross-ai/worker.sh` and `grep -q '\[ -x "\$EXECUTOR" \]' tooling/cross-ai/worker.sh` both succeed (antigravity hard-wired + guard kept).
7. Stale-env sanity: `printf '' | NORISH_CROSS_AI_WORKER=deepseek bash tooling/cross-ai/worker.sh; echo "exit=$?"` must NOT exit 64 on the worker-selection logic (it may exit 65 on the empty-stdin guard, which is the intended post-selection behavior) and must emit the antigravity WARNING to stderr.
</verification>

<success_criteria>
- antigravity is the ONLY cross-AI worker; worker.sh always dispatches to antigravity-executor.sh and keeps the `[ -x "$EXECUTOR" ]` guard.
- A stale `NORISH_CROSS_AI_WORKER` value warns to stderr and proceeds (never `exit 64` in the selection path).
- `tooling/cross-ai/deepseek-executor.sh` is deleted (via `git rm`).
- `grep -rni deepseek tooling/cross-ai/` returns nothing.
- README.md and install-scheduler.sh remain coherent and functional, antigravity docs intact.
- The PROJECT.md Key Decisions row records the 2026-06-27 full removal, superseding the keep-disabled decision.
- ZERO changes under `packages/` or `apps/` — the norish-application DeepSeek recipe-extraction provider is untouched.
</success_criteria>

<output>
Create `.planning/quick/260627-fsi-remove-deepseek-cross-ai-worker-full-rem/260627-fsi-SUMMARY.md` when done.
</output>
