# Development

Everything here runs against a local BeingDB; no network access is needed beyond
installing dependencies.

## Prerequisites and layout

- Node.js 18.17+
- A [BeingDB](https://github.com/jptmoore/beingdb) checkout and its OCaml toolchain
  (`opam`, `dune`; see BeingDB's installation guide), normally next to this repository:

```
git/
  beingdb/
  beingdb-mcp/
```

## Commands

| Command | Runs |
|---|---|
| `npm run beingdb:local` | BeingDB on `127.0.0.1:8080` serving the demo fixture |
| `npm run beingdb:local -- --port N` | The same on another port |
| `npm run beingdb:local -- --pack DIR` | BeingDB serving an existing compiled pack instead |
| `npm run dev` | The MCP server from source, at `http://127.0.0.1:3000/mcp` |
| `npm run build` / `npm start` | Compile to `dist/` and run the compiled server |
| `npm test` | Unit and local integration tests |
| `npm run test:unit` | Unit tests only (no BeingDB needed) |
| `npm run test:integration` | Local integration tests only |
| `npm run test:remote` | Optional deployment smoke test (see [deployment.md](deployment.md)) |
| `npm run lint` | Type-check `src/` |
| `npm run inspect` | Open the MCP Inspector for interactive testing |

`npm run beingdb:local` runs `dune build` in the BeingDB checkout (incremental, so
fast when nothing changed), compiles [fixtures/demo-facts](../fixtures/demo-facts)
into `.local/pack_store` with BeingDB's own `import`/`compile` commands, and serves
it in the foreground. It is implemented in
[scripts/local-beingdb.ts](../scripts/local-beingdb.ts).

## Finding BeingDB

`npm run beingdb:local` and the integration tests look for BeingDB in this order:

| Setting | Meaning |
|---|---|
| `BEINGDB_BIN_DIR` | Directory with prebuilt `beingdb-import`, `beingdb-compile` and `beingdb-serve` (or `import.exe`, ...); not rebuilt |
| `BEINGDB_REPO` | A BeingDB checkout, built with `dune` (or `opam exec -- dune` if `dune` is not on `PATH`) |
| `../beingdb` | A sibling checkout, built the same way |

## Configuration

| Variable | Default | Meaning |
|---|---|---|
| `BEINGDB_URL` | `http://127.0.0.1:8080` | BeingDB instance the MCP server talks to (local or remote) |
| `PORT` | `3000` | MCP server port |
| `HOST` | `0.0.0.0` | MCP server interface; set `127.0.0.1` to accept local connections only |
| `BEINGDB_MCP_DEBUG` | unset | Set to `1` for debug logging to stderr |

The MCP server logs the BeingDB URL it uses at startup. There is no fallback to any
other endpoint: if BeingDB is unreachable, tool calls fail with `connection_failed`
naming the URL.

## Tests

- **Unit** (`test/unit/`): client, server and harness logic with HTTP mocked.
- **Local integration** (`test/integration/`): once per run, the suite builds BeingDB,
  compiles the demo fixture into a temporary pack, starts `beingdb-serve` on a free
  `127.0.0.1` port, and runs the real MCP server from source against it. Tests compare
  MCP output with BeingDB's own HTTP responses for schema, diagnose and execute, plus
  an end-to-end agent workflow. Both servers are stopped afterwards, even when tests
  fail. Their output goes to `.local/logs/`.
- **Remote** (`test/remote/`): an opt-in deployment smoke test, never part of
  `npm test`; see [deployment.md](deployment.md).

The demo fixture mixes fully declared, partly declared and undeclared predicates so
the tests can check that declared metadata passes through and nothing is invented.

## Troubleshooting

- **"No local BeingDB found"**: clone BeingDB next to this repository, or set
  `BEINGDB_REPO` or `BEINGDB_BIN_DIR`.
- **"Building local BeingDB failed" / "neither dune nor opam is on PATH"**: install
  BeingDB's OCaml toolchain, or run `eval "$(opam env)"` first.
- **"port 8080 is unavailable"**: something else is using it; use
  `npm run beingdb:local -- --port 18080` and `BEINGDB_URL=http://127.0.0.1:18080 npm run dev`.
- **Tool calls fail with `connection_failed`**: BeingDB isn't running at the logged
  URL; start `npm run beingdb:local`.
- **Two `beingdb` servers in VS Code**: disable any user-level BeingDB MCP server
  while using this workspace's `.vscode/mcp.json`.
- **Integration test failures**: errors name the stage that failed (locate, build,
  compile, start, ready); server output is in `.local/logs/integration-*.log`.
