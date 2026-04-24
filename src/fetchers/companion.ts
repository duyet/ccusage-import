/**
 * ccusage companion CLI fetcher
 *
 * Fetches usage reports from companion packages such as @ccusage/codex
 * and @ccusage/opencode. These packages emit ccusage-shaped JSON.
 */

export type CompanionSource = 'codex' | 'opencode';
export type PackageRunner = 'npx' | 'bunx' | 'auto';
export type CompanionCommand = 'daily' | 'monthly' | 'session';

export interface CompanionFetchOptions {
  timeout?: number;
  maxRetries?: number;
  packageRunner?: PackageRunner;
  verbose?: boolean;
  dataPath?: string;
  executor?: CompanionCommandExecutor;
}

export interface CompanionData {
  daily: CompanionUsageRow[];
  monthly: CompanionUsageRow[];
  session: CompanionUsageRow[];
}

export interface CompanionCommandExecutorOptions {
  source: CompanionSource;
  command: CompanionCommand;
  runner: Exclude<PackageRunner, 'auto'>;
  timeout: number;
  env: Record<string, string>;
}

export type CompanionCommandExecutor = (
  options: CompanionCommandExecutorOptions
) => Promise<unknown>;

const SOURCE_PACKAGES: Record<CompanionSource, string> = {
  codex: '@ccusage/codex@latest',
  opencode: '@ccusage/opencode@latest',
};

const SOURCE_PATH_ENV: Record<CompanionSource, string> = {
  codex: 'CODEX_HOME',
  opencode: 'OPENCODE_DATA_DIR',
};

interface CompanionModelBreakdown {
  modelName: string;
  inputTokens: number;
  outputTokens: number;
  cacheCreationTokens: number;
  cacheReadTokens: number;
  cost: number;
}

export interface CompanionUsageRow {
  [key: string]: unknown;
  modelsUsed: string[];
  modelBreakdowns: CompanionModelBreakdown[];
}

export async function fetchAllCompanionData(
  source: CompanionSource,
  options: CompanionFetchOptions = {}
): Promise<CompanionData> {
  const {
    timeout = 120_000,
    maxRetries = 2,
    packageRunner = 'auto',
    verbose = false,
    dataPath,
    executor = executeCompanionCommand,
  } = options;

  const runner = await detectPackageRunner(packageRunner);
  const env = dataPath ? { [SOURCE_PATH_ENV[source]]: dataPath } : {};

  const [daily, monthly, session] = await Promise.all([
    fetchCompanionCommand(source, 'daily', runner, timeout, maxRetries, env, verbose, executor),
    fetchCompanionCommand(source, 'monthly', runner, timeout, maxRetries, env, verbose, executor),
    fetchCompanionCommand(source, 'session', runner, timeout, maxRetries, env, verbose, executor),
  ]);

  return { daily, monthly, session };
}

export async function checkCompanionAvailable(source: CompanionSource): Promise<boolean> {
  try {
    const runner = await detectPackageRunner('auto');
    const proc = Bun.spawn([runner, SOURCE_PACKAGES[source], '--help'], {
      stdout: 'pipe',
      stderr: 'pipe',
    });
    const exited = await withTimeout(proc.exited, 10_000, () => proc.kill());
    return exited === 0;
  } catch {
    return false;
  }
}

async function fetchCompanionCommand(
  source: CompanionSource,
  command: CompanionCommand,
  runner: Exclude<PackageRunner, 'auto'>,
  timeout: number,
  maxRetries: number,
  env: Record<string, string>,
  verbose: boolean,
  executor: CompanionCommandExecutor
): Promise<any[]> {
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      const raw = await executor({ source, command, runner, timeout, env });
      return normalizeCompanionRows(command, raw);
    } catch (error) {
      if (attempt === maxRetries - 1) {
        if (verbose) {
          console.warn(`${source} ${command} unavailable: ${error instanceof Error ? error.message : String(error)}`);
        }
        return [];
      }
      await new Promise(resolve => setTimeout(resolve, 2 ** attempt * 1000));
    }
  }

  return [];
}

async function executeCompanionCommand({
  source,
  command,
  runner,
  timeout,
  env,
}: CompanionCommandExecutorOptions): Promise<unknown> {
  const proc = Bun.spawn([runner, SOURCE_PACKAGES[source], command, '--json'], {
    stdout: 'pipe',
    stderr: 'pipe',
    env: { ...process.env, ...env },
  });

  const stdoutPromise = new Response(proc.stdout).text();
  const stderrPromise = new Response(proc.stderr).text();
  const exitCode = await withTimeout(proc.exited, timeout, () => proc.kill());
  const [stdout, stderr] = await Promise.all([stdoutPromise, stderrPromise]);

  if (exitCode !== 0) {
    throw new Error(stderr.trim() || `${source} ${command} exited with ${exitCode}`);
  }

  return JSON.parse(stdout);
}

async function detectPackageRunner(preferred: PackageRunner): Promise<Exclude<PackageRunner, 'auto'>> {
  if (preferred !== 'auto') {
    return preferred;
  }

  try {
    const proc = Bun.spawn(['bunx', '--version'], { stdout: 'pipe', stderr: 'pipe' });
    if (await withTimeout(proc.exited, 5_000, () => proc.kill()) === 0) {
      return 'bunx';
    }
  } catch {
    // Try npx below.
  }

  try {
    const proc = Bun.spawn(['npx', '--version'], { stdout: 'pipe', stderr: 'pipe' });
    if (await withTimeout(proc.exited, 5_000, () => proc.kill()) === 0) {
      return 'npx';
    }
  } catch {
    // Throw below.
  }

  throw new Error('No package runner found (npx or bunx required)');
}

function normalizeCompanionRows(command: CompanionCommand, raw: unknown): any[] {
  const key = command === 'session' ? 'sessions' : command;
  const rows = Array.isArray(raw)
    ? raw
    : raw && typeof raw === 'object' && key in raw
      ? (raw as Record<string, unknown>)[key]
      : raw && typeof raw === 'object' && 'data' in raw
        ? (raw as Record<string, unknown>).data
        : [];

  if (!Array.isArray(rows)) {
    return [];
  }

  return rows.map(row => normalizeUsageRow(command, row));
}

function normalizeUsageRow(command: CompanionCommand, row: unknown): CompanionUsageRow {
  if (!row || typeof row !== 'object') {
    return {
      modelsUsed: [],
      modelBreakdowns: [],
    };
  }

  const value = row as Record<string, any>;
  const modelBreakdowns = normalizeModelBreakdowns(value.modelBreakdowns ?? value.models ?? []);
  const modelsUsed = Array.isArray(value.modelsUsed)
    ? value.modelsUsed
    : modelBreakdowns.map(model => model.modelName);

  const normalized: CompanionUsageRow = {
    ...value,
    inputTokens: value.inputTokens ?? value.input_tokens ?? 0,
    outputTokens: value.outputTokens ?? value.output_tokens ?? 0,
    cacheCreationTokens: value.cacheCreationTokens ?? value.cacheCreationInputTokens ?? value.cache_creation_tokens ?? 0,
    cacheReadTokens: value.cacheReadTokens ?? value.cacheReadInputTokens ?? value.cache_read_tokens ?? 0,
    totalTokens: value.totalTokens ?? value.total_tokens ?? 0,
    totalCost: value.totalCost ?? value.costUSD ?? value.cost ?? value.total_cost ?? 0,
    modelsUsed,
    modelBreakdowns,
  };

  if (command === 'monthly' && !normalized.month && typeof value.month === 'number' && value.year) {
    normalized.month = `${value.year}-${String(value.month).padStart(2, '0')}`;
  }

  if (command === 'session') {
    normalized.sessionId = value.sessionId ?? value.session ?? value.id ?? value.session_id ?? 'unknown';
    normalized.projectPath = value.projectPath ?? value.directory ?? value.path ?? value.project_path ?? String(normalized.sessionId);
    normalized.lastActivity = value.lastActivity ?? value.last_activity ?? value.date ?? new Date().toISOString();
  }

  return normalized;
}

function normalizeModelBreakdowns(raw: unknown): CompanionModelBreakdown[] {
  if (!Array.isArray(raw)) {
    return [];
  }

  return raw.map(item => {
    if (typeof item === 'string') {
      return {
        modelName: item,
        inputTokens: 0,
        outputTokens: 0,
        cacheCreationTokens: 0,
        cacheReadTokens: 0,
        cost: 0,
      };
    }

    const value = item as Record<string, any>;
    return {
      modelName: value.modelName ?? value.model ?? value.name ?? 'unknown',
      inputTokens: value.inputTokens ?? value.input_tokens ?? 0,
      outputTokens: value.outputTokens ?? value.output_tokens ?? 0,
      cacheCreationTokens: value.cacheCreationTokens ?? value.cacheCreationInputTokens ?? value.cache_creation_tokens ?? 0,
      cacheReadTokens: value.cacheReadTokens ?? value.cacheReadInputTokens ?? value.cache_read_tokens ?? 0,
      cost: value.cost ?? value.costUSD ?? value.totalCost ?? 0,
    };
  });
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
    if (timeoutId) {
      clearTimeout(timeoutId);
    }
  }
}
