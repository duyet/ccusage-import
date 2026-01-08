/**
 * Data Export Module
 *
 * Exports usage data and statistics in multiple formats (JSON, CSV, Markdown)
 */

import * as fs from 'node:fs/promises';
import { type DailyUsageRecord, type ModelRanking } from '../database/repositories.js';

// ============================================================================
// Type Definitions
// ============================================================================

/**
 * Export format options
 */
export type ExportFormat = 'json' | 'csv' | 'markdown';

/**
 * Export options interface
 */
export interface ExportOptions {
  /** Output format */
  format: ExportFormat;
  /** Optional file path to write output */
  outputPath?: string;
  /** Optional date range filter */
  dateRange?: {
    /** Start date in YYYY-MM-DD format */
    start: string;
    /** End date in YYYY-MM-DD format (optional) */
    end?: string;
  };
  /** Optional table name filter for statistics */
  includeTables?: string[];
}

/**
 * Statistics summary interface
 */
export interface Statistics {
  /** Table record counts */
  tableCounts: Record<string, number>;
  /** Total cost across all data */
  totalCost: number;
  /** Total tokens across all data */
  totalTokens: number;
  /** Input token count */
  inputTokens?: number;
  /** Output token count */
  outputTokens?: number;
  /** Cache read token count */
  cacheReadTokens?: number;
  /** Model rankings by cost */
  modelRankings?: ModelRanking[];
  /** Export timestamp */
  exportedAt?: string;
}

/**
 * Daily usage row for export (alias for repository type)
 */
export type DailyUsageRow = DailyUsageRecord;

// ============================================================================
// JSON Export
// ============================================================================

/**
 * Export data as formatted JSON string
 */
function exportAsJSON(data: unknown): string {
  return JSON.stringify(data, null, 2);
}

// ============================================================================
// CSV Export
// ============================================================================

/**
 * Escape a CSV field value according to RFC 4180
 */
function escapeCSVField(value: unknown): string {
  if (value === null || value === undefined) {
    return '';
  }

  const strValue = String(value);

  // If field contains comma, quote, or newline, wrap in quotes and escape quotes
  if (strValue.includes(',') || strValue.includes('"') || strValue.includes('\n')) {
    return `"${strValue.replace(/"/g, '""')}"`;
  }

  return strValue;
}

/**
 * Convert array of objects to CSV string
 */
function exportAsCSV<T extends Record<string, unknown>>(
  data: T[],
  columns?: (keyof T)[]
): string {
  if (data.length === 0) {
    return '';
  }

  // Determine columns to export
  const keys = columns || (Object.keys(data[0]) as Array<keyof T>);

  // Create header row
  const header = keys.map(String).map(escapeCSVField).join(',');

  // Create data rows
  const rows = data.map(item => {
    return keys.map(key => escapeCSVField(item[key])).join(',');
  });

  return [header, ...rows].join('\n');
}

/**
 * Export statistics as CSV
 */
function exportStatisticsAsCSV(stats: Statistics): string {
  const rows = [
    { metric: 'Total Cost', value: stats.totalCost.toFixed(2) },
    { metric: 'Total Tokens', value: stats.totalTokens.toLocaleString() },
    { metric: 'Input Tokens', value: stats.inputTokens?.toLocaleString() || 'N/A' },
    { metric: 'Output Tokens', value: stats.outputTokens?.toLocaleString() || 'N/A' },
    { metric: 'Cache Read Tokens', value: stats.cacheReadTokens?.toLocaleString() || 'N/A' },
    { metric: 'Exported At', value: stats.exportedAt || new Date().toISOString() },
  ];

  // Add table counts
  Object.entries(stats.tableCounts).forEach(([table, count]) => {
    rows.push({ metric: `Table: ${table}`, value: count.toLocaleString() });
  });

  return exportAsCSV(rows);
}

// ============================================================================
// Markdown Export
// ============================================================================

/**
 * Convert array of objects to Markdown table
 */
function exportAsMarkdownTable<T extends Record<string, unknown>>(
  data: T[],
  columns?: (keyof T)[]
): string {
  if (data.length === 0) {
    return '| *No data* |\n|-------|';
  }

  // Determine columns to export
  const keys = columns || (Object.keys(data[0]) as Array<keyof T>);

  // Create header row
  const header = '| ' + keys.map(String).join(' | ') + ' |';
  const separator = '|' + keys.map(() => '---').join('|') + '|';

  // Create data rows
  const rows = data.map(item => {
    const values = keys.map(key => {
      const value = item[key];
      if (value === null || value === undefined) return '-';
      if (typeof value === 'number') {
        // Format numbers with commas for thousands
        return value.toLocaleString();
      }
      return String(value);
    });
    return '| ' + values.join(' | ') + ' |';
  });

  return [header, separator, ...rows].join('\n');
}

/**
 * Export statistics as Markdown table
 */
function exportStatisticsAsMarkdown(stats: Statistics): string {
  const sections: string[] = [];

  // Summary section
  sections.push('## Usage Statistics Summary\n');
  sections.push('| Metric | Value |');
  sections.push('|--------|-------|');
  sections.push(`| Total Cost | $${stats.totalCost.toFixed(2)} |`);
  sections.push(`| Total Tokens | ${stats.totalTokens.toLocaleString()} |`);

  if (stats.inputTokens !== undefined) {
    sections.push(`| Input Tokens | ${stats.inputTokens.toLocaleString()} |`);
  }
  if (stats.outputTokens !== undefined) {
    sections.push(`| Output Tokens | ${stats.outputTokens.toLocaleString()} |`);
  }
  if (stats.cacheReadTokens !== undefined) {
    sections.push(`| Cache Read Tokens | ${stats.cacheReadTokens.toLocaleString()} |`);
  }

  if (stats.exportedAt) {
    sections.push(`| Exported At | ${stats.exportedAt} |`);
  }

  sections.push('');

  // Table counts section
  if (Object.keys(stats.tableCounts).length > 0) {
    sections.push('## Table Record Counts\n');
    sections.push('| Table | Records |');
    sections.push('|-------|---------|');

    Object.entries(stats.tableCounts).forEach(([table, count]) => {
      sections.push(`| ${table} | ${count.toLocaleString()} |`);
    });

    sections.push('');
  }

  // Model rankings section
  if (stats.modelRankings && stats.modelRankings.length > 0) {
    sections.push('## Top Models by Cost\n');
    sections.push('| Rank | Model | Cost | Tokens |');
    sections.push('|------|-------|------|--------|');

    stats.modelRankings.forEach((model, index) => {
      sections.push(
        `| ${index + 1} | ${model.model_name} | $${model.total_cost.toFixed(2)} | ${model.total_tokens.toLocaleString()} |`
      );
    });

    sections.push('');
  }

  return sections.join('\n');
}

// ============================================================================
// Date Filtering
// ============================================================================

/**
 * Filter daily data by date range
 */
function filterByDateRange<T extends { date: string }>(
  data: T[],
  dateRange?: ExportOptions['dateRange']
): T[] {
  if (!dateRange) {
    return data;
  }

  const start = new Date(dateRange.start);
  const end = dateRange.end ? new Date(dateRange.end) : new Date();

  return data.filter(item => {
    const itemDate = new Date(item.date);
    return itemDate >= start && itemDate <= end;
  });
}

// ============================================================================
// File Output
// ============================================================================

/**
 * Write content to file if output path is provided
 */
async function writeToFile(content: string, outputPath: string): Promise<void> {
  try {
    await fs.writeFile(outputPath, content, 'utf-8');
  } catch (error) {
    throw new Error(`Failed to write to ${outputPath}: ${error instanceof Error ? error.message : String(error)}`);
  }
}

// ============================================================================
// Main Export Functions
// ============================================================================

/**
 * Export statistics in the specified format
 *
 * @param stats - Statistics object to export
 * @param options - Export options
 * @returns Exported data as string
 */
export async function exportStatistics(
  stats: Statistics,
  options: ExportOptions
): Promise<string> {
  // Add export timestamp if not present
  if (!stats.exportedAt) {
    stats.exportedAt = new Date().toISOString();
  }

  let output: string;

  switch (options.format) {
    case 'json':
      output = exportAsJSON(stats);
      break;
    case 'csv':
      output = exportStatisticsAsCSV(stats);
      break;
    case 'markdown':
      output = exportStatisticsAsMarkdown(stats);
      break;
    default:
      throw new Error(`Unsupported export format: ${options.format}`);
  }

  // Write to file if output path provided
  if (options.outputPath) {
    await writeToFile(output, options.outputPath);
  }

  return output;
}

/**
 * Export daily usage data in the specified format
 *
 * @param dailyData - Array of daily usage records
 * @param options - Export options
 * @returns Exported data as string
 */
export async function exportDailyData(
  dailyData: DailyUsageRow[],
  options: ExportOptions
): Promise<string> {
  // Filter by date range if provided
  const filteredData = filterByDateRange(dailyData, options.dateRange);

  // Filter by specific columns if needed (exclude internal fields)
  const columns: (keyof DailyUsageRow)[] = [
    'date',
    'machine_name',
    'input_tokens',
    'output_tokens',
    'cache_creation_tokens',
    'cache_read_tokens',
    'total_tokens',
    'total_cost',
    'models_count',
  ];

  let output: string;

  switch (options.format) {
    case 'json':
      output = exportAsJSON(filteredData);
      break;
    case 'csv':
      output = exportAsCSV(filteredData as Record<string, unknown>[], columns as string[]);
      break;
    case 'markdown':
      output = exportAsMarkdownTable(filteredData as Record<string, unknown>[], columns as string[]);
      break;
    default:
      throw new Error(`Unsupported export format: ${options.format}`);
  }

  // Write to file if output path provided
  if (options.outputPath) {
    await writeToFile(output, options.outputPath);
  }

  return output;
}

/**
 * Export model rankings in the specified format
 *
 * @param rankings - Array of model ranking records
 * @param options - Export options
 * @returns Exported data as string
 */
export async function exportModelRankings(
  rankings: ModelRanking[],
  options: ExportOptions
): Promise<string> {
  let output: string;

  switch (options.format) {
    case 'json':
      output = exportAsJSON(rankings);
      break;
    case 'csv':
      output = exportAsCSV(rankings as Record<string, unknown>[]);
      break;
    case 'markdown':
      output = exportAsMarkdownTable(rankings as Record<string, unknown>[]);
      break;
    default:
      throw new Error(`Unsupported export format: ${options.format}`);
  }

  // Write to file if output path provided
  if (options.outputPath) {
    await writeToFile(output, options.outputPath);
  }

  return output;
}

/**
 * Export any tabular data in the specified format
 *
 * Generic export function for any array of record objects
 *
 * @param data - Array of records to export
 * @param options - Export options
 * @returns Exported data as string
 */
export async function exportData<T extends Record<string, unknown>>(
  data: T[],
  options: ExportOptions
): Promise<string> {
  let output: string;

  switch (options.format) {
    case 'json':
      output = exportAsJSON(data);
      break;
    case 'csv':
      output = exportAsCSV(data);
      break;
    case 'markdown':
      output = exportAsMarkdownTable(data);
      break;
    default:
      throw new Error(`Unsupported export format: ${options.format}`);
  }

  // Write to file if output path provided
  if (options.outputPath) {
    await writeToFile(output, options.outputPath);
  }

  return output;
}

// ============================================================================
// Utility Functions
// ============================================================================

/**
 * Get file extension for export format
 */
export function getExportFileExtension(format: ExportFormat): string {
  switch (format) {
    case 'json':
      return '.json';
    case 'csv':
      return '.csv';
    case 'markdown':
      return '.md';
  }
}

/**
 * Validate export options
 */
export function validateExportOptions(options: ExportOptions): void {
  if (!['json', 'csv', 'markdown'].includes(options.format)) {
    throw new Error(`Invalid export format: ${options.format}`);
  }

  if (options.dateRange) {
    const startDate = new Date(options.dateRange.start);
    if (isNaN(startDate.getTime())) {
      throw new Error(`Invalid start date: ${options.dateRange.start}`);
    }

    if (options.dateRange.end) {
      const endDate = new Date(options.dateRange.end);
      if (isNaN(endDate.getTime())) {
        throw new Error(`Invalid end date: ${options.dateRange.end}`);
      }

      if (endDate < startDate) {
        throw new Error('End date must be after start date');
      }
    }
  }
}
