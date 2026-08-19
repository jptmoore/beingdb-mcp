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

## Try it

In VS Code, open the Command Palette, run `MCP: Open User Configuration`, and add the
BeingDB connector to your MCP server configuration:

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
