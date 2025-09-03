# ccusage ClickHouse Data Pipeline

This project provides a complete data pipeline to import [ccusage](https://github.com/duyet/ccusage) (Claude Code usage analytics) data into ClickHouse for visualization and analysis.

## Overview

ccusage is a CLI tool that analyzes Claude Code usage data from local JSONL files. This project takes that data and stores it in ClickHouse for advanced analytics, dashboards, and visualization.

## Features

- **🎬 Interactive UI with Animations**: Beautiful loading spinners and progress indicators
- **⚡ Parallel Data Fetching**: Concurrent processing of all 5 ccusage data sources  
- **📊 Enhanced Statistics Display**: Professional analytics with smart number formatting
- **🔁 Complete ClickHouse Schema**: Optimized tables for all ccusage data types
- **🛡️ Automated Data Import**: Python script with idempotent inserts and retry logic
- **📈 Ready-to-Use Queries**: 40+ SQL queries for dashboards and analytics
- **⏰ Cronjob Integration**: Hourly automated data sync
- **🗃️ Performance Optimized**: Proper indexing, partitioning, and parallel processing
- **🖥️ Multi-Machine Support**: Track Claude usage across different machines with automatic merging

## Multi-Machine Support 🆕

Track Claude Code usage across multiple machines seamlessly:

- **Automatic Machine Detection**: Uses hostname to identify each machine automatically
- **Data Isolation**: Each machine's data is stored separately with `machine_name` field
- **Cross-Machine Analytics**: 13 new SQL queries for comparing usage across machines
- **Unified Dashboard**: View combined statistics from all your machines
- **Machine-Specific Filtering**: Filter reports by specific machines when needed
- **Zero Configuration**: Works out of the box, or customize machine names via environment variables

### Multi-Machine Analytics Included:
- Machine cost rankings and comparisons
- Cross-machine project analysis (projects used on multiple machines)
- Machine efficiency metrics (tokens per dollar)
- Machine utilization trends over time
- Data freshness monitoring per machine

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

## Example Script Output

The enhanced importer provides a beautiful, interactive experience:

```
✓ Connected to ClickHouse at your-host:8124

══════════════════════════════════════════════════════════════════════
  🚀 CCUSAGE DATA IMPORTER
══════════════════════════════════════════════════════════════════════
   Target: your_database at your-host:8124
   Machine: duyet.local
   Started: 2025-09-01 16:34:38

1️⃣  Fetching ccusage data
   Executing 5 ccusage commands concurrently...
⠋ Fetching data from ccusage...
✅ session data fetched (1/5)
✅ daily data fetched (2/5)  
✅ monthly data fetched (3/5)
✅ blocks data fetched (4/5)
✅ projects data fetched (5/5)

✅ All data sources fetched in 22.4s

2️⃣  Processing and importing data
   Converting data types and inserting into ClickHouse...
✅ Daily data processed
✅ Monthly data processed
✅ Session data processed
✅ Blocks data processed
✅ Projects data processed

3️⃣  Generating analytics
   Computing usage statistics and insights...
✅ Statistics generated

✅ Import completed successfully!
   Processing time: 13.2s
   Total time: 35.6s

══════════════════════════════════════════════════════════════════════
  📊 IMPORT SUMMARY & STATISTICS
══════════════════════════════════════════════════════════════════════

──────────────────────────────────────────────────────────────────────
  📋 Database Records
──────────────────────────────────────────────────────────────────────
  • Usage Daily                              60 records
  • Usage Monthly                             2 records
  • Usage Sessions                           13 records
  • Usage Blocks                            126 records
  • Usage Projects Daily                     67 records
  • Model Breakdowns                        846 records
  • Models Used                             985 records

──────────────────────────────────────────────────────────────────────
  💰 Usage Analytics
──────────────────────────────────────────────────────────────────────
  • Total Cost                                $4,262.55
  • Total Tokens                                   5.6B
  • Input Tokens                                 560.0K
  • Output Tokens                                  8.5M
  • Cache Creation Tokens                        243.1M
  • Cache Read Tokens                              5.4B
  • Date Range                          2025-08-02 → 2025-09-01
  • Days with Usage                             30 days

──────────────────────────────────────────────────────────────────────
  🤖 Top Models by Cost
──────────────────────────────────────────────────────────────────────
  • 1. sonnet-4                         $1,127.75 (2.4B tokens)
  • 2. opus-4-1-20250805                $925.83 (410.7M tokens)
  • 3. opus-4                           $77.70 (43.5M tokens)

──────────────────────────────────────────────────────────────────────
  💼 Session Insights
──────────────────────────────────────────────────────────────────────
  • Total Sessions                                   13
  • Avg Cost per Session                        $163.94
  • Max Cost Session                          $1,615.97
  • Total Session Tokens                           2.8B

──────────────────────────────────────────────────────────────────────
  🧱 Real-time Status
──────────────────────────────────────────────────────────────────────
  • Active Blocks                                     1

──────────────────────────────────────────────────────────────────────
  🖥️  Machine Info
──────────────────────────────────────────────────────────────────────
  • Current Machine                              duyet.local
══════════════════════════════════════════════════════════════════════
```

### Key Features Demonstrated:
- **🎬 Animated Progress**: Spinners show real-time fetching progress 
- **⚡ Parallel Processing**: All 5 data sources fetched concurrently in ~22 seconds
- **📊 Beautiful Analytics**: Clean sectioned display with smart number formatting (5.6B, 560.0K)
- **🎯 Performance Metrics**: Clear timing breakdown and completion status
- **📈 Comprehensive Stats**: Usage patterns, model costs, and operational insights
- **🖥️ Multi-Machine Display**: Shows current machine and will display breakdown when multiple machines detected

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

The `queries.sql` file contains 40+ pre-built queries organized by category:

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

### Multi-Machine Analytics 🆕
- Machine cost rankings and efficiency comparisons
- Daily usage comparison across machines
- Cross-machine project analysis (projects used on multiple machines)
- Machine utilization trends over time
- Active blocks monitoring by machine
- Monthly trends with machine breakdowns
- Data freshness monitoring per machine
- Top models by machine
- Machine-specific session analytics

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

# Multi-Machine Configuration (Optional)
# Override machine name for identification across different machines
# Default: Uses hostname automatically (socket.gethostname())
MACHINE_NAME=my-custom-machine-name
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