# AGENTS.md

This file provides guidance to Codex when working with the ccusage-import project.

## Project Overview

**Status**: 🔄 **Migrating to TypeScript + Bun**

This project is transitioning from Python to TypeScript + Bun for better performance, type safety, and modern tooling. The Python implementation remains functional during migration.

- **Python**: Legacy implementation (2,902 lines, fully functional)
- **TypeScript**: New implementation (Phase 2 complete, 30+ files, 40+ tests passing)

This is a data importer that pulls ccusage (Codex usage analytics) data into ClickHouse database for visualization and analysis.

---

## TypeScript Migration (In Progress)

### Phase 1: Foundation ✅ COMPLETE

**Completed (2025-01-05):**
- [x] Bun + TypeScript project initialization
- [x] Project directory structure (`src/config/`, `src/types/`, `src/database/`, etc.)
- [x] Configuration classes:
  - `ClickHouseConfig` - Database connection with auto HTTPS detection
  - `ImporterConfig` - Import behavior settings
  - `UIConfig` - Display and animation settings
- [x] Zod schemas for all data types (ccusage + OpenCode)
- [x] ClickHouse client wrapper (`CHClient`) with async/await
- [x] TTY detection utilities for cron compatibility
- [x] Formatting utilities (numbers, costs, durations)
- [x] Bun test infrastructure with first passing tests

**Current Files Created:**
```
src/
├── config/
│   ├── clickhouse.ts      ✅ ClickHouseConfig class
│   ├── importer.ts        ✅ ImporterConfig class
│   ├── ui.ts              ✅ UIConfig class
│   └── index.ts           ✅ ConfigManager class
├── types/
│   └── schemas.ts         ✅ Zod schemas (15+ schemas)
├── database/
│   └── client.ts          ✅ CHClient wrapper
├── ui/utils/
│   ├── tty.ts             ✅ TTY detection
│   └── formatting.ts      ✅ Number/cost/duration formatting
tests/
├── setup.ts               ✅ Test fixtures & mocks
└── unit/
    └── formatting.test.ts ✅ 16 passing tests
```

**How to Run Tests (Bun):**
```bash
# Run all tests
bun test

# Run specific test file
bun test tests/unit/formatting.test.ts

# Run with coverage
bun test --coverage
```

**TypeScript Commands:**
```bash
# Type check
npx tsc --noEmit

# Build (when ready)
bun run build

# Run main entry (when implemented)
bun run src/main.ts
```

### Phase 2: Core Logic ✅ COMPLETE

**Completed (2025-01-06):**
- [x] CcusageFetcher (parallel data fetching with Bun shell)
- [x] OpenCodeFetcher (JSONL reader with Bun.file API)
- [x] Data parsers with Zod validation
- [x] Repository classes for 7 tables
- [x] OpenCode aggregators
- [x] Retry logic with exponential backoff and jitter
- [x] SHA-256 project name hashing (stable, collision-resistant)
- [x] Date/datetime parsing utilities
- [x] Row builders for all tables

**New Files Created:**
```
src/
├── fetchers/
│   ├── ccusage.ts         ✅ CcusageFetcher with parallel execution
│   ├── opencode.ts        ✅ OpenCodeFetcher for JSONL
│   └── index.ts           ✅ Export module
├── parsers/
│   ├── dates.ts           ✅ Date/datetime parsing (parseDate, parseDateTime)
│   ├── hash.ts            ✅ SHA-256 hashing (async + sync variants)
│   ├── hash.test.ts       ✅ Comprehensive hash tests
│   ├── parsers.ts         ✅ Row builders for all tables
│   ├── aggregators.ts     ✅ OpenCode message aggregation
│   └── types.ts           ✅ TypeScript type definitions
├── database/
│   ├── repositories.ts    ✅ Repository classes for 7 tables
│   └── repositories/       📁 Directory for individual repos
├── utils/
│   └── retry.ts           ✅ Exponential backoff retry utility
└── ui/
    ├── utils/colors.ts    ✅ Color constants
    ├── utils/formatters.ts ✅ Additional formatters
    ├── utils/index.ts     ✅ Export module
    ├── types/index.ts     ✅ UI type definitions
    └── components/index.ts ✅ Export module
```

**Test Results:**
- 40+ tests passing (formatting, retry utilities)
- TypeScript compiles cleanly (no errors)
- Type-safe with Zod validation throughout

### Phase 3: UI Implementation (Planned)
- [ ] Ink app setup with React
- [ ] TTY-aware App component
- [ ] ImportProgress component
- [ ] StatisticsDashboard component
- [ ] UsageHeatmap component

### Phase 4: Enhanced Features (Planned)
- [ ] BarChart component (ASCII charts)
- [ ] ComparisonView component
- [ ] DataExporter (JSON/CSV/Markdown)
- [ ] Export CLI commands

### Phase 5: Testing & Polish (Planned)
- [ ] Unit tests for all modules (90%+ coverage)
- [ ] Integration tests
- [ ] E2E test with real ClickHouse
- [ ] Cron compatibility testing

### Phase 6: Migration & Validation (Planned)
- [ ] Parallel Python/TypeScript imports
- [ ] Data integrity validation
- [ ] Statistics comparison
- [ ] Update cronjob scripts
- [ ] Remove Python code

---

## Development Setup

### TypeScript (New, Recommended)
```bash
# Install dependencies (use npm if bun not available)
npm install

# Run tests
bun test

# Type check
npx tsc --noEmit
```

### Python (Legacy, Still Functional)

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
- `verify_setup.sh` - HTTP-based verification script (no clickhouse-client required)
- `README.md` - Complete project documentation

## Dependencies

- `clickhouse-connect` - ClickHouse Python client for database operations
- Python 3.8+ - Required for the project

## ClickHouse Configuration

The project connects to ClickHouse using environment variables:

```bash
# Required environment variables
export CH_HOST="your_clickhouse_host"
export CH_PORT="8123"  # HTTP port (8443 for HTTPS)
export CH_USER="your_username"
export CH_PASSWORD="your_password"
export CH_DATABASE="your_database"

# Optional: Protocol auto-detected based on port
export CH_PROTOCOL="https"  # or "http" (auto-detected for ports 443, 8443, 9440)
```

**HTTPS Support**: Automatically detects HTTPS for ports 443, 8443, 9440

## Database Schema

All tables use the `ccusage_` prefix and include `machine_name` column for multi-machine support:

- `ccusage_usage_daily` - Daily aggregated usage data with machine tracking
- `ccusage_usage_monthly` - Monthly aggregated usage data with machine tracking  
- `ccusage_usage_sessions` - Session-based usage data with machine tracking
- `ccusage_usage_blocks` - 5-hour billing blocks with machine tracking
- `ccusage_usage_projects_daily` - Daily usage by project with machine tracking
- `ccusage_model_breakdowns` - Model-specific token/cost breakdowns with machine tracking
- `ccusage_models_used` - Models used tracking with machine tracking

### Schema Migration Notes
- All tables now include `machine_name String` column for tracking usage across different machines
- Machine names are auto-detected using `socket.gethostname()` (e.g., "my-machine.local")
- Tables are partitioned appropriately for time-series data performance

## Data Sources

The importer pulls data from these ccusage commands:

- `npx ccusage@latest daily --json`
- `npx ccusage@latest monthly --json`
- `npx ccusage@latest session --json` 
- `npx ccusage@latest blocks --json`
- `npx ccusage@latest daily --instances --json`

## Key Features

- **🖥️ Multi-Machine Support**: Track Codex usage across different machines with automatic hostname detection
- **⚡ Parallel Data Fetching**: Fetches all ccusage data concurrently for faster imports
- **📊 Clean & Compact CLI**: Simplified output without excessive borders or animations
- **🔁 Idempotent Imports**: Safe to run multiple times, won't duplicate data
- **🛡️ Robust Error Handling**: Retry logic and timeout protection for reliable imports
- **🗃️ Comprehensive Schema**: Optimized for analytics with proper indexing and machine_name columns
- **📈 Ready-to-Use Queries**: 40+ pre-built queries for dashboards including multi-machine analytics
- **⏰ Automated Scheduling**: Hourly cronjob support with logging
- **🔒 Concurrency Protection**: File-based locking prevents race conditions in concurrent imports
- **🧵 Thread Safety**: Atomic database operations and thread-safe connection pooling

## ClickHouse Server Procedures

### Connection Details
- **Host**: your_clickhouse_host
- **Port**: 8123 (HTTP), 8443 (HTTPS), 9000 (native)
- **User**: your_username
- **Password**: your_password
- **Database**: your_database
- **Protocol**: Auto-detected based on port (HTTPS for 443, 8443, 9440)

### SSH Commands for ClickHouse Operations

#### Connect to ClickHouse server via SSH:
```bash
ssh user@your-host
```

#### Execute ClickHouse queries from local machine:
```bash
# Show tables
ssh user@your-host "clickhouse-client --user=username --password=password --database=database --query=\"SHOW TABLES WHERE name LIKE 'ccusage%'\""

# Check table row counts
ssh user@your-host "clickhouse-client --user=username --password=password --database=database --query=\"SELECT 'usage_daily' as table, count() as rows FROM ccusage_usage_daily\""

# Drop all ccusage tables (for recreation)
ssh user@your-host "clickhouse-client --user=username --password=password --database=database --query=\"DROP TABLE IF EXISTS ccusage_usage_daily, ccusage_usage_monthly, ccusage_usage_sessions, ccusage_usage_blocks, ccusage_usage_projects_daily, ccusage_model_breakdowns, ccusage_models_used\""
```

#### Create tables individually (needed when bulk schema application fails):
```bash
# Create tables one by one to avoid syntax errors
ssh user@your-host 'clickhouse-client --user=username --password=password --database=database --multiquery' << 'EOF'
CREATE TABLE IF NOT EXISTS ccusage_usage_daily (
    date Date, machine_name String, input_tokens UInt64, output_tokens UInt64,
    cache_creation_tokens UInt64, cache_read_tokens UInt64, total_tokens UInt64,
    total_cost Float64, models_count UInt16, created_at DateTime DEFAULT now(),
    updated_at DateTime DEFAULT now()
) ENGINE = MergeTree() PARTITION BY toYYYYMM(date) ORDER BY (date, machine_name);

CREATE TABLE IF NOT EXISTS ccusage_model_breakdowns (
    record_type Enum8('daily' = 1, 'monthly' = 2, 'session' = 3, 'block' = 4, 'project_daily' = 5),
    record_key String, machine_name String, model_name String, input_tokens UInt64,
    output_tokens UInt64, cache_creation_tokens UInt64, cache_read_tokens UInt64,
    cost Float64, created_at DateTime DEFAULT now()
) ENGINE = MergeTree() PARTITION BY record_type ORDER BY (record_type, machine_name, record_key, model_name);

CREATE TABLE IF NOT EXISTS ccusage_models_used (
    record_type Enum8('daily' = 1, 'monthly' = 2, 'session' = 3, 'block' = 4, 'project_daily' = 5),
    record_key String, machine_name String, model_name String, created_at DateTime DEFAULT now()
) ENGINE = MergeTree() PARTITION BY record_type ORDER BY (record_type, machine_name, record_key, model_name);
EOF
```

### Schema Recreation Process
1. **Backup existing data** (if needed):
   ```bash
   ssh user@your-host "clickhouse-client --user=username --password=password --database=database --query=\"CREATE TABLE backup_ccusage_usage_daily AS SELECT * FROM ccusage_usage_daily\""
   ```

2. **Drop existing tables**:
   ```bash
   ssh user@your-host "clickhouse-client --user=username --password=password --database=database --multiquery" < /dev/stdin << 'EOF'
   DROP TABLE IF EXISTS ccusage_usage_daily;
   DROP TABLE IF EXISTS ccusage_usage_monthly;
   DROP TABLE IF EXISTS ccusage_usage_sessions;
   DROP TABLE IF EXISTS ccusage_usage_blocks;
   DROP TABLE IF EXISTS ccusage_usage_projects_daily;
   DROP TABLE IF EXISTS ccusage_model_breakdowns;
   DROP TABLE IF EXISTS ccusage_models_used;
   EOF
   ```

3. **Recreate tables** using individual table creation commands above or apply schema file

### Common ClickHouse Issues
- **Bulk schema application fails**: Use individual table creation commands
- **Column mismatch errors**: Check INSERT column order matches table definition
- **Permission errors**: Verify user/password are correct (remove quotes in SSH commands)

## Testing the Import

```bash
# Run comprehensive system check (validates everything)
uv run python ccusage_importer.py --check

# Run a single import (includes parallel fetching and statistics)
uv run python ccusage_importer.py

# Verify the setup (HTTP-based, no dependencies)
chmod +x verify_setup.sh
./verify_setup.sh

# Check ClickHouse tables manually via HTTP
curl -s --user "$CH_USER:$CH_PASSWORD" \
     -H "Content-Type: text/plain" \
     -d "SHOW TABLES WHERE name LIKE 'ccusage%'" \
     "http://$CH_HOST:$CH_PORT/?database=$CH_DATABASE"
```

### System Check Features (`--check`)
The `--check` argument provides comprehensive system validation without importing data:

#### **1. ccusage Availability Testing**
- Detects `bunx` and `npx` package managers
- Tests all 5 ccusage commands with 30-second timeouts:
  - `daily`: Daily usage aggregation
  - `monthly`: Monthly usage aggregation  
  - `session`: Session-based usage
  - `blocks`: 5-hour billing windows
  - `projects`: Project-level daily data
- Shows record counts available for import
- Validates JSON response format

#### **2. Enhanced ClickHouse Connection Testing**
- **Basic Connection**: Server version and connectivity
- **Database Access**: Confirms correct database selection
- **Query Execution**: Tests SELECT operations and table counting
- **Write Permissions**: Creates/drops temporary table to verify write access
- **Server Performance**: Measures response time with ratings:
  - ✅ Excellent: < 100ms
  - ✅ Good: 100-500ms  
  - ⚠️  Slow: > 500ms

#### **3. Environment Validation**
- Verifies all configuration variables are set
- Shows connection parameters (host, port, user, database)
- Confirms machine name detection

#### **4. Exit Codes & Usage**
```bash
# Run system check (recommended before first import)
uv run python ccusage_importer.py --check

# Check exit code
echo $?  # 0 = success, 1 = failures detected
```

## Project Privacy Feature

### **Privacy Protection with Hashing**
By default, the importer protects project privacy by hashing session IDs and project paths into stable 8-character hexadecimal identifiers.

#### **Default Behavior (Privacy Enabled)**
```bash
# Import with project names hashed (default)
uv run python ccusage_importer.py

# Shows: Project Privacy: Enabled
# Result: session_id="3fdbf248", project_path="34cfcaf1"
```

#### **Disable Privacy Protection**
```bash
# Import with original project names/paths
uv run python ccusage_importer.py --no-hash-projects  

# Shows: Project Privacy: Disabled
# Result: session_id="/home/user/project/ccusage-import", project_path="/home/user/project/ccusage-import"
```

#### **Hash Properties**
- **Stable**: Same project → same hash every time
- **Short**: 8 characters (vs full paths like `/home/user/project/very-long-project-name`)
- **Collision-resistant**: SHA-256 based (~4 billion possible values)
- **Privacy-preserving**: Original paths cannot be reverse-engineered

#### **Use Cases**
- **Privacy Enabled (default)**: Shared/corporate environments, public dashboards
- **Privacy Disabled**: Personal use, debugging, detailed project tracking

#### **5. Troubleshooting Guide**
- **ccusage failures**: Install Node.js and ccusage package
- **ClickHouse connection**: Check server status, credentials, network
- **Write permission errors**: Verify user has CREATE/DROP privileges
- **Performance issues**: Check server load, network latency

### Database Views (All with ccusage_ prefix)
- **`ccusage_v_daily_summary`** - Daily cost analysis with calculated metrics
- **`ccusage_v_session_summary`** - Session data with clean project names
- **`ccusage_v_model_performance`** - Model cost and usage analysis grouped by machine
- **`ccusage_v_monthly_trends`** - Monthly usage trends by machine and time
- **`ccusage_v_active_blocks`** - Active billing blocks monitoring with projections

## Import Process

The enhanced importer follows this optimized workflow with beautiful UI:

### 1️⃣ **Parallel Data Fetching** (~22 seconds)
   - 🎯 **Animated Progress**: Spinners show real-time fetching progress (1/5, 2/5, etc.)
   - ⚡ **Concurrent Execution**: All 5 ccusage data sources fetched simultaneously
   - 🔄 **Smart Retry Logic**: 30-second timeouts with 2-attempt retry for reliability
   - 📈 **Performance**: ~60% faster than sequential execution

### 2️⃣ **Data Processing & Import** (~13 seconds)
   - 🎬 **Step-by-step Animations**: Individual loading indicators for each data type
   - 🔧 **Type Conversion**: Proper date/datetime parsing for ClickHouse compatibility
   - 🏗️ **Complex Data Handling**: Smart extraction from nested objects (burn rates, projections)  
   - 🛡️ **Data Integrity**: Idempotent upserts prevent duplicate records

### 3️⃣ **Analytics Generation** (~1 second)
   - 📊 **Beautiful Formatting**: Professional-grade statistics display with sections
   - 🎯 **Smart Number Formatting**: Automatic K/M/B suffixes for readability
   - 📈 **Comprehensive Metrics**: Usage analytics, model breakdowns, session insights
   - 🚦 **Real-time Status**: Active blocks and system health indicators

### Sample Output Features:
- **Progress Tracking**: `⠋ Fetching data from ccusage...` → `✅ daily data fetched (2/5)`
- **Sectioned Display**: Clean headers with `═══════════` dividers
- **Smart Formatting**: `2.8B tokens` instead of `2,817,472,928 tokens`
- **Visual Hierarchy**: Numbered steps (1️⃣, 2️⃣, 3️⃣) and clear sections

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
- Verify ClickHouse server is running on your host
- Check network connectivity: `ssh user@your-host`
- Test ClickHouse connection manually

**Import failures:**
- Check ccusage is installed: `npx ccusage@latest --help`
- Verify Codex data exists in local directories
- Check Python error output for specific issues

**Schema issues:**
- Verify all tables exist in ClickHouse
- Check table structures match expected schema
- Run verification script: `./verify_setup.sh`

**Date conversion issues:**
- Date strings from ccusage (e.g., "2025-08-02") are converted to Python date objects
- DateTime strings from ccusage (e.g., "2025-08-02T15:00:00.000Z") are converted to Python datetime objects
- All timezone info is stripped for ClickHouse compatibility

**Complex data handling:**
- Active blocks may have complex burnRate and projection objects instead of simple values
- The importer extracts costPerHour from burnRate objects and totalCost from projection objects
- All table names use ccusage_ prefix to match the schema

**Performance optimization:**
- Parallel data fetching reduces total import time from ~45 seconds to ~29 seconds
- ThreadPoolExecutor with max_workers=3 prevents ccusage command overload
- Individual command timeouts (30s) prevent hanging imports
- Retry logic (2 attempts) handles transient ccusage failures

**Enhanced UI/UX:**
- Animated loading spinners using Unicode Braille patterns (⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏)
- Progressive completion indicators show (1/5, 2/5, etc.) during parallel fetching
- Professional sectioned output with clean dividers and consistent formatting
- Smart number formatting automatically converts large numbers (2.8B, 410.7M, 560.0K)

**Statistics display:**
- Clean and compact post-import analytics without excessive borders
- Table record counts with human-readable numbers and clean alignment  
- Comprehensive cost breakdowns and token consumption metrics
- Model-specific usage patterns ranked by cost with token counts
- Session insights and real-time block status monitoring

## Known Issues & Troubleshooting

### Data Synchronization
**Dashboard Data vs ccusage CLI Mismatch**:
- **Cause**: ClickHouse dashboard shows last imported data snapshot
- **ccusage CLI**: Always shows real-time current usage data
- **Solution**: Run `uv run python ccusage_importer.py` to sync latest data
- **Detection**: Importer now checks data freshness and warns if stale
- **Recommendation**: Set up cronjob for hourly automatic imports

### Current Issues
1. **CLI animations still visible**:
   - Spinners still show during fetch/processing phases
   - Status: Header simplified, but progress animations remain
   - Impact: Cosmetic only, does not affect functionality

### ccusage CLI Response Structure (BUG-005)
**Error**: `string indices must be integers, not 'str'`

**Root Cause**: The ccusage CLI wraps each data type in an object with the type name as key:
```json
// ccusage daily --json returns:
{ "daily": [...], "totals": {...} }

// ccusage monthly --json returns:
{ "monthly": [...], "totals": {...} }

// ccusage session --json returns:
{ "sessions": [...], "totals": {...} }  // Note: "sessions" not "session"!

// ccusage blocks --json returns:
{ "blocks": [...] }

// ccusage daily --instances --json returns:
{ "projects": [...], "totals": {...} }
```

**Bug Location**: `import_all_data()` method was passing the entire response object to upsert methods instead of extracting the inner array.

**Wrong Code**:
```python
ccusage_data = {
    "daily": all_data.get("daily", {}),  # Returns {"daily": [...], "totals": {...}}
    ...
}
self.upsert_daily_data(ccusage_data["daily"], ...)  # Passes dict, not list!
```

**Fix**: Extract the inner array from each response:
```python
raw_daily = all_data.get("daily", {})
ccusage_data = {
    "daily": raw_daily.get("daily", []) if isinstance(raw_daily, dict) else [],
    "session": raw_session.get("sessions", []),  # Note: "sessions" key!
    ...
}
```

**Debugging Tips**:
- Use `bunx ccusage@latest daily --json | jq 'keys'` to check response structure
- The "sessions" key (plural) is different from the command name "session"
- Always verify data shape before passing to upsert methods

### Multi-Machine Deployment Notes
- Each machine auto-detects its hostname via `socket.gethostname()`
- Data is isolated by machine_name in all tables
- Cross-machine analytics available via queries.sql
- No configuration needed for basic multi-machine support
- Custom machine names can be set via MACHINE_NAME environment variable

### Concurrency & Thread Safety

**Race Condition Protection** (BUG-004 Fix):
- **File-Based Locking**: Exclusive lock prevents multiple import processes from running simultaneously
- **Atomic Upserts**: DELETE-INSERT operations execute atomically to prevent duplicate data
- **Thread-Safe Connections**: Per-thread ClickHouse client instances via threading.local()
- **Instance-Level Mutex**: Protects shared state within single import process
- **Comprehensive Logging**: All lock operations logged to ccusage_import.log

**Testing Concurrency**:
```bash
# Run concurrency test suite
python test_concurrency.py

# Stress test with 10 concurrent processes
python test_concurrency.py --stress

# Run specific test scenario
python test_concurrency.py --scenario 2
```

**Concurrency Features**:
- Only one import process can run at a time
- Other processes wait up to 5 minutes or fail gracefully
- Lock automatically released on exit, error, or crash
- Lock file: `.ccusage_import.lock` (contains PID for debugging)
- Detailed logging in `ccusage_import.log`

**See CONCURRENCY.md for complete documentation**

### Recent Changes Summary
- ✅ Added machine_name columns to all 7 tables for multi-machine support
- ✅ Simplified CLI output removing verbose headers and borders
- ✅ Updated schema recreation procedures with individual table commands
- ✅ Fixed models_used table column mismatch issue (missing machine_name in daily data)
- ✅ Fixed blocks table column ordering issue (actual_end_time position)
- ✅ Enhanced cronjob logging with timestamps and log rotation
- ✅ Created all 5 database views with proper ccusage_ prefix naming
- ✅ Added comprehensive --check argument for system validation
- ✅ Implemented project privacy protection with SHA-256 hashing (enabled by default)
- ✅ Added --no-hash-projects toggle to disable privacy protection
- ✅ Updated verify_setup.sh to use HTTP interface instead of clickhouse-client
- ✅ Added automatic HTTPS detection for ports 443, 8443, 9440
- ✅ Enhanced cronjob setup with automatic PATH and environment variable detection
- 📝 Enhanced documentation with ClickHouse HTTP procedures and curl commands
- 🔒 **BUG-004 FIX**: Implemented comprehensive race condition protection with file locking, atomic operations, and thread safety
- 🧪 Added concurrency test suite (test_concurrency.py) with 5 test scenarios
- 📝 Created CONCURRENCY.md with complete thread safety documentation
- 🔧 **BUG-005 FIX**: Fixed ccusage data extraction - extract inner arrays from wrapped response objects (Dec 25, 2025)