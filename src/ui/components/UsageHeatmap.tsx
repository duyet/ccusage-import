/**
 * Usage Heatmap Component
 *
 * GitHub-style contribution heatmap showing usage intensity over time.
 * Displays 7-day columns x 24-hour rows grid with intensity characters.
 *
 * Intensity levels:
 * - Level 0: ░ (no data)
 * - Level 1: ░ (very light)
 * - Level 2: ▒ (light)
 * - Level 3: ▓ (medium)
 * - Level 4: █ (dark)
 * - Level 5: █ (very dark)
 */

import React, { useMemo } from 'react';
import { Box, Text } from 'ink';
import type { DailyUsageData } from '../types/index.js';

interface UsageHeatmapProps {
  /** Array of daily usage data with timestamps and values */
  dailyData: DailyUsageData[];
  /** Number of days to display (default: 7) */
  days?: number;
  /** Number of hours to display (default: 24) */
  hours?: number;
  /** Show legend (default: true) */
  showLegend?: boolean;
  /** Custom title */
  title?: string;
}

// Intensity characters mapping (6 levels including no data)
const INTENSITY_CHARS: Record<number, string> = {
  0: '░', // No data
  1: '░', // Very light
  2: '▒', // Light
  3: '▓', // Medium
  4: '█', // Dark
  5: '█', // Very dark
};

// Color for each intensity level (GitHub green theme)
const INTENSITY_COLORS: Record<number, string> = {
  0: '#1a1a1a', // No data - dark gray
  1: '#0e4429', // Very light - dark green
  2: '#006d32', // Light - green
  3: '#26a641', // Medium - bright green
  4: '#39d353', // Dark - very bright green
  5: '#4ade80', // Very dark - neon green
};

interface HeatmapCell {
  hour: number;
  day: number;
  intensity: number;
  value: number;
  date: string;
}

export function UsageHeatmap({
  dailyData,
  days = 7,
  hours = 24,
  showLegend = true,
  title = 'Usage Heatmap',
}: UsageHeatmapProps) {
  // Build heatmap grid
  const heatmapGrid = useMemo(() => {
    return buildHeatmapGrid(dailyData, days, hours);
  }, [dailyData, days, hours]);

  // Calculate max value for normalization
  const maxValue = useMemo(() => {
    let max = 0;
    for (const cell of heatmapGrid.flat()) {
      if (cell.value > max) max = cell.value;
    }
    return max;
  }, [heatmapGrid]);

  // Day labels (last N days)
  const dayLabels = useMemo(() => {
    const labels: string[] = [];
    const today = new Date();
    for (let i = days - 1; i >= 0; i--) {
      const date = new Date(today);
      date.setDate(date.getDate() - i);
      const dayName = date.toLocaleDateString('en-US', { weekday: 'short' });
      labels.push(dayName);
    }
    return labels;
  }, [days]);

  // Hour labels (0-23)
  const hourLabels = useMemo(() => {
    return Array.from({ length: hours }, (_, i) => {
      return i.toString().padStart(2, '0');
    });
  }, [hours]);

  return (
    <Box flexDirection="column" gap={1} marginTop={1}>
      {/* Header */}
      <Box>
        <Text bold color="#9ca3af">
          📊 {title}
        </Text>
      </Box>

      {/* Legend */}
      {showLegend && (
        <Box marginLeft={2}>
          <Text dimColor>Less</Text>
          <Box marginLeft={1}>
            {Object.entries(INTENSITY_CHARS).map(([level, char]) => (
              <Text key={level} color={INTENSITY_COLORS[parseInt(level)]}>
                {char}
              </Text>
            ))}
          </Box>
          <Text marginLeft={1} dimColor>
            More
          </Text>
        </Box>
      )}

      {/* Heatmap grid with labels */}
      <Box flexDirection="column" marginLeft={2}>
        {/* Column headers (days) */}
        <Box marginBottom={1}>
          <Box width={3}>
            {/* Empty corner */}
          </Box>
          {dayLabels.map((day, i) => (
            <Box key={i} width={3} justifyContent="center">
              <Text dimColor color="#6b7280">
                {day.slice(0, 2)}
              </Text>
            </Box>
          ))}
        </Box>

        {/* Rows (hours) */}
        {heatmapGrid.map((row, hourIndex) => (
          <Box key={hourIndex}>
            {/* Row label (hour) */}
            <Box width={3}>
              <Text dimColor color="#6b7280">
                {hourLabels[hourIndex]}
              </Text>
            </Box>

            {/* Cells (days) */}
            {row.map((cell, dayIndex) => {
              const intensity = cell.value > 0
                ? calculateIntensity(cell.value, maxValue)
                : 0;

              return (
                <Box key={dayIndex} width={3} justifyContent="center">
                  <Text color={INTENSITY_COLORS[intensity]}>
                    {INTENSITY_CHARS[intensity]}
                  </Text>
                </Box>
              );
            })}
          </Box>
        ))}
      </Box>

      {/* Statistics */}
      <Box marginLeft={2} marginTop={1}>
        <Text dimColor>
          Max: ${maxValue.toFixed(2)} | Days: {days} | Hours: {hours}
        </Text>
      </Box>
    </Box>
  );
}

/**
 * Build heatmap grid from daily usage data
 * Returns a 2D array [hours][days] of HeatmapCell
 */
function buildHeatmapGrid(
  dailyData: DailyUsageData[],
  days: number,
  hours: number
): HeatmapCell[][] {
  // Create date -> value mapping
  const dateMap = new Map<string, number>();
  for (const record of dailyData) {
    if (record.date && record.totalCost !== undefined) {
      dateMap.set(record.date, record.totalCost);
    }
  }

  // Initialize grid with empty cells
  const grid: HeatmapCell[][] = Array.from({ length: hours }, (_, hour) =>
    Array.from({ length: days }, (_, day) => ({
      hour,
      day,
      intensity: 0,
      value: 0,
      date: '',
    }))
  );

  // Fill grid with data
  const today = new Date();
  today.setHours(23, 59, 59, 999); // End of today

  for (let dayOffset = 0; dayOffset < days; dayOffset++) {
    const date = new Date(today);
    date.setDate(date.getDate() - (days - 1 - dayOffset));
    date.setHours(0, 0, 0, 0);

    const dateStr = date.toISOString().split('T')[0];
    const value = dateMap.get(dateStr) || 0;

    // Distribute daily value across all hours (simplified)
    for (let hour = 0; hour < hours; hour++) {
      grid[hour][dayOffset] = {
        hour,
        day: dayOffset,
        intensity: 0,
        value: value / hours, // Distribute evenly
        date: dateStr,
      };
    }
  }

  return grid;
}

/**
 * Calculate intensity level (1-5) based on value and max value
 */
function calculateIntensity(value: number, maxValue: number): number {
  if (maxValue === 0 || value === 0) return 0;

  const ratio = value / maxValue;
  const intensity = Math.ceil(ratio * 5);

  return Math.min(intensity, 5);
}

/**
 * Get intensity character for a level
 */
export function getIntensityChar(level: number): string {
  return INTENSITY_CHARS[level] || '░';
}

/**
 * Get intensity color for a level
 */
export function getIntensityColor(level: number): string {
  return INTENSITY_COLORS[level] || '#1a1a1a';
}
