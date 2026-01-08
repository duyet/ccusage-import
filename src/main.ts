#!/usr/bin/env bun
/**
 * Main Entry Point - ccusage-import
 *
 * Executable CLI for importing ccusage and OpenCode data into ClickHouse.
 * Compatible with crontab scheduling.
 */

import { program } from 'commander';
import { readFileSync } from 'fs';
import { join } from 'path';

// Import dependencies
import * as dotenv from 'dotenv';

// Load environment variables
dotenv.config();

// Import our modules
import {
  ClickHouseConfig,
  ImporterConfig,
} from './config/index.js';
import {
  CHClient,
  DailyUsageRepository,
  ModelBreakdownsRepository,
  BlocksRepository,
} from './database/index.js';
import {
  fetchAllCcusageData,
  checkCcusageAvailable,
  fetchOpenCodeMessages,
  checkOpenCodePath,
} from './fetchers/index.js';
import {
  hashProjectName,
  buildDailyRow,
  buildMonthlyRow,
  buildSessionRow,
  buildBlockRow,
  buildModelBreakdownRow,
  buildModelsUsedRow,
  aggregateOpenCodeMessages,
} from './parsers/index.js';
import type {
  DailyUsage,
  MonthlyUsage,
  SessionUsage,
  BlockUsage,
} from './parsers/types.js';

// Import UI components
import { render, Box, Text } from 'ink';

// Version from package.json
const packageJson = JSON.parse(
  readFileSync(join(import.meta.dir, '../package.json'), 'utf-8')
);

/**
 * Main import function
 */
async function mainImport(options: {
  verbose: boolean;
  noHashProjects: boolean;
  opencode?: string;
  skipOpencode: boolean;
  skipCcusage: boolean;
  source: string;
  quiet?: boolean;
}): Promise<number> {
  const {
    verbose,
    noHashProjects,
    opencode,
    skipOpencode,
    skipCcusage,
    source,
    quiet = false,
  } = options;

  // Create configuration
  const chConfig = ClickHouseConfig.fromEnv();
  const importerConfig = new ImporterConfig({
    hashProjectNames: !noHashProjects,
    opencodePath: opencode,
    skipOpencode,
    skipCcusage,
    source,
  });

  // Logging utility
  const log = {
    info: (msg: string) => !quiet && console.log(`[INFO] ${msg}`),
    error: (msg: string) => console.error(`[ERROR] ${msg}`),
    verbose: (msg: string) => verbose && !quiet && console.log(`[DEBUG] ${msg}`),
  };

  try {
    log.info('Starting ccusage-import...');

    // Initialize ClickHouse client
    const client = new CHClient(chConfig);
    log.verbose(`Connected to ClickHouse at ${chConfig.getURL()}`);

    // Initialize repositories
    const dailyRepo = new DailyUsageRepository(client, importerConfig);
    const modelRepo = new ModelBreakdownsRepository(client, importerConfig);
    const blocksRepo = new BlocksRepository(client, importerConfig);

    // Fetch ccusage data
    let ccusageData: {
      daily: DailyUsage[];
      monthly: MonthlyUsage[];
      session: SessionUsage[];
      blocks: BlockUsage[];
      projects: Record<string, any>;
    } = {
      daily: [],
      monthly: [],
      session: [],
      blocks: [],
      projects: {},
    };

    if (!skipCcusage) {
      log.info('Fetching ccusage data...');
      const raw = await fetchAllCcusageData({ verbose, timeout: 120000 });
      ccusageData = {
        daily: raw.daily as DailyUsage[],
        monthly: raw.monthly as MonthlyUsage[],
        session: raw.session as SessionUsage[],
        blocks: raw.blocks as BlockUsage[],
        projects: raw.projects,
      };
      log.info(`Fetched ${ccusageData.daily.length} daily records`);
    }

    // Fetch OpenCode data
    let opencodeAggregated: any = null;
    if (!skipOpencode && opencode) {
      log.info('Fetching OpenCode data...');
      const messages = await fetchOpenCodeMessages({ opencodePath: opencode, verbose });
      log.info(`Fetched ${messages.length} messages`);

      log.info('Aggregating OpenCode messages...');
      opencodeAggregated = aggregateOpenCodeMessages(
        messages,
        importerConfig.machineName,
        importerConfig.hashProjectNames
      );
      log.info(`Aggregated ${opencodeAggregated.daily.length} daily records from OpenCode`);
    }

    // Import ccusage data
    if (!skipCcusage && ccusageData.daily.length > 0) {
      log.info('Importing daily usage data...');
      const dailyRows = ccusageData.daily.map(item =>
        buildDailyRow(item, importerConfig.machineName, importerConfig.source)
      );
      await dailyRepo.upsert(dailyRows);
      log.info(`Imported ${dailyRows.length} daily records`);
    }

    if (!skipCcusage && ccusageData.blocks.length > 0) {
      log.info('Importing billing blocks...');
      const blockRows = ccusageData.blocks.map(item =>
        buildBlockRow(item, importerConfig.machineName, importerConfig.source)
      );
      await blocksRepo.upsert(blockRows);
      log.info(`Imported ${blockRows.length} blocks`);
    }

    // Import OpenCode data
    if (opencodeAggregated && opencodeAggregated.daily.length > 0) {
      log.info('Importing OpenCode daily data...');
      const dailyRows = opencodeAggregated.daily.map((item: any) =>
        buildDailyRow(item, importerConfig.machineName, 'opencode')
      );
      await dailyRepo.upsert(dailyRows);
      log.info(`Imported ${dailyRows.length} OpenCode daily records`);
    }

    log.info('✓ Import completed successfully');
    await client.close();
    return 0;

  } catch (error) {
    log.error(error instanceof Error ? error.message : String(error));
    return 1;
  }
}

/**
 * Check command
 */
async function checkCommand(options: { verbose: boolean }) {
  const { verbose } = options;

  console.log('🔍 System Check\n');

  // Check ClickHouse connection
  console.log('Checking ClickHouse connection...');
  try {
    const chConfig = ClickHouseConfig.fromEnv();
    const client = new CHClient(chConfig);
    const ping = await client.ping();
    await client.close();

    if (ping) {
      console.log('  ✓ ClickHouse is reachable');
    } else {
      console.log('  ✗ ClickHouse is not reachable');
      return 1;
    }
  } catch (error) {
    console.log(`  ✗ ClickHouse connection failed: ${error}`);
    return 1;
  }

  // Check ccusage
  console.log('\nChecking ccusage availability...');
  const ccusageAvailable = await checkCcusageAvailable();
  if (ccusageAvailable) {
    console.log('  ✓ ccusage is available');
  } else {
    console.log('  ✗ ccusage is not available (install with: npm install -g ccusage)');
  }

  // Check OpenCode path if specified
  const opencodePath = process.env.OPencode_PATH;
  if (opencodePath) {
    console.log('\nChecking OpenCode path...');
    const opencodeValid = checkOpenCodePath(opencodePath);
    if (opencodeValid) {
      console.log(`  ✓ OpenCode path is valid: ${opencodePath}`);
    } else {
      console.log(`  ✗ OpenCode path is not valid: ${opencodePath}`);
    }
  }

  // Show configuration
  console.log('\nConfiguration:');
  console.log(`  Machine: ${process.env.MACHINE_NAME || 'auto-detected'}`);
  console.log(`  Database: ${process.env.CH_DATABASE || 'default'}`);
  console.log(`  Privacy: ${process.env.NO_HASH_PROJECTS ? 'disabled' : 'enabled (hashing)'}`);

  console.log('\n✓ System check complete');
  return 0;
}

// CLI program setup
program
  .name('ccusage-import')
  .description('Import ccusage and OpenCode data into ClickHouse')
  .version(packageJson.version);

program
  .command('import')
  .description('Import usage data from ccusage and/or OpenCode')
  .option('-v, --verbose', 'Show verbose output', false)
  .option('-q, --quiet', 'Suppress all output except errors', false)
  .option('--no-hash-projects', 'Disable project name hashing for privacy', false)
  .option('--opencode <path>', 'Path to OpenCode data directory')
  .option('--skip-opencode', 'Skip OpenCode import', false)
  .option('--skip-ccusage', 'Skip ccusage import', false)
  .option('--source <name>', 'Source identifier for this import', 'ccusage')
  .action(async (options) => {
    const exitCode = await mainImport(options);
    process.exit(exitCode);
  });

program
  .command('check')
  .description('Check system configuration and connectivity')
  .option('-v, --verbose', 'Show verbose output', false)
  .action(async (options) => {
    const exitCode = await checkCommand(options);
    process.exit(exitCode);
  });

// Parse and execute
program.parse();
