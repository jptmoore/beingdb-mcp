import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { BeingDbClient } from "../src/beingdb-client.js";
import { BeingDbError } from "../src/types.js";

function fakeResponse(status: number, body: unknown): Response {
  return {
    status,
    text: async () => JSON.stringify(body),
  } as Response;
}

describe("BeingDbClient", () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("reports status from GET / and GET /version and detailed predicates", async () => {
    fetchMock
      .mockResolvedValueOnce(fakeResponse(200, { status: "OK" }))
      .mockResolvedValueOnce(fakeResponse(200, { name: "BeingDB", version: "0.1.3" }))
      .mockResolvedValueOnce(
        fakeResponse(200, {
          predicates: [{ name: "created", arity: 2, count: 2, arguments: [], examples: [] }],
          environmentFingerprint: "sha256:abc",
          languageVersion: "beingdb-dsl/1",
        })
      );

    const client = new BeingDbClient({ baseUrl: "http://localhost:8080" });
    const status = await client.getStatus();

    expect(status.reachable).toBe(true);
    expect(status.version).toBe("0.1.3");
    expect(status.name).toBe("BeingDB");
    expect(status.languageVersion).toBe("beingdb-dsl/1");
    expect(status.environmentFingerprint).toBe("sha256:abc");
    expect(status.predicateCount).toBe(1);
  });

  it("reports unreachable status on connection failure", async () => {
    fetchMock.mockRejectedValueOnce(new Error("ECONNREFUSED"));

    const client = new BeingDbClient({ baseUrl: "http://localhost:9999" });
    const status = await client.getStatus();

    expect(status.reachable).toBe(false);
    expect(status.error).toContain("Failed to reach BeingDB");
  });

  it("lists predicates without samples/detailed", async () => {
    fetchMock.mockResolvedValueOnce(
      fakeResponse(200, { predicates: [{ name: "created", arity: 2 }, { name: "artist", arity: 1 }] })
    );

    const client = new BeingDbClient({ baseUrl: "http://localhost:8080" });
    const result = await client.listPredicates();

    expect(fetchMock).toHaveBeenCalledWith("http://localhost:8080/predicates", expect.objectContaining({ method: "GET" }));
    expect(result).toEqual({ predicates: [{ name: "created", arity: 2 }, { name: "artist", arity: 1 }] });
  });

  it("lists detailed predicates filtered by q and names", async () => {
    fetchMock.mockResolvedValueOnce(
      fakeResponse(200, {
        predicates: [
          {
            name: "created",
            arity: 2,
            count: 2,
            arguments: [
              { position: 0, types: ["atom"] },
              { position: 1, types: ["atom"] },
            ],
            examples: [[{ type: "atom", value: "kevin_atherton" }, { type: "atom", value: "work_a" }]],
          },
        ],
        environmentFingerprint: "sha256:abc",
        languageVersion: "beingdb-dsl/1",
      })
    );

    const client = new BeingDbClient({ baseUrl: "http://localhost:8080" });
    const result = await client.listPredicates({ detailed: true, search: "creat", names: ["created", "funded_by"] });

    const calledUrl = fetchMock.mock.calls[0]![0] as string;
    expect(calledUrl).toContain("detailed=true");
    expect(calledUrl).toContain("q=creat");
    expect(calledUrl).toContain("names=created%2Cfunded_by");

    expect(result).toMatchObject({ environmentFingerprint: "sha256:abc", languageVersion: "beingdb-dsl/1" });
    if ("predicates" in result) {
      expect(result.predicates[0]).toMatchObject({ name: "created", arity: 2, count: 2 });
    }
  });

  it("ignores samples when detailed is set", async () => {
    fetchMock.mockResolvedValueOnce(fakeResponse(200, { predicates: [], environmentFingerprint: "sha256:x", languageVersion: "beingdb-dsl/1" }));

    const client = new BeingDbClient({ baseUrl: "http://localhost:8080" });
    await client.listPredicates({ detailed: true, samples: 20 });

    const calledUrl = fetchMock.mock.calls[0]![0] as string;
    expect(calledUrl).not.toContain("samples=");
  });

  it("executes a DSL query and preserves typed values, including unbound optional as null", async () => {
    fetchMock.mockResolvedValueOnce(
      fakeResponse(200, {
        variables: ["Artist", "Work", "Institution"],
        results: [
          {
            Artist: { type: "atom", value: "kevin_atherton" },
            Work: { type: "atom", value: "work_a" },
            Institution: { type: "atom", value: "institution_a" },
          },
          { Artist: { type: "atom", value: "david_hall" }, Work: { type: "atom", value: "work_b" }, Institution: null },
        ],
        count: 2,
        warnings: [],
        language: "dsl",
        languageVersion: "beingdb-dsl/1",
        environmentFingerprint: "sha256:abc",
      })
    );

    const client = new BeingDbClient({ baseUrl: "http://localhost:8080" });
    const dslQuery = "find Artist, Work, Institution\nwhere\n  created(Artist, Work)\n  optional\n    studied_at(Artist, Institution)";
    const outcome = await client.runQuery({ query: dslQuery, language: "dsl" });

    expect(outcome.outcome).toBe("success");
    if (outcome.outcome === "success" && "results" in outcome.body) {
      expect(outcome.body.results).toHaveLength(2);
      expect(outcome.body.results[1]!.Institution).toBeNull();
      expect(outcome.body.results[0]!.Artist).toEqual({ type: "atom", value: "kevin_atherton" });
      expect(outcome.body.environmentFingerprint).toBe("sha256:abc");
      expect(outcome.body.languageVersion).toBe("beingdb-dsl/1");
    }

    // Confirm the exact query text was submitted unmodified.
    const [, init] = fetchMock.mock.calls[0]!;
    const sentBody = JSON.parse((init as RequestInit).body as string);
    expect(sentBody.query).toBe(dslQuery);
    expect(sentBody.language).toBe("dsl");
    expect(sentBody.action).toBe("execute");
  });

  it("classifies a query-invalid response as 'invalid', preserving structured errors", async () => {
    fetchMock.mockResolvedValueOnce(
      fakeResponse(400, {
        valid: false,
        errors: [
          {
            code: "unknown_predicate",
            message: "Unknown predicate 'artst'; did you mean: artist?",
            line: 2,
            column: 3,
            predicate: "artst",
            suggestions: ["artist"],
          },
        ],
        warnings: [],
        language: "dsl",
        languageVersion: "beingdb-dsl/1",
        environmentFingerprint: "sha256:abc",
      })
    );

    const client = new BeingDbClient({ baseUrl: "http://localhost:8080" });
    const outcome = await client.runQuery({ query: "find X\nwhere\n  artst(X)", action: "validate" });

    expect(outcome.outcome).toBe("invalid");
    if (outcome.outcome === "invalid") {
      expect(outcome.body.valid).toBe(false);
      expect(outcome.body.errors[0]?.code).toBe("unknown_predicate");
      expect(outcome.body.errors[0]?.suggestions).toEqual(["artist"]);
    }
  });

  it("returns explain plan details for action=explain", async () => {
    fetchMock.mockResolvedValueOnce(
      fakeResponse(200, {
        valid: true,
        errors: [],
        warnings: [],
        language: "dsl",
        languageVersion: "beingdb-dsl/1",
        environmentFingerprint: "sha256:abc",
        projection: ["Artist", "Work"],
        distinct: false,
        normalizedCoreQuery: { patterns: ["artist(Artist)", "created(Artist, Work)"], comparisons: [] },
        plan: [{ operation: "predicate_scan", predicate: "artist" }],
        planText: "artist: full_scan",
      })
    );

    const client = new BeingDbClient({ baseUrl: "http://localhost:8080" });
    const outcome = await client.runQuery({ query: "find Artist, Work\nwhere\n  artist(Artist)\n  created(Artist, Work)", action: "explain" });

    expect(outcome.outcome).toBe("success");
    if (outcome.outcome === "success" && "plan" in outcome.body) {
      expect(outcome.body.plan).toEqual([{ operation: "predicate_scan", predicate: "artist" }]);
      expect(outcome.body.planText).toBe("artist: full_scan");
    }
  });

  it("classifies a transport/runtime failure (malformed request) distinctly from a query-invalid result", async () => {
    fetchMock.mockResolvedValueOnce(fakeResponse(400, { error: { code: "malformed_request", message: "Missing 'query' field" } }));

    const client = new BeingDbClient({ baseUrl: "http://localhost:8080" });
    const outcome = await client.runQuery({ query: "created(Artist, Work)" });

    expect(outcome.outcome).toBe("transport_error");
    if (outcome.outcome === "transport_error") {
      expect(outcome.body.code).toBe("malformed_request");
    }
  });

  it("throws BeingDbError with structured code/status for a plain HTTP error on GET endpoints", async () => {
    fetchMock.mockResolvedValueOnce(
      fakeResponse(400, { error: { code: "invalid_request", message: "Invalid predicate name 'Bad Name'." } })
    );

    const client = new BeingDbClient({ baseUrl: "http://localhost:8080" });
    await expect(client.getFacts("Bad Name")).rejects.toMatchObject({
      code: "invalid_request",
      status: 400,
    });
  });

  it("throws BeingDbError on network failure", async () => {
    fetchMock.mockRejectedValueOnce(new Error("network down"));

    const client = new BeingDbClient({ baseUrl: "http://localhost:8080" });
    await expect(client.getVersion()).rejects.toBeInstanceOf(BeingDbError);
  });

  it("throws BeingDbError on malformed (non-JSON) response body", async () => {
    fetchMock.mockResolvedValueOnce({ status: 200, text: async () => "<html>not json</html>" } as Response);

    const client = new BeingDbClient({ baseUrl: "http://localhost:8080" });
    await expect(client.getVersion()).rejects.toMatchObject({ code: "malformed_response" });
  });

  it("retrieves all facts for a predicate", async () => {
    fetchMock.mockResolvedValueOnce(
      fakeResponse(200, {
        predicate: "created",
        facts: [[{ type: "atom", value: "kevin_atherton" }, { type: "atom", value: "work_a" }]],
      })
    );

    const client = new BeingDbClient({ baseUrl: "http://localhost:8080" });
    const result = await client.getFacts("created");

    expect(fetchMock).toHaveBeenCalledWith("http://localhost:8080/query/created", expect.objectContaining({ method: "GET" }));
    expect(result.facts).toHaveLength(1);
  });
});
