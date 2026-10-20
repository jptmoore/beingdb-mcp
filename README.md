# beingdb-mcp

`beingdb-mcp` lets MCP-capable clients such as VS Code Copilot query a
[BeingDB](https://github.com/jptmoore/beingdb) database. The connected LLM uses its
tools to discover the database's schema, write queries, check them and run them.
`beingdb-mcp` contains no LLM itself; it passes requests to BeingDB and returns
BeingDB's answers.

For development and testing, BeingDB and the MCP server both run locally on your
machine. You only need a deployed server when you want to make the service available
to other machines or users.

## Quick start

You need Node.js 18.17+ and a [BeingDB](https://github.com/jptmoore/beingdb) checkout
(with its OCaml tools, `opam` and `dune`) next to this repository:

```
git/
  beingdb/
  beingdb-mcp/
```

In one terminal:

```bash
cd beingdb-mcp
npm install
npm run beingdb:local
```

`npm run beingdb:local` builds the BeingDB checkout next to this one and serves the
bundled demo data on `127.0.0.1:8080`.

In a second terminal:

```bash
npm run dev
```

This starts the MCP server at `http://127.0.0.1:3000/mcp`. Stop either with Ctrl-C.

```
VS Code
  ↓
beingdb-mcp
  ↓
BeingDB
  ↓
local data
```

Everything in this setup runs on your own machine.

## Connect VS Code

This repository includes a workspace MCP configuration, `.vscode/mcp.json`, so you
don't need to change MCP settings used by unrelated projects:

```json
{
    "servers": {
        "beingdb": {
            "type": "http",
            "url": "http://127.0.0.1:3000/mcp"
        }
    }
}
```

Open the project in VS Code, start the `beingdb` MCP server from that file (or with
**MCP: List Servers**), and use Copilot in agent mode.

If you previously configured a global BeingDB MCP server, disable or remove it when
using this workspace configuration to avoid having two `beingdb` servers configured.

## What it provides

- `beingdb_list_predicates`: discover the schema
- `beingdb_diagnose_query`: check a query and get diagnostics and proven repairs
- `beingdb_query`: execute a query
- `beingdb_validate_query`: validate a query
- `beingdb_explain_query`: inspect its plan
- `beingdb_get_facts`: retrieve a predicate's facts
- `beingdb_status`: check the connection

A typical session:

```
discover schema
  ↓
write query
  ↓
diagnose if needed
  ↓
execute
```

See [docs/tools.md](docs/tools.md) for details.

## Tests

```bash
npm test
```

This runs the normal test suite locally and starts and stops its own BeingDB
instance; you don't need the Quick start servers running. `npm run test:unit` runs
only the unit tests, without BeingDB.

## Using your own data

```bash
npm run beingdb:local -- --pack /path/to/pack_store
```

This serves your own compiled BeingDB pack instead of the demo data.

## Deployment

The local setup above is intended for development and testing.

`beingdb-mcp` can also be deployed to a server when you want other machines or users
to access it. The same MCP tools are used; the MCP server simply connects to a
deployed BeingDB instead of `localhost`:

```
VS Code / MCP client
        ↓
hosted beingdb-mcp
        ↓
hosted BeingDB
```

See [docs/deployment.md](docs/deployment.md).

## Documentation

- [docs/tools.md](docs/tools.md): tools, outputs, schema metadata, diagnostics and repairs
- [docs/prompting.md](docs/prompting.md): prompting an LLM to use BeingDB carefully, including a Rewind example
- [docs/development.md](docs/development.md): local setup details, configuration, tests and troubleshooting
- [docs/deployment.md](docs/deployment.md): hosting BeingDB and the MCP server

## License

[MIT](LICENSE)
