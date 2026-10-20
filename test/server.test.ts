import { readFile } from "node:fs/promises";
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
      "beingdb_diagnose_query",
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

    const diagnoseTool = tools.find((t) => t.name === "beingdb_diagnose_query");
    expect(Object.keys(diagnoseTool?.inputSchema.properties ?? {})).toEqual(["query"]);

    // Every tool advertises a structured output schema that tolerates fields BeingDB may add later.
    for (const tool of tools) {
      expect(tool.outputSchema, tool.name).toBeDefined();
      expect((tool.outputSchema as { additionalProperties?: unknown }).additionalProperties, tool.name).not.toBe(false);
    }
  });

  it("registers the schema and query-language resources", async () => {
    const { resources } = await client.listResources();
    const uris = resources.map((r) => r.uri).sort();
    expect(uris).toEqual(["beingdb://query-language", "beingdb://schema"]);
  });

  it("advertises the package.json version", async () => {
    const pkg = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8")) as { version: string };
    expect(client.getServerVersion()).toEqual({ name: "beingdb-mcp", version: pkg.version });
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

  describe("predicate introspection", () => {
    // Canonical BeingDB `GET /predicates?detailed=true` output for a pack mixing
    // a fully declared predicate, a description-only one, and an undeclared one.
    const canonical = {
      predicates: [
        {
          name: "artist",
          arity: 1,
          count: 2,
          arguments: [{ position: 0, types: ["atom"] }],
          examples: [[{ type: "atom", value: "kevin_atherton" }]],
        },
        {
          name: "created",
          arity: 2,
          count: 2,
          description: "Relates an artist to a work they created.",
          arguments: [
            { position: 0, types: ["atom"], role: "Artist", semanticType: "person" },
            { position: 1, types: ["atom"], role: "Work", semanticType: "work" },
          ],
          examples: [[{ type: "atom", value: "kevin_atherton" }, { type: "atom", value: "work_a" }]],
        },
        {
          name: "studied_at",
          arity: 2,
          count: 1,
          description: "Relates an artist to an institution where they studied.",
          arguments: [
            { position: 0, types: ["atom"] },
            { position: 1, types: ["atom"] },
          ],
          examples: [[{ type: "atom", value: "kevin_atherton" }, { type: "atom", value: "institution_a" }]],
        },
      ],
      environmentFingerprint: "sha256:abc",
      languageVersion: "beingdb-dsl/1",
    };

    it("returns BeingDB's declared description, argument roles, semantic types and arity unchanged as structured content", async () => {
      fetchMock.mockResolvedValueOnce(fakeResponse(200, canonical));

      const result = await client.callTool({ name: "beingdb_list_predicates", arguments: { detailed: true } });

      expect(result.isError).toBeFalsy();
      expect(result.structuredContent).toEqual(canonical);
      expect(parseToolText(result as never)).toEqual(canonical);

      const created = (result.structuredContent as typeof canonical).predicates.find((p) => p.name === "created")!;
      expect(created.arity).toBe(2);
      expect(created.description).toBe("Relates an artist to a work they created.");
      expect(created.arguments.map((a) => a.role)).toEqual(["Artist", "Work"]);
      expect(created.arguments.map((a) => a.semanticType)).toEqual(["person", "work"]);
    });

    it("does not fabricate descriptions, roles or semantic types BeingDB omits", async () => {
      fetchMock.mockResolvedValueOnce(fakeResponse(200, canonical));

      const result = await client.callTool({ name: "beingdb_list_predicates", arguments: { names: ["artist", "studied_at"] } });
      const body = result.structuredContent as typeof canonical;

      const artist = body.predicates.find((p) => p.name === "artist")!;
      expect(artist).not.toHaveProperty("description");
      expect(artist.arguments[0]).not.toHaveProperty("role");
      expect(artist.arguments[0]).not.toHaveProperty("semanticType");

      const studied = body.predicates.find((p) => p.name === "studied_at")!;
      expect(studied.description).toBe("Relates an artist to an institution where they studied.");
      for (const arg of studied.arguments) {
        expect(arg).not.toHaveProperty("role");
        expect(arg).not.toHaveProperty("semanticType");
      }

      // `names` alone requests BeingDB's detailed listing.
      const calledUrl = fetchMock.mock.calls[0]![0] as string;
      expect(calledUrl).toContain("detailed=true");
      expect(calledUrl).toContain("names=artist%2Cstudied_at");
    });

    it("keeps the no-argument summary listing unchanged", async () => {
      const summary = { predicates: [{ name: "artist", arity: 1 }, { name: "created", arity: 2 }] };
      fetchMock.mockResolvedValueOnce(fakeResponse(200, summary));

      const result = await client.callTool({ name: "beingdb_list_predicates", arguments: {} });

      expect(result.structuredContent).toEqual(summary);
      expect(fetchMock.mock.calls[0]![0]).toBe("http://localhost:8080/predicates");
    });
  });

  describe("beingdb_diagnose_query", () => {
    const query = "find Work\nwhere\n  created(work_a, Work)";
    // Canonical BeingDB `POST /query {"language":"dsl","action":"diagnose"}` output.
    const canonical = {
      valid: true,
      errors: [],
      warnings: [],
      diagnostics: [
        {
          code: "constant_not_at_position",
          severity: "error",
          message: "No created fact has 'work_a' as argument 0. 'work_a' occurs in created only at argument 1.",
          line: 3,
          predicate: "created",
          argumentPosition: 0,
          value: { type: "atom", value: "work_a" },
          scope: "positive",
          evidence: {
            declaredRole: "Artist",
            occursAtPositions: [1],
            occursIn: [{ predicate: "work_shown_in", argumentPosition: 0 }],
            occursInCount: 1,
          },
          repair: { kind: "swap_arguments", predicate: "created", line: 3, positions: [0, 1] },
        },
      ],
      provablyEmpty: true,
      repair: {
        query: "find Work\nwhere\n  created(Work, work_a)",
        applied: [{ kind: "swap_arguments", predicate: "created", line: 3, positions: [0, 1] }],
      },
      language: "dsl",
      languageVersion: "beingdb-dsl/1",
      environmentFingerprint: "sha256:abc",
    };

    it("forwards to BeingDB's diagnose action and returns its diagnostics and proven repair verbatim, without applying it", async () => {
      fetchMock.mockResolvedValueOnce(fakeResponse(200, canonical));

      const result = await client.callTool({ name: "beingdb_diagnose_query", arguments: { query } });

      expect(result.isError).toBeFalsy();
      expect(result.structuredContent).toEqual({ query, ...canonical });
      expect(parseToolText(result as never)).toEqual({ query, ...canonical });

      expect(fetchMock).toHaveBeenCalledTimes(1);
      const [url, init] = fetchMock.mock.calls[0]!;
      expect(url).toBe("http://localhost:8080/query");
      expect(JSON.parse((init as RequestInit).body as string)).toEqual({ query, language: "dsl", action: "diagnose" });
    });

    it("reports an invalid query as a normal (non-error) diagnosis", async () => {
      const invalid = {
        valid: false,
        errors: [{ code: "unknown_predicate", message: "Unknown predicate 'artst'; did you mean: artist?", line: 3, column: 3, predicate: "artst", suggestions: ["artist"] }],
        warnings: [],
        diagnostics: [],
        provablyEmpty: false,
        language: "dsl",
        languageVersion: "beingdb-dsl/1",
        environmentFingerprint: "sha256:abc",
      };
      fetchMock.mockResolvedValueOnce(fakeResponse(200, invalid));

      const result = await client.callTool({ name: "beingdb_diagnose_query", arguments: { query: "find X\nwhere\n  artst(X)" } });

      expect(result.isError).toBeFalsy();
      expect(result.structuredContent).toEqual({ query: "find X\nwhere\n  artst(X)", ...invalid });
    });

    it("surfaces BeingDB rejecting the diagnose action (e.g. an older server) as a tool error", async () => {
      fetchMock.mockResolvedValueOnce(fakeResponse(400, { error: { code: "unknown_action", message: "Unknown action 'diagnose'" } }));

      const result = await client.callTool({ name: "beingdb_diagnose_query", arguments: { query } });

      expect(result.isError).toBe(true);
      expect(result.structuredContent).toBeUndefined();
      expect(parseToolText(result as never)).toEqual({ query, language: "dsl", error: { code: "unknown_action", message: "Unknown action 'diagnose'" } });
    });
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
