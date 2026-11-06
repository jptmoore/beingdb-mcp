/**
 * Concise, LLM-oriented reference for BeingDB's expressive query
 * language, served as the `beingdb://query-language` MCP resource.
 *
 * Deliberately short and not authoritative -- it summarizes syntax
 * documented in BeingDB's docs/query-language.md
 * (https://github.com/jptmoore/beingdb/blob/main/docs/query-language.md) at the time this
 * file was written. Always confirm against a live instance with
 * `beingdb_diagnose_query` / `beingdb_validate_query`, since predicates,
 * arities and argument types are dataset-specific and the DSL itself may
 * evolve.
 */
export const QUERY_LANGUAGE_REFERENCE = `# BeingDB DSL quick reference

BeingDB has one query language: the line-oriented \`find\`/\`where\` DSL.
Each \`where\` line is a predicate pattern or a comparison; the DSL adds
projection, optional matches, disjunction, negation, ordering,
deduplication and pagination.

\`\`\`
find [distinct] Var | count(Var) | sum(Var) | avg(Var) | min(Var) | max(Var), ...
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
order by Var | <aggregate>(Var) [ascending|descending], ...
limit N
offset N
\`\`\`

- \`find\` lists the variables to project, in order. \`distinct\` deduplicates rows.
- \`count(Var)\` in \`find\` counts the distinct values of \`Var\`; the other \`find\`
  variables are the groups (one row each), and with none there is a single row.
  E.g. \`find Artist, count(Work)\` ... \`order by count(Work) descending\`. The
  column (and result key) is \`count(Work)\`; values unbound by \`optional\` are not
  counted, so a group can count 0. Use it for "how many" questions.
- \`sum(Var)\`, \`avg(Var)\`, \`min(Var)\` and \`max(Var)\` group the same way, for totals,
  averages, earliest and latest. \`sum\`/\`avg\` need integers or decimals (\`avg\` is a
  decimal); \`min\`/\`max\` also take years and dates and keep the value's type. Unlike
  \`count\`, they read each distinct combination of the query's named variables once, so
  use \`_\` for arguments you do not need (an extra named variable can add a value twice).
  With no matches they are \`null\`. Misuse is rejected as \`invalid_aggregate\`.
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

\`Var contains "text"\` searches text: it keeps rows whose string, language-tagged
string or atom value contains the text, ignoring case, with underscores and spaces
treated alike (\`Title contains "video stairs"\` matches \`the_video_stairs\`). It is a
plain substring test (no wildcards or regular expressions); the text must be quoted,
1-200 characters. Use it to find entities whose exact atom you don't know, then use
that atom.

## Names: label and alias

A dataset may give values display names with \`label(Thing, Name)\` and other names or
spellings with \`alias(Thing, Name)\`. They are ordinary facts you can query, and
\`beingdb_resolve\` matches them too.

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

1. \`beingdb_list_predicates\` (\`detailed: true\` or \`names\`) to discover real predicate
   names, arities, argument types and any declared descriptions and argument roles.
   Argument \`position\`s are 0-based; declared roles give each argument's meaning.
2. \`beingdb_resolve\` with the user's question to turn the names it mentions into the exact
   stored values (\`literal\`), tolerating misspellings and using any labels or aliases.
   Several candidates mean the name is ambiguous: use the context or ask. No mention means
   the name is not stored under that spelling: try \`Var contains "text"\`.
   \`beingdb_about\` shows every fact about one value, which helps choose predicates.
3. Construct DSL using only predicates that were actually discovered, and constants from step 2.
4. \`beingdb_diagnose_query\` before executing non-trivial queries: validation plus
   data-aware diagnostics (\`provablyEmpty\`, per-diagnostic \`code\`/\`severity\`/\`evidence\`)
   and, when BeingDB can prove one, a \`repair.query\` you may choose to run. A
   probably misspelled constant comes with \`evidence.suggestions\` (closest values that
   occur at that argument) -- hints, not proofs.
   (\`beingdb_validate_query\` checks structure only; \`beingdb_explain_query\` shows the plan.)
5. \`beingdb_query\` to execute and get typed, structured rows. For "how many", use
   \`count(Var)\` (distinct values, optionally per group); for totals and extremes
   \`sum\`/\`avg\`/\`min\`/\`max\`; \`total\` is how many result
   rows the query matches, which a join can duplicate. \`hasMore: true\` means more
   rows match (page with \`offset\`); \`truncated: true\` means the server's row cap cut the
   result, so the rows are not the complete answer. An empty DSL result carries
   BeingDB's \`diagnostics\` and \`provablyEmpty\`: \`true\` means fix the query, \`false\`
   means the facts are not recorded.
`;
