# CLAUDE.md

## Project

TypeScript + Bun pipeline importing Claude Code usage analytics into ClickHouse and DuckDB.

**Single table**: `ccusage_events`. All record types (daily, session, block, project_daily) in one flat table with model breakdowns exploded inline.

## Commands

```bash
bun test                          # run tests
bunx tsc --noEmit                 # typecheck
bun run src/scripts/import-all.ts --verbose  # full import
bun run src/scripts/backfill-duckdb.ts       # backfill DuckDB from ClickHouse
```

## Config

`.env` with `CH_HOST`, `CH_PORT`, `CH_USER`, `CH_PASSWORD`, `CH_DATABASE`. Optional: `DUCKDB_PATH`, `MOTHERDUCK_TOKEN`.

## Architecture

Sources → parsers → pipeline runner → sinks (ClickHouse, DuckDB).

- `src/sources/` — fetch from ccusage CLI, codex, opencode
- `src/parsers/parsers.ts` — `buildCcusageEventRows()`, `buildCompanionEventRows()`, `distributeCost()`
- `src/pipeline/types.ts` — `EventsSnapshotData { events: [] }`
- `src/sinks/` — ClickHouse (ReplacingMergeTree), DuckDB (COPY FROM)
- `src/scripts/` — import-all, backfill-duckdb, migrate-single-table

## Token counting

- Claude: `inputTokens` and `cacheReadTokens` are separate — total = input + output + cacheCreate + cacheRead
- Codex: `inputTokens` includes `cachedInputTokens` — total = input + output (no cache double-count)

## Code style

No comments unless WHY is non-obvious. Surgical changes only. No AI slop.
