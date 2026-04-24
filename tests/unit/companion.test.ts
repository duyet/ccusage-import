/**
 * ccusage companion fetcher tests
 */

import { describe, expect, it, vi } from 'vitest';
import {
  fetchAllCompanionData,
  type CompanionCommandExecutor,
} from '../../src/fetchers/companion';

describe('fetchAllCompanionData', () => {
  it('parses wrapped daily, monthly, and session JSON', async () => {
    const executor: CompanionCommandExecutor = vi.fn(async ({ command }) => {
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

      if (command === 'monthly') {
        return {
          monthly: [{
            month: '2026-04',
            inputTokens: 100,
            outputTokens: 50,
            cacheCreationTokens: 10,
            cacheReadTokens: 20,
            totalTokens: 180,
            totalCost: 0.01,
            modelsUsed: ['gpt-5'],
            modelBreakdowns: [],
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
    expect(data.monthly).toHaveLength(1);
    expect(data.session).toHaveLength(1);
    expect(data.daily[0].modelsUsed).toEqual(['gpt-5']);
    expect(data.session[0].sessionId).toBe('session-1');
    expect(data.session[0].projectPath).toBe('/repo');
  });

  it('passes CODEX_HOME for Codex custom path', async () => {
    const executor: CompanionCommandExecutor = vi.fn(async ({ env }) => {
      expect(env.CODEX_HOME).toBe('/tmp/codex-home');
      return { daily: [] };
    });

    await fetchAllCompanionData('codex', {
      packageRunner: 'npx',
      dataPath: '/tmp/codex-home',
      executor,
    });

    expect(executor).toHaveBeenCalledTimes(3);
  });

  it('passes OPENCODE_DATA_DIR for OpenCode custom path', async () => {
    const executor: CompanionCommandExecutor = vi.fn(async ({ env }) => {
      expect(env.OPENCODE_DATA_DIR).toBe('/tmp/opencode-data');
      return { daily: [] };
    });

    await fetchAllCompanionData('opencode', {
      packageRunner: 'npx',
      dataPath: '/tmp/opencode-data',
      executor,
    });

    expect(executor).toHaveBeenCalledTimes(3);
  });

  it('returns empty arrays when a companion command fails', async () => {
    const executor: CompanionCommandExecutor = vi.fn(async () => {
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
