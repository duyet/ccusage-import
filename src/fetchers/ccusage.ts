/**
 * ccusage Data Fetcher
 *
 * Fetches data from the ccusage CLI tool with parallel execution and retry logic.
 */

import { $ } from 'bun';
import type { CcusageDailyResponse, CcusageMonthlyResponse, CcusageSessionResponse, CcusageBlocksResponse, CcusageProjectsResponse } from '../parsers/types.js';

export interface CcusageFetchOptions {
  timeout?: number;
  maxRetries?: number;
  packageRunner?: 'npx' | 'bunx' | 'auto';
  verbose?: boolean;
}

export interface CcusageData {
  daily: CcusageDailyResponse['daily'];
  monthly: CcusageMonthlyResponse['monthly'];
  session: CcusageSessionResponse['sessions'];
  blocks: CcusageBlocksResponse['blocks'];
  projects: CcusageProjectsResponse['projects'];
}

/**
 * Fetch all ccusage data types in parallel
 */
export async function fetchAllCcusageData(
  options: CcusageFetchOptions = {}
): Promise<CcusageData> {
  const {
    timeout = 120_000, // 120 seconds
    maxRetries = 2,
    packageRunner = 'auto',
    verbose = false,
  } = options;

  const runner = await detectPackageRunner(packageRunner);

  // Fetch all data types in parallel
  const [daily, monthly, session, blocks, projects] = await Promise.all([
    fetchCcusageCommand('daily', runner, timeout, maxRetries, verbose),
    fetchCcusageCommand('monthly', runner, timeout, maxRetries, verbose),
    fetchCcusageCommand('session', runner, timeout, maxRetries, verbose),
    fetchCcusageCommand('blocks', runner, timeout, maxRetries, verbose),
    fetchCcusageCommand('daily --instances', runner, timeout, maxRetries, verbose).then(r => {
      // Parse projects response differently
      if (r && 'projects' in r) {
        return (r as CcusageProjectsResponse).projects;
      }
      return {};
    }),
  ]);

  return {
    daily,
    monthly,
    session,
    blocks,
    projects,
  };
}

/**
 * Detect available package runner
 */
async function detectPackageRunner(
  preferred: 'npx' | 'bunx' | 'auto'
): Promise<'npx' | 'bunx'> {
  if (preferred !== 'auto') {
    return preferred;
  }

  // Try bunx first (faster)
  try {
    const proc = $`bunx --version`;
    proc.quiet();
    await proc;
    return 'bunx';
  } catch {
    // Fall back to npx
  }

  try {
    const proc = $`npx --version`;
    proc.quiet();
    await proc;
    return 'npx';
  } catch {
    throw new Error('No package runner found (npx or bunx required)');
  }
}

/**
 * Execute ccusage command with retry logic
 */
async function fetchCcusageCommand(
  command: string,
  runner: 'npx' | 'bunx',
  timeout: number,
  maxRetries: number,
  verbose: boolean
): Promise<any> {
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      const proc = $`${runner} ccusage@latest ${command.split(' ')} --json`;
      proc.quiet();
      proc.timeout(timeout);

      const result = await proc;
      const parsed = JSON.parse(result.stdout.toString());

      // Handle wrapped responses
      if ('daily' in parsed) return parsed.daily;
      if ('monthly' in parsed) return parsed.monthly;
      if ('sessions' in parsed) return parsed.sessions;
      if ('blocks' in parsed) return parsed.blocks;
      if ('projects' in parsed) return parsed.projects;

      return parsed;
    } catch (error) {
      if (attempt === maxRetries - 1) {
        if (verbose) {
          console.error(`ccusage ${command} failed: ${error}`);
        }
        return [];
      }

      // Exponential backoff
      await new Promise(resolve => setTimeout(resolve, 2 ** attempt * 1000));
    }
  }

  return [];
}

/**
 * Check if ccusage is available
 */
export async function checkCcusageAvailable(): Promise<boolean> {
  try {
    const proc = $`npx ccusage@latest --version`;
    proc.quiet();
    proc.timeout(5000);
    await proc;
    return true;
  } catch {
    return false;
  }
}
