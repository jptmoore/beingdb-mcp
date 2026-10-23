/**
 * Local integration tests: the real beingdb-mcp server (src/index.ts,
 * Streamable HTTP) driven by an MCP SDK `Client`, against the real local
 * BeingDB started by ./global-setup.ts on the fixtures/demo-facts pack.
 * Nothing here contacts a non-local host, and expected values are compared
 * against BeingDB's own HTTP responses rather than re-derived.
 */
import path from "node:path";
import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

import { PROJECT_ROOT } from "../../scripts/local-beingdb.js";
import type { LocalProcess } from "../../scripts/local-beingdb.js";
import { startMcpServer } from "./mcp-server-process.js";

const beingDbUrl = inject("beingDbUrl");
const FINGERPRINT = /^sha256:[0-9a-f]{64}$/;

type ToolResult = { content: Array<{ type: string; text?: string }>; structuredContent?: Record<string, unknown>; isError?: boolean };

function parseToolJson(result: ToolResult): Record<string, unknown> {
  const first = result.content[0];
  if (!first || first.type !== "text" || typeof first.text !== "string") {
    throw new Error("Expected a single text content block");
  }
  return JSON.parse(first.text);
}

/** BeingDB's own HTTP response, for MCP-vs-native parity checks. */
async function native(urlPath: string, body?: unknown): Promise<Record<string, unknown>> {
  const res = await fetch(`${beingDbUrl}${urlPath}`, {
    method: body === undefined ? "GET" : "POST",
    headers: body === undefined ? undefined : { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return (await res.json()) as Record<string, unknown>;
}

let mcpServer: LocalProcess;
let client: Client;

async function call(name: string, args: Record<string, unknown> = {}): Promise<ToolResult> {
  return (await client.callTool({ name, arguments: args })) as ToolResult;
}

beforeAll(async () => {
  expect(new URL(beingDbUrl).hostname).toBe("127.0.0.1");
  mcpServer = await startMcpServer(beingDbUrl, path.join(PROJECT_ROOT, ".local", "logs", "integration-mcp.log"));
  client = new Client({ name: "integration-test-client", version: "0.0.0" });
  await client.connect(new StreamableHTTPClientTransport(new URL(`${mcpServer.url}/mcp`)));
});

afterAll(async () => {
  await client?.close();
  await mcpServer?.stop();
});

describe("server identity and status", () => {
  it("identifies itself with the package version", () => {
    expect(client.getServerVersion()).toMatchObject({ name: "beingdb-mcp", version: "0.3.0" });
  });

  it("reports the local BeingDB as reachable, with version and fingerprint", async () => {
    const result = await call("beingdb_status");
    expect(result.isError).toBeFalsy();
    expect(result.structuredContent).toMatchObject({ reachable: true, url: beingDbUrl, predicateCount: 5 });
    expect(result.structuredContent?.version).toBe((await native("/version")).version);
    expect(result.structuredContent?.environmentFingerprint).toMatch(FINGERPRINT);
  });
});

describe("schema / introspection", () => {
  it("returns BeingDB's canonical detailed introspection unchanged", async () => {
    const result = await call("beingdb_list_predicates", { detailed: true });
    expect(result.isError).toBeFalsy();
    const canonical = await native("/predicates?detailed=true");
    expect(result.structuredContent).toEqual(canonical);
    expect(parseToolJson(result)).toEqual(canonical);
    expect(canonical.environmentFingerprint).toMatch(FINGERPRINT);
    expect(canonical.languageVersion).toBe("beingdb-dsl/1");
  });

  it("exposes declared description, roles and semantic types, plus arity, count and examples", async () => {
    const result = await call("beingdb_list_predicates", { names: ["created", "work_shown_in"] });
    type Predicate = { name: string; arguments: Array<Record<string, unknown>> };
    const predicates = (result.structuredContent as { predicates: Predicate[] }).predicates;
    expect(predicates.map((p) => p.name).sort()).toEqual(["created", "work_shown_in"]);

    // fixtures/demo-facts/predicates/created.pl: `%! created(Artist:person, Work:work)`.
    expect(predicates.find((p) => p.name === "created")).toEqual({
      name: "created",
      arity: 2,
      count: 2,
      description: "Relates an artist to a work they created.",
      arguments: [
        { position: 0, types: ["atom"], role: "Artist", semanticType: "person" },
        { position: 1, types: ["atom"], role: "Work", semanticType: "work" },
      ],
      examples: [
        [{ type: "atom", value: "kevin_atherton" }, { type: "atom", value: "work_a" }],
        [{ type: "atom", value: "david_hall" }, { type: "atom", value: "work_b" }],
      ],
    });
    // Roles without semantic types.
    expect(predicates.find((p) => p.name === "work_shown_in")!.arguments.map((a) => [a.role, a.semanticType])).toEqual([
      ["Work", undefined],
      ["Exhibition", undefined],
    ]);
  });

  it("does not fabricate metadata for description-only or undeclared predicates", async () => {
    const result = await call("beingdb_list_predicates", { names: ["studied_at", "artist", "funded_by"] });
    type Predicate = { name: string; description?: string; arguments: Array<Record<string, unknown>> };
    const byName = (name: string) => (result.structuredContent as { predicates: Predicate[] }).predicates.find((p) => p.name === name)!;

    expect(byName("studied_at").description).toBe("Relates an artist to an institution where they studied.");
    for (const name of ["studied_at", "artist", "funded_by"]) {
      expect(byName(name).arguments.every((a) => !("role" in a) && !("semanticType" in a)), name).toBe(true);
    }
    expect(byName("artist")).not.toHaveProperty("description");
    expect(byName("funded_by")).not.toHaveProperty("description");
  });
});

describe("diagnose", () => {
  it("passes through BeingDB's diagnostics and proven repair for a reversed constant", async () => {
    const dslQuery = "find Work\nwhere\n  created(work_a, Work)";
    const result = await call("beingdb_diagnose_query", { query: dslQuery });
    expect(result.isError).toBeFalsy();
    expect(result.structuredContent).toEqual({ query: dslQuery, ...(await native("/query", { language: "dsl", action: "diagnose", query: dslQuery })) });

    expect(result.structuredContent).toMatchObject({
      valid: true,
      provablyEmpty: true,
      diagnostics: [
        {
          code: "constant_not_at_position",
          severity: "error",
          argumentPosition: 0,
          evidence: { occursAtPositions: [1] },
          repair: { kind: "swap_arguments", positions: [0, 1] },
        },
      ],
      repair: {
        query: "find Work\nwhere\n  created(Work, work_a)",
        applied: [{ kind: "swap_arguments", predicate: "created", line: 3, positions: [0, 1] }],
      },
    });
  });

  it("passes through role_name_mismatch warnings derived from declared roles", async () => {
    const dslQuery = "find Work, Artist\nwhere\n  created(Work, Artist)";
    const result = await call("beingdb_diagnose_query", { query: dslQuery });
    expect(result.structuredContent).toEqual({ query: dslQuery, ...(await native("/query", { language: "dsl", action: "diagnose", query: dslQuery })) });
    const diagnostics = result.structuredContent?.diagnostics as Array<{ code: string; severity: string }>;
    expect(diagnostics.map((d) => [d.code, d.severity])).toEqual([
      ["role_name_mismatch", "warning"],
      ["role_name_mismatch", "warning"],
    ]);
    expect(result.structuredContent?.provablyEmpty).toBe(false);
  });

  it("reports an invalid query as a normal diagnosis, not a tool error", async () => {
    const dslQuery = "find X\nwhere\n  artst(X)";
    const result = await call("beingdb_diagnose_query", { query: dslQuery });
    expect(result.isError).toBeFalsy();
    expect(result.structuredContent).toMatchObject({ query: dslQuery, valid: false, errors: [{ code: "unknown_predicate", suggestions: ["artist"] }] });
  });

  it("passes through BeingDB's suggestions for a misspelled constant, as hints rather than a repair", async () => {
    const dslQuery = "find Artist\nwhere\n  created(Artist, work_aa)";
    const result = await call("beingdb_diagnose_query", { query: dslQuery });
    expect(result.isError).toBeFalsy();
    expect(result.structuredContent).toEqual({ query: dslQuery, ...(await native("/query", { language: "dsl", action: "diagnose", query: dslQuery })) });
    expect(result.structuredContent).toMatchObject({
      provablyEmpty: true,
      diagnostics: [{ code: "unknown_constant", argumentPosition: 1, evidence: { suggestions: ["work_a", "work_b"] } }],
    });
    expect(result.structuredContent).not.toHaveProperty("repair");
  });

  it("diagnoses a valid query cleanly", async () => {
    const dslQuery = "find Artist, Work\nwhere\n  created(Artist, Work)";
    const result = await call("beingdb_diagnose_query", { query: dslQuery });
    expect(result.structuredContent).toMatchObject({ valid: true, errors: [], diagnostics: [], provablyEmpty: false });
    expect(result.structuredContent).not.toHaveProperty("repair");
  });
});

describe("execute", () => {
  it("executes a valid query and returns BeingDB's typed rows unchanged", async () => {
    const dslQuery = "find Artist, Work\nwhere\n  created(Artist, Work)\norder by Artist ascending";
    const result = await call("beingdb_query", { query: dslQuery });
    expect(result.isError).toBeFalsy();
    expect(result.structuredContent).toEqual({ query: dslQuery, ...(await native("/query", { language: "dsl", action: "execute", query: dslQuery })) });
    expect(result.structuredContent?.results).toEqual([
      { Artist: { type: "atom", value: "david_hall" }, Work: { type: "atom", value: "work_b" } },
      { Artist: { type: "atom", value: "kevin_atherton" }, Work: { type: "atom", value: "work_a" } },
    ]);
    expect(result.structuredContent).toMatchObject({ hasMore: false, truncated: false });
  });

  it("reports hasMore when the query's own limit stops it, without marking it truncated", async () => {
    const dslQuery = "find Artist\nwhere\n  artist(Artist)\norder by Artist ascending\nlimit 1";
    const result = await call("beingdb_query", { query: dslQuery });
    expect(result.structuredContent).toEqual({ query: dslQuery, ...(await native("/query", { language: "dsl", action: "execute", query: dslQuery })) });
    expect(result.structuredContent).toMatchObject({ count: 1, hasMore: true, truncated: false, warnings: [] });

    const lastPage = `${dslQuery}\noffset 1`;
    const next = await call("beingdb_query", { query: lastPage });
    expect(next.structuredContent).toMatchObject({ count: 1, hasMore: false, truncated: false });
  });

  it("validates then executes a non-trivial DSL join, preserving the exact query", async () => {
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

    const validation = await call("beingdb_validate_query", { query: dslQuery });
    expect(validation.isError).toBeFalsy();
    expect(validation.structuredContent).toMatchObject({ query: dslQuery, valid: true });

    const execution = await call("beingdb_query", { query: dslQuery });
    expect(execution.isError).toBeFalsy();
    const body = execution.structuredContent as {
      query: string;
      language: string;
      environmentFingerprint: string;
      variables: string[];
      results: Array<Record<string, { type: string; value: string } | null>>;
    };
    expect(body.query).toBe(dslQuery);
    expect(body.language).toBe("dsl");
    expect(body.environmentFingerprint).toBe(validation.structuredContent?.environmentFingerprint);
    expect(body.variables).toEqual(["Artist", "Work", "Exhibition", "Institution", "Funder"]);
    expect(body.results).toHaveLength(2);
    expect(body.results.find((r) => r.Artist?.value === "kevin_atherton")).toMatchObject({
      Work: { type: "atom", value: "work_a" },
      Exhibition: { type: "atom", value: "exhibition_a" },
      Institution: { type: "atom", value: "institution_a" },
      Funder: { type: "atom", value: "arts_council" },
    });
    expect(body.results.find((r) => r.Artist?.value === "david_hall")).toMatchObject({
      Work: { type: "atom", value: "work_b" },
      Exhibition: { type: "atom", value: "exhibition_b" },
      Institution: null,
      Funder: null,
    });
  });

  it("explains a query with a structured plan", async () => {
    const dslQuery = "find Artist, Work\nwhere\n  artist(Artist)\n  created(Artist, Work)\nlimit 10";
    const result = await call("beingdb_explain_query", { query: dslQuery });
    expect(result.isError).toBeFalsy();
    expect(result.structuredContent?.query).toBe(dslQuery);
    expect((result.structuredContent?.plan as unknown[]).length).toBeGreaterThan(0);
    expect(typeof result.structuredContent?.planText).toBe("string");
  });

  it("surfaces a structured unknown_predicate error, with the query still visible", async () => {
    const dslQuery = "find X\nwhere\n  not_a_real_predicate(X)";
    const result = await call("beingdb_validate_query", { query: dslQuery });
    expect(result.isError).toBeFalsy();
    expect(result.structuredContent).toMatchObject({ query: dslQuery, valid: false, errors: [{ code: "unknown_predicate" }] });
  });
});

describe("end-to-end MCP agent workflow", () => {
  it("inspects the schema, diagnoses a candidate, takes BeingDB's proven repair, re-diagnoses and executes", async () => {
    // 1. Inspect the schema and pick the predicate relating artists to works by its declared roles.
    const schema = await call("beingdb_list_predicates", { detailed: true });
    const predicates = (schema.structuredContent as { predicates: Array<{ name: string; arguments: Array<{ role?: string }> }> }).predicates;
    const relation = predicates.find((p) => p.arguments.map((a) => a.role).join() === "Artist,Work");
    expect(relation?.name).toBe("created");

    // 2. A candidate query with the arguments the wrong way round.
    const candidate = `find Artist\nwhere\n  ${relation!.name}(work_b, Artist)`;

    // 3. Diagnose it.
    const diagnosis = await call("beingdb_diagnose_query", { query: candidate });
    const report = diagnosis.structuredContent as { provablyEmpty: boolean; diagnostics: Array<{ code: string }>; repair?: { query: string } };

    // 4. Inspect the diagnostics; the client (not MCP) decides to use the proven repair.
    expect(report.provablyEmpty).toBe(true);
    expect(report.diagnostics.map((d) => d.code)).toContain("constant_not_at_position");
    expect(report.repair?.query).toBe("find Artist\nwhere\n  created(Artist, work_b)");
    const repaired = report.repair!.query;

    const recheck = await call("beingdb_diagnose_query", { query: repaired });
    expect(recheck.structuredContent).toMatchObject({ valid: true, provablyEmpty: false, diagnostics: [] });

    // 5. Execute the repaired, clean query and verify the data.
    const execution = await call("beingdb_query", { query: repaired });
    expect(execution.isError).toBeFalsy();
    expect(execution.structuredContent?.results).toEqual([{ Artist: { type: "atom", value: "david_hall" } }]);
  });
});
