import { defineWorkspace } from "vitest/config";

export default defineWorkspace([
  {
    test: {
      name: "unit",
      include: ["test/unit/**/*.test.ts"],
    },
  },
  {
    test: {
      // Real local BeingDB (built from ../beingdb, BEINGDB_REPO or BEINGDB_BIN_DIR)
      // started once by the global setup; see scripts/local-beingdb.ts.
      name: "integration",
      include: ["test/integration/**/*.test.ts"],
      globalSetup: ["test/integration/global-setup.ts"],
      testTimeout: 30_000,
      hookTimeout: 60_000,
    },
  },
]);
