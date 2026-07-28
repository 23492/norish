# Fork-stack Camoufox adoption runbook

**Nothing in this document is executed during phase 27.1.** This is a runbook for the
DIRECTOR to run later, as a separate, deliberate step (CLAUDE.md: "the live stack is untouched
mid-phase"). Plan 27.1-04 only produces `docker/docker-compose.fork.yml` and this file; no task
in that plan ran `docker compose up/down/restart`, `docker run`, or `pct exec` against the live
host.

---

## 1. What changed and why.

D-27.1-08: the live compose (`/opt/norish/docker-compose.fork.yml`) defines only `norish`, `db`,
and `redis` — **no `camofox` service at all**. `norish-app` runs on the docker network
`norish_default`. The only Camoufox container actually reachable, `norishp2-camofox-1`, runs on
the completely unrelated network `norishp2_default` and cannot be reached from `norish_default`.
Live has worked only because `CAMOFOX_URL` is set to the off-stack address of LXC 105
(`http://192.168.2.26:9377`) — an undocumented single point of failure with no in-stack
fallback and no `depends_on` relationship at all.

**The Camoufox service itself is healthy.** A full open -> act -> evaluate -> close probe
against `http://192.168.2.26:9377` on 2026-07-28 returned 200s and rendered a real recipe page
(`hasRecipeLd: true`). This is a **topology / architecture fix**, not a repair of a broken
browser: `docker/docker-compose.fork.yml` (repo-tracked, plan 27.1-04) adds an in-stack
`camofox` service built from the vendored source already in the tree
(`docker/camofox`, SETUP-04), so the app no longer depends on reaching across an LXC boundary
to scrape a page.

## 2. Pre-adoption checks.

All read-only. Run these from the repo checkout (`/opt/norish-src`) before touching anything on
the live host.

```bash
# 1. Confirm the live compose's current service list and network (read-only; do not edit).
cat /opt/norish/docker-compose.fork.yml
docker network ls
docker inspect norish-app --format '{{json .NetworkSettings.Networks}}'

# 2. Confirm the current CAMOFOX_URL live is actually using.
docker exec norish-app printenv CAMOFOX_URL
# Expected today: http://192.168.2.26:9377 (the off-stack LXC-105 address, D-27.1-08).

# 3. Confirm the vendored camofox source builds, from the repo checkout.
cd /opt/norish-src
docker compose -f docker/docker-compose.fork.yml -p norish build camofox
```

Step 3 tags a locally-built image under the `norish` project name. Keep using `-p norish` for
every subsequent command in this runbook so Compose reuses that image rather than needing the
`./camofox` build context to exist wherever the compose file happens to be.

## 3. Adoption.

The repo file is a **mirror**, not a blind replacement — reconcile it against the file already
running production before applying anything.

```bash
# 1. Diff the repo mirror against the live file. Expect differences: the repo file omits
#    AI_API_KEY / WORKOS_API_KEY (live-only secrets, intentionally never written into a
#    tracked file) and any other live-only key. Re-add anything live-only BY HAND into a
#    working copy before applying — do not overwrite blindly.
diff /opt/norish/docker-compose.fork.yml /opt/norish-src/docker/docker-compose.fork.yml

# 2. Copy the reconciled file into place (after the diff above has been resolved by hand).
cp /opt/norish-src/docker/docker-compose.fork.yml /opt/norish/docker-compose.fork.yml

# 3. Bring up ONLY camofox first, and confirm it is healthy before touching norish.
cd /opt/norish
docker compose -f docker-compose.fork.yml -p norish --env-file .env up -d camofox
docker compose -f docker-compose.fork.yml -p norish ps camofox
# Expect STATUS to show "(healthy)" once the healthcheck passes (start_period 40s).

# 4. Only once camofox is healthy, recreate norish so it picks up the new CAMOFOX_URL default
#    and the depends_on: camofox / condition: service_healthy gate.
docker compose -f docker-compose.fork.yml -p norish --env-file .env up -d norish
```

`db` and `redis` are unaffected by this change — they are not recreated by the steps above
unless their definitions also changed in the diff.

## 4. The reachability proof.

**A probe from the HOST is not sufficient evidence.** The original defect was that the host
could reach `norishp2-camofox-1` while the app container could not reach anything — the app
container's network is what must be proven, not the host's. Every command below runs with
`docker exec norish-app`, exercising the exact REST surface `packages/api/src/camofox.ts` uses
(`POST /tabs/open`, an `evaluate` call using the same readiness-probe expression the app uses,
then `DELETE /sessions/:userId` to clean up), so the proof matches what the app actually does
in production, not a synthetic health-only check.

```bash
# 1. Basic health, from INSIDE the app container.
docker exec norish-app node -e "\
  require('http').get('http://camofox:9377/health', r => { \
    console.log('status', r.statusCode); process.exit(r.statusCode === 200 ? 0 : 1); \
  });"
# Expected: status 200

# 2. Full open -> evaluate -> close cycle against a real recipe URL, from INSIDE the app
#    container, matching packages/api/src/camofox.ts's fetchRenderedHtml() call shape.
docker exec norish-app node -e "\
  const userId = 'fork-stack-reachability-proof'; \
  const base = 'http://camofox:9377'; \
  (async () => { \
    const open = await fetch(base + '/tabs/open', { \
      method: 'POST', headers: { 'Content-Type': 'application/json' }, \
      body: JSON.stringify({ \
        userId, listItemId: userId, \
        url: 'https://www.ah.nl/allerhande/recept/R-R951540/bonensalade-met-kip-en-avocado' \
      }), \
    }).then(r => r.json()); \
    const tabId = open.targetId ?? open.tabId; \
    console.log('open', JSON.stringify(open)); \
    const probe = 'JSON.stringify({ready:document.readyState,' + \
      'hasRecipeLd:!!document.querySelector(\'script[type=\"application/ld+json\"]\'),' + \
      'len:document.documentElement.outerHTML.length,title:document.title})'; \
    const evaluated = await fetch(base + '/tabs/' + tabId + '/evaluate', { \
      method: 'POST', headers: { 'Content-Type': 'application/json' }, \
      body: JSON.stringify({ userId, expression: probe }), \
    }).then(r => r.json()); \
    console.log('evaluate', JSON.stringify(evaluated)); \
    const closed = await fetch(base + '/sessions/' + userId, { method: 'DELETE' }); \
    console.log('close status', closed.status); \
  })().catch(e => { console.error(e); process.exit(1); });"
# Expected: open.{targetId|tabId} present, evaluate.result JSON-parses to
# { ready: 'complete', hasRecipeLd: true, len: <a large number>, title: <the recipe title> },
# close status 200 or 204.
```

If either command fails from inside `norish-app` but succeeds from the host, the defect this
plan fixes is NOT actually resolved — do not proceed to declaring the in-stack service adopted.

## 5. Rollback.

The off-stack LXC-105 Camoufox stays available specifically so this rollback is always possible
— that is why `CAMOFOX_URL` is kept as an explicit override rather than removed:

```bash
cd /opt/norish
# Point CAMOFOX_URL back at the off-stack instance in .env, then recreate norish only.
# (Edit /opt/norish/.env: CAMOFOX_URL=http://192.168.2.26:9377)
docker compose -f docker-compose.fork.yml -p norish --env-file .env up -d norish
```

`camofox` (in-stack) can be left running or stopped independently — rolling back `norish`'s
`CAMOFOX_URL` does not require tearing down the in-stack service.

## 6. What NOT to do.

- Do **not** reintroduce a `chrome-headless` dependency, a Chromium/Playwright image, or a
  boot-time bundle patch anywhere in this adoption — the fork removed
  `packages/api/src/playwright.ts` in Phase 1 and CLAUDE.md forbids resurrecting it or any
  equivalent. The `camofox` service builds Camoufox (a Firefox fork), never Chromium and never
  via Playwright.
- Do **not** delete or decommission the LXC-105 Camoufox until the in-stack service has served
  real production imports and the empirical gate (plan 27.1-05, see §7 below) has passed against
  it specifically.
- Do **not** apply this compose file to live by blindly overwriting the file already there (§3)
  — reconcile live-only keys (`AI_API_KEY`, `WORKOS_API_KEY`, anything else) by hand first.
- Do **not** skip the inside-the-container reachability proof (§4) and rely on a host-side probe
  — that is exactly the gap that let D-27.1-08 go unnoticed.

## 7. Relationship to plan 27.1-05.

Plan 27.1-05 runs the post-deploy empirical import gate (D-27.1-09: 1 AH.nl recipe, then >= 10
further AH.nl recipes across >= 6 categories, then >= 5 lekkerensimpel.com recipes) against
whatever `CAMOFOX_URL` resolves to **at the time it runs**. Record which Camoufox actually served
each request (`docker exec norish-app printenv CAMOFOX_URL` immediately before and after the
gate). A gate that passes while `CAMOFOX_URL` still points at LXC 105 proves nothing about the
in-stack service adopted here — it only re-confirms what was already known healthy. Only a gate
run with `CAMOFOX_URL` resolved to `http://camofox:9377` (the in-stack service) closes out
D-27.1-08 empirically.
