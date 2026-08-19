# Install summa on a machine

Binary `summa`. Never `cargo build --release` on a laptop or home Linux host — CI builds; you only install the artifact.

## 1. Binary

```bash
curl -fsSL https://raw.githubusercontent.com/duyet/summa/master/install.sh | bash
summa update   # newest CI artifact for this OS/arch (needs gh auth or GITHUB_TOKEN)
```

Installs `~/.local/bin/summa`. Env: `SUMMA_INSTALL_DIR`, `SUMMA_VERSION`, `SUMMA_DRY_RUN=1`.

Auto-register the import scheduler at install time:

```bash
SUMMA_SETUP_CRON=1 SUMMA_CRON_EVERY=1h \
  curl -fsSL https://raw.githubusercontent.com/duyet/summa/master/install.sh | bash
```

## 2. Config

`~/.config/summa/config.toml` has no secrets. Tokens go in `credentials.toml`.

```toml
# ~/.config/summa/config.toml
[clickhouse]
host = "localhost"
port = 8123
user = "default"
database = "analytics"
protocol = "http"

[importer]
# duckdb_path = "md:ccusage"   # MotherDuck
days_back = 7
# skip_cursor / skip_grok stay off — every machine imports; sinks dedup
```

```toml
# ~/.config/summa/credentials.toml
clickhouse_password = "…"
motherduck_token = "…"
# cursor_session = "WorkosCursorSessionToken=…"
# cursor_api_key = "…"
# telemetry_token = "…"
```

Keep **Cursor** and **Grok** enabled on every host. Account-wide Cursor rows use `machine_name=account`. DuckDB delete-by-key and ClickHouse ReplacingMergeTree collapse duplicates. Do not set `skip_cursor` to “avoid double-count”.

## 3. Cron

```bash
summa cronjob install                 # 1h, --days-back from config (else 2)
summa cronjob install --every 6h
summa cronjob install --every 1d      # 08:00
summa cronjob install --dry-run
summa cronjob install --replace       # drop legacy run-import.sh crontab
summa cronjob status
summa cronjob remove
```

Backends: macOS launchd, Linux systemd --user, crontab, or a sleep-loop when neither exists.

## 4. Smoke

```bash
summa config --validate
summa check --json
summa import --verbose --days-back=2
```

## 5. Optional telemetry hub

On the machine that should fan-out writes and serve burn.duyet.net:

```bash
summa serve --bind 0.0.0.0:8787
```

See `docs/telemetry.md`. Kubernetes sidecar + Hermes sidebar: `deploy/k8s/summa-sidecar.yaml`.
