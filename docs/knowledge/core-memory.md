# Core Memory

Small durable notes for ongoing maintenance automation.

## Scan scope commands

```bash
git log --since='<last-run-iso>' --pretty=format:'%H %cI %s' --name-only
git log --since='7 days ago' --pretty=format:'%h %cI %s'
rg -n "<symbol>" src tests -g '!**/*.test.ts' -g '!**/*.spec.ts'
```

## Known guardrails

- `run-import.sh` is Bun-only; do not add npm/yarn fallback.
- `src/scripts/setup-cronjob.ts` must write crontab via stdin (`crontab -`), not shell-quoted `echo`.
- Keep sink dedup delete filters SQL-escaped in both ClickHouse and DuckDB sinks.

## CI and archived Python docs

- `docs/archive/python/pyproject.toml` should keep `requires-python` aligned with dependency floors to avoid Dependabot security-update resolution failures.
- If that archived lockfile churn is not needed, consider disabling that Dependabot ecosystem in repo settings/config.
