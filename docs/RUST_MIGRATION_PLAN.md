# Rust Migration Plan — ccusage-import

> **Goal:** Migrate the full TypeScript + Bun data pipeline into a native Rust
> binary, preserving 100% behavioral compatibility with the existing test
> suite (142 tests) while adding TOML config, env-variable overlay, and a
> plugin-style adapter architecture for sources and sinks.

---

## 1. Scope & Motivation

| Current | Target |
|---------|--------|
| TypeScript + Bun runtime | Native Rust binary (single `ccusage-import` crate) |
| `zod` runtime validation | Serde derive + typed structs |
| `duckdb-async` / `duckdb` (Node) | `duckdb` crate (sync, wrapped in `spawn_blocking`) |
| `@clickhouse/client` (HTTP) | `reqwest` → ClickHouse HTTP API |
| `bun:sqlite` | `rusqlite` (sync, wrapped in `spawn_blocking`) |
| `commander` | `clap` v4 (derive) |
| `zod` JSON parsing | `serde_json` |
| Manual proto decoder | Ported `decodeProto` in pure Rust |

**Non-goals:** The React/Ink TTY UI (`src/ui/`) is out of scope for the MVP.
The CLI will use simple stderr logging (matching the cron/non-interactive
mode). A future enhancement can add a TUI via `tui-rs` / `crossterm`.

---

## 2. Crate Architecture

```
Cargo.toml                       # binary + lib crate
src/
├── main.rs                      # clap CLI entry point → dispatches subcommands
├── lib.rs                       # library facade
├── config.rs                    # ConfigManager: TOML file + env overlay + validation
├── model.rs                     # EventRow struct (29 fields), SourceResult, SinkResult,
│                                #   PipelineResult, DataSource/DataSink traits (async_trait)
├── pipeline.rs                  # ImportRunner (parallel sources → fan-out sinks)
├── util/
│   ├── mod.rs
│   ├── hash.rs                  # SHA-256 (sha2 crate) — 8-char project hash, 16-char dedup
│   ├── date.rs                  # parse_date, parse_date_time, ch_now, ch_datetime
│   ├── tokens.rs                # total_tokens = in + out + cache_create + cache_read
│   ├── retry.rs                 # retry_with_options (exponential backoff + jitter)
│   ├── timer.rs                 # with_timeout (race future vs timeout, kill on timeout)
│   ├── sql.rs                   # escape_sql_literal
│   ├── csv.rs                   # to_csv_value, to_csv_line
│   └── logger.rs                # create_logger (stderr-only, verbose-gated)
├── parser/
│   ├── mod.rs
│   ├── rows.rs                  # make_event_row, breakdown_row, block_row,
│   │                           #   build_ccusage_event_rows, build_companion_event_rows
│   ├── cost.rs                  # distribute_cost (proportional by output→input,
│   │                           #   last row absorbs rounding)
│   └── schema.rs                # EVENTS_COLUMNS, clickhouse_create_sql,
│                               #   clickhouse_alter_statements, duckdb_create_sql
├── source/
│   ├── mod.rs
│   ├── ccusage.rs               # CcusageSource — delegates to fetcher
│   ├── companion.rs             # CompanionDataSource (codex/opencode/gemini/…)
│   ├── antigravity.rs           # AntigravitySource — SQLite + proto decoder
│   └── hermes.rs                # HermesSource — SQLite state.db
├── fetcher/
│   ├── mod.rs
│   ├── ccusage.rs               # fetch_all_ccusage_data (npx ccusage CLI)
│   └── companion.rs             # fetch_all_companion_data, normalize_usage_row,
│                               #   normalize_model_breakdowns, build_agent_command_args
├── sink/
│   ├── mod.rs
│   ├── clickhouse.rs            # ClickHouseSink — HTTP INSERT/DELETE/CREATE
│   ├── duckdb.rs                # DuckDBSink — local or MotherDuck (md:)
│   └── schema.rs                # re-export from parser/schema
└── script/
    ├── mod.rs
    ├── import_all.rs            # full import entry point
    ├── backfill_duckdb.rs       # CH → DuckDB backfill
    ├── migrate.rs               # old 7-table → single ccusage_events
    └── cronjob.rs              # crontab setup
tests/
├── parser_tests.rs              # golden rows, distribute_cost, dates, extract_*
├── schema_tests.rs              # DDL byte-for-byte match, 29-column invariant
├── hash_tests.rs                # SHA-256 stability, cross-check with Python
├── csv_tests.rs                 # to_csv_value / to_csv_line
├── tokens_tests.rs              # 4-term total, Codex vs Claude
├── retry_tests.rs               # backoff, jitter, error filtering, edge cases
├── sql_tests.rs                 # escape_sql_literal
├── source_tests.rs              # antigravity proto, hermes sqlite (temp DBs)
├── companion_tests.rs           # normalize, fetch with mock executor
├── sink_tests.rs                # DuckDB local round-trip, CSV formatting
├── config_tests.rs              # TOML parse + env overlay + validation
└── integration_tests.rs         # end-to-end pipeline with DuckDB sink
```

---

## 3. Dependency Matrix

| Concern | Crate | Version |
|---------|-------|---------|
| Async runtime | `tokio` (full) | 1.x |
| Async traits | `async-trait` | 0.1 |
| CLI args | `clap` (derive) | 4.x |
| Config / serde | `serde`, `serde_json` | 1.x |
| TOML | `toml` | 0.8 |
| SHA-256 | `sha2` | 0.10 |
| DuckDB | `duckdb` | 1.x |
| SQLite (read-only) | `rusqlite` | 0.32 |
| HTTP (ClickHouse) | `reqwest` (json, blocking ok) | 0.4 / rustls |
| Dates | `chrono` | 0.4 |
| UUIDs | `uuid` (v4) | 1.x |
| Errors | `anyhow`, `thiserror` | 1.x |
| Logging | `eprintln` (stdlib) or `tracing` | — |
| File walk | `walkdir` | 2.x |
| Test macros | built-in `#[test]` | — |

---

## 4. Behavioral Invariants (Golden Tests)

These MUST remain byte-identical across the migration:

1. **SHA-256 hashing** — `hash_project_name(path, true)` → first 8 hex chars of
   SHA-256(UTF-8 bytes). Verified cross-language (Python: `hashlib.sha256(b"...").hexdigest()[:8]`).

2. **Dedup key** — SHA-256 of `source|machine|record_type|date|model|record_key`
   → first 16 hex chars.

3. **`total_tokens`** — `input + output + cacheCreation + cacheRead`
   (reasoning **excluded** for both Claude and Codex). The companion
   `2717719` assertion (469867 + 33580 + 0 + 2214272) is the guardrail.

4. **`distribute_cost`** — proportional to `outputTokens`, falls back to
   `inputTokens`; last breakdown absorbs rounding so `Σ == parentCost`.
   No-op when per-model costs already > 0 or parentCost ≤ 0.

5. **Cost convention** — Codex/Agents: `inputTokens` includes cached (no
   double-count). Claude: `cacheReadTokens` separate (`total = in + out +
   cacheCreate + cacheRead`).

6. **Companion normalization** — maps alias fields
   (`cachedInputTokens→cacheReadTokens`, `reasoningOutputTokens/thoughtsTokens/reasoning_tokens→reasoningTokens`,
   `costUSD/cost/totalCost→cost`, `id/session/directory→sessionId`, etc.).

7. **Schema DDL** — `clickHouseCreateSql()` and `duckDbCreateSql()` must
   match the captured verbatim baselines. 29 columns, 1:1 with
   `make_event_row` keys.

8. **ClickHouse deferred columns** — `projection` and
   `usage_limit_reset_time` are excluded from base CREATE (CH v26 parser bug)
   and added via idempotent ALTER. `reasoning_tokens` has a defensive ALTER too.

9. **Block rows** use the source's own `totalTokens` (not the 4-term formula).

10. **Anti-gravity proto decoder** — minimal protobuf wire-format parser
    extracting fields 1→4 (prompt), 1→4→3 (comp), 1→4→5 (cached),
    1→19 (model), 1→9→4→1 (seconds), 1→9→4→2 (nanos).

11. **Companion CLI JSON parsing** — skip log lines before first `{`/`[`.

12. **Pipeline** — sources fetched in parallel; sinks connected + written in
    parallel; continue-on-failure (one sink's error doesn't block others).

---

## 5. TOML Config Schema

```toml
# ccusage-import.toml  (or .ccusage-import.toml in home or CWD)
[clickhouse]
host = "localhost"
port = 8123
user = "default"
password = "${CH_PASSWORD}"   # env interpolation via ${VAR}
database = "default"
protocol = "auto"              # "auto" | "http" | "https"; auto HTTPS on 443/8443/9440

[importer]
hash_project_names = true      # default: env != "false"
machine_name = ""              # default: os hostname
command_timeout = 120         # seconds, 1..=600
max_parallel_workers = 3      # 1..=10
duckdb_path = ""               # default: env DUCKDB_PATH or md:ccusage
days_back = 7
since = ""                     # overrides days_back
end_date = ""
skip_ccusage = false
skip_opencode = false
skip_codex = false
skip_antigravity = false
skip_hermes = false
skip_clickhouse = false
opencode_path = ""             # env OPENCODE_DATA_DIR
codex_path = ""                # env CODEX_HOME

[ui]
animated = false               # TTY detection at runtime
color = true
verbose = false
quiet = false
heatmap_min_intensity = 1
heatmap_max_intensity = 5
```

**Env overlay rules:** Any `${VAR}` in the TOML is expanded from the process
environment at load time. If the TOML key is unset, fall back to the
corresponding `CH_*`, `DUCKDB_PATH`, `MOTHERDUCK_TOKEN`, `IMPORT_*`,
`HASH_PROJECT_NAMES`, `OPENCODE_DATA_DIR`, `CODEX_HOME`, `HERMES_HOME` env
vars.

---

## 6. Execution Order (Milestones)

| Milestone | Tasks | Tests |
|-----------|-------|-------|
| **M1: Scaffolding + Core** | Cargo.toml, lib.rs, model.rs (traits + EventRow), config.rs, util/* | `--no-run` compiles |
| **M2: Pure Logic (parser layer)** | parser/rows.rs, cost.rs, date.rs, hash.rs, schema.rs | All unit tests pass |
| **M3: Sinks + Fetchers (I/O)** | sink/clickhouse, sink/duckdb, sink/csv, fetcher/ccusage, fetcher/companion | DuckDB round-trip, CSV, HTTP mock |
| **M4: Sources** | source/{ccusage, companion, antigravity, hermes} | Antigravity proto test, Hermes SQLite test |
| **M5: Pipeline + CLI** | pipeline.rs, main.rs, scripts/* | Integration test (full pipeline → DuckDB) |
| **M6: Polish** | CI, README, AGENTS.md, run-import.sh, .gitignore | `cargo test` + `cargo clippy` clean |

---

## 7. Test Strategy

- **Unit tests** — `#[cfg(test)]` modules inline, mirroring the TS test files
  1:1. Each TS test becomes a Rust test with the same assertions.
- **Golden files** — the `dedup_key` and `hash` values from TS tests are
  ported as hardcoded expected constants.
- **SQLite integration** — Antigravity and Hermes tests write temp SQLite DBs
  using `rusqlite` build scripts (replacing `bun:sqlite`).
- **DuckDB integration** — real `:memory:` DuckDB round-trip tests for the
  sink (no external service needed).
- **ClickHouse** — scoped DELETE + INSERT via HTTP; tested with a local CH
  instance when available, otherwise a reqwest mock.
- **`cargo nextest`** (if available) for parallel test execution.

### Test Porting Matrix

| TS test file | Rust test module | Key assertions to preserve |
|---|---|---|
| `parsers.test.ts` | `parser_tests.rs` | 27-field golden rows, distribute_cost rounding, parse_date/datetime |
| `schema.test.ts` | `schema_tests.rs` | DDL byte-for-byte, 29 cols 1:1 |
| `companion.test.ts` | `companion_tests.rs` | fetch_all mock executor, total=2717719, 180 for cache case |
| `companion-normalize.test.ts` | `companion_tests.rs` | alias mapping, session id/directory/date |
| `csv.test.ts` | `csv_tests.rs` | null→'', NaN→'0', Date format, quoting |
| `tokens.test.ts` | `tokens_tests.rs` | 3300, 2717719, 0 |
| `retry.test.ts` | `retry_tests.rs` | backoff math, jitter bounds, error filtering |
| `sql.test.ts` | `sql_tests.rs` | single-quote doubling |
| `antigravity.test.ts` | `source_tests.rs` | proto decode, est tokens, db daily/session |
| `hermes.test.ts` | `source_tests.rs` | sqlite session/daily aggregation, since filter |
| `formatting.test.ts` | `util_tests.rs` (or lib) | format_number, format_cost, format_duration |
| `hash.test.ts` | `hash_tests.rs` | stable 8-hex, Python cross-check `b49e9761` |

---

## 8. Key Implementation Notes

### 8.1 Row key ordering
`make_event_row` produces a map whose key order determines CSV column order
for DuckDB `COPY FROM`. Rust `serde_json::Value` objects preserve insertion
order, but a typed `EventRow` struct gives compile-time field order. We'll
use a struct for the row + a macro to serialize in the exact column order
defined by `EVENTS_COLUMNS`.

### 8.2 ClickHouse HTTP protocol
- `POST /?query=<SQL>` — DDL, ALTER, DELETE
- `POST /?query=INSERT INTO ccusage_events FORMAT JSONEachRow` — body is
  newline-delimited JSON (one object per line)
- `POST /?query=<SQL>&default_format=JSONEachRow` — SELECT returns
  newline-delimited JSON rows

### 8.3 DuckDB COPY FROM CSV
- Write temporary CSV file, `COPY ccusage_events (cols) FROM '/tmp/xxx.csv'`
- Column order from `EVENTS_COLUMNS` (struct field order).

### 8.4 Proto decoder (Antigravity)
The custom varint + wire-type parser operates on `&[u8]`. Port the exact
algorithm: field 1 → submessage, field 4 within sub → {2:prompt, 5:cached,
3:comp}, field 19/21 → model name string, field 9→4 → {1:seconds, 2:nanos}.

### 8.5 Async boundary
- CLI processes (ccusage, npx) → `tokio::process::Command`
- SQLite (antigravity/hermes) → `tokio::task::spawn_blocking` + `rusqlite`
- DuckDB → `tokio::task::spawn_blocking` + `duckdb`
- ClickHouse HTTP → `reqwest::Client`

### 8.6 Config loading order
1. `ccusage-import.toml` (search: CWD → HOME → `/etc/ccusage-import.toml`)
2. Env var `CCUSAGE_IMPORT_CONFIG` (explicit path override)
3. Process environment variables override any unset TOML key
4. CLI flags override everything

---

## 9. Risk Register

| Risk | Mitigation |
|------|-----------|
| DuckDB Rust crate MotherDuck support | Use `duckdb` crate with `md:` conn string; falls back to CLI exec if crate lacks MD support |
| Proto decoder behavioral mismatch | Ported test from `antigravity.test.ts` with exact byte-level assertions |
| SHA-256 cross-language mismatch | `sha2` crate produces identical hex; verified by `hash_tests.rs` cross-check |
| CLAP arg parsing changes UX | Mirror exact flags from `cli.ts` / `import-all.ts` |
| ClickHouse HTTP vs native protocol | HTTP is what `@clickhouse/client` uses (port 8123) — same surface area |
| Test DB cleanup | All temp DBs use `tempfile` crate; `DROP TABLE IF EXISTS` in teardown |
