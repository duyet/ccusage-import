/**
 * ccusage agent CLI fetcher
 *
 * ccusage 20.x is a unified CLI: every agent is a subcommand
 * (`ccusage <source> <view> --json`). This fetcher invokes any such
 * subcommand and normalizes its ccusage-shaped JSON.
 */

import { detectPackageRunner } from './runner.js';
import { withTimeout } from '../utils/timeout.js';
import { TIMEOUTS } from '../constants.js';

export type CompanionSource =
  | 'codex'
  | 'opencode'
  | 'gemini'
  | 'hermes'
  | 'openclaw'
  | 'amp'
  | 'droid'
  | 'codebuff'
  | 'pi'
  | 'goose'
  | 'kilo'
  | 'copilot'
  | 'kimi'
  | 'qwen';
export type PackageRunner = 'npx' | 'bunx' | 'auto';
export type CompanionCommand = 'daily' | 'monthly' | 'session';

export interface AgentSourceMeta {
  id: CompanionSource;
  /** Env var to point the agent at a custom data dir, when supported. */
  pathEnv?: string;
}

/**
 * All ccusage agent subcommands to import (Claude is handled separately by
 * CcusageSource, which uniquely provides blocks + projects:daily).
 */
export const CCUSAGE_AGENT_SOURCES: AgentSourceMeta[] = [
  { id: 'codex', pathEnv: 'CODEX_HOME' },
  { id: 'opencode', pathEnv: 'OPENCODE_DATA_DIR' },
  { id: 'gemini', pathEnv: 'GEMINI_DATA_DIR' },
  { id: 'openclaw', pathEnv: 'OPENCLAW_DIR' },
  { id: 'amp' },
  { id: 'droid' },
  { id: 'codebuff' },
  { id: 'pi' },
  { id: 'goose' },
  { id: 'kilo' },
  { id: 'copilot' },
  { id: 'kimi' },
  { id: 'qwen' },
];

export interface CompanionFetchOptions {
  timeout?: number;
  maxRetries?: number;
  packageRunner?: PackageRunner;
  verbose?: boolean;
  dataPath?: string;
  executor?: CompanionCommandExecutor;
  since?: string;
  endDate?: string;
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
  dateFlags?: string[];
}

export type CompanionCommandExecutor = (
  options: CompanionCommandExecutorOptions
) => Promise<unknown>;

const CCUSAGE_PACKAGE = 'ccusage@latest';

const SOURCE_PATH_ENV: Partial<Record<CompanionSource, string>> = Object.fromEntries(
  CCUSAGE_AGENT_SOURCES.filter(s => s.pathEnv).map(s => [s.id, s.pathEnv!])
);

interface CompanionModelBreakdown {
  modelName: string;
  inputTokens: number;
  outputTokens: number;
  cacheCreationTokens: number;
  cacheReadTokens: number;
  reasoningTokens: number;
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
    since,
    endDate,
  } = options;

  const runner = await detectPackageRunner(packageRunner, ['bunx', 'npx']);
  const pathEnv = SOURCE_PATH_ENV[source];
  const env = dataPath && pathEnv ? { [pathEnv]: dataPath } : {};
  const dateFlags = [since ? `--since=${since}` : '', endDate ? `--end-date=${endDate}` : ''].filter(Boolean);

  // Sequential to reduce concurrent npm process memory
  const daily = await fetchCompanionCommand(source, 'daily', runner, timeout, maxRetries, env, verbose, executor, dateFlags);
  const session = await fetchCompanionCommand(source, 'session', runner, timeout, maxRetries, env, verbose, executor, dateFlags);

  return { daily, monthly: [], session };
}

export async function checkCompanionAvailable(source: CompanionSource): Promise<boolean> {
  try {
    const runner = await detectPackageRunner('auto', ['bunx', 'npx']);
    const proc = Bun.spawn([runner, CCUSAGE_PACKAGE, source, '--help'], {
      stdout: 'pipe',
      stderr: 'pipe',
    });
    const exited = await withTimeout(proc.exited, TIMEOUTS.availability, () => proc.kill());
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
  executor: CompanionCommandExecutor,
  dateFlags: string[] = [],
): Promise<any[]> {
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      const raw = await executor({ source, command, runner, timeout, env, dateFlags });
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

/** Build the ccusage CLI argv for a given agent subcommand + view. */
export function buildAgentCommandArgs(
  runner: Exclude<PackageRunner, 'auto'>,
  source: CompanionSource,
  command: CompanionCommand,
  dateFlags?: string[]
): string[] {
  return [runner, CCUSAGE_PACKAGE, source, command, '--breakdown', '--json', ...(dateFlags ?? [])];
}

async function executeCompanionCommand({
  source,
  command,
  runner,
  timeout,
  env,
  dateFlags,
}: CompanionCommandExecutorOptions): Promise<unknown> {
  const proc = Bun.spawn(buildAgentCommandArgs(runner, source, command, dateFlags), {
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

  // Companion packages may print log lines to stdout before JSON (e.g. "[@ccusage/opencode] ℹ ...")
  const jsonStart = stdout.search(/[{[]/);
  if (jsonStart === -1) {
    throw new Error(`No JSON in ${source} ${command} output: ${stdout.slice(0, 200)}`);
  }
  return JSON.parse(stdout.slice(jsonStart));
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

export function normalizeUsageRow(command: CompanionCommand, row: unknown): CompanionUsageRow {
  if (!row || typeof row !== 'object') {
    return {
      modelsUsed: [],
      modelBreakdowns: [],
    };
  }

  const value = row as Record<string, any>;
  const rawModels = value.modelBreakdowns ?? value.models ?? [];
  const modelBreakdowns = normalizeModelBreakdowns(rawModels);
  const modelsUsed = Array.isArray(value.modelsUsed)
    ? value.modelsUsed
    : modelBreakdowns.map(model => model.modelName);

  const normalized: CompanionUsageRow = {
    ...value,
    inputTokens: value.inputTokens ?? value.input_tokens ?? 0,
    outputTokens: value.outputTokens ?? value.output_tokens ?? 0,
    cacheCreationTokens: value.cacheCreationTokens ?? value.cacheCreationInputTokens ?? value.cache_creation_tokens ?? 0,
    cacheReadTokens: value.cacheReadTokens ?? value.cacheReadInputTokens ?? value.cache_read_tokens ?? value.cachedInputTokens ?? 0,
    reasoningTokens: value.reasoningTokens ?? value.reasoningOutputTokens ?? value.thoughtsTokens ?? value.reasoning_tokens ?? 0,
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

export function normalizeModelBreakdowns(raw: unknown): CompanionModelBreakdown[] {
  if (Array.isArray(raw)) {
    return raw.map(item => {
      if (typeof item === 'string') {
        return { modelName: item, inputTokens: 0, outputTokens: 0, cacheCreationTokens: 0, cacheReadTokens: 0, reasoningTokens: 0, cost: 0 };
      }
      const value = item as Record<string, any>;
      return {
        modelName: value.modelName ?? value.model ?? value.name ?? 'unknown',
        inputTokens: value.inputTokens ?? value.input_tokens ?? 0,
        outputTokens: value.outputTokens ?? value.output_tokens ?? 0,
        cacheCreationTokens: value.cacheCreationTokens ?? value.cacheCreationInputTokens ?? value.cache_creation_tokens ?? 0,
        cacheReadTokens: value.cacheReadTokens ?? value.cacheReadInputTokens ?? value.cache_read_tokens ?? value.cachedInputTokens ?? 0,
        reasoningTokens: value.reasoningTokens ?? value.reasoningOutputTokens ?? value.thoughtsTokens ?? value.reasoning_tokens ?? 0,
        cost: value.cost ?? value.costUSD ?? value.totalCost ?? 0,
      };
    });
  }

  // Handle object format: { "model-name": { inputTokens, outputTokens, ... } }
  if (raw && typeof raw === 'object') {
    return Object.entries(raw as Record<string, any>).map(([modelName, value]) => ({
      modelName,
      inputTokens: value.inputTokens ?? value.input_tokens ?? 0,
      outputTokens: value.outputTokens ?? value.output_tokens ?? 0,
      cacheCreationTokens: value.cacheCreationTokens ?? value.cacheCreationInputTokens ?? value.cache_creation_tokens ?? 0,
      cacheReadTokens: value.cacheReadTokens ?? value.cacheReadInputTokens ?? value.cache_read_tokens ?? value.cachedInputTokens ?? 0,
      reasoningTokens: value.reasoningTokens ?? value.reasoningOutputTokens ?? value.thoughtsTokens ?? value.reasoning_tokens ?? 0,
      cost: value.cost ?? value.costUSD ?? 0,
    }));
  }

  return [];
}
