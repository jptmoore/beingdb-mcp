import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";

import { BeingDbClient } from "../src/beingdb-client.js";
import { createBeingDbMcpServer } from "../src/server.js";

function fakeResponse(status: number, body: unknown): Response {
  return { status, text: async () => JSON.stringify(body) } as Response;
}

function parseToolText(result: { content: Array<{ type: string; text?: string }> }): unknown {
  const first = result.content[0];
  if (!first || first.type !== "text" || typeof first.text !== "string") {
    throw new Error("Expected a single text content block");
  }
  return JSON.parse(first.text);
}

describe("beingdb-mcp server", () => {
  let fetchMock: ReturnType<typeof vi.fn>;
  let client: Client;

  beforeEach(async () => {
    fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const beingDb = new BeingDbClient({ baseUrl: "http://localhost:8080" });
    const server = createBeingDbMcpServer(beingDb);

    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    client = new Client({ name: "test-client", version: "0.0.0" });
    await Promise.all([client.connect(clientTransport), server.connect(serverTransport)]);
  });

  afterEach(async () => {
    await client.close();
    vi.unstubAllGlobals();
  });

  it("registers the expected tools with input schemas", async () => {
    const { tools } = await client.listTools();
    const names = tools.map((t) => t.name).sort();

    expect(names).toEqual([
      "beingdb_explain_query",
      "beingdb_get_facts",
      "beingdb_list_predicates",
      "beingdb_query",
      "beingdb_status",
      "beingdb_validate_query",
    ]);

    const queryTool = tools.find((t) => t.name === "beingdb_query");
    expect(queryTool?.inputSchema.properties).toHaveProperty("query");
    expect(queryTool?.inputSchema.properties).toHaveProperty("language");
    expect(queryTool?.inputSchema.properties).toHaveProperty("offset");
    expect(queryTool?.inputSchema.properties).toHaveProperty("limit");

    const validateTool = tools.find((t) => t.name === "beingdb_validate_query");
    expect(validateTool?.inputSchema.properties).toHaveProperty("query");
    expect(validateTool?.inputSchema.properties).toHaveProperty("language");
  });

  it("registers the schema and query-language resources", async () => {
    const { resources } = await client.listResources();
    const uris = resources.map((r) => r.uri).sort();
    expect(uris).toEqual(["beingdb://query-language", "beingdb://schema"]);
  });

  it("defaults beingdb_query to the DSL language and returns the exact submitted query for transparency", async () => {
    fetchMock.mockResolvedValueOnce(
      fakeResponse(200, {
        variables: ["Artist", "Work"],
        results: [{ Artist: { type: "atom", value: "kevin_atherton" }, Work: { type: "atom", value: "work_a" } }],
        count: 1,
        warnings: [],
        language: "dsl",
        languageVersion: "beingdb-dsl/1",
        environmentFingerprint: "sha256:abc",
      })
    );

    const dslQuery = "find Artist, Work\nwhere\n  created(Artist, Work)";
    const result = await client.callTool({ name: "beingdb_query", arguments: { query: dslQuery } });

    expect(result.isError).toBeFalsy();
    const body = parseToolText(result as never) as Record<string, unknown>;
    expect(body.query).toBe(dslQuery);
    expect(body.language).toBe("dsl");
    expect(body.results).toHaveLength(1);
    expect(body.environmentFingerprint).toBe("sha256:abc");
    expect(body.languageVersion).toBe("beingdb-dsl/1");

    // Confirm the request actually sent to BeingDB defaulted to language=dsl, action=execute.
    const [, init] = fetchMock.mock.calls[0]!;
    const sentBody = JSON.parse((init as RequestInit).body as string);
    expect(sentBody.language).toBe("dsl");
    expect(sentBody.action).toBe("execute");
  });

  it("surfaces structured validation errors from beingdb_validate_query without marking it a tool error", async () => {
    fetchMock.mockResolvedValueOnce(
      fakeResponse(400, {
        valid: false,
        errors: [{ code: "unknown_predicate", message: "Unknown predicate 'artst'; did you mean: artist?", suggestions: ["artist"] }],
        warnings: [],
        language: "dsl",
        languageVersion: "beingdb-dsl/1",
        environmentFingerprint: "sha256:abc",
      })
    );

    const query = "find X\nwhere\n  artst(X)";
    const result = await client.callTool({ name: "beingdb_validate_query", arguments: { query } });

    expect(result.isError).toBeFalsy();
    const body = parseToolText(result as never) as Record<string, unknown>;
    expect(body.query).toBe(query);
    expect(body.valid).toBe(false);
    expect((body.errors as Array<{ code: string }>)[0]?.code).toBe("unknown_predicate");
  });

  it("propagates a transport/runtime failure as a tool error", async () => {
    fetchMock.mockRejectedValueOnce(new Error("connection refused"));

    const result = await client.callTool({ name: "beingdb_query", arguments: { query: "created(Artist, Work)", language: "core" } });

    expect(result.isError).toBe(true);
    const body = parseToolText(result as never) as { error: { code: string } };
    expect(body.error.code).toBe("connection_failed");
  });

  it("propagates BeingDB HTTP errors from beingdb_get_facts as a tool error", async () => {
    fetchMock.mockResolvedValueOnce(fakeResponse(400, { error: { code: "invalid_request", message: "Invalid predicate name" } }));

    const result = await client.callTool({ name: "beingdb_get_facts", arguments: { predicate: "created" } });

    expect(result.isError).toBe(true);
    const body = parseToolText(result as never) as { error: { code: string } };
    expect(body.error.code).toBe("invalid_request");
  });

  it("reads the beingdb://schema resource from live predicate/version data", async () => {
    fetchMock
      .mockResolvedValueOnce(fakeResponse(200, { name: "BeingDB", version: "0.1.3" }))
      .mockResolvedValueOnce(
        fakeResponse(200, {
          predicates: [{ name: "created", arity: 2, count: 2, arguments: [], examples: [] }],
          environmentFingerprint: "sha256:abc",
          languageVersion: "beingdb-dsl/1",
        })
      );

    const result = await client.readResource({ uri: "beingdb://schema" });
    const content = result.contents[0];
    expect(content?.mimeType).toBe("application/json");
    const body = JSON.parse(content?.text as string);
    expect(body.version).toEqual({ name: "BeingDB", version: "0.1.3" });
    expect(body.environmentFingerprint).toBe("sha256:abc");
  });
});
