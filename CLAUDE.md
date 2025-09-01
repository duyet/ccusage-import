# CLAUDE.md

This file provides guidance to Claude Code when working with the ccusage-import project.

## Project Overview

This is a Python project that imports ccusage (Claude Code usage analytics) data into ClickHouse database for visualization and analysis.

## Development Setup

```bash
# Install dependencies
uv sync

# Run the importer
uv run python ccusage_importer.py

# Run with specific Python version
uv run --python 3.11 python ccusage_importer.py
```

## Project Structure

- `ccusage_importer.py` - Main Python script for data import
- `ccusage_clickhouse_schema.sql` - Complete ClickHouse database schema
- `queries.sql` - 27 ready-to-use SQL queries for analytics
- `setup_cronjob.sh` - Script to setup automated hourly imports
- `verify_setup.sh` - Script to verify the setup is working
- `README.md` - Complete project documentation

## Dependencies

- `clickhouse-connect` - ClickHouse Python client for database operations
- Python 3.8+ - Required for the project

## ClickHouse Configuration

The project connects to ClickHouse with these settings (configured in `ccusage_importer.py`):

```python
CH_HOST = 'duet-ubuntu'
CH_USER = 'duyet'  
CH_PASSWORD = 'ntmVKggOQa'
CH_DATABASE = 'duyet_analytics'
```

## Database Schema

All tables use the `ccusage_` prefix:

- `ccusage_usage_daily` - Daily aggregated usage data
- `ccusage_usage_monthly` - Monthly aggregated usage data
- `ccusage_usage_sessions` - Session-based usage data
- `ccusage_usage_blocks` - 5-hour billing blocks
- `ccusage_usage_projects_daily` - Daily usage by project
- `ccusage_model_breakdowns` - Model-specific token/cost breakdowns
- `ccusage_models_used` - Models used tracking

## Data Sources

The importer pulls data from these ccusage commands:

- `npx ccusage@latest daily --json`
- `npx ccusage@latest monthly --json`
- `npx ccusage@latest session --json` 
- `npx ccusage@latest blocks --json`
- `npx ccusage@latest daily --instances --json`

## Key Features

- **Idempotent Imports**: Safe to run multiple times, won't duplicate data
- **Comprehensive Schema**: Optimized for analytics with proper indexing
- **Ready-to-Use Queries**: 27 pre-built queries for dashboards
- **Automated Scheduling**: Hourly cronjob support
- **Error Handling**: Robust error handling and logging

## Testing the Import

```bash
# Run a single import
uv run python ccusage_importer.py

# Verify the setup
chmod +x verify_setup.sh
./verify_setup.sh

# Check ClickHouse tables
ssh duyet@duet-ubuntu "clickhouse-client --user=duyet --password='ntmVKggOQa' --database=duyet_analytics --query='SHOW TABLES WHERE name LIKE \"%ccusage%\"'"
```

## Code Style

- Use type hints for function parameters and return values
- Use f-strings for string formatting (avoid nested quotes in f-strings)
- Handle errors gracefully with try/except blocks
- Use meaningful variable names and function docstrings
- Follow PEP 8 style guidelines

## Common Tasks

**Add new data source:**
1. Add new method to `ClickHouseImporter` class
2. Create corresponding ClickHouse table in schema
3. Add table to deletion queries for idempotent operation
4. Call new method in `import_all_data()`

**Modify schema:**
1. Update `ccusage_clickhouse_schema.sql`
2. Run schema updates on ClickHouse server
3. Update Python code to match new schema
4. Update queries in `queries.sql` if needed

**Add new analytics query:**
1. Test query in ClickHouse directly
2. Add to `queries.sql` with documentation
3. Update README.md if it's a key query

## Troubleshooting

**Connection issues:**
- Verify ClickHouse server is running on duet-ubuntu
- Check network connectivity: `ssh duyet@duet-ubuntu`
- Test ClickHouse connection manually

**Import failures:**
- Check ccusage is installed: `npx ccusage@latest --help`
- Verify Claude Code data exists in local directories
- Check Python error output for specific issues

**Schema issues:**
- Verify all tables exist in ClickHouse
- Check table structures match expected schema
- Run verification script: `./verify_setup.sh`