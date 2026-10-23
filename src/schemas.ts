/**
 * Zod shapes for MCP tools. Each export is a `ZodRawShape` (a plain
 * object of field schemas), which is what `McpServer#registerTool` expects
 * for `inputSchema` / `outputSchema` -- not a `z.object(...)`.
 *
 * Output shapes describe BeingDB's own JSON (plus the MCP-added `query`
 * echo on query tools). Every object is `.passthrough()` so a field
 * BeingDB adds later is forwarded rather than stripped or rejected, and
 * BeingDB's optional fields (declared descriptions, roles, semantic types,
 * repairs, ...) are optional here too: MCP never fills them in.
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
      "Return full schema detail: per-argument observed types, fact counts, bounded typed examples, any author-declared description / argument roles / semantic types, plus the environment fingerprint and language version. Implied by `search` or `names`. Mutually exclusive with `samples`."
    ),
  search: z
    .string()
    .optional()
    .describe("Case-insensitive substring filter on predicate name. Implies `detailed: true`."),
  names: z
    .array(z.string())
    .optional()
    .describe("Filter to this exact set of predicate names. Implies `detailed: true`. Use this to inspect a handful of predicates in detail once discovered."),
  samples: z
    .number()
    .int()
    .positive()
    .max(1000)
    .optional()
    .describe("Include up to N sample facts per predicate. Ignored when `detailed` is true (or implied)."),
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

export const diagnoseInputShape = {
  query: z.string().min(1).describe("The candidate BeingDB DSL query (`find`/`where` syntax). Diagnosis is DSL-only."),
};

export const getFactsInputShape = {
  predicate: z.string().min(1).describe("Exact predicate name, as returned by `beingdb_list_predicates` (e.g. \"created\")."),
};

// ---- Output shapes (BeingDB's canonical JSON) ----

const typedValue = z
  .object({ type: z.string(), value: z.string() })
  .passthrough()
  .describe('A typed BeingDB value, e.g. {"type":"atom","value":"kevin_atherton"} or {"type":"year","value":"1975"}.');

const fact = z.array(typedValue);

const predicateArgument = z
  .object({
    position: z.number().int().describe("0-based argument position."),
    types: z.array(z.string()).optional().describe("Value types observed in the facts at this position."),
    role: z.string().optional().describe("Author-declared argument role from the pack (e.g. \"Work\"). Absent when not declared."),
    semanticType: z.string().optional().describe("Author-declared semantic type label (e.g. \"person\"). Absent when not declared; not checked against the facts."),
  })
  .passthrough();

const predicate = z
  .object({
    name: z.string(),
    arity: z.number().int(),
    count: z.number().int().optional().describe("Number of facts (detailed mode)."),
    description: z.string().optional().describe("Author-declared description from the pack. Absent when not declared."),
    arguments: z.array(predicateArgument).optional().describe("Per-argument signature (detailed mode)."),
    examples: z.array(fact).optional().describe("Up to a few stored facts (detailed mode)."),
    samples: z.array(fact).optional().describe("Sample facts (`samples` mode)."),
    sample_count: z.number().int().optional(),
  })
  .passthrough();

const environmentFields = {
  languageVersion: z.string().optional().describe("BeingDB DSL language version, e.g. \"beingdb-dsl/1\"."),
  environmentFingerprint: z
    .string()
    .optional()
    .describe("Deterministic hash of the dataset schema (names, arities, types, declarations) and language version; changes invalidate cached schema knowledge."),
};

const listPredicatesOutputShape = {
  predicates: z.array(predicate),
  samples_per_predicate: z.number().int().optional(),
  ...environmentFields,
};

const validationError = z
  .object({ code: z.string(), message: z.string() })
  .passthrough()
  .describe("Structured validation error (e.g. unknown_predicate, arity_mismatch) with BeingDB's code-specific fields.");

const validationWarning = z.object({ code: z.string(), message: z.string() }).passthrough();

const repairStep = z
  .object({
    kind: z.string().describe("Repair kind proven by BeingDB, e.g. \"swap_arguments\" or \"replace_variable\"."),
    predicate: z.string().optional(),
    line: z.number().int().optional(),
    positions: z.array(z.number().int()).optional(),
    argumentPosition: z.number().int().optional(),
    variable: z.string().optional(),
    value: typedValue.optional(),
  })
  .passthrough();

const diagnosticEvidence = z
  .object({
    suggestions: z
      .array(z.string())
      .optional()
      .describe(
        "On unknown_constant / constant_not_at_position, when the literal occurs nowhere in that predicate: values of the same type that do occur at that argument, ranked by BeingDB as likely corrections (best first), written as DSL literals ready to paste. Hints, not proven repairs -- pick one only if it matches the user's intent."
      ),
  })
  .passthrough()
  .describe("Data-grounded evidence computed by BeingDB (e.g. occursAtPositions, occursIn, declaredRole, suggestions).");

const diagnostic = z
  .object({
    code: z.string().describe("BeingDB diagnostic code, e.g. constant_not_at_position, singleton_variable."),
    severity: z.string().describe("\"error\" means the query as written provably returns no rows; \"warning\"/\"info\" do not."),
    message: z.string(),
    line: z.number().int().optional(),
    predicate: z.string().optional(),
    argumentPosition: z.number().int().optional(),
    variable: z.string().optional(),
    value: typedValue.optional(),
    scope: z.string().optional().describe("positive | optional | alternative | negated."),
    evidence: diagnosticEvidence.optional(),
    repair: repairStep.optional(),
  })
  .passthrough();

const provenRepair = z
  .object({
    query: z.string().describe("The original query with only the repaired lines rewritten; re-parsed by BeingDB."),
    applied: z.array(repairStep),
  })
  .passthrough()
  .describe("Present only when BeingDB proves a repair. Deterministic BeingDB output, not a suggestion; never applied automatically.");

const queryEcho = {
  query: z.string().describe("The exact query text submitted (added by beingdb-mcp for transparency)."),
  language: z.string().optional(),
  ...environmentFields,
};

const validityFields = {
  valid: z.boolean().optional(),
  errors: z.array(validationError).optional(),
  warnings: z.array(validationWarning).optional(),
};

const executeOutputShape = {
  ...queryEcho,
  ...validityFields,
  variables: z.array(z.string()).optional(),
  results: z.array(z.record(typedValue.nullable())).optional().describe("Rows: variable -> typed value, or null when left unbound by `optional`."),
  count: z.number().int().optional(),
  total: z.number().int().optional(),
  offset: z.number().int().optional(),
  limit: z.number().int().optional(),
  hasMore: z
    .boolean()
    .optional()
    .describe("DSL only: true when more rows match beyond those returned (stopped by the query's own `limit` or by the server's cap). Fetch the next page with `offset` in the query text."),
  truncated: z
    .boolean()
    .optional()
    .describe(
      "DSL only: true when the server's max_results cap -- not the query's own `limit` -- cut the result (a `results_truncated` warning is added). The rows are then NOT the complete answer: do not count or summarise them as if they were; page with `offset` or narrow the query."
    ),
  diagnostics: z
    .array(diagnostic)
    .optional()
    .describe(
      "DSL only, and only when the first page is empty: BeingDB's data-aware explanation of why (same as `beingdb_diagnose_query`), e.g. a misspelled constant with `evidence.suggestions`, or a comparison no stored value satisfies with `evidence.observedRange`."
    ),
  provablyEmpty: z
    .boolean()
    .optional()
    .describe(
      "DSL only, with `diagnostics` on an empty result. true: the query as written cannot match, so fix it rather than concluding the fact is missing. false: BeingDB found no fault in the query; the facts are simply not recorded."
    ),
  repair: provenRepair.optional(),
};

const validateOutputShape = {
  ...queryEcho,
  ...validityFields,
  variables: z.array(z.string()).optional(),
  projection: z.array(z.string()).optional(),
  distinct: z.boolean().optional(),
};

const explainOutputShape = {
  ...validateOutputShape,
  normalizedCoreQuery: z.unknown().optional(),
  plan: z.array(z.unknown()).optional(),
  planText: z.string().optional(),
};

const diagnoseOutputShape = {
  ...queryEcho,
  valid: z.boolean().describe("Same validity as `beingdb_validate_query`; diagnostics never change it."),
  errors: z.array(validationError).optional(),
  warnings: z.array(validationWarning).optional(),
  diagnostics: z.array(diagnostic).describe("Deterministic, data-aware findings from BeingDB, in source-line order."),
  provablyEmpty: z.boolean().describe("True when some diagnostic proves the query as written returns no rows."),
  repair: provenRepair.optional(),
};

const getFactsOutputShape = {
  predicate: z.string(),
  facts: z.array(fact),
  count: z.number().int().optional(),
  limited: z.boolean().optional(),
  max_results: z.number().int().optional(),
};

const statusOutputShape = {
  reachable: z.boolean(),
  url: z.string(),
  name: z.string().optional(),
  version: z.string().optional().describe("BeingDB server version."),
  predicateCount: z.number().int().optional(),
  error: z.string().optional(),
  ...environmentFields,
};

const outputSchema = <T extends z.ZodRawShape>(shape: T) => z.object(shape).passthrough();

export const listPredicatesOutputSchema = outputSchema(listPredicatesOutputShape);
export const executeOutputSchema = outputSchema(executeOutputShape);
export const validateOutputSchema = outputSchema(validateOutputShape);
export const explainOutputSchema = outputSchema(explainOutputShape);
export const diagnoseOutputSchema = outputSchema(diagnoseOutputShape);
export const getFactsOutputSchema = outputSchema(getFactsOutputShape);
export const statusOutputSchema = outputSchema(statusOutputShape);
