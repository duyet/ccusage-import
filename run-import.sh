#!/bin/bash
cd "$(dirname "$0")"

# Ensure cargo is available even in minimal cron environments
export PATH="/Users/duet/.cargo/bin:$PATH"

# Configurable duckdb path via ENV, default to md:ccusage
DUCKDB_PATH="${DUCKDB_PATH:-md:ccusage}"

# Configurable time window: days of history to import (default: 2 for cron runs)
DAYS_BACK="${IMPORT_DAYS_BACK:-2}"

# Rust binary is required
if ! command -v cargo &> /dev/null; then
    echo "Error: cargo not found in PATH" >&2
    exit 1
fi

# Use release binary if available to avoid rebuilds in cron
BINARY="target/release/ccusage-import"
if [ -x "$BINARY" ]; then
    "$BINARY" import --duckdb-path="$DUCKDB_PATH" --days-back="$DAYS_BACK" 2>&1
else
    cargo run -- import --duckdb-path="$DUCKDB_PATH" --days-back="$DAYS_BACK" 2>&1
fi
