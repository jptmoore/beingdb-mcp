/**
 * Runs the real beingdb-mcp entry point (src/index.ts, via tsx -- no build
 * step) on a free 127.0.0.1 port, pointed explicitly at the given BeingDB
 * URL; any BEINGDB_URL in the caller's environment is overridden.
 */
import path from "node:path";

import { PROJECT_ROOT, startLocalProcess } from "../../scripts/local-beingdb.js";
import type { LocalProcess } from "../../scripts/local-beingdb.js";

export function startMcpServer(beingDbUrl: string, logFile: string): Promise<LocalProcess> {
  return startLocalProcess({
    name: "beingdb-mcp server",
    command: process.execPath,
    args: () => ["--import", "tsx", path.join(PROJECT_ROOT, "src", "index.ts")],
    cwd: PROJECT_ROOT,
    env: (port) => ({ ...process.env, BEINGDB_URL: beingDbUrl, HOST: "127.0.0.1", PORT: String(port) }),
    isReady: async (baseUrl) => {
      try {
        return (await fetch(`${baseUrl}/healthz`, { signal: AbortSignal.timeout(1_000) })).ok;
      } catch {
        return false;
      }
    },
    logFile,
    context: { "BeingDB URL": beingDbUrl },
  });
}
