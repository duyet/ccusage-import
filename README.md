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

# With custom DuckDB path
bun run src/scripts/import-all.ts --duckdb-path=md:ccusage

# Backfill DuckDB from ClickHouse
bun run src/scripts/backfill-duckdb.ts
```

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
# Runs hourly at :17
./run-import.sh
```

Setup via `crontab -e`:
```
17 * * * * /path/to/ccusage-import/run-import.sh 2>&1 | tee -a ~/.local/log/ccusage/import.log
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
