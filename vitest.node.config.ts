import { defineConfig } from "vitest/config";

// Vitest configuration for Node-runtime unit tests that target the legacy
// `src/api`, `src/tools`, and `src/utils` modules. The Cloudflare Worker pool
// cannot host these tests because they rely on Node-only behaviour (fake
// timers, AbortController semantics, mock fetch injection for modules that call
// the global `fetch` directly).
//
// Worker-runtime tests live under `test/*.test.ts` and keep using
// `vitest.config.ts`. Do not move them here.
export default defineConfig({
  test: {
    environment: "node",
    include: ["test/node/**/*.test.ts"],
  },
});
