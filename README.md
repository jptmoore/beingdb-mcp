# beingdb-mcp

A thin [Model Context Protocol](https://modelcontextprotocol.io) (MCP) server that
exposes [BeingDB](https://github.com/jptmoore/beingdb)'s HTTP API -- including its
`find`/`where` query DSL -- to MCP-capable LLMs. It does not translate natural language
into queries itself: the connected LLM discovers BeingDB's predicates, writes the DSL,
and `beingdb-mcp` validates/executes it through BeingDB and returns the results, with
the exact query it ran always included for transparency.

## Try the hosted demo

A public instance serves the [BeingDB Rewind Interviews dataset](https://github.com/jptmoore/beingdb-rewind-interviews).
In VS Code, open the Command Palette, run `MCP: Open User Configuration`, and add:

```json
{
    "servers": {
        "beingdb": {
            "type": "http",
            "url": "https://rewind.zedstar.org/mcp"
        }
    }
}
```

The demo is optional: development and tests use a local BeingDB (see
[Development](#development)).

## Tools

| Tool | BeingDB API | Use it to |
|---|---|---|
| `beingdb_list_predicates` | `GET /predicates` | Discover the schema. With `detailed: true` (implied by `names`/`search`): arity, fact count, per-argument observed types, examples, and any declared `description` and argument `role`/`semanticType`, plus `environmentFingerprint` and `languageVersion` |
| `beingdb_diagnose_query` | `POST /query` (`dsl`, `diagnose`) | Check a candidate DSL query against the data: validation, `diagnostics`, `provablyEmpty` and any proven `repair` |
| `beingdb_validate_query` | `POST /query` (`validate`) | Structural validation only (DSL or core) |
| `beingdb_explain_query` | `POST /query` (`explain`) | Show the access plan |
| `beingdb_query` | `POST /query` (`execute`) | Run a query and get typed rows |
| `beingdb_get_facts` | `GET /query/:predicate` | Dump one predicate's facts |
| `beingdb_status` | `GET /`, `GET /version` | Check connectivity and versions |

Every tool returns BeingDB's JSON unchanged as MCP structured content (with an
output schema) and as JSON text; query tools add the exact `query` submitted.
Resources: `beingdb://schema` (live detailed schema) and `beingdb://query-language`
(a short DSL reference).

Recommended workflow:

```
beingdb_list_predicates {detailed: true}  -> pick predicates by description and argument roles
  -> write a DSL query
  -> beingdb_diagnose_query               -> read diagnostics; optionally take repair.query
  -> beingdb_query                        -> typed rows
```

Predicate descriptions, argument roles and semantic types are written by the
dataset author as `%!` declarations in the BeingDB pack; they are omitted, not
guessed, for undeclared predicates. Diagnostics and proven repairs are computed
by BeingDB itself (see its [diagnose documentation](https://github.com/jptmoore/beingdb/blob/main/docs/api.md#diagnose-dsl)).
`beingdb-mcp` never applies a repair: the client decides whether to run
`repair.query`. `beingdb_diagnose_query` needs a BeingDB with the `diagnose`
action; older servers return an `unknown_action` tool error.

## Development

Everything runs against a local BeingDB; no deployed server or network access is
needed (beyond installing dependencies).

Prerequisites: Node.js 18.17+, and a [BeingDB](https://github.com/jptmoore/beingdb)
checkout with its OCaml toolchain (`opam`/`dune`), next to this repository:

```
git/
  beingdb/
  beingdb-mcp/
```

```bash
npm install
npm test
```

`npm test` runs the unit tests and the local integration tests. The integration
suite builds BeingDB incrementally (`dune build`), compiles
[fixtures/demo-facts](fixtures/demo-facts) into a temporary pack with BeingDB's own
`import`/`compile` commands, starts one `beingdb-serve` on a free `127.0.0.1` port,
runs the real MCP server against it, and stops both afterwards, even when tests fail.
Server output goes to `.local/logs/`.

BeingDB is found from, in order:

| Setting | Meaning |
|---|---|
| `BEINGDB_BIN_DIR` | Directory with prebuilt `beingdb-import`/`beingdb-compile`/`beingdb-serve` (not rebuilt) |
| `BEINGDB_REPO` | A BeingDB checkout, built with `dune` (or `opam exec -- dune`) |
| `../beingdb` | A sibling checkout, built the same way |

| Command | Runs |
|---|---|
| `npm test` | Unit + local integration tests |
| `npm run test:unit` | Unit tests only (no BeingDB needed) |
| `npm run test:integration` | Local integration tests only |
| `npm run test:remote` | Optional deployment smoke test (below) |
| `npm run beingdb:local` | BeingDB on `127.0.0.1:8080` serving the demo fixture (`-- --port N`, `-- --pack DIR` for another pack) |
| `npm run dev` | The MCP server from source on port 3000 |

To run the MCP server by hand against local BeingDB:

```bash
npm run beingdb:local     # terminal 1
npm run dev               # terminal 2: MCP at http://127.0.0.1:3000/mcp
```

`npm run inspect` opens the MCP Inspector for interactive testing.

### Configuration

`BEINGDB_URL` sets the BeingDB instance, local or remote (default
`http://127.0.0.1:8080`, the `beingdb:local` server); `PORT` (default 3000) and
`HOST` (default `0.0.0.0`) set where MCP listens. There is no fallback to any other
endpoint: if BeingDB is unreachable, tool calls fail with `connection_failed` naming
the URL.

### Deployment smoke test

To check a deployed MCP endpoint (and the BeingDB behind it), run:

```bash
BEINGDB_MCP_REMOTE_URL=https://<host>/mcp npm run test:remote
```

It only checks that the tool surface is current and that schema, diagnose and
execute respond; it makes no assertions about the dataset and is never part of
`npm test`. `docker compose up -d --build` runs the deployment stack (BeingDB from
`../beingdb`, the MCP server and nginx; MCP at `http://<host>:8090/mcp`).

## Prompting

Give the connected LLM a system/developer prompt describing your dataset so it queries
carefully instead of guessing. For example:

```text
You answer questions using the BeingDB MCP server connected to a research dataset built from interviews with **10 artists**: Kevin Atherton, Mike Stubbs, Madelon Hooykaas, David Hall, Rose Garrard, George Barber, David Critchley, Judith Goddard, Peter Donebauer, and Anna Ridley. Further background on each artist is available at https://rewind.ac.uk/artists/.

Always retrieve facts through the BeingDB MCP tools. Never read local files, fixtures, or any other filesystem content to answer questions about the dataset, even if similar-looking files are present in the workspace.

Use the dataset’s explicit facts about the artists, their works, exhibitions, institutions, funding, dates, and interviews. Discover the schema with `beingdb_list_predicates` using `detailed: true` (or `names` for specific predicates) when it is unknown or the environment fingerprint has changed; never invent predicate names. Each predicate's declared description and argument roles are authoritative: use them to choose predicates and argument order.

The DSL is line-oriented: a `find Var, Var, ...` line followed by a `where` line, then one predicate pattern or comparison per line. Do not write it as a single-line expression. Arity-2 predicates have no fixed subject/object convention (e.g. `created_by(Work, Artist)` puts the work first, but `studied_at(Person, Institution)` puts the person first), so follow each predicate's declared roles and name variables after them.

Check non-trivial queries, or any query whose syntax or types are uncertain, with `beingdb_diagnose_query` before running them with `beingdb_query`; execute simple queries directly. Its diagnostics come from BeingDB, not guesswork. If it reports `provablyEmpty: true`, the query as written cannot match: fix it rather than concluding the fact is missing. If it returns a `repair`, BeingDB has proven that correction; use `repair.query` when it still matches the question.

Use typed literals correctly: years use `@YYYY`, for example `@1975`. Prefer joins across explicit facts over inference. Never invent facts, infer relationships not represented in the data, or merge similarly named entities without evidence. An empty result from a valid, non-provably-empty query means the fact isn't recorded, not that the relationship is false -- phrase answers accordingly.

Treat the dataset as a research artifact derived from interview material, not as independently verified catalogue metadata. Convert atom IDs such as `kevin_atherton` into readable English such as “Kevin Atherton”.

Answer concisely in English. Do not describe the query process or show DSL unless the user asks. Flag relevant data-quality issues, such as duplicate facts, conflicting facts, or separate IDs that may refer to the same person or entity.
```


## License

MIT
