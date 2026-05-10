#!/bin/bash
cd "$(dirname "$0")"

# Add common package manager locations to PATH
export PATH="$HOME/.bun/bin:/opt/homebrew/bin:/usr/local/bin:$PATH"

# Configurable duckdb path via ENV, default to md:ccusage
DUCKDB_PATH="${DUCKDB_PATH:-md:ccusage}"

# Detect package manager: prefer bun, fallback to npm, then yarn
if command -v bun &> /dev/null; then
    PM="bun"
elif command -v npm &> /dev/null; then
    PM="npm"
elif command -v yarn &> /dev/null; then
    PM="yarn"
else
    echo "Error: No package manager found (bun/npm/yarn)" >&2
    exit 1
fi

$PM run src/scripts/import-all.ts --duckdb-path="$DUCKDB_PATH" 2>&1
