# Changelog

All notable changes to **summa** (`summa-import`) are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/).

release-please owns versioned sections below. Keep a human `[Unreleased]` block
at the top for curated notes; generated release blocks are inserted above it.

## [Unreleased]

### Product name

Public name is **summa** (Latin *summa* = sum, total, summary) — a lightweight
CLI that tallies AI coding-agent usage into analytics stores.

| Candidate | Notes |
|-----------|--------|
| **summa** (chosen) | Short, Latin, product/binary name. Crate: `summa-import` (`summa` taken on crates.io). |
| ductus | Latin *conduit* — good pipeline metaphor; longer / less common. |
| tabula | Latin *table* — data tables; generic. |
| mensura | Latin *measure* — accurate but heavy. |
| ratio | Latin *reckoning* — overloaded in English. |
| ccusage-import | Descriptive legacy name; free on crates.io but long. |

Binary: `summa` · Config: `~/.config/summa/` · Crate: `summa-import`.

### Planned / in progress

- Performance and binary-size work via release profile (`lto`, `strip`,
  `codegen-units = 1`, `panic = abort`).
- Local-first DuckDB by default; optional MotherDuck / ClickHouse cloud sync.
- XDG config + separate credentials file.
- `curl … \| bash` install from GitHub Releases.
- crates.io publish on release (gated on `CARGO_REGISTRY_TOKEN`).

## [0.1.0] — 2026-08-08

First public **0.1.x** product line (version reset from internal 3.x).

### Features

- Rust CLI **summa** importing usage from Claude Code (ccusage), Codex,
  OpenCode, Antigravity, Hermes, Grok Build, and other companion agents into a
  single `ccusage_events` table.
- **Local-first DuckDB**: auto-creates `~/.local/share/summa/summa.duckdb`
  (or platform data dir) with parent directories when no path is configured.
  MotherDuck (`md:…`) and ClickHouse remain optional for cloud sync / warehouse.
- **Config discovery**: project `./summa.toml`, XDG `~/.config/summa/config.toml`,
  legacy paths, and `$SUMMA_CONFIG`.
- **Credentials separated**: `~/.config/summa/credentials.toml` (or
  `./credentials.toml`) holds `clickhouse_password` / `motherduck_token` so
  main config stays free of secrets. Env vars (`CH_PASSWORD`, `MOTHERDUCK_TOKEN`)
  still work.
- **Release automation**: release-please for changelog + tags; GitHub Release
  builds stripped multi-arch binaries; optional crates.io publish.
- **Install**: `curl -fsSL …/install.sh | bash` installs the host binary from
  GitHub Releases into `~/.local/bin`.

### Performance

- Release profile: LTO, single codegen unit, symbol strip, `panic = abort`.
- Default import window friendly to cron (`--days-back`).

[Unreleased]: https://github.com/duyet/ccusage-import/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/duyet/ccusage-import/releases/tag/v0.1.0
