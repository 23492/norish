import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { defineConfig } from "tsdown";

const here = dirname(fileURLToPath(import.meta.url));
const outDir = resolve(here, "../../dist-server");

/**
 * Phase 27 (COOK-01 / W3B, D-27-W3B-09) — THE COOKLANG PARSE CHILD ENTRY.
 *
 * `noExternal: [/^@norish\//]` below INLINES every `@norish/*` module into
 * `dist-server/index.mjs`, including the pool — which since D-27-W3B-15 is no
 * longer an exported subpath and is pulled in through
 * `@norish/shared-server/cooklang/parse`, the only door to it. The
 * pool `fork`s a sibling file, and a sibling reference inside an inlined module
 * is NOT an import — rolldown cannot see it, so without an explicit entry the
 * child would never be emitted.
 *
 * WHY THIS NEEDS A BUILD-TIME ASSERTION AND NOT A RUNTIME ONE (T-27-09). If the
 * chunk is missing, production spawns nothing, every parse resolves `null`, every
 * recipe quietly renders on the legacy path, and NOTHING THROWS — no user reports
 * it and no log screams. A silent, invisible loss of the whole feature. So the
 * build FAILS rather than warns.
 *
 * The entry is NAMED (object form) so the emitted chunk is exactly
 * `parse-worker.mjs`. With the array form, rolldown derives output paths from the
 * common root of all entries, and an entry outside `apps/web` would push
 * `server/index.ts` down to `apps/web/server/index.mjs` and move the server
 * bundle out from under the Dockerfile.
 */
const parseWorkerEntry = resolve(
  here,
  "../../packages/shared-server/src/cooklang/parse-worker.ts"
);

export default defineConfig({
  entry: {
    index: "server/index.ts",
    "parse-worker": parseWorkerEntry,
  },
  hooks: {
    "build:done": () => {
      const emitted = resolve(outDir, "parse-worker.mjs");

      if (!existsSync(emitted)) {
        throw new Error(
          `Phase 27 (D-27-W3B-09): ${emitted} was NOT emitted. The Cooklang parse ` +
            `pool forks that file; without it every parse silently resolves null and ` +
            `every recipe renders on the legacy path with no error. Failing the build ` +
            `rather than shipping an invisible regression.`
        );
      }
    },
  },
  format: ["esm"],
  outDir: "../../dist-server",
  tsconfig: "./tsconfig.server.json",
  clean: true,
  treeshake: true,
  // Don't minify: i18n translation strings contain special chars that break the minifier
  minify: false,
  platform: "node",
  // Bundle workspace packages (@norish/*) — they export raw .ts files that
  // Node.js cannot load at runtime. All other npm packages remain external
  // and are resolved from node_modules at runtime.
  noExternal: [/^@norish\//],
  // Suppress warning for deps that are intentionally inlined from @norish/* packages.
  // Some lightweight transitive deps get pulled in — this is fine and expected.
  inlineOnly: false,
  external: [
    // --- Native / binary modules ---
    "pg",
    "pg-pool",
    "pg-types",
    "sharp",
    "heic-convert",
    "libheif-js",
    "yt-dlp-wrap",
    "ffmpeg-static",
    // Phase 27 (COOK-01): ships a `.wasm` binary. It is reachable from the server
    // entry via `@norish/shared-server/cooklang/*` (which is `noExternal`, so its
    // own deps would otherwise be pulled in), and rolldown cannot inline a
    // `.wasm` — it fails with "stream did not contain valid UTF-8". Node 22 loads
    // it natively from node_modules at runtime, with no flag.
    "@cooklang/cooklang",
    "bullmq",
    "ioredis",
    // --- Frameworks ---
    "next",
    "next-intl",
    "react",
    "react-dom",
    "server-only",
    "hono",
    "@hono/node-server",
    // --- ORM / DB ---
    "drizzle-orm",
    "drizzle-zod",
    "kysely",
    // --- Auth ---
    "better-auth",
    "@better-auth/api-key",
    "@better-auth/core",
    "@better-auth/utils",
    "@better-auth/expo",
    "better-call",
    "jose",
    "cookie",
    // --- AI ---
    "openai",
    "ai",
    "@ai-sdk/openai",
    "@ai-sdk/anthropic",
    "@ai-sdk/azure",
    "@ai-sdk/deepseek",
    "@ai-sdk/google",
    "@ai-sdk/groq",
    "@ai-sdk/mistral",
    "@ai-sdk/openai-compatible",
    "@ai-sdk/perplexity",
    "@ai-sdk/provider",
    "@ai-sdk/provider-utils",
    "ollama-ai-provider-v2",
    // --- Logging ---
    "pino",
    "pino-pretty",
    // --- Utilities ---
    "zod",
    "date-fns",
    "superjson",
    "dotenv",
    "fuse.js",
    "cheerio",
    "tsdav",
    "ws",
    "mime",
    "nanostores",
    "ua-parser-js",
    "uuid",
    "jszip",
    "numeric-quantity",
    "parse-ingredient",
    "html-entities",
    "jsonrepair",
  ],
});
