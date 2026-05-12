/**
 * Data Parsers
 *
 * Functions to parse and transform ccusage/OpenCode data into flat event rows.
 */

import { createHash } from 'crypto';
import type {
  DailyUsage,
  SessionUsage,
  BlockUsage,
  ProjectDailyUsage,
  OpenCodeMessage,
  ModelBreakdown,
} from './types.js';
import type { CompanionData, CompanionUsageRow } from '../fetchers/companion.js';

/**
 * Hash project name for privacy
 */
export function hashProjectName(projectPath: string, enabled = true): string {
  if (!enabled) {
    return projectPath;
  }

  return createHash('sha256')
    .update(projectPath, 'utf-8')
    .digest('hex')
    .slice(0, 8);
}

/**
 * Format Date as ClickHouse-compatible datetime string
 */
function chNow(): string {
  return chDateTime(new Date())!;
}

function chDateTime(d: Date | null): string | null {
  if (!d) return null;
  return d.toISOString().replace('T', ' ').replace(/\.\d+Z$/, '');
}

/**
 * Parse date string from ccusage/OpenCode format
 */
export function parseDate(dateStr: string): Date {
  // Handle ISO format dates (2025-01-05 or 2025-01-05T10:00:00.000Z)
  // Handle human-readable dates ("Mar 21, 2026") by treating as UTC
  const isoMatch = dateStr.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (isoMatch) {
    return new Date(dateStr);
  }
  // Non-ISO format (e.g. "Mar 21, 2026") — parse as UTC to avoid timezone shift
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) {
    throw new Error(`Invalid date string: ${dateStr}`);
  }
  // Extract UTC date components to avoid timezone offset
  return new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
}

/**
 * Parse datetime string and strip timezone
 */
export function parseDateTime(dateTimeStr: string | null): Date | null {
  if (!dateTimeStr) {
    return null;
  }

  const date = new Date(dateTimeStr);
  if (isNaN(date.getTime())) {
    return null;
  }

  // Strip timezone for ClickHouse compatibility
  return new Date(
    date.getFullYear(),
    date.getMonth(),
    date.getDate(),
    date.getHours(),
    date.getMinutes(),
    date.getSeconds(),
    date.getMilliseconds()
  );
}

/**
 * Extract burn rate from complex data structure
 */
export function extractBurnRate(burnRateData: any): number | null {
  if (typeof burnRateData === 'number') {
    return burnRateData;
  }

  if (burnRateData && typeof burnRateData === 'object' && 'costPerHour' in burnRateData) {
    return burnRateData.costPerHour;
  }

  return null;
}

/**
 * Extract projection from complex data structure
 */
export function extractProjection(projectionData: any): number | null {
  if (typeof projectionData === 'number') {
    return projectionData;
  }

  if (projectionData && typeof projectionData === 'object' && 'totalCost' in projectionData) {
    return projectionData.totalCost;
  }

  return null;
}

/**
 * Distribute cost across breakdowns when per-model costs are missing.
 * Codex/ccusage models often lack per-model cost — only parent has totalCost.
 * Distribute proportionally by outputTokens (or inputTokens as fallback).
 */
function distributeCost(
  breakdowns: { cost: number; outputTokens: number; inputTokens: number }[],
  parentCost: number
): void {
  const totalCost = breakdowns.reduce((s, b) => s + b.cost, 0);
  if (totalCost > 0 || parentCost <= 0) return; // per-model costs already present

  const totalOutput = breakdowns.reduce((s, b) => s + b.outputTokens, 0);
  const totalInput = breakdowns.reduce((s, b) => s + b.inputTokens, 0);
  const weight = totalOutput > 0 ? totalOutput : totalInput;
  if (weight === 0) {
    // No tokens — assign all cost to first model
    if (breakdowns.length > 0) breakdowns[0].cost = parentCost;
    return;
  }

  let remaining = parentCost;
  for (let i = 0; i < breakdowns.length; i++) {
    const w = breakdowns[i].outputTokens > 0 ? breakdowns[i].outputTokens : breakdowns[i].inputTokens;
    if (i === breakdowns.length - 1) {
      breakdowns[i].cost = Math.round(remaining * 1e8) / 1e8; // avoid rounding drift
    } else {
      const share = parentCost * (w / weight);
      breakdowns[i].cost = Math.round(share * 1e8) / 1e8;
      remaining -= breakdowns[i].cost;
    }
  }
}

/**
 * Build flat event rows from ccusage data.
 *
 * Explodes model breakdowns into individual rows:
 * one row per (record × model). Blocks get model_name=''.
 * Monthly is skipped (derivable from daily via GROUP BY toYYYYMM(date)).
 */
export function buildCcusageEventRows(
  data: {
    daily?: DailyUsage[];
    session?: SessionUsage[];
    blocks?: BlockUsage[];
    projects?: Record<string, ProjectDailyUsage[]>;
  },
  machineName: string,
  hashProjects: boolean
): Record<string, unknown>[] {
  const now = chNow();
  const events: Record<string, unknown>[] = [];
  const source = 'ccusage';

  // Daily: one row per model breakdown
  for (const item of data.daily ?? []) {
    const date = parseDate(item.date).toISOString().split('T')[0];
    const recordKey = date;
    const breakdowns = item.modelBreakdowns?.length
      ? item.modelBreakdowns.map(bd => ({ ...bd }))
      : [fallbackBreakdown(item)];
    distributeCost(breakdowns, item.totalCost);
    for (const bd of breakdowns) {
      events.push({
        date, record_type: 'daily', record_key: recordKey,
        source, machine_name: machineName,
        model_name: bd.modelName,
        session_id: '', project_path: '',
        input_tokens: bd.inputTokens, output_tokens: bd.outputTokens,
        cache_creation_tokens: bd.cacheCreationTokens, cache_read_tokens: bd.cacheReadTokens,
        total_tokens: bd.inputTokens + bd.outputTokens + bd.cacheCreationTokens + bd.cacheReadTokens,
        cost: bd.cost,
        block_id: '', start_time: null, end_time: null, actual_end_time: null,
        is_active: 0, is_gap: 0, entries: 0,
        burn_rate: 0, projection: 0, usage_limit_reset_time: null,
        created_at: now, updated_at: now,
      });
    }
  }

  // Session: one row per model breakdown
  for (const item of data.session ?? []) {
    const sid = hashProjectName(item.sessionId, hashProjects);
    const pp = hashProjectName(item.projectPath, hashProjects);
    const recordKey = sid;
    const date = parseDate(item.lastActivity).toISOString().split('T')[0];
    const breakdowns = item.modelBreakdowns?.length
      ? item.modelBreakdowns.map(bd => ({ ...bd }))
      : [fallbackBreakdown(item)];
    distributeCost(breakdowns, item.totalCost);
    for (const bd of breakdowns) {
      events.push({
        date, record_type: 'session', record_key: recordKey,
        source, machine_name: machineName,
        model_name: bd.modelName,
        session_id: sid, project_path: pp,
        input_tokens: bd.inputTokens, output_tokens: bd.outputTokens,
        cache_creation_tokens: bd.cacheCreationTokens, cache_read_tokens: bd.cacheReadTokens,
        total_tokens: bd.inputTokens + bd.outputTokens + bd.cacheCreationTokens + bd.cacheReadTokens,
        cost: bd.cost,
        block_id: '', start_time: null, end_time: null, actual_end_time: null,
        is_active: 0, is_gap: 0, entries: 0,
        burn_rate: 0, projection: 0, usage_limit_reset_time: null,
        created_at: now, updated_at: now,
      });
    }
  }

  // Blocks: single row, no model breakdown
  for (const item of data.blocks ?? []) {
    const startParsed = parseDateTime(item.startTime);
    const date = startParsed ? startParsed.toISOString().split('T')[0] : new Date().toISOString().split('T')[0];
    events.push({
      date, record_type: 'block', record_key: item.id,
      source, machine_name: machineName,
      model_name: '',
      session_id: '', project_path: '',
      input_tokens: item.tokenCounts.inputTokens,
      output_tokens: item.tokenCounts.outputTokens,
      cache_creation_tokens: item.tokenCounts.cacheCreationInputTokens,
      cache_read_tokens: item.tokenCounts.cacheReadInputTokens,
      total_tokens: item.totalTokens,
      cost: item.costUSD,
      block_id: item.id,
      start_time: chDateTime(startParsed),
      end_time: chDateTime(parseDateTime(item.endTime)),
      actual_end_time: chDateTime(parseDateTime(item.actualEndTime)),
      is_active: item.isActive ? 1 : 0,
      is_gap: item.isGap ? 1 : 0,
      entries: item.entries,
      burn_rate: extractBurnRate(item.burnRate) ?? 0,
      projection: extractProjection(item.projection) ?? 0,
      usage_limit_reset_time: chDateTime(parseDateTime(item.usageLimitResetTime)),
      created_at: now, updated_at: now,
    });
  }

  // Projects daily: Record<string, ProjectDailyUsage[]>
  for (const [projectId, items] of Object.entries(data.projects ?? {})) {
    const pp = hashProjectName(projectId, hashProjects);
    for (const item of items) {
      const date = parseDate(item.date).toISOString().split('T')[0];
      const recordKey = `${date}:${pp}`;
      const breakdowns = item.modelBreakdowns?.length
        ? item.modelBreakdowns.map(bd => ({ ...bd }))
        : [fallbackBreakdown(item)];
      distributeCost(breakdowns, item.totalCost);
      for (const bd of breakdowns) {
        events.push({
          date, record_type: 'project_daily', record_key: recordKey,
          source, machine_name: machineName,
          model_name: bd.modelName,
          session_id: '', project_path: pp,
          input_tokens: bd.inputTokens, output_tokens: bd.outputTokens,
          cache_creation_tokens: bd.cacheCreationTokens, cache_read_tokens: bd.cacheReadTokens,
          total_tokens: bd.inputTokens + bd.outputTokens + bd.cacheCreationTokens + bd.cacheReadTokens,
          cost: bd.cost,
          block_id: '', start_time: null, end_time: null, actual_end_time: null,
          is_active: 0, is_gap: 0, entries: 0,
          burn_rate: 0, projection: 0, usage_limit_reset_time: null,
          created_at: now, updated_at: now,
        });
      }
    }
  }

  return events;
}

/**
 * Build flat event rows from companion data (codex/opencode).
 */
export function buildCompanionEventRows(
  data: CompanionData,
  machineName: string,
  source: string,
  hashProjects: boolean
): Record<string, unknown>[] {
  const now = chNow();
  const events: Record<string, unknown>[] = [];

  // Daily
  for (const item of data.daily ?? []) {
    const row = item as CompanionUsageRow;
    const dateStr = (row.date ?? row.lastActivity ?? '') as string;
    if (!dateStr) continue;
    const date = parseDate(dateStr).toISOString().split('T')[0];
    const recordKey = date;
    const breakdowns = row.modelBreakdowns?.length
      ? row.modelBreakdowns.map(bd => ({ ...bd }))
      : [fallbackCompanionBreakdown(row)];
    distributeCost(breakdowns, (row.totalCost ?? 0) as number);
    for (const bd of breakdowns) {
      events.push({
        date, record_type: 'daily', record_key: recordKey,
        source, machine_name: machineName,
        model_name: bd.modelName,
        session_id: '', project_path: '',
        input_tokens: bd.inputTokens, output_tokens: bd.outputTokens,
        cache_creation_tokens: bd.cacheCreationTokens, cache_read_tokens: bd.cacheReadTokens,
        total_tokens: bd.inputTokens + bd.outputTokens + bd.cacheCreationTokens,
        cost: bd.cost,
        block_id: '', start_time: null, end_time: null, actual_end_time: null,
        is_active: 0, is_gap: 0, entries: 0,
        burn_rate: 0, projection: 0, usage_limit_reset_time: null,
        created_at: now, updated_at: now,
      });
    }
  }

  // Session
  for (const item of data.session ?? []) {
    const row = item as CompanionUsageRow;
    const sid = hashProjectName(String(row.sessionId ?? 'unknown'), hashProjects);
    const pp = hashProjectName(String(row.projectPath ?? sid), hashProjects);
    const dateStr = String(row.lastActivity ?? row.date ?? '');
    if (!dateStr) continue;
    const date = parseDate(dateStr).toISOString().split('T')[0];
    const recordKey = sid;
    const breakdowns = row.modelBreakdowns?.length
      ? row.modelBreakdowns.map(bd => ({ ...bd }))
      : [fallbackCompanionBreakdown(row)];
    distributeCost(breakdowns, (row.totalCost ?? 0) as number);
    for (const bd of breakdowns) {
      events.push({
        date, record_type: 'session', record_key: recordKey,
        source, machine_name: machineName,
        model_name: bd.modelName,
        session_id: sid, project_path: pp,
        input_tokens: bd.inputTokens, output_tokens: bd.outputTokens,
        cache_creation_tokens: bd.cacheCreationTokens, cache_read_tokens: bd.cacheReadTokens,
        total_tokens: bd.inputTokens + bd.outputTokens + bd.cacheCreationTokens,
        cost: bd.cost,
        block_id: '', start_time: null, end_time: null, actual_end_time: null,
        is_active: 0, is_gap: 0, entries: 0,
        burn_rate: 0, projection: 0, usage_limit_reset_time: null,
        created_at: now, updated_at: now,
      });
    }
  }

  return events;
}

/**
 * Create fallback breakdown from totals when no model breakdowns exist.
 */
function fallbackBreakdown(
  item: { inputTokens: number; outputTokens: number; cacheCreationTokens: number; cacheReadTokens: number; totalCost: number; modelsUsed?: string[] }
): ModelBreakdown {
  return {
    modelName: item.modelsUsed?.[0] ?? 'unknown',
    inputTokens: item.inputTokens,
    outputTokens: item.outputTokens,
    cacheCreationTokens: item.cacheCreationTokens,
    cacheReadTokens: item.cacheReadTokens,
    cost: item.totalCost,
  };
}

function fallbackCompanionBreakdown(row: CompanionUsageRow): { modelName: string; inputTokens: number; outputTokens: number; cacheCreationTokens: number; cacheReadTokens: number; cost: number } {
  return {
    modelName: row.modelsUsed?.[0] ?? 'unknown',
    inputTokens: (row.inputTokens ?? 0) as number,
    outputTokens: (row.outputTokens ?? 0) as number,
    cacheCreationTokens: (row.cacheCreationTokens ?? 0) as number,
    cacheReadTokens: (row.cacheReadTokens ?? 0) as number,
    cost: (row.totalCost ?? 0) as number,
  };
}
