# CLAUDE.md

## Project

TypeScript + Bun pipeline importing Claude Code usage analytics into ClickHouse and DuckDB.

**Single table**: `ccusage_events`. All record types (daily, session, block, project_daily) in one flat table with model breakdowns exploded inline.

Docs index: `docs/INDEX.md` (core memory: `docs/knowledge/core-memory.md`).

## Commands

```bash
bun install --frozen-lockfile        # install deps in fresh worktree before checks
bun test                          # run tests
bunx tsc --noEmit                 # typecheck
BUN_TMPDIR="$PWD/.tmp/bun-tmp" BUN_INSTALL_CACHE_DIR="$PWD/.tmp/bun-install-cache" bunx tsc --noEmit  # fallback in restricted tempdir envs
git log --since='<last-run-iso>' --pretty=format:'%H %cI %s' --name-only  # recent-change audit window
rg -n "<symbol>" src tests -g '!**/*.test.ts' -g '!**/*.spec.ts'  # dead-code evidence (non-test refs)
bun run src/scripts/import-all.ts --verbose  # full import
bun run src/scripts/backfill-duckdb.ts       # backfill DuckDB from ClickHouse
git log --since='7 days ago' --name-only --pretty=format:'--- %h %ad %s' --date=short
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

## Core memory

See `docs/knowledge/core-memory.md` for the compact maintenance runbook.
