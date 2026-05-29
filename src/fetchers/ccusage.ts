/**
 * ccusage Data Fetcher
 *
 * Fetches data from the ccusage CLI tool with parallel execution and retry logic.
 */

import type { CcusageDailyResponse, CcusageSessionResponse, CcusageBlocksResponse, CcusageProjectsResponse } from '../parsers/types.js';
import { detectPackageRunner } from './runner.js';
import { withTimeout } from '../utils/timeout.js';
import { TIMEOUTS } from '../constants.js';

export interface CcusageFetchOptions {
  timeout?: number;
  maxRetries?: number;
  packageRunner?: 'npx' | 'bunx' | 'auto';
  verbose?: boolean;
}

export interface CcusageData {
  daily: CcusageDailyResponse['daily'];
  session: CcusageSessionResponse['sessions'];
  blocks: CcusageBlocksResponse['blocks'];
  projects: CcusageProjectsResponse['projects'];
}

/**
 * Fetch ccusage data types sequentially to reduce memory.
 * Monthly skipped — derivable via SQL GROUP BY toYYYYMM(date).
 */
export async function fetchAllCcusageData(
  options: CcusageFetchOptions = {}
): Promise<CcusageData> {
  const {
    timeout = 120_000,
    maxRetries = 2,
    packageRunner = 'auto',
    verbose = false,
  } = options;

  const runner = await detectPackageRunner(packageRunner, ['npx', 'bunx']);
  const fetch = (cmd: string) => fetchCcusageCommand(cmd, runner, timeout, maxRetries, verbose);

  // ccusage 20.x: the bare `ccusage daily` aggregates across ALL agents
  // (agent:"all", no per-day date). The Claude-specific data lives under the
  // `claude` subcommand, which keeps the date + modelBreakdowns shape.
  // Sequential to avoid concurrent npm processes spiking memory.
  const daily = await fetch('claude daily');
  const session = await fetch('claude session');
  const blocks = await fetch('claude blocks');
  const projects = await fetch('claude daily --instances').then(r => {
    if (r && 'projects' in r) {
      return (r as CcusageProjectsResponse).projects;
    }
    return {};
  });

  return { daily, session, blocks, projects };
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
      const args = runner === 'npx' ? ['-y', 'ccusage@latest', ...command.split(' '), '--json'] : ['ccusage@latest', ...command.split(' '), '--json'];
      const proc = Bun.spawn([runner, ...args], {
        stdout: 'pipe',
        stderr: 'pipe',
        env: { ...process.env },
      });

      const stdoutPromise = new Response(proc.stdout).text();
      const stderrPromise = new Response(proc.stderr).text();
      const exitCode = await withTimeout(proc.exited, timeout, () => proc.kill());
      const [stdout, stderr] = await Promise.all([stdoutPromise, stderrPromise]);

      if (exitCode !== 0) {
        throw new Error(stderr.trim() || `ccusage ${command} exited with ${exitCode}`);
      }

      // CLI may print log lines before JSON
      const jsonStart = stdout.search(/[{[]/);
      if (jsonStart === -1) throw new Error(`No JSON in ccusage ${command} output: ${stdout.slice(0, 200)}`);
      const parsed = JSON.parse(stdout.slice(jsonStart));

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
    const proc = Bun.spawn(['npx', '-y', 'ccusage@latest', '--version'], {
      stdout: 'pipe',
      stderr: 'pipe',
    });
    const exit = await withTimeout(proc.exited, TIMEOUTS.availability, () => proc.kill());
    return exit === 0;
  } catch {
    return false;
  }
}
