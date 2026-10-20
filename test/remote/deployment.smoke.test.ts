/**
 * Deployment smoke test -- not a correctness test. Checks that a deployed
 * beingdb-mcp endpoint (and the BeingDB behind it) is up and exposes the
 * current tool surface. Dataset-agnostic: it only uses predicates it
 * discovers. Runs only via `npm run test:remote` with an explicit URL;
 * never part of `npm test`.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

const remoteUrl = process.env.BEINGDB_MCP_REMOTE_URL;
if (!remoteUrl) {
  throw new Error("Set BEINGDB_MCP_REMOTE_URL to the deployed MCP endpoint, e.g. BEINGDB_MCP_REMOTE_URL=https://<host>/mcp npm run test:remote");
}

type Predicate = { name: string; arity: number };

describe(`deployed beingdb-mcp at ${remoteUrl}`, () => {
  let client: Client;

  beforeAll(async () => {
    client = new Client({ name: "remote-smoke-test", version: "0.0.0" });
    try {
      await client.connect(new StreamableHTTPClientTransport(new URL(remoteUrl)));
    } catch (err) {
      throw new Error(`Could not connect to the deployed MCP endpoint ${remoteUrl}: ${err instanceof Error ? err.message : String(err)}`);
    }
  });

  afterAll(async () => {
    await client?.close();
  });

  it("exposes the current tool surface", async () => {
    const names = (await client.listTools()).tools.map((t) => t.name).sort();
    expect(names).toEqual([
      "beingdb_diagnose_query",
      "beingdb_explain_query",
      "beingdb_get_facts",
      "beingdb_list_predicates",
      "beingdb_query",
      "beingdb_status",
      "beingdb_validate_query",
    ]);
  });

  it("reaches its BeingDB", async () => {
    const result = await client.callTool({ name: "beingdb_status", arguments: {} });
    expect(result.structuredContent).toMatchObject({ reachable: true });
  });

  it("introspects, diagnoses and executes a query over a discovered predicate", async () => {
    const schema = await client.callTool({ name: "beingdb_list_predicates", arguments: { detailed: true } });
    const body = schema.structuredContent as { predicates: Predicate[]; environmentFingerprint?: string };
    expect(body.predicates.length).toBeGreaterThan(0);
    expect(body.environmentFingerprint).toMatch(/^sha256:/);

    const predicate = body.predicates[0]!;
    const vars = Array.from({ length: predicate.arity }, (_, i) => `A${i}`);
    const query = `find ${vars.join(", ")}\nwhere\n  ${predicate.name}(${vars.join(", ")})\nlimit 1`;

    const diagnosis = await client.callTool({ name: "beingdb_diagnose_query", arguments: { query } });
    expect(diagnosis.isError).toBeFalsy();
    expect(diagnosis.structuredContent).toMatchObject({ valid: true, provablyEmpty: false });

    const execution = await client.callTool({ name: "beingdb_query", arguments: { query } });
    expect(execution.isError).toBeFalsy();
    expect((execution.structuredContent as { results: unknown[] }).results).toHaveLength(1);
  });
});
