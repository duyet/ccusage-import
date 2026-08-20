# Changelog

All notable changes to **summa** (`summa-import`) are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/).

release-please owns versioned sections below. Keep a human `[Unreleased]` block
at the top for curated notes; generated release blocks are inserted above it.

## [0.1.1](https://github.com/duyet/summa/compare/v0.1.0...v0.1.1) (2026-08-10)


### Features

* add JSON output to summa check ([f9a8a4f](https://github.com/duyet/summa/commit/f9a8a4f1ad8d404a8c12e1ed315347ad498bf9f3))
* add summa cronjob subcommand ([8e7fac8](https://github.com/duyet/summa/commit/8e7fac897384f0eae5f54a08f876ff4ed87b2ba8))
* add summa publish subcommand for DuckDB → ClickHouse ([761bcd3](https://github.com/duyet/summa/commit/761bcd31aa0b97d4d884e5dca76e6af2f178325d))
* **config:** add cloud sink routing with route/legacy fallback ([5d65697](https://github.com/duyet/summa/commit/5d656979b0f6dd0e872444001ad74fa39634e7fa))
* implement summa check subcommand ([1e81d32](https://github.com/duyet/summa/commit/1e81d3246746062d79bd9d188d704a53c4e0943e))
* **pricing:** estimate antigravity and hermes costs from public rates ([694e196](https://github.com/duyet/summa/commit/694e196d4d70a822b936d7b60cfbbd44fa090bc6))
* show per-model cost summary in summa check ([306dd90](https://github.com/duyet/summa/commit/306dd904871202385308f1a9412f43f5ce44b809))


### Bug Fixes

* **deps:** update dependency chalk to v6 ([#53](https://github.com/duyet/summa/issues/53)) ([f586fbd](https://github.com/duyet/summa/commit/f586fbd799c14d569c2803095c819d9799188732))
* **deps:** update rust crate dirs to v6 ([#73](https://github.com/duyet/summa/issues/73)) ([466e39c](https://github.com/duyet/summa/commit/466e39c947674edf2e525efd4ef5cfc26d14ed1a))
* **deps:** update rust crate rusqlite to 0.40 ([#71](https://github.com/duyet/summa/issues/71)) ([6f93bc5](https://github.com/duyet/summa/commit/6f93bc59c719c13573a50919ba1e9042a63df03d))
* **deps:** update rust crate toml to 0.9 ([#72](https://github.com/duyet/summa/issues/72)) ([c236fc2](https://github.com/duyet/summa/commit/c236fc251c44952ec6a0897be2ae6a80e858c19b))
* **deps:** update rust crate toml to v1 ([#74](https://github.com/duyet/summa/issues/74)) ([3c39d82](https://github.com/duyet/summa/commit/3c39d821eee70444fd63e1c5e441c5fc9d618bfe))

## [Unreleased]

### Fixes

- Worker `/ping` and `/v1/ingest` no longer panic on `Instant` in WASM (Cloudflare 1101). MotherDuck ingest now INSERTs after dedup delete. Analytics falls back to MotherDuck when ClickHouse is unreachable from the edge.

### CI

- Workspace CI/release: `-p summa-import` / `-p summa-api`, `cargo package`, install.sh dry-run, k8s + wrangler validation, release-please package path `apps/cli`
- `curl | bash` installer: rolling `nightly` GitHub Release, local HTTP e2e in CI, `GET /install.sh` on the Worker

### Features

- Cargo workspace: `apps/cli` (Rust `summa`) and `apps/api` (Rust Cloudflare Worker via workers-rs)
- Monorepo apps `@summa/cli` + `@summa/api`; `.env.example` for CLI and Worker credentials
- Cloud telemetry hub at https://summa.duyet.net (Rust Worker). `summa import` POSTs `/v1/ingest`; D1 is keys only; usage is ClickHouse + MotherDuck. `summa serve` only pings the hub (deprecated local HTTP)
- `SUMMA_SETUP_CRON=1` on `install.sh` registers `summa cronjob install` (`summa update` then `summa import`)
- k3s/Hermes: import **client** CronJob (not local `summa serve`); sidebar iframe https://summa.duyet.net; `docs/k3s.md`, `deploy/k8s/summa-sidecar.yaml`
- `summa cronjob install` generates and registers a user import service (launchd on macOS, systemd --user timer on Linux, crontab fallback), with `--every 1h|6h|1d` and `--dry-run`
- Import Cursor account-wide usage (all machines) from cursor.com dashboard / Admin APIs; classify cursor / cloud agent / API / grok bot; `--skip-cursor`
- Probe Grok CLI-proxy billing for countable account-wide totals (`source=grok-api`); skip credits-percent payloads instead of fabricating turns

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
