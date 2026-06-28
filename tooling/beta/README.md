# norish-beta provisioning and refresh runbook

This runbook covers the `norish-beta.knoppsmart.com` isolated validation environment
(Phase 20, D-11/D-12). The beta stack lets you validate the 0.19.0-beta integration
branch against real data without touching the live `norish.knoppsmart.com` stack.

---

## Refresh expectation (D-12 / Pitfall 5)

**Re-clone the beta DB from live before every validation session.**

The beta database diverges from live as soon as the beta app runs (new migrations,
config re-seeding, any data mutation). A stale beta DB means you are validating against
data that does not reflect the current production state — treat that as a defect, not
an acceptable baseline.

The `tooling/beta/clone-beta-db.sh` script exists for this purpose. Run it at the start
of each session; see the "DB clone / refresh" section below for the exact steps.

---

## Prerequisites

| Item | Requirement |
|------|-------------|
| Beta image | `norish:beta` must be built from `integ/upstream-0.19.0` by the director (see below) |
| Live dump | `/home/claude/norish-backups/norish-live-YYYYMMDD-HHMMSS.dump` (or generate fresh) |
| Cloudflare | Ingress rule `norish-beta.knoppsmart.com → localhost:3001` added (see Cloudflare step) |
| WorkOS | Callback `https://norish-beta.knoppsmart.com/api/auth/oauth2/callback/workos` registered |
| beta.env | `/opt/norish/beta.env` filled in from `docker/beta.env.example` (fresh MASTER_KEY) |

---

## Step 1 — Build the beta image (director-owned)

Per CLAUDE.md, `pnpm docker:build` is the director's responsibility. Run it detached and
poll the log — never a Monitor/sleep wait-loop in a subagent:

```bash
# On LXC 110, from /opt/norish-src on branch integ/upstream-0.19.0:
nohup pnpm docker:build > /tmp/beta-build.log 2>&1 &
echo $! > /tmp/beta-build.pid

# Poll (from a separate terminal or after waiting):
tail -f /tmp/beta-build.log

# Tag the result as norish:beta after the build exits 0:
docker tag norish:latest norish:beta
```

If the Next.js build is tight on memory, add a temporary swapfile from the Proxmox host:

```bash
# On the Proxmox host (not LXC 110):
pct set 110 -swap 4096   # live cgroup change, no restart needed
# Restore after the build:
pct set 110 -swap 0
```

---

## Step 2 — Prepare the beta env

```bash
# On LXC 110:
cp /opt/norish-src/docker/beta.env.example /opt/norish/beta.env

# Edit /opt/norish/beta.env and fill in:
#   MASTER_KEY  — generate a NEW key: openssl rand -base64 32
#                 MUST differ from live's key (T-20-06-KEY)
#   WORKOS_API_KEY — same WorkOS API key as live (the callback URL differs)
#   Any other <REPLACE_...> placeholders
```

---

## Step 3 — Start the beta stack

```bash
# On LXC 110, from /opt/norish-src:
docker compose -f docker/docker-compose.beta.yml --env-file /opt/norish/beta.env up -d

# Verify containers are up:
docker ps | grep norish-beta
```

The beta app listens on port 3001. The live stack (port 3000) is untouched.

---

## Step 4 — DB clone / refresh

Run this before every validation session to restore a live snapshot into the beta DB:

```bash
# Option A: use the existing backup (quick):
BETA_DATABASE_URL="postgres://postgres:norish-beta@localhost:5434/norish" \
  bash /opt/norish-src/tooling/beta/clone-beta-db.sh \
  /home/claude/norish-backups/norish-live-20260625-162541.dump

# Option B: take a fresh live dump first (recommended for accuracy):
sg docker -c "docker exec norish-db pg_dump -U postgres -Fc norish" \
  > /home/claude/norish-backups/norish-live-$(date +%Y%m%d-%H%M%S).dump
BETA_DATABASE_URL="postgres://postgres:norish-beta@localhost:5434/norish" \
  bash /opt/norish-src/tooling/beta/clone-beta-db.sh \
  /home/claude/norish-backups/norish-live-$(date +%Y%m%d-%H%M%S).dump
```

The script asserts that `$BETA_DATABASE_URL` contains `norish-beta` before running
`pg_restore --clean --if-exists`. It will refuse to run against a URL that looks like
the live Postgres, preventing accidental data loss (T-20-06-DBLEAK).

Note: `norish-beta-db` may not expose a host port by default. If that is the case, run
`pg_restore` through the container using `docker exec`:

```bash
# Alternative via docker exec (no host port required):
docker exec -i norish-beta-db \
  pg_restore --clean --if-exists --no-owner --no-privileges \
  -U postgres -d norish < /home/claude/norish-backups/norish-live-20260625-162541.dump
```

---

## Step 5 — Cloudflare ingress (dashboard action)

The `cloudflared` tunnel for `norish.knoppsmart.com` is managed via the Cloudflare Zero
Trust dashboard (no local config file). To route `norish-beta.knoppsmart.com`:

1. Log in to the Cloudflare Zero Trust dashboard.
2. Navigate to **Networks → Tunnels** and open the tunnel used by `norish.knoppsmart.com`.
3. Add a new **Public Hostname** rule:
   - Subdomain: `norish-beta`
   - Domain: `knoppsmart.com`
   - Service: `http://localhost:3001`
4. Save and wait for DNS propagation (usually under a minute).

---

## Step 6 — WorkOS callback (dashboard action)

WorkOS AuthKit requires the callback URI for the new beta domain to be explicitly
registered (T-20-06-CB — prevents callback hijack on the new domain).

1. Log in to the WorkOS dashboard.
2. Navigate to **User Management → Redirects**.
3. Add `https://norish-beta.knoppsmart.com/api/auth/oauth2/callback/workos`.
4. Save.

---

## Step 7 — Smoke-check

```bash
# Beta health:
curl -s https://norish-beta.knoppsmart.com/api/v1/health
# Expected: {"status":"ok","db":"ok"}

# Confirm live stack is untouched:
docker ps | grep norish-app   # still running norish:live on port 3000
```

---

## Isolation invariants (enforced by this repo)

| Invariant | How enforced |
|-----------|--------------|
| Separate Postgres | `norish-beta-db` container + volume `norish_beta_db_data`; no reference to `norish_db_data` in compose |
| Separate Redis | `norish-beta-redis` container + own volume |
| Separate network | `norish-beta` docker network; beta services have no route to live's bridge |
| Separate encryption key | `MASTER_KEY` placeholder in `beta.env.example` with explicit warning to generate a new key |
| Clone script live-target guard | `clone-beta-db.sh` refuses if `$BETA_DATABASE_URL` does not contain `norish-beta` |

---

## Stopping the beta stack

```bash
docker compose -f docker/docker-compose.beta.yml --env-file /opt/norish/beta.env down
# Volumes are preserved — re-clone DB on next session to get a fresh snapshot.
# To also remove volumes: docker compose ... down -v
```
