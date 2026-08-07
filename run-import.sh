#!/bin/bash
# Cron entry for ccusage-import (Rust).
# Prefer release binary; fall back to cargo run --release.
# Emits ISO start/end markers and writes last-run status for monitoring.

cd "$(dirname "$0")" || exit 1

# Portable PATH for macOS + Linux cron (minimal env).
export PATH="${HOME}/.cargo/bin:${HOME}/.bun/bin:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:${PATH}"

# Load project .env (MOTHERDUCK_TOKEN, CH_*, etc.) without printing secrets
if [ -f .env ]; then
  set -a
  # shellcheck disable=SC1091
  . ./.env
  set +a
fi

DUCKDB_PATH="${DUCKDB_PATH:-md:ccusage}"
DAYS_BACK="${IMPORT_DAYS_BACK:-2}"

LOG_DIR="${HOME}/.local/log/ccusage"
mkdir -p "$LOG_DIR"
STATUS_FILE="${LOG_DIR}/last-run.status"
RUN_CAPTURE="${LOG_DIR}/.last-run.capture"

START_ISO="$(date -u +"%Y-%m-%dT%H:%M:%SZ")"
echo "=== run start ${START_ISO} ==="

BINARY="target/release/ccusage-import"
EXIT_CODE=0

run_import() {
  if [ -x "$BINARY" ]; then
    "$BINARY" import --duckdb-path="$DUCKDB_PATH" --days-back="$DAYS_BACK"
  else
    if ! command -v cargo >/dev/null 2>&1; then
      echo "Error: cargo not found in PATH and no release binary at ${BINARY}" >&2
      return 127
    fi
    # Build+run release so the next cron tick can use the binary path above.
    cargo run --release -- import --duckdb-path="$DUCKDB_PATH" --days-back="$DAYS_BACK"
  fi
}

set +e
run_import 2>&1 | tee "$RUN_CAPTURE"
EXIT_CODE=${PIPESTATUS[0]}
set -e

END_ISO="$(date -u +"%Y-%m-%dT%H:%M:%SZ")"

IMPORT_ID=""
if [ -f "$RUN_CAPTURE" ]; then
  IMPORT_ID="$(grep -oE 'import: [0-9a-fA-F-]{36}' "$RUN_CAPTURE" 2>/dev/null | head -1 | sed 's/import: //')"
fi

if [ "$EXIT_CODE" -eq 0 ]; then
  OUTCOME="ok"
else
  OUTCOME="failed"
fi

# Durable last-run status for monitoring (key=value, one fact per line)
{
  echo "timestamp=${END_ISO}"
  echo "start=${START_ISO}"
  echo "end=${END_ISO}"
  echo "exit_code=${EXIT_CODE}"
  echo "import_id=${IMPORT_ID}"
  echo "outcome=${OUTCOME}"
  echo "duckdb_path=${DUCKDB_PATH}"
  echo "days_back=${DAYS_BACK}"
  echo "binary=$([ -x "$BINARY" ] && echo release || echo cargo-run-release)"
} >"$STATUS_FILE"

echo "=== run end ${END_ISO} exit=${EXIT_CODE} outcome=${OUTCOME} import_id=${IMPORT_ID} ==="
exit "$EXIT_CODE"
