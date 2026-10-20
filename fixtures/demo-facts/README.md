# Demo facts fixture

A minimal, dataset-agnostic set of facts used by `beingdb-mcp`'s
integration tests (`test/integration/`) and for local manual
testing. It is deliberately small and predictable -- not the Rewind
dataset -- so it can be compiled and served without any external
dependency.

It demonstrates exactly the join pattern used in the project's example
use case (artists, works they created, where those works were shown,
where the artists studied, who funded them) without containing any
Rewind-specific or otherwise dataset-specific logic in `beingdb-mcp`
itself.

Facts (`created`, `work_shown_in` and `studied_at` also carry BeingDB
`%!` declarations -- full roles and semantic types, roles only, and a
description only -- while `artist` and `funded_by` are left undeclared,
so tests can check that MCP passes declared metadata through and
fabricates none):

```
artist(kevin_atherton).
artist(david_hall).

created(kevin_atherton, work_a).
created(david_hall, work_b).

work_shown_in(work_a, exhibition_a).
work_shown_in(work_b, exhibition_b).

studied_at(kevin_atherton, institution_a).

funded_by(kevin_atherton, arts_council).
```

The integration tests compile it into a temporary pack with BeingDB's own
`import`/`compile` commands on every run (see
[scripts/local-beingdb.ts](../../scripts/local-beingdb.ts));
`npm run beingdb:local` compiles it into `.local/pack_store` and serves it on
`127.0.0.1:8080`.
