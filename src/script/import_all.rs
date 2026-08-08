//! Full import: register sources/sinks, run pipeline, print summary.
//!
//! Exit policy (cron-friendly): exit 0 when at least one sink completes
//! without error. ClickHouse may be down while MotherDuck/local DuckDB
//! still succeeds — that is a successful run for the hourly job.

use crate::cli::ImportArgs;
use crate::fetcher::companion::CompanionSource;
use crate::pipeline::ImportRunner;
use crate::sink::clickhouse::ClickHouseSink;
use crate::sink::duckdb::DuckDbSink;
use crate::source::antigravity::{AntigravitySource, AntigravitySourceOptions};
use crate::source::ccusage::{CcusageSource, CcusageSourceOptions};
use crate::source::companion::{CompanionSource as CompanionDataSource, CompanionSourceOptions};
use crate::source::grok::{GrokSource, GrokSourceOptions};
use crate::source::hermes::{HermesSource, HermesSourceOptions};
use crate::util::date::resolve_effective_since;
use std::env;

/// Companion agents registered by default (mirrors TS `CCUSAGE_AGENT_SOURCES`).
const COMPANION_AGENTS: &[CompanionSource] = &[
    CompanionSource::Codex,
    CompanionSource::OpenCode,
    CompanionSource::Gemini,
    CompanionSource::OpenClaw,
    CompanionSource::Amp,
    CompanionSource::Droid,
    CompanionSource::Codebuff,
    CompanionSource::Pi,
    CompanionSource::Goose,
    CompanionSource::Kilo,
    CompanionSource::Copilot,
    CompanionSource::Kimi,
    CompanionSource::Qwen,
];

/// Run the full import pipeline from clap-parsed args.
pub async fn run(args: ImportArgs, verbose: bool) -> anyhow::Result<()> {
    dotenvy::dotenv().ok();
    apply_cli_env_overrides(&args);

    let days_back = args.days_back.or_else(|| {
        env::var("IMPORT_DAYS_BACK")
            .ok()
            .and_then(|v| v.parse::<i64>().ok())
    });
    let since = args
        .since
        .clone()
        .or_else(|| env::var("IMPORT_SINCE").ok())
        .or_else(|| env::var("IMPORT_SINCE_DATE").ok());
    let end_date = args
        .end_date
        .clone()
        .or_else(|| env::var("IMPORT_END_DATE").ok());

    let effective_since = resolve_effective_since(since.as_deref(), days_back);

    let import_id = uuid::Uuid::new_v4().to_string();
    let machine_name = hostname();
    let hash_projects = env::var("HASH_PROJECT_NAMES")
        .map(|v| v != "false")
        .unwrap_or(true);

    println!(
        "summa — machine: {}{}{}, import: {}",
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

    if args.dry_run {
        println!("dry-run: skipping source fetch and sink writes");
        println!("\n=== Summary ===");
        println!("  source (dry-run): 0 rows");
        println!("  sink (dry-run): 0 rows, 0ms");
        println!("  total: 0ms");
        return Ok(());
    }

    let mut sources: Vec<Box<dyn crate::model::DataSource>> = Vec::new();

    if !args.skip_ccusage {
        sources.push(Box::new(CcusageSource::new(CcusageSourceOptions {
            machine_name: machine_name.clone(),
            hash_projects: Some(hash_projects),
            timeout: env::var("IMPORT_COMMAND_TIMEOUT_MS")
                .ok()
                .and_then(|v| v.parse().ok()),
            verbose: Some(verbose),
            days_back,
            since: effective_since.clone(),
            end_date: end_date.clone(),
            import_id: Some(import_id.clone()),
        })));
    }

    if !args.skip_antigravity {
        sources.push(Box::new(AntigravitySource::new(AntigravitySourceOptions {
            machine_name: machine_name.clone(),
            hash_projects,
            verbose,
            days_back,
            since: effective_since.clone(),
            end_date: end_date.clone(),
            import_id: import_id.clone(),
        })));
    }

    if !args.skip_hermes {
        sources.push(Box::new(HermesSource::new(HermesSourceOptions {
            machine_name: machine_name.clone(),
            hash_projects,
            verbose,
            days_back,
            since: effective_since.clone(),
            end_date: end_date.clone(),
            import_id: import_id.clone(),
        })));
    }

    if !args.skip_grok {
        sources.push(Box::new(GrokSource::new(GrokSourceOptions {
            machine_name: machine_name.clone(),
            hash_projects,
            verbose,
            days_back,
            since: effective_since.clone(),
            end_date: end_date.clone(),
            import_id: import_id.clone(),
            base_dir: None,
        })));
    }

    for agent in COMPANION_AGENTS {
        let id = agent.as_str();
        if should_skip_companion(&args, id) {
            continue;
        }
        sources.push(Box::new(CompanionDataSource::new(CompanionSourceOptions {
            source: *agent,
            machine_name: machine_name.clone(),
            hash_projects,
            timeout_ms: env::var("IMPORT_COMMAND_TIMEOUT_MS")
                .ok()
                .and_then(|v| v.parse().ok()),
            verbose: Some(verbose),
            data_path: None,
            since: effective_since.clone(),
            end_date: end_date.clone(),
            import_id: import_id.clone(),
        })));
    }

    let mut sinks: Vec<Box<dyn crate::model::DataSink>> = Vec::new();

    if !args.skip_clickhouse {
        sinks.push(Box::new(ClickHouseSink::new()));
    }

    if !args.skip_duckdb {
        // Local-first: default to auto-created file under XDG data dir.
        // MotherDuck / cloud only when explicitly set (CLI, env, or config).
        let duckdb_path = crate::config::Config::resolve_duckdb_path(args.duckdb_path.as_deref());
        sinks.push(Box::new(DuckDbSink::new(duckdb_path)));
    }

    let mut runner = ImportRunner { sources, sinks };
    let result = runner.run().await?;

    println!("\n=== Summary ===");
    for source in &result.sources {
        println!(
            "  source {}: {} rows{}",
            source.name,
            source.rows,
            source
                .error
                .as_deref()
                .map(|e| format!(" (error: {})", e))
                .unwrap_or_default()
        );
    }
    for sink in &result.sinks {
        let total = sink.rows_written.values().copied().sum::<u64>();
        println!(
            "  sink {}: {} rows, {}ms{}",
            sink.sink_name,
            total,
            sink.duration_ms,
            sink
                .error
                .as_deref()
                .map(|e| format!(" (error: {})", e))
                .unwrap_or_default()
        );
    }
    println!("  total: {}ms", result.total_duration_ms);

    // Partial-success: at least one healthy sink is enough for cron exit 0.
    let any_sink_ok = result.sinks.iter().any(|s| s.error.is_none());
    if result.sinks.is_empty() || !any_sink_ok {
        anyhow::bail!("all sinks failed (or no sinks configured)");
    }
    Ok(())
}

fn should_skip_companion(args: &ImportArgs, id: &str) -> bool {
    match id {
        "codex" => args.skip_codex,
        "opencode" => args.skip_opencode,
        _ => false,
    }
}

fn apply_cli_env_overrides(args: &ImportArgs) {
    if let Some(ref host) = args.ch_host {
        env::set_var("CH_HOST", host);
    }
    if let Some(port) = args.ch_port {
        env::set_var("CH_PORT", port.to_string());
    }
    if let Some(ref db) = args.ch_database {
        env::set_var("CH_DATABASE", db);
    }
}

fn hostname() -> String {
    env::var("HOSTNAME")
        .or_else(|_| env::var("COMPUTERNAME"))
        .ok()
        .or_else(|| {
            std::process::Command::new("hostname")
                .output()
                .ok()
                .and_then(|o| {
                    let s = String::from_utf8_lossy(&o.stdout).trim().to_string();
                    if s.is_empty() {
                        None
                    } else {
                        Some(s)
                    }
                })
        })
        .unwrap_or_else(|| "unknown".to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::cli::{Cli, Commands};
    use clap::Parser;

    #[test]
    fn clap_accepts_days_back_and_duckdb_path() {
        let cli = Cli::try_parse_from([
            "summa",
            "import",
            "--days-back",
            "2",
            "--duckdb-path",
            "md:ccusage",
        ])
        .expect("cron argv must parse");
        match cli.command {
            Commands::Import(a) => {
                assert_eq!(a.days_back, Some(2));
                assert_eq!(a.duckdb_path.as_deref(), Some("md:ccusage"));
            }
            _ => panic!("expected Import"),
        }
    }

    #[test]
    fn clap_accepts_since_and_days_back_together() {
        let cli = Cli::try_parse_from([
            "summa",
            "import",
            "--since",
            "2026-08-01",
            "--days-back",
            "7",
        ])
        .expect("both flags must parse");
        match cli.command {
            Commands::Import(a) => {
                assert_eq!(a.since.as_deref(), Some("2026-08-01"));
                assert_eq!(a.days_back, Some(7));
                let eff = resolve_effective_since(a.since.as_deref(), a.days_back);
                assert_eq!(eff.as_deref(), Some("2026-08-01"));
            }
            _ => panic!("expected Import"),
        }
    }

    #[test]
    fn default_duckdb_is_local_not_motherduck() {
        let path = crate::config::Config::resolve_duckdb_path(None);
        assert!(
            !path.starts_with("md:"),
            "default must be local file, got {path}"
        );
        assert!(path.ends_with("summa.duckdb") || path.contains("summa"));
    }
}
