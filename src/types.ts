/**
 * Types mirroring BeingDB's actual REST API responses.
 *
 * These are intentionally close to the JSON BeingDB returns (see
 * ~/git/beingdb/docs/api.md and docs/query-language.md) rather than an
 * invented MCP-specific representation, per the "BeingDB owns the DSL /
 * preserve types" design goal.
 */

export type QueryLanguage = "dsl" | "core";
/** `"diagnose"` is DSL-only in BeingDB; the core language rejects it with `unknown_action`. */
export type QueryAction = "execute" | "validate" | "explain" | "diagnose";

/** A single typed BeingDB value, e.g. {"type":"atom","value":"tina_keane"}. */
export interface BeingDbTypedValue {
  type: string;
  value: string;
}

/** A projected result row: variable name -> typed value, or null if left unbound by `optional`. */
export type BeingDbBinding = Record<string, BeingDbTypedValue | null>;

export interface VersionInfo {
  name: string;
  version: string;
}

export interface PredicateSummary {
  name: string;
  arity: number;
  samples?: BeingDbTypedValue[][];
  sample_count?: number;
}

export interface PredicatesSummaryResponse {
  predicates: PredicateSummary[];
  samples_per_predicate?: number;
}

/**
 * One argument of a predicate, as serialised by BeingDB's
 * `Query_environment.to_json`. `position` is 0-based. `types` are always
 * inferred from the facts; `role` and `semanticType` come only from an
 * author declaration (`%! pred(Role:semantic_type, ...)`) in the pack and
 * are omitted -- never defaulted -- when undeclared.
 */
export interface PredicateArgumentSignature {
  position: number;
  types: string[];
  role?: string;
  semanticType?: string;
}

/** `description` is omitted by BeingDB when the predicate has no declared description. */
export interface PredicateDetailed {
  name: string;
  arity: number;
  count: number;
  description?: string;
  arguments: PredicateArgumentSignature[];
  examples: BeingDbTypedValue[][];
}

export interface PredicatesDetailedResponse {
  predicates: PredicateDetailed[];
  environmentFingerprint: string;
  languageVersion: string;
}

export type PredicatesResponse = PredicatesSummaryResponse | PredicatesDetailedResponse;

export interface FactsResponse {
  predicate: string;
  facts: BeingDbTypedValue[][];
  count?: number;
  limited?: boolean;
  max_results?: number;
}

/** A structured, query-invalid error (unknown_predicate, arity_mismatch, ...). */
export interface BeingDbValidationError {
  code: string;
  message: string;
  line?: number;
  column?: number;
  predicate?: string;
  suggestions?: string[];
  groups?: string[][];
  leftType?: string;
  rightType?: string;
  suggestion?: string;
  [key: string]: unknown;
}

export interface BeingDbValidationWarning {
  code: string;
  message: string;
  [key: string]: unknown;
}

export interface BeingDbPlanOperation {
  operation: string;
  [key: string]: unknown;
}

/**
 * Successful `action: "execute"` response. BeingDB includes `language`,
 * `languageVersion` and `environmentFingerprint` here too (not just on
 * validate/explain), so a client can cache schema knowledge from ordinary
 * query responses alone, without a separate `/predicates` round trip.
 */
export interface QueryExecuteSuccess {
  variables: string[];
  results: BeingDbBinding[];
  count: number;
  total?: number;
  offset?: number;
  limit?: number;
  warnings?: BeingDbValidationWarning[];
  language: QueryLanguage;
  languageVersion: string;
  environmentFingerprint: string;
}

/** Successful `action: "validate"` or `action: "explain"` response (`valid: true`). */
export interface QueryValidateOrExplainSuccess {
  valid: true;
  errors: [];
  warnings: BeingDbValidationWarning[];
  language: QueryLanguage;
  languageVersion: string;
  environmentFingerprint: string;
  variables?: string[];
  projection?: string[];
  distinct?: boolean;
  normalizedCoreQuery?: { patterns: string[]; comparisons: string[] };
  plan?: BeingDbPlanOperation[];
  planText?: string;
}

/**
 * A repair BeingDB has proven (`Query_diagnostics.repair_to_json`), e.g.
 * `{"kind":"swap_arguments","predicate":"created","line":3,"positions":[0,1]}`
 * or `{"kind":"replace_variable",...,"argumentPosition":1,"variable":"X","value":{...}}`.
 */
export interface BeingDbRepairStep {
  kind: string;
  predicate?: string;
  line?: number;
  positions?: number[];
  argumentPosition?: number;
  variable?: string;
  value?: BeingDbTypedValue;
  [key: string]: unknown;
}

/** One data-aware diagnostic (`Query_diagnostics.to_json`); optional fields are omitted when unknown. */
export interface BeingDbDiagnostic {
  code: string;
  severity: string;
  message: string;
  line?: number;
  predicate?: string;
  argumentPosition?: number;
  variable?: string;
  value?: BeingDbTypedValue;
  scope?: string;
  evidence?: Record<string, unknown>;
  repair?: BeingDbRepairStep;
  [key: string]: unknown;
}

/**
 * `action: "diagnose"` response (DSL only). Always HTTP 200: `valid`,
 * `errors` and `warnings` exactly as `validate` reports them, plus
 * `diagnostics`, `provablyEmpty` and -- only when BeingDB proves one and
 * it re-parses cleanly -- `repair`.
 */
export interface QueryDiagnoseResult {
  valid: boolean;
  errors: BeingDbValidationError[];
  warnings: BeingDbValidationWarning[];
  diagnostics: BeingDbDiagnostic[];
  provablyEmpty: boolean;
  repair?: { query: string; applied: BeingDbRepairStep[] };
  language: QueryLanguage;
  languageVersion: string;
  environmentFingerprint: string;
}

export type BeingDbSuccessBody = QueryExecuteSuccess | QueryValidateOrExplainSuccess | QueryDiagnoseResult;

/** A well-formed request whose *query* is invalid (`valid: false`), for any action/language. */
export interface QueryInvalidResult {
  valid: false;
  errors: BeingDbValidationError[];
  warnings: BeingDbValidationWarning[];
  language: QueryLanguage;
  languageVersion?: string;
  environmentFingerprint?: string;
}

/** A transport/runtime failure unrelated to query validity (malformed request, timeout, ...). */
export interface BeingDbErrorBody {
  code: string;
  message: string;
}

/** Outcome of a `POST /query` call, discriminated by BeingDB's own response shape. */
export type QueryOutcome =
  | { outcome: "success"; status: number; body: BeingDbSuccessBody }
  | { outcome: "invalid"; status: number; body: QueryInvalidResult }
  | { outcome: "transport_error"; status?: number; body: BeingDbErrorBody };

/** Raised for connection failures, timeouts, malformed JSON, or plain HTTP errors -- never for query-invalid results (see {@link QueryOutcome}). */
export class BeingDbError extends Error {
  readonly code: string;
  readonly status?: number;
  readonly body?: unknown;

  constructor(message: string, code: string, status?: number, body?: unknown) {
    super(message);
    this.name = "BeingDbError";
    this.code = code;
    this.status = status;
    this.body = body;
  }
}
