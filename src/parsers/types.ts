/**
 * Parser Type Definitions
 *
 * Zod schemas for runtime validation and TypeScript types for ccusage/OpenCode data.
 */

import { z } from 'zod';

/**
 * ccusage daily data schema
 */
export const DailyUsageSchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  inputTokens: z.number().int().nonnegative(),
  outputTokens: z.number().int().nonnegative(),
  cacheCreationTokens: z.number().int().nonnegative(),
  cacheReadTokens: z.number().int().nonnegative(),
  totalTokens: z.number().int().nonnegative(),
  totalCost: z.number().nonnegative(),
  modelsUsed: z.array(z.string()),
  modelBreakdowns: z.array(ModelBreakdownSchema),
});

/**
 * ccusage monthly data schema
 */
export const MonthlyUsageSchema = z.object({
  month: z.string().regex(/^\d{4}-\d{2}$/),
  inputTokens: z.number().int().nonnegative(),
  outputTokens: z.number().int().nonnegative(),
  cacheCreationTokens: z.number().int().nonnegative(),
  cacheReadTokens: z.number().int().nonnegative(),
  totalTokens: z.number().int().nonnegative(),
  totalCost: z.number().nonnegative(),
  modelsUsed: z.array(z.string()),
  modelBreakdowns: z.array(ModelBreakdownSchema),
});

/**
 * ccusage session data schema
 */
export const SessionUsageSchema = z.object({
  sessionId: z.string(),
  projectPath: z.string(),
  inputTokens: z.number().int().nonnegative(),
  outputTokens: z.number().int().nonnegative(),
  cacheCreationTokens: z.number().int().nonnegative(),
  cacheReadTokens: z.number().int().nonnegative(),
  totalTokens: z.number().int().nonnegative(),
  totalCost: z.number().nonnegative(),
  lastActivity: z.string(),
  modelsUsed: z.array(z.string()),
  modelBreakdowns: z.array(ModelBreakdownSchema),
});

/**
 * ccusage block data schema
 */
export const BlockUsageSchema = z.object({
  id: z.string(),
  startTime: z.string(),
  endTime: z.string(),
  actualEndTime: z.string().nullable(),
  isActive: z.boolean(),
  isGap: z.boolean(),
  entries: z.number().int().nonnegative(),
  tokenCounts: z.object({
    inputTokens: z.number().int().nonnegative(),
    outputTokens: z.number().int().nonnegative(),
    cacheCreationInputTokens: z.number().int().nonnegative(),
    cacheReadInputTokens: z.number().int().nonnegative(),
  }),
  totalTokens: z.number().int().nonnegative(),
  costUSD: z.number().nonnegative(),
  models: z.array(z.string()),
  usageLimitResetTime: z.string().nullable(),
  burnRate: z.union([
    z.number(),
    z.object({
      costPerHour: z.number(),
    }),
  ]).nullable(),
  projection: z.union([
    z.number(),
    z.object({
      totalCost: z.number(),
    }),
  ]).nullable(),
});

/**
 * Model breakdown schema
 */
export const ModelBreakdownSchema = z.object({
  modelName: z.string(),
  inputTokens: z.number().int().nonnegative(),
  outputTokens: z.number().int().nonnegative(),
  cacheCreationTokens: z.number().int().nonnegative(),
  cacheReadTokens: z.number().int().nonnegative(),
  cost: z.number().nonnegative(),
});

/**
 * Project daily data schema
 */
export const ProjectDailyUsageSchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  inputTokens: z.number().int().nonnegative(),
  outputTokens: z.number().int().nonnegative(),
  cacheCreationTokens: z.number().int().nonnegative(),
  cacheReadTokens: z.number().int().nonnegative(),
  totalTokens: z.number().int().nonnegative(),
  totalCost: z.number().nonnegative(),
  modelsUsed: z.array(z.string()),
  modelBreakdowns: z.array(ModelBreakdownSchema),
});

/**
 * ccusage response wrapper schemas
 * ccusage CLI wraps responses in objects
 */
export const CcusageDailyResponseSchema = z.object({
  daily: z.array(DailyUsageSchema),
  totals: z.object({
    totalCost: z.number(),
    totalTokens: z.number(),
  }).optional(),
});

export const CcusageMonthlyResponseSchema = z.object({
  monthly: z.array(MonthlyUsageSchema),
  totals: z.object({
    totalCost: z.number(),
    totalTokens: z.number(),
  }).optional(),
});

export const CcusageSessionResponseSchema = z.object({
  sessions: z.array(SessionUsageSchema),
  totals: z.object({
    totalCost: z.number(),
    totalTokens: z.number(),
  }).optional(),
});

export const CcusageBlocksResponseSchema = z.object({
  blocks: z.array(BlockUsageSchema),
});

export const CcusageProjectsResponseSchema = z.object({
  projects: z.record(z.string(), z.array(ProjectDailyUsageSchema)),
  totals: z.object({
    totalCost: z.number(),
    totalTokens: z.number(),
  }).optional(),
});

/**
 * OpenCode message schema
 */
export const OpenCodeMessageSchema = z.object({
  role: z.string(),
  model: z.string(),
  date: z.string(),
  sessionId: z.string().optional(),
  projectPath: z.string().optional(),
  usage: z.object({
    inputTokens: z.number().int().nonnegative(),
    outputTokens: z.number().int().nonnegative(),
    cacheCreationTokens: z.number().int().nonnegative(),
    cacheReadTokens: z.number().int().nonnegative(),
    costUSD: z.number().nonnegative(),
  }),
});

/**
 * TypeScript types derived from schemas
 */
export type DailyUsage = z.infer<typeof DailyUsageSchema>;
export type MonthlyUsage = z.infer<typeof MonthlyUsageSchema>;
export type SessionUsage = z.infer<typeof SessionUsageSchema>;
export type BlockUsage = z.infer<typeof BlockUsageSchema>;
export type ModelBreakdown = z.infer<typeof ModelBreakdownSchema>;
export type ProjectDailyUsage = z.infer<typeof ProjectDailyUsageSchema>;
export type OpenCodeMessage = z.infer<typeof OpenCodeMessageSchema>;

export type CcusageDailyResponse = z.infer<typeof CcusageDailyResponseSchema>;
export type CcusageMonthlyResponse = z.infer<typeof CcusageMonthlyResponseSchema>;
export type CcusageSessionResponse = z.infer<typeof CcusageSessionResponseSchema>;
export type CcusageBlocksResponse = z.infer<typeof CcusageBlocksResponseSchema>;
export type CcusageProjectsResponse = z.infer<typeof CcusageProjectsResponseSchema>;
