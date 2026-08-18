#!/usr/bin/env node
/**
 * Entry point: wires up a BeingDbClient + MCP server over the Streamable
 * HTTP transport. All diagnostics go to stderr (see src/log.ts).
 */
import { BeingDbClient } from "./beingdb-client.js";
import { startHttpServer } from "./http-server.js";
import { debugLog, errorLog, isDebugEnabled } from "./log.js";

function main(): void {
  const baseUrl = process.env.BEINGDB_URL ?? "http://localhost:8080";
  const client = new BeingDbClient({ baseUrl });
  const port = Number(process.env.PORT ?? "3000");
  const host = process.env.HOST ?? "0.0.0.0";

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


