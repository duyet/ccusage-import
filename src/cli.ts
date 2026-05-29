#!/usr/bin/env bun
/**
 * CLI Entry Point
 *
 * Main entry point for the ccusage-import CLI.
 * Uses Commander for argument parsing and Ink for UI.
 * TTY-aware: Adapts output for interactive terminal vs cron/log mode.
 */

import { Command } from 'commander';
import { readFileSync } from 'fs';
import { join } from 'path';
import * as dotenv from 'dotenv';

// Load environment variables
dotenv.config();

// Import UI components
import { App, runCLI } from './ui/index.js';
import type { ImportStats } from './ui/types/index.js';

// Import configuration
import { ClickHouseConfig, UIConfig } from './config/index.js';

// Import database
import { CHClient } from './database/client.js';

// Import fetchers
import {
  checkCcusageAvailable,
  checkCompanionAvailable,
} from './fetchers/index.js';

// Import utilities
import { isNonInteractive } from './ui/utils/tty.js';

// Version from package.json
const packageJson = JSON.parse(
  readFileSync(join(import.meta.dir, '../package.json'), 'utf-8')
);

/**
 * Main import function using the events-based pipeline
 */
async function performImport(options: {
  verbose: boolean;
  noHashProjects: boolean;
  opencodePath?: string;
  codexPath?: string;
  skipOpencode: boolean;
  skipCodex: boolean;
  skipCcusage: boolean;
  source: string;
  timeout: number;
  duckdbPath?: string;
}): Promise<ImportStats> {
  const {
    verbose,
    noHashProjects,
    skipOpencode,
    skipCodex,
    skipCcusage,
    timeout,
    duckdbPath,
  } = options;

  // Use the new pipeline
  const { ImportRunner } = await import('./pipeline/runner.js');
  const { CcusageSource } = await import('./sources/ccusage.js');
  const { CompanionDataSource } = await import('./sources/companion.js');
  const { ClickHouseSink } = await import('./sinks/clickhouse.js');
  const { DuckDBSink } = await import('./sinks/duckdb.js');

  const { hostname } = await import('node:os');
  const machineName = hostname();
  const hashProjects = !noHashProjects;

  const runner = new ImportRunner();

  if (!skipCcusage) {
    runner.addSource(new CcusageSource({ machineName, hashProjects, timeout: timeout * 1000, verbose }));
  }
  if (!skipCodex) {
    runner.addSource(new CompanionDataSource({ type: 'codex', machineName, hashProjects, timeout: timeout * 1000, verbose }));
  }
  if (!skipOpencode) {
    runner.addSource(new CompanionDataSource({ type: 'opencode', machineName, hashProjects, timeout: timeout * 1000, verbose }));
  }

  runner.addSink(new ClickHouseSink());
  if (duckdbPath) {
    runner.addSink(new DuckDBSink({ dbPath: duckdbPath }));
  }

  const result = await runner.run(verbose);

  // Build stats from result
  const stats: ImportStats = {
    tableCounts: {},
    costBySource: { ccusage: 0, codex: 0, opencode: 0 },
    tokenConsumption: { input: 0, output: 0, cacheRead: 0, cacheCreation: 0, total: 0 },
    modelRankings: [],
    activeBlocks: [],
    dailyData: [],
  };

  for (const s of result.sources) {
    console.log(`  source ${s.name}: ${s.rows} rows${s.error ? ` (${s.error})` : ''}`);
  }
  for (const s of result.sinks) {
    const total = Object.values(s.rowsWritten).reduce((a, b) => a + b, 0);
    console.log(`  sink ${s.sinkName}: ${total} rows in ${s.durationMs}ms`);
  }

  return stats;
}

/**
 * System validation check
 */
async function systemCheck(options: { verbose: boolean }): Promise<number> {
  const { verbose } = options;

  console.log('🔍 System Check\n');

  let allPassed = true;

  // Check ClickHouse connection
  console.log('ClickHouse Connection:');
  try {
    const chConfig = ClickHouseConfig.fromEnv();
    const client = new CHClient(chConfig);

    if (verbose) console.log(`  Host: ${chConfig.host}`);
    if (verbose) console.log(`  Port: ${chConfig.port}`);
    if (verbose) console.log(`  Database: ${chConfig.database}`);

    const ping = await client.ping();

    if (ping) {
      console.log('  ✓ Connection successful');
    } else {
      console.log('  ✗ Connection failed');
      allPassed = false;
    }

    await client.close();
  } catch (error) {
    console.log(`  ✗ Connection failed: ${error instanceof Error ? error.message : String(error)}`);
    allPassed = false;
  }

  // Check ccusage availability
  console.log('\nccusage CLI:');
  const ccusageAvailable = await checkCcusageAvailable();
  if (ccusageAvailable) {
    console.log('  ✓ ccusage is available');
  } else {
    console.log('  ✗ ccusage not found (install with: npm install -g ccusage)');
    allPassed = false;
  }

  // Check Codex companion availability
  console.log('\nCodex CLI:');
  const codexAvailable = await checkCompanionAvailable('codex');
  if (codexAvailable) {
    console.log('  ✓ @ccusage/codex is available');
  } else {
    console.log('  ⚠ @ccusage/codex unavailable or no package runner found');
  }

  // Check OpenCode companion availability
  console.log('\nOpenCode CLI:');
  const opencodeAvailable = await checkCompanionAvailable('opencode');
  if (opencodeAvailable) {
    console.log('  ✓ @ccusage/opencode is available');
  } else {
    console.log('  ⚠ @ccusage/opencode unavailable or no package runner found');
  }

  // Display configuration
  console.log('\nConfiguration:');
  console.log(`  Machine: ${process.env.MACHINE_NAME || 'auto-detected'}`);
  console.log(`  Database: ${process.env.CH_DATABASE || 'default'}`);
  console.log(`  Privacy: ${process.env.NO_HASH_PROJECTS ? 'disabled' : 'enabled (hashing)'}`);
  console.log(`  Codex Home: ${process.env.CODEX_HOME || '~/.codex'}`);
  console.log(`  OpenCode Data: ${process.env.OPENCODE_DATA_DIR || '~/.local/share/opencode'}`);
  console.log(`  Mode: ${isNonInteractive() ? 'non-interactive (cron)' : 'interactive'}`);

  console.log('\n' + (allPassed ? '✓ All checks passed' : '✗ Some checks failed'));
  return allPassed ? 0 : 1;
}

// Create CLI program
const program = new Command();

program
  .name('ccusage-import')
  .description('Import ccusage, Codex, and OpenCode data into ClickHouse for analytics')
  .version(packageJson.version)
  .option('-v, --verbose', 'Show verbose output', false)
  .option('-q, --quiet', 'Suppress all output except errors', false)
  .option('--config <path>', 'Path to configuration file');

// Import command
program
  .command('import')
  .description('Import usage data from ccusage, Codex, and OpenCode')
  .option('--skip-opencode', 'Skip OpenCode import', false)
  .option('--skip-codex', 'Skip Codex import', false)
  .option('--skip-ccusage', 'Skip ccusage import', false)
  .option('--no-hash-projects', 'Disable project name hashing for privacy', false)
  .option('--opencode-path <path>', 'Path to OpenCode data directory')
  .option('--codex-path <path>', 'Path to Codex home directory')
  .option('--source <name>', 'Source identifier for ccusage imports', 'ccusage')
  .option('--timeout <seconds>', 'Command timeout in seconds', '120')
  .option('--duckdb-path <path>', 'Write DuckDB snapshot (local file or md:database for MotherDuck)', process.env.DUCKDB_PATH)
  .action(async (options) => {
    try {
      // Use Ink UI for TTY, simple output for non-TTY
      if (isNonInteractive() || options.quiet) {
        const exitCode = await performImport({
          verbose: options.verbose,
          noHashProjects: options.noHashProjects,
          opencodePath: options.opencodePath,
          codexPath: options.codexPath,
          skipOpencode: options.skipOpencode,
          skipCodex: options.skipCodex,
          skipCcusage: options.skipCcusage,
          source: options.source,
          timeout: parseInt(options.timeout, 10),
          duckdbPath: options.duckdbPath,
        }).then(() => 0).catch(() => 1);
        process.exit(exitCode);
      } else {
        await runCLI(
          () => performImport({
            verbose: options.verbose,
            noHashProjects: options.noHashProjects,
            opencodePath: options.opencodePath,
            codexPath: options.codexPath,
            skipOpencode: options.skipOpencode,
            skipCodex: options.skipCodex,
            skipCcusage: options.skipCcusage,
            source: options.source,
            timeout: parseInt(options.timeout, 10),
            duckdbPath: options.duckdbPath,
          }),
          options.verbose
        );
      }
    } catch (error) {
      console.error(`Import failed: ${error instanceof Error ? error.message : String(error)}`);
      process.exit(1);
    }
  });

// Check command
program
  .command('check')
  .description('Run system validation (ccusage, ClickHouse, config)')
  .action(async (options) => {
    const exitCode = await systemCheck({
      verbose: options.parent?.getOptionValue('verbose') || false,
    });
    process.exit(exitCode);
  });

// Parse arguments
program.parse();
