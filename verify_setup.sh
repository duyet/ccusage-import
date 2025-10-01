#!/bin/bash
# Verification script for ccusage ClickHouse setup

# Load environment variables (same as ccusage_importer.py)
CH_HOST=${CH_HOST:-"localhost"}
CH_PORT=${CH_PORT:-8123}
CH_USER=${CH_USER:-"default"}
CH_PASSWORD=${CH_PASSWORD:-""}
CH_DATABASE=${CH_DATABASE:-"default"}

# Auto-detect HTTPS based on port (same logic as ccusage_importer.py)
if [ -z "$CH_PROTOCOL" ]; then
    case "$CH_PORT" in
        443|8443|9440)
            CH_PROTOCOL="https"
            ;;
        *)
            CH_PROTOCOL="http"
            ;;
    esac
else
    CH_PROTOCOL=${CH_PROTOCOL}
fi

echo "=== ClickHouse ccusage Setup Verification ==="
echo "📊 Connection: $CH_USER@$CH_HOST:$CH_PORT/$CH_DATABASE"
echo ""

# Build ClickHouse HTTP/HTTPS URL and auth
CH_PROTOCOL=${CH_PROTOCOL:-"http"}
CH_URL="$CH_PROTOCOL://$CH_HOST:$CH_PORT"
if [ -n "$CH_PASSWORD" ]; then
    CH_AUTH="--user $CH_USER:$CH_PASSWORD"
else
    CH_AUTH="--user $CH_USER"
fi

# Function to execute ClickHouse query via HTTP
execute_query() {
    local query="$1"
    curl -s $CH_AUTH \
         -H "Content-Type: text/plain" \
         -d "$query" \
         "$CH_URL/?database=$CH_DATABASE"
}

# Test basic connectivity first
echo "0. Testing ClickHouse HTTP connectivity..."
CONNECTION_TEST=$(execute_query "SELECT 1 as test" 2>/dev/null)
if [ $? -eq 0 ] && [ "$CONNECTION_TEST" = "1" ]; then
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
VIEWS_RESULT=$(execute_query "SELECT * FROM ccusage_v_daily_summary LIMIT 3" 2>/dev/null)
if [ $? -eq 0 ] && [ -n "$VIEWS_RESULT" ]; then
    echo "$VIEWS_RESULT"
else
    echo "❌ Views not found (run schema setup first)"
fi

echo -e "\n4. Checking if ccusage command works..."
# Try to detect npx/bunx first
NPX_PATH=$(which npx 2>/dev/null || echo "")
BUNX_PATH=$(which bunx 2>/dev/null || echo "")

if [ -n "$NPX_PATH" ]; then
    npx ccusage@latest --help > /dev/null 2>&1
    if [ $? -eq 0 ]; then
        echo "✅ ccusage command available via npx ($NPX_PATH)"
    else
        echo "❌ ccusage command not working via npx"
    fi
elif [ -n "$BUNX_PATH" ]; then
    bunx ccusage@latest --help > /dev/null 2>&1
    if [ $? -eq 0 ]; then
        echo "✅ ccusage command available via bunx ($BUNX_PATH)"
    else
        echo "❌ ccusage command not working via bunx"
    fi
else
    echo "❌ Neither npx nor bunx found in PATH"
fi

echo -e "\n5. Testing ClickHouse connection..."
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