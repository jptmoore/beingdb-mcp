/**
 * Streamable HTTP transport: the network-reachable MCP endpoint any MCP
 * client queries `beingdb-mcp` through, locally or remotely. Stateless --
 * a fresh McpServer + transport per request, per the SDK's documented
 * stateless pattern -- since every beingdb-mcp tool call is a
 * self-contained request against BeingDB with no server-side session
 * state to preserve.
 *
 * Unauthenticated by design, matching BeingDB's own HTTP API (no built-in
 * auth; protected by its own query-timeout/result/concurrency limits).
 * Put a reverse proxy in front for TLS or rate limiting if desired.
 */
import { createServer } from "node:http";
import type { IncomingMessage, ServerResponse } from "node:http";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";

import type { BeingDbClient } from "./beingdb-client.js";
import { debugLog, errorLog } from "./log.js";
import { createBeingDbMcpServer } from "./server.js";

function methodNotAllowed(res: ServerResponse): void {
  res.writeHead(405, { "Content-Type": "application/json" }).end(
    JSON.stringify({ jsonrpc: "2.0", error: { code: -32000, message: "Method not allowed." }, id: null })
  );
}

async function handleMcpPost(client: BeingDbClient, req: IncomingMessage, res: ServerResponse): Promise<void> {
  const server = createBeingDbMcpServer(client);
  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
  res.on("close", () => {
    transport.close();
    server.close();
  });
  try {
    await server.connect(transport);
    await transport.handleRequest(req, res);
  } catch (err) {
    errorLog("failed to handle MCP HTTP request", { message: err instanceof Error ? err.message : String(err) });
    if (!res.headersSent) {
      res.writeHead(500, { "Content-Type": "application/json" }).end(
        JSON.stringify({ jsonrpc: "2.0", error: { code: -32603, message: "Internal server error" }, id: null })
      );
    }
  }
}

export function startHttpServer(client: BeingDbClient, port: number, host: string): void {
  const httpServer = createServer((req, res) => {
    const url = new URL(req.url ?? "/", "http://localhost");
    if (url.pathname === "/healthz") {
      res.writeHead(200, { "Content-Type": "text/plain" }).end("OK");
      return;
    }
    if (url.pathname !== "/mcp") {
      res.writeHead(404, { "Content-Type": "application/json" }).end(
        JSON.stringify({ jsonrpc: "2.0", error: { code: -32000, message: "Not found." }, id: null })
      );
      return;
    }
    if (req.method === "POST") {
      void handleMcpPost(client, req, res);
    } else {
      methodNotAllowed(res);
    }
  });

  httpServer.listen(port, host, () => {
    debugLog("MCP Streamable HTTP server listening", { host, port, endpoint: `http://${host}:${port}/mcp` });
    process.stderr.write(`[beingdb-mcp] Streamable HTTP transport listening on http://${host}:${port}/mcp\n`);
  });
}
