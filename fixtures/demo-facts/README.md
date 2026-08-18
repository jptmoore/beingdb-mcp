# Demo facts fixture

A minimal, dataset-agnostic set of facts used by `beingdb-mcp`'s
integration test (`test/integration.test.ts`) and for local manual
testing. It is deliberately small and predictable -- not the Rewind
dataset -- so it can be compiled and served without any external
dependency.

It demonstrates exactly the join pattern used in the project's example
use case (artists, works they created, where those works were shown,
where the artists studied, who funded them) without containing any
Rewind-specific or otherwise dataset-specific logic in `beingdb-mcp`
itself.

Facts:

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

See [scripts/setup-local-beingdb.sh](../../scripts/setup-local-beingdb.sh) for how
to compile this into a pack store and serve it locally.
