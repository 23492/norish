#!/usr/bin/env bash
# clone-beta-db.sh — Restore a live pg_dump into the isolated beta DB.
#
# USAGE:
#   BETA_DATABASE_URL=postgres://postgres:norish-beta@norish-beta-db:5432/norish \
#     bash tooling/beta/clone-beta-db.sh [/path/to/dump]
#
#   Or with the default dump path:
#     BETA_DATABASE_URL=... bash tooling/beta/clone-beta-db.sh
#
# PURPOSE (D-12 / Pitfall 5):
#   Before each validation session the beta DB must be re-cloned from a fresh live dump
#   so that beta validates against real data, not a stale snapshot. Treat a stale beta DB
#   as a defect — re-run this script rather than continuing with old data.
#
# SAFETY GUARD (T-20-06-DBLEAK):
#   The script asserts that $BETA_DATABASE_URL contains "norish-beta" before proceeding.
#   This prevents accidentally restoring a live dump INTO the live Postgres instance.
#
# OPERATOR STEPS (run from LXC 110 with docker access):
#   1. Take a fresh live dump (or use the existing backup):
#        sg docker -c 'docker exec norish-db pg_dump -U postgres -Fc norish' \
#          > /home/claude/norish-backups/norish-live-$(date +%Y%m%d-%H%M%S).dump
#   2. Ensure the norish-beta stack is running (norish-beta-db container healthy).
#   3. Run this script:
#        BETA_DATABASE_URL=postgres://postgres:norish-beta@localhost:5434/norish \
#          bash tooling/beta/clone-beta-db.sh /home/claude/norish-backups/<latest>.dump
#      (Adjust the host:port if norish-beta-db maps a host port; or run via docker exec.)

set -euo pipefail

# ── Defaults ──────────────────────────────────────────────────────────────────

DEFAULT_DUMP="/home/claude/norish-backups/norish-live-20260625-162541.dump"
DUMP="${1:-$DEFAULT_DUMP}"

# ── Input validation ──────────────────────────────────────────────────────────

if [[ -z "${BETA_DATABASE_URL:-}" ]]; then
  echo "ERROR: BETA_DATABASE_URL is not set." >&2
  echo "  Set it to the beta Postgres connection string before running this script." >&2
  echo "  Example: BETA_DATABASE_URL=postgres://postgres:norish-beta@localhost:5434/norish" >&2
  exit 1
fi

# ── Live-target guard (T-20-06-DBLEAK) ────────────────────────────────────────
# Refuse to run against any target that does not look like the beta DB.
# The beta DATABASE_URL must contain "norish-beta" (the hostname norish-beta-db
# or any other indicator that this is the isolated beta Postgres).

if [[ "$BETA_DATABASE_URL" != *"norish-beta"* ]]; then
  echo "ERROR: BETA_DATABASE_URL does not contain 'norish-beta'." >&2
  echo "  This guard prevents accidentally restoring a live dump into the live database." >&2
  echo "  Refusing to proceed. Verify that BETA_DATABASE_URL points at norish-beta-db." >&2
  echo "  Got: $BETA_DATABASE_URL" >&2
  exit 1
fi

# Extra paranoia: reject any URL that explicitly mentions the live db host patterns.
# These patterns match the live stack's db container name and the live DATABASE_URL.
if [[ "$BETA_DATABASE_URL" == *"@db:"* ]] || \
   [[ "$BETA_DATABASE_URL" == *"@norish-db:"* ]] || \
   [[ "$BETA_DATABASE_URL" == *"@norish-db/"* ]]; then
  echo "ERROR: BETA_DATABASE_URL looks like the live Postgres URL (@db: / @norish-db:)." >&2
  echo "  Refusing to proceed to protect the live database." >&2
  exit 1
fi

# ── Dump file check ───────────────────────────────────────────────────────────

if [[ ! -f "$DUMP" ]]; then
  echo "ERROR: Dump file not found: $DUMP" >&2
  echo "  Either pass the path as the first argument or generate a fresh live dump:" >&2
  echo "    sg docker -c 'docker exec norish-db pg_dump -U postgres -Fc norish' \\" >&2
  echo "      > /home/claude/norish-backups/norish-live-\$(date +%Y%m%d-%H%M%S).dump" >&2
  exit 1
fi

# ── Restore ───────────────────────────────────────────────────────────────────

echo "norish-beta DB clone/refresh"
echo "  Target: $BETA_DATABASE_URL"
echo "  Dump:   $DUMP"
echo "  Guard:  BETA_DATABASE_URL contains 'norish-beta' — OK"
echo ""
echo "Running pg_restore --clean --if-exists ..."

pg_restore \
  --clean \
  --if-exists \
  --no-owner \
  --no-privileges \
  -d "$BETA_DATABASE_URL" \
  "$DUMP"

echo ""
echo "Done. Beta DB refreshed from $DUMP."
echo "Reminder: re-clone before each validation session (D-12 / Pitfall 5)."
