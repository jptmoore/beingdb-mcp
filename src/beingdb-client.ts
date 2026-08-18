/**
 * Thin REST client for BeingDB's HTTP API. This intentionally does no
 * parsing, validation, or interpretation of query text -- it forwards
 * requests to BeingDB and returns its typed JSON responses, preserving
 * BeingDB's own error shapes (see docs/api.md#error-response-shapes in
 * the BeingDB repository).
 */
import { debugLog } from "./log.js";
import type {
  BeingDbSuccessBody,
  FactsResponse,
  PredicatesDetailedResponse,
  PredicatesResponse,
  PredicatesSummaryResponse,
  QueryAction,
  QueryInvalidResult,
  QueryLanguage,
  QueryOutcome,
  VersionInfo,
} from "./types.js";
import { BeingDbError } from "./types.js";

export interface BeingDbClientOptions {
  baseUrl: string;
  timeoutMs?: number;
}

export interface ListPredicatesOptions {
  detailed?: boolean;
  search?: string;
  names?: string[];
  samples?: number;
}

export interface RunQueryOptions {
  query: string;
  language?: QueryLanguage;
  action?: QueryAction;
  offset?: number;
  limit?: number;
}

export interface BeingDbStatus {
  reachable: boolean;
  url: string;
  name?: string;
  version?: string;
  languageVersion?: string;
  environmentFingerprint?: string;
  predicateCount?: number;
  error?: string;
}

const DEFAULT_TIMEOUT_MS = 15_000;

function extractFingerprint(json: unknown): string | undefined {
  if (json && typeof json === "object" && "environmentFingerprint" in json) {
    const value = (json as { environmentFingerprint?: unknown }).environmentFingerprint;
    return typeof value === "string" ? value : undefined;
  }
  return undefined;
}

export class BeingDbClient {
  private readonly baseUrl: string;
  private readonly timeoutMs: number;

  constructor(options: BeingDbClientOptions) {
    this.baseUrl = options.baseUrl.replace(/\/+$/, "");
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  }

  /** Connectivity + version/environment summary, mainly for debugging a configured instance. */
  async getStatus(): Promise<BeingDbStatus> {
    try {
      const { status: httpStatus } = await this.requestRaw("GET", "/");
      if (httpStatus !== 200) {
        return { reachable: false, url: this.baseUrl, error: `Unexpected status from GET /: ${httpStatus}` };
      }
    } catch (err) {
      return { reachable: false, url: this.baseUrl, error: err instanceof Error ? err.message : String(err) };
    }

    const status: BeingDbStatus = { reachable: true, url: this.baseUrl };
    try {
      const version = await this.getVersion();
      status.name = version.name;
      status.version = version.version;
    } catch {
      // Reachable but /version failed -- still report reachability.
    }
    try {
      const detailed = await this.listPredicatesDetailed({});
      status.languageVersion = detailed.languageVersion;
      status.environmentFingerprint = detailed.environmentFingerprint;
      status.predicateCount = detailed.predicates.length;
    } catch {
      // Optional enrichment only.
    }
    return status;
  }

  async getVersion(): Promise<VersionInfo> {
    const { status, json } = await this.requestRaw("GET", "/version");
    if (status >= 400) throw this.toError(status, json);
    return json as VersionInfo;
  }

  async listPredicates(opts: ListPredicatesOptions = {}): Promise<PredicatesResponse> {
    const params = new URLSearchParams();
    if (opts.detailed) {
      params.set("detailed", "true");
      if (opts.search) params.set("q", opts.search);
      if (opts.names && opts.names.length > 0) params.set("names", opts.names.join(","));
    } else if (opts.samples !== undefined) {
      params.set("samples", String(opts.samples));
    }
    const query = params.toString();
    const { status, json } = await this.requestRaw("GET", `/predicates${query ? `?${query}` : ""}`);
    if (status >= 400) throw this.toError(status, json);
    return json as PredicatesResponse;
  }

  /** Convenience wrapper always returning the detailed shape (used by `beingdb_status` and the `beingdb://schema` resource). */
  async listPredicatesDetailed(opts: Omit<ListPredicatesOptions, "detailed" | "samples"> = {}): Promise<PredicatesDetailedResponse> {
    const result = await this.listPredicates({ ...opts, detailed: true });
    return result as PredicatesDetailedResponse;
  }

  async listPredicatesSummary(opts: Omit<ListPredicatesOptions, "detailed"> = {}): Promise<PredicatesSummaryResponse> {
    const result = await this.listPredicates({ ...opts, detailed: false });
    return result as PredicatesSummaryResponse;
  }

  /** `GET /query/:predicate` -- every fact for a single predicate, no joins or pagination. */
  async getFacts(predicate: string): Promise<FactsResponse> {
    const { status, json } = await this.requestRaw("GET", `/query/${encodeURIComponent(predicate)}`);
    if (status >= 400) throw this.toError(status, json);
    return json as FactsResponse;
  }

  /**
   * `POST /query` -- execute, validate or explain a query in either
   * language. Never throws for a query-invalid result or a structured
   * runtime failure (both come back as a {@link QueryOutcome}); only
   * throws {@link BeingDbError} for connection failures, timeouts, or a
   * non-JSON response.
   */
  async runQuery(opts: RunQueryOptions): Promise<QueryOutcome> {
    const language = opts.language ?? "dsl";
    const action = opts.action ?? "execute";
    const body: Record<string, unknown> = { query: opts.query, language, action };
    if (opts.offset !== undefined) body.offset = opts.offset;
    if (opts.limit !== undefined) body.limit = opts.limit;

    const startedAt = Date.now();
    const { status, json } = await this.requestRaw("POST", "/query", body);
    const elapsedMs = Date.now() - startedAt;

    const outcome = this.classifyQueryResponse(status, json);
    debugLog("query executed", {
      action,
      language,
      query: opts.query,
      status,
      elapsedMs,
      outcome: outcome.outcome,
      rowCount: outcome.outcome === "success" && "results" in outcome.body ? outcome.body.results.length : undefined,
      environmentFingerprint: extractFingerprint(json),
    });
    return outcome;
  }

  private classifyQueryResponse(status: number, json: unknown): QueryOutcome {
    if (json && typeof json === "object" && "error" in json) {
      const errorBody = (json as { error: { code: string; message: string } }).error;
      return { outcome: "transport_error", status, body: errorBody };
    }
    if (json && typeof json === "object" && (json as { valid?: unknown }).valid === false) {
      return { outcome: "invalid", status, body: json as QueryInvalidResult };
    }
    return { outcome: "success", status, body: json as BeingDbSuccessBody };
  }

  private toError(status: number, json: unknown): BeingDbError {
    if (json && typeof json === "object" && "error" in json) {
      const e = (json as { error: { code?: string; message?: string } }).error;
      return new BeingDbError(e?.message ?? `BeingDB request failed with status ${status}`, e?.code ?? "unknown_error", status, json);
    }
    return new BeingDbError(`BeingDB request failed with status ${status}`, "http_error", status, json);
  }

  private async requestRaw(method: "GET" | "POST", path: string, body?: unknown): Promise<{ status: number; json: unknown }> {
    const url = `${this.baseUrl}${path}`;
    const controller = new AbortController();
    const timeoutHandle = setTimeout(() => controller.abort(), this.timeoutMs);
    const startedAt = Date.now();
    try {
      let res: Response;
      try {
        res = await fetch(url, {
          method,
          headers: body !== undefined ? { "Content-Type": "application/json" } : undefined,
          body: body !== undefined ? JSON.stringify(body) : undefined,
          signal: controller.signal,
        });
      } catch (err) {
        if (controller.signal.aborted) {
          throw new BeingDbError(`Request to ${url} timed out after ${this.timeoutMs}ms`, "client_timeout");
        }
        throw new BeingDbError(`Failed to reach BeingDB at ${url}: ${err instanceof Error ? err.message : String(err)}`, "connection_failed");
      }

      const text = await res.text();
      let json: unknown;
      try {
        json = text.length > 0 ? JSON.parse(text) : {};
      } catch {
        throw new BeingDbError(`BeingDB returned a non-JSON response (status ${res.status}): ${text.slice(0, 200)}`, "malformed_response", res.status);
      }

      debugLog("http request", { method, path, status: res.status, elapsedMs: Date.now() - startedAt });
      return { status: res.status, json };
    } finally {
      clearTimeout(timeoutHandle);
    }
  }
}
