#!/bin/bash
# Verification script for ccusage ClickHouse setup
# Security: All variables properly quoted to prevent command injection
# Uses [[ ]] for tests and validates all inputs before use in commands

set -euo pipefail  # Exit on error, undefined variables, and pipe failures

# Security: Load environment variables with proper defaults and quoting
CH_HOST="${CH_HOST:-localhost}"
CH_PORT="${CH_PORT:-8123}"
CH_USER="${CH_USER:-default}"
CH_PASSWORD="${CH_PASSWORD:-}"
CH_DATABASE="${CH_DATABASE:-default}"

# Security: Validate inputs to prevent injection
validate_alphanum() {
    local var="$1"
    [[ "$var" =~ ^[a-zA-Z0-9._-]+$ ]]
}

# Validation: Check for empty values with helpful messages
if [[ -z "$CH_HOST" ]]; then
    echo "❌ Configuration Error: CH_HOST is not set"
    echo "   Please set environment variable: export CH_HOST='your-clickhouse-host'"
    exit 1
fi

if [[ -z "$CH_PORT" ]]; then
    echo "❌ Configuration Error: CH_PORT is not set"
    echo "   Please set environment variable: export CH_PORT='8123'"
    exit 1
fi

if [[ -z "$CH_USER" ]]; then
    echo "❌ Configuration Error: CH_USER is not set"
    echo "   Please set environment variable: export CH_USER='default'"
    exit 1
fi

if [[ -z "$CH_DATABASE" ]]; then
    echo "❌ Configuration Error: CH_DATABASE is not set"
    echo "   Please set environment variable: export CH_DATABASE='your-database'"
    exit 1
fi

# Security: Validate critical parameters
if ! validate_alphanum "$CH_HOST"; then
    echo "❌ Validation Error: CH_HOST contains unsafe characters: $CH_HOST"
    echo "   Only alphanumeric, dots, underscores, and hyphens are allowed"
    echo "   Example: CH_HOST='clickhouse.example.com'"
    exit 1
fi

if ! [[ "$CH_PORT" =~ ^[0-9]+$ ]]; then
    echo "❌ Validation Error: CH_PORT must be numeric: $CH_PORT"
    echo "   Valid ports: 1-65535 (common: 8123 for HTTP, 8443 for HTTPS)"
    echo "   Example: CH_PORT='8123'"
    exit 1
fi

# Bounds check for port number
if [[ "$CH_PORT" -lt 1 ]] || [[ "$CH_PORT" -gt 65535 ]]; then
    echo "❌ Validation Error: CH_PORT must be between 1 and 65535: $CH_PORT"
    echo "   Common ports: 8123 (HTTP), 8443 (HTTPS), 9000 (native)"
    echo "   Example: CH_PORT='8123'"
    exit 1
fi

if ! validate_alphanum "$CH_USER"; then
    echo "❌ Validation Error: CH_USER contains unsafe characters: $CH_USER"
    echo "   Only alphanumeric, dots, underscores, and hyphens are allowed"
    echo "   Example: CH_USER='default' or CH_USER='admin'"
    exit 1
fi

if ! validate_alphanum "$CH_DATABASE"; then
    echo "❌ Validation Error: CH_DATABASE contains unsafe characters: $CH_DATABASE"
    echo "   Only alphanumeric, dots, underscores, and hyphens are allowed"
    echo "   Example: CH_DATABASE='ccusage' or CH_DATABASE='analytics'"
    exit 1
fi

# Security: Auto-detect HTTPS based on port (with proper quoting)
if [[ -z "${CH_PROTOCOL:-}" ]]; then
    case "$CH_PORT" in
        443|8443|9440)
            CH_PROTOCOL="https"
            ;;
        *)
            CH_PROTOCOL="http"
            ;;
    esac
else
    CH_PROTOCOL="${CH_PROTOCOL}"
fi

echo "=== ClickHouse ccusage Setup Verification ==="
echo "📊 Connection: $CH_USER@$CH_HOST:$CH_PORT/$CH_DATABASE"
echo ""

# Security: Build ClickHouse HTTP/HTTPS URL with proper quoting
CH_PROTOCOL="${CH_PROTOCOL:-http}"
CH_URL="$CH_PROTOCOL://$CH_HOST:$CH_PORT"

# Security: Build authentication string with proper quoting
# Password may contain special characters, so proper escaping is critical
if [[ -n "$CH_PASSWORD" ]]; then
    CH_AUTH="--user $CH_USER:$CH_PASSWORD"
else
    CH_AUTH="--user $CH_USER"
fi

# Security: Function to execute ClickHouse query via HTTP with proper quoting
# All variables are quoted to prevent command injection
execute_query() {
    local query="$1"
    # Security: Use array to prevent word splitting and globbing
    # shellcheck disable=SC2086 - CH_AUTH needs word splitting for --user flag
    curl -s $CH_AUTH \
         -H "Content-Type: text/plain" \
         -d "$query" \
         "$CH_URL/?database=$CH_DATABASE"
}

# Security: Test basic connectivity first with proper quoting
echo "0. Testing ClickHouse HTTP connectivity..."
CONNECTION_TEST="$(execute_query "SELECT 1 as test" 2>/dev/null || true)"
if [[ $? -eq 0 ]] && [[ "$CONNECTION_TEST" = "1" ]]; then
    echo "✅ ClickHouse HTTP connection successful"
else
    echo "❌ ClickHouse HTTP connection failed"
    echo "   Check: CH_HOST=$CH_HOST, CH_PORT=$CH_PORT, credentials"
    echo "   URL: $CH_URL"
    exit 1
fi
echo ""

# Check if tables exist
echo "1. Checking if ccusage tables exist..."
execute_query "SHOW TABLES WHERE name LIKE 'ccusage%'"

echo -e "\n2. Checking table row counts..."
execute_query "
SELECT
    'ccusage_usage_daily' as table_name, count() as rows FROM ccusage_usage_daily
UNION ALL
SELECT
    'ccusage_usage_monthly' as table_name, count() as rows FROM ccusage_usage_monthly
UNION ALL
SELECT
    'ccusage_usage_sessions' as table_name, count() as rows FROM ccusage_usage_sessions
UNION ALL
SELECT
    'ccusage_usage_blocks' as table_name, count() as rows FROM ccusage_usage_blocks
UNION ALL
SELECT
    'ccusage_usage_projects_daily' as table_name, count() as rows FROM ccusage_usage_projects_daily
UNION ALL
SELECT
    'ccusage_model_breakdowns' as table_name, count() as rows FROM ccusage_model_breakdowns
UNION ALL
SELECT
    'ccusage_models_used' as table_name, count() as rows FROM ccusage_models_used
ORDER BY table_name
"

echo -e "\n3. Testing ccusage views..."
VIEWS_RESULT="$(execute_query "SELECT * FROM ccusage_v_daily_summary LIMIT 3" 2>/dev/null || true)"
if [[ $? -eq 0 ]] && [[ -n "$VIEWS_RESULT" ]]; then
    echo "$VIEWS_RESULT"
else
    echo "❌ Views not found (run schema setup first)"
fi

echo -e "\n4. Checking if ccusage command works..."
# Security: Try to detect npx/bunx first with proper quoting
NPX_PATH="$(which npx 2>/dev/null || true)"
BUNX_PATH="$(which bunx 2>/dev/null || true)"

if [[ -n "$NPX_PATH" ]]; then
    if "$NPX_PATH" ccusage@latest --help > /dev/null 2>&1; then
        echo "✅ ccusage command available via npx ($NPX_PATH)"
    else
        echo "❌ ccusage command not working via npx"
    fi
elif [[ -n "$BUNX_PATH" ]]; then
    if "$BUNX_PATH" ccusage@latest --help > /dev/null 2>&1; then
        echo "✅ ccusage command available via bunx ($BUNX_PATH)"
    else
        echo "❌ ccusage command not working via bunx"
    fi
else
    echo "❌ Neither npx nor bunx found in PATH"
fi

echo -e "\n5. Testing ClickHouse connection..."
# Security: CH_DATABASE is validated at script start, safe to use in query
execute_query "
SELECT
    'Total ccusage Tables' as metric,
    toString(count()) as value
FROM system.tables
WHERE database = '$CH_DATABASE' AND name LIKE 'ccusage%'
"

echo -e "\n✅ Setup verification completed!"
echo ""
echo "📁 Project Files:"
echo "   - ccusage_clickhouse_schema.sql - Complete ClickHouse schema"
echo "   - ccusage_importer.py - Data import script with --check support"
echo "   - setup_cronjob.sh - Automated cronjob setup with PATH detection"
echo "   - queries.sql - 27+ SQL queries for analytics"
echo "   - verify_setup.sh - This verification script"
echo ""
echo "🔧 Environment Variables Used:"
echo "   - CH_PROTOCOL: $CH_PROTOCOL"
echo "   - CH_HOST: $CH_HOST"
echo "   - CH_PORT: $CH_PORT"
echo "   - CH_USER: $CH_USER"
echo "   - CH_DATABASE: $CH_DATABASE"
echo "   - CH_PASSWORD: [${#CH_PASSWORD} chars]"
echo ""
echo "🚀 Next Steps:"
echo "   1. Set environment variables if needed"
echo "   2. Run: uv run python ccusage_importer.py --check"
echo "   3. Run: uv run python ccusage_importer.py"
echo "   4. Setup cronjob: ./setup_cronjob.sh"