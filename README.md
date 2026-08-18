# beingdb-mcp

A thin [Model Context Protocol](https://modelcontextprotocol.io) (MCP) server that
exposes [BeingDB](https://github.com/jptmoore/beingdb)'s HTTP API -- including its
`find`/`where` query DSL -- to MCP-capable LLMs. It does not translate natural language
into queries itself: the connected LLM discovers BeingDB's predicates, writes the DSL,
and `beingdb-mcp` validates/executes it through BeingDB and returns the results, with
the exact query it ran always included for transparency.

## Getting started

```bash
# 1. Compile your facts into ./pack_store using BeingDB's native CLI
#    (beingdb-compile --git ./git_store --pack ./pack_store)

# 2. Start everything: BeingDB, beingdb-mcp, and an nginx reverse proxy in front of both
docker compose up -d
```

That's it -- both `beingdb` and `mcp` speak plain HTTP and are only reachable through
`nginx` (`docker-compose.yml`/`nginx.conf`), published on the host at `:8090`:

- BeingDB's REST API: `http://<host>:8090/...` (e.g. `/version`, `/predicates`, `/query`)
- MCP (Streamable HTTP): `http://<host>:8090/mcp`

Point any MCP client that supports a remote/HTTP server at that `/mcp` URL directly --
no local process spawning, no SSH, nothing client-side to configure beyond the URL.
`nginx.conf` adds a 10 req/s rate limit (matching BeingDB's own recommended config) --
put this behind your own Apache (or other) vhost for TLS/further access control. Both
`beingdb` and `mcp` are unauthenticated by design (same as BeingDB's own HTTP API); add
auth in front (Apache/nginx) if you don't want the endpoint fully public. Adjust the
`beingdb` service's `build.context` in `docker-compose.yml` if your BeingDB checkout
isn't at `../beingdb`.

`restart: unless-stopped` on all three containers means a single `docker compose up -d`
is the whole deployment step on a headless host (e.g. a Raspberry Pi) -- run it once and
leave it running (with Docker itself set to start on boot).

## Try it

The easiest way to explore `beingdb-mcp` is with a browser-based MCP client. Open
[MCP Playground Online](https://mcpplaygroundonline.com/mcp-test-server) and connect to:

    rewind.zedstar.org/mcp

Every `beingdb_query`/`beingdb_validate_query`/`beingdb_explain_query` result includes
the exact submitted `query`, so the DSL an LLM generated is always visible alongside its
results.

## Prompting

Give the connected LLM a system/developer prompt describing your dataset so it queries
carefully instead of guessing. For example:

> ### Prompt for grounded questions
>
> You answer questions using the BeingDB MCP server connected to this dataset.
>
> Use the dataset's explicit facts about artists, works, exhibitions, institutions,
> funding, dates, and interviews. Before querying, inspect predicates only when the
> schema is unknown or its environment fingerprint has changed. Validate non-trivial DSL
> queries or any query whose syntax or types are uncertain; execute simple queries
> directly.
>
> Use typed literals correctly: years use `@YYYY`, for example `@1975`. Prefer joins over
> inference, never invent facts or merge similarly named entities without evidence, and
> treat the dataset as a research artifact rather than independently verified catalogue
> metadata. Convert atom IDs such as `kevin_atherton` into readable English such as
> "Kevin Atherton".
>
> Answer concisely in English. Do not describe the query process or show the DSL unless
> the user asks. Flag relevant data-quality issues, such as duplicate facts or separate
> IDs that may refer to the same person.

## License

MIT
