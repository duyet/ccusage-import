# summa-import

CLI **`summa`** — import Claude Code (ccusage), Codex, OpenCode, Cursor, Grok,
and other AI coding-agent usage into DuckDB / ClickHouse.

This crate lives in the [duyet/summa](https://github.com/duyet/summa) workspace
(`apps/cli`). The telemetry API Worker is `apps/api` (not published).

```bash
curl -fsSL https://summa.duyet.net/install.sh | bash
curl -fsSL https://raw.githubusercontent.com/duyet/summa/master/install.sh | bash
cargo install summa-import --locked
```

Docs: [install](https://github.com/duyet/summa/blob/master/docs/install.md),
[telemetry](https://github.com/duyet/summa/blob/master/docs/telemetry.md).
