# summa

**summa** (*Latin*: sum, total, summary) is a lightweight CLI that imports AI
coding-agent usage into a local DuckDB file — optionally syncing to ClickHouse
or MotherDuck.

| | |
|---|---|
| **Binary** | `summa` |
| **Crate** | [`summa-import`](https://crates.io/crates/summa-import) |
| **Version** | 0.1.x |
| **License** | MIT |

> Repo path remains `duyet/ccusage-import` for history; the public product name is **summa**.

### Name brainstorm (shortlist)

| Name | Why considered |
|------|----------------|
| **summa** ✓ | Latin *summa* — sum/total/summary of usage. Short binary. |
| ductus | Latin *conduit* — pipeline metaphor |
| tabula | Latin *table* — event tables |
| mensura | Latin *measure* |
| ccusage-import | Legacy descriptive name |

Crate is `summa-import` because bare `summa` is taken on crates.io.

## Install

### curl | bash (prebuilt GitHub Release)

```bash
curl -fsSL https://raw.githubusercontent.com/duyet/ccusage-import/master/install.sh | bash
```

Installs into `~/.local/bin/summa`. Override with `SUMMA_INSTALL_DIR` /
`SUMMA_VERSION` / `SUMMA_DRY_RUN=1`.

### Cargo (crates.io)

```bash
cargo install summa-import --locked
```

### From source

```bash
git clone https://github.com/duyet/ccusage-import.git
cd ccusage-import
cargo build --release
./target/release/summa --help
```

## Quick start (local-first)

No cloud credentials required. Import writes a local DuckDB file, creating
parent directories automatically:

```bash
summa import --verbose
# → ~/.local/share/summa/summa.duckdb   (macOS/Linux XDG data dir)
```

Optional cloud / warehouse:

```bash
# ClickHouse (password via credentials file or CH_PASSWORD)
summa import --ch-host db.example.com --ch-port 8443

# MotherDuck only when you opt in
export MOTHERDUCK_TOKEN=…
summa import --duckdb-path=md:summa
```

## Config

Discovery order (first existing wins):

1. `$SUMMA_CONFIG` (or legacy `$CCUSAGE_IMPORT_CONFIG`)
2. `./summa.toml` / `./ccusage-import.toml`
3. `~/.config/summa/config.toml` (XDG)
4. `~/.summa/config.toml`
5. `~/.ccusage-import.toml` (legacy)
6. `/etc/summa/config.toml`

### Main config (no secrets required)

`~/.config/summa/config.toml`:

```toml
[clickhouse]
host = "localhost"
port = 8123
user = "default"
database = "analytics"
protocol = "http"
# password left empty — load from credentials file or CH_PASSWORD

[importer]
# omit duckdb_path for local default; set md:name for MotherDuck
# duckdb_path = "md:summa"
days_back = 7
```

### Credentials (separate file)

`~/.config/summa/credentials.toml` (or `./credentials.toml`):

```toml
clickhouse_password = "…"
motherduck_token = "…"
```

Also: `$SUMMA_CREDENTIALS`, `CH_PASSWORD`, `MOTHERDUCK_TOKEN`.

### Environment variables

| Variable | Required | Description |
|----------|----------|-------------|
| `CH_HOST` | for CH | ClickHouse hostname |
| `CH_PORT` | for CH | HTTP port |
| `CH_USER` | for CH | Username |
| `CH_PASSWORD` | for CH | Password (prefer credentials file) |
| `CH_DATABASE` | for CH | Database name |
| `DUCKDB_PATH` | no | Override DuckDB path (`md:…` for MotherDuck) |
| `MOTHERDUCK_TOKEN` | for MD | MotherDuck token |
| `SUMMA_CONFIG` | no | Config file path |
| `SUMMA_CREDENTIALS` | no | Credentials file path |

## What it does

Fetches usage from multiple agent sources into one flat `ccusage_events` table
(model breakdowns exploded inline):

| Source | Data |
|--------|------|
| **ccusage** | Claude Code daily, session, block, project usage |
| **codex** / companions | Codex, OpenCode, and other `@ccusage/*` agents |
| **antigravity** / **hermes** / **grok** | Additional local agent logs |

See `docs/schema.sql` for DDL and `docs/queries.sql` for examples.

## Usage

```bash
summa import --verbose
summa import --days-back=7
summa import --since=2025-01-01 --end-date=2025-12-31
summa import --duckdb-path=md:summa
summa import --skip-clickhouse          # local DuckDB only
cargo run -- backfill-duckdb            # CH → DuckDB
```

| Flag | Description |
|------|-------------|
| `--verbose` | Detailed logging |
| `--days-back=N` | Last N days |
| `--since` / `--end-date` | Date range |
| `--duckdb-path=PATH` | Local file or `md:database` |
| `--skip-clickhouse` | Skip ClickHouse sink |
| `--skip-duckdb` | Skip DuckDB sink |
| `--skip-<agent>` | Skip a source |

## Architecture

```
Sources                  Pipeline               Sinks
┌──────────┐           ┌──────────┐          ┌────────────┐
│ ccusage  │──fetch──→ │          │──write──→ │ DuckDB     │  (local default)
│ codex    │──fetch──→ │  runner  │──write──→ │ ClickHouse │  (optional)
│ …        │──fetch──→ │          │──write──→ │ MotherDuck │  (optional)
└──────────┘           └──────────┘          └────────────┘
```

## Cron

```bash
./run-import.sh
# or
cargo run -- setup-cronjob --every=30 --days-back=2
```

## Development

```bash
cargo test
cargo check
cargo build --release   # LTO + strip (see [profile.release])
cargo package           # crates.io dry-run packaging
```

## Release

- **release-please** opens a `chore: release X.Y.Z` PR (merge manually — never auto-merge).
- On GitHub Release publish: multi-arch `cargo build --release`, attach tarballs,
  optional `cargo publish` when `CARGO_REGISTRY_TOKEN` is set.
- Changelog: human `[Unreleased]` + release-please versioned blocks — see `CHANGELOG.md`.

## Docs

- `docs/knowledge/core-memory.md` — maintenance runbook
- `docs/schema.sql` / `docs/queries.sql`
- `CHANGELOG.md`
