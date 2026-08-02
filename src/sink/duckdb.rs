use crate::model::{DataSink, EventRow, EventsSnapshotData, SinkResult};
use crate::sink::csv::{csv_line, csv_value};
use async_trait::async_trait;
use std::collections::HashMap;
use std::path::Path;

/// DuckDB sink: writes flat event rows to `ccusage_events` using COPY FROM.
pub struct DuckDbSink {
    db_path: String,
    tables_ensured: bool,
}

impl DuckDbSink {
    pub fn new(db_path: impl Into<String>) -> Self {
        Self {
            db_path: db_path.into(),
            tables_ensured: false,
        }
    }

    fn db_path(&self) -> &str {
        &self.db_path
    }

    fn duckdb_create_sql() -> &'static str {
        "CREATE TABLE IF NOT EXISTS ccusage_events (\n\
         date DATE NOT NULL,\n\
         record_type VARCHAR NOT NULL,\n\
         record_key VARCHAR NOT NULL,\n\
         source VARCHAR NOT NULL DEFAULT 'ccusage',\n\
         machine_name VARCHAR NOT NULL,\n\
         model_name VARCHAR DEFAULT '',\n\
         session_id VARCHAR DEFAULT '',\n\
         project_path VARCHAR DEFAULT '',\n\
         input_tokens BIGINT DEFAULT 0,\n\
         output_tokens BIGINT DEFAULT 0,\n\
         cache_creation_tokens BIGINT DEFAULT 0,\n\
         cache_read_tokens BIGINT DEFAULT 0,\n\
         reasoning_tokens BIGINT DEFAULT 0,\n\
         total_tokens BIGINT DEFAULT 0,\n\
         cost DOUBLE DEFAULT 0,\n\
         dedup_key VARCHAR DEFAULT '',\n\
         import_id VARCHAR DEFAULT '',\n\
         block_id VARCHAR DEFAULT '',\n\
         start_time TIMESTAMP,\n\
         end_time TIMESTAMP,\n\
         actual_end_time TIMESTAMP,\n\
         is_active SMALLINT DEFAULT 0,\n\
         is_gap SMALLINT DEFAULT 0,\n\
         entries INTEGER DEFAULT 0,\n\
         burn_rate DOUBLE DEFAULT 0,\n\
         projection DOUBLE DEFAULT 0,\n\
         usage_limit_reset_time TIMESTAMP,\n\
         created_at TIMESTAMP DEFAULT current_timestamp,\n\
         updated_at TIMESTAMP DEFAULT current_timestamp\n\
         )"
    }

    fn ensure_tables(&mut self, conn: &duckdb::Connection) -> anyhow::Result<()> {
        if self.tables_ensured {
            return Ok(());
        }
        conn.execute(Self::duckdb_create_sql(), [])?;
        conn.execute(
            "ALTER TABLE ccusage_events ADD COLUMN IF NOT EXISTS reasoning_tokens BIGINT DEFAULT 0",
            [],
        )?;
        self.tables_ensured = true;
        Ok(())
    }

    fn write_events_sync(&mut self, rows: &[EventRow]) -> anyhow::Result<usize> {
        if rows.is_empty() {
            return Ok(0);
        }

        let conn = duckdb::Connection::open(self.db_path())?;
        self.ensure_tables(&conn)?;

        // Dedup: delete by scoped (date, record_type, source, machine_name).
        let mut scopes: Vec<(String, String, String, String)> = Vec::new();
        let mut seen: HashMap<(String, String, String, String), usize> = HashMap::new();
        for row in rows {
            let key = (
                row.date.clone(),
                row.record_type.clone(),
                row.source.clone(),
                row.machine_name.clone(),
            );
            if let std::collections::hash_map::Entry::Vacant(e) = seen.entry(key.clone()) {
                e.insert(scopes.len());
                scopes.push(key);
            }
        }

        for (date, record_type, source, machine_name) in &scopes {
            let sql = format!(
                "DELETE FROM ccusage_events WHERE date = '{}' AND record_type = '{}' AND source = '{}' AND machine_name = '{}'",
                csv_value(date),
                csv_value(record_type),
                csv_value(source),
                csv_value(machine_name),
            );
            conn.execute(&sql, [])?;
        }

        // Build CSV in memory and load via COPY FROM.
        let mut csv_lines: Vec<String> = Vec::with_capacity(rows.len() + 1);
        csv_lines.push(csv_line(&vec![
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
        ]));

        for row in rows {
            let values: Vec<String> = vec![
                csv_value(&row.date),
                csv_value(&row.record_type),
                csv_value(&row.record_key),
                csv_value(&row.source),
                csv_value(&row.machine_name),
                csv_value(&row.model_name),
                csv_value(&row.session_id),
                csv_value(&row.project_path),
                row.input_tokens.to_string(),
                row.output_tokens.to_string(),
                row.cache_creation_tokens.to_string(),
                row.cache_read_tokens.to_string(),
                row.reasoning_tokens.to_string(),
                row.total_tokens.to_string(),
                if row.cost.is_finite() { row.cost.to_string() } else { "0".into() },
                csv_value(&row.dedup_key),
                csv_value(&row.import_id),
                csv_value(&row.block_id),
                csv_opt_ts(&row.start_time),
                csv_opt_ts(&row.end_time),
                csv_opt_ts(&row.actual_end_time),
                row.is_active.to_string(),
                row.is_gap.to_string(),
                row.entries.to_string(),
                if row.burn_rate.is_finite() { row.burn_rate.to_string() } else { "0".into() },
                if row.projection.is_finite() { row.projection.to_string() } else { "0".into() },
                csv_opt_ts(&row.usage_limit_reset_time),
                csv_value(&row.created_at),
                csv_value(&row.updated_at),
            ];
            csv_lines.push(csv_line(&values));
        }

        let csv_data = csv_lines.join("\n");

        // Write CSV to a temp file and COPY FROM it.
        let tmp_path = Path::new(self.db_path()).with_extension("import.csv");
        std::fs::write(&tmp_path, csv_data)?;
        let tmp_path_str = tmp_path.to_string_lossy().replace('\\', "/");
        let sql = format!(
            "COPY ccusage_events FROM '{}' (HEADER, DELIMITER ',', FORMAT csv)",
            tmp_path_str
        );
        conn.execute(&sql, [])?;
        std::fs::remove_file(&tmp_path).ok();

        Ok(rows.len())
    }
}

fn csv_opt_ts(opt: &Option<String>) -> String {
    match opt {
        Some(v) if !v.is_empty() => v.replace('T', " ").replace('Z', ""),
        _ => String::new(),
    }
}

#[async_trait]
impl DataSink for DuckDbSink {
    fn name(&self) -> &'static str {
        "duckdb"
    }

    async fn connect(&mut self) -> anyhow::Result<()> {
        let db_path = self.db_path().to_string();
        tokio::task::spawn_blocking(move || {
            let conn = duckdb::Connection::open(&db_path)?;
            Ok::<_, anyhow::Error>(conn)
        })
        .await??;
        Ok(())
    }

    async fn write(&mut self, data: EventsSnapshotData) -> anyhow::Result<SinkResult> {
        let start = std::time::Instant::now();
        let rows = data.events;
        let mut result = SinkResult {
            sink_name: self.name().to_string(),
            tables_written: Vec::new(),
            rows_written: HashMap::new(),
            duration_ms: 0,
            error: None,
        };

        if rows.is_empty() {
            result.duration_ms = start.elapsed().as_millis() as u64;
            return Ok(result);
        }

        let count = tokio::task::spawn_blocking({
            let db_path = self.db_path().to_string();
            move || {
                let mut sink = DuckDbSink::new(db_path);
                sink.write_events_sync(&rows)
            }
        })
        .await??;

        result.tables_written.push("ccusage_events".to_string());
        result.rows_written.insert("ccusage_events".to_string(), count as u64);
        result.duration_ms = start.elapsed().as_millis() as u64;
        Ok(result)
    }

    async fn close(&mut self) -> anyhow::Result<()> {
        Ok(())
    }
}

impl Default for DuckDbSink {
    fn default() -> Self {
        Self::new("")
    }
}
