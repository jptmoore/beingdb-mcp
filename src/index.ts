#!/usr/bin/env node
/**
 * Entry point: wires up a BeingDbClient + MCP server over the Streamable
 * HTTP transport. All diagnostics go to stderr (see src/log.ts).
 *
 * BEINGDB_URL selects the BeingDB instance (local or remote). It defaults
 * to the local development server started by `npm run beingdb:local`;
 * there is no fallback to any other endpoint.
 */
import { BeingDbClient } from "./beingdb-client.js";
import { startHttpServer } from "./http-server.js";
import { debugLog, errorLog, isDebugEnabled } from "./log.js";

const DEFAULT_BEINGDB_URL = "http://127.0.0.1:8080";

function main(): void {
  const baseUrl = process.env.BEINGDB_URL || DEFAULT_BEINGDB_URL;
  const client = new BeingDbClient({ baseUrl });
  const port = Number(process.env.PORT ?? "3000");
  const host = process.env.HOST ?? "0.0.0.0";

  process.stderr.write(`[beingdb-mcp] using BeingDB at ${baseUrl}${process.env.BEINGDB_URL ? "" : " (default; set BEINGDB_URL to change)"}\n`);
  if (isDebugEnabled()) {
    debugLog("starting beingdb-mcp", { beingDbUrl: baseUrl, port, host });
  }

  startHttpServer(client, port, host);
}

try {
  main();
} catch (err) {
  errorLog("fatal error starting beingdb-mcp", { message: err instanceof Error ? err.message : String(err) });
  process.exit(1);
}


