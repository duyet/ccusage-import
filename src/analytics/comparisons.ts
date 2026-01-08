/**
 * Comparison Analytics
 *
 * Period-over-period comparison functions for usage analytics.
 * Calculates trends, percentage changes, and cost projections.
 */

import type { DailyUsageRecord } from '../database/repositories.js';

/**
 * Row type alias for usage data
 */
export type UsageDailyRow = DailyUsageRecord;

/**
 * Period comparison result
 */
export interface PeriodComparison {
  metric: string;
  currentValue: number;
  previousValue: number;
  absoluteChange: number;
  percentageChange: number;
  trend: 'up' | 'down' | 'stable';
}

/**
 * Options for period comparison
 */
export interface ComparisonOptions {
  period1: { start: string; end: string };
  period2: { start: string; end: string };
  metrics: ('cost' | 'tokens' | 'requests')[];
}

/**
 * Trend analysis result
 */
export interface TrendAnalysis {
  trend: 'up' | 'down' | 'stable';
  slope: number;
  correlation: number;
}

/**
 * Cost projection result
 */
export interface CostProjection {
  projected: number;
  confidence: 'high' | 'medium' | 'low';
  method: 'linear' | 'exponential' | 'average';
  dataPoints: number;
}

/**
 * Model usage comparison result
 */
export interface ModelComparison {
  modelName: string;
  currentCost: number;
  previousCost: number;
  change: number;
  changePercent: number;
  trend: 'up' | 'down' | 'stable';
}

/**
 * Aggregated period data
 */
interface AggregatedPeriod {
  totalCost: number;
  totalTokens: number;
  totalRequests: number;
  days: number;
  averageCost: number;
  averageTokens: number;
}

/**
 * Compare two periods of daily usage data
 *
 * @param currentData - Current period data
 * @param previousData - Previous period data
 * @param options - Comparison options
 * @returns Array of period comparisons
 */
export function comparePeriods(
  currentData: UsageDailyRow[],
  previousData: UsageDailyRow[],
  options?: ComparisonOptions
): PeriodComparison[] {
  // Handle edge cases
  if (currentData.length === 0 || previousData.length === 0) {
    return [];
  }

  // Aggregate data for both periods
  const current = aggregatePeriod(currentData);
  const previous = aggregatePeriod(previousData);

  // Determine which metrics to compare
  const metrics = options?.metrics || ['cost', 'tokens', 'requests'];

  // Build comparison array
  const comparisons: PeriodComparison[] = [];

  for (const metric of metrics) {
    let currentValue: number;
    let previousValue: number;
    let metricName: string;

    switch (metric) {
      case 'cost':
        currentValue = current.totalCost;
        previousValue = previous.totalCost;
        metricName = 'Total Cost';
        break;
      case 'tokens':
        currentValue = current.totalTokens;
        previousValue = previous.totalTokens;
        metricName = 'Total Tokens';
        break;
      case 'requests':
        currentValue = current.totalRequests;
        previousValue = previous.totalRequests;
        metricName = 'Total Requests';
        break;
      default:
        continue;
    }

    const absoluteChange = currentValue - previousValue;
    const percentageChange = previousValue > 0
      ? (absoluteChange / previousValue) * 100
      : currentValue > 0 ? 100 : 0;

    const trend = determineTrend(percentageChange);

    comparisons.push({
      metric: metricName,
      currentValue,
      previousValue,
      absoluteChange,
      percentageChange: Math.round(percentageChange * 10) / 10,
      trend,
    });
  }

  // Add average daily comparisons
  comparisons.push({
    metric: 'Average Daily Cost',
    currentValue: current.averageCost,
    previousValue: previous.averageCost,
    absoluteChange: current.averageCost - previous.averageCost,
    percentageChange: previous.averageCost > 0
      ? Math.round(((current.averageCost - previous.averageCost) / previous.averageCost) * 1000) / 10
      : 0,
    trend: determineTrend(current.averageCost - previous.averageCost),
  });

  return comparisons;
}

/**
 * Calculate trend from time series data
 *
 * @param data - Array of daily usage rows
 * @param metric - Metric to analyze ('total_cost' or 'total_tokens')
 * @returns Trend analysis with slope and correlation
 */
export function calculateTrend(
  data: UsageDailyRow[],
  metric: 'total_cost' | 'total_tokens'
): TrendAnalysis {
  // Handle edge cases
  if (data.length < 2) {
    return {
      trend: 'stable',
      slope: 0,
      correlation: 0,
    };
  }

  // Extract values (sorted by date ascending)
  const sortedData = [...data].sort((a, b) =>
    new Date(a.date).getTime() - new Date(b.date).getTime()
  );

  const values = sortedData.map(d => d[metric]);
  const n = values.length;

  // Calculate linear regression
  const sumX = (n * (n - 1)) / 2; // 0, 1, 2, ..., n-1
  const sumY = values.reduce((a, b) => a + b, 0);
  const sumXY = values.reduce((sum, y, x) => sum + x * y, 0);
  const sumX2 = (n * (n - 1) * (2 * n - 1)) / 6;
  const sumY2 = values.reduce((sum, y) => sum + y * y, 0);

  const denominator = n * sumX2 - sumX * sumX;
  const slope = denominator !== 0 ? (n * sumXY - sumX * sumY) / denominator : 0;

  // Calculate correlation coefficient
  const numerator = n * sumXY - sumX * sumY;
  const denomX = Math.sqrt(n * sumX2 - sumX * sumX);
  const denomY = Math.sqrt(n * sumY2 - sumY * sumY);
  const correlation = denomX !== 0 && denomY !== 0 ? numerator / (denomX * denomY) : 0;

  // Determine trend based on slope and statistical significance
  const trend = determineTrendFromSlope(slope, correlation);

  return {
    trend,
    slope: Math.round(slope * 1000) / 1000,
    correlation: Math.round(correlation * 1000) / 1000,
  };
}

/**
 * Project future costs based on historical data
 *
 * @param historicalData - Array of historical daily usage rows
 * @param daysToProject - Number of days to project forward
 * @returns Cost projection with confidence level
 */
export function projectCost(
  historicalData: UsageDailyRow[],
  daysToProject: number
): CostProjection {
  // Handle edge cases
  if (historicalData.length < 3) {
    return {
      projected: 0,
      confidence: 'low',
      method: 'average',
      dataPoints: historicalData.length,
    };
  }

  // Sort by date ascending
  const sortedData = [...historicalData].sort((a, b) =>
    new Date(a.date).getTime() - new Date(b.date).getTime()
  );

  const values = sortedData.map(d => d.total_cost);
  const n = values.length;

  // Calculate trend
  const trend = calculateTrend(sortedData, 'total_cost');

  // Choose projection method based on data characteristics
  let projected: number;
  let method: CostProjection['method'];
  let confidence: CostProjection['confidence'];

  if (Math.abs(trend.correlation) > 0.7 && n >= 7) {
    // Strong correlation - use linear regression
    method = 'linear';
    const avgCost = values.reduce((a, b) => a + b, 0) / n;
    projected = avgCost + (trend.slope * (n + daysToProject - 1) / 2);
    confidence = Math.abs(trend.correlation) > 0.85 ? 'high' : 'medium';
  } else if (n >= 14) {
    // Enough data for moving average
    method = 'average';
    const recentValues = values.slice(-7); // Last 7 days
    const avgRecent = recentValues.reduce((a, b) => a + b, 0) / recentValues.length;
    projected = avgRecent * daysToProject;
    confidence = 'medium';
  } else {
    // Limited data - use simple average
    method = 'average';
    const avgCost = values.reduce((a, b) => a + b, 0) / n;
    projected = avgCost * daysToProject;
    confidence = 'low';
  }

  // Ensure non-negative projection
  projected = Math.max(0, Math.round(projected * 100) / 100);

  return {
    projected,
    confidence,
    method,
    dataPoints: n,
  };
}

/**
 * Compare model usage between two periods
 *
 * @param currentBreakdowns - Current period model breakdowns
 * @param previousBreakdowns - Previous period model breakdowns
 * @returns Array of model comparisons
 */
export function compareModels(
  currentBreakdowns: Array<{ model_name: string; cost: number }>,
  previousBreakdowns: Array<{ model_name: string; cost: number }>
): ModelComparison[] {
  // Create maps for easy lookup
  const currentMap = new Map(currentBreakdowns.map(b => [b.model_name, b.cost]));
  const previousMap = new Map(previousBreakdowns.map(b => [b.model_name, b.cost]));

  // Get all unique models
  const allModels = new Set([
    ...currentBreakdowns.map(b => b.model_name),
    ...previousBreakdowns.map(b => b.model_name),
  ]);

  // Build comparison array
  const comparisons: ModelComparison[] = [];

  for (const modelName of allModels) {
    const currentCost = currentMap.get(modelName) || 0;
    const previousCost = previousMap.get(modelName) || 0;

    const change = currentCost - previousCost;
    const changePercent = previousCost > 0
      ? (change / previousCost) * 100
      : currentCost > 0 ? 100 : 0;

    comparisons.push({
      modelName,
      currentCost,
      previousCost,
      change,
      changePercent: Math.round(changePercent * 10) / 10,
      trend: determineTrend(changePercent),
    });
  }

  // Sort by current cost descending
  return comparisons.sort((a, b) => b.currentCost - a.currentCost);
}

/**
 * Aggregate data for a period
 */
function aggregatePeriod(data: UsageDailyRow[]): AggregatedPeriod {
  const days = data.length;

  const totalCost = data.reduce((sum, row) => sum + row.total_cost, 0);
  const totalTokens = data.reduce((sum, row) => sum + row.total_tokens, 0);
  const totalRequests = data.reduce((sum, row) => sum + row.models_count, 0);

  return {
    totalCost,
    totalTokens,
    totalRequests,
    days,
    averageCost: days > 0 ? totalCost / days : 0,
    averageTokens: days > 0 ? totalTokens / days : 0,
  };
}

/**
 * Determine trend direction from percentage change
 */
function determineTrend(percentageChange: number): 'up' | 'down' | 'stable' {
  const threshold = 5; // 5% threshold for stable

  if (Math.abs(percentageChange) < threshold) {
    return 'stable';
  } else if (percentageChange > 0) {
    return 'up';
  } else {
    return 'down';
  }
}

/**
 * Determine trend from slope and correlation
 */
function determineTrendFromSlope(
  slope: number,
  correlation: number
): 'up' | 'down' | 'stable' {
  const significanceThreshold = 0.5; // Minimum correlation for significance
  const slopeThreshold = 0.01; // Minimum slope for trend

  if (Math.abs(correlation) < significanceThreshold) {
    return 'stable';
  }

  if (Math.abs(slope) < slopeThreshold) {
    return 'stable';
  }

  return slope > 0 ? 'up' : 'down';
}
