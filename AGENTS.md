# AGENTS.md

Public product: **summa** (crate `summa-import`, binary `summa`).
Data pipeline importing AI coding-agent usage into local DuckDB and optional ClickHouse/MotherDuck.

## Status

Rust is the primary implementation (0.1.x public line). Single `ccusage_events` table.

Docs index: `docs/INDEX.md` (core memory: `docs/knowledge/core-memory.md`).

## Commands

```bash
cargo test                              # tests
cargo check                             # typecheck
git switch -c automation/<topic> origin/master  # create branch first when worktree is on detached HEAD
git worktree list --porcelain  # find owning worktree when .git/worktrees/.../*.lock errors appear
git log --since='<last-run-iso>' --pretty=format:'%H %cI %s' --name-only  # recent-change audit window
rg -n "<symbol>" src tests -g '!**/*.test.ts' -g '!**/*.spec.ts'  # dead-code evidence (non-test refs)
cargo run -- import --verbose           # full import (local DuckDB by default)
cargo run -- backfill-duckdb            # backfill DuckDB from ClickHouse
cargo build --release                   # macOS workstation only → target/release/summa
# Linux hosts: install CI Release artifact (never cargo build there)
git log --since='7 days ago' --no-merges --name-only --pretty=format:'--- %h %ad %s' --date=short
```

Config: `~/.config/summa/config.toml` + `credentials.toml` (secrets separate).
Default DuckDB: `~/.local/share/summa/summa.duckdb` (auto-created).
Scheduler: `summa cronjob install` (launchd / systemd user timer / crontab).

## Architecture

Plugin: sources → pipeline runner → sinks. Single table `ccusage_events`.

- Sources: `src/source/{ccusage,companion,antigravity,hermes,grok,grok_api,cursor}.rs`
- Parsers: `src/parser/{rows,cost,schema,companion}.rs`
- Sinks: `src/sink/{clickhouse,duckdb,csv}.rs`
- Types: `src/model.rs` — `EventRow`, pipeline result types

## Key conventions

- Model breakdowns exploded into rows (one per model per record)
- Codex `inputTokens` includes cached — total = input + output (no cache double-count)
- Claude `cacheReadTokens` is separate — total = input + output + cacheCreate + cacheRead
- Cost distributed across models when per-model costs missing (`distributeCost()`)
- Companion packages may print log lines before JSON — parser skips to first `{`/`[`
- Grok Build: `~/.grok` / `GROK_HOME` — `logs/unified.jsonl` (`shell.turn.inference_done`) + session `summary.json` for model/cwd; tokens: input=`prompt-cached`, cache_read=`cached`, output=`completion`, total=`prompt+completion` (reasoning not double-counted); `--skip-grok`. Optional account-wide CLI-proxy billing (`grok-api`) is imported only when the JSON has countable spend/tokens — credits-percent payloads are skipped (no fabricated turns).
- Cursor (account-wide, `machine_name=account`): dashboard `POST https://cursor.com/api/dashboard/get-filtered-usage-events` (session/cookie or Cursor.app `state.vscdb` JWT) or Admin `POST https://api.cursor.com/teams/filtered-usage-events`; surfaces `cursor` / `cursor-cloud-agent` / `cursor-api` / `cursor-grok-bot`; `--skip-cursor`. Missing auth skips the source.
- Monthly not fetched — derivable via `toYYYYMM(date)` SQL

## Core memory

See `docs/knowledge/core-memory.md` for the compact maintenance runbook.
