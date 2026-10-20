# Tools

`beingdb-mcp` is an adapter: each tool forwards to one BeingDB HTTP endpoint and
returns BeingDB's JSON unchanged. Schema metadata, validation, diagnostics and
repairs all come from BeingDB; the MCP server never derives or rewrites them.

| Tool | BeingDB API | Use it to |
|---|---|---|
| `beingdb_list_predicates` | `GET /predicates` | Discover the schema. With `detailed: true` (implied by `names`/`search`): arity, fact count, per-argument observed types, examples, and any declared `description` and argument `role`/`semanticType`, plus `environmentFingerprint` and `languageVersion` |
| `beingdb_diagnose_query` | `POST /query` (`dsl`, `diagnose`) | Check a candidate DSL query against the data: validation, `diagnostics`, `provablyEmpty` and any proven `repair` |
| `beingdb_validate_query` | `POST /query` (`validate`) | Structural validation only (DSL or core) |
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

`provablyEmpty: true` (some diagnostic has severity `error`) means the query as
written cannot return rows. When BeingDB can prove a correction it also returns
`repair.query` (the rewritten query) and `repair.applied` (the steps, such as
`swap_arguments`). This is exact BeingDB output, not a suggestion, but
`beingdb-mcp` never applies it: the client decides whether to run `repair.query`.

`beingdb_diagnose_query` needs a BeingDB with the `diagnose` action; older servers
return an `unknown_action` tool error.
