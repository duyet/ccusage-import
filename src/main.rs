//! summa — Rust CLI entry point.
//!
//! Subcommands:
//!   summa import   Fetch sources → write sinks (default)
//!   summa check    System validation
//!   summa config   Show resolved configuration
//!   summa serve    Telemetry HTTP (ingest fan-out, status, analytics)

use summa_import::cli::Cli;
use clap::Parser;

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    let cli = Cli::parse();
    summa_import::run(cli).await
}
