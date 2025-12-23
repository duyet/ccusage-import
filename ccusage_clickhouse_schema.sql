-- ClickHouse Schema for ccusage Data
-- Database: your_database
-- Author: Claude Code
-- Purpose: Store and analyze Claude Code usage data with support for visualization

-- Create database if not exists
CREATE DATABASE IF NOT EXISTS your_database;

USE your_database;

-- =======================
-- Core Usage Data Tables
-- =======================

-- Daily aggregated usage data
CREATE TABLE IF NOT EXISTS ccusage_usage_daily
(
    date Date,
    source String DEFAULT 'ccusage',  -- Data source: 'ccusage' or 'opencode'
    machine_name String,  -- Machine/hostname where data originated
    input_tokens UInt64,
    output_tokens UInt64,
    cache_creation_tokens UInt64,
    cache_read_tokens UInt64,
    total_tokens UInt64,
    total_cost Float64,
    models_count UInt16,
    created_at DateTime DEFAULT now(),
    updated_at DateTime DEFAULT now()
)
ENGINE = MergeTree()
PARTITION BY toYYYYMM(date)
ORDER BY (date, source, machine_name)
SETTINGS index_granularity = 8192;

-- Monthly aggregated usage data
CREATE TABLE IF NOT EXISTS ccusage_usage_monthly
(
    month String,  -- Format: "2025-08"
    year UInt16,
    month_num UInt8,
    source String DEFAULT 'ccusage',  -- Data source: 'ccusage' or 'opencode'
    machine_name String,  -- Machine/hostname where data originated
    input_tokens UInt64,
    output_tokens UInt64,
    cache_creation_tokens UInt64,
    cache_read_tokens UInt64,
    total_tokens UInt64,
    total_cost Float64,
    models_count UInt16,
    created_at DateTime DEFAULT now(),
    updated_at DateTime DEFAULT now()
)
ENGINE = MergeTree()
PARTITION BY year
ORDER BY (year, month_num, source, machine_name)
SETTINGS index_granularity = 8192;

-- Session-based usage data (grouped by project directory)
CREATE TABLE IF NOT EXISTS ccusage_usage_sessions
(
    session_id String,  -- Actually project directory path
    project_path String,
    source String DEFAULT 'ccusage',  -- Data source: 'ccusage' or 'opencode'
    machine_name String,  -- Machine/hostname where data originated
    input_tokens UInt64,
    output_tokens UInt64,
    cache_creation_tokens UInt64,
    cache_read_tokens UInt64,
    total_tokens UInt64,
    total_cost Float64,
    last_activity Date,
    models_count UInt16,
    created_at DateTime DEFAULT now(),
    updated_at DateTime DEFAULT now()
)
ENGINE = MergeTree()
PARTITION BY toYYYYMM(last_activity)
ORDER BY (session_id, source, machine_name, last_activity)
SETTINGS index_granularity = 8192;

-- 5-hour billing blocks usage data
CREATE TABLE IF NOT EXISTS ccusage_usage_blocks
(
    block_id String,
    source String DEFAULT 'ccusage',  -- Data source: 'ccusage' or 'opencode'
    machine_name String,  -- Machine/hostname where data originated
    start_time DateTime,
    end_time DateTime,
    actual_end_time Nullable(DateTime),
    is_active UInt8,  -- Boolean: 0=false, 1=true
    is_gap UInt8,     -- Boolean: 0=false, 1=true
    entries UInt32,
    input_tokens UInt64,
    output_tokens UInt64,
    cache_creation_tokens UInt64,
    cache_read_tokens UInt64,
    total_tokens UInt64,
    cost_usd Float64,
    models_count UInt16,
    usage_limit_reset_time Nullable(DateTime),
    burn_rate Nullable(Float64),
    projection Nullable(Float64),
    created_at DateTime DEFAULT now(),
    updated_at DateTime DEFAULT now()
)
ENGINE = MergeTree()
PARTITION BY toYYYYMM(start_time)
ORDER BY (start_time, source, machine_name, block_id)
SETTINGS index_granularity = 8192;

-- Daily usage data broken down by project
CREATE TABLE IF NOT EXISTS ccusage_usage_projects_daily
(
    date Date,
    project_id String,  -- Session ID / Project directory
    source String DEFAULT 'ccusage',  -- Data source: 'ccusage' or 'opencode'
    machine_name String,  -- Machine/hostname where data originated
    input_tokens UInt64,
    output_tokens UInt64,
    cache_creation_tokens UInt64,
    cache_read_tokens UInt64,
    total_tokens UInt64,
    total_cost Float64,
    models_count UInt16,
    created_at DateTime DEFAULT now(),
    updated_at DateTime DEFAULT now()
)
ENGINE = MergeTree()
PARTITION BY toYYYYMM(date)
ORDER BY (date, source, machine_name, project_id)
SETTINGS index_granularity = 8192;

-- =========================
-- Model Breakdown Tables
-- =========================

-- Detailed model breakdowns for each usage record
CREATE TABLE IF NOT EXISTS ccusage_model_breakdowns
(
    record_type Enum8('daily' = 1, 'monthly' = 2, 'session' = 3, 'block' = 4, 'project_daily' = 5),
    record_key String,  -- Primary key of the parent record (date, month, session_id, block_id, etc.)
    source String DEFAULT 'ccusage',  -- Data source: 'ccusage' or 'opencode'
    machine_name String,  -- Machine/hostname where data originated
    model_name String,
    input_tokens UInt64,
    output_tokens UInt64,
    cache_creation_tokens UInt64,
    cache_read_tokens UInt64,
    cost Float64,
    created_at DateTime DEFAULT now()
)
ENGINE = MergeTree()
PARTITION BY record_type
ORDER BY (record_type, source, machine_name, record_key, model_name)
SETTINGS index_granularity = 8192;

-- Models used in each usage record (many-to-many relationship)
CREATE TABLE IF NOT EXISTS ccusage_models_used
(
    record_type Enum8('daily' = 1, 'monthly' = 2, 'session' = 3, 'block' = 4, 'project_daily' = 5),
    record_key String,  -- Primary key of the parent record
    source String DEFAULT 'ccusage',  -- Data source: 'ccusage' or 'opencode'
    machine_name String,  -- Machine/hostname where data originated
    model_name String,
    created_at DateTime DEFAULT now()
)
ENGINE = MergeTree()
PARTITION BY record_type
ORDER BY (record_type, source, machine_name, record_key, model_name)
SETTINGS index_granularity = 8192;

-- ===============================
-- Materialized Views for Analytics
-- ===============================

-- Real-time cost analysis by model across all record types
CREATE MATERIALIZED VIEW IF NOT EXISTS ccusage_mv_cost_by_model
ENGINE = AggregatingMergeTree()
PARTITION BY toYYYYMM(created_at)
ORDER BY (model_name, source, machine_name, toDate(created_at))
AS SELECT
    model_name,
    source,
    machine_name,
    toDate(created_at) as date,
    sumState(cost) as total_cost,
    sumState(input_tokens) as total_input_tokens,
    sumState(output_tokens) as total_output_tokens,
    sumState(cache_creation_tokens + cache_read_tokens) as total_cache_tokens,
    countState() as usage_count,
    created_at
FROM ccusage_model_breakdowns
GROUP BY model_name, source, machine_name, toDate(created_at), created_at;

-- Daily usage trends
CREATE MATERIALIZED VIEW IF NOT EXISTS ccusage_mv_daily_trends
ENGINE = AggregatingMergeTree()
PARTITION BY toYYYYMM(date)
ORDER BY (date, source, machine_name)
AS SELECT
    date,
    source,
    machine_name,
    sumState(total_cost) as daily_cost,
    sumState(total_tokens) as daily_tokens,
    sumState(input_tokens) as daily_input_tokens,
    sumState(output_tokens) as daily_output_tokens,
    sumState(cache_creation_tokens + cache_read_tokens) as daily_cache_tokens,
    uniqState(models_count) as unique_models,
    avgState(total_cost) as avg_cost_per_session
FROM (
    SELECT date, source, machine_name, total_cost, total_tokens, input_tokens, output_tokens,
           cache_creation_tokens, cache_read_tokens, models_count
    FROM ccusage_usage_daily
    UNION ALL
    SELECT date, source, machine_name, total_cost, total_tokens, input_tokens, output_tokens,
           cache_creation_tokens, cache_read_tokens, models_count
    FROM ccusage_usage_projects_daily
)
GROUP BY date, source, machine_name;

-- Top projects by cost
CREATE MATERIALIZED VIEW IF NOT EXISTS ccusage_mv_top_projects
ENGINE = AggregatingMergeTree()
PARTITION BY toYYYYMM(last_activity)
ORDER BY (last_activity, source, machine_name, session_id)
AS SELECT
    session_id,
    project_path,
    source,
    machine_name,
    last_activity,
    sumState(total_cost) as project_total_cost,
    sumState(total_tokens) as project_total_tokens,
    maxState(last_activity) as latest_activity
FROM ccusage_usage_sessions
GROUP BY session_id, project_path, source, machine_name, last_activity;

-- ======================
-- Indexes for Performance
-- ======================

-- Indexes for efficient date range queries
ALTER TABLE ccusage_usage_daily ADD INDEX idx_date_cost (date, total_cost) TYPE minmax GRANULARITY 1;
ALTER TABLE ccusage_usage_monthly ADD INDEX idx_year_cost (year, total_cost) TYPE minmax GRANULARITY 1;
ALTER TABLE ccusage_usage_sessions ADD INDEX idx_activity_cost (last_activity, total_cost) TYPE minmax GRANULARITY 1;
ALTER TABLE ccusage_usage_blocks ADD INDEX idx_start_cost (start_time, cost_usd) TYPE minmax GRANULARITY 1;
ALTER TABLE ccusage_usage_projects_daily ADD INDEX idx_date_project (date, project_id) TYPE set(100) GRANULARITY 1;

-- Indexes for model analysis
ALTER TABLE ccusage_model_breakdowns ADD INDEX idx_model_cost (model_name, cost) TYPE minmax GRANULARITY 1;
ALTER TABLE ccusage_models_used ADD INDEX idx_model_record (record_type, model_name) TYPE set(100) GRANULARITY 1;

-- ==========================
-- Helper Views for Dashboard
-- ==========================

-- Simple view for daily cost analysis
CREATE VIEW IF NOT EXISTS ccusage_v_daily_summary AS
SELECT
    date,
    source,
    machine_name,
    total_cost,
    total_tokens,
    input_tokens,
    output_tokens,
    cache_creation_tokens + cache_read_tokens as cache_tokens,
    models_count,
    total_cost / total_tokens * 1000000 as cost_per_million_tokens
FROM ccusage_usage_daily
ORDER BY date DESC, source, machine_name;

-- Session summary with clean project names
CREATE VIEW IF NOT EXISTS ccusage_v_session_summary AS
SELECT
    session_id,
    source,
    machine_name,
    CASE
        WHEN session_id LIKE '%-Users-duet-project-%'
        THEN regexp_replace(session_id, '.*-Users-duet-project-', '')
        ELSE session_id
    END as project_name,
    project_path,
    total_cost,
    total_tokens,
    last_activity,
    total_cost / total_tokens * 1000000 as cost_per_million_tokens
FROM ccusage_usage_sessions
ORDER BY total_cost DESC;

-- Model performance analysis
CREATE VIEW IF NOT EXISTS ccusage_v_model_performance AS
SELECT
    model_name,
    source,
    machine_name,
    sum(cost) as total_cost,
    sum(input_tokens + output_tokens + cache_creation_tokens + cache_read_tokens) as total_tokens,
    avg(cost) as avg_cost_per_usage,
    count() as usage_count,
    sum(cost) / sum(input_tokens + output_tokens + cache_creation_tokens + cache_read_tokens) * 1000000 as cost_per_million_tokens
FROM ccusage_model_breakdowns
GROUP BY model_name, source, machine_name
ORDER BY total_cost DESC;

-- Monthly trends analysis
CREATE VIEW IF NOT EXISTS ccusage_v_monthly_trends AS
SELECT
    month,
    year,
    month_num,
    source,
    machine_name,
    total_cost,
    total_tokens,
    total_cost / total_tokens * 1000000 as cost_per_million_tokens
FROM ccusage_usage_monthly
ORDER BY year, month_num, source, machine_name;

-- Active blocks analysis (for current usage monitoring)
CREATE VIEW IF NOT EXISTS ccusage_v_active_blocks AS
SELECT
    block_id,
    source,
    machine_name,
    start_time,
    end_time,
    actual_end_time,
    is_active,
    entries,
    cost_usd,
    total_tokens,
    burn_rate,
    projection,
    CASE
        WHEN is_active = 1 AND projection IS NOT NULL
        THEN projection
        ELSE cost_usd
    END as projected_cost
FROM ccusage_usage_blocks
WHERE is_gap = 0
ORDER BY start_time DESC;

-- =======================
-- Data Retention Policies
-- =======================

-- Keep detailed data for 2 years, then compress
ALTER TABLE ccusage_usage_daily MODIFY TTL date + INTERVAL 2 YEAR;
ALTER TABLE ccusage_usage_blocks MODIFY TTL start_time + INTERVAL 2 YEAR;
ALTER TABLE ccusage_model_breakdowns MODIFY TTL created_at + INTERVAL 2 YEAR;

-- Keep aggregated monthly data indefinitely (no TTL)
-- Keep session data for 3 years
ALTER TABLE ccusage_usage_sessions MODIFY TTL last_activity + INTERVAL 3 YEAR;

-- =======================
-- Comments and Documentation
-- =======================

-- Add table comments
-- ================================
-- Import History and Statistics  
-- ================================

-- Store import statistics history for comparison and trending
CREATE TABLE IF NOT EXISTS ccusage_import_history
(
    import_timestamp DateTime DEFAULT now(),
    machine_name String,
    import_duration_seconds Float32,
    statistics_json String,  -- JSON blob containing all import statistics
    import_status String DEFAULT 'completed',  -- 'completed', 'failed', 'partial'
    records_imported UInt32 DEFAULT 0,
    data_hash String DEFAULT '',  -- Hash of imported data to detect identical imports
    created_at DateTime DEFAULT now()
)
ENGINE = MergeTree()
PARTITION BY toYYYYMM(import_timestamp)
ORDER BY (import_timestamp, machine_name)
SETTINGS index_granularity = 8192;

-- =======================
-- Table Comments
-- =======================

ALTER TABLE ccusage_usage_daily COMMENT 'Daily aggregated Claude Code usage data from ccusage daily command';
ALTER TABLE ccusage_usage_monthly COMMENT 'Monthly aggregated Claude Code usage data from ccusage monthly command';
ALTER TABLE ccusage_usage_sessions COMMENT 'Session-based Claude Code usage data from ccusage session command (grouped by project directory)';
ALTER TABLE ccusage_usage_blocks COMMENT '5-hour billing block Claude Code usage data from ccusage blocks command';
ALTER TABLE ccusage_usage_projects_daily COMMENT 'Daily usage data broken down by project from ccusage daily --instances command';
ALTER TABLE ccusage_model_breakdowns COMMENT 'Detailed token and cost breakdown by AI model for each usage record';
ALTER TABLE ccusage_models_used COMMENT 'List of AI models used in each usage record (many-to-many relationship)';
ALTER TABLE ccusage_import_history COMMENT 'Historical record of import statistics for trending and comparison analysis';