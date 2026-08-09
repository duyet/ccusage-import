# Changelog

All notable changes to **summa** (`summa-import`) are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/).

release-please owns versioned sections below. Keep a human `[Unreleased]` block
at the top for curated notes; generated release blocks are inserted above it.

## [Unreleased]

### Product name

**summa** (Latin *summa* = sum, total, summary) — tallies Claude Code (ccusage)
and other AI coding-agent usage into analytics stores.

| | |
|---|---|
| Binary | `summa` |
| Crate | `summa-import` (`summa` taken on crates.io) |
| Config | `~/.config/summa/` |

### Features (0.1.x product line)

- Local-first DuckDB; optional ClickHouse / MotherDuck
- XDG config + separate credentials
- release-please, release binaries, crates.io publish, curl\|bash install

## [0.1.0] — 2026-08-08

First public **0.1.x** product line (version reset from internal 3.x).

### Features

- Rust CLI **summa** importing usage from Claude Code (ccusage), Codex,
  OpenCode, Antigravity, Hermes, Grok Build, and companions into
  `ccusage_events`.
- Local DuckDB default under XDG data dir (auto-create parents).
- Config discovery + credentials file separation.
- Release automation and install script.

### Performance

- Release profile: LTO, single codegen unit, strip, `panic = abort`.

[Unreleased]: https://github.com/duyet/summa/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/duyet/summa/releases/tag/v0.1.0
