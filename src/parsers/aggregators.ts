/**
 * Data Aggregators
 *
 * Functions to aggregate OpenCode messages into usage statistics.
 * Refactored from monolithic Python method for better maintainability.
 */

import type {
  OpenCodeMessage,
  DailyUsage,
  MonthlyUsage,
  SessionUsage,
  ProjectDailyUsage,
  ModelBreakdown,
} from './types.js';
import { hashProjectName } from './parsers.js';

/**
 * Aggregate OpenCode messages into usage statistics
 */
export function aggregateOpenCodeMessages(
  messages: OpenCodeMessage[],
  machineName: string,
  hashProjects = true
): OpenCodeAggregation {
  // Filter for assistant messages only
  const assistantMessages = filterAssistantMessages(messages);

  return {
    daily: aggregateByDate(assistantMessages),
    monthly: aggregateByMonth(assistantMessages),
    session: aggregateBySession(assistantMessages, hashProjects),
    projects: aggregateByProject(assistantMessages, hashProjects),
  };
}

/**
 * Filter messages to only include assistant messages
 */
function filterAssistantMessages(messages: OpenCodeMessage[]): OpenCodeMessage[] {
  return messages.filter(m => m.role === 'assistant');
}

/**
 * Aggregate messages by date
 */
function aggregateByDate(messages: OpenCodeMessage[]): DailyUsage[] {
  const byDate = new Map<string, OpenCodeMessage[]>();

  for (const msg of messages) {
    const date = msg.date;
    if (!byDate.has(date)) {
      byDate.set(date, []);
    }
    byDate.get(date)!.push(msg);
  }

  const result: DailyUsage[] = [];
  for (const [date, dateMessages] of byDate.entries()) {
    result.push({
      date,
      ...aggregateMessagesList(dateMessages),
    });
  }

  return result;
}

/**
 * Aggregate messages by month
 */
function aggregateByMonth(messages: OpenCodeMessage[]): MonthlyUsage[] {
  const byMonth = new Map<string, OpenCodeMessage[]>();

  for (const msg of messages) {
    const date = new Date(msg.date);
    const monthKey = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;

    if (!byMonth.has(monthKey)) {
      byMonth.set(monthKey, []);
    }
    byMonth.get(monthKey)!.push(msg);
  }

  const result: MonthlyUsage[] = [];
  for (const [month, monthMessages] of byMonth.entries()) {
    result.push({
      month,
      ...aggregateMessagesList(monthMessages),
    });
  }

  return result;
}

/**
 * Aggregate messages by session
 */
function aggregateBySession(messages: OpenCodeMessage[], hashProjects: boolean): SessionUsage[] {
  const bySession = new Map<string, OpenCodeMessage[]>();
  const sessionProjects = new Map<string, string>();

  for (const msg of messages) {
    const sessionId = msg.sessionId ?? 'unknown';
    if (!bySession.has(sessionId)) {
      bySession.set(sessionId, []);
    }
    bySession.get(sessionId)!.push(msg);
    sessionProjects.set(sessionId, msg.projectPath ?? 'unknown');
  }

  const result: SessionUsage[] = [];
  for (const [sessionId, sessionMessages] of bySession.entries()) {
    result.push({
      sessionId,
      projectPath: sessionProjects.get(sessionId) ?? 'unknown',
      lastActivity: sessionMessages[sessionMessages.length - 1].date,
      ...aggregateMessagesList(sessionMessages),
    });
  }

  return result;
}

/**
 * Aggregate messages by project and date
 */
function aggregateByProject(
  messages: OpenCodeMessage[],
  hashProjects: boolean
): Record<string, ProjectDailyUsage[]> {
  const byProjectDate = new Map<string, Map<string, OpenCodeMessage[]>>();

  for (const msg of messages) {
    const projectPath = msg.projectPath ?? 'unknown';
    const projectId = hashProjectName(projectPath, hashProjects);
    const date = msg.date;

    if (!byProjectDate.has(projectId)) {
      byProjectDate.set(projectId, new Map());
    }

    const projectDates = byProjectDate.get(projectId)!;
    if (!projectDates.has(date)) {
      projectDates.set(date, []);
    }
    projectDates.get(date)!.push(msg);
  }

  const result: Record<string, ProjectDailyUsage[]> = {};

  for (const [projectId, dates] of byProjectDate.entries()) {
    const projectRecords: ProjectDailyUsage[] = [];

    for (const [date, dateMessages] of dates.entries()) {
      projectRecords.push({
        date,
        ...aggregateMessagesList(dateMessages),
      });
    }

    result[projectId] = projectRecords;
  }

  return result;
}

/**
 * Aggregate a list of messages into a single record
 */
function aggregateMessagesList(messages: OpenCodeMessage[]): Omit<DailyUsage, 'date'> {
  let totalInput = 0;
  let totalOutput = 0;
  let totalCacheCreation = 0;
  let totalCacheRead = 0;
  let totalCost = 0;

  const modelCosts = new Map<string, ModelBreakdown>();
  const modelsUsed = new Set<string>();

  for (const msg of messages) {
    const usage = msg.usage;

    totalInput += usage.inputTokens;
    totalOutput += usage.outputTokens;
    totalCacheCreation += usage.cacheCreationTokens;
    totalCacheRead += usage.cacheReadTokens;
    totalCost += usage.costUSD;

    const model = msg.model;
    modelsUsed.add(model);

    if (!modelCosts.has(model)) {
      modelCosts.set(model, {
        modelName: model,
        inputTokens: 0,
        outputTokens: 0,
        cacheCreationTokens: 0,
        cacheReadTokens: 0,
        cost: 0,
      });
    }

    const breakdown = modelCosts.get(model)!;
    breakdown.inputTokens += usage.inputTokens;
    breakdown.outputTokens += usage.outputTokens;
    breakdown.cacheCreationTokens += usage.cacheCreationTokens;
    breakdown.cacheReadTokens += usage.cacheReadTokens;
    breakdown.cost += usage.cost;
  }

  const modelBreakdowns = Array.from(modelCosts.values());

  return {
    inputTokens: totalInput,
    outputTokens: totalOutput,
    cacheCreationTokens: totalCacheCreation,
    cacheReadTokens: totalCacheRead,
    totalTokens: totalInput + totalOutput + totalCacheCreation + totalCacheRead,
    totalCost,
    modelsUsed: Array.from(modelsUsed),
    modelBreakdowns,
  };
}

/**
 * Type definitions
 */
export interface OpenCodeAggregation {
  daily: DailyUsage[];
  monthly: MonthlyUsage[];
  session: SessionUsage[];
  projects: Record<string, ProjectDailyUsage[]>;
}
