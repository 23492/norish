import type { SiteAuthTokenDecryptedDto } from "@norish/shared/contracts/dto/site-auth-tokens";

import { SERVER_CONFIG } from "@norish/config/env-config-server";
import { parserLogger as log, redactUrl } from "@norish/shared-server/logger";

// Timeouts (ms) for the individual Camoufox REST calls. Navigation is the slowest
// step (the service navigates with a 30s domcontentloaded budget) so it gets the
// largest envelope; reads and waits are comparatively cheap.
const OPEN_TIMEOUT_MS = 35000;
const ACT_TIMEOUT_MS = 30000;
const EVALUATE_TIMEOUT_MS = 15000;
const HTML_TIMEOUT_MS = 20000;
const DELETE_TIMEOUT_MS = 8000;

// Floor wait so SPA pages (e.g. AH = Next.js) hydrate before we read the DOM.
const FLOOR_WAIT_MS = 4500;
// Readiness polling: poll until the document is complete and either recipe JSON-LD
// is present or the HTML length is large/stable, capped at this overall budget.
const READINESS_BUDGET_MS = 10000;
const READINESS_POLL_INTERVAL_MS = 500;
const LARGE_HTML_THRESHOLD = 200000;
const STABLE_LENGTH_REPEATS = 2;
// Anything smaller than this is treated as an empty/blocked response.
const MIN_HTML_LENGTH = 500;

// Probe evaluated in the page to gauge readiness without round-tripping the full HTML.
const READINESS_PROBE_EXPRESSION =
  'JSON.stringify({ready:document.readyState,hasRecipeLd:!!document.querySelector(\'script[type="application/ld+json"]\'),len:document.documentElement.outerHTML.length,title:document.title})';
const LOCATION_EXPRESSION = "document.location.href";
const OUTER_HTML_EXPRESSION = "document.documentElement.outerHTML";

const BLOCK_TITLE_PATTERN = /Access Denied|Just a moment/i;
const BLOCK_BODY_PATTERN = /Access Denied|id=["']challenge-running["']/i;

interface ReadinessProbe {
  ready: string;
  hasRecipeLd: boolean;
  len: number;
  title: string;
}

interface TabOpenResponse {
  targetId?: string;
  tabId?: string;
  url?: string;
  title?: string;
}

interface EvaluateResponse {
  result?: unknown;
}

function getCamofoxBaseUrl(): string {
  return SERVER_CONFIG.CAMOFOX_URL.replace(/\/$/, "");
}

/**
 * Call a Camoufox REST endpoint, applying an AbortController timeout and unwrapping
 * the `{ ok, ... }` envelope. Throws on transport errors, non-2xx responses, and
 * `{ ok: false }` payloads so callers can fall back to a plain HTTP fetch.
 */
async function callCamofox<T>(
  method: "POST" | "DELETE",
  path: string,
  body: Record<string, unknown>,
  timeoutMs: number
): Promise<T> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };

  if (SERVER_CONFIG.CAMOFOX_API_KEY) {
    headers.Authorization = `Bearer ${SERVER_CONFIG.CAMOFOX_API_KEY}`;
  }

  const response = await fetch(`${getCamofoxBaseUrl()}${path}`, {
    method,
    headers,
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(timeoutMs),
  });

  const text = await response.text();
  let data: unknown = {};

  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = { raw: text };
    }
  }

  if (!response.ok) {
    throw new Error(`Camoufox ${method} ${path} failed with status ${response.status}`);
  }

  if (data && typeof data === "object" && (data as { ok?: boolean }).ok === false) {
    const message = (data as { error?: string }).error ?? "";

    throw new Error(`Camoufox ${method} ${path} returned ok:false ${message}`.trim());
  }

  return data as T;
}

/**
 * Inject cookie-type auth tokens into the Camoufox session context.
 *
 * Must be called before opening the tab for the same `userId` (the session is
 * created/reused by `userId`). This endpoint is gated, so it is skipped with a
 * warning when no `CAMOFOX_API_KEY` is configured.
 */
async function applyCookieTokens(
  userId: string,
  cookieTokens: SiteAuthTokenDecryptedDto[],
  targetUrl: string
): Promise<void> {
  if (!SERVER_CONFIG.CAMOFOX_API_KEY) {
    log.warn(
      { url: redactUrl(targetUrl), count: cookieTokens.length },
      "Cookie auth tokens not applied: CAMOFOX_API_KEY is not configured"
    );

    return;
  }

  let domain: string;

  try {
    domain = new URL(targetUrl).hostname;
  } catch {
    domain = targetUrl;
  }

  await callCamofox(
    "POST",
    `/sessions/${userId}/cookies`,
    {
      cookies: cookieTokens.map((token) => ({
        name: token.name,
        value: token.value,
        domain,
        path: "/",
      })),
    },
    EVALUATE_TIMEOUT_MS
  );
}

/** Evaluate an expression in the open tab and return its string result, if any. */
async function evaluateString(
  userId: string,
  tabId: string,
  expression: string,
  timeoutMs: number
): Promise<string | undefined> {
  const response = await callCamofox<EvaluateResponse>(
    "POST",
    `/tabs/${tabId}/evaluate`,
    { userId, expression },
    timeoutMs
  );

  return typeof response.result === "string" ? response.result : undefined;
}

/**
 * Poll the page until it is ready to be read: `readyState === "complete"` and
 * either recipe JSON-LD is present, the HTML is large, or its length has stabilised.
 * Returns the most recent observed title for block detection.
 */
async function waitForReadiness(userId: string, tabId: string, targetUrl: string): Promise<string> {
  let title = "";
  let lastLen = 0;
  let stableCount = 0;
  const deadline = Date.now() + READINESS_BUDGET_MS;

  while (Date.now() < deadline) {
    let probe: ReadinessProbe | undefined;

    try {
      const result = await evaluateString(
        userId,
        tabId,
        READINESS_PROBE_EXPRESSION,
        EVALUATE_TIMEOUT_MS
      );

      probe = result ? (JSON.parse(result) as ReadinessProbe) : undefined;
    } catch (err) {
      log.debug({ err, url: redactUrl(targetUrl) }, "Camoufox readiness probe failed, retrying");
      await delay(READINESS_POLL_INTERVAL_MS);
      continue;
    }

    if (probe?.title) title = probe.title;

    const len = probe?.len ?? 0;

    if (len === lastLen && len > 0) {
      stableCount += 1;
    } else {
      stableCount = 0;
    }
    lastLen = len;

    const ready = probe?.ready === "complete";

    if (ready && (probe?.hasRecipeLd || len > LARGE_HTML_THRESHOLD || stableCount >= STABLE_LENGTH_REPEATS)) {
      break;
    }

    await delay(READINESS_POLL_INTERVAL_MS);
  }

  return title;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isBlocked(title: string, html: string): boolean {
  return BLOCK_TITLE_PATTERN.test(title) || BLOCK_BODY_PATTERN.test(html);
}

/** Best-effort session teardown; never throws. Closes the whole context (all tabs). */
async function closeSession(userId: string): Promise<void> {
  try {
    await callCamofox("DELETE", `/sessions/${userId}`, { userId }, DELETE_TIMEOUT_MS);
  } catch (err) {
    log.debug({ err, userId }, "Failed to close Camoufox session during cleanup");
  }
}

/**
 * Fetch the fully rendered HTML of a page via the Camoufox REST service.
 *
 * Cookie-type auth tokens are injected into the session before navigation (requires
 * `CAMOFOX_API_KEY`). Header-type tokens are not supported: Camoufox has no
 * per-request header API, so they are logged and skipped.
 *
 * Returns the rendered HTML on success, or an empty string on any failure or hard
 * block — callers treat `""` as a signal to fall back to a plain HTTP fetch.
 */
export async function fetchRenderedHtml(
  targetUrl: string,
  tokens?: SiteAuthTokenDecryptedDto[]
): Promise<string> {
  const userId = `norish-${crypto.randomUUID()}`;

  const headerTokens = tokens?.filter((token) => token.type === "header") ?? [];

  if (headerTokens.length > 0) {
    log.warn(
      { url: redactUrl(targetUrl), count: headerTokens.length },
      "Header auth tokens are not applied via Camoufox (no per-request header support)"
    );
  }

  try {
    const cookieTokens = tokens?.filter((token) => token.type === "cookie") ?? [];

    if (cookieTokens.length > 0) {
      await applyCookieTokens(userId, cookieTokens, targetUrl);
    }

    const open = await callCamofox<TabOpenResponse>(
      "POST",
      "/tabs/open",
      { userId, listItemId: userId, url: targetUrl },
      OPEN_TIMEOUT_MS
    );
    const tabId = open.targetId ?? open.tabId;

    if (!tabId) throw new Error("Camoufox /tabs/open returned no tabId");

    let title = open.title ?? "";
    let finalUrl = open.url ?? targetUrl;

    // Floor wait so SPA pages hydrate before we read the DOM.
    await callCamofox(
      "POST",
      "/act",
      { userId, targetId: tabId, kind: "wait", timeMs: FLOOR_WAIT_MS },
      ACT_TIMEOUT_MS
    ).catch((err) => {
      log.debug({ err, url: redactUrl(targetUrl) }, "Camoufox floor wait failed, proceeding");
    });

    const probedTitle = await waitForReadiness(userId, tabId, targetUrl);

    if (probedTitle) title = probedTitle;

    const location = await evaluateString(userId, tabId, LOCATION_EXPRESSION, EVALUATE_TIMEOUT_MS).catch(
      () => undefined
    );

    if (location) finalUrl = location;

    const html =
      (await evaluateString(userId, tabId, OUTER_HTML_EXPRESSION, HTML_TIMEOUT_MS)) ?? "";

    if (isBlocked(title, html)) {
      throw new Error(`Camoufox fetch blocked for ${redactUrl(targetUrl)} (title=${JSON.stringify(title)})`);
    }

    if (html.length < MIN_HTML_LENGTH) {
      throw new Error(
        `Camoufox fetch returned empty/too-small HTML for ${redactUrl(targetUrl)} (len=${html.length})`
      );
    }

    log.debug(
      { url: redactUrl(targetUrl), finalUrl: redactUrl(finalUrl), title, len: html.length },
      "Camoufox fetch succeeded"
    );

    return html;
  } catch (error) {
    log.warn({ err: error, url: redactUrl(targetUrl) }, "Camoufox fetch failed");

    return ""; // Fallback will use HTTP
  } finally {
    await closeSession(userId);
  }
}
