/**
 * ccusage companion fetcher tests
 */

import { describe, expect, it, mock } from 'bun:test';
import {
  fetchAllCompanionData,
  buildAgentCommandArgs,
  CCUSAGE_AGENT_SOURCES,
  type CompanionData,
  type CompanionCommandExecutor,
} from '../../src/fetchers/companion';
import { buildCompanionEventRows } from '../../src/parsers/parsers';

describe('fetchAllCompanionData', () => {
  it('parses wrapped daily and session JSON', async () => {
    const executor: CompanionCommandExecutor = mock(async ({ command }) => {
      if (command === 'daily') {
        return {
          daily: [{
            date: '2026-04-24',
            inputTokens: 100,
            outputTokens: 50,
            cacheCreationTokens: 10,
            cacheReadTokens: 20,
            totalTokens: 180,
            totalCost: 0.01,
            modelBreakdowns: [{ modelName: 'gpt-5', inputTokens: 100, outputTokens: 50, cacheCreationTokens: 10, cacheReadTokens: 20, cost: 0.01 }],
          }],
        };
      }

      return {
        sessions: [{
          id: 'session-1',
          directory: '/repo',
          date: '2026-04-24',
          inputTokens: 100,
          outputTokens: 50,
          cacheCreationTokens: 10,
          cacheReadTokens: 20,
          totalTokens: 180,
          totalCost: 0.01,
          models: ['gpt-5'],
        }],
      };
    });

    const data = await fetchAllCompanionData('codex', {
      packageRunner: 'npx',
      executor,
    });

    expect(data.daily).toHaveLength(1);
    expect(data.monthly).toEqual([]);
    expect(data.session).toHaveLength(1);
    expect(data.daily[0].modelsUsed).toEqual(['gpt-5']);
    expect(data.session[0].sessionId).toBe('session-1');
    expect(data.session[0].projectPath).toBe('/repo');
  });

  it('passes CODEX_HOME for Codex custom path', async () => {
    const executor: CompanionCommandExecutor = mock(async ({ env }) => {
      expect(env.CODEX_HOME).toBe('/tmp/codex-home');
      return { daily: [] };
    });

    await fetchAllCompanionData('codex', {
      packageRunner: 'npx',
      dataPath: '/tmp/codex-home',
      executor,
    });

    expect(executor).toHaveBeenCalledTimes(2);
  });

  it('passes OPENCODE_DATA_DIR for OpenCode custom path', async () => {
    const executor: CompanionCommandExecutor = mock(async ({ env }) => {
      expect(env.OPENCODE_DATA_DIR).toBe('/tmp/opencode-data');
      return { daily: [] };
    });

    await fetchAllCompanionData('opencode', {
      packageRunner: 'npx',
      dataPath: '/tmp/opencode-data',
      executor,
    });

    expect(executor).toHaveBeenCalledTimes(2);
  });

  it('returns empty arrays when a companion command fails', async () => {
    const executor: CompanionCommandExecutor = mock(async () => {
      throw new Error('missing logs');
    });

    const data = await fetchAllCompanionData('codex', {
      packageRunner: 'npx',
      maxRetries: 1,
      executor,
    });

    expect(data.daily).toEqual([]);
    expect(data.monthly).toEqual([]);
    expect(data.session).toEqual([]);
  });
});

describe('buildAgentCommandArgs', () => {
  it('invokes the unified ccusage CLI with --breakdown --json', () => {
    expect(buildAgentCommandArgs('bunx', 'gemini', 'daily')).toEqual([
      'bunx', 'ccusage@latest', 'gemini', 'daily', '--breakdown', '--json',
    ]);
  });
});

describe('CCUSAGE_AGENT_SOURCES', () => {
  it('registers all ccusage agent subcommands except claude', () => {
    const ids = CCUSAGE_AGENT_SOURCES.map(s => s.id);
    expect(ids).toContain('codex');
    expect(ids).toContain('opencode');
    expect(ids).toContain('gemini');
    expect(ids).not.toContain('hermes');
    expect(ids).toContain('openclaw');
    expect(ids).not.toContain('claude');
  });
});

describe('buildCompanionEventRows', () => {
  // ccusage 20.x reports cached tokens separately for every agent (verified:
  // codex totalTokens = input + output + cachedInput), so total_tokens includes
  // cache uniformly. Reasoning lives in its own column, never folded into total.
  it('includes cache tokens in total_tokens (cache tracked separately)', () => {
    const rows = buildCompanionEventRows(
      {
        daily: [{
          date: '2026-05-13',
          inputTokens: 100,
          outputTokens: 50,
          cacheCreationTokens: 10,
          cacheReadTokens: 20,
          totalCost: 0.01,
          modelsUsed: ['gpt-5'],
          modelBreakdowns: [{
            modelName: 'gpt-5',
            inputTokens: 100,
            outputTokens: 50,
            cacheCreationTokens: 10,
            cacheReadTokens: 20,
            reasoningTokens: 0,
            cost: 0.01,
          }],
        }],
        monthly: [],
        session: [],
      } satisfies CompanionData,
      'machine-1',
      'codex',
      false
    );

    expect(rows).toHaveLength(1);
    expect(rows[0].total_tokens).toBe(180);
    expect(rows[0].cache_creation_tokens).toBe(10);
    expect(rows[0].cache_read_tokens).toBe(20);
    expect(rows[0].reasoning_tokens).toBe(0);
  });

  it('captures reasoning tokens without adding them to total_tokens', () => {
    const rows = buildCompanionEventRows(
      {
        daily: [{
          date: '2026-05-13',
          inputTokens: 469867,
          outputTokens: 33580,
          cacheCreationTokens: 0,
          cacheReadTokens: 2214272,
          reasoningTokens: 17062,
          totalCost: 0.66,
          modelsUsed: ['gpt-5.4-mini'],
          modelBreakdowns: [{
            modelName: 'gpt-5.4-mini',
            inputTokens: 469867,
            outputTokens: 33580,
            cacheCreationTokens: 0,
            cacheReadTokens: 2214272,
            reasoningTokens: 17062,
            cost: 0.66,
          }],
        }],
        monthly: [],
        session: [],
      } satisfies CompanionData,
      'machine-1',
      'codex',
      false
    );

    expect(rows).toHaveLength(1);
    // Matches ccusage's own totalTokens: input + output + cacheRead, reasoning excluded.
    expect(rows[0].total_tokens).toBe(2717719);
    expect(rows[0].reasoning_tokens).toBe(17062);
  });

  it('explodes per-model breakdowns from --breakdown into separate rows', () => {
    const rows = buildCompanionEventRows(
      {
        daily: [{
          date: '2026-05-13',
          inputTokens: 300,
          outputTokens: 120,
          cacheCreationTokens: 0,
          cacheReadTokens: 0,
          totalCost: 0.05,
          modelsUsed: ['model-a', 'model-b'],
          modelBreakdowns: [
            { modelName: 'model-a', inputTokens: 200, outputTokens: 80, cacheCreationTokens: 0, cacheReadTokens: 0, reasoningTokens: 0, cost: 0.03 },
            { modelName: 'model-b', inputTokens: 100, outputTokens: 40, cacheCreationTokens: 0, cacheReadTokens: 0, reasoningTokens: 0, cost: 0.02 },
          ],
        }],
        monthly: [],
        session: [],
      } satisfies CompanionData,
      'machine-1',
      'gemini',
      false
    );

    expect(rows).toHaveLength(2);
    expect(rows.map(r => r.model_name).sort()).toEqual(['model-a', 'model-b']);
    expect(rows.every(r => r.source === 'gemini')).toBe(true);
  });
});
