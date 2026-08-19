# Core Memory

Small durable notes for ongoing maintenance automation.

## Scan scope commands

```bash
bun install --frozen-lockfile
git switch -c automation/<topic> origin/master
git worktree list --porcelain
git log --since='<last-run-iso>' --pretty=format:'%H %cI %s' --name-only
git log --since='7 days ago' --no-merges --pretty=format:'%h %cI %s'
rg -n "<symbol>" src tests -g '!**/*.test.ts' -g '!**/*.spec.ts'
```

## Known guardrails

- **Never `cargo build` on the Linux home servers.** CI (`release.yml`) produces the binaries; copy the matching `summa-<arch>-unknown-linux-gnu` artifact and install it (`install` to `~/.local/bin/summa` or `~/.cargo/bin/summa`). Use `summa update` when GitHub artifact download works. Local `cargo build --release` is for the macOS workstation only.

- `run-import.sh` is Bun-only; do not add npm/yarn fallback.
- `src/scripts/setup-cronjob.ts` must write crontab via stdin (`crontab -`), not shell-quoted `echo`.
- Rust `summa cronjob`: generate+register launchd / systemd --user / crontab. Crontab updates go through `crontab -` stdin (never `/tmp` + `crontab file`). Status reports legacy `run-import.sh` lines; `--replace` removes them.
- Keep sink dedup delete filters SQL-escaped in both ClickHouse and DuckDB sinks.
- Companion (`codex`/`opencode`) totals must avoid cache double-count: `total_tokens = inputTokens + outputTokens`.
- Claude totals must keep cache components separate: `total_tokens = input + output + cacheCreation + cacheRead`.
- **Rust serde must alias ccusage camelCase** (`inputTokens`, `totalTokens`, `cacheCreationTokens`, `cacheReadTokens`, `modelsUsed`, `modelBreakdowns`). Missing aliases silently zero tokens while `totalCost` still parses → burn.duyet.net “0 tokens / $cost” daily bars (hit ~2026-07-10 after Rust import path). Regression tests in `parser::types` + `parser::rows`.
- Grok Build (`source=grok`, `GROK_HOME`/`~/.grok`): prompt is cache-inclusive; `input = prompt - cached`, `cache_read = cached`, `output = completion`, `total = prompt + completion` (do not add reasoning again). Session model/cwd from `sessions/**/summary.json`. Logs have **no cost field** — estimate from xAI public rates (`estimate_grok_cost`): grok-4.5 $2/$0.30/$6 per 1M (input/cached/output), long-context ≥200k prompt doubles to $4/$0.60/$12; priced **per turn** then summed.
- Grok CLI-proxy (`source=grok-api`, `machine_name=account`): `GET https://cli-chat-proxy.grok.com/v1/billing?format=credits` with `~/.grok/auth.json`. Import only countable spend/token payloads. `creditUsagePercent`-only responses must not become fake turn rows. `--skip-grok` skips both local grok and grok-api.
- Cursor account-wide (`machine_name=account`, never importer hostname): CodexBar dashboard/Admin usage-events APIs. Classify `cursor` / `cursor-cloud-agent` (`cloudAgentId` or `isHeadless`) / `cursor-api` (`serviceAccountId`) / `cursor-grok-bot` (grok-bot or grok model). Cost = `chargedCents/100` (fallback `tokenUsage.totalCents/100`). Tokens from `tokenUsage` (`cacheWriteTokens` → cache_creation). `--skip-cursor`. Missing session/API key skips that source.
- **Shared pricing** (`util/pricing.rs` → `estimate_model_cost` / `resolve_reported_cost`): Antigravity always estimates (was hardcoded $0). Hermes uses DB cost when sane, else public rates; reject reported cost if blended >$200/M tokens or >50× estimate (Hermes `estimated_cost_usd` was producing $100k+ for small volumes). Model name patterns: gemini-3.5-flash → $1.50/$0.15/$9, gemini-3-flash → $0.50/$0.05/$3, claude sonnet → $3/$0.30/$15, opus → $15/$1.50/$75, free/* → $0.
- **Antigravity emit rule**: only decoded SQLite `gen_metadata` token+timestamp blobs become `source=antigravity`. Encrypted leftover `conversations/*.pb` and `implicit/*.pb` are ignored (no per-prompt / per-byte fabrications). Import purges prior antigravity rows in DuckDB/MotherDuck before rewrite so stale estimates cannot linger. `gemini` is a different companion source and must not be labeled Antigravity.
- TypeScript 6: avoid `baseUrl` in `tsconfig.json`; keep path aliases with explicit `./src/...` prefixes.
- In fresh clones/worktrees without `node_modules`, run `bun install --frozen-lockfile` before `bunx tsc --noEmit` to avoid false missing-module/type errors.
- In restricted environments where Bun cannot write temp files, run checks with `BUN_TMPDIR="$PWD/.tmp/bun-tmp"` and `BUN_INSTALL_CACHE_DIR="$PWD/.tmp/bun-install-cache"`.
- In Codex worktrees that start on detached `HEAD`, create a branch from `origin/master` before making automation commits/PRs.
- If git operations fail in a linked worktree with `.git/worktrees/.../*.lock` permission errors, run branch/fetch/push from the owning checkout identified by `git worktree list --porcelain`.

## Routine operations

- Full import: `bun run src/scripts/import-all.ts --verbose`
- DuckDB backfill from ClickHouse: `bun run src/scripts/backfill-duckdb.ts`

## CI and archived Python docs

- `docs/archive/python/pyproject.toml` should keep `requires-python` aligned with dependency floors to avoid Dependabot security-update resolution failures.
- If that archived lockfile churn is not needed, consider disabling that Dependabot ecosystem in repo settings/config.
