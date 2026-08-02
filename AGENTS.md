# AGENTS.md

Data pipeline importing Claude Code usage analytics into ClickHouse and DuckDB.

## Status

Rust migration in progress. Single `ccusage_events` table.

Docs index: `docs/INDEX.md` (core memory: `docs/knowledge/core-memory.md`).

## Commands

```bash
cargo test                              # tests
cargo check                             # typecheck
git switch -c automation/<topic> origin/master  # create branch first when worktree is on detached HEAD
git worktree list --porcelain  # find owning worktree when .git/worktrees/.../*.lock errors appear
git log --since='<last-run-iso>' --pretty=format:'%H %cI %s' --name-only  # recent-change audit window
rg -n "<symbol>" src tests -g '!**/*.test.ts' -g '!**/*.spec.ts'  # dead-code evidence (non-test refs)
cargo run -- import --verbose           # full import
cargo run -- backfill-duckdb            # backfill DuckDB from ClickHouse
git log --since='7 days ago' --no-merges --name-only --pretty=format:'--- %h %ad %s' --date=short
```

## Architecture

Plugin: sources → pipeline runner → sinks. Single table `ccusage_events`.

- Sources: `src/source/{ccusage,companion,antigravity,hermes}.rs`
- Parsers: `src/parser/{rows,cost,schema,companion}.rs`
- Sinks: `src/sink/{clickhouse,duckdb,csv}.rs`
- Types: `src/model.rs` — `EventRow`, pipeline result types

## Key conventions

- Model breakdowns exploded into rows (one per model per record)
- Codex `inputTokens` includes cached — total = input + output (no cache double-count)
- Claude `cacheReadTokens` is separate — total = input + output + cacheCreate + cacheRead
- Cost distributed across models when per-model costs missing (`distributeCost()`)
- Companion packages may print log lines before JSON — parser skips to first `{`/`[`
- Monthly not fetched — derivable via `toYYYYMM(date)` SQL

## Core memory

See `docs/knowledge/core-memory.md` for the compact maintenance runbook.
