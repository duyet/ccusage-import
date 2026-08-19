/**
 * Core domain types: EventRow, pipeline types, and DataSource/DataSink traits.
 *
 * The EventRow struct is the single flat shape written to the `ccusage_events`
 * table. Its field order is authoritative — it must match EVENTS_COLUMNS in
 * parser/schema.rs (enforced by schema_tests.rs).
 */

use async_trait::async_trait;
use serde::{Deserialize, Serialize};

/// Flat event row — the single shape written to `ccusage_events`.
///
/// Field order is intentional and must match `EVENTS_COLUMNS` (see
/// `parser/schema.rs`). The `schema_tests.rs` golden test enforces the
/// 1:1 invariant.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, PartialOrd)]
#[serde(default)]
pub struct EventRow {
    pub date: String,
    pub record_type: String,
    pub record_key: String,
    pub source: String,
    pub machine_name: String,
    pub model_name: String,
    pub session_id: String,
    pub project_path: String,
    pub input_tokens: u64,
    pub output_tokens: u64,
    pub cache_creation_tokens: u64,
    pub cache_read_tokens: u64,
    pub reasoning_tokens: u64,
    pub total_tokens: u64,
    pub cost: f64,
    pub dedup_key: String,
    pub import_id: String,
    pub block_id: String,
    /// Nullable(DateTime) in ClickHouse, TIMESTAMP in DuckDB.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub start_time: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub end_time: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub actual_end_time: Option<String>,
    pub is_active: u8,
    pub is_gap: u8,
    pub entries: u32,
    /// Nullable(Float64) in ClickHouse, DOUBLE DEFAULT 0 in DuckDB.
    pub burn_rate: f64,
    /// Nullable(Float64) in ClickHouse, DOUBLE DEFAULT 0 in DuckDB.
    pub projection: f64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub usage_limit_reset_time: Option<String>,
    pub created_at: String,
    pub updated_at: String,
}

/// Default values for all fields except timestamps (set to `now`).
impl Default for EventRow {
    fn default() -> Self {
        EventRow {
            date: String::new(),
            record_type: String::new(),
            record_key: String::new(),
            source: String::new(),
            machine_name: String::new(),
            model_name: String::new(),
            session_id: String::new(),
            project_path: String::new(),
            input_tokens: 0,
            output_tokens: 0,
            cache_creation_tokens: 0,
            cache_read_tokens: 0,
            reasoning_tokens: 0,
            total_tokens: 0,
            cost: 0.0,
            dedup_key: String::new(),
            import_id: String::new(),
            block_id: String::new(),
            start_time: None,
            end_time: None,
            actual_end_time: None,
            is_active: 0,
            is_gap: 0,
            entries: 0,
            burn_rate: 0.0,
            projection: 0.0,
            usage_limit_reset_time: None,
            created_at: String::new(),
            updated_at: String::new(),
        }
    }
}

impl EventRow {
    /// Return field values in EVENTS_COLUMNS order for CSV serialization.
    /// Mirrors the TS `toCsvLine` behavior: null→empty, non-finite→"0",
    /// numbers as-is, strings quoted if they contain `,`, `"`, or `\n`.
    pub fn csv_row(&self) -> Vec<String> {
        vec![
            csv_str(&self.date),
            csv_str(&self.record_type),
            csv_str(&self.record_key),
            csv_str(&self.source),
            csv_str(&self.machine_name),
            csv_str(&self.model_name),
            csv_str(&self.session_id),
            csv_str(&self.project_path),
            csv_num_u64(self.input_tokens),
            csv_num_u64(self.output_tokens),
            csv_num_u64(self.cache_creation_tokens),
            csv_num_u64(self.cache_read_tokens),
            csv_num_u64(self.reasoning_tokens),
            csv_num_u64(self.total_tokens),
            csv_num_f64(self.cost),
            csv_str(&self.dedup_key),
            csv_str(&self.import_id),
            csv_str(&self.block_id),
            csv_opt(&self.start_time),
            csv_opt(&self.end_time),
            csv_opt(&self.actual_end_time),
            csv_num_u64(self.is_active as u64),
            csv_num_u64(self.is_gap as u64),
            csv_num_u64(self.entries as u64),
            csv_num_f64(self.burn_rate),
            csv_num_f64(self.projection),
            csv_opt(&self.usage_limit_reset_time),
            csv_str(&self.created_at),
            csv_str(&self.updated_at),
        ]
    }
}

fn csv_escape(s: &str) -> String {
    if s.contains(',') || s.contains('"') || s.contains('\n') {
        let escaped: String = s.replace('"', "\"\"");
        format!("\"{}\"", escaped)
    } else {
        s.to_string()
    }
}

fn csv_str(s: &str) -> String {
    csv_escape(s)
}

fn csv_opt(s: &Option<String>) -> String {
    match s {
        None => String::new(),
        Some(v) => csv_str(v),
    }
}

fn csv_num_u64(v: u64) -> String {
    v.to_string()
}

fn csv_num_f64(v: f64) -> String {
    if !v.is_finite() {
        "0".to_string()
    } else if v.fract() == 0.0 {
        format!("{}", v as i64)
    } else {
        format!("{}", v)
    }
}

// ---------------------------------------------------------------------------
// Pipeline types
// ---------------------------------------------------------------------------

/// Flat event rows for the single `ccusage_events` table.
#[derive(Debug, Clone, Default)]
pub struct EventsSnapshotData {
    pub events: Vec<EventRow>,
}

/// Result from a source fetch.
#[derive(Debug, Clone)]
pub struct SourceResult {
    pub source_name: String,
    pub data: EventsSnapshotData,
    pub fetched_at: String, // ISO 8601
    pub error: Option<String>,
}

/// Result from a sink write.
#[derive(Debug, Clone, Default)]
pub struct SinkResult {
    pub sink_name: String,
    pub tables_written: Vec<String>,
    pub rows_written: std::collections::HashMap<String, u64>,
    pub duration_ms: u64,
    pub error: Option<String>,
}

/// Full pipeline result.
#[derive(Debug, Clone, Default)]
pub struct PipelineResult {
    pub sources: Vec<SourceSummary>,
    pub sinks: Vec<SinkResult>,
    pub total_duration_ms: u64,
}

#[derive(Debug, Clone)]
pub struct SourceSummary {
    pub name: String,
    pub rows: usize,
    pub error: Option<String>,
}

// ---------------------------------------------------------------------------
// Traits
// ---------------------------------------------------------------------------

/// Source: fetches raw data from an external provider.
#[async_trait]
pub trait DataSource: Send + Sync {
    /// Human-readable source identifier (e.g. `"ccusage"`, `"codex"`).
    fn name(&self) -> &'static str;
    async fn fetch(&self) -> anyhow::Result<SourceResult>;
}

/// Sink: writes processed rows to a destination.
#[async_trait]
pub trait DataSink: Send + Sync {
    /// Human-readable sink identifier (e.g. `"clickhouse"`, `"duckdb"`).
    fn name(&self) -> &'static str;
    async fn connect(&mut self) -> anyhow::Result<()>;
    async fn write(&mut self, data: EventsSnapshotData) -> anyhow::Result<SinkResult>;
    async fn close(&mut self) -> anyhow::Result<()>;
}
