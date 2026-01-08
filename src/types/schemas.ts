/**
 * Zod schemas for runtime validation of all external data
 * (ccusage CLI responses, OpenCode messages, etc.)
 */

import { z } from 'zod';

// ============================================================================
// Base Schemas
// ============================================================================

/**
 * Date string in ISO format (YYYY-MM-DD)
 */
export const DateStringSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, {
  message: 'Invalid date format, expected YYYY-MM-DD',
});

/**
 * DateTime string in ISO format (YYYY-MM-DDTHH:MM:SS.sssZ)
 */
export const DateTimeStringSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/, {
  message: 'Invalid datetime format, expected ISO 8601',
});

/**
 * Token counts (common across all data types)
 */
export const TokenCountsSchema = z.object({
  inputTokens: z.number().int().nonnegative(),
  outputTokens: z.number().int().nonnegative(),
  cacheCreationTokens: z.number().int().nonnegative().optional().default(0),
  cacheReadTokens: z.number().int().nonnegative().optional().default(0),
  totalTokens: z.number().int().nonnegative(),
});

// ============================================================================
// ccusage Daily Data
// ============================================================================

export const CcusageDailySchema = z.object({
  date: DateStringSchema,
  inputTokens: z.number().int().nonnegative(),
  outputTokens: z.number().int().nonnegative(),
  cacheCreationTokens: z.number().int().nonnegative().optional().default(0),
  cacheReadTokens: z.number().int().nonnegative().optional().default(0),
  totalTokens: z.number().int().nonnegative(),
  totalCost: z.number().nonnegative(),
  models: z.array(z.string()),
  source: z.literal('ccusage').optional().default('ccusage'),
});

export type CcusageDaily = z.infer<typeof CcusageDailySchema>;

/**
 * ccusage daily response wrapper
 */
export const CcusageDailyResponseSchema = z.object({
  daily: z.array(CcusageDailySchema),
  totals: z.object({
    totalCost: z.number().nonnegative(),
    totalTokens: z.number().int().nonnegative(),
  }).optional(),
});

export type CcusageDailyResponse = z.infer<typeof CcusageDailyResponseSchema>;

// ============================================================================
// ccusage Monthly Data
// ============================================================================

export const CcusageMonthlySchema = z.object({
  year: z.number().int().min(2000).max(2100),
  month: z.number().int().min(1).max(12),
  inputTokens: z.number().int().nonnegative(),
  outputTokens: z.number().int().nonnegative(),
  cacheCreationTokens: z.number().int().nonnegative().optional().default(0),
  cacheReadTokens: z.number().int().nonnegative().optional().default(0),
  totalTokens: z.number().int().nonnegative(),
  totalCost: z.number().nonnegative(),
  models: z.array(z.string()),
  source: z.literal('ccusage').optional().default('ccusage'),
});

export type CcusageMonthly = z.infer<typeof CcusageMonthlySchema>;

/**
 * ccusage monthly response wrapper
 */
export const CcusageMonthlyResponseSchema = z.object({
  monthly: z.array(CcusageMonthlySchema),
  totals: z.object({
    totalCost: z.number().nonnegative(),
    totalTokens: z.number().int().nonnegative(),
  }).optional(),
});

export type CcusageMonthlyResponse = z.infer<typeof CcusageMonthlyResponseSchema>;

// ============================================================================
// ccusage Session Data
// ============================================================================

export const CcusageSessionSchema = z.object({
  sessionId: z.string(),
  projectPath: z.string(),
  inputTokens: z.number().int().nonnegative(),
  outputTokens: z.number().int().nonnegative(),
  cacheCreationTokens: z.number().int().nonnegative().optional().default(0),
  cacheReadTokens: z.number().int().nonnegative().optional().default(0),
  totalTokens: z.number().int().nonnegative(),
  totalCost: z.number().nonnegative(),
  lastActivity: DateStringSchema,
  modelsUsed: z.array(z.string()),
  source: z.literal('ccusage').optional().default('ccusage'),
});

export type CcusageSession = z.infer<typeof CcusageSessionSchema>;

/**
 * ccusage session response wrapper (note: "sessions" key is plural)
 */
export const CcusageSessionResponseSchema = z.object({
  sessions: z.array(CcusageSessionSchema),
  totals: z.object({
    totalCost: z.number().nonnegative(),
    totalTokens: z.number().int().nonnegative(),
  }).optional(),
});

export type CcusageSessionResponse = z.infer<typeof CcusageSessionResponseSchema>;

// ============================================================================
// ccusage Blocks Data
// ============================================================================

/**
 * Burn rate can be a number or an object with costPerHour
 */
export const BurnRateSchema = z.union([
  z.number().nonnegative(),
  z.object({
    costPerHour: z.number().nonnegative(),
  }),
]);

/**
 * Projection can be a number or an object with totalCost
 */
export const ProjectionSchema = z.union([
  z.number().nonnegative(),
  z.object({
    totalCost: z.number().nonnegative(),
  }),
]);

export const CcusageBlockSchema = z.object({
  id: z.string(),
  startTime: DateTimeStringSchema,
  endTime: DateTimeStringSchema,
  actualEndTime: DateTimeStringSchema.optional().nullable(),
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
  usageLimitResetTime: DateTimeStringSchema.optional().nullable(),
  burnRate: BurnRateSchema.optional().nullable(),
  projection: ProjectionSchema.optional().nullable(),
  source: z.literal('ccusage').optional().default('ccusage'),
});

export type CcusageBlock = z.infer<typeof CcusageBlockSchema>;

/**
 * ccusage blocks response wrapper
 */
export const CcusageBlocksResponseSchema = z.object({
  blocks: z.array(CcusageBlockSchema),
});

export type CcusageBlocksResponse = z.infer<typeof CcusageBlocksResponseSchema>;

// ============================================================================
// ccusage Project Daily Data
// ============================================================================

export const CcusageProjectDailySchema = z.object({
  date: DateStringSchema,
  projectPath: z.string(),
  inputTokens: z.number().int().nonnegative(),
  outputTokens: z.number().int().nonnegative(),
  cacheCreationTokens: z.number().int().nonnegative().optional().default(0),
  cacheReadTokens: z.number().int().nonnegative().optional().default(0),
  totalTokens: z.number().int().nonnegative(),
  totalCost: z.number().nonnegative(),
  modelsUsed: z.array(z.string()),
  source: z.literal('ccusage').optional().default('ccusage'),
});

export type CcusageProjectDaily = z.infer<typeof CcusageProjectDailySchema>;

/**
 * ccusage projects response wrapper
 */
export const CcusageProjectsResponseSchema = z.object({
  projects: z.array(CcusageProjectDailySchema),
  totals: z.object({
    totalCost: z.number().nonnegative(),
    totalTokens: z.number().int().nonnegative(),
  }).optional(),
});

export type CcusageProjectsResponse = z.infer<typeof CcusageProjectsResponseSchema>;

// ============================================================================
// Combined ccusage Response
// ============================================================================

/**
 * All ccusage data fetched in parallel
 */
export const CcusageAllDataSchema = z.object({
  daily: CcusageDailyResponseSchema.optional(),
  monthly: CcusageMonthlyResponseSchema.optional(),
  session: CcusageSessionResponseSchema.optional(),
  blocks: CcusageBlocksResponseSchema.optional(),
  projects: CcusageProjectsResponseSchema.optional(),
});

export type CcusageAllData = z.infer<typeof CcusageAllDataSchema>;

// ============================================================================
// OpenCode Message Data
// ============================================================================

/**
 * OpenCode message (single API interaction)
 */
export const OpenCodeMessageSchema = z.object({
  role: z.enum(['user', 'assistant', 'system']),
  content: z.string(),
  timestamp: DateTimeStringSchema.optional(),
  model: z.string().optional(),
  tokens: z.object({
    input: z.number().int().nonnegative().optional(),
    output: z.number().int().nonnegative().optional(),
    total: z.number().int().nonnegative().optional(),
  }).optional(),
  metadata: z.record(z.unknown()).optional(),
});

export type OpenCodeMessage = z.infer<typeof OpenCodeMessageSchema>;

// ============================================================================
// ClickHouse Row Schemas
// ============================================================================

/**
 * ccusage_usage_daily table row
 */
export const UsageDailyRowSchema = z.object({
  date: DateStringSchema,
  source: z.string().default('ccusage'),
  machine_name: z.string(),
  input_tokens: z.number().int().nonnegative(),
  output_tokens: z.number().int().nonnegative(),
  cache_creation_tokens: z.number().int().nonnegative(),
  cache_read_tokens: z.number().int().nonnegative(),
  total_tokens: z.number().int().nonnegative(),
  total_cost: z.number().nonnegative(),
  models_count: z.number().int().nonnegative(),
  created_at: DateTimeStringSchema.optional(),
  updated_at: DateTimeStringSchema.optional(),
});

export type UsageDailyRow = z.infer<typeof UsageDailyRowSchema>;

/**
 * ccusage_usage_sessions table row
 */
export const UsageSessionRowSchema = z.object({
  session_id: z.string(),
  project_path: z.string(),
  machine_name: z.string(),
  input_tokens: z.number().int().nonnegative(),
  output_tokens: z.number().int().nonnegative(),
  cache_creation_tokens: z.number().int().nonnegative(),
  cache_read_tokens: z.number().int().nonnegative(),
  total_tokens: z.number().int().nonnegative(),
  total_cost: z.number().nonnegative(),
  last_activity: DateStringSchema,
  models_count: z.number().int().nonnegative(),
  created_at: DateTimeStringSchema.optional(),
  updated_at: DateTimeStringSchema.optional(),
  source: z.string().default('ccusage'),
});

export type UsageSessionRow = z.infer<typeof UsageSessionRowSchema>;

/**
 * ccusage_usage_blocks table row
 */
export const UsageBlocksRowSchema = z.object({
  block_id: z.string(),
  machine_name: z.string(),
  start_time: DateTimeStringSchema,
  end_time: DateTimeStringSchema,
  actual_end_time: DateTimeStringSchema.optional().nullable(),
  is_active: z.number().int().min(0).max(1),
  is_gap: z.number().int().min(0).max(1),
  entries: z.number().int().nonnegative(),
  input_tokens: z.number().int().nonnegative(),
  output_tokens: z.number().int().nonnegative(),
  cache_creation_tokens: z.number().int().nonnegative(),
  cache_read_tokens: z.number().int().nonnegative(),
  total_tokens: z.number().int().nonnegative(),
  cost_usd: z.number().nonnegative(),
  models_count: z.number().int().nonnegative(),
  created_at: DateTimeStringSchema.optional(),
  updated_at: DateTimeStringSchema.optional(),
  usage_limit_reset_time: DateTimeStringSchema.optional().nullable(),
  burn_rate: z.number().nonnegative().optional().nullable(),
  projection: z.number().nonnegative().optional().nullable(),
  source: z.string().default('ccusage'),
});

export type UsageBlocksRow = z.infer<typeof UsageBlocksRowSchema>;

// ============================================================================
// Utility Types
// ============================================================================

/**
 * Record type for model breakdowns table
 */
export const RecordTypeEnum = z.enum(['daily', 'monthly', 'session', 'block', 'project_daily'], {
  errorMap: () => ({ message: 'Invalid record type' }),
});

export type RecordType = z.infer<typeof RecordTypeEnum>;

/**
 * Model breakdown row
 */
export const ModelBreakdownRowSchema = z.object({
  record_type: RecordTypeEnum,
  record_key: z.string(),
  machine_name: z.string(),
  model_name: z.string(),
  input_tokens: z.number().int().nonnegative(),
  output_tokens: z.number().int().nonnegative(),
  cache_creation_tokens: z.number().int().nonnegative(),
  cache_read_tokens: z.number().int().nonnegative(),
  cost: z.number().nonnegative(),
  created_at: DateTimeStringSchema.optional(),
});

export type ModelBreakdownRow = z.infer<typeof ModelBreakdownRowSchema>;

/**
 * Models used row
 */
export const ModelsUsedRowSchema = z.object({
  record_type: RecordTypeEnum,
  record_key: z.string(),
  machine_name: z.string(),
  model_name: z.string(),
  created_at: DateTimeStringSchema.optional(),
});

export type ModelsUsedRow = z.infer<typeof ModelsUsedRowSchema>;
