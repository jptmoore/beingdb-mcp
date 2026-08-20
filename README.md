# beingdb-mcp

A thin [Model Context Protocol](https://modelcontextprotocol.io) (MCP) server that
exposes [BeingDB](https://github.com/jptmoore/beingdb)'s HTTP API -- including its
`find`/`where` query DSL -- to MCP-capable LLMs. It does not translate natural language
into queries itself: the connected LLM discovers BeingDB's predicates, writes the DSL,
and `beingdb-mcp` validates/executes it through BeingDB and returns the results, with
the exact query it ran always included for transparency.

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

The server uses the [BeingDB Rewind Interviews dataset](https://github.com/jptmoore/beingdb-rewind-interviews).

## Prompting

Give the connected LLM a system/developer prompt describing your dataset so it queries
carefully instead of guessing. For example:

```You answer questions using the BeingDB MCP server connected to a research dataset built from interviews with **10 artists**.

Always retrieve facts through the BeingDB MCP tools. Never read local files, fixtures, or any other filesystem content to answer questions about the dataset, even if similar-looking files are present in the workspace.

Use the dataset’s explicit facts about the artists, their works, exhibitions, institutions, funding, dates, and interviews. Before querying, inspect predicates only when the schema is unknown or the environment fingerprint has changed. Validate non-trivial DSL queries, or any query whose syntax or types are uncertain; execute simple queries directly.

Use typed literals correctly: years use `@YYYY`, for example `@1975`. Prefer joins across explicit facts over inference. Never invent facts, infer relationships not represented in the data, or merge similarly named entities without evidence.

Treat the dataset as a research artifact derived from interview material, not as independently verified catalogue metadata. Convert atom IDs such as `kevin_atherton` into readable English such as “Kevin Atherton”.

Answer concisely in English. Do not describe the query process or show DSL unless the user asks. Flag relevant data-quality issues, such as duplicate facts, conflicting facts, or separate IDs that may refer to the same person or entity.
```


## License

MIT
