-- Migration: Add source column to distinguish between ccusage and OpenCode data
--
-- IMPORTANT: Run this migration BEFORE enabling OpenCode import support
-- This adds a 'source' column to all existing tables with a default value of 'ccusage'
-- to distinguish between data imported from ccusage vs OpenCode
--
-- Usage:
--   clickhouse-client --user=username --password=password --database=database --multiquery < migrate_add_source.sql
--
-- Or via SSH:
--   ssh user@your-host 'clickhouse-client --user=username --password=password --database=database --multiquery' < migrate_add_source.sql

-- ============================================================
-- Step 1: Add source column to all main tables
-- ============================================================
-- The DEFAULT 'ccusage' ensures all existing rows are tagged as ccusage data
-- New rows can specify source='ccusage' or source='opencode' during import

ALTER TABLE ccusage_usage_daily ADD COLUMN source String DEFAULT 'ccusage';
ALTER TABLE ccusage_usage_monthly ADD COLUMN source String DEFAULT 'ccusage';
ALTER TABLE ccusage_usage_sessions ADD COLUMN source String DEFAULT 'ccusage';
ALTER TABLE ccusage_usage_blocks ADD COLUMN source String DEFAULT 'ccusage';
ALTER TABLE ccusage_usage_projects_daily ADD COLUMN source String DEFAULT 'ccusage';
ALTER TABLE ccusage_model_breakdowns ADD COLUMN source String DEFAULT 'ccusage';
ALTER TABLE ccusage_models_used ADD COLUMN source String DEFAULT 'ccusage';

-- ============================================================
-- Step 2: Verify the migration
-- ============================================================
-- This query checks:
-- 1. Total row count in each table (should match pre-migration counts)
-- 2. Number of unique source values (should be 1 for existing 'ccusage' data)
-- After running OpenCode imports, this will show 2 unique sources

SELECT
    'ccusage_usage_daily' as table_name,
    count() as total_rows,
    uniq(source) as sources,
    groupUniqArray(source) as source_values
FROM ccusage_usage_daily
UNION ALL
SELECT
    'ccusage_usage_monthly',
    count(),
    uniq(source),
    groupUniqArray(source)
FROM ccusage_usage_monthly
UNION ALL
SELECT
    'ccusage_usage_sessions',
    count(),
    uniq(source),
    groupUniqArray(source)
FROM ccusage_usage_sessions
UNION ALL
SELECT
    'ccusage_usage_blocks',
    count(),
    uniq(source),
    groupUniqArray(source)
FROM ccusage_usage_blocks
UNION ALL
SELECT
    'ccusage_usage_projects_daily',
    count(),
    uniq(source),
    groupUniqArray(source)
FROM ccusage_usage_projects_daily
UNION ALL
SELECT
    'ccusage_model_breakdowns',
    count(),
    uniq(source),
    groupUniqArray(source)
FROM ccusage_model_breakdowns
UNION ALL
SELECT
    'ccusage_models_used',
    count(),
    uniq(source),
    groupUniqArray(source)
FROM ccusage_models_used
ORDER BY table_name;

-- ============================================================
-- Expected Results After Migration
-- ============================================================
-- Before OpenCode import:
--   - sources column: 1 (only 'ccusage')
--   - source_values: ['ccusage']
--
-- After enabling OpenCode imports:
--   - sources column: 2 (both 'ccusage' and 'opencode')
--   - source_values: ['ccusage','opencode']
--
-- ============================================================
-- Rollback (if needed)
-- ============================================================
-- To remove the source column (NOT recommended after data is mixed):
-- ALTER TABLE ccusage_usage_daily DROP COLUMN source;
-- ALTER TABLE ccusage_usage_monthly DROP COLUMN source;
-- ALTER TABLE ccusage_usage_sessions DROP COLUMN source;
-- ALTER TABLE ccusage_usage_blocks DROP COLUMN source;
-- ALTER TABLE ccusage_usage_projects_daily DROP COLUMN source;
-- ALTER TABLE ccusage_model_breakdowns DROP COLUMN source;
-- ALTER TABLE ccusage_models_used DROP COLUMN source;
