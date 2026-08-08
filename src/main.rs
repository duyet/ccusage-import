//! sumptus — Rust CLI entry point.
//!
//! Subcommands:
//!   sumptus import   Fetch sources → write sinks (default)
//!   sumptus check    System validation
//!   sumptus config   Show resolved configuration

use sumptus::cli::Cli;
use clap::Parser;

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    let cli = Cli::parse();
    sumptus::run(cli).await
}
