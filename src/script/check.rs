use crate::config::Config;

pub async fn run(args: crate::cli::CheckArgs) -> anyhow::Result<()> {
    let cfg = Config::load(args.config.as_deref())?;
    let duckdb_path = Config::resolve_duckdb_path(cfg.importer.duckdb_path.as_deref());

    let conn = duckdb::Connection::open(&duckdb_path)?;
    let mut stmt = conn.prepare(
        "SELECT min(date), max(date), count(*), \
         sum(input_tokens), sum(output_tokens), sum(total_tokens), sum(cost) \
         FROM ccusage_events",
    )?;
    let mut rows = stmt.query([])?;
    if let Some(row) = rows.next()? {
        let min_date: Option<String> = row.get(0)?;
        let max_date: Option<String> = row.get(1)?;
        let count: i64 = row.get(2)?;
        let input: u64 = row.get(3)?;
        let output: u64 = row.get(4)?;
        let total: u64 = row.get(5)?;
        let cost: f64 = row.get(6)?;

        println!("duckdb: {}", duckdb_path);
        println!("  date range: {} → {}", min_date.unwrap_or_default(), max_date.unwrap_or_default());
        println!("  records: {}", count);
        println!("  tokens: input={} output={} total={}", input, output, total);
        println!("  cost: ${:.2}", cost);
    } else {
        println!("duckdb: {}", duckdb_path);
        println!("  no data yet");
    }

    Ok(())
}
