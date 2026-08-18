/**
 * Zod input shapes for MCP tools. Each export is a `ZodRawShape` (a plain
 * object of field schemas), which is what `McpServer#registerTool` expects
 * for `inputSchema` -- not a `z.object(...)`.
 */
import { z } from "zod";

export const queryLanguageSchema = z
  .enum(["dsl", "core"])
  .describe(
    "Query language: \"dsl\" (the expressive find/where language -- preferred) or \"core\" (the low-level pattern language). Defaults to \"dsl\"."
  );

export const listPredicatesInputShape = {
  detailed: z
    .boolean()
    .optional()
    .describe(
      "Return full schema detail: per-argument observed types, fact counts, bounded typed examples, and the environment fingerprint. Mutually exclusive with `samples`."
    ),
  search: z
    .string()
    .optional()
    .describe("Case-insensitive substring filter on predicate name. Only applies when `detailed` is true."),
  names: z
    .array(z.string())
    .optional()
    .describe("Filter to this exact set of predicate names. Only applies when `detailed` is true. Use this to inspect a handful of predicates in detail once discovered."),
  samples: z
    .number()
    .int()
    .positive()
    .max(1000)
    .optional()
    .describe("Include up to N sample facts per predicate. Ignored when `detailed` is true."),
};

export const queryInputShape = {
  query: z.string().min(1).describe("The BeingDB query text (DSL `find`/`where` syntax by default, or core-language patterns if `language: \"core\"`)."),
  language: queryLanguageSchema.default("dsl"),
  offset: z
    .number()
    .int()
    .min(0)
    .optional()
    .describe("Pagination offset (core language only; for the DSL use `offset N` inside the query text)."),
  limit: z
    .number()
    .int()
    .positive()
    .optional()
    .describe("Maximum results to return (core language only; for the DSL use `limit N` inside the query text)."),
};

export const validateOrExplainInputShape = {
  query: z.string().min(1).describe("The BeingDB query text to check (DSL `find`/`where` syntax by default, or core-language patterns if `language: \"core\"`)."),
  language: queryLanguageSchema.default("dsl"),
};

export const getFactsInputShape = {
  predicate: z.string().min(1).describe("Exact predicate name, as returned by `beingdb_list_predicates` (e.g. \"created\")."),
};
