#!/bin/bash
# Setup cronjob for ccusage data import to ClickHouse
# Security: All variables are properly quoted to prevent command injection
# Uses [[ ]] for tests and validates all external inputs
# PATH TRAVERSAL PROTECTION: Validates all paths before use

set -euo pipefail  # Exit on error, undefined variables, and pipe failures

# Security: Get the actual script directory (resolves symlinks)
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)"
PROJECT_DIR="$SCRIPT_DIR"
SCRIPT_PATH="$PROJECT_DIR/ccusage_importer.py"

# Security: Validate PROJECT_DIR is an absolute path and doesn't contain ".."
if [[ ! "$PROJECT_DIR" =~ ^/ ]]; then
    echo "❌ Security Error: PROJECT_DIR must be an absolute path"
    exit 1
fi

if [[ "$PROJECT_DIR" =~ \.\. ]]; then
    echo "❌ Security Error: PROJECT_DIR contains '..' sequence"
    exit 1
fi

# Security: Detect uv path dynamically with proper quoting
UV_PATH="$(which uv 2>/dev/null || true)"
if [[ -z "$UV_PATH" ]]; then
    echo "❌ uv not found in PATH. Please install uv first."
    exit 1
fi

# Security: Validate UV_PATH is a valid executable path (basic sanitization)
if [[ ! -x "$UV_PATH" ]]; then
    echo "❌ uv path is not executable: $UV_PATH"
    exit 1
fi

# Security: Detect package runner paths (npx and bunx) with proper quoting
NPX_PATH="$(which npx 2>/dev/null || true)"
BUNX_PATH="$(which bunx 2>/dev/null || true)"

if [[ -z "$NPX_PATH" ]] && [[ -z "$BUNX_PATH" ]]; then
    echo "❌ Neither npx nor bunx found in PATH. Please install Node.js/npm or Bun first."
    exit 1
fi

# Security: Build the PATH additions with proper quoting
BIN_PATHS=""
if [[ -n "$NPX_PATH" ]]; then
    NPX_DIR="$(dirname "$NPX_PATH")"
    BIN_PATHS="$NPX_DIR"
fi
if [[ -n "$BUNX_PATH" ]]; then
    BUNX_DIR="$(dirname "$BUNX_PATH")"
    if [[ -n "$BIN_PATHS" ]]; then
        BIN_PATHS="$BIN_PATHS:$BUNX_DIR"
    else
        BIN_PATHS="$BUNX_DIR"
    fi
fi

# Security: Check if project directory exists with [[ ]]
if [[ ! -d "$PROJECT_DIR" ]]; then
    echo "❌ Project directory not found: $PROJECT_DIR"
    exit 1
fi

# Security: Check if script exists with [[ ]]
if [[ ! -f "$SCRIPT_PATH" ]]; then
    echo "❌ Script not found: $SCRIPT_PATH"
    exit 1
fi

# Security: Validate and create log directory with proper quoting
# Ensure HOME is set and doesn't contain path traversal sequences
if [[ -z "${HOME:-}" ]]; then
    echo "❌ Security Error: HOME environment variable is not set"
    exit 1
fi

if [[ "$HOME" =~ \.\. ]]; then
    echo "❌ Security Error: HOME contains '..' sequence"
    exit 1
fi

# Security: Construct log directory path and validate it
LOG_DIR="$HOME/.local/log/ccusage"

# Security: Validate LOG_DIR doesn't contain path traversal sequences
if [[ "$LOG_DIR" =~ \.\. ]]; then
    echo "❌ Security Error: LOG_DIR contains '..' sequence"
    exit 1
fi

# Security: Create log directory with safe permissions (rwx for user only)
mkdir -p "$LOG_DIR"
chmod 700 "$LOG_DIR"

echo "🔧 Setting up ccusage cronjob..."
echo "📁 Project: $PROJECT_DIR"
echo "📜 Script: $SCRIPT_PATH"
echo "📋 Logs: $LOG_DIR"
echo "🔗 UV Path: $UV_PATH"
echo "📦 Package runners:"
if [[ -n "$NPX_PATH" ]]; then
    echo "   - NPX: $NPX_PATH"
fi
if [[ -n "$BUNX_PATH" ]]; then
    echo "   - BUNX: $BUNX_PATH"
fi
echo "🛤️  Cron PATH: $BIN_PATHS"

# Check and display current environment variables
echo "🔧 Environment variables:"
echo "   - CH_HOST: ${CH_HOST:-'(not set)'}"
echo "   - CH_PORT: ${CH_PORT:-'(not set)'}"
echo "   - CH_USER: ${CH_USER:-'(not set)'}"
echo "   - CH_DATABASE: ${CH_DATABASE:-'(not set)'}"
echo "   - CH_PASSWORD: ${CH_PASSWORD:+'***set***'}"

# Add cronjob to run every hour with enhanced logging and environment variables
echo "⏰ Setting up cronjob to run every hour with timestamp logging..."

# Security: Validate environment variables before use
# Only allow alphanumeric, dots, hyphens, underscores for host/user/database
# This prevents command injection through environment variables
validate_alphanum() {
    local var="$1"
    if [[ "$var" =~ ^[a-zA-Z0-9._-]+$ ]]; then
        return 0
    else
        return 1
    fi
}

# Security: Build environment variable exports for crontab with validation
# Use arrays for safe command construction
declare -a ENV_EXPORTS=()

if [[ -n "${CH_HOST:-}" ]]; then
    if validate_alphanum "$CH_HOST"; then
        ENV_EXPORTS+=("CH_HOST=$CH_HOST")
    else
        echo "⚠️  Warning: CH_HOST contains invalid characters, skipping"
    fi
fi

if [[ -n "${CH_PORT:-}" ]]; then
    # Validate port is numeric
    if [[ "$CH_PORT" =~ ^[0-9]+$ ]]; then
        ENV_EXPORTS+=("CH_PORT=$CH_PORT")
    else
        echo "⚠️  Warning: CH_PORT is not numeric, skipping"
    fi
fi

if [[ -n "${CH_USER:-}" ]]; then
    if validate_alphanum "$CH_USER"; then
        ENV_EXPORTS+=("CH_USER=$CH_USER")
    else
        echo "⚠️  Warning: CH_USER contains invalid characters, skipping"
    fi
fi

if [[ -n "${CH_PASSWORD:-}" ]]; then
    # Security: Password needs special handling - escape single quotes
    # Replace ' with '\'' to safely embed in single-quoted string
    SAFE_PASSWORD="${CH_PASSWORD//\'/\'\\\'\'}"
    ENV_EXPORTS+=("CH_PASSWORD='$SAFE_PASSWORD'")
fi

if [[ -n "${CH_DATABASE:-}" ]]; then
    if validate_alphanum "$CH_DATABASE"; then
        ENV_EXPORTS+=("CH_DATABASE=$CH_DATABASE")
    else
        echo "⚠️  Warning: CH_DATABASE contains invalid characters, skipping"
    fi
fi

# Security: Join environment variables with proper spacing
ENV_VARS="${ENV_EXPORTS[*]}"

# Security: Build crontab entry using printf to avoid injection
# All variables are properly quoted and validated
CRON_ENTRY=$(printf '0 * * * * cd "%s" && PATH=%s:$PATH %s echo "$(date): Starting ccusage import" >> "%s/import.log" && PATH=%s:$PATH %s "%s" run python ccusage_importer.py >> "%s/import.log" 2>&1 && echo "$(date): ccusage import completed" >> "%s/import.log"' \
    "$PROJECT_DIR" \
    "$BIN_PATHS" \
    "$ENV_VARS" \
    "$LOG_DIR" \
    "$BIN_PATHS" \
    "$ENV_VARS" \
    "$UV_PATH" \
    "$LOG_DIR" \
    "$LOG_DIR")

# Security: Use printf to safely add crontab entry
{ crontab -l 2>/dev/null || true; printf '%s\n' "$CRON_ENTRY"; } | crontab -

# Security: Run initial import with proper quoting and error handling
echo "🚀 Running initial import..."
if ! cd "$PROJECT_DIR"; then
    echo "❌ Failed to change to project directory: $PROJECT_DIR"
    exit 1
fi

"$UV_PATH" run python ccusage_importer.py

echo ""
echo "✅ Setup completed!"
echo "⏰ Cronjob will run every hour at minute 0"
echo "📝 Enhanced logging with timestamps enabled"
echo ""
echo "📁 Log files:"
echo "   - Main log: $LOG_DIR/import.log"
echo "   - Location: $LOG_DIR/"
echo ""
echo "🔧 Management commands:"
echo "   - View current crontab: crontab -l"
echo "   - View recent logs: tail -f $LOG_DIR/import.log"
echo "   - View log history: ls -la $LOG_DIR/"
echo "   - Test manual run: cd $PROJECT_DIR && uv run python ccusage_importer.py"
echo "   - Remove cronjob: crontab -e (then delete the ccusage line)"
echo ""
echo "🎯 Next steps:"
echo "   1. Verify cronjob: crontab -l | grep ccusage"
echo "   2. Monitor first run: tail -f $LOG_DIR/import.log"
echo "   3. Check ClickHouse data after import"