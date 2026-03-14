#!/usr/bin/env bash
set -euo pipefail

# Installs ralph by symlinking bin/ralph to a location on PATH.
# Usage: ./install.sh [prefix]
#   Default prefix: ~/.local

PREFIX="${1:-$HOME/.local}"
RALPH_BIN="$(cd "$(dirname "$0")" && pwd)/bin/ralph"

if [[ ! -f "$RALPH_BIN" ]]; then
    echo "ERROR: bin/ralph not found. Run this script from the ralph repo root." >&2
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
