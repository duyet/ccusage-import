#!/bin/bash
# Verification script for ccusage ClickHouse setup

echo "=== ClickHouse ccusage Setup Verification ==="

# Check if tables exist
echo "1. Checking if tables exist..."
ssh user@your-host "clickhouse-client --user=username --password='password' --database=database --query='SHOW TABLES'"

echo -e "\n2. Checking table structures..."

# Check table row counts
echo "3. Checking table row counts..."
ssh user@your-host "clickhouse-client --user=username --password='password' --database=database --query='
SELECT 
    \"usage_daily\" as table_name, count() as rows FROM usage_daily
UNION ALL
SELECT 
    \"usage_monthly\" as table_name, count() as rows FROM usage_monthly
UNION ALL
SELECT 
    \"usage_sessions\" as table_name, count() as rows FROM usage_sessions
UNION ALL
SELECT 
    \"usage_blocks\" as table_name, count() as rows FROM usage_blocks
UNION ALL
SELECT 
    \"usage_projects_daily\" as table_name, count() as rows FROM usage_projects_daily
UNION ALL
SELECT 
    \"model_breakdowns\" as table_name, count() as rows FROM model_breakdowns
UNION ALL
SELECT 
    \"models_used\" as table_name, count() as rows FROM models_used
ORDER BY table_name
'"

echo -e "\n4. Testing views..."
ssh user@your-host "clickhouse-client --user=username --password='password' --database=database --query='SELECT * FROM v_daily_summary LIMIT 3'"

echo -e "\n5. Checking if ccusage command works..."
npx ccusage@latest --help > /dev/null 2>&1
if [ $? -eq 0 ]; then
    echo "✓ ccusage command is available"
else
    echo "✗ ccusage command not found"
fi

echo -e "\n6. Testing a sample query..."
ssh user@your-host "clickhouse-client --user=username --password='password' --database=database --query='
SELECT 
    \"Total Tables\" as metric, 
    toString(count()) as value 
FROM system.tables 
WHERE database = \"database\"
'"

echo -e "\nSetup verification completed!"
echo "Files created:"
echo "- /tmp/ccusage_clickhouse_schema.sql - Complete schema"
echo "- /tmp/ccusage_importer.py - Data import script"
echo "- /tmp/setup_cronjob.sh - Cronjob setup script"  
echo "- /tmp/ccusage_queries.sql - 25 SQL queries for visualization"
echo "- /tmp/verify_setup.sh - This verification script"