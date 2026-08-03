#!/usr/bin/env bash
set -euo pipefail

# Installs cairn by building the Bun binary and symlinking it to a location on PATH.
# Both `cairn` and `ralph` are symlinked to the same binary — `ralph` is a
# long-lived compatibility name, kept working indefinitely.
# Usage: ./install.sh [prefix]
#   Default prefix: ~/.local

PREFIX="${1:-$HOME/.local}"
CAIRN_ROOT="$(cd "$(dirname "$0")" && pwd)"

if ! command -v bun &>/dev/null; then
    echo "ERROR: 'bun' is not available on PATH." >&2
    echo "Install Bun from https://bun.sh and try again." >&2
    exit 1
fi

echo "Building cairn..."
cd "$CAIRN_ROOT"
bun run build

CAIRN_BIN="$CAIRN_ROOT/dist/cairn"

if [[ ! -f "$CAIRN_BIN" ]]; then
    echo "ERROR: build succeeded but dist/cairn not found." >&2
    exit 1
fi

mkdir -p "$PREFIX/bin"
ln -sf "$CAIRN_BIN" "$PREFIX/bin/cairn"
ln -sf "$CAIRN_BIN" "$PREFIX/bin/ralph"

echo "Installed: $PREFIX/bin/cairn -> $CAIRN_BIN"
echo "Installed: $PREFIX/bin/ralph -> $CAIRN_BIN"
echo ""

# Check if the prefix bin is on PATH
if ! echo "$PATH" | tr ':' '\n' | grep -qx "$PREFIX/bin"; then
    echo "NOTE: $PREFIX/bin is not on your PATH."
    echo "Add this to your shell profile:"
    echo ""
    echo "  export PATH=\"$PREFIX/bin:\$PATH\""
    echo ""
fi
