# Core Memory

Small, durable runbook for recurring maintenance in this repo.

## Stable architecture facts

- Pipeline shape: sources -> parsers -> runner -> sinks.
- Single analytics table: `ccusage_events`.
- Data sources: `ccusage`, `codex`, `opencode`.

## Token accounting rules

- Claude rows: `total_tokens = input + output + cache_creation + cache_read`.
- Codex/OpenCode companion rows: `inputTokens` already includes cached input, so `total_tokens = input + output + cache_creation`.

## Cron/import workflow

- Import entrypoint: `bun run src/scripts/import-all.ts --verbose`.
- Cron wrapper: `./run-import.sh` (expects Bun available in PATH).
- Cron setup helper: `bun run src/scripts/setup-cronjob.ts`.

## Evidence-first maintenance loop

- Recent changes scan:
  - `git log --since='7 days ago' --name-only --pretty=format:'--- %h %ad %s' --date=short`
- Dead code evidence (non-test refs):
  - `rg -n "<symbol>" src tests -g '!**/*.test.ts'`
- Regression check:
  - `bun test`

