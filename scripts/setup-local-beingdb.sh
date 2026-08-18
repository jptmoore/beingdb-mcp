#!/usr/bin/env bash
# Compile the demo-facts fixture into a local BeingDB pack store, using a
# BeingDB checkout built with dune. Does not start the server -- see
# `npm run fixture:serve` (or the `beingdb-serve` command printed at the
# end) for that.
#
# Usage:
#   BEINGDB_REPO=~/git/beingdb ./scripts/setup-local-beingdb.sh
#
# Env vars (all optional):
#   BEINGDB_REPO   Path to a BeingDB checkout (default: ~/git/beingdb)
#   OPAM_SWITCH    opam switch to build BeingDB with (default: whatever `opam env` resolves to)
#   FIXTURE_DIR    Facts to import (default: ./fixtures/demo-facts)
#   GIT_STORE      Irmin Git store output dir (default: ./.local/git_store)
#   PACK_STORE     Compiled pack store output dir (default: ./.local/pack_store)
set -euo pipefail

BEINGDB_REPO="${BEINGDB_REPO:-$HOME/git/beingdb}"
FIXTURE_DIR="${FIXTURE_DIR:-$(pwd)/fixtures/demo-facts}"
GIT_STORE="${GIT_STORE:-$(pwd)/.local/git_store}"
PACK_STORE="${PACK_STORE:-$(pwd)/.local/pack_store}"

if [[ ! -d "$BEINGDB_REPO" ]]; then
  echo "error: BeingDB checkout not found at $BEINGDB_REPO (set BEINGDB_REPO)" >&2
  exit 1
fi

echo "==> Building BeingDB in $BEINGDB_REPO"
(
  cd "$BEINGDB_REPO"
  if [[ -n "${OPAM_SWITCH:-}" ]]; then
    eval "$(opam env --switch="$OPAM_SWITCH")"
  else
    eval "$(opam env)"
  fi
  dune build
)

IMPORT_BIN="$BEINGDB_REPO/_build/default/bin/import.exe"
COMPILE_BIN="$BEINGDB_REPO/_build/default/bin/compile.exe"

rm -rf "$GIT_STORE" "$PACK_STORE"

echo "==> Importing fixture facts from $FIXTURE_DIR into $GIT_STORE"
"$IMPORT_BIN" --input "$FIXTURE_DIR" --git "$GIT_STORE"

echo "==> Compiling $GIT_STORE into pack store $PACK_STORE"
"$COMPILE_BIN" --git "$GIT_STORE" --pack "$PACK_STORE"

echo
echo "Done. Start the server with:"
echo "  $BEINGDB_REPO/_build/default/bin/serve.exe --pack $PACK_STORE --port 8080"
