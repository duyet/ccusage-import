//! Query live duckdb for source=grok. Usage:
//!   cargo run --example query_grok_duckdb -- /path/to.db [/path/out.txt]
//!   cargo run --example query_grok_duckdb -- md:ccusage [/path/out.txt]

fn main() {
    let _ = dotenvy::dotenv();
    let path = std::env::args().nth(1).expect("db path arg");
    let out = std::env::args().nth(2);
    let conn = duckdb::Connection::open_with_flags(
        &path,
        duckdb::Config::default()
            .access_mode(duckdb::AccessMode::ReadOnly)
            .expect("config"),
    )
    .expect("open");

    let mut lines = Vec::new();
    lines.push("=== source=grok aggregates ===".to_string());
    {
        let mut stmt = conn
            .prepare(
                "SELECT source, record_type, count(*)::BIGINT,
                        coalesce(sum(input_tokens),0)::BIGINT,
                        coalesce(sum(output_tokens),0)::BIGINT,
                        coalesce(sum(cache_read_tokens),0)::BIGINT,
                        coalesce(sum(reasoning_tokens),0)::BIGINT,
                        coalesce(sum(total_tokens),0)::BIGINT,
                        coalesce(sum(entries),0)::BIGINT
                 FROM ccusage_events WHERE source = 'grok'
                 GROUP BY source, record_type ORDER BY record_type",
            )
            .unwrap();
        let mut rows = stmt.query([]).unwrap();
        while let Some(r) = rows.next().unwrap() {
            let source: String = r.get(0).unwrap();
            let rt: String = r.get(1).unwrap();
            let c: i64 = r.get(2).unwrap();
            let i: i64 = r.get(3).unwrap();
            let o: i64 = r.get(4).unwrap();
            let cr: i64 = r.get(5).unwrap();
            let re: i64 = r.get(6).unwrap();
            let t: i64 = r.get(7).unwrap();
            let e: i64 = r.get(8).unwrap();
            lines.push(format!(
                "{source}\t{rt}\trows={c}\tinput={i}\toutput={o}\tcache_read={cr}\treasoning={re}\ttotal={t}\tentries={e}"
            ));
        }
    }
    lines.push("=== by date/model/record_type ===".to_string());
    {
        let mut stmt = conn
            .prepare(
                "SELECT date::VARCHAR, model_name, record_type, count(*)::BIGINT,
                        coalesce(sum(input_tokens),0)::BIGINT,
                        coalesce(sum(output_tokens),0)::BIGINT,
                        coalesce(sum(total_tokens),0)::BIGINT,
                        coalesce(sum(entries),0)::BIGINT
                 FROM ccusage_events WHERE source='grok'
                 GROUP BY 1,2,3 ORDER BY 1,2,3",
            )
            .unwrap();
        let mut rows = stmt.query([]).unwrap();
        while let Some(r) = rows.next().unwrap() {
            let d: String = r.get(0).unwrap();
            let m: String = r.get(1).unwrap();
            let rt: String = r.get(2).unwrap();
            let c: i64 = r.get(3).unwrap();
            let i: i64 = r.get(4).unwrap();
            let o: i64 = r.get(5).unwrap();
            let t: i64 = r.get(6).unwrap();
            let e: i64 = r.get(7).unwrap();
            lines.push(format!(
                "{d}\t{m}\t{rt}\trows={c}\tin={i}\tout={o}\ttot={t}\tentries={e}"
            ));
        }
    }
    let text = lines.join("\n");
    println!("{text}");
    if let Some(p) = out {
        std::fs::write(p, &text).expect("write out");
    }
}
