#!/bin/bash
cd "$(dirname "$0")"

# Add common package manager locations to PATH
export PATH="$HOME/.bun/bin:/opt/homebrew/bin:/usr/local/bin:$PATH"

# Configurable duckdb path via ENV, default to md:ccusage
DUCKDB_PATH="${DUCKDB_PATH:-md:ccusage}"

# Bun runtime is required for src/scripts/import-all.ts
if ! command -v bun &> /dev/null; then
    echo "Error: bun not found in PATH (expected at $HOME/.bun/bin/bun)" >&2
    exit 1
fi

bun run src/scripts/import-all.ts --duckdb-path="$DUCKDB_PATH" 2>&1
