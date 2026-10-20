import { defineConfig } from "vitest/config";

// `npm test` runs both suites below. The opt-in deployment smoke test has its
// own config (vitest.remote.config.ts) and is never part of this run.
export default defineConfig({
  test: {
    workspace: "./vitest.suites.ts",
  },
});
