import React, { FC, useMemo } from 'react';
import { Box, Text } from 'ink';

export interface BarData {
  label: string;      // e.g., "claude-3-5-sonnet", "GPT-4"
  value: number;      // e.g., 12.50 (cost), 1500000 (tokens)
  color?: string;     // Optional custom color
}

export interface BarChartProps {
  title?: string;
  data: BarData[];
  maxValue?: number;  // Auto-scale if not provided
  barWidth?: number;  // Max bar width (default: 40)
  unit?: string;      // e.g., "$", "tokens", "cost"
  showValues?: boolean;
  colorScale?: 'green' | 'blue' | 'cost' | 'tokens';
}

const BAR_CHARS = {
  full: '█',
  threeQuarter: '▓',
  half: '▒',
  quarter: '░',
  empty: ' ',
};

/**
 * Get color based on value and color scale
 */
const getColor = (value: number, maxValue: number, scale: BarChartProps['colorScale']): string => {
  const ratio = value / maxValue;

  if (scale === 'cost') {
    if (ratio < 0.3) return 'gray';
    if (ratio < 0.6) return 'yellow';
    if (ratio < 0.8) return 'cyan';
    return 'red';
  }

  if (scale === 'tokens') {
    if (ratio < 0.3) return 'gray';
    if (ratio < 0.6) return 'blue';
    if (ratio < 0.8) return 'cyan';
    return 'green';
  }

  if (scale === 'green') {
    if (ratio < 0.25) return 'gray';
    if (ratio < 0.5) return 'green';
    if (ratio < 0.75) return 'cyan';
    return 'white';
  }

  // Default blue scale
  if (ratio < 0.25) return 'gray';
  if (ratio < 0.5) return 'blue';
  if (ratio < 0.75) return 'cyan';
  return 'magenta';
};

/**
 * Format number with K/M/B suffixes
 */
const formatNumber = (num: number): string => {
  if (num >= 1_000_000_000) {
    return `${(num / 1_000_000_000).toFixed(1)}B`;
  }
  if (num >= 1_000_000) {
    return `${(num / 1_000_000).toFixed(1)}M`;
  }
  if (num >= 1_000) {
    return `${(num / 1_000).toFixed(1)}K`;
  }
  return num.toFixed(1);
};

/**
 * Generate bar string based on ratio
 */
const generateBar = (ratio: number, width: number): string => {
  const filledWidth = Math.round(ratio * width);
  const decimalWidth = (ratio * width) - filledWidth;

  let bar = '';
  for (let i = 0; i < width; i++) {
    if (i < filledWidth) {
      bar += BAR_CHARS.full;
    } else if (i === filledWidth) {
      if (decimalWidth >= 0.75) {
        bar += BAR_CHARS.threeQuarter;
      } else if (decimalWidth >= 0.5) {
        bar += BAR_CHARS.half;
      } else if (decimalWidth >= 0.25) {
        bar += BAR_CHARS.quarter;
      } else {
        bar += BAR_CHARS.empty;
      }
    } else {
      bar += BAR_CHARS.empty;
    }
  }

  return bar;
};

/**
 * BarChart component for ASCII horizontal bar charts
 *
 * @example
 * ```tsx
 * <BarChart
 *   title="Model Costs"
 *   data={[
 *     { label: "claude-3-5-sonnet", value: 12.50 },
 *     { label: "GPT-4", value: 8.30 },
 *   ]}
 *   unit="$"
 *   colorScale="cost"
 * />
 * ```
 */
export const BarChart: FC<BarChartProps> = ({
  title,
  data,
  maxValue: propMaxValue,
  barWidth = 40,
  unit = '',
  showValues = true,
  colorScale = 'blue',
}) => {
  // Calculate max value if not provided
  const maxValue = useMemo(() => {
    if (propMaxValue !== undefined) {
      return propMaxValue;
    }
    return Math.max(...data.map(d => d.value));
  }, [data, propMaxValue]);

  // Find maximum label width for alignment
  const maxLabelWidth = useMemo(() => {
    return Math.max(...data.map(d => d.label.length));
  }, [data]);

  return (
    <Box flexDirection="column">
      {title && (
        <Box marginBottom={1}>
          <Text bold>{title}</Text>
        </Box>
      )}

      {data.map((item, index) => {
        const ratio = item.value / maxValue;
        const bar = generateBar(ratio, barWidth);
        const color = item.color || getColor(item.value, maxValue, colorScale);
        const formattedValue = unit ? `${unit}${formatNumber(item.value)}` : formatNumber(item.value);

        return (
          <Box key={index} marginBottom={index < data.length - 1 ? 1 : 0}>
            {/* Label */}
            <Box width={maxLabelWidth + 1} paddingRight={1}>
              <Text>{item.label}</Text>
            </Box>

            {/* Bar */}
            <Box>
              <Text color={color}>{bar}</Text>
            </Box>

            {/* Value */}
            {showValues && (
              <Box marginLeft={1} width={12}>
                <Text bold>{formattedValue}</Text>
              </Box>
            )}
          </Box>
        );
      })}

      {/* Legend */}
      <Box marginTop={1}>
        <Text dimColor>
          Scale: 0{unit} ── {formatNumber(maxValue)}{unit}
        </Text>
      </Box>
    </Box>
  );
};

export default BarChart;
