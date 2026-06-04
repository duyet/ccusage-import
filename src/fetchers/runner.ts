/**
 * Package-runner detection shared by the ccusage and companion fetchers.
 */

import { withTimeout } from '../utils/timeout.js';
import { TIMEOUTS } from '../constants.js';

export type PackageRunner = 'npx' | 'bunx';
export type PackageRunnerPreference = PackageRunner | 'auto';

const runnerCache = new Map<string, Promise<PackageRunner>>();

/**
 * Resolve a package runner. When `preferred` is 'auto', probe `autoOrder` in
 * order and return the first that responds to `--version`. ccusage prefers
 * npx (auto-accept via -y); companion prefers bunx.
 */
export function detectPackageRunner(
  preferred: PackageRunnerPreference,
  autoOrder: PackageRunner[] = ['npx', 'bunx']
): Promise<PackageRunner> {
  if (preferred !== 'auto') return Promise.resolve(preferred);

  const cacheKey = autoOrder.join(',');
  let cached = runnerCache.get(cacheKey);
  if (!cached) {
    cached = (async () => {
      for (const runner of autoOrder) {
        try {
          const proc = Bun.spawn([runner, '--version'], { stdout: 'pipe', stderr: 'pipe' });
          const exit = await withTimeout(proc.exited, TIMEOUTS.runnerProbe, () => proc.kill());
          if (exit === 0) return runner;
        } catch {
          /* try next */
        }
      }
      throw new Error('No package runner found (npx or bunx required)');
    })();
    runnerCache.set(cacheKey, cached);
  }

  return cached;
}
