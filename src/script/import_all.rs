use crate::config::{ClickHouseConfig, Config};
use crate::fetcher::companion::CCUSAGE_AGENT_SOURCES;
use crate::pipeline::{ImportRunner, PipelineOptions};
use crate::sink::clickhouse::ClickHouseSink;
use crate::sink::duckdb::DuckDbSink;
use crate::source::antigravity::AntigravitySource;
use crate::source::ccusage::CcusageSource;
use crate::source::companion::CompanionDataSource;
use crate::source::hermes::HermesSource;
use crate::util::timer::CommandTimeout;
use std::env;
use std::time::{SystemTime, UNIX_EPOCH};

/// Run the full import: register sources/sinks, execute pipeline, print summary.
pub fn run() -> anyhow::Result<()> {
    dotenvy::dotenv().ok();

    let args: Vec<String> = env::args().collect();
    let verbose = args.contains(&"--verbose".into()) || args.contains(&"-v".into());
    let skip_ccusage = args.contains(&"--skip-ccusage".into());
    let skip_antigravity = args.contains(&"--skip-antigravity".into());
    let skip_hermes = args.contains(&"--skip-hermes".into());
    let skip_clickhouse = args.contains(&"--skip-clickhouse".into());

    let duckdb_path = env::var("DUCKDB_PATH")
        .or_else(|_| {
            args.iter()
                .find(|a| a.starts_with("--duckdb-path="))
                .map(|a| a.split('=').nth(1).unwrap_or("").to_string())
        })
        .ok();

    let days_back = env::var("IMPORT_DAYS_BACK")
        .ok()
        .and_then(|v| v.parse::<i64>().ok())
        .or_else(|| {
            args.iter()
                .find(|a| a.starts_with("--days-back="))
                .and_then(|a| a.split('=').nth(1))
                .and_then(|v| v.parse::<i64>().ok())
        });

    let since = args.iter()
        .find(|a| a.starts_with("--since="))
        .and_then(|a| a.split('=').nth(1))
        .or_else(|| env::var("IMPORT_SINCE").ok())
        .or_else(|| env::var("IMPORT_SINCE_DATE").ok());

    let end_date = args.iter()
        .find(|a| a.starts_with("--end-date="))
        .and_then(|a| a.split('=').nth(1))
        .or_else(|| env::var("IMPORT_END_DATE").ok());

    let effective_since = if let Some(s) = since {
        Some(s)
    } else if let Some(days) = days_back.filter(|d| *d > 0) {
        let now = SystemTime::now().duration_since(UNIX_EPOCH).unwrap().as_secs();
        let past = now.saturating_sub((days as u64) * 24 * 60 * 60);
        Some(chrono::DateTime::from_timestamp(past as i64, 0)
            .unwrap_or_default()
            .format("%Y-%m-%d")
            .to_string())
    } else {
        None
    };

    let import_id = uuid::Uuid::new_v4().to_string();
    let machine_name = hostname::get()
        .ok()
        .and_then(|s| s.into_string().ok())
        .unwrap_or_default();
    let hash_projects = env::var("HASH_PROJECT_NAMES")
        .map(|v| v != "false")
        .unwrap_or(true);

    println!(
        "ccusage-import — machine: {}{}{}, import: {}",
        machine_name,
        effective_since
            .as_ref()
            .map(|s| format!(", since: {}", s))
            .unwrap_or_default(),
        end_date
            .as_ref()
            .map(|e| format!(", until: {}", e))
            .unwrap_or_default(),
        import_id
    );

    let mut runner = ImportRunner::new(PipelineOptions {
        machine_name: machine_name.clone(),
        hash_projects,
        import_id: import_id.clone(),
        since: effective_since.clone(),
        end_date,
        command_timeout_ms: env::var("IMPORT_COMMAND_TIMEOUT_MS")
            .ok()
            .and_then(|v| v.parse().ok()),
        max_parallel_workers: env::var("IMPORT_MAX_PARALLEL_WORKERS")
            .ok()
            .and_then(|v| v.parse().ok()),
    });

    if !skip_ccusage {
        runner.add_source(Box::new(CcusageSource::new(PipelineOptions {
            command_timeout_ms: env::var("IMPORT_COMMAND_TIMEOUT_MS")
                .ok()
                .and_then(|v| v.parse().ok()),
            max_parallel_workers: env::var("IMPORT_MAX_PARALLEL_WORKERS")
                .ok()
                .and_then(|v| v.parse().ok()),
            ..runner.options().clone()
        })));
    }
    if !skip_antigravity {
        runner.add_source(Box::new(AntigravitySource::new(PipelineOptions {
            command_timeout_ms: env::var("IMPORT_COMMAND_TIMEOUT_MS")
                .ok()
                .and_then(|v| v.parse().ok()),
            max_parallel_workers: env::var("IMPORT_MAX_PARALLEL_WORKERS")
                .ok()
                .and_then(|v| v.parse().ok()),
            ..runner.options().clone()
        })));
    }
    if !skip_hermes {
        runner.add_source(Box::new(HermesSource::new(PipelineOptions {
            command_timeout_ms: env::var("IMPORT_COMMAND_TIMEOUT_MS")
                .ok()
                .and_then(|v| v.parse().ok()),
            max_parallel_workers: env::var("IMPORT_MAX_PARALLEL_WORKERS")
                .ok()
                .and_then(|v| v.parse().ok()),
            ..runner.options().clone()
        })));
    }
    for agent in CCUSAGE_AGENT_SOURCES {
        if args.contains(&format!("--skip-{}", agent.id)) {
            continue;
        }
        runner.add_source(Box::new(CompanionDataSource::new(agent.id, PipelineOptions {
            command_timeout_ms: env::var("IMPORT_COMMAND_TIMEOUT_MS")
                .ok()
                .and_then(|v| v.parse().ok()),
            max_parallel_workers: env::var("IMPORT_MAX_PARALLEL_WORKERS")
                .ok()
                .and_then(|v| v.parse().ok()),
            ..runner.options().clone()
        })));
    }

    if !skip_clickhouse {
        runner.add_sink(Box::new(ClickHouseSink::new()));
    }
    if let Some(path) = duckdb_path {
        runner.add_sink(Box::new(DuckDbSink::new(path)));
    }

    let result = runner.run_blocking(verbose)?;

    println!("\n=== Summary ===");
    for source in &result.sources {
        println!(
            "  source {}: {} rows{}",
            source.name,
            source.rows,
            source.error.as_deref().map(|e| format!(" (error: {})", e)).unwrap_or_default()
        );
    }
    for sink in &result.sinks {
        let total = sink.rows_written.values().copied().sum::<u64>();
        println!(
            "  sink {}: {} rows, {}ms{}",
            sink.sink_name,
            total,
            sink.duration_ms,
            sink.error.as_deref().map(|e| format!(" (error: {})", e)).unwrap_or_default()
        );
    }
    println!("  total: {}ms", result.total_duration_ms);

    if result.sinks.iter().any(|s| s.error.is_some()) {
        std::process::exit(1);
    }
    Ok(())
}
