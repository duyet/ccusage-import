/**
 * Core parser tests: golden rows (equivalence guard for the unified builder),
 * cost distribution, and date parsing. Pure logic only — no DB/network.
 */

import { describe, it, expect } from 'bun:test';
import {
  buildCcusageEventRows,
  buildCompanionEventRows,
  distributeCost,
  parseDate,
  parseDateTime,
  extractBurnRate,
  extractProjection,
} from '../../src/parsers/parsers';
import type { CompanionData } from '../../src/fetchers/companion';

const MACHINE = 'test-machine';

/** Strip the non-deterministic timestamps after asserting they're a matched pair. */
function stripTimestamps(row: Record<string, unknown>): Record<string, unknown> {
  expect(typeof row.created_at).toBe('string');
  expect(row.updated_at).toBe(row.created_at);
  const { created_at, updated_at, ...rest } = row;
  return rest;
}

describe('buildCcusageEventRows — golden rows', () => {
  it('daily: one row per model breakdown with formula total', () => {
    const rows = buildCcusageEventRows(
      {
        daily: [
          {
            date: '2025-01-05',
            totalCost: 0.05,
            modelBreakdowns: [
              {
                modelName: 'claude-3-5-sonnet',
                inputTokens: 1000,
                outputTokens: 2000,
                cacheCreationTokens: 100,
                cacheReadTokens: 200,
                cost: 0.05,
              },
            ],
          } as any,
        ],
      },
      MACHINE,
      false
    );

    expect(rows).toHaveLength(1);
    expect(stripTimestamps(rows[0])).toEqual({
      date: '2025-01-05',
      record_type: 'daily',
      record_key: '2025-01-05',
      source: 'ccusage',
      machine_name: MACHINE,
      model_name: 'claude-3-5-sonnet',
      session_id: '',
      project_path: '',
      input_tokens: 1000,
      output_tokens: 2000,
      cache_creation_tokens: 100,
      cache_read_tokens: 200,
      reasoning_tokens: 0,
      total_tokens: 3300,
      cost: 0.05,
      dedup_key: '2989cf7bd2e15426',
      import_id: '',
      block_id: '',
      start_time: null,
      end_time: null,
      actual_end_time: null,
      is_active: 0,
      is_gap: 0,
      entries: 0,
      burn_rate: 0,
      projection: 0,
      usage_limit_reset_time: null,
    });
  });

  it('session: record_key is session id; session_id/project_path set', () => {
    const rows = buildCcusageEventRows(
      {
        session: [
          {
            sessionId: 'sess-1',
            projectPath: '/repo',
            lastActivity: '2025-01-06',
            totalCost: 0.025,
            modelBreakdowns: [
              {
                modelName: 'claude-3-5-sonnet',
                inputTokens: 500,
                outputTokens: 1000,
                cacheCreationTokens: 50,
                cacheReadTokens: 100,
                cost: 0.025,
              },
            ],
          } as any,
        ],
      },
      MACHINE,
      false
    );

    expect(rows).toHaveLength(1);
    expect(stripTimestamps(rows[0])).toEqual({
      date: '2025-01-06',
      record_type: 'session',
      record_key: 'sess-1',
      source: 'ccusage',
      machine_name: MACHINE,
      model_name: 'claude-3-5-sonnet',
      session_id: 'sess-1',
      project_path: '/repo',
      input_tokens: 500,
      output_tokens: 1000,
      cache_creation_tokens: 50,
      cache_read_tokens: 100,
      reasoning_tokens: 0,
      total_tokens: 1650,
      cost: 0.025,
      dedup_key: '89a672922d64efe9',
      import_id: '',
      block_id: '',
      start_time: null,
      end_time: null,
      actual_end_time: null,
      is_active: 0,
      is_gap: 0,
      entries: 0,
      burn_rate: 0,
      projection: 0,
      usage_limit_reset_time: null,
    });
  });

  it('project_daily: record_key is `${date}:${projectPath}`', () => {
    const rows = buildCcusageEventRows(
      {
        blocks: [
          {
            id: 'block-123',
            startTime: '2025-01-05T10:00:00.000Z',
            endTime: '2025-01-05T15:00:00.000Z',
            actualEndTime: null,
            isActive: true,
            isGap: false,
            entries: 5,
            tokenCounts: {
              inputTokens: 5000,
              outputTokens: 10000,
              cacheCreationInputTokens: 500,
              cacheReadInputTokens: 1000,
            },
            // Deliberately != formula sum (16500) to prove source value is used.
            totalTokens: 99999,
            costUSD: 0.25,
            usageLimitResetTime: '2025-01-05T16:00:00.000Z',
            burnRate: { costPerHour: 0.1 },
            projection: { totalCost: 0.5 },
          } as any,
        ],
      },
      MACHINE,
      false
    );

    expect(rows).toHaveLength(1);
    const row = rows[0];
    expect(row.record_type).toBe('block');
    expect(row.record_key).toBe('block-123');
    expect(row.block_id).toBe('block-123');
    expect(row.model_name).toBe('');
    expect(row.input_tokens).toBe(5000);
    expect(row.output_tokens).toBe(10000);
    expect(row.cache_creation_tokens).toBe(500);
    expect(row.cache_read_tokens).toBe(1000);
    expect(row.reasoning_tokens).toBe(0);
    expect(row.total_tokens).toBe(99999);
    expect(row.cost).toBe(0.25);
    expect(row.is_active).toBe(1);
    expect(row.is_gap).toBe(0);
    expect(row.entries).toBe(5);
    expect(row.burn_rate).toBe(0.1);
    expect(row.projection).toBe(0.5);
    // datetime fields: helper-formatted strings, actual_end_time stays null
    expect(typeof row.start_time).toBe('string');
    expect(typeof row.end_time).toBe('string');
    expect(typeof row.usage_limit_reset_time).toBe('string');
    expect(row.actual_end_time).toBeNull();
  });

  it('project_daily: record_key is `${date}:${projectPath}`', () => {
    const rows = buildCcusageEventRows(
      {
        projects: {
          '/repo': [
            {
              date: '2025-01-05',
              totalCost: 0.025,
              modelBreakdowns: [
                {
                  modelName: 'claude-3-5-sonnet',
                  inputTokens: 500,
                  outputTokens: 1000,
                  cacheCreationTokens: 50,
                  cacheReadTokens: 100,
                  cost: 0.025,
                },
              ],
            } as any,
          ],
        },
      },
      MACHINE,
      false
    );

    expect(rows).toHaveLength(1);
    expect(stripTimestamps(rows[0])).toEqual({
      date: '2025-01-05',
      record_type: 'project_daily',
      record_key: '2025-01-05:/repo',
      source: 'ccusage',
      machine_name: MACHINE,
      model_name: 'claude-3-5-sonnet',
      session_id: '',
      project_path: '/repo',
      input_tokens: 500,
      output_tokens: 1000,
      cache_creation_tokens: 50,
      cache_read_tokens: 100,
      reasoning_tokens: 0,
      total_tokens: 1650,
      cost: 0.025,
      dedup_key: '07450000e75f0bb1',
      import_id: '',
      block_id: '',
      start_time: null,
      end_time: null,
      actual_end_time: null,
      is_active: 0,
      is_gap: 0,
      entries: 0,
      burn_rate: 0,
      projection: 0,
      usage_limit_reset_time: null,
    });
  });

  it('daily fallback: no modelBreakdowns → single row from totals, model from modelsUsed', () => {
    const rows = buildCcusageEventRows(
      {
        daily: [
          {
            date: '2025-01-05',
            inputTokens: 10,
            outputTokens: 20,
            cacheCreationTokens: 1,
            cacheReadTokens: 2,
            totalCost: 0.5,
            modelsUsed: ['model-x'],
          } as any,
        ],
      },
      MACHINE,
      false
    );

    expect(rows).toHaveLength(1);
    expect(rows[0].model_name).toBe('model-x');
    expect(rows[0].cost).toBe(0.5);
    expect(rows[0].total_tokens).toBe(33);
  });
});

describe('buildCompanionEventRows — golden rows', () => {
  it('daily: reasoning_tokens carried from breakdown, excluded from total', () => {
    const data: CompanionData = {
      daily: [
        {
          date: '2026-04-24',
          totalCost: 0.01,
          modelsUsed: ['gpt-5'],
          modelBreakdowns: [
            {
              modelName: 'gpt-5',
              inputTokens: 100,
              outputTokens: 50,
              cacheCreationTokens: 10,
              cacheReadTokens: 20,
              reasoningTokens: 7,
              cost: 0.01,
            },
          ],
        } as any,
      ],
      monthly: [],
      session: [],
    };

    const rows = buildCompanionEventRows(data, MACHINE, 'codex', false);
    expect(rows).toHaveLength(1);
    expect(rows[0].reasoning_tokens).toBe(7);
    // total excludes reasoning: 100+50+10+20 = 180
    expect(rows[0].total_tokens).toBe(180);
    expect(rows[0].source).toBe('codex');
    expect(rows[0].record_type).toBe('daily');
  });
});

describe('distributeCost (via builder, missing per-model costs)', () => {
  it('weights by output tokens and last row absorbs rounding so sum == parentCost', () => {
    const rows = buildCcusageEventRows(
      {
        daily: [
          {
            date: '2025-02-01',
            totalCost: 1,
            modelBreakdowns: [
              { modelName: 'a', inputTokens: 0, outputTokens: 1, cacheCreationTokens: 0, cacheReadTokens: 0, cost: 0 },
              { modelName: 'b', inputTokens: 0, outputTokens: 1, cacheCreationTokens: 0, cacheReadTokens: 0, cost: 0 },
              { modelName: 'c', inputTokens: 0, outputTokens: 1, cacheCreationTokens: 0, cacheReadTokens: 0, cost: 0 },
            ],
          } as any,
        ],
      },
      MACHINE,
      false
    );

    expect(rows).toHaveLength(3);
    const costs = rows.map(r => r.cost as number);
    const sum = costs.reduce((a, b) => a + b, 0);
    expect(sum).toBeCloseTo(1, 8);
  });

  it('zero tokens → all cost on first breakdown', () => {
    const rows = buildCcusageEventRows(
      {
        daily: [
          {
            date: '2025-02-02',
            totalCost: 2,
            modelBreakdowns: [
              { modelName: 'a', inputTokens: 0, outputTokens: 0, cacheCreationTokens: 0, cacheReadTokens: 0, cost: 0 },
              { modelName: 'b', inputTokens: 0, outputTokens: 0, cacheCreationTokens: 0, cacheReadTokens: 0, cost: 0 },
            ],
          } as any,
        ],
      },
      MACHINE,
      false
    );
    expect(rows.map(r => r.cost)).toEqual([2, 0]);
  });

  it('per-model costs already present → unchanged', () => {
    const rows = buildCcusageEventRows(
      {
        daily: [
          {
            date: '2025-02-03',
            totalCost: 3,
            modelBreakdowns: [
              { modelName: 'a', inputTokens: 1, outputTokens: 1, cacheCreationTokens: 0, cacheReadTokens: 0, cost: 1 },
              { modelName: 'b', inputTokens: 1, outputTokens: 1, cacheCreationTokens: 0, cacheReadTokens: 0, cost: 2 },
            ],
          } as any,
        ],
      },
      MACHINE,
      false
    );
    expect(rows.map(r => r.cost)).toEqual([1, 2]);
  });
});

describe('distributeCost (direct)', () => {
  it('no-op when per-model costs already present', () => {
    const bds = [
      { cost: 1, outputTokens: 10, inputTokens: 1 },
      { cost: 2, outputTokens: 20, inputTokens: 2 },
    ];
    distributeCost(bds, 99);
    expect(bds.map(b => b.cost)).toEqual([1, 2]);
  });

  it('no-op when parentCost <= 0', () => {
    const bds = [
      { cost: 0, outputTokens: 10, inputTokens: 1 },
      { cost: 0, outputTokens: 20, inputTokens: 2 },
    ];
    distributeCost(bds, 0);
    expect(bds.map(b => b.cost)).toEqual([0, 0]);
  });

  it('weights by output; last element absorbs rounding so sum == parentCost', () => {
    const bds = [
      { cost: 0, outputTokens: 1, inputTokens: 0 },
      { cost: 0, outputTokens: 1, inputTokens: 0 },
      { cost: 0, outputTokens: 1, inputTokens: 0 },
    ];
    distributeCost(bds, 1);
    const sum = bds.reduce((a, b) => a + b.cost, 0);
    expect(sum).toBeCloseTo(1, 8);
  });

  it('falls back to input weighting when all outputs are 0', () => {
    const bds = [
      { cost: 0, outputTokens: 0, inputTokens: 3 },
      { cost: 0, outputTokens: 0, inputTokens: 1 },
    ];
    distributeCost(bds, 4);
    // weight by input: 3/4 and remainder
    expect(bds[0].cost).toBeCloseTo(3, 8);
    expect(bds[1].cost).toBeCloseTo(1, 8);
  });

  it('zero tokens → all cost to first breakdown', () => {
    const bds = [
      { cost: 0, outputTokens: 0, inputTokens: 0 },
      { cost: 0, outputTokens: 0, inputTokens: 0 },
    ];
    distributeCost(bds, 5);
    expect(bds.map(b => b.cost)).toEqual([5, 0]);
  });
});

describe('parseDate', () => {
  it('parses ISO date', () => {
    expect(parseDate('2025-01-05').toISOString().split('T')[0]).toBe('2025-01-05');
  });
  it('parses ISO datetime', () => {
    expect(parseDate('2025-01-05T10:00:00.000Z').toISOString().split('T')[0]).toBe('2025-01-05');
  });
  it('parses human-readable date as UTC', () => {
    expect(parseDate('Mar 21, 2026').toISOString().split('T')[0]).toBe('2026-03-21');
  });
  it('throws on invalid', () => {
    expect(() => parseDate('not-a-date')).toThrow();
  });
});

describe('parseDateTime', () => {
  it('returns null for null/empty', () => {
    expect(parseDateTime(null)).toBeNull();
    expect(parseDateTime('')).toBeNull();
  });
  it('returns null for invalid', () => {
    expect(parseDateTime('nonsense')).toBeNull();
  });
  it('returns a Date for valid input', () => {
    expect(parseDateTime('2025-01-05T10:00:00.000Z')).toBeInstanceOf(Date);
  });
});

describe('extractBurnRate / extractProjection', () => {
  it('extractBurnRate: number, object, null', () => {
    expect(extractBurnRate(0.5)).toBe(0.5);
    expect(extractBurnRate({ costPerHour: 0.7 })).toBe(0.7);
    expect(extractBurnRate(null)).toBeNull();
    expect(extractBurnRate({})).toBeNull();
  });
  it('extractProjection: number, object, null', () => {
    expect(extractProjection(1.2)).toBe(1.2);
    expect(extractProjection({ totalCost: 3.4 })).toBe(3.4);
    expect(extractProjection(null)).toBeNull();
    expect(extractProjection({})).toBeNull();
  });
});
