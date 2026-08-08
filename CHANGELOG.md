# Changelog

All notable changes to **sumptus** are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/).

release-please owns versioned sections below. Keep a human `[Unreleased]` block
at the top for curated notes; generated release blocks are inserted above it.

## [Unreleased]

### Product name

**sumptus** (Latin *sumptus* = expense, cost, outlay) — the cost of running
Claude Code (ccusage) and other coding agents, tallied into analytics stores.

| Candidate | Notes |
|-----------|--------|
| **sumptus** (chosen) | Expense/outlay of agent usage; free on crates.io; binary = crate. |
| usus | Perfect “usage” sense — taken by another AI-usage CLI. |
| usura | Usage root; “usury” connotation. |
| tessera | Latin *token* — taken. |
| census | Counting — taken. |
| clarus | Stretch toward *Claude* — taken. |
| summa | Sum/total — taken; weaker link to ccusage spend. |
| ccusage-import | Legacy descriptive name. |

Binary / crate: `sumptus` · Config: `~/.config/sumptus/` · Events table still `ccusage_events`.

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

- Rust CLI **sumptus** importing usage from Claude Code (ccusage), Codex,
  OpenCode, Antigravity, Hermes, Grok Build, and other companion agents into a
  single `ccusage_events` table.
- **Local-first DuckDB**: auto-creates `~/.local/share/sumptus/sumptus.duckdb`
  (or platform data dir) with parent directories when no path is configured.
  MotherDuck (`md:…`) and ClickHouse remain optional for cloud sync / warehouse.
- **Config discovery**: project `./sumptus.toml`, XDG `~/.config/sumptus/config.toml`,
  legacy paths, and `$SUMPTUS_CONFIG`.
- **Credentials separated**: `~/.config/sumptus/credentials.toml` (or
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
