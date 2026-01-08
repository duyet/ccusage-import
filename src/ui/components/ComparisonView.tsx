/**
 * ComparisonView Component
 *
 * Displays period-over-period comparison of usage metrics with side-by-side comparison,
 * percentage change indicators, and highlights for significant changes.
 */

import React, { useMemo } from 'react';
import { Box, Text } from 'ink';
import { DataTable, Column } from './DataTable';
import { formatNumber, formatCost } from '../utils/formatting';

/**
 * Comparison data for a single metric
 */
export interface ComparisonData {
  metric: string;           // e.g., "Total Cost", "Input Tokens"
  period1Value: number;     // Value in period 1
  period2Value: number;     // Value in period 2
  unit?: string;            // e.g., "$", "tokens"
}

/**
 * Props for ComparisonView component
 */
export interface ComparisonViewProps {
  title?: string;
  period1Label: string;     // e.g., "This Week"
  period2Label: string;     // e.g., "Last Week"
  data: ComparisonData[];
  showPercentageChange?: boolean;
  threshold?: number;       // Highlight changes above this % (default: 20)
}

/**
 * Calculate percentage change between two values
 */
function calculatePercentageChange(oldValue: number, newValue: number): number {
  if (oldValue === 0) {
    return newValue > 0 ? 100 : 0;
  }
  return ((newValue - oldValue) / oldValue) * 100;
}

/**
 * Get color and symbol for percentage change
 */
function getChangeIndicator(change: number, threshold: number): { symbol: string; color: string } {
  const absChange = Math.abs(change);

  if (absChange > threshold) {
    // Significant change - yellow highlight
    return {
      symbol: change > 0 ? '↑' : '↓',
      color: 'yellow'
    };
  }

  // Normal change - green for increase, red for decrease
  return {
    symbol: change > 0 ? '↑' : '↓',
    color: change > 0 ? 'green' : 'red'
  };
}

/**
 * Format value with unit
 */
function formatValue(value: number, unit?: string): string {
  if (unit === '$') {
    return formatCost(value);
  }

  const formatted = formatNumber(value);

  if (unit) {
    return `${formatted} ${unit}`;
  }

  return formatted;
}

/**
 * Extended row data with calculated change information
 */
interface ComparisonRow extends ComparisonData {
  period1Formatted: string;
  period2Formatted: string;
  changePercent: number;
  changeSymbol: string;
  changeColor: string;
  changeFormatted: string;
  isHighlighted: boolean;
}

/**
 * ComparisonView Component
 *
 * Displays a comparison table between two time periods with percentage changes
 * and visual indicators for significant changes.
 *
 * @example
 * ```tsx
 * <ComparisonView
 *   title="Weekly Usage Comparison"
 *   period1Label="This Week"
 *   period2Label="Last Week"
 *   data={[
 *     { metric: "Total Cost", period1Value: 125.50, period2Value: 100.00, unit: "$" },
 *     { metric: "Input Tokens", period1Value: 1500000, period2Value: 1200000, unit: "tokens" },
 *   ]}
 *   threshold={20}
 * />
 * ```
 */
export function ComparisonView({
  title,
  period1Label,
  period2Label,
  data,
  showPercentageChange = true,
  threshold = 20,
}: ComparisonViewProps) {
  // Process data and calculate changes
  const rows = useMemo<ComparisonRow[]>(() => {
    return data.map((item) => {
      const changePercent = calculatePercentageChange(item.period2Value, item.period1Value);
      const { symbol, color } = getChangeIndicator(changePercent, threshold);
      const isHighlighted = Math.abs(changePercent) > threshold;

      return {
        ...item,
        period1Formatted: formatValue(item.period1Value, item.unit),
        period2Formatted: formatValue(item.period2Value, item.unit),
        changePercent,
        changeSymbol: symbol,
        changeColor: color,
        changeFormatted: `${Math.abs(changePercent).toFixed(1)}%`,
        isHighlighted,
      };
    });
  }, [data, threshold]);

  // Calculate summary totals
  const summary = useMemo(() => {
    const totalPeriod1 = data.reduce((sum, item) => sum + item.period1Value, 0);
    const totalPeriod2 = data.reduce((sum, item) => sum + item.period2Value, 0);
    const changePercent = calculatePercentageChange(totalPeriod2, totalPeriod1);

    return {
      period1Total: totalPeriod1,
      period2Total: totalPeriod2,
      changePercent,
    };
  }, [data]);

  // Define table columns
  const columns: Column<ComparisonRow>[] = [
    { key: 'metric', label: 'Metric', width: 20 },
    { key: 'period2Formatted', label: period2Label, align: 'right', width: 15 },
    { key: 'period1Formatted', label: period1Label, align: 'right', width: 15 },
  ];

  if (showPercentageChange) {
    columns.push({
      key: 'changeFormatted',
      label: 'Change',
      align: 'right',
      width: 12,
    });
  }

  return (
    <Box flexDirection="column" flexGrow={1}>
      {title && (
        <Box marginBottom={1}>
          <Text bold color="#9ca3af">
            {title}
          </Text>
        </Box>
      )}

      <DataTable
        columns={columns}
        data={rows}
        showBorders={true}
        truncate={false}
      />

      {/* Summary row */}
      <Box marginTop={1}>
        <Text dimColor>
          ──────────────────────────────────────────────────────────────
        </Text>
      </Box>

      <Box marginTop={1}>
        <Box marginRight={4}>
          <Text dimColor>Total Change:</Text>
        </Box>
        <Text
          color={summary.changePercent > 0 ? 'green' : summary.changePercent < 0 ? 'red' : 'gray'}
        >
          {summary.changePercent > 0 ? '↑' : summary.changePercent < 0 ? '↓' : '→'}{' '}
          {Math.abs(summary.changePercent).toFixed(1)}%
        </Text>
        <Box marginLeft={2}>
          <Text dimColor>
            ({formatValue(summary.period2Total)} → {formatValue(summary.period1Total)})
          </Text>
        </Box>
      </Box>

      {/* Legend */}
      <Box marginTop={1}>
        <Text dimColor>
          Legend: <Text color="green">↑</Text> Increase <Text color="red">↓</Text> Decrease{' '}
          {threshold > 0 && (
            <Text color="yellow">Yellow</Text>
          )}
          {threshold > 0 && ` > ${threshold}% change`}
        </Text>
      </Box>
    </Box>
  );
}

/**
 * Create comparison data from raw data objects
 *
 * @example
 * ```tsx
 * const data = createComparisonData(
 *   [
 *     { total_cost: 100, input_tokens: 50000 },
 *     { total_cost: 125, input_tokens: 60000 }
 *   ],
 *   [
 *     'Total Cost',
 *     'Input Tokens'
 *   ],
 *   {
 *     'Total Cost': { unit: '$', key: 'total_cost' },
 *     'Input Tokens': { unit: 'tokens', key: 'input_tokens' }
 *   }
 * );
 * ```
 */
export function createComparisonData(
  period2Data: Record<string, number>[],
  period1Data: Record<string, number>[],
  metrics: string[],
  config: Record<string, { unit?: string; key?: string }>
): ComparisonData[] {
  const result: ComparisonData[] = [];

  for (const metric of metrics) {
    const cfg = config[metric] || { key: metric.toLowerCase().replace(/\s+/g, '_') };
    const key = cfg.key || metric.toLowerCase().replace(/\s+/g, '_');

    const period2Value = period2Data.reduce((sum, row) => sum + (row[key] || 0), 0);
    const period1Value = period1Data.reduce((sum, row) => sum + (row[key] || 0), 0);

    result.push({
      metric,
      period1Value,
      period2Value,
      unit: cfg.unit,
    });
  }

  return result;
}
