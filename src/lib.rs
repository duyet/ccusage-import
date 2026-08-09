//! summa — Rust library.
//!
//! Data pipeline importing Claude Code (ccusage), Codex, OpenCode,
//! Antigravity, Hermes, and Grok Build usage analytics into local DuckDB
//! and optional ClickHouse / MotherDuck.

pub mod cli;
pub mod config;
pub mod fetcher;
pub mod model;
pub mod parser;
pub mod pipeline;
pub mod script;
pub mod sink;
pub mod source;
pub mod util;

pub use model::{
    DataSink, DataSource, EventRow, EventsSnapshotData, PipelineResult, SinkResult, SourceResult,
};
pub use parser::schema::{
    click_house_alter_statements, click_house_create_sql, duck_db_create_sql, EVENTS_COLUMNS,
};
pub use util::hash::hash_project_name_sync;
pub use cli::{run, Cli, Commands, ImportArgs, CheckArgs, ConfigArgs};
pub use script::cronjob::{CronjobAction, CronjobArgs};

/// Public product name (binary / branding).
pub const PRODUCT_NAME: &str = "summa";
/// crates.io package name.
pub const PACKAGE_NAME: &str = "summa-import";
/// XDG config directory name under `~/.config/`.
pub const CONFIG_DIR_NAME: &str = "summa";
