/**
 * Data Parsers
 *
 * Functions to parse and transform ccusage/OpenCode data.
 */

import { createHash } from 'crypto';
import type {
  DailyUsage,
  MonthlyUsage,
  SessionUsage,
  BlockUsage,
  ProjectDailyUsage,
  OpenCodeMessage,
  ModelBreakdown,
} from './types.js';
import type { ImporterConfig } from '../config/index.js';

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
 * Parse date string from ccusage/OpenCode format
 */
export function parseDate(dateStr: string): Date {
  // Handle ISO format dates (2025-01-05 or 2025-01-05T10:00:00.000Z)
  const date = new Date(dateStr);
  if (isNaN(date.getTime())) {
    throw new Error(`Invalid date string: ${dateStr}`);
  }
  return date;
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
 * Build row for daily usage table
 */
export function buildDailyRow(
  item: DailyUsage,
  machineName: string,
  source: string
): Record<string, any> {
  return {
    date: parseDate(item.date).toISOString().split('T')[0],
    machine_name: machineName,
    input_tokens: item.inputTokens,
    output_tokens: item.outputTokens,
    cache_creation_tokens: item.cacheCreationTokens,
    cache_read_tokens: item.cacheReadTokens,
    total_tokens: item.totalTokens,
    total_cost: item.totalCost,
    models_count: item.modelsUsed.length,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    source,
  };
}

/**
 * Build row for monthly usage table
 */
export function buildMonthlyRow(
  item: MonthlyUsage,
  machineName: string,
  source: string
): Record<string, any> {
  const [year, month] = item.month.split('-');

  return {
    month: item.month,
    year: parseInt(year),
    month_num: parseInt(month),
    machine_name: machineName,
    input_tokens: item.inputTokens,
    output_tokens: item.outputTokens,
    cache_creation_tokens: item.cacheCreationTokens,
    cache_read_tokens: item.cacheReadTokens,
    total_tokens: item.totalTokens,
    total_cost: item.totalCost,
    models_count: item.modelsUsed.length,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    source,
  };
}

/**
 * Build row for session usage table
 */
export function buildSessionRow(
  item: SessionUsage,
  machineName: string,
  source: string,
  hashProjects: boolean
): Record<string, any> {
  const hashedSessionId = hashProjectName(item.sessionId, hashProjects);
  const hashedProjectPath = hashProjectName(item.projectPath, hashProjects);

  return {
    session_id: hashedSessionId,
    project_path: hashedProjectPath,
    machine_name: machineName,
    input_tokens: item.inputTokens,
    output_tokens: item.outputTokens,
    cache_creation_tokens: item.cacheCreationTokens,
    cache_read_tokens: item.cacheReadTokens,
    total_tokens: item.totalTokens,
    total_cost: item.totalCost,
    last_activity: parseDate(item.lastActivity).toISOString().split('T')[0],
    models_count: item.modelsUsed.length,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    source,
  };
}

/**
 * Build row for blocks table
 */
export function buildBlockRow(
  item: BlockUsage,
  machineName: string,
  source: string
): Record<string, any> {
  return {
    block_id: item.id,
    machine_name: machineName,
    start_time: parseDateTime(item.startTime)?.toISOString(),
    end_time: parseDateTime(item.endTime)?.toISOString(),
    actual_end_time: parseDateTime(item.actualEndTime)?.toISOString(),
    is_active: item.isActive ? 1 : 0,
    is_gap: item.isGap ? 1 : 0,
    entries: item.entries,
    input_tokens: item.tokenCounts.inputTokens,
    output_tokens: item.tokenCounts.outputTokens,
    cache_creation_tokens: item.tokenCounts.cacheCreationInputTokens,
    cache_read_tokens: item.tokenCounts.cacheReadInputTokens,
    total_tokens: item.totalTokens,
    cost_usd: item.costUSD,
    models_count: item.models.length,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    usage_limit_reset_time: parseDateTime(item.usageLimitResetTime)?.toISOString(),
    burn_rate: extractBurnRate(item.burnRate),
    projection: extractProjection(item.projection),
    source,
  };
}

/**
 * Build model breakdown row
 */
export function buildModelBreakdownRow(
  recordType: string,
  recordKey: string,
  machineName: string,
  breakdown: ModelBreakdown,
  source: string
): Record<string, any> {
  return {
    record_type: recordType,
    record_key: recordKey,
    machine_name: machineName,
    model_name: breakdown.modelName,
    input_tokens: breakdown.inputTokens,
    output_tokens: breakdown.outputTokens,
    cache_creation_tokens: breakdown.cacheCreationTokens,
    cache_read_tokens: breakdown.cacheReadTokens,
    cost: breakdown.cost,
    created_at: new Date().toISOString(),
    source,
  };
}

/**
 * Build models used row
 */
export function buildModelsUsedRow(
  recordType: string,
  recordKey: string,
  machineName: string,
  model: string,
  source: string
): Record<string, any> {
  return {
    record_type: recordType,
    record_key: recordKey,
    machine_name: machineName,
    model_name: model,
    created_at: new Date().toISOString(),
    source,
  };
}
