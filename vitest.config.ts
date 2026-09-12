import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["test/**/*.spec.ts"],
    exclude: ["stack/**", "node_modules/**"],
    testTimeout: 15_000,
    // Tests that need the real assembled stack (Postgres + RBA + Principal-Graph
    // + ADC mint via docker compose) are gated behind RANGE_LIVE_STACK=1 — see
    // test/README.md. Plain `npm test` runs only the harness's own unit tests
    // (schema validation, scoring, taxonomy loading) with no external services.
  },
});
