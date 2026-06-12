# Vendored: camofox-browser v1.4.1

This directory is a **vendored copy** of the Camoufox REST browser server, bundled
into the norish fork so that `docker compose` builds the scraping browser from source
(standalone, self-contained — no external image, no registry pull).

- **Upstream:** [`github.com/jo-inc/camofox-browser`](https://github.com/jo-inc/camofox-browser) (`@askjo/camofox-browser`)
- **Pinned version:** **1.4.1** (see `package.json`)
- **Bundled Camoufox binary:** **135.0.1 / beta.24** (see the `ARG CAMOUFOX_VERSION` / `ARG CAMOUFOX_RELEASE` defaults in `Dockerfile`)

## Why pinned to v1.4.1

The newer published images (`ghcr.io/jo-inc/camofox-browser` 1.8–1.11.x) **regressed
on Akamai evasion** and fail the AH.nl bot challenge (returning the Access-Denied /
Akamai interstitial instead of the page). v1.4.1 runs the same Camoufox binary
(135.0.1/beta.24) and reliably clears AH.nl in a few seconds, so we pin and build it.

## Maintenance

- Keep the upstream `LICENSE` (MIT) intact.
- To upgrade: re-vendor the matching upstream tag here and re-verify against AH.nl
  before pointing the compose `camofox` service at the new build.
- The compose `camofox` service builds this directory (`build.context: ./camofox`).
  The container listens on the port set via the `CAMOFOX_PORT` env var (compose sets
  `9377`; the Dockerfile default is `3000`).

## Fork deviation from upstream source

The vendored `Dockerfile` base was bumped from upstream's `node:20-slim` to `node:22-slim`.
Reason: `camoufox-js` pulls in the native `better-sqlite3`, which publishes **no
prebuilt binary for the node-20 ABI** — so on node 20 the install falls back to
`node-gyp rebuild`, which fails in the slim image (no C/C++ toolchain). node 22 has a
prebuilt binary (install succeeds with no compile) and matches the proven-working host.
This is the only change to the upstream source files.
