/**
 * MCP server wiring: registers tools and resources on top of a
 * {@link BeingDbClient}. The MCP layer stays deliberately thin -- it does
 * not parse, validate, diagnose, repair or reinterpret BeingDB query text,
 * and it does not derive schema metadata; it forwards requests and returns
 * BeingDB's own structured JSON (as MCP `structuredContent` plus the same
 * JSON as text), always alongside the exact query text submitted (see the
 * "transparency is first-class" design goal).
 */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";

import type { BeingDbClient } from "./beingdb-client.js";
import { BeingDbError } from "./types.js";
import type { QueryOutcome } from "./types.js";
import {
  diagnoseInputShape,
  diagnoseOutputSchema,
  executeOutputSchema,
  explainOutputSchema,
  getFactsInputShape,
  getFactsOutputSchema,
  listPredicatesInputShape,
  listPredicatesOutputSchema,
  queryInputShape,
  statusOutputSchema,
  validateOrExplainInputShape,
  validateOutputSchema,
} from "./schemas.js";
import { QUERY_LANGUAGE_REFERENCE } from "./query-language-reference.js";

export const SERVER_VERSION = "0.5.0";

/**
 * Every tool returns BeingDB's JSON both as `structuredContent` (validated
 * against the tool's `outputSchema`) and, for clients that only read
 * `content`, as the identical serialised text. Error results carry text
 * only, since they do not follow the tool's output schema.
 */
function jsonResult(body: unknown, isError = false): CallToolResult {
  const result: CallToolResult = { content: [{ type: "text", text: JSON.stringify(body, null, 2) }], isError };
  if (!isError && body !== null && typeof body === "object" && !Array.isArray(body)) {
    result.structuredContent = body as Record<string, unknown>;
  }
  return result;
}

/** Uniform handling for any thrown {@link BeingDbError} (connection failures, timeouts, HTTP errors). */
function toolErrorResult(err: unknown): CallToolResult {
  if (err instanceof BeingDbError) {
    return jsonResult({ error: { code: err.code, message: err.message, status: err.status } }, true);
  }
  const message = err instanceof Error ? err.message : String(err);
  return jsonResult({ error: { code: "unknown_error", message } }, true);
}

/**
 * Builds the MCP tool result for a `beingdb_query` / `beingdb_validate_query`
 * / `beingdb_explain_query` call, always including the exact submitted
 * `query` and `language` so the calling LLM (or a human via MCP Inspector)
 * can see and reproduce it. `isError` is reserved for transport/runtime
 * failures -- a structurally invalid query (`valid: false`) is a normal,
 * informative result, not a tool failure.
 */
function buildQueryToolResult(outcome: QueryOutcome, query: string): CallToolResult {
  if (outcome.outcome === "transport_error") {
    return jsonResult({ query, language: "dsl", error: outcome.body }, true);
  }
  // outcome.body already carries its own authoritative `language` (BeingDB
  // echoes it on every success/invalid response); `query` never comes from
  // BeingDB, so it always needs adding here.
  return jsonResult({ query, ...outcome.body }, false);
}

export function createBeingDbMcpServer(client: BeingDbClient): McpServer {
  const server = new McpServer({
    name: "beingdb-mcp",
    version: SERVER_VERSION,
  });

  server.registerTool(
    "beingdb_status",
    {
      title: "BeingDB status",
      description:
        "Check connectivity to the configured BeingDB instance. Returns whether it is reachable, its URL, BeingDB version, DSL/language version, environment fingerprint, and predicate count. Mainly a connectivity/debugging tool -- use `beingdb_list_predicates` for vocabulary discovery.",
      outputSchema: statusOutputSchema,
    },
    async (): Promise<CallToolResult> => {
      try {
        const status = await client.getStatus();
        return jsonResult(status);
      } catch (err) {
        return toolErrorResult(err);
      }
    }
  );

  server.registerTool(
    "beingdb_list_predicates",
    {
      title: "List BeingDB predicates",
      description:
        "Discover the connected dataset's schema before writing a query; predicate names are dataset-specific, so never invent them. With no arguments: names and arities only. With `detailed: true` (implied by `search` or `names`): per predicate, the fact `count`, `arguments` (0-based `position`, observed value `types`), `examples`, and -- only where the dataset author declared them in the BeingDB pack -- a `description` and per-argument `role` / `semanticType`. Declared descriptions and roles are authoritative schema metadata: use them to pick predicates and argument order. They are omitted, never guessed, when undeclared; then rely on `examples`. Also returns `environmentFingerprint` and `languageVersion` (refetch only when the fingerprint changes). Start broad, then narrow with `names`.",
      inputSchema: listPredicatesInputShape,
      outputSchema: listPredicatesOutputSchema,
    },
    async (args): Promise<CallToolResult> => {
      try {
        const result = await client.listPredicates(args);
        return jsonResult(result);
      } catch (err) {
        return toolErrorResult(err);
      }
    }
  );

  server.registerTool(
    "beingdb_query",
    {
      title: "Execute a BeingDB query",
      description:
        'Execute a BeingDB find/where query and return typed, structured rows. Use only predicates discovered with `beingdb_list_predicates`. Normally execute a query only once it is valid: for non-trivial generated DSL, check it first with `beingdb_diagnose_query` (or `beingdb_validate_query`). An invalid query returns `valid: false` with structured `errors` instead of rows. `total` is the number of rows the query matches (use it for "how many" questions); `hasMore: true` means more rows match than were returned (fetch them with `offset` in the query text), and `truncated: true` means the server\'s row cap cut the result: the rows are then not the complete answer, so never count or summarise them as if they were. When a query returns no rows, the response also explains why with BeingDB\'s `diagnostics` and `provablyEmpty` (and any proven `repair`), as `beingdb_diagnose_query` would: `provablyEmpty: true` means fix the query (e.g. a misspelled constant, or a comparison outside the stored values); `false` means the facts are not recorded. The exact submitted query is returned with the results and may be shown to the user for transparency.',
      inputSchema: queryInputShape,
      outputSchema: executeOutputSchema,
    },
    async (args): Promise<CallToolResult> => {
      try {
        const outcome = await client.runQuery({ query: args.query, action: "execute" });
        return buildQueryToolResult(outcome, args.query);
      } catch (err) {
        return toolErrorResult(err);
      }
    }
  );

  server.registerTool(
    "beingdb_validate_query",
    {
      title: "Validate a BeingDB query",
      description:
        "Validate a BeingDB find/where query without executing it: syntax and structure against the schema only, with no checks against the data. Returns `valid` plus structured `errors` and `warnings` (e.g. unknown_predicate with suggestions, arity_mismatch, disconnected_query, unsafe_negation), the language version and environment fingerprint. `beingdb_diagnose_query` returns the same validation plus data-aware diagnostics and proven repairs. The exact submitted query remains visible even on validation failure.",
      inputSchema: validateOrExplainInputShape,
      outputSchema: validateOutputSchema,
    },
    async (args): Promise<CallToolResult> => {
      try {
        const outcome = await client.runQuery({ query: args.query, action: "validate" });
        return buildQueryToolResult(outcome, args.query);
      } catch (err) {
        return toolErrorResult(err);
      }
    }
  );

  server.registerTool(
    "beingdb_diagnose_query",
    {
      title: "Diagnose a BeingDB DSL query",
      description:
        "Check a candidate DSL query against the actual data without executing it (BeingDB's `diagnose` action). Returns the same `valid` / `errors` / `warnings` as `beingdb_validate_query`, plus deterministic, data-grounded `diagnostics` from BeingDB (each with a `code`, `severity`, location and `evidence`) -- for example a constant that never occurs at that argument position, a join whose arguments share no value, or a variable named after a different argument's declared role. `provablyEmpty: true` means BeingDB proved the query as written returns no rows. When a constant is probably misspelled (it occurs nowhere in that predicate), its diagnostic's `evidence.suggestions` lists the closest values that do occur there, best first, as DSL literals: these are hints, not proven -- use one only if it matches the user's intent. When BeingDB can prove a correction it also returns `repair.query` (the rewritten query) and `repair.applied`: this is exact BeingDB output, not a guess, but it is never applied automatically -- run `repair.query` with `beingdb_query` (or diagnose it again) if it matches your intent. Recommended before executing non-trivial generated DSL. The exact submitted query is returned alongside the diagnosis.",
      inputSchema: diagnoseInputShape,
      outputSchema: diagnoseOutputSchema,
    },
    async (args): Promise<CallToolResult> => {
      try {
        const outcome = await client.runQuery({ query: args.query, action: "diagnose" });
        return buildQueryToolResult(outcome, args.query);
      } catch (err) {
        return toolErrorResult(err);
      }
    }
  );

  server.registerTool(
    "beingdb_explain_query",
    {
      title: "Explain a BeingDB query",
      description:
        "Explain a BeingDB DSL query without executing it: returns the structured access plan (predicate scans, index lookups, joins, filters, projection, sort) and a human-readable plan summary. Useful for debugging and for exposing how a generated symbolic query will be evaluated, especially for more complicated generated DSL. The exact submitted query is returned alongside the explanation.",
      inputSchema: validateOrExplainInputShape,
      outputSchema: explainOutputSchema,
    },
    async (args): Promise<CallToolResult> => {
      try {
        const outcome = await client.runQuery({ query: args.query, action: "explain" });
        return buildQueryToolResult(outcome, args.query);
      } catch (err) {
        return toolErrorResult(err);
      }
    }
  );

  server.registerTool(
    "beingdb_get_facts",
    {
      title: "Get all facts for a predicate",
      description:
        "Retrieve every fact for a single named predicate directly, with no joins or filtering. Useful for quick inspection, tiny relations, debugging, or export. The preferred interface for meaningful retrieval and joins is `beingdb_query` using the BeingDB DSL -- this tool has no pagination and does not support multi-predicate queries.",
      inputSchema: getFactsInputShape,
      outputSchema: getFactsOutputSchema,
    },
    async (args): Promise<CallToolResult> => {
      try {
        const result = await client.getFacts(args.predicate);
        return jsonResult(result);
      } catch (err) {
        return toolErrorResult(err);
      }
    }
  );

  server.registerResource(
    "beingdb-schema",
    "beingdb://schema",
    {
      title: "BeingDB schema",
      description:
        "The connected BeingDB instance's current query environment: version, DSL language version, environment fingerprint, and every predicate's arity, fact count, observed argument types, bounded examples and any declared description, argument roles and semantic types. Generated live from GET /predicates?detailed=true and GET /version -- refetch after the underlying dataset changes (watch environmentFingerprint).",
      mimeType: "application/json",
    },
    async (uri) => {
      const [version, predicates] = await Promise.all([client.getVersion(), client.listPredicatesDetailed({})]);
      const body = { version, ...predicates };
      return { contents: [{ uri: uri.href, mimeType: "application/json", text: JSON.stringify(body, null, 2) }] };
    }
  );

  server.registerResource(
    "beingdb-query-language",
    "beingdb://query-language",
    {
      title: "BeingDB query language reference",
      description:
        "Concise, LLM-oriented reference for BeingDB's DSL (find/where) syntax: clauses, joins, comparisons, optional/either-or/not, ordering, pagination, and literal types. Not authoritative or exhaustive -- use beingdb_list_predicates, beingdb_diagnose_query and beingdb_validate_query for ground truth against the connected instance.",
      mimeType: "text/markdown",
    },
    async (uri) => {
      return { contents: [{ uri: uri.href, mimeType: "text/markdown", text: QUERY_LANGUAGE_REFERENCE }] };
    }
  );

  return server;
}
