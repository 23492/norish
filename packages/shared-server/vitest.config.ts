import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    globals: true,
    include: ["**/*.{test,spec}.{ts,tsx}"],
    // Phase 27 (W3B): the Cooklang suites spawn child processes, deliberately wait
    // out a 1 000 ms resource bound, and run ~290 sequential pooled round trips in
    // two nested-loop fidelity sweeps. The 5 s default is too tight for that, and a
    // test that dies on the harness timeout proves nothing about the bound — the
    // bound assertions measure elapsed wall-clock time EXPLICITLY instead.
    testTimeout: 30_000,
    hookTimeout: 30_000,
    env: {
      NODE_ENV: "development",
      DATABASE_URL: "postgresql://test:test@localhost:5432/test",
      SKIP_ENV_VALIDATION: "1",
      MASTER_KEY: "QmFzZTY0RW5jb2RlZE1hc3RlcktleU1pbjMyQ2hhcnM=",
    },
  },
});
