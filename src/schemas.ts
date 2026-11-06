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

const queryText = z
  .string()
  .min(1)
  .describe("A BeingDB find/where query: a `find` line, a `where` line, then one pattern or comparison per line; optional `order by`, `limit N`, `offset N` lines.");

export const queryInputShape = {
  query: queryText,
};

export const validateOrExplainInputShape = {
  query: queryText,
};

export const diagnoseInputShape = {
  query: queryText,
};

export const resolveInputShape = {
  text: z
    .string()
    .min(1)
    .max(2000)
    .describe("Free text that names things, e.g. the user's question: \"What did judith godard make at Oval House?\"."),
  candidates: z.number().int().min(1).max(50).optional().describe("Candidates returned per mention (default 10)."),
};

export const aboutInputShape = {
  value: z
    .string()
    .min(1)
    .describe('One value in DSL literal syntax, usually a `literal` from `beingdb_resolve`: an atom `kevin_atherton`, a string `"Work A"`, a year `@1978`.'),
  limit: z.number().int().min(1).max(100).optional().describe("Facts returned per predicate group (default 20)."),
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
  count: z.number().int().optional().describe("Rows returned in this response."),
  total: z
    .number()
    .int()
    .optional()
    .describe("Result rows the query matches in total, regardless of `limit`, `offset` or the server's cap (for a count(...) query, the number of groups). Rows can repeat a value through joins; to count distinct things use count(Var) in `find`."),
  hasMore: z
    .boolean()
    .optional()
    .describe("True when more rows match beyond those returned (stopped by the query's own `limit` or by the server's cap). Fetch the next page with `offset` in the query text."),
  truncated: z
    .boolean()
    .optional()
    .describe(
      "True when the server's max_results cap -- not the query's own `limit` -- cut the result (a `results_truncated` warning is added). The rows are then NOT the complete answer: do not count or summarise them as if they were; page with `offset` or narrow the query."
    ),
  diagnostics: z
    .array(diagnostic)
    .optional()
    .describe(
      "Only when the first page is empty: BeingDB's data-aware explanation of why (same as `beingdb_diagnose_query`), e.g. a misspelled constant with `evidence.suggestions`, or a comparison no stored value satisfies with `evidence.observedRange`."
    ),
  provablyEmpty: z
    .boolean()
    .optional()
    .describe(
      "With `diagnostics` on an empty result. true: the query as written cannot match, so fix it rather than concluding the fact is missing. false: BeingDB found no fault in the query; the facts are simply not recorded."
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

const occurrence = z
  .object({
    predicate: z.string(),
    position: z.number().int().describe("0-based argument position."),
    role: z.string().optional().describe("Declared role of that argument, when the dataset declares one."),
    semanticType: z.string().optional(),
  })
  .passthrough();

const resolveCandidate = z
  .object({
    value: typedValue,
    literal: z.string().describe("The value in DSL literal syntax, ready to use as a constant in a query."),
    matchedName: z.string().describe("The name that matched: the value's own text, a label or an alias."),
    match: z.string().describe("exact | label | alias | fuzzy | partial."),
    label: z.string().optional().describe("The value's display label, when the dataset gives one."),
    facts: z.number().int().describe("How many facts mention the value (label/alias facts excluded)."),
    occurs: z.array(occurrence).describe("Every predicate argument holding the value."),
  })
  .passthrough();

const resolveOutputShape = {
  text: z.string(),
  mentions: z
    .array(
      z
        .object({
          text: z.string().describe("The matched part of the text."),
          start: z.number().int().describe("Byte offset of the mention in the text."),
          end: z.number().int(),
          match: z.string().describe("Best match kind among the candidates."),
          candidateCount: z.number().int().describe("All candidates; more than one means the text is ambiguous."),
          candidates: z.array(resolveCandidate),
        })
        .passthrough()
    )
    .describe("Mentions in text order. A name with no mention was not found in the data."),
  ...environmentFields,
};

const aboutOutputShape = {
  value: typedValue,
  literal: z.string(),
  label: z.string().optional(),
  aliases: z.array(z.string()),
  facts: z.number().int().describe("Distinct facts the value occurs in; 0 when it occurs nowhere."),
  predicates: z.array(
    z
      .object({
        predicate: z.string(),
        position: z.number().int().describe("The value's 0-based argument position in these facts."),
        description: z.string().optional(),
        roles: z.array(z.string()).nullable().describe("Declared argument roles, or null when not all declared."),
        count: z.number().int(),
        facts: z.array(fact),
        hasMore: z.boolean().describe("More facts than `limit` in this group."),
      })
      .passthrough()
  ),
  ...environmentFields,
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
export const resolveOutputSchema = outputSchema(resolveOutputShape);
export const aboutOutputSchema = outputSchema(aboutOutputShape);
