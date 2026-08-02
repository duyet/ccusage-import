use clap::{Parser, Subcommand};

pub async fn run(cli: Cli) -> anyhow::Result<()> {
    match cli.command {
        Commands::Import(args) => {
            if cli.verbose {
                println!("Importing with config: {:?}", args.config);
            }
            println!("Import command not yet implemented");
            Ok(())
        }
        Commands::Check(_args) => {
            println!("Check command not yet implemented");
            Ok(())
        }
        Commands::Config(_args) => {
            println!("Config command not yet implemented");
            Ok(())
        }
    }
}

#[derive(Parser, Debug, Clone)]
#[command(name = "ccusage-import")]
#[command(about = "Import ccusage, Codex, and OpenCode data into ClickHouse and DuckDB")]
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
}

#[derive(Parser, Debug, Clone)]
pub struct ImportArgs {
    /// Path to TOML config file
    #[arg(short, long)]
    pub config: Option<String>,
    /// Start date for import (YYYY-MM-DD or days back)
    #[arg(long)]
    pub since: Option<String>,
    /// End date for import (YYYY-MM-DD)
    #[arg(long)]
    pub end_date: Option<String>,
    /// Override DuckDB file path
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
