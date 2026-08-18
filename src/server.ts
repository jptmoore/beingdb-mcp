/**
 * MCP server wiring: registers tools and resources on top of a
 * {@link BeingDbClient}. The MCP layer stays deliberately thin -- it does
 * not parse, validate, or reinterpret BeingDB query text; it forwards it
 * and returns BeingDB's own structured JSON, always alongside the exact
 * query text submitted (see the "transparency is first-class" design
 * goal).
 */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";

import type { BeingDbClient } from "./beingdb-client.js";
import { BeingDbError } from "./types.js";
import type { QueryLanguage, QueryOutcome } from "./types.js";
import {
  getFactsInputShape,
  listPredicatesInputShape,
  queryInputShape,
  validateOrExplainInputShape,
} from "./schemas.js";
import { QUERY_LANGUAGE_REFERENCE } from "./query-language-reference.js";

function jsonResult(body: unknown, isError = false): CallToolResult {
  return { content: [{ type: "text", text: JSON.stringify(body, null, 2) }], isError };
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
function buildQueryToolResult(outcome: QueryOutcome, query: string, language: QueryLanguage): CallToolResult {
  if (outcome.outcome === "transport_error") {
    return jsonResult({ query, language, error: outcome.body }, true);
  }
  // outcome.body already carries its own authoritative `language` (BeingDB
  // echoes it on every success/invalid response); `query` never comes from
  // BeingDB, so it always needs adding here.
  return jsonResult({ query, ...outcome.body }, false);
}

export function createBeingDbMcpServer(client: BeingDbClient): McpServer {
  const server = new McpServer({
    name: "beingdb-mcp",
    version: "0.1.0",
  });

  server.registerTool(
    "beingdb_status",
    {
      title: "BeingDB status",
      description:
        "Check connectivity to the configured BeingDB instance. Returns whether it is reachable, its URL, BeingDB version, DSL/language version, environment fingerprint, and predicate count. Mainly a connectivity/debugging tool -- use `beingdb_list_predicates` for vocabulary discovery.",
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
        "Inspect the dataset-specific vocabulary of the connected BeingDB instance: predicate names, arities, observed argument types, fact counts, bounded example facts, and the environment fingerprint. Predicate names are dataset-specific -- inspect this tool before constructing queries against an unfamiliar BeingDB instance, and do not invent predicates. Start broad (no arguments, or `detailed: true`) to discover the vocabulary, then narrow with `names` to inspect a handful of predicates in more detail once you know which ones matter.",
      inputSchema: listPredicatesInputShape,
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
        'Execute a BeingDB query. Prefer the expressive BeingDB DSL (language: "dsl", the default). Before querying an unfamiliar BeingDB database, inspect its predicates using `beingdb_list_predicates`. Do not invent predicate names. Use `beingdb_validate_query` when uncertain about syntax, predicate arity, argument types or variable binding. The exact submitted query is returned with the results and may be shown to the user for transparency.',
      inputSchema: queryInputShape,
    },
    async (args): Promise<CallToolResult> => {
      try {
        const outcome = await client.runQuery({ ...args, action: "execute" });
        return buildQueryToolResult(outcome, args.query, args.language);
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
        "Validate a generated BeingDB DSL query without executing it. Use this when constructing non-trivial joins, optional clauses, negation, ordering or other expressive DSL features. Returns structured errors and warnings (e.g. unknown_predicate, arity_mismatch, disconnected_query, unsafe_negation) plus the language version and environment fingerprint. The exact submitted query remains visible even on validation failure.",
      inputSchema: validateOrExplainInputShape,
    },
    async (args): Promise<CallToolResult> => {
      try {
        const outcome = await client.runQuery({ ...args, action: "validate" });
        return buildQueryToolResult(outcome, args.query, args.language);
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
    },
    async (args): Promise<CallToolResult> => {
      try {
        const outcome = await client.runQuery({ ...args, action: "explain" });
        return buildQueryToolResult(outcome, args.query, args.language);
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
        "The connected BeingDB instance's current query environment: version, DSL language version, environment fingerprint, and every predicate's arity, fact count, observed argument types and bounded examples. Generated live from GET /predicates?detailed=true and GET /version -- refetch after the underlying dataset changes (watch environmentFingerprint).",
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
        "Concise, LLM-oriented reference for BeingDB's DSL (find/where) syntax: clauses, joins, comparisons, optional/either-or/not, ordering, pagination, and literal types. Not authoritative or exhaustive -- use beingdb_validate_query and beingdb_explain_query for ground truth against the connected instance.",
      mimeType: "text/markdown",
    },
    async (uri) => {
      return { contents: [{ uri: uri.href, mimeType: "text/markdown", text: QUERY_LANGUAGE_REFERENCE }] };
    }
  );

  return server;
}
