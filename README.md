# ccusage-import

Import Claude Code usage data into ClickHouse and DuckDB for analytics.

## What it does

Fetches usage data from three sources, writes to a single `ccusage_events` table:

| Source | Data |
|--------|------|
| **ccusage** | Claude Code daily, session, block, project usage |
| **codex** | OpenAI Codex usage via `@ccusage/codex` |
| **opencode** | OpenCode usage via `@ccusage/opencode` |

## Single table design

All data lands in one flat `ccusage_events` table. Model breakdowns are exploded inline (one row per model per record). Aggregation queries handle daily/weekly/monthly grouping.

```
ccusage_events
├── date, record_type (daily|session|block|project_daily)
├── source (ccusage|codex|opencode), machine_name
├── model_name, session_id, project_path
├── input_tokens, output_tokens, cache_creation_tokens, cache_read_tokens
├── cost, total_tokens
└── block-specific fields (start_time, burn_rate, etc.)
```

See `docs/schema.sql` for the full DDL.

## Docs index

- `docs/knowledge/core-memory.md` - compact maintenance runbook for recurring automation tasks
- `docs/schema.sql` - ClickHouse schema for `ccusage_events`
- `docs/queries.sql` - query examples
- `docs/migrate_add_source.sql` - migration SQL

## Setup

```bash
bun install
cp .env.example .env  # fill in ClickHouse credentials
```

### Environment variables

| Variable | Required | Description |
|----------|----------|-------------|
| `CH_HOST` | yes | ClickHouse hostname |
| `CH_PORT` | yes | HTTP port (8123 or 8443 for HTTPS) |
| `CH_USER` | yes | Username |
| `CH_PASSWORD` | yes | Password |
| `CH_DATABASE` | yes | Database name |
| `DUCKDB_PATH` | no | DuckDB path (default: `md:ccusage` for MotherDuck) |
| `MOTHERDUCK_TOKEN` | no | MotherDuck auth token |

## Usage

```bash
# Run full import (ccusage + codex + opencode → ClickHouse + DuckDB)
bun run src/scripts/import-all.ts --verbose

# Import only the last N days (faster, less memory)
bun run src/scripts/import-all.ts --days-back=7

# Import a specific date range
bun run src/scripts/import-all.ts --since=2025-01-01 --end-date=2025-12-31

# With custom DuckDB path
bun run src/scripts/import-all.ts --duckdb-path=md:ccusage

# Backfill DuckDB from ClickHouse
bun run src/scripts/backfill-duckdb.ts
```

### CLI Options

| Flag | Description |
|------|-------------|
| `--verbose` | Detailed logging |
| `--days-back=N` | Import last N days (overrides env `IMPORT_DAYS_BACK`) |
| `--since=YYYY-MM-DD` | Start date (overrides `--days-back`) |
| `--end-date=YYYY-MM-DD` | End date (inclusive) |
| `--duckdb-path=PATH` | DuckDB connection string |
| `--skip-ccusage` | Skip Claude Code data |
| `--skip-clickhouse` | Skip ClickHouse |
| `--skip-<agent>` | Skip specific agent (e.g. `--skip-codex`) |

## Architecture

```
Sources                  Pipeline               Sinks
┌──────────┐           ┌──────────┐          ┌────────────┐
│ ccusage  │──fetch──→ │          │──write──→ │ ClickHouse │
│ codex    │──fetch──→ │  runner  │──write──→ │ DuckDB     │
│ opencode │──fetch──→ │          │          │ (MotherDuck)│
└──────────┘           └──────────┘          └────────────┘
```

- `src/sources/` — fetch raw data from each provider
- `src/parsers/` — transform into flat event rows
- `src/pipeline/` — orchestrate sources → sinks
- `src/sinks/` — write to ClickHouse and DuckDB
- `src/scripts/` — CLI entry points

## Cronjob

```bash
# Runs with automatic setup script (IMPORT_DAYS_BACK env or --days-back flag)
./run-import.sh
```

The runner script uses `--days-back=2` by default (configurable via `IMPORT_DAYS_BACK` env var) so each
run only fetches recent data — faster and lighter than a full import each time.

### Automated setup

```bash
# Interactive setup (hourly, imports last 2 days)
bun run src/scripts/setup-cronjob.ts

# Every 30 minutes, import last 1 day
bun run src/scripts/setup-cronjob.ts --every=30 --days-back=1

# Force overwrite existing cronjob
bun run src/scripts/setup-cronjob.ts -f --every=15
```

### Manual crontab

```
*/30 * * * * /path/to/ccusage-import/run-import.sh 2>&1 | tee -a ~/.local/log/ccusage/import.log
```

## Development

```bash
bun test              # run tests
bunx tsc --noEmit     # type check
bun run src/cli.ts    # run CLI
```

## Data sources

**ccusage** reads local Claude Code JSONL files via the `ccusage` CLI.

**codex** reads local Codex session files via `@ccusage/codex`. Token counts come from local logs; costs are calculated from published pricing (not OpenAI billing).

**opencode** reads local OpenCode data via `@ccusage/opencode`.

Token counting conventions differ between sources:
- Claude: `inputTokens` and `cacheReadTokens` are separate additive categories
- Codex: `inputTokens` includes `cachedInputTokens` (nested, not additive)

## License

MIT
