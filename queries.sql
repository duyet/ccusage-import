-- ClickHouse SQL Queries for ccusage Data Visualization (Updated with ccusage_ prefix)
-- Database: duyet_analytics
-- Use these queries for building dashboards and analytics
-- Now includes multi-machine support for tracking usage across different machines

USE duyet_analytics;

-- ======================
-- Daily Analysis Queries
-- ======================

-- 1. Daily cost and token usage trends (last 30 days)
SELECT 
    date,
    total_cost,
    total_tokens,
    input_tokens,
    output_tokens,
    cache_creation_tokens + cache_read_tokens as cache_tokens,
    total_cost / total_tokens * 1000000 as cost_per_million_tokens
FROM ccusage_usage_daily 
WHERE date >= today() - INTERVAL 30 DAY
ORDER BY date DESC;

-- 2. Daily cost vs previous day (percentage change)
SELECT 
    date,
    total_cost,
    total_cost - lagInFrame(total_cost) OVER (ORDER BY date) as cost_change,
    (total_cost - lagInFrame(total_cost) OVER (ORDER BY date)) / lagInFrame(total_cost) OVER (ORDER BY date) * 100 as cost_change_percent
FROM ccusage_usage_daily 
WHERE date >= today() - INTERVAL 7 DAY
ORDER BY date DESC;

-- 3. Highest cost days (top 10)
SELECT 
    date,
    total_cost,
    total_tokens,
    models_count,
    total_cost / total_tokens * 1000000 as cost_per_million_tokens
FROM ccusage_usage_daily 
ORDER BY total_cost DESC 
LIMIT 10;

-- ======================
-- Model Analysis Queries
-- ======================

-- 4. Cost breakdown by AI model (all time)
SELECT 
    model_name,
    sum(cost) as total_cost,
    sum(input_tokens + output_tokens + cache_creation_tokens + cache_read_tokens) as total_tokens,
    avg(cost) as avg_cost_per_usage,
    count() as usage_count,
    sum(cost) / sum(input_tokens + output_tokens + cache_creation_tokens + cache_read_tokens) * 1000000 as cost_per_million_tokens
FROM ccusage_model_breakdowns
GROUP BY model_name
ORDER BY total_cost DESC;

-- 5. Model usage trends over time (last 30 days)
SELECT 
    toDate(created_at) as date,
    model_name,
    sum(cost) as daily_cost,
    sum(input_tokens + output_tokens + cache_creation_tokens + cache_read_tokens) as daily_tokens
FROM ccusage_model_breakdowns
WHERE created_at >= today() - INTERVAL 30 DAY
GROUP BY date, model_name
ORDER BY date DESC, daily_cost DESC;

-- 6. Most expensive model operations (top 20)
SELECT 
    record_type,
    record_key,
    model_name,
    cost,
    input_tokens + output_tokens + cache_creation_tokens + cache_read_tokens as total_tokens,
    cost / (input_tokens + output_tokens + cache_creation_tokens + cache_read_tokens) * 1000000 as cost_per_million_tokens,
    created_at
FROM ccusage_model_breakdowns
ORDER BY cost DESC
LIMIT 20;

-- ======================
-- Project Analysis Queries
-- ======================

-- 7. Project cost analysis (session-based)
SELECT 
    session_id,
    replaceRegexpOne(session_id, '.*-Users-duet-project-', '') as project_name,
    total_cost,
    total_tokens,
    last_activity,
    datediff('day', last_activity, today()) as days_since_activity,
    total_cost / total_tokens * 1000000 as cost_per_million_tokens
FROM ccusage_usage_sessions
ORDER BY total_cost DESC;

-- 8. Project activity timeline (last 30 days)
SELECT 
    date,
    project_id,
    replaceRegexpOne(project_id, '.*-Users-duet-project-', '') as project_name,
    total_cost,
    total_tokens
FROM ccusage_usage_projects_daily
WHERE date >= today() - INTERVAL 30 DAY
ORDER BY date DESC, total_cost DESC;

-- 9. Most active projects by token usage
SELECT 
    session_id,
    replaceRegexpOne(session_id, '.*-Users-duet-project-', '') as project_name,
    total_tokens,
    total_cost,
    last_activity,
    total_tokens / total_cost as tokens_per_dollar
FROM ccusage_usage_sessions
WHERE total_tokens > 0
ORDER BY total_tokens DESC
LIMIT 15;

-- ======================
-- Time-based Analysis Queries
-- ======================

-- 10. Hourly usage patterns (from blocks data)
SELECT 
    toHour(start_time) as hour_of_day,
    avg(cost_usd) as avg_hourly_cost,
    sum(cost_usd) as total_cost,
    count() as block_count,
    sum(total_tokens) as total_tokens
FROM ccusage_usage_blocks
WHERE is_gap = 0 AND start_time >= today() - INTERVAL 7 DAY
GROUP BY hour_of_day
ORDER BY hour_of_day;

-- 11. Weekly cost trends
SELECT 
    toStartOfWeek(date) as week_start,
    sum(total_cost) as weekly_cost,
    sum(total_tokens) as weekly_tokens,
    avg(total_cost) as avg_daily_cost,
    count() as active_days
FROM ccusage_usage_daily
GROUP BY week_start
ORDER BY week_start DESC;

-- 12. Monthly spending summary
SELECT 
    month,
    year,
    total_cost,
    total_tokens,
    models_count,
    total_cost / total_tokens * 1000000 as cost_per_million_tokens,
    total_cost - lagInFrame(total_cost) OVER (ORDER BY year, month_num) as cost_change_from_prev_month
FROM ccusage_usage_monthly
ORDER BY year DESC, month_num DESC;

-- ======================
-- Performance Analysis Queries
-- ======================

-- 13. Cache efficiency analysis
SELECT 
    date,
    input_tokens + output_tokens as direct_tokens,
    cache_creation_tokens + cache_read_tokens as cache_tokens,
    (cache_creation_tokens + cache_read_tokens) / (input_tokens + output_tokens + cache_creation_tokens + cache_read_tokens) * 100 as cache_percentage,
    total_cost
FROM ccusage_usage_daily
WHERE date >= today() - INTERVAL 30 DAY
ORDER BY date DESC;

-- 14. Cost efficiency by project (tokens per dollar)
SELECT 
    session_id,
    replaceRegexpOne(session_id, '.*-Users-duet-project-', '') as project_name,
    total_cost,
    total_tokens,
    total_tokens / total_cost as tokens_per_dollar,
    total_cost / total_tokens * 1000000 as cost_per_million_tokens,
    last_activity
FROM ccusage_usage_sessions
WHERE total_cost > 0
ORDER BY tokens_per_dollar DESC
LIMIT 20;

-- ======================
-- Real-time Monitoring Queries
-- ======================

-- 15. Current active blocks and projections
SELECT 
    block_id,
    start_time,
    end_time,
    entries,
    cost_usd as current_cost,
    CASE 
        WHEN is_active = 1 AND projection IS NOT NULL 
        THEN projection 
        ELSE cost_usd 
    END as projected_cost,
    total_tokens,
    is_active
FROM ccusage_usage_blocks
WHERE is_gap = 0 AND start_time >= today() - INTERVAL 1 DAY
ORDER BY start_time DESC;

-- 16. Recent high-cost operations (last 24 hours)
SELECT 
    record_type,
    record_key,
    model_name,
    cost,
    input_tokens + output_tokens + cache_creation_tokens + cache_read_tokens as total_tokens,
    created_at
FROM ccusage_model_breakdowns
WHERE created_at >= now() - INTERVAL 24 HOUR AND cost > 1.0
ORDER BY cost DESC;

-- ======================
-- Aggregated Dashboard Queries
-- ======================

-- 17. Summary stats for dashboard
SELECT 
    count(DISTINCT date) as total_active_days,
    sum(total_cost) as total_spend,
    sum(total_tokens) as total_tokens,
    avg(total_cost) as avg_daily_cost,
    max(total_cost) as max_daily_cost,
    min(total_cost) as min_daily_cost,
    sum(total_cost) / sum(total_tokens) * 1000000 as overall_cost_per_million_tokens
FROM ccusage_usage_daily;

-- 18. Model comparison matrix
SELECT 
    model_name,
    count(DISTINCT record_key) as usage_sessions,
    sum(cost) as total_cost,
    avg(cost) as avg_cost_per_session,
    sum(input_tokens + output_tokens + cache_creation_tokens + cache_read_tokens) as total_tokens,
    sum(cost) / sum(input_tokens + output_tokens + cache_creation_tokens + cache_read_tokens) * 1000000 as cost_per_million_tokens,
    max(created_at) as last_used
FROM ccusage_model_breakdowns
GROUP BY model_name
ORDER BY total_cost DESC;

-- 19. Project efficiency rankings
SELECT 
    replaceRegexpOne(session_id, '.*-Users-duet-project-', '') as project_name,
    session_id,
    total_cost,
    total_tokens,
    last_activity,
    total_tokens / total_cost as tokens_per_dollar,
    CASE 
        WHEN total_tokens / total_cost >= 1000000 THEN 'High Efficiency'
        WHEN total_tokens / total_cost >= 500000 THEN 'Medium Efficiency'
        ELSE 'Low Efficiency'
    END as efficiency_rating
FROM ccusage_usage_sessions
WHERE total_cost > 0
ORDER BY tokens_per_dollar DESC;

-- ======================
-- Time Series for Charts
-- ======================

-- 20. Daily cost trend for line chart (last 90 days)
SELECT 
    toString(date) as x,
    total_cost as y,
    'Daily Cost' as series
FROM ccusage_usage_daily
WHERE date >= today() - INTERVAL 90 DAY
ORDER BY date ASC;

-- 21. Model usage distribution for pie chart
SELECT 
    model_name as name,
    sum(cost) as value
FROM ccusage_model_breakdowns
GROUP BY model_name
ORDER BY value DESC;

-- 22. Project cost distribution for bar chart (top 15)
SELECT 
    replaceRegexpOne(session_id, '.*-Users-duet-project-', '') as name,
    total_cost as value
FROM ccusage_usage_sessions
ORDER BY total_cost DESC
LIMIT 15;

-- ======================
-- Advanced Analytics
-- ======================

-- 23. Cost forecasting based on recent trends
WITH recent_daily_avg AS (
    SELECT avg(total_cost) as avg_daily_cost
    FROM ccusage_usage_daily
    WHERE date >= today() - INTERVAL 7 DAY
)
SELECT 
    'Next 7 days' as period,
    avg_daily_cost * 7 as projected_cost,
    'Based on last 7 days average' as method
FROM recent_daily_avg
UNION ALL
SELECT 
    'Next 30 days' as period,
    avg_daily_cost * 30 as projected_cost,
    'Based on last 7 days average' as method
FROM recent_daily_avg;

-- 24. Anomaly detection - days with unusually high costs
WITH stats AS (
    SELECT 
        avg(total_cost) as mean_cost,
        stddevPop(total_cost) as stddev_cost
    FROM ccusage_usage_daily
)
SELECT 
    date,
    total_cost,
    (total_cost - mean_cost) / stddev_cost as z_score,
    CASE 
        WHEN abs((total_cost - mean_cost) / stddev_cost) > 2 THEN 'Anomaly'
        ELSE 'Normal'
    END as status
FROM ccusage_usage_daily, stats
WHERE date >= today() - INTERVAL 30 DAY
ORDER BY z_score DESC;

-- 25. Usage patterns by day of week
SELECT 
    toDayOfWeek(date) as day_of_week,
    CASE toDayOfWeek(date)
        WHEN 1 THEN 'Monday'
        WHEN 2 THEN 'Tuesday'
        WHEN 3 THEN 'Wednesday'
        WHEN 4 THEN 'Thursday'
        WHEN 5 THEN 'Friday'
        WHEN 6 THEN 'Saturday'
        WHEN 7 THEN 'Sunday'
    END as day_name,
    avg(total_cost) as avg_cost,
    sum(total_cost) as total_cost,
    count() as day_count
FROM ccusage_usage_daily
GROUP BY day_of_week, day_name
ORDER BY day_of_week;

-- ======================
-- Quick Verification Queries
-- ======================

-- 26. Table row counts (for monitoring data import)
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
ORDER BY table_name;

-- 27. Latest data timestamps (for checking import freshness)
SELECT 
    'Daily Data' as data_type,
    max(date) as latest_date,
    max(created_at) as last_imported
FROM ccusage_usage_daily
UNION ALL
SELECT 
    'Session Data' as data_type,
    max(last_activity) as latest_date,
    max(created_at) as last_imported
FROM ccusage_usage_sessions
UNION ALL
SELECT 
    'Block Data' as data_type,
    max(toDate(start_time)) as latest_date,
    max(created_at) as last_imported
FROM ccusage_usage_blocks;

-- ============================
-- MULTI-MACHINE ANALYSIS QUERIES
-- ============================

-- Machine overview - total usage across all machines
SELECT 
    machine_name,
    sum(total_cost) as total_cost,
    sum(total_tokens) as total_tokens,
    count(DISTINCT date) as active_days,
    sum(total_cost) / sum(total_tokens) * 1000000 as cost_per_million_tokens,
    max(date) as last_activity
FROM ccusage_usage_daily
GROUP BY machine_name
ORDER BY total_cost DESC;

-- Daily usage comparison across machines
SELECT 
    date,
    machine_name,
    total_cost,
    total_tokens,
    total_cost / total_tokens * 1000000 as cost_per_million_tokens
FROM ccusage_usage_daily
WHERE date >= today() - INTERVAL 7 DAY
ORDER BY date DESC, total_cost DESC;

-- Machine cost ranking by day
SELECT 
    date,
    machine_name,
    total_cost,
    rank() OVER (PARTITION BY date ORDER BY total_cost DESC) as cost_rank
FROM ccusage_usage_daily
WHERE date >= today() - INTERVAL 30 DAY
ORDER BY date DESC, cost_rank;

-- Top models by machine
SELECT 
    machine_name,
    model_name,
    sum(cost) as total_cost,
    sum(input_tokens + output_tokens + cache_creation_tokens + cache_read_tokens) as total_tokens,
    count() as usage_count
FROM ccusage_model_breakdowns
GROUP BY machine_name, model_name
ORDER BY machine_name, total_cost DESC;

-- Machine efficiency comparison (tokens per dollar)
SELECT 
    machine_name,
    sum(total_tokens) / sum(total_cost) as tokens_per_dollar,
    sum(total_cost) as total_cost,
    sum(total_tokens) as total_tokens,
    avg(total_cost) as avg_daily_cost
FROM ccusage_usage_daily
GROUP BY machine_name
ORDER BY tokens_per_dollar DESC;

-- Session analysis by machine
SELECT 
    machine_name,
    count() as session_count,
    sum(total_cost) as total_cost,
    avg(total_cost) as avg_cost_per_session,
    sum(total_tokens) as total_tokens
FROM ccusage_usage_sessions
GROUP BY machine_name
ORDER BY total_cost DESC;

-- Active blocks by machine (current usage monitoring)
SELECT 
    machine_name,
    count() as total_blocks,
    sum(CASE WHEN is_active = 1 THEN 1 ELSE 0 END) as active_blocks,
    sum(cost_usd) as total_cost,
    avg(cost_usd) as avg_block_cost
FROM ccusage_usage_blocks
WHERE is_gap = 0
GROUP BY machine_name
ORDER BY active_blocks DESC, total_cost DESC;

-- Monthly trends by machine
SELECT 
    machine_name,
    month,
    total_cost,
    total_tokens,
    total_cost / total_tokens * 1000000 as cost_per_million_tokens,
    total_cost - LAG(total_cost) OVER (PARTITION BY machine_name ORDER BY year, month_num) as cost_change
FROM ccusage_usage_monthly
ORDER BY machine_name, year, month_num;

-- Cross-machine project analysis (projects that exist on multiple machines)
SELECT 
    regexp_replace(session_id, '.*-Users-duet-project-', '') as project_name,
    count(DISTINCT machine_name) as machine_count,
    sum(total_cost) as total_cost_all_machines,
    array_join(groupArray(DISTINCT machine_name), ', ') as machines
FROM ccusage_usage_sessions
GROUP BY project_name
HAVING machine_count > 1
ORDER BY total_cost_all_machines DESC;

-- Machine utilization over time (last 30 days)
SELECT 
    date,
    count(DISTINCT machine_name) as active_machines,
    sum(total_cost) as combined_cost,
    sum(total_tokens) as combined_tokens,
    avg(total_cost) as avg_cost_per_machine
FROM ccusage_usage_daily
WHERE date >= today() - INTERVAL 30 DAY
GROUP BY date
ORDER BY date DESC;

-- Most expensive day per machine
SELECT 
    machine_name,
    argMax(date, total_cost) as most_expensive_date,
    max(total_cost) as highest_daily_cost,
    argMax(total_tokens, total_cost) as tokens_on_expensive_day
FROM ccusage_usage_daily
GROUP BY machine_name
ORDER BY highest_daily_cost DESC;

-- Machine data freshness check
SELECT 
    machine_name,
    'Daily Data' as data_type,
    max(date) as latest_date,
    max(updated_at) as last_updated,
    toRelativeSecondNum(now() - max(updated_at)) / 3600 as hours_since_update
FROM ccusage_usage_daily
GROUP BY machine_name
UNION ALL
SELECT 
    machine_name,
    'Session Data' as data_type,
    max(last_activity) as latest_date,
    max(updated_at) as last_updated,
    toRelativeSecondNum(now() - max(updated_at)) / 3600 as hours_since_update
FROM ccusage_usage_sessions
GROUP BY machine_name
ORDER BY machine_name, data_type;