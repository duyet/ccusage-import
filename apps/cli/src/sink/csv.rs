use crate::model::{DataSink, EventsSnapshotData, SinkResult};
use async_trait::async_trait;

/// Pure CSV row formatting helper, kept separate so it can be unit-tested
/// without a database.
pub fn csv_value(v: &str) -> String {
    if v.is_empty() {
        return String::new();
    }
    if v.contains(',') || v.contains('"') || v.contains('\n') {
        let escaped = v.replace('"', "\"\"");
        format!("\"{}\"", escaped)
    } else {
        v.to_string()
    }
}

pub fn csv_line(values: &[String]) -> String {
    values.iter().map(|v| csv_value(v)).collect::<Vec<_>>().join(",")
}

/// CSV sink: writes event rows to stdout as CSV.
pub struct CsvSink {
    header_written: bool,
}

impl CsvSink {
    pub fn new() -> Self {
        Self { header_written: false }
    }
}

#[async_trait]
impl DataSink for CsvSink {
    fn name(&self) -> &'static str {
        "csv"
    }

    async fn connect(&mut self) -> anyhow::Result<()> {
        Ok(())
    }

    async fn write(&mut self, data: EventsSnapshotData) -> anyhow::Result<SinkResult> {
        use std::io::Write;
        let mut out = std::io::stdout().lock();
        let mut result = SinkResult {
            sink_name: self.name().to_string(),
            tables_written: Vec::new(),
            rows_written: std::collections::HashMap::new(),
            duration_ms: 0,
            error: None,
        };

        for row in &data.events {
            if !self.header_written {
                let headers: Vec<String> = vec![
                    "date".into(),
                    "record_type".into(),
                    "record_key".into(),
                    "source".into(),
                    "machine_name".into(),
                    "model_name".into(),
                    "session_id".into(),
                    "project_path".into(),
                    "input_tokens".into(),
                    "output_tokens".into(),
                    "cache_creation_tokens".into(),
                    "cache_read_tokens".into(),
                    "reasoning_tokens".into(),
                    "total_tokens".into(),
                    "cost".into(),
                    "dedup_key".into(),
                    "import_id".into(),
                    "block_id".into(),
                    "start_time".into(),
                    "end_time".into(),
                    "actual_end_time".into(),
                    "is_active".into(),
                    "is_gap".into(),
                    "entries".into(),
                    "burn_rate".into(),
                    "projection".into(),
                    "usage_limit_reset_time".into(),
                    "created_at".into(),
                    "updated_at".into(),
                ];
                writeln!(out, "{}", csv_line(&headers))?;
                self.header_written = true;
            }
            let line = csv_line(&row.csv_row());
            writeln!(out, "{}", line)?;
        }

        result.tables_written.push("ccusage_events".to_string());
        result.rows_written.insert("ccusage_events".to_string(), data.events.len() as u64);
        Ok(result)
    }

    async fn close(&mut self) -> anyhow::Result<()> {
        Ok(())
    }
}

impl Default for CsvSink {
    fn default() -> Self {
        Self::new()
    }
}
