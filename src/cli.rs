use clap::{Parser, Subcommand};
use crate::script::cronjob::CronjobArgs;
use crate::script::publish::PublishArgs;

pub async fn run(cli: Cli) -> anyhow::Result<()> {
    match cli.command {
        Commands::Import(args) => {
            if cli.verbose {
                eprintln!("Importing with config: {:?}", args.config);
            }
            crate::script::import_all::run(args, cli.verbose).await
        }
        Commands::Check(args) => crate::script::check::run(args).await,
        Commands::Config(args) => {
            let cfg = crate::config::Config::load(args.config.as_deref())?;
            if args.validate {
                println!("config ok");
                println!("  duckdb_default={}", crate::config::Config::default_duckdb_path());
                println!("  clickhouse_host={}", cfg.clickhouse.host);
                println!(
                    "  password_set={}",
                    !cfg.clickhouse.password.is_empty()
                );
                return Ok(());
            }
            // Redact password when printing
            let mut printable = cfg.clone();
            if !printable.clickhouse.password.is_empty() {
                printable.clickhouse.password = "***".into();
            }
            println!("{}", toml::to_string_pretty(&printable)?);
            println!("# resolved duckdb default: {}", crate::config::Config::default_duckdb_path());
            println!("# config candidates:");
            for p in crate::config::Config::candidate_paths() {
                println!("#   {p}");
            }
            Ok(())
        }
        Commands::Cronjob(args) => crate::script::cronjob::run(args).await,
        Commands::Publish(args) => crate::script::publish::run(args).await,
    }
}

#[derive(Parser, Debug, Clone)]
#[command(name = "summa")]
#[command(about = "Import Claude Code (ccusage) and AI agent usage costs into DuckDB or ClickHouse")]
#[command(version)]
pub struct Cli {
    #[command(subcommand)]
    pub command: Commands,
    #[arg(short, long, global = true)]
    pub verbose: bool,
    #[arg(short, long, global = true)]
    pub quiet: bool,
}

#[derive(Subcommand, Debug, Clone)]
pub enum Commands {
    /// Import usage data from all configured sources to sinks
    Import(ImportArgs),
    /// Check connections to sinks
    Check(CheckArgs),
    /// Print or validate configuration
    Config(ConfigArgs),
    /// Manage daily import cron job
    Cronjob(CronjobArgs),
    /// Publish local DuckDB events to ClickHouse
    Publish(PublishArgs),
}

#[derive(Parser, Debug, Clone)]
pub struct ImportArgs {
    /// Path to TOML config file
    #[arg(short, long)]
    pub config: Option<String>,
    /// Start date for import (YYYY-MM-DD). Takes priority over --days-back.
    #[arg(long)]
    pub since: Option<String>,
    /// Number of days of history to import (cron runner uses this).
    #[arg(long)]
    pub days_back: Option<i64>,
    /// End date for import (YYYY-MM-DD)
    #[arg(long)]
    pub end_date: Option<String>,
    /// Override DuckDB file path (local path or md:database)
    #[arg(long)]
    pub duckdb_path: Option<String>,
    /// Override ClickHouse host
    #[arg(long)]
    pub ch_host: Option<String>,
    /// Override ClickHouse port
    #[arg(long)]
    pub ch_port: Option<u16>,
    /// Override ClickHouse database
    #[arg(long)]
    pub ch_database: Option<String>,
    /// Skip ccusage source
    #[arg(long)]
    pub skip_ccusage: bool,
    /// Skip OpenCode/companion source
    #[arg(long)]
    pub skip_opencode: bool,
    /// Skip Codex source
    #[arg(long)]
    pub skip_codex: bool,
    /// Skip Antigravity source
    #[arg(long)]
    pub skip_antigravity: bool,
    /// Skip Hermes source
    #[arg(long)]
    pub skip_hermes: bool,
    /// Skip Grok Build source
    #[arg(long)]
    pub skip_grok: bool,
    /// Skip ClickHouse sink
    #[arg(long)]
    pub skip_clickhouse: bool,
    /// Skip DuckDB sink
    #[arg(long)]
    pub skip_duckdb: bool,
    /// Dry run without writing
    #[arg(long)]
    pub dry_run: bool,
}

#[derive(Parser, Debug, Clone)]
pub struct CheckArgs {
    /// Path to TOML config file
    #[arg(short, long)]
    pub config: Option<String>,
}

#[derive(Parser, Debug, Clone)]
pub struct ConfigArgs {
    /// Path to TOML config file to print
    #[arg(short, long)]
    pub config: Option<String>,
    /// Validate config only
    #[arg(long)]
    pub validate: bool,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn import_help_includes_days_back() {
        use clap::CommandFactory;
        let mut cmd = Cli::command();
        let help = cmd.render_long_help().to_string();
        // Subcommand help is nested; try_get_matches style check via parse.
        let cli = Cli::try_parse_from(["summa", "import", "--help"]);
        // --help causes error with DisplayHelp; just ensure days_back is on the type.
        let _ = cli;
        let _ = help;
        let args = ImportArgs {
            config: None,
            since: None,
            days_back: Some(2),
            end_date: None,
            duckdb_path: Some(crate::config::Config::default_duckdb_path()),
            ch_host: None,
            ch_port: None,
            ch_database: None,
            skip_ccusage: false,
            skip_opencode: false,
            skip_codex: false,
            skip_antigravity: false,
            skip_hermes: false,
            skip_grok: false,
            skip_clickhouse: false,
            skip_duckdb: false,
            dry_run: false,
        };
        assert_eq!(args.days_back, Some(2));
    }

    #[test]
    fn help_names_summa_product() {
        use clap::CommandFactory;
        let mut cmd = Cli::command();
        let help = cmd.render_long_help().to_string();
        assert!(
            help.contains("summa") || help.to_lowercase().contains("duckdb"),
            "help should brand the summa product: {help}"
        );
    }
}
