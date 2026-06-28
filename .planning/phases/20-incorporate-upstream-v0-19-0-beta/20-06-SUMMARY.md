---
phase: 20-incorporate-upstream-v0-19-0-beta
plan: "06"
subsystem: infra
tags: [docker, compose, postgres, redis, cloudflare, workos, pg_restore, beta]

requires:
  - phase: 20-incorporate-upstream-v0-19-0-beta/20-05
    provides: full monorepo green gate (typecheck/lint/test) on integ/upstream-0.19.0

provides:
  - docker/docker-compose.beta.yml — isolated norish-beta stack (norish:beta image, port 3001, separate DB/Redis/volumes/network)
  - docker/beta.env.example — beta env template (norish-beta.knoppsmart.com AUTH_URL, new MASTER_KEY placeholder, beta DATABASE_URL)
  - tooling/beta/clone-beta-db.sh — guarded pg_restore clone/refresh script (live-target guard, refuses non-norish-beta URLs)
  - tooling/beta/README.md — provisioning runbook with refresh expectation (D-12) and operator deploy sequence

affects:
  - future validation sessions on norish-beta.knoppsmart.com
  - any phase that cuts over 0.19.0 to live (currently deferred; out of scope)

tech-stack:
  added: []
  patterns:
    - "Beta isolation pattern: separate compose file, separate named volumes (norish_beta_db_data), dedicated docker network (norish-beta), distinct MASTER_KEY"
    - "Guarded pg_restore script: assert target URL contains norish-beta before restoring, refuse @db:/@norish-db: patterns"
    - "Refresh expectation: re-clone beta DB from live before every validation session; staleness = defect (D-12 / Pitfall 5)"

key-files:
  created:
    - docker/docker-compose.beta.yml
    - docker/beta.env.example
    - tooling/beta/clone-beta-db.sh
    - tooling/beta/README.md
  modified: []

key-decisions:
  - "Beta uses port 3001 (live=3000, old verify stack=3010) to avoid conflict on LXC 110"
  - "Camofox at http://192.168.2.26:9377 is reused (stateless, safe to share across stacks)"
  - "norish_beta_db_data volume name is distinct from norish_db_data (live) — enforced by grep gate"
  - "clone-beta-db.sh contains two live-target guards: URL must contain norish-beta AND must not match @db:/@norish-db: patterns"
  - "Task 2 (build/deploy/DNS/WorkOS/Cloudflare) is autonomous:false — operator checkpoint, not executor action"

patterns-established:
  - "Beta isolation: the four invariants (separate DB volume, separate Redis, dedicated network, distinct MASTER_KEY) are documented in the compose file header and README as a security checklist"
  - "DB refresh discipline: README documents re-clone as mandatory before each validation session, not optional"

requirements-completed: [UPSTREAM-019]

duration: 15min
completed: 2026-06-28
---

# Phase 20 Plan 06: norish-beta Config Artifacts Summary

**Isolated norish-beta compose stack with guarded pg_restore refresh script and operator runbook for norish-beta.knoppsmart.com validation of the 0.19.0-beta integration**

## Performance

- **Duration:** ~15 min
- **Started:** 2026-06-28T00:00:00Z
- **Completed:** 2026-06-28
- **Tasks:** 1 of 2 (Task 2 is a blocking operator checkpoint — not executor-executable)
- **Files created:** 4

## Accomplishments

- Authored the four beta config/script/doc artifacts per plan requirements and research §7
- docker/docker-compose.beta.yml: isolated norish-beta stack (image `norish:beta`, port `3001:3000`), `norish-beta-db` (postgres:17-alpine, volume `norish_beta_db_data`), `norish-beta-redis`, dedicated `norish-beta` docker network — zero references to the live volume `norish_db_data`
- docker/beta.env.example: beta env template with `AUTH_URL`/`TRUSTED_ORIGINS=https://norish-beta.knoppsmart.com`, clearly-placeholdered NEW `MASTER_KEY` with mandatory-distinct comment (T-20-06-KEY), `DATABASE_URL → norish-beta-db` only, WorkOS callback registration note
- tooling/beta/clone-beta-db.sh: `pg_restore --clean --if-exists` with two-layer live-target guard (URL must contain `norish-beta`; URL must not match `@db:` or `@norish-db:` patterns) — refuses to run against live Postgres (T-20-06-DBLEAK)
- tooling/beta/README.md: full operator deploy sequence (build → env → compose up → DB clone → Cloudflare → WorkOS → smoke-check) plus explicit D-12 refresh expectation ("re-clone before every session; staleness = defect")
- All Task 1 acceptance criteria verified: compose isolation grep, env template grep, script syntax `bash -n`, README refresh keyword count, git status shows only 4 new beta files

## Task Commits

1. **Task 1: Author norish-beta compose service + env template + DB clone/refresh script + runbook** — `61c674bb` (feat)

Task 2 is a `checkpoint:human-action` (blocking operator steps — see "Operator Checkpoint" section below).

## Files Created

- `docker/docker-compose.beta.yml` — isolated norish-beta stack (app:3001, norish-beta-db, norish-beta-redis, norish-beta network); never references live volume norish_db_data
- `docker/beta.env.example` — beta env template (AUTH_URL/TRUSTED_ORIGINS for beta domain, new MASTER_KEY placeholder, DATABASE_URL → norish-beta-db, WorkOS callback comment)
- `tooling/beta/clone-beta-db.sh` — guarded pg_restore clone script; asserts BETA_DATABASE_URL contains norish-beta and rejects live DB URL patterns
- `tooling/beta/README.md` — provisioning + refresh runbook (D-12 re-clone expectation, full operator deploy sequence, Cloudflare + WorkOS dashboard steps)

## Decisions Made

- Port 3001 chosen (live=3000, old verify stack=3010 — avoids collision on LXC 110)
- Camofox at `http://192.168.2.26:9377` reused (stateless service, safe to share)
- Two-layer guard in clone script (URL contains `norish-beta` AND not `@db:/@norish-db:`) to defend against both misconfiguration and a URL that happens to contain `norish-beta` in a non-host field
- `norish_beta_db_data` volume name uses underscore prefix (`norish_beta_`) to cleanly distinguish from `norish_db_data` (live) — gate: `grep -c norish_db_data compose.beta.yml` returns 0

## Deviations from Plan

None — plan executed exactly as written. The one acceptance criteria issue found during self-check (comment in compose file containing `norish_db_data` text) was corrected before committing: the comment was reworded to "never the live volume" without mentioning the live volume name by its exact string.

## Issues Encountered

Comment in `docker/docker-compose.beta.yml` isolation invariants block initially contained the string `norish_db_data` (live volume name) for documentation purposes — this caused the `grep -c norish_db_data` acceptance criterion to return 1 instead of 0. Fixed by rewording the comment to "never the live volume" before committing.

## Known Stubs

None. All four artifacts are complete and immediately usable by the operator.

## Threat Flags

No new threat surface beyond what the plan's threat model already covers. All mitigations implemented in Task 1:
- T-20-06-DBLEAK: compose uses separate `norish_beta_db_data` volume (not `norish_db_data`); clone script has two-layer live-target guard
- T-20-06-KEY: env template carries new MASTER_KEY placeholder with mandatory-distinct comment
- T-20-06-CB: WorkOS callback registration step included in README and env template comment
- T-20-06-LIVE: live stack untouched; Task 2 is autonomous:false operator checkpoint

## User Setup Required

**Task 2 is a blocking operator checkpoint.** The following steps cannot be performed by the executor. See the operator checkpoint section below.

## Operator Checkpoint (Task 2)

The following steps require LXC 110 SSH access, the director's detached-build discipline, and Cloudflare/WorkOS dashboard credentials. The live stack (`norish-app`/`norish:live`/live DB at migration 39) MUST remain untouched throughout.

**Step 1 — DIRECTOR: Build the beta image (detached + polled)**

```bash
# On LXC 110, from /opt/norish-src on branch integ/upstream-0.19.0:
nohup pnpm docker:build > /tmp/beta-build.log 2>&1 &
echo $! > /tmp/beta-build.pid
# Poll: tail -f /tmp/beta-build.log
# After exit 0: docker tag norish:latest norish:beta
```

If memory is tight, add swap from the Proxmox host first:
```bash
pct set 110 -swap 4096   # restore after build: pct set 110 -swap 0
```

**Step 2 — OPERATOR: Prepare and deploy the beta stack**

```bash
# SSH to LXC 110 (proxmox-tunnel or root@192.168.2.11)
cp /opt/norish-src/docker/beta.env.example /opt/norish/beta.env
# Edit /opt/norish/beta.env:
#   MASTER_KEY  = new key: openssl rand -base64 32  (MUST differ from live's)
#   WORKOS_API_KEY = your WorkOS API key (sk_...)

docker compose -f /opt/norish-src/docker/docker-compose.beta.yml \
  --env-file /opt/norish/beta.env up -d
docker ps | grep norish-beta
```

**Step 3 — OPERATOR: Clone the beta DB**

```bash
# Option A — use existing backup:
BETA_DATABASE_URL="postgres://postgres:norish-beta@localhost:5434/norish" \
  bash /opt/norish-src/tooling/beta/clone-beta-db.sh \
  /home/claude/norish-backups/norish-live-20260625-162541.dump

# Option B — fresh live dump first:
sg docker -c "docker exec norish-db pg_dump -U postgres -Fc norish" \
  > /home/claude/norish-backups/norish-live-$(date +%Y%m%d-%H%M%S).dump
# then run clone-beta-db.sh with the new dump path
```

Note: if `norish-beta-db` exposes no host port, use `docker exec` instead:
```bash
docker exec -i norish-beta-db \
  pg_restore --clean --if-exists --no-owner --no-privileges \
  -U postgres -d norish < /home/claude/norish-backups/norish-live-20260625-162541.dump
```

**Step 4 — OPERATOR: Cloudflare ingress (Zero Trust dashboard)**

- Open Cloudflare Zero Trust → Networks → Tunnels → [norish tunnel]
- Add Public Hostname: subdomain `norish-beta`, domain `knoppsmart.com`, service `http://localhost:3001`
- Save and wait for DNS propagation

**Step 5 — OPERATOR: WorkOS callback (WorkOS dashboard)**

- Open WorkOS dashboard → User Management → Redirects
- Add: `https://norish-beta.knoppsmart.com/api/auth/oauth2/callback/workos`
- Save

**Step 6 — OPERATOR: Smoke-check**

```bash
curl -s https://norish-beta.knoppsmart.com/api/v1/health
# Expected: {"status":"ok","db":"ok"}

# Confirm live stack untouched:
docker ps | grep norish-app   # must show norish:live on port 3000
```

**Resume signal:** Type `approved` once `curl https://norish-beta.knoppsmart.com/api/v1/health` returns `{"status":"ok","db":"ok"}` and the live stack is confirmed untouched — or describe issues (Cloudflare ingress pending, WorkOS callback not yet registered, beta DB not yet cloned).

## Next Phase Readiness

- All Phase 20 executor tasks complete (plans 20-01 through 20-06 Task 1 done)
- Beta stack config artifacts committed and ready for operator deployment
- After operator completes Task 2, beta is reachable at norish-beta.knoppsmart.com for 0.19.0 validation
- Live cutover of 0.19.0 → `norish.knoppsmart.com` is a separate future decision (out of scope for Phase 20)

---
*Phase: 20-incorporate-upstream-v0-19-0-beta*
*Completed: 2026-06-28*
