use crate::config::Config;
use crate::model::{DataSink, EventRow};
use crate::sink::clickhouse::ClickHouseSink;

#[derive(clap::Args, Debug, Clone)]
pub struct PublishArgs {
    /// Path to TOML config file
    #[arg(short, long)]
    pub config: Option<String>,
}

pub async fn run(args: PublishArgs) -> anyhow::Result<()> {
    let cfg = Config::load(args.config.as_deref())?;
    let duckdb_path = Config::resolve_duckdb_path(cfg.importer.duckdb_path.as_deref());

    println!("publish: {} → clickhouse {}", duckdb_path, cfg.clickhouse.host);

    let conn = duckdb::Connection::open(&duckdb_path)?;
    let mut stmt = conn.prepare(
        "SELECT date, record_type, record_key, source, machine_name, model_name, \
         session_id, project_path, input_tokens, output_tokens, \
         cache_creation_tokens, cache_read_tokens, reasoning_tokens, total_tokens, cost, \
         dedup_key, import_id, block_id, start_time, end_time, actual_end_time, \
         is_active, is_gap, entries, burn_rate, projection, usage_limit_reset_time, \
         created_at, updated_at \
         FROM ccusage_events",
    )?;
    let mut rows = stmt.query([])?;

    let mut events = Vec::new();
    while let Some(row) = rows.next()? {
        events.push(EventRow {
            date: row.get(0)?,
            record_type: row.get(1)?,
            record_key: row.get(2)?,
            source: row.get(3)?,
            machine_name: row.get(4)?,
            model_name: row.get(5)?,
            session_id: row.get(6)?,
            project_path: row.get(7)?,
            input_tokens: row.get(8)?,
            output_tokens: row.get(9)?,
            cache_creation_tokens: row.get(10)?,
            cache_read_tokens: row.get(11)?,
            reasoning_tokens: row.get(12)?,
            total_tokens: row.get(13)?,
            cost: row.get(14)?,
            dedup_key: row.get(15)?,
            import_id: row.get(16)?,
            block_id: row.get(17)?,
            start_time: row.get(18)?,
            end_time: row.get(19)?,
            actual_end_time: row.get(20)?,
            is_active: row.get(21)?,
            is_gap: row.get(22)?,
            entries: row.get(23)?,
            burn_rate: row.get(24)?,
            projection: row.get(25)?,
            usage_limit_reset_time: row.get(26)?,
            created_at: row.get(27)?,
            updated_at: row.get(28)?,
        });
    }

    if events.is_empty() {
        println!("no data to publish");
        return Ok(());
    }

    let mut sink = ClickHouseSink::new();
    sink.connect().await?;
    let result = sink.write(crate::model::EventsSnapshotData { events }).await?;

    println!("published: {} rows to {}", result.rows_written.values().sum::<u64>(), sink.name());
    Ok(())
}
