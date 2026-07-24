// SPIKE — Phase 27 (COOK-01). Scrape step, mirroring norish's real fetch path:
// Camoufox REST first (packages/api/src/camofox.ts), plain HTTP fetch as fallback.
//
// In THIS environment the Camoufox service host (`camofox:9377`, the docker-internal
// default) is not resolvable, so the harness records that and falls back to a plain
// fetch — exactly the documented fallback norish itself uses when Camoufox returns
// empty. The sanitizer replicates `extractSanitizedBody` from
// `packages/shared-server/src/ai/helpers.ts` so the model sees the same shape of text.

import * as cheerio from "cheerio";

const DEFAULT_CAMOFOX_URL = process.env.CAMOFOX_URL ?? "http://camofox:9377";
const UA =
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36";

export interface ScrapeResult {
  html: string;
  via: "camofox" | "http-fallback";
  camofoxReachable: boolean;
  camofoxNote: string;
}

async function tryCamofox(url: string): Promise<{ html: string; reachable: boolean; note: string }> {
  const base = DEFAULT_CAMOFOX_URL.replace(/\/$/, "");
  try {
    const open = await fetch(`${base}/tabs/open`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ userId: `harness-${Date.now()}`, url }),
      signal: AbortSignal.timeout(6000),
    });
    if (!open.ok) return { html: "", reachable: true, note: `camofox /tabs/open -> ${open.status}` };
    // Full readiness/evaluate dance omitted for the spike; if the service is up we
    // still fall through to HTTP unless it returns usable HTML directly.
    const data: any = await open.json().catch(() => ({}));
    const html = typeof data.html === "string" ? data.html : "";
    return { html, reachable: true, note: "camofox reachable" };
  } catch (err: any) {
    const code = err?.cause?.code ?? err?.code ?? "";
    return {
      html: "",
      reachable: false,
      note: `camofox unreachable (${code || String(err).slice(0, 60)})`,
    };
  }
}

async function httpFetch(url: string): Promise<string> {
  const res = await fetch(url, {
    headers: { "User-Agent": UA, Accept: "text/html,application/xhtml+xml" },
    signal: AbortSignal.timeout(20000),
    redirect: "follow",
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} fetching ${url}`);
  return res.text();
}

export async function scrape(url: string): Promise<ScrapeResult> {
  const camo = await tryCamofox(url);
  if (camo.html && camo.html.length > 500) {
    return { html: camo.html, via: "camofox", camofoxReachable: true, camofoxNote: camo.note };
  }
  const html = await httpFetch(url);
  return {
    html,
    via: "http-fallback",
    camofoxReachable: camo.reachable,
    camofoxNote: camo.note,
  };
}

/** Replica of shared-server `extractSanitizedBody`. */
export function extractSanitizedBody(html: string): string {
  const hasHtmlTags = /<[a-z][\s\S]*>/i.test(html);
  if (!hasHtmlTags) return html.replace(/\s+/g, " ").trim();

  try {
    const $ = cheerio.load(html);
    const $body = $("body");
    if (!$body.length) return html.replace(/\s+/g, " ").trim();

    $body
      .find(
        "script,style,noscript,svg,iframe,canvas,link,meta,header,footer,nav,aside,form,button,input,textarea"
      )
      .remove();

    const blocks: string[] = [];
    const seen = new Set<string>();
    const push = (text?: string) => {
      if (!text) return;
      const t = text.replace(/\s+/g, " ").trim();
      if (t.length < 2 || seen.has(t)) return;
      seen.add(t);
      blocks.push(t);
    };

    const $root = $body.find("main").first().length
      ? $body.find("main").first()
      : $body.find("article").first().length
        ? $body.find("article").first()
        : $body;

    const title =
      $root.find('h1[itemprop="name"]').first().text().trim() || $root.find("h1").first().text().trim();
    if (title) push(title);

    $root.find("h2,h3,h4,h5,h6,p,li,dt,dd,figcaption").each((_, el) => push($(el).text()));
    return blocks.join("\n");
  } catch {
    return "";
  }
}
