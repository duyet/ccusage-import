# sumptus

**sumptus** (*Latin*: expense, cost, outlay) — lightweight CLI that imports
Claude Code (**ccusage**), Codex, OpenCode, Grok, and other agent usage into a
local DuckDB file, optionally syncing to ClickHouse or MotherDuck.

| | |
|---|---|
| **Binary** | `sumptus` |
| **Crate** | [`sumptus`](https://crates.io/crates/sumptus) |
| **Version** | 0.1.x |
| **License** | MIT |

> GitHub repo stays `duyet/ccusage-import` for history; public product name is **sumptus**.

### Name brainstorm

| Name | Latin | Fit for ccusage / Claude | crates.io |
|------|-------|--------------------------|-----------|
| **sumptus** ✓ | expense, cost, outlay | What you *spend* on Claude & agents | free |
| usus | use, usage | Perfect sense, but taken by another AI-usage CLI | taken |
| usura | use / interest | Usage root; awkward “usury” sense | free |
| tessera | token, ticket | Token counts | taken |
| census | enumeration | Counting tokens | taken |
| clarus | clear / famous | Echo of *Claude* (stretch) | taken |
| summa | sum, total | Totals of usage | taken |
| ductus | conduit | Pipeline metaphor | — |
| ccusage-import | — | Legacy descriptive name | free, long |

## Install

### curl | bash (prebuilt GitHub Release)

```bash
curl -fsSL https://raw.githubusercontent.com/duyet/ccusage-import/master/install.sh | bash
```

Installs into `~/.local/bin/sumptus`. Override with `SUMPTUS_INSTALL_DIR` /
`SUMPTUS_VERSION` / `SUMPTUS_DRY_RUN=1`.

### Cargo (crates.io)

```bash
cargo install sumptus --locked
```

### From source

```bash
git clone https://github.com/duyet/ccusage-import.git
cd ccusage-import
cargo build --release
./target/release/sumptus --help
```

## Quick start (local-first)

No cloud credentials required. Import writes a local DuckDB file, creating
parent directories automatically:

```bash
sumptus import --verbose
# → ~/.local/share/sumptus/sumptus.duckdb   (macOS/Linux XDG data dir)
```

Optional cloud / warehouse:

```bash
# ClickHouse (password via credentials file or CH_PASSWORD)
sumptus import --ch-host db.example.com --ch-port 8443

# MotherDuck only when you opt in
export MOTHERDUCK_TOKEN=…
sumptus import --duckdb-path=md:sumptus
```

## Config

Discovery order (first existing wins):

1. `$SUMPTUS_CONFIG` (or legacy `$CCUSAGE_IMPORT_CONFIG`)
2. `./sumptus.toml` / `./ccusage-import.toml`
3. `~/.config/sumptus/config.toml` (XDG)
4. `~/.sumptus/config.toml`
5. `~/.ccusage-import.toml` (legacy)
6. `/etc/sumptus/config.toml`

### Main config (no secrets required)

`~/.config/sumptus/config.toml`:

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
# duckdb_path = "md:sumptus"
days_back = 7
```

### Credentials (separate file)

`~/.config/sumptus/credentials.toml` (or `./credentials.toml`):

```toml
clickhouse_password = "…"
motherduck_token = "…"
```

Also: `$SUMPTUS_CREDENTIALS`, `CH_PASSWORD`, `MOTHERDUCK_TOKEN`.

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
| `SUMPTUS_CONFIG` | no | Config file path |
| `SUMPTUS_CREDENTIALS` | no | Credentials file path |

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
sumptus import --verbose
sumptus import --days-back=7
sumptus import --since=2025-01-01 --end-date=2025-12-31
sumptus import --duckdb-path=md:sumptus
sumptus import --skip-clickhouse          # local DuckDB only
cargo run -- backfill-duckdb              # CH → DuckDB
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
