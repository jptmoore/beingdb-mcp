# Tools

`beingdb-mcp` is an adapter: each tool forwards to one BeingDB HTTP endpoint and
returns BeingDB's JSON unchanged. Schema metadata, validation, diagnostics and
repairs all come from BeingDB; the MCP server never derives or rewrites them.

| Tool | BeingDB API | Use it to |
|---|---|---|
| `beingdb_list_predicates` | `GET /predicates` | Discover the schema. With `detailed: true` (implied by `names`/`search`): arity, fact count, per-argument observed types, examples, and any declared `description` and argument `role`/`semanticType`, plus `environmentFingerprint` and `languageVersion` |
| `beingdb_diagnose_query` | `POST /query` (`dsl`, `diagnose`) | Check a candidate DSL query against the data: validation, `diagnostics`, `provablyEmpty` and any proven `repair` |
| `beingdb_validate_query` | `POST /query` (`validate`) | Structural validation only |
| `beingdb_explain_query` | `POST /query` (`explain`) | Show the access plan |
| `beingdb_query` | `POST /query` (`execute`) | Run a query and get typed rows |
| `beingdb_get_facts` | `GET /query/:predicate` | Dump one predicate's facts |
| `beingdb_status` | `GET /`, `GET /version` | Check connectivity and versions |

Resources: `beingdb://schema` (the live detailed schema plus BeingDB version) and
`beingdb://query-language` (a short DSL reference).

## Outputs

Every tool returns BeingDB's JSON both as MCP structured content, described by the
tool's output schema, and as the same JSON in text form. Query tools add the exact
`query` submitted, so it can be shown to the user. Output schemas accept extra
fields, so anything newer BeingDB versions add is passed through.

A query that is invalid (`valid: false`, with structured `errors`) is a normal
result, not a tool error. Tool errors (`isError: true`) are reserved for
connection failures, timeouts and BeingDB rejecting the request.

## Recommended workflow

```
beingdb_list_predicates {detailed: true}  -> pick predicates by description and argument roles
  -> write a DSL query
  -> beingdb_diagnose_query               -> read diagnostics; optionally take repair.query
  -> beingdb_query                        -> typed rows
```

## Schema metadata

With `detailed: true`, each predicate has `name`, `arity`, `count`, `examples` and
`arguments[]` with a 0-based `position` and the value `types` observed in the facts.

Predicate descriptions, argument roles and semantic types are written by the
dataset author as `%!` declarations in the BeingDB pack, for example
`%! created_by(Work:work, Artist:person)`. They appear as `description`,
`arguments[].role` and `arguments[].semanticType`, and are omitted, not guessed, for
undeclared predicates. See BeingDB's
[predicate declarations](https://github.com/jptmoore/beingdb/blob/main/docs/query-language.md#predicate-declarations-optional).

`environmentFingerprint` is a hash of the schema, declarations and DSL
`languageVersion`; it changes whenever they do, so cached schema knowledge can be
refreshed only when needed. Every query response carries it too.

## Diagnostics and repairs

`beingdb_diagnose_query` (DSL only) returns the same `valid`/`errors`/`warnings` as
`beingdb_validate_query`, plus BeingDB's data-aware `diagnostics`. Each has a `code`,
a `severity`, a `message` and, where known, the `line`, `predicate`,
`argumentPosition`, `variable`, `value`, `scope` and `evidence`. Codes include, for
example, a constant that never occurs at that argument position, a join whose
arguments share no value, or a variable named after a different argument's declared
role. The full list is in BeingDB's
[diagnose documentation](https://github.com/jptmoore/beingdb/blob/main/docs/api.md#diagnose-dsl).

When a constant occurs nowhere in its predicate (most often a misspelling), its
diagnostic carries `evidence.suggestions`: up to five values of the same type that do
occur at that argument, ranked by BeingDB, best first, and written as DSL literals.
The message ends with `Did you mean <best>?`. For example,
`created(Artist, work_aa)` gives `"suggestions": ["work_a", "work_b"]`. Suggestions
are hints, not proofs: the LLM should use one only if it matches the question.

`provablyEmpty: true` (some diagnostic has severity `error`) means the query as
written cannot return rows. When BeingDB can prove a correction it also returns
`repair.query` (the rewritten query) and `repair.applied` (the steps, such as
`swap_arguments`). This is exact BeingDB output, not a suggestion, but
`beingdb-mcp` never applies it: the client decides whether to run `repair.query`.

`beingdb_diagnose_query` needs a BeingDB with the `diagnose` action; older servers
return an `unknown_action` tool error. `evidence.suggestions` needs BeingDB 0.1.5 or
later; older servers simply omit it.

## Complete and incomplete results

BeingDB has one query language, the `find`/`where` DSL, so every query tool takes
just the query text; paging is `limit N` / `offset N` in that text. `beingdb_query`
results carry a count and two flags from BeingDB:

- `total`: how many result rows the query matches, regardless of `limit`, `offset`
  or the server's row cap. Rows can repeat a value through joins, so for "how many"
  questions prefer `count(Var)` (below).
- `hasMore: true`: more rows match than were returned, because the query's own
  `limit` or the server's row cap stopped it. Fetch the next page with `offset N`
  in the query text.
- `truncated: true`: the server's `max_results` cap, not the query's `limit`, cut
  the result, and a `results_truncated` warning is added. The rows are not the
  complete answer, so an LLM must not count or summarise them as if they were.

`hasMore` and `truncated` need BeingDB 0.1.5 or later and `total` needs 0.2.0;
older servers omit them.

## Counting

From BeingDB 0.3.0 a query can count: `count(Var)` in `find` counts the distinct
values of `Var`, grouped by the other `find` variables.

```
find Artist, count(Work)
where
  created_by(Work, Artist)
order by count(Work) descending
limit 5
```

Each row has the group's values and a `count(Work)` column of type `integer`;
`find count(Work) where ...` returns one row. A count of 0 because nothing matched
carries the same `diagnostics` and `provablyEmpty` as an empty result, so a
misspelled name is reported rather than answered as "0". Misuse, such as counting a
variable that is also a `find` column, is rejected with `invalid_count`.

## Empty results

When a DSL query's first page has no rows, `beingdb_query` also returns BeingDB's
explanation: the same `diagnostics`, `provablyEmpty` and any proven `repair` that
`beingdb_diagnose_query` gives, so no second call is needed. For example,
`created(Artist, work_aa)` comes back with an `unknown_constant` diagnostic
suggesting `work_a`, and `Y > @2090` on years stored from 1968 to 2004 comes back
with `unsatisfiable_comparison` and `evidence.observedRange`.

- `provablyEmpty: true`: the query as written cannot match; fix it rather than
  concluding the fact is missing.
- `provablyEmpty: false`: BeingDB found no fault in the query; the facts are not
  recorded.

This needs BeingDB 0.1.7 or later; older servers return the empty rows only.
