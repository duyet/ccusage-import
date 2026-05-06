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
import {
  DailyUsageRepository,
  type DailyUsageRecord,
} from './database/index.js';
import { ImporterConfig } from './config/index.js';

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
 * Export data in various formats
 */
async function exportData(options: {
  format: 'json' | 'csv' | 'markdown';
  output?: string;
  start?: string;
  end?: string;
}): Promise<number> {
  const { format, output, start, end } = options;

  try {
    const chConfig = ClickHouseConfig.fromEnv();
    const client = new CHClient(chConfig);
    const dailyRepo = new DailyUsageRepository(client, new ImporterConfig());

    // Fetch data
    let data: any[] = [];
    if (start && end) {
      data = await dailyRepo.getByDateRange(start, end);
    } else {
      // Get last 30 days if no date range specified
      const endDate = new Date().toISOString().split('T')[0];
      const startDate = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
      data = await dailyRepo.getByDateRange(startDate, endDate);
    }

    let outputContent: string;

    switch (format) {
      case 'json':
        outputContent = JSON.stringify(data, null, 2);
        break;

      case 'csv':
        if (data.length === 0) {
          outputContent = 'date,machine_name,input_tokens,output_tokens,total_cost\n';
        } else {
          const headers = Object.keys(data[0]).join(',');
          const rows = data.map(row =>
            Object.values(row).map(v =>
              typeof v === 'string' ? `"${v}"` : String(v)
            ).join(',')
          );
          outputContent = [headers, ...rows].join('\n');
        }
        break;

      case 'markdown':
        if (data.length === 0) {
          outputContent = '# Usage Data\n\nNo data found for the specified date range.\n';
        } else {
          const headers = Object.keys(data[0]);
          outputContent = '# Usage Data\n\n';
          outputContent += '| ' + headers.join(' | ') + ' |\n';
          outputContent += '| ' + headers.map(() => '---').join(' | ') + ' |\n';
          data.forEach(row => {
            outputContent += '| ' + headers.map(h => String(row[h] || '')).join(' | ') + ' |\n';
          });
        }
        break;

      default:
        throw new Error(`Unsupported format: ${format}`);
    }

    if (output) {
      const fs = await import('fs/promises');
      await fs.writeFile(output, outputContent, 'utf-8');
      console.log(`Data exported to ${output}`);
    } else {
      console.log(outputContent);
    }

    await client.close();
    return 0;
  } catch (error) {
    console.error(`Export failed: ${error instanceof Error ? error.message : String(error)}`);
    return 1;
  }
}

/**
 * Compare time periods
 */
async function comparePeriods(options: {
  period1: string;
  period2: string;
  metrics: string;
}): Promise<number> {
  const { period1, period2, metrics } = options;

  try {
    // Parse periods (format: YYYY-MM-DD:YYYY-MM-DD)
    const [start1, end1] = period1.split(':');
    const [start2, end2] = period2.split(':');

    const metricList = metrics.split(',');

    const chConfig = ClickHouseConfig.fromEnv();
    const client = new CHClient(chConfig);
    const dailyRepo = new DailyUsageRepository(client, new ImporterConfig());

    // Fetch data for both periods
    const data1 = await dailyRepo.getByDateRange(start1, end1);
    const data2 = await dailyRepo.getByDateRange(start2, end2);

    // Calculate metrics for each period
    const calculateMetrics = (data: any[]) => ({
      totalCost: data.reduce((sum, row) => sum + (row.total_cost || 0), 0),
      totalTokens: data.reduce((sum, row) => sum + (row.total_tokens || 0), 0),
      inputTokens: data.reduce((sum, row) => sum + (row.input_tokens || 0), 0),
      outputTokens: data.reduce((sum, row) => sum + (row.output_tokens || 0), 0),
      requestCount: data.length,
    });

    const metrics1 = calculateMetrics(data1);
    const metrics2 = calculateMetrics(data2);

    // Calculate differences
    const diff = {
      totalCost: metrics2.totalCost - metrics1.totalCost,
      totalTokens: metrics2.totalTokens - metrics1.totalTokens,
      inputTokens: metrics2.inputTokens - metrics1.inputTokens,
      outputTokens: metrics2.outputTokens - metrics1.outputTokens,
      requestCount: metrics2.requestCount - metrics1.requestCount,
    };

    const percentChange = {
      totalCost: metrics1.totalCost > 0 ? (diff.totalCost / metrics1.totalCost) * 100 : 0,
      totalTokens: metrics1.totalTokens > 0 ? (diff.totalTokens / metrics1.totalTokens) * 100 : 0,
      inputTokens: metrics1.inputTokens > 0 ? (diff.inputTokens / metrics1.inputTokens) * 100 : 0,
      outputTokens: metrics1.outputTokens > 0 ? (diff.outputTokens / metrics1.outputTokens) * 100 : 0,
    };

    // Display comparison
    console.log('\nPeriod Comparison\n');

    console.log(`Period 1: ${start1} to ${end1}`);
    console.log(`Period 2: ${start2} to ${end2}\n`);

    if (metricList.includes('cost')) {
      console.log('Cost:');
      console.log(`  Period 1: $${metrics1.totalCost.toFixed(2)}`);
      console.log(`  Period 2: $${metrics2.totalCost.toFixed(2)}`);
      console.log(`  Difference: $${diff.totalCost.toFixed(2)} (${percentChange.totalCost.toFixed(1)}%)\n`);
    }

    if (metricList.includes('tokens')) {
      console.log('Tokens:');
      console.log(`  Period 1: ${metrics1.totalTokens.toLocaleString()}`);
      console.log(`  Period 2: ${metrics2.totalTokens.toLocaleString()}`);
      console.log(`  Difference: ${diff.totalTokens.toLocaleString()} (${percentChange.totalTokens.toFixed(1)}%)\n`);

      console.log('  Input:');
      console.log(`    Period 1: ${metrics1.inputTokens.toLocaleString()}`);
      console.log(`    Period 2: ${metrics2.inputTokens.toLocaleString()}`);
      console.log(`    Difference: ${diff.inputTokens.toLocaleString()} (${percentChange.inputTokens.toFixed(1)}%)\n`);

      console.log('  Output:');
      console.log(`    Period 1: ${metrics1.outputTokens.toLocaleString()}`);
      console.log(`    Period 2: ${metrics2.outputTokens.toLocaleString()}`);
      console.log(`    Difference: ${diff.outputTokens.toLocaleString()} (${percentChange.outputTokens.toFixed(1)}%)\n`);
    }

    if (metricList.includes('requests')) {
      console.log('Requests:');
      console.log(`  Period 1: ${metrics1.requestCount}`);
      console.log(`  Period 2: ${metrics2.requestCount}`);
      console.log(`  Difference: ${diff.requestCount}\n`);
    }

    await client.close();
    return 0;
  } catch (error) {
    console.error(`Comparison failed: ${error instanceof Error ? error.message : String(error)}`);
    return 1;
  }
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

// Export command
program
  .command('export')
  .description('Export data in various formats')
  .option('-f, --format <format>', 'Output format (json, csv, markdown)', 'json')
  .option('-o, --output <path>', 'Output file path')
  .option('--start <date>', 'Start date (YYYY-MM-DD)')
  .option('--end <date>', 'End date (YYYY-MM-DD)')
  .action(async (options) => {
    const exitCode = await exportData({
      format: options.format,
      output: options.output,
      start: options.start,
      end: options.end,
    });
    process.exit(exitCode);
  });

// Compare command
program
  .command('compare')
  .description('Compare usage between two time periods')
  .option('--period1 <start:end>', 'First period (e.g., 2025-01-01:2025-01-07)')
  .option('--period2 <start:end>', 'Second period (e.g., 2025-01-08:2025-01-14)')
  .option('--metrics <list>', 'Metrics to compare (comma-separated: cost,tokens,requests)', 'cost,tokens,requests')
  .action(async (options) => {
    if (!options.period1 || !options.period2) {
      console.error('Error: Both --period1 and --period2 are required');
      console.error('Example: ccusage-import compare --period1 2025-01-01:2025-01-07 --period2 2025-01-08:2025-01-14');
      process.exit(1);
    }
    const exitCode = await comparePeriods({
      period1: options.period1,
      period2: options.period2,
      metrics: options.metrics,
    });
    process.exit(exitCode);
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
