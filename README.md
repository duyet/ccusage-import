# ccusage ClickHouse Data Pipeline

This project provides a complete data pipeline to import [ccusage](https://github.com/duyet/ccusage) (Claude Code usage analytics) data into ClickHouse for visualization and analysis.

## Overview

ccusage is a CLI tool that analyzes Claude Code usage data from local JSONL files. This project takes that data and stores it in ClickHouse for advanced analytics, dashboards, and visualization.

## Features

- **Complete ClickHouse Schema**: Optimized tables for all ccusage data types
- **Automated Data Import**: Python script with idempotent inserts 
- **Ready-to-Use Queries**: 27+ SQL queries for dashboards and analytics
- **Cronjob Integration**: Hourly automated data sync
- **Performance Optimized**: Proper indexing and partitioning

## Data Sources Supported

| ccusage Command | Description | ClickHouse Table |
|----------------|-------------|------------------|
| `ccusage daily` | Daily usage aggregation | `ccusage_usage_daily` |
| `ccusage monthly` | Monthly usage aggregation | `ccusage_usage_monthly` |
| `ccusage session` | Session-based usage | `ccusage_usage_sessions` |
| `ccusage blocks` | 5-hour billing windows | `ccusage_usage_blocks` |
| `ccusage daily --instances` | Project-level daily data | `ccusage_usage_projects_daily` |

## Quick Start

### 1. Setup ClickHouse Schema

```bash
# Create database and tables on your ClickHouse server
clickhouse-client --host YOUR_HOST --user YOUR_USER --password YOUR_PASSWORD --database YOUR_DATABASE < ccusage_clickhouse_schema.sql
```

### 2. Setup Environment and Dependencies

```bash
# Copy environment template
cp .env.example .env

# Edit .env with your ClickHouse credentials
vi .env

# Install dependencies with uv
uv sync
```

### 3. Run Initial Data Import

```bash
uv run python ccusage_importer.py
```

### 4. Setup Automated Import (Optional)

```bash
chmod +x setup_cronjob.sh
./setup_cronjob.sh
```

This sets up an hourly cronjob to keep your data synchronized.

## Database Schema

### Core Tables

- **`ccusage_usage_daily`** - Daily cost and token usage aggregated by date
- **`ccusage_usage_monthly`** - Monthly aggregations with year/month breakdown
- **`ccusage_usage_sessions`** - Usage grouped by project/session directory
- **`ccusage_usage_blocks`** - Claude's 5-hour billing window data with projections
- **`ccusage_usage_projects_daily`** - Daily usage broken down by individual projects
- **`ccusage_model_breakdowns`** - Detailed token/cost breakdown by AI model
- **`ccusage_models_used`** - Tracking which models were used in each session

### Views

- **`ccusage_v_daily_summary`** - Clean daily summary with calculated metrics
- **`ccusage_v_session_summary`** - Session data with friendly project names

## Usage Analytics Queries

The `queries.sql` file contains 27 pre-built queries organized by category:

### Daily Analysis
- Cost trends and percentage changes
- Highest spending days
- Token usage patterns

### Model Analysis  
- Cost breakdown by AI model (GPT-4, Claude, etc.)
- Model usage trends over time
- Most expensive operations

### Project Analysis
- Project cost rankings
- Activity timelines
- Efficiency metrics (tokens per dollar)

### Time-based Analysis
- Hourly usage patterns
- Weekly/monthly trends
- Day-of-week patterns

### Performance Analytics
- Cache efficiency analysis
- Cost optimization opportunities
- Anomaly detection

### Real-time Monitoring
- Active billing blocks
- Recent high-cost operations
- Data freshness checks

## Example Queries

### Top 10 Most Expensive Days
```sql
SELECT 
    date,
    total_cost,
    total_tokens,
    total_cost / total_tokens * 1000000 as cost_per_million_tokens
FROM ccusage_usage_daily 
ORDER BY total_cost DESC 
LIMIT 10;
```

### Model Cost Breakdown
```sql
SELECT 
    model_name,
    sum(cost) as total_cost,
    sum(input_tokens + output_tokens + cache_creation_tokens + cache_read_tokens) as total_tokens,
    count() as usage_count
FROM ccusage_model_breakdowns
GROUP BY model_name
ORDER BY total_cost DESC;
```

### Project Efficiency Rankings
```sql
SELECT 
    replaceRegexpOne(session_id, '.*-Users-duet-project-', '') as project_name,
    total_cost,
    total_tokens / total_cost as tokens_per_dollar,
    last_activity
FROM ccusage_usage_sessions
WHERE total_cost > 0
ORDER BY tokens_per_dollar DESC;
```

## Dashboard Integration

This schema is designed for integration with visualization tools:

- **Grafana**: Use ClickHouse data source
- **Apache Superset**: Direct ClickHouse connection  
- **Tableau**: Via ClickHouse ODBC driver
- **Custom Dashboards**: Direct SQL queries via HTTP interface

## Data Pipeline Architecture

```
ccusage CLI → JSON Output → Python Importer → ClickHouse → Dashboard
     ↓              ↓              ↓              ↓           ↓
   JSONL Files  → JSON Data → SQL Inserts → Tables → Queries
```

### Data Flow

1. **ccusage** reads local Claude Code JSONL files
2. **Python importer** calls ccusage with `--json` flag
3. **ClickHouse** stores data in optimized tables
4. **SQL queries** power dashboards and analytics

## File Structure

```
ccusage-import/
├── README.md                     # This file
├── ccusage_clickhouse_schema.sql # Complete ClickHouse schema
├── ccusage_importer.py           # Python data import script
├── queries.sql                   # 27 ready-to-use SQL queries
├── setup_cronjob.sh              # Automated cronjob setup
└── verify_setup.sh               # Setup verification script
```

## Configuration

### ClickHouse Connection Settings

Create a `.env` file in the project root (copy from `.env.example`):

```bash
# ClickHouse Configuration
CH_HOST=your_clickhouse_host
CH_PORT=8123
CH_USER=your_username
CH_PASSWORD=your_password_here
CH_DATABASE=your_database
```

### Cronjob Schedule

Default: Every hour at minute 0
```bash
0 * * * * /usr/bin/python3 /usr/local/bin/ccusage_importer.py
```

## Performance Considerations

- **Partitioning**: Tables partitioned by date for fast time-range queries
- **Indexing**: Optimized indexes on frequently queried columns
- **Compression**: ClickHouse's native compression reduces storage
- **Batch Inserts**: Efficient bulk data loading
- **Idempotent**: Safe to run imports multiple times

## Troubleshooting

### Check Data Import Status
```bash
# View logs
tail -f /var/log/ccusage/import.log

# Check table row counts
clickhouse-client --query "
SELECT 'ccusage_usage_daily' as table_name, count() as rows FROM duyet_analytics.ccusage_usage_daily
"
```

### Verify Schema
```bash
./verify_setup.sh
```

### Manual Data Import
```bash
python3 ccusage_importer.py
```

## Requirements

- **ccusage**: `npm install -g ccusage` or `npx ccusage@latest`
- **ClickHouse**: Server with duyet_analytics database
- **Python 3.8+**: With dependencies managed by `uv`
- **Environment file**: `.env` with ClickHouse credentials

## Contributing

Feel free to submit issues and enhancement requests!

## License

MIT License - see ccusage project for details.