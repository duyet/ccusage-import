# summa

**summa** (*Latin*: sum, total, summary) — lightweight CLI that imports Claude
Code (**ccusage**), Codex, OpenCode, Grok, and other agent usage into local
DuckDB, optionally syncing to ClickHouse or MotherDuck.

| | |
|---|---|
| **Binary** | `summa` |
| **Crate** | [`summa-import`](https://crates.io/crates/summa-import) |
| **Version** | 0.1.x |
| **License** | MIT |

> GitHub repo stays `duyet/ccusage-import` for history. Crate is `summa-import`
> because bare `summa` is taken on crates.io (full-text search server).

### Name

| Name | Notes |
|------|--------|
| **summa** ✓ | Latin *summa* — sum / total / summary of usage. Product + binary. |
| summa-import | crates.io package (binary still `summa`) |
| usus | “Usage” — taken by another AI-usage CLI |
| sumptus | Expense/outlay — free, alternate we tried |

## Install

### curl | bash

```bash
curl -fsSL https://raw.githubusercontent.com/duyet/ccusage-import/master/install.sh | bash
```

Installs `~/.local/bin/summa`. Env: `SUMMA_INSTALL_DIR`, `SUMMA_VERSION`, `SUMMA_DRY_RUN=1`.

### Cargo

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

```bash
summa import --verbose
# → ~/.local/share/summa/summa.duckdb
```

Optional cloud:

```bash
summa import --ch-host db.example.com --ch-port 8443
export MOTHERDUCK_TOKEN=…
summa import --duckdb-path=md:summa
```

## Config

1. `$SUMMA_CONFIG` (or legacy `$CCUSAGE_IMPORT_CONFIG`)
2. `./summa.toml` / `./ccusage-import.toml`
3. `~/.config/summa/config.toml` (XDG)
4. `~/.summa/config.toml`
5. `~/.ccusage-import.toml` (legacy)
6. `/etc/summa/config.toml`

Main config has no secrets. Credentials: `~/.config/summa/credentials.toml` or
`$SUMMA_CREDENTIALS` / `CH_PASSWORD` / `MOTHERDUCK_TOKEN`.

```toml
# ~/.config/summa/config.toml
[clickhouse]
host = "localhost"
port = 8123
user = "default"
database = "analytics"
protocol = "http"

[importer]
days_back = 7
```

```toml
# ~/.config/summa/credentials.toml
clickhouse_password = "…"
motherduck_token = "…"
```

## Usage

```bash
summa import --verbose
summa import --days-back=7
summa import --skip-clickhouse
cargo run -- backfill-duckdb
```

## Development / release

```bash
cargo test
cargo build --release
cargo package
cargo publish   # needs CARGO_REGISTRY_TOKEN / cargo login
```

- release-please + GitHub Release builds multi-arch `summa` binaries
- crates.io publish gated on `CARGO_REGISTRY_TOKEN`
- See `CHANGELOG.md`
