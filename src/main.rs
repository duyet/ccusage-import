/**
 * ccusage-import — Rust CLI entry point.
 *
 * Subcommands:
 *   ccusage-import import   Fetch sources → write sinks (default)
 *   ccusage-import check    System validation
 *   ccusage-import config   Show resolved configuration
 */

use ccusage_import::cli::Cli;
use clap::Parser;

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    let cli = Cli::parse();
    ccusage_import::run(cli).await
}
