import { defineConfig } from "vitest/config";

// Opt-in deployment smoke test: `BEINGDB_MCP_REMOTE_URL=https://<host>/mcp npm run test:remote`.
export default defineConfig({
  test: {
    include: ["test/remote/**/*.test.ts"],
    testTimeout: 30_000,
  },
});
