#!/usr/bin/env bash
set -euo pipefail

# Installs ralph by building the Bun binary and symlinking it to a location on PATH.
# Usage: ./install.sh [prefix]
#   Default prefix: ~/.local

PREFIX="${1:-$HOME/.local}"
RALPH_ROOT="$(cd "$(dirname "$0")" && pwd)"

if ! command -v bun &>/dev/null; then
    echo "ERROR: 'bun' is not available on PATH." >&2
    echo "Install Bun from https://bun.sh and try again." >&2
    exit 1
fi

echo "Building ralph..."
cd "$RALPH_ROOT"
bun run build

RALPH_BIN="$RALPH_ROOT/dist/ralph"

if [[ ! -f "$RALPH_BIN" ]]; then
    echo "ERROR: build succeeded but dist/ralph not found." >&2
    exit 1
fi

mkdir -p "$PREFIX/bin"
ln -sf "$RALPH_BIN" "$PREFIX/bin/ralph"

echo "Installed: $PREFIX/bin/ralph -> $RALPH_BIN"
echo ""

# Check if the prefix bin is on PATH
if ! echo "$PATH" | tr ':' '\n' | grep -qx "$PREFIX/bin"; then
    echo "NOTE: $PREFIX/bin is not on your PATH."
    echo "Add this to your shell profile:"
    echo ""
    echo "  export PATH=\"$PREFIX/bin:\$PATH\""
    echo ""
fi
