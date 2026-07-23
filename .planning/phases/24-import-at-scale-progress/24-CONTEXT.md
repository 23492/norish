# Phase 24: Import at scale & visible progress — Context

**Gathered:** 2026-07-23 (retroactive — this phase was executed across an interrupted
session; the context is reconstructed to match what shipped)
**Status:** Code-complete
**Requirements:** BULK-01, IMPORT-UX-01 (source: UAT section B2)

<domain>
## Phase Boundary

Two halves of the same queue-UX story, both riding the per-cookbook realtime bus that
Phase 22 isolated (which is exactly why Phase 22 had to land first):

1. **BULK-01** — accept many recipe URLs in one submission (a newline/comma list OR a
   pasted blog index), fanned out over the EXISTING Camoufox import queue as one job per
   URL. Each job carries the actor's ACTIVE cookbook and reuses the single-import
   `addImportJob` path, so per-cookbook dedup + job-id scoping (Phase 22.1) hold unchanged.
   Per-item enqueue outcome is reported (queued / exists / duplicate); import success or
   failure then arrives per item over the realtime bus.

2. **IMPORT-UX-01** — a real progress indicator for a running import (single AND bulk),
   replacing the bare skeleton card. It reflects the honest stage of the job
   (`fetching` → `saving`), rides the realtime bus, and is subscribed to the ACTOR's
   cookbook only. Durations are genuinely unknown, so the UI shows the stage label with an
   indeterminate spinner rather than faking a percentage bar.

Out of scope: `apps/mobile` (Expo). No whole-site crawl — we only EXTRACT http(s) URLs from
the pasted text; we never fetch a page to spider it, so there is no server-side crawl and
no per-domain rate-limiting concern (each URL is one ordinary queue job bounded by existing
worker concurrency — this answers the roadmap's open question). No schema change.
</domain>

<decisions>
## Decisions (recorded)

### D-24-01 — Bulk submission cap = 25 URLs
A single bulk submission is capped at `MAX_BULK_IMPORT_URLS = 25`, enforced in the zod
input schema (so the limit holds for direct API callers, not just the UI) AND in the
client-side `parseBulkImportUrls` preview (extra valid URLs are counted as `truncated`).
Rationale: bound the number of concurrent pending skeleton cards + realtime streams on the
dashboard, and bound one user's queue fan-out so a bulk run cannot starve the shared import
queue for other users. Chosen over an unbounded submission; revisit if users hit it.

### D-24-02 — No crawl; extract URLs from text only
`parseBulkImportUrls` extracts http(s) URLs embedded anywhere in the pasted text (blog-index
friendly), strips trailing prose punctuation, validates each with `httpUrlSchema`, and dedups
with the SAME `normalizeUrl` the import dedup path uses — so the client's detected-count
preview matches what the server would actually enqueue. We never fetch/spider a page, so the
open question ("does a whole-blog crawl need per-domain rate limiting?") is moot by design.

### D-24-03 — Honest, worker-witnessed stages only
The progress event carries only the stages the worker can actually observe: `fetching`
(Camoufox fetch + extract) and `saving` (writing the parsed recipe to the DB). The
queued→started transition is already carried by `importStarted`; completion by
`imported`/`failed`. No synthetic timer, no fake percentage.

### D-24-04 — Progress is cookbook-scoped, never broadcast (HOUSE-06 / REALTIME-ISO-01)
`emitImportProgress` is the ONLY new realtime emit site. It is resource-bearing, so it goes
through `emitByPolicy` with the scope the worker already resolved for the job (via
`resolveHouseholdRealtimeScope`, keyed on the import's TARGET cookbook) and reuses it — it
NEVER calls `emitter.broadcast()`. Under the production default `view: "everyone"`,
`emitByPolicy` clamps to the household channel, so client B never sees cookbook A's progress.

### D-24-05 — No migration
Nothing in this phase touches the schema. The DB stays at migration 40 (40→40 no-op).
</decisions>

<references>
- vault `norish-uat-v0.19.0` section B2
- `packages/queue/src/recipe-import/` (producer.ts, worker.ts, progress.ts, generateJobId)
- `packages/shared-server/src/realtime/policy.ts` (`emitByPolicy`, resolvers)
- `.planning/phases/22-realtime-fan-out-isolation/` (the isolated bus this rides)
</references>
