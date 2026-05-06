/**
 * ccusage Data Fetcher
 *
 * Fetches data from the ccusage CLI tool with parallel execution and retry logic.
 */

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
    timeout = 120_000,
    maxRetries = 2,
    packageRunner = 'auto',
    verbose = false,
  } = options;

  const runner = await detectPackageRunner(packageRunner);

  const [daily, monthly, session, blocks, projects] = await Promise.all([
    fetchCcusageCommand('daily', runner, timeout, maxRetries, verbose),
    fetchCcusageCommand('monthly', runner, timeout, maxRetries, verbose),
    fetchCcusageCommand('session', runner, timeout, maxRetries, verbose),
    fetchCcusageCommand('blocks', runner, timeout, maxRetries, verbose),
    fetchCcusageCommand('daily --instances', runner, timeout, maxRetries, verbose).then(r => {
      if (r && 'projects' in r) {
        return (r as CcusageProjectsResponse).projects;
      }
      return {};
    }),
  ]);

  return { daily, monthly, session, blocks, projects };
}

/**
 * Detect available package runner
 */
async function detectPackageRunner(
  preferred: 'npx' | 'bunx' | 'auto'
): Promise<'npx' | 'bunx'> {
  if (preferred !== 'auto') return preferred;

  // Prefer npx with -y for auto-accept, avoids interactive prompts
  try {
    const proc = Bun.spawn(['npx', '--version'], { stdout: 'pipe', stderr: 'pipe' });
    const exit = await withTimeout(proc.exited, 5_000, () => proc.kill());
    if (exit === 0) return 'npx';
  } catch { /* fall through */ }

  try {
    const proc = Bun.spawn(['bunx', '--version'], { stdout: 'pipe', stderr: 'pipe' });
    const exit = await withTimeout(proc.exited, 5_000, () => proc.kill());
    if (exit === 0) return 'bunx';
  } catch { /* fall through */ }

  throw new Error('No package runner found (npx or bunx required)');
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

      const parsed = JSON.parse(stdout);

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
    const exit = await withTimeout(proc.exited, 10_000, () => proc.kill());
    return exit === 0;
  } catch {
    return false;
  }
}

async function withTimeout<T>(
  promise: Promise<T>,
  timeout: number,
  onTimeout: () => void
): Promise<T> {
  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timeoutId = setTimeout(() => {
          onTimeout();
          reject(new Error(`Command timed out after ${timeout}ms`));
        }, timeout);
      }),
    ]);
  } finally {
    if (timeoutId) clearTimeout(timeoutId);
  }
}
