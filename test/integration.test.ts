/**
 * Integration test: spawns the real built `beingdb-mcp` server (Streamable
 * HTTP transport) and drives it with an MCP `Client`, talking to a real,
 * locally running BeingDB instance over HTTP.
 *
 * Skipped unless `BEINGDB_INTEGRATION_URL` is set, since it requires:
 *   1. `npm run build` (dist/index.js must exist)
 *   2. A real BeingDB instance serving the `fixtures/demo-facts` data,
 *      e.g.:
 *        ./scripts/setup-local-beingdb.sh
 *        ~/git/beingdb/_build/default/bin/serve.exe --pack ./.local/pack_store --port 8080
 *
 * Run with: BEINGDB_INTEGRATION_URL=http://localhost:8080 npm run test:integration
 */
import { spawn } from "node:child_process";
import type { ChildProcess } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

const beingDbUrl = process.env.BEINGDB_INTEGRATION_URL;
const describeIfConfigured = beingDbUrl ? describe : describe.skip;

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const distEntry = path.resolve(__dirname, "..", "dist", "index.js");
const mcpPort = 3987;
const mcpUrl = `http://127.0.0.1:${mcpPort}/mcp`;

function parseToolJson(result: { content: Array<{ type: string; text?: string }> }): Record<string, unknown> {
  const first = result.content[0];
  if (!first || first.type !== "text" || typeof first.text !== "string") {
    throw new Error("Expected a single text content block");
  }
  return JSON.parse(first.text);
}

async function waitForHealthy(url: string, attempts = 30): Promise<void> {
  for (let i = 0; i < attempts; i++) {
    try {
      const res = await fetch(url);
      if (res.ok) return;
    } catch {
      // not up yet
    }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new Error(`beingdb-mcp did not become healthy at ${url} in time`);
}

describeIfConfigured("beingdb-mcp integration (real BeingDB instance)", () => {
  let client: Client;
  let serverProcess: ChildProcess;

  beforeAll(async () => {
    if (!existsSync(distEntry)) {
      throw new Error(`${distEntry} not found -- run "npm run build" before the integration test.`);
    }
    serverProcess = spawn(process.execPath, [distEntry], {
      env: { ...process.env, BEINGDB_URL: beingDbUrl!, PORT: String(mcpPort) },
      stdio: ["ignore", "pipe", "pipe"],
    });
    await waitForHealthy(`http://127.0.0.1:${mcpPort}/healthz`);

    client = new Client({ name: "integration-test-client", version: "0.0.0" });
    await client.connect(new StreamableHTTPClientTransport(new URL(mcpUrl)));
  });

  afterAll(async () => {
    await client.close();
    serverProcess.kill();
  });

  it("reports a reachable status with version and environment fingerprint", async () => {
    const result = await client.callTool({ name: "beingdb_status", arguments: {} });
    expect(result.isError).toBeFalsy();
    const body = parseToolJson(result as never);
    expect(body.reachable).toBe(true);
    expect(typeof body.version).toBe("string");
    expect(typeof body.environmentFingerprint).toBe("string");
    expect(body.predicateCount).toBeGreaterThanOrEqual(5);
  });

  it("discovers the demo-facts predicates", async () => {
    const result = await client.callTool({
      name: "beingdb_list_predicates",
      arguments: { detailed: true, names: ["created", "work_shown_in", "studied_at", "funded_by", "artist"] },
    });
    expect(result.isError).toBeFalsy();
    const body = parseToolJson(result as never) as { predicates: Array<{ name: string; arity: number }> };
    const names = body.predicates.map((p) => p.name).sort();
    expect(names).toEqual(["artist", "created", "funded_by", "studied_at", "work_shown_in"]);
  });

  it("validates then executes a non-trivial DSL join across the demo-facts fixture, preserving the exact query", async () => {
    const dslQuery = [
      "find Artist, Work, Exhibition, Institution, Funder",
      "where",
      "  artist(Artist)",
      "  created(Artist, Work)",
      "  work_shown_in(Work, Exhibition)",
      "  optional",
      "    studied_at(Artist, Institution)",
      "  funded_by(Artist, Funder)",
      "order by Artist ascending",
      "limit 10",
    ].join("\n");

    const validation = await client.callTool({ name: "beingdb_validate_query", arguments: { query: dslQuery } });
    expect(validation.isError).toBeFalsy();
    const validationBody = parseToolJson(validation as never);
    expect(validationBody.query).toBe(dslQuery);
    expect(validationBody.valid).toBe(true);

    const execution = await client.callTool({ name: "beingdb_query", arguments: { query: dslQuery } });
    expect(execution.isError).toBeFalsy();
    const body = parseToolJson(execution as never) as {
      query: string;
      language: string;
      languageVersion: string;
      environmentFingerprint: string;
      variables: string[];
      results: Array<Record<string, { type: string; value: string } | null>>;
    };

    expect(body.query).toBe(dslQuery);
    expect(body.language).toBe("dsl");
    // BeingDB includes languageVersion/environmentFingerprint on execute responses
    // too, so a client can cache schema knowledge without a separate /predicates call.
    expect(typeof body.languageVersion).toBe("string");
    expect(body.environmentFingerprint).toBe((validationBody as { environmentFingerprint: string }).environmentFingerprint);
    expect(body.variables).toEqual(["Artist", "Work", "Exhibition", "Institution", "Funder"]);
    expect(body.results).toHaveLength(2);

    const kevin = body.results.find((r) => r.Artist?.value === "kevin_atherton");
    expect(kevin).toMatchObject({
      Artist: { type: "atom", value: "kevin_atherton" },
      Work: { type: "atom", value: "work_a" },
      Exhibition: { type: "atom", value: "exhibition_a" },
      Institution: { type: "atom", value: "institution_a" },
      Funder: { type: "atom", value: "arts_council" },
    });

    const david = body.results.find((r) => r.Artist?.value === "david_hall");
    expect(david).toMatchObject({
      Artist: { type: "atom", value: "david_hall" },
      Work: { type: "atom", value: "work_b" },
      Exhibition: { type: "atom", value: "exhibition_b" },
      Institution: null,
      Funder: null,
    });
  });

  it("explains the same query with a structured plan", async () => {
    const dslQuery = "find Artist, Work\nwhere\n  artist(Artist)\n  created(Artist, Work)\nlimit 10";
    const result = await client.callTool({ name: "beingdb_explain_query", arguments: { query: dslQuery } });
    expect(result.isError).toBeFalsy();
    const body = parseToolJson(result as never) as { query: string; plan: unknown[]; planText: string };
    expect(body.query).toBe(dslQuery);
    expect(Array.isArray(body.plan)).toBe(true);
    expect(body.plan.length).toBeGreaterThan(0);
    expect(typeof body.planText).toBe("string");
  });

  it("surfaces a structured unknown_predicate error, with the query still visible, for an invented predicate", async () => {
    const dslQuery = "find X\nwhere\n  not_a_real_predicate(X)";
    const result = await client.callTool({ name: "beingdb_validate_query", arguments: { query: dslQuery } });
    expect(result.isError).toBeFalsy();
    const body = parseToolJson(result as never) as { query: string; valid: boolean; errors: Array<{ code: string }> };
    expect(body.query).toBe(dslQuery);
    expect(body.valid).toBe(false);
    expect(body.errors[0]?.code).toBe("unknown_predicate");
  });
});
