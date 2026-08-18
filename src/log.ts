/**
 * Diagnostic logging. Always writes to stderr, keeping stdout free for
 * process supervisors/container logs to treat as pure application output.
 */

const DEBUG_ENABLED = process.env.BEINGDB_MCP_DEBUG === "1" || process.env.BEINGDB_MCP_DEBUG === "true";

export function isDebugEnabled(): boolean {
  return DEBUG_ENABLED;
}

export function debugLog(message: string, fields?: Record<string, unknown>): void {
  if (!DEBUG_ENABLED) return;
  const suffix = fields ? ` ${JSON.stringify(fields)}` : "";
  process.stderr.write(`[beingdb-mcp] ${message}${suffix}\n`);
}

export function errorLog(message: string, fields?: Record<string, unknown>): void {
  const suffix = fields ? ` ${JSON.stringify(fields)}` : "";
  process.stderr.write(`[beingdb-mcp] ERROR ${message}${suffix}\n`);
}
