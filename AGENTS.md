# AGENTS.md

Data pipeline importing Claude Code usage analytics into ClickHouse and DuckDB.

## Status

TypeScript + Bun. Python removed. Single `ccusage_events` table.

Docs index: `docs/INDEX.md` (core memory: `docs/knowledge/core-memory.md`).

## Commands

```bash
bun install --frozen-lockfile  # install deps in fresh worktree before checks
bun test                # tests
bunx tsc --noEmit       # typecheck
BUN_TMPDIR="$PWD/.tmp/bun-tmp" BUN_INSTALL_CACHE_DIR="$PWD/.tmp/bun-install-cache" bunx tsc --noEmit  # fallback in restricted tempdir envs
git switch -c automation/<topic> origin/master  # create branch first when worktree is on detached HEAD
git worktree list --porcelain  # find owning worktree when .git/worktrees/.../*.lock errors appear
git log --since='<last-run-iso>' --pretty=format:'%H %cI %s' --name-only  # recent-change audit window
rg -n "<symbol>" src tests -g '!**/*.test.ts' -g '!**/*.spec.ts'  # dead-code evidence (non-test refs)
bun run src/scripts/import-all.ts --verbose  # full import
bun run src/scripts/backfill-duckdb.ts       # backfill DuckDB from ClickHouse
git log --since='7 days ago' --name-only --pretty=format:'--- %h %ad %s' --date=short
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

## Core memory

See `docs/knowledge/core-memory.md` for the compact maintenance runbook.
