# AGENTS.md

Data pipeline importing Claude Code usage analytics into ClickHouse and DuckDB.

## Status

TypeScript + Bun. Python removed. Single `ccusage_events` table.

## Commands

```bash
bun test                # tests
bunx tsc --noEmit       # typecheck (expect @types/bun errors)
rg -n "<symbol>" src tests -g '!**/*.test.ts'  # dead-code evidence (non-test refs)
bun run src/scripts/import-all.ts --verbose  # full import
```

## Architecture

Plugin: sources → pipeline runner → sinks. Single table `ccusage_events`.

- Sources: `src/sources/{ccusage,companion}.ts`
- Parsers: `src/parsers/parsers.ts` — `buildCcusageEventRows()`, `buildCompanionEventRows()`
- Sinks: `src/sinks/{clickhouse,duckdb}.ts`
- Types: `src/pipeline/types.ts` — `EventsSnapshotData { events: [] }`

## Key conventions

- Model breakdowns exploded into rows (one per model per record)
- Codex `inputTokens` includes cached — total = input + output (no cache double-count)
- Claude `cacheReadTokens` is separate — total = input + output + cacheCreate + cacheRead
- Cost distributed across models when per-model costs missing (`distributeCost()`)
- Companion packages may print log lines before JSON — parser skips to first `{`/`[`
- Monthly not fetched — derivable via `toYYYYMM(date)` SQL
