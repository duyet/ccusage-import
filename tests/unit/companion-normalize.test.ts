/**
 * Pure normalization of ccusage agent JSON into the canonical companion shape.
 */

import { describe, it, expect } from 'bun:test';
import { normalizeUsageRow, normalizeModelBreakdowns } from '../../src/fetchers/companion';

describe('normalizeUsageRow', () => {
  it('maps Codex cachedInputTokens → cacheReadTokens, keeps inputTokens separate', () => {
    const row = normalizeUsageRow('daily', { inputTokens: 100, cachedInputTokens: 50 });
    expect(row.inputTokens).toBe(100);
    expect(row.cacheReadTokens).toBe(50);
  });

  it('resolves reasoning token aliases', () => {
    expect(normalizeUsageRow('daily', { reasoningOutputTokens: 9 }).reasoningTokens).toBe(9);
    expect(normalizeUsageRow('daily', { thoughtsTokens: 11 }).reasoningTokens).toBe(11);
    expect(normalizeUsageRow('daily', { reasoning_tokens: 13 }).reasoningTokens).toBe(13);
  });

  it('session: falls back across id/directory/date aliases', () => {
    const row = normalizeUsageRow('session', { id: 's1', directory: '/repo', date: '2026-01-01' });
    expect(row.sessionId).toBe('s1');
    expect(row.projectPath).toBe('/repo');
    expect(row.lastActivity).toBe('2026-01-01');
  });

  it('session: projectPath defaults to sessionId when no path provided', () => {
    const row = normalizeUsageRow('session', { sessionId: 'abc' });
    expect(row.projectPath).toBe('abc');
  });

  it('non-object input → empty canonical row', () => {
    const row = normalizeUsageRow('daily', null);
    expect(row.modelsUsed).toEqual([]);
    expect(row.modelBreakdowns).toEqual([]);
  });
});

describe('normalizeModelBreakdowns', () => {
  it('array of objects: aliases input_tokens / cachedInputTokens', () => {
    const out = normalizeModelBreakdowns([{ model: 'm', input_tokens: 5, cachedInputTokens: 7 }]);
    expect(out).toEqual([
      { modelName: 'm', inputTokens: 5, outputTokens: 0, cacheCreationTokens: 0, cacheReadTokens: 7, reasoningTokens: 0, cost: 0 },
    ]);
  });

  it('array of strings → named breakdowns with zero counts', () => {
    expect(normalizeModelBreakdowns(['gpt-5'])).toEqual([
      { modelName: 'gpt-5', inputTokens: 0, outputTokens: 0, cacheCreationTokens: 0, cacheReadTokens: 0, reasoningTokens: 0, cost: 0 },
    ]);
  });

  it('object map { model: {...} } → entries', () => {
    const out = normalizeModelBreakdowns({ 'gpt-5': { inputTokens: 3, outputTokens: 4 } });
    expect(out).toEqual([
      { modelName: 'gpt-5', inputTokens: 3, outputTokens: 4, cacheCreationTokens: 0, cacheReadTokens: 0, reasoningTokens: 0, cost: 0 },
    ]);
  });

  it('non-array/non-object → empty', () => {
    expect(normalizeModelBreakdowns(null)).toEqual([]);
  });
});
