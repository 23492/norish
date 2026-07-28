#!/usr/bin/env node
// tooling/import-gate/run-import-gate.mjs
//
// The 27.1-05 post-deploy empirical import gate harness.
//
// Dependency-free (node: builtins only — global fetch, node:fs, node:process,
// node:assert/strict for --self-test). Drives real imports over the authenticated
// REST surface `POST /api/v1/recipes/import/url`, polls `GET /api/v1/recipes/{id}`,
// optionally joins a `docker logs norish-app` capture to recover which parser path
// was taken, and emits a JSON array + a markdown table. Exits non-zero unless every
// bar passes. See tooling/import-gate/README.md for the full operator runbook.
//
// Never logs or writes GATE_API_KEY. If a value that looks like the key would ever
// land in an error body, it is redacted before being written anywhere.

import { readFileSync, writeFileSync } from "node:fs";
import assert from "node:assert/strict";

// ---------------------------------------------------------------------------
// Pure helpers (exercised directly by --self-test)
// ---------------------------------------------------------------------------

/**
 * Parse a URL-list file: one URL per line, blank lines and `#`-only lines
 * ignored, an optional trailing ` # <category>` comment parsed out.
 */
export function parseUrlFile(text) {
  const out = [];

  for (const rawLine of text.split("\n")) {
    const line = rawLine.trim();

    if (line === "" || line.startsWith("#")) continue;

    const hashIdx = line.indexOf("#");
    let url = line;
    let category = "uncategorized";

    if (hashIdx !== -1) {
      url = line.slice(0, hashIdx).trim();
      category = line.slice(hashIdx + 1).trim() || "uncategorized";
    }

    if (url === "") continue;

    out.push({ url, category });
  }

  return out;
}

/**
 * Redact an API key (or anything key-shaped) out of a string before it is ever
 * written to stdout, stderr, or an output file.
 */
export function redactApiKey(text, apiKey) {
  if (!apiKey) return text;
  const escaped = apiKey.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

  return text.replace(new RegExp(escaped, "g"), "[REDACTED_GATE_API_KEY]");
}

/**
 * Join a captured `docker logs norish-app` text blob against a URL to recover
 * the 27.1-02 parserPath markers. Matches ONLY the terminal marker message
 * ("Recipe import: parse path taken") — the fallback module's own outcome log
 * carries the same parserPath field but a different message and must not be
 * double-counted (27.1-02-SUMMARY.md, Issues Encountered).
 *
 * Returns `{ parserPath, usedAI, cookMinted, jsonLdNodeCount }` or null if no
 * terminal marker line for this URL is found in the capture.
 */
export function joinLogForUrl(logText, url) {
  if (!logText) return null;

  const lines = logText.split("\n");
  let match = null;

  for (const line of lines) {
    if (!line.includes("Recipe import: parse path taken")) continue;
    if (!line.includes(url)) continue;

    let parsed;

    try {
      parsed = JSON.parse(line);
    } catch {
      continue;
    }

    if (parsed.msg !== "Recipe import: parse path taken") continue;
    if (parsed.url !== url) continue;

    // Last matching terminal marker wins — a retried/re-queued URL may log
    // more than once across a capture window; the most recent is the one
    // whose outcome the poll actually observed.
    match = parsed;
  }

  if (!match) return null;

  return {
    parserPath: match.parserPath ?? "unknown",
    usedAI: typeof match.usedAI === "boolean" ? match.usedAI : "unknown",
    cookMinted: typeof match.cookMinted === "boolean" ? match.cookMinted : "unknown",
    jsonLdNodeCount: typeof match.jsonLdNodeCount === "number" ? match.jsonLdNodeCount : "unknown",
  };
}

/**
 * Count recipeIngredients (and steps) by systemUsed, from a FullRecipeSchema body.
 */
export function countBySystem(rows) {
  let metric = 0;
  let us = 0;

  for (const row of rows ?? []) {
    if (row.systemUsed === "metric") metric += 1;
    else if (row.systemUsed === "us") us += 1;
  }

  return { metric, us };
}

/**
 * Evaluate the three bar conditions against a list of row outcomes.
 * EXIT 0 only when ok >= minUrls AND distinct categories among ok rows >= minCategories
 * AND no row is queue-error or timeout.
 */
export function evaluateBars(rows, minUrls, minCategories) {
  const okRows = rows.filter((r) => r.outcome === "ok");
  const conflictRows = rows.filter((r) => r.outcome === "conflict");
  const badRows = rows.filter((r) => r.outcome === "queue-error" || r.outcome === "timeout");
  const distinctCategories = new Set(okRows.map((r) => r.category));

  const pass =
    okRows.length >= minUrls && distinctCategories.size >= minCategories && badRows.length === 0;

  return {
    pass,
    okCount: okRows.length,
    conflictCount: conflictRows.length,
    badRows,
    distinctCategoryCount: distinctCategories.size,
    distinctCategories: [...distinctCategories].sort(),
  };
}

function mdEscape(value) {
  return String(value).replace(/\|/g, "\\|").replace(/\n/g, " ");
}

export function toMarkdownTable(rows) {
  const header =
    "| url | category | outcome | fetch OK | JSON-LD | path | metric ing | us ing | cook_source | confidence | review | failure (verbatim) |";
  const sep = "|---|---|---|---|---|---|---|---|---|---|---|---|";
  const body = rows
    .map(
      (r) =>
        `| ${mdEscape(r.url)} | ${mdEscape(r.category)} | ${mdEscape(r.outcome)} | ${mdEscape(
          r.fetchOk
        )} | ${mdEscape(r.jsonLdNodeCount)} | ${mdEscape(r.parserPath)} | ${mdEscape(
          r.metricIngredients
        )} | ${mdEscape(r.usIngredients)} | ${mdEscape(r.cookSourceDerived)} | ${mdEscape(
          r.cookConfidence
        )} | ${mdEscape(r.cookReviewNeeded)} | ${mdEscape(r.failure)} |`
    )
    .join("\n");

  return [header, sep, body].join("\n");
}

// ---------------------------------------------------------------------------
// Runtime (not exercised by --self-test — needs a live server)
// ---------------------------------------------------------------------------

async function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function postImport(baseUrl, apiKey, url) {
  const res = await fetch(`${baseUrl}/api/v1/recipes/import/url`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": apiKey,
    },
    body: JSON.stringify({ url }),
  });

  const bodyText = await res.text().catch(() => "");

  return { status: res.status, bodyText };
}

async function pollRecipe(baseUrl, apiKey, recipeId, timeoutMs, intervalMs) {
  const deadline = Date.now() + timeoutMs;

  for (;;) {
    const res = await fetch(`${baseUrl}/api/v1/recipes/${recipeId}`, {
      headers: { "x-api-key": apiKey },
    });

    if (res.status === 200) {
      const body = await res.json();

      return { outcome: "ok", body };
    }

    if (res.status !== 404) {
      const bodyText = await res.text().catch(() => "");

      return { outcome: "queue-error", status: res.status, bodyText };
    }

    if (Date.now() >= deadline) {
      return { outcome: "timeout" };
    }

    await sleep(intervalMs);
  }
}

async function runUrl(baseUrl, apiKey, entry, logFile, timeoutMs, intervalMs) {
  const { url, category } = entry;
  const row = {
    url,
    category,
    outcome: "unknown",
    fetchOk: "unknown",
    jsonLdNodeCount: "unknown",
    parserPath: "unknown",
    usedAI: "unknown",
    cookMinted: "unknown",
    metricIngredients: "unknown",
    usIngredients: "unknown",
    cookSourceDerived: "unknown",
    cookConfidence: "unknown",
    cookReviewNeeded: "unknown",
    failure: "",
  };

  const queueResult = await postImport(baseUrl, apiKey, url);

  if (queueResult.status === 409) {
    row.outcome = "conflict";
    row.failure =
      "409 CONFLICT — recipe already exists or already queued in the target cookbook; proves nothing";

    return row;
  }

  if (queueResult.status < 200 || queueResult.status >= 300) {
    row.outcome = "queue-error";
    row.failure = `HTTP ${queueResult.status}: ${queueResult.bodyText}`;

    return row;
  }

  row.fetchOk = true;

  let recipeId;

  try {
    recipeId = JSON.parse(queueResult.bodyText);
  } catch {
    recipeId = queueResult.bodyText.replace(/^"|"$/g, "");
  }

  const pollResult = await pollRecipe(baseUrl, apiKey, recipeId, timeoutMs, intervalMs);

  if (pollResult.outcome === "timeout") {
    row.outcome = "timeout";
    row.failure = `timeout after ${timeoutMs}ms — no row ever appeared for recipeId ${recipeId} (the "eternal skeleton" symptom)`;

    return row;
  }

  if (pollResult.outcome === "queue-error") {
    row.outcome = "queue-error";
    row.failure = `HTTP ${pollResult.status} on GET /api/v1/recipes/${recipeId}: ${pollResult.bodyText}`;

    return row;
  }

  const body = pollResult.body;
  const ingredientCounts = countBySystem(body.recipeIngredients);

  row.outcome = "ok";
  row.metricIngredients = ingredientCounts.metric;
  row.usIngredients = ingredientCounts.us;
  row.cookSourceDerived = body.cookSource !== null && body.cookSource !== undefined;
  row.cookConfidence = body.cookConfidence ?? "null";
  row.cookReviewNeeded = body.cookReviewNeeded ?? "unknown";

  // Re-read GATE_LOG_FILE FRESH here, not once at process start (main() reads the
  // urls file once but must NOT cache the log — the log capture is still growing
  // while this loop runs, and a one-time read at startup would join against a
  // near-empty file for every URL after the first).
  const logText = logFile ? readFileSync(logFile, "utf8") : null;
  const logJoin = joinLogForUrl(logText, url);

  if (logJoin) {
    row.parserPath = logJoin.parserPath;
    row.usedAI = logJoin.usedAI;
    row.cookMinted = logJoin.cookMinted;
    row.jsonLdNodeCount = logJoin.jsonLdNodeCount;
  }

  return row;
}

async function main() {
  const baseUrl = process.env.GATE_BASE_URL;
  const apiKey = process.env.GATE_API_KEY;
  const urlsFile = process.env.GATE_URLS_FILE;
  const outJson = process.env.GATE_OUT_JSON;
  const outMd = process.env.GATE_OUT_MD;
  const logFile = process.env.GATE_LOG_FILE;
  const pollTimeoutMs = Number(process.env.GATE_POLL_TIMEOUT_MS ?? 180000);
  const pollIntervalMs = Number(process.env.GATE_POLL_INTERVAL_MS ?? 3000);
  const minCategories = Number(process.env.GATE_MIN_CATEGORIES ?? 6);
  const minUrls = Number(process.env.GATE_MIN_URLS ?? 0);

  if (!baseUrl || !apiKey || !urlsFile) {
    console.error("GATE_BASE_URL, GATE_API_KEY and GATE_URLS_FILE are required");
    process.exitCode = 1;

    return;
  }

  const entries = parseUrlFile(readFileSync(urlsFile, "utf8"));

  const rows = [];

  for (const entry of entries) {
    console.log(`[gate] importing ${entry.url} (${entry.category})`);
    // eslint-disable-next-line no-await-in-loop -- sequential by design (T-27.1-05-05)
    const row = await runUrl(baseUrl, apiKey, entry, logFile, pollTimeoutMs, pollIntervalMs);

    console.log(`[gate]   -> ${row.outcome}`);
    rows.push(row);
  }

  const evaluation = evaluateBars(rows, minUrls, minCategories);

  if (outJson) {
    writeFileSync(outJson, redactApiKey(JSON.stringify(rows, null, 2), apiKey));
  }

  if (outMd) {
    writeFileSync(outMd, redactApiKey(toMarkdownTable(rows), apiKey));
  }

  console.log("");
  console.log("=== Gate summary ===");
  console.log(`ok: ${evaluation.okCount}`);
  console.log(`conflict (neither pass nor fail): ${evaluation.conflictCount}`);
  console.log(
    `queue-error/timeout: ${evaluation.badRows.length}` +
      (evaluation.badRows.length
        ? " -> " + evaluation.badRows.map((r) => `${r.url}=${r.outcome}`).join(", ")
        : "")
  );
  console.log(
    `distinct categories among ok rows: ${evaluation.distinctCategoryCount} (${evaluation.distinctCategories.join(", ")})`
  );
  console.log(`required: ok >= ${minUrls}, categories >= ${minCategories}, no bad rows`);

  if (!evaluation.pass) {
    console.error(`GATE FAILED: ${redactApiKey(JSON.stringify(evaluation), apiKey)}`);
    process.exitCode = 1;
  } else {
    console.log("GATE PASSED");
    process.exitCode = 0;
  }
}

// ---------------------------------------------------------------------------
// --self-test
// ---------------------------------------------------------------------------

function selfTest() {
  let count = 0;
  const check = (fn) => {
    fn();
    count += 1;
  };

  // parseUrlFile
  check(() => {
    const parsed = parseUrlFile(
      [
        "# a comment line",
        "",
        "https://example.com/a # salade",
        "https://example.com/b   #   soep  ",
        "https://example.com/c",
        "   ",
        "# another comment",
        "https://example.com/d#pasta",
      ].join("\n")
    );

    assert.equal(parsed.length, 4);
    assert.deepEqual(parsed[0], { url: "https://example.com/a", category: "salade" });
    assert.deepEqual(parsed[1], { url: "https://example.com/b", category: "soep" });
    assert.deepEqual(parsed[2], { url: "https://example.com/c", category: "uncategorized" });
    assert.deepEqual(parsed[3], { url: "https://example.com/d", category: "pasta" });
  });

  // redactApiKey
  check(() => {
    const text = "error body contained secretkey123 in it";
    const redacted = redactApiKey(text, "secretkey123");

    assert.ok(!redacted.includes("secretkey123"));
    assert.ok(redacted.includes("[REDACTED_GATE_API_KEY]"));
    assert.equal(redactApiKey("nothing sensitive here", ""), "nothing sensitive here");
  });

  // joinLogForUrl — matches only the terminal marker message, not the fallback's
  // own outcome log which carries the same parserPath field (27.1-02-SUMMARY.md)
  check(() => {
    const log = [
      JSON.stringify({
        level: 30,
        msg: "AI extraction failed; attempting the JSON-LD fallback",
        url: "https://example.com/r1",
        parserPath: "jsonld-fallback",
      }),
      JSON.stringify({
        level: 30,
        msg: "Recipe import: parse path taken",
        url: "https://example.com/r1",
        parserPath: "jsonld-fallback",
        usedAI: false,
        cookMinted: true,
        jsonLdNodeCount: 2,
      }),
      JSON.stringify({
        level: 30,
        msg: "Recipe import: parse path taken",
        url: "https://example.com/r2",
        parserPath: "ai",
        usedAI: true,
        cookMinted: true,
        jsonLdNodeCount: 1,
      }),
      "not even json",
    ].join("\n");

    const r1 = joinLogForUrl(log, "https://example.com/r1");

    assert.deepEqual(r1, {
      parserPath: "jsonld-fallback",
      usedAI: false,
      cookMinted: true,
      jsonLdNodeCount: 2,
    });

    const r2 = joinLogForUrl(log, "https://example.com/r2");

    assert.equal(r2.parserPath, "ai");

    const r3 = joinLogForUrl(log, "https://example.com/nonexistent");

    assert.equal(r3, null);

    assert.equal(joinLogForUrl(null, "https://example.com/r1"), null);
  });

  // joinLogForUrl — last matching terminal marker wins on a re-queued URL
  check(() => {
    const log = [
      JSON.stringify({
        msg: "Recipe import: parse path taken",
        url: "https://example.com/retry",
        parserPath: "structured",
        usedAI: false,
        cookMinted: false,
        jsonLdNodeCount: 0,
      }),
      JSON.stringify({
        msg: "Recipe import: parse path taken",
        url: "https://example.com/retry",
        parserPath: "ai",
        usedAI: true,
        cookMinted: true,
        jsonLdNodeCount: 0,
      }),
    ].join("\n");

    const result = joinLogForUrl(log, "https://example.com/retry");

    assert.equal(result.parserPath, "ai");
  });

  // countBySystem
  check(() => {
    const counts = countBySystem([
      { systemUsed: "metric" },
      { systemUsed: "metric" },
      { systemUsed: "us" },
      { systemUsed: undefined },
    ]);

    assert.deepEqual(counts, { metric: 2, us: 1 });
    assert.deepEqual(countBySystem(undefined), { metric: 0, us: 0 });
    assert.deepEqual(countBySystem([]), { metric: 0, us: 0 });
  });

  // evaluateBars
  check(() => {
    const rows = [
      { outcome: "ok", category: "salade" },
      { outcome: "ok", category: "soep" },
      { outcome: "conflict", category: "pasta" },
    ];
    const result = evaluateBars(rows, 2, 2);

    assert.equal(result.pass, true);
    assert.equal(result.okCount, 2);
    assert.equal(result.conflictCount, 1);
    assert.equal(result.distinctCategoryCount, 2);
  });

  check(() => {
    // A queue-error or timeout row fails the bar regardless of counts.
    const rows = [
      { outcome: "ok", category: "salade" },
      { outcome: "ok", category: "soep" },
      { outcome: "timeout", category: "vis" },
    ];
    const result = evaluateBars(rows, 2, 2);

    assert.equal(result.pass, false);
    assert.equal(result.badRows.length, 1);
  });

  check(() => {
    // Not enough distinct categories among ok rows fails the bar even with enough ok count.
    const rows = [
      { outcome: "ok", category: "salade" },
      { outcome: "ok", category: "salade" },
      { outcome: "ok", category: "salade" },
    ];
    const result = evaluateBars(rows, 3, 2);

    assert.equal(result.pass, false);
    assert.equal(result.distinctCategoryCount, 1);
  });

  // toMarkdownTable
  check(() => {
    const md = toMarkdownTable([
      {
        url: "https://example.com/a|pipe",
        category: "salade",
        outcome: "ok",
        fetchOk: true,
        jsonLdNodeCount: 1,
        parserPath: "ai",
        metricIngredients: 5,
        usIngredients: 5,
        cookSourceDerived: true,
        cookConfidence: 0.9,
        cookReviewNeeded: false,
        failure: "",
      },
    ]);

    assert.ok(md.includes("| url | category | outcome"));
    assert.ok(md.includes("\\|pipe"));
  });

  console.log(`self-test: ${count} assertion groups passed`);

  return count;
}

if (process.argv.includes("--self-test")) {
  try {
    const count = selfTest();

    process.exitCode = count > 0 ? 0 : 1;
  } catch (err) {
    console.error("SELF-TEST FAILED", err);
    process.exitCode = 1;
  }
} else if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}
