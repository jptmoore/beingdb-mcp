# Deployment

A deployment is only needed when other machines need to reach the MCP server, the
service must be publicly available, or you want a shared demo or production
instance. Development and testing don't need one (see the [README](../README.md)).

```
VS Code / MCP client
        ↓  https://<host>/mcp
hosted beingdb-mcp
        ↓  BEINGDB_URL
hosted BeingDB
        ↓
compiled pack store
```

The MCP server is the same as locally; it is just configured with the URL of a
BeingDB instance:

```bash
npm ci && npm run build
BEINGDB_URL=http://beingdb.internal:8080 PORT=3000 npm start   # MCP at http://<host>:3000/mcp
```

`GET /healthz` returns `OK` for health checks. Neither the MCP server nor BeingDB has
built-in authentication or TLS; put a reverse proxy in front for those and for rate
limiting.

## Docker Compose

[docker-compose.yml](../docker-compose.yml) runs the whole stack on one host:

| Service | What it does |
|---|---|
| `beingdb` | BeingDB built from a `../beingdb` checkout, serving the pack in `./pack_store` (or `PACK_STORE_DIR`) |
| `mcp` | This MCP server (built from the [Dockerfile](../Dockerfile)), with `BEINGDB_URL=http://beingdb:8080` |
| `nginx` | Rate-limiting proxy on port 8090 ([nginx.conf](../nginx.conf)): MCP at `/mcp`, BeingDB's REST API at `/` |

```bash
docker compose up -d --build
```

The pack must be compiled with a BeingDB version that supports declarations and the
`diagnose` action (see BeingDB's
[getting started guide](https://github.com/jptmoore/beingdb/blob/main/docs/getting-started.md));
after updating BeingDB, recompile the pack and rebuild the stack. Put TLS in front of
port 8090 (for example in your own web server) for public access.

## Connecting a client

Point the MCP client at the deployed `/mcp` URL, for example in a workspace
`.vscode/mcp.json`:

```json
{
    "servers": {
        "beingdb": {
            "type": "http",
            "url": "https://<host>/mcp"
        }
    }
}
```

## Smoke test

To check that a deployment is up and current:

```bash
BEINGDB_MCP_REMOTE_URL=https://<host>/mcp npm run test:remote
```

It connects to the deployed MCP endpoint, checks that the tool list is current and
that status, schema, diagnose and execute respond for a predicate it discovers. It
makes no assertions about the dataset, and is never part of `npm test`.
