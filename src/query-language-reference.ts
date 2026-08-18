/**
 * Concise, LLM-oriented reference for BeingDB's expressive query
 * language, served as the `beingdb://query-language` MCP resource.
 *
 * Deliberately short and not authoritative -- it summarizes syntax
 * documented in ~/git/beingdb/docs/query-language.md at the time this
 * file was written. Always confirm against a live instance with
 * `beingdb_validate_query` / `beingdb_explain_query`, since predicates,
 * arities and argument types are dataset-specific and the DSL itself may
 * evolve.
 */
export const QUERY_LANGUAGE_REFERENCE = `# BeingDB DSL quick reference

The DSL is a line-oriented \`find\`/\`where\` query language. It reuses the
same predicate patterns and comparisons as BeingDB's core language, plus
projection, optional matches, disjunction, negation, ordering,
deduplication and pagination.

\`\`\`
find [distinct] Var, Var, ...
where
  <clause>
  <clause>
  optional
    <clause>*
  either
    <clause>*
  or
    <clause>*
  not
    <clause>*
order by Var [ascending|descending], ...
limit N
offset N
\`\`\`

- \`find\` lists the variables to project, in order. \`distinct\` deduplicates rows.
- \`where\` lists clauses: predicate patterns (\`created(Artist, Work)\`), comparisons
  (\`Year >= 1970\`, \`Date between @2019-01-01 and @2019-12-31\`), or \`_\` wildcards.
- \`optional\` is a left join -- variables only bound inside it come back as \`null\`
  in the JSON result when unmatched, but the row is never dropped.
- \`either\` / \`or\` is disjunction: at least one branch must match (a union, not a join).
- \`not\` is negation-as-failure: keeps the row only if the nested clauses produce
  no matches. Every variable used inside \`not\` must also be bound elsewhere by a
  positive clause (otherwise: \`unsafe_negation\`).
- A query's patterns must form a single connected component (joined by a shared
  variable, constant, or comparison) or it is rejected as \`disconnected_query\`.
- \`order by\` / \`limit\` / \`offset\` apply to the final projected result set.
- Blank lines and lines starting with \`%\` or \`#\` are ignored.

## Literal types

| Type | Syntax | Example |
|---|---|---|
| Atom | bare lowercase identifier | \`tina_keane\` |
| String | double-quoted | \`"Alice Smith"\` |
| Language-tagged string | double-quoted + \`@tag\` | \`"Alice Smith"@en\` |
| Integer | optional \`-\`, digits | \`1972\`, \`-42\` |
| Decimal | digits \`.\` digits | \`0.92\` |
| Boolean | \`true\` / \`false\` | \`true\` |
| Year | \`@YYYY\` | \`@1972\` |
| Year-month | \`@YYYY-MM\` | \`@1972-05\` |
| Date | \`@YYYY-MM-DD\` | \`@1972-05-14\` |
| Instant | \`@YYYY-MM-DDTHH:MM:SS[.fff](Z\\|±HH:MM)\` | \`@2026-08-06T12:15:00Z\` |
| URI | \`<...>\` | \`<https://example.org/>\` |

\`1979\` (integer), \`@1979\` (year), \`"1979"\` (string) and \`year_1979\` (atom) are four
distinct values/types and are never equal to each other. Variables bind to a
single typed value; \`_\` matches anything without binding.

## Comparisons

\`= != < <= > >= between ... and ...\` -- ordering is only valid between
compatible types (integer/decimal/year promote narrowly toward each other;
date, year-month and instant are never compared against unrelated types).

## Example

\`\`\`
find Artist, Work, Nationality
where
  artist(Artist)
  created(Artist, Work)
  optional
    nationality(Artist, Nationality)
  not
    withdrawn(Work)
order by Artist ascending
limit 20
\`\`\`

## Workflow

1. \`beingdb_list_predicates\` to discover real predicate names, arities and argument types.
2. Construct DSL using only predicates that were actually discovered.
3. \`beingdb_validate_query\` (and optionally \`beingdb_explain_query\`) before executing non-trivial queries.
4. \`beingdb_query\` to execute and get typed, structured rows.
`;
