# Import gate — 27.1-05 post-deploy empirical gate

This is the operator runbook for `run-import-gate.mjs`, the harness that proves — against the
LIVE, deployed stack, not a mock — that recipe import actually works. It is plan 27.1-05's Task 1
deliverable. See `.planning/phases/27.1-import-reliability-ai-extraction-resilience-json-ld-fallback/27.1-05-PLAN.md`
for the full gate specification and `27.1-IMPORT-GATE.md` for the evidence report this harness produced.

## What this proves

Three bars, run IN ORDER, never skipped, never retried-until-green:

1. **Bar 1** — the ONE mandated URL that Kiran named
   (`https://www.ah.nl/allerhande/recept/R-R951540/bonensalade-met-kip-en-avocado`) imports
   successfully.
2. **Bar 2** — at least 10 FURTHER `ah.nl/allerhande` recipes, spanning at least 6 distinct
   categories, import successfully.
3. **Bar 3, gated on bar 2** — only once bar 2 has passed, at least 5 recipes from
   `https://www.lekkerensimpel.com/` import successfully.

A `409 CONFLICT` (the recipe already exists, or is already queued, in the target cookbook) counts
toward NEITHER a pass nor a failure — it proves nothing about the URL. Use a throwaway cookbook so
you are never fighting your own leftover data.

## Minting a throwaway API key

The gate authenticates as `x-api-key` against a REAL account. Do not run it against a real
household. Mint a key for a THROWAWAY account whose active cookbook is a THROWAWAY cookbook:

1. Sign in (or sign up) as a disposable account with no recipes of its own.
2. Settings → API Keys → Create API Key. Copy the key ONCE — it is shown only at creation time.
3. Export it as an environment variable in the shell you run the gate from. NEVER pass it as a
   command-line argument (it would land in shell history and in `ps` output) and never commit it:

   ```bash
   export GATE_API_KEY='...'
   ```

## Invocation

```bash
export GATE_BASE_URL='http://localhost:3000'      # or the live public URL
export GATE_API_KEY='...'                          # never on the command line, see above
export GATE_POLL_TIMEOUT_MS=180000                 # optional, default shown
export GATE_POLL_INTERVAL_MS=3000                  # optional, default shown

# Capture the container log for the gate window BEFORE queuing anything, so the
# parserPath markers (27.1-02) are all inside the capture:
docker logs -f norish-app > /tmp/27.1-gate.log &

# Bar 1 — the mandated URL alone.
GATE_URLS_FILE=/tmp/bar1.txt \
GATE_MIN_URLS=1 GATE_MIN_CATEGORIES=1 \
GATE_LOG_FILE=/tmp/27.1-gate.log \
GATE_OUT_JSON=/tmp/bar1.json GATE_OUT_MD=/tmp/bar1.md \
node tooling/import-gate/run-import-gate.mjs
# (the single mandated line, e.g. `head -1 tooling/import-gate/urls.ah.txt > /tmp/bar1.txt`)

# Bar 2 — only after bar 1 exits 0.
GATE_URLS_FILE=tooling/import-gate/urls.ah.txt \
GATE_MIN_URLS=10 GATE_MIN_CATEGORIES=6 \
GATE_LOG_FILE=/tmp/27.1-gate.log \
GATE_OUT_JSON=/tmp/bar2.json GATE_OUT_MD=/tmp/bar2.md \
node tooling/import-gate/run-import-gate.mjs

# Bar 3 — only after bar 2 exits 0. Note bar 2's file's first line is bar 1's own
# URL (already imported); GATE_MIN_URLS counts `ok` rows, so a 409 conflict on a
# re-run of that first line does not silently inflate the bar-2 count.
GATE_URLS_FILE=tooling/import-gate/urls.lekkerensimpel.txt \
GATE_MIN_URLS=5 GATE_MIN_CATEGORIES=1 \
GATE_LOG_FILE=/tmp/27.1-gate.log \
GATE_OUT_JSON=/tmp/bar3.json GATE_OUT_MD=/tmp/bar3.md \
node tooling/import-gate/run-import-gate.mjs
```

## Self-test

`run-import-gate.mjs` has a dependency-free `--self-test` mode that exercises every pure helper
(URL-file parsing incl. the trailing `# category` comment, the log join, the per-system ingredient
counting, the bar evaluator) against inline fixtures with `node:assert/strict`, with no test
framework and no network call:

```bash
node --check tooling/import-gate/run-import-gate.mjs
node tooling/import-gate/run-import-gate.mjs --self-test
```

## Reading a `conflict`

`POST /api/v1/recipes/import/url` (`packages/trpc/src/routers/recipes/recipes.ts:423-463`) throws
`409 CONFLICT` when the recipe already exists, or is already queued, in the caller's active
cookbook. The harness records this as its own `conflict` outcome, separate from `ok` — it is
neither a pass nor a failure, and the summary block prints the conflict count loudly so an operator
cannot mistake a wall of conflicts for a wall of passes. If you see conflicts, either supply URLs not
already in the target cookbook, or re-run against a fresh throwaway cookbook.

## Capturing `GATE_LOG_FILE`

Start `docker logs -f norish-app > /tmp/27.1-gate.log &` BEFORE queuing the first URL of a run, and
pass that path as `GATE_LOG_FILE`. The harness joins on the exact marker strings 27.1-02 emits (see
`27.1-02-SUMMARY.md`): log message `"Recipe import: parse path taken"`, fields `parserPath`
(`"ai"` | `"jsonld-fallback"` | `"structured"`), `usedAI`, `cookMinted`, `jsonLdNodeCount`. It
matches ONLY that message string — `jsonld-fallback.ts`'s own outcome log carries the same
`parserPath` field but a DIFFERENT message and is deliberately not matched, to avoid double-counting
a fallback-taken import. When `GATE_LOG_FILE` is not given, the `path` / `JSON-LD` columns read
`unknown` rather than being silently omitted.

## Which Camoufox served the gate

Record the deployed container's resolved `CAMOFOX_URL`
(`docker exec norish-app printenv CAMOFOX_URL`, or its absence meaning the in-stack
`http://camofox:9377` default) in the evidence report. A gate passed against the off-stack LXC-105
Camoufox does not prove the in-stack service added by 27.1-04 — see `tooling/fork-stack/README.md`.

## Output

- `GATE_OUT_JSON`: the full row array as JSON.
- `GATE_OUT_MD`: a markdown table, one row per URL, columns exactly `url | category | outcome |
  fetch OK | JSON-LD | path | metric ing | us ing | cook_source | confidence | review | failure
  (verbatim)`.
- stdout: a running per-URL progress line, then a summary block (`ok` count, `conflict` count, every
  other outcome listed individually, distinct category count) and `GATE PASSED` / `GATE FAILED`.
- Exit code: `0` only when `ok >= GATE_MIN_URLS` AND distinct categories among `ok` rows
  `>= GATE_MIN_CATEGORIES` AND no row is `queue-error` or `timeout`. A `timeout` is the "eternal
  skeleton" symptom this whole phase exists to remove — it always fails the run, regardless of the
  other counts.

`GATE_API_KEY` is never written to `GATE_OUT_JSON`/`GATE_OUT_MD`/stdout/stderr — any error body that
happened to echo it back is redacted before being written anywhere.
