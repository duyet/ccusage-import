/**
 * DataTable Component
 *
 * Reusable table component with box drawing borders for CLI display.
 * Supports custom columns, alignment, text truncation, and auto-width calculation.
 * Uses Unicode box drawing characters (┌─┐┬│└┘├┤) for traditional terminal table appearance.
 */

import React, { useMemo } from 'react';
import { Box, Text } from 'ink';

export interface Column<T> {
  key: string;
  label: string;
  width?: number;
  align?: 'left' | 'right' | 'center';
}

export interface DataTableProps<T> {
  columns: Column<T>[];
  data: T[];
  showBorders?: boolean;
  emptyMessage?: string;
  truncate?: boolean;
  maxWidth?: number;
}

type TextAlign = 'left' | 'right' | 'center';

// Box drawing characters
const BORDERS = {
  topLeft: '┌',
  topRight: '┐',
  bottomLeft: '└',
  bottomRight: '┘',
  horizontal: '─',
  vertical: '│',
  topCross: '┬',
  bottomCross: '┴',
  leftCross: '├',
  rightCross: '┤',
  cross: '┼',
} as const;

/**
 * Calculate column widths based on content and headers
 */
function calculateColumnWidths<T>(
  columns: Column<T>[],
  data: T[],
  maxWidth: number = 80
): number[] {
  const widths: number[] = [];

  for (const col of columns) {
    if (col.width) {
      widths.push(col.width);
      continue;
    }

    // Find maximum content width for this column
    let maxLen = col.label.length;

    for (const row of data) {
      const value = (row as any)[col.key];
      const strValue = formatValue(value);
      maxLen = Math.max(maxLen, strValue.length);
    }

    // Add padding
    const paddedWidth = maxLen + 2;
    widths.push(Math.min(paddedWidth, maxWidth));
  }

  return widths;
}

/**
 * Format value for display
 */
function formatValue(value: unknown): string {
  if (value === null || value === undefined) {
    return '—';
  }
  if (typeof value === 'number') {
    return value.toLocaleString();
  }
  if (typeof value === 'boolean') {
    return value ? '✓' : '✗';
  }
  return String(value);
}

/**
 * Truncate text to fit width
 */
function truncateText(text: string, width: number, align: TextAlign = 'left'): string {
  if (text.length <= width) {
    return padText(text, width, align);
  }

  const ellipsis = '…';
  const truncated = text.substring(0, width - ellipsis.length) + ellipsis;
  return truncated.padEnd(width);
}

/**
 * Pad text to fit width with alignment
 */
function padText(text: string, width: number, align: TextAlign = 'left'): string {
  if (text.length >= width) {
    return text.substring(0, width);
  }

  switch (align) {
    case 'center':
      const leftPad = Math.floor((width - text.length) / 2);
      const rightPad = width - text.length - leftPad;
      return ' '.repeat(leftPad) + text + ' '.repeat(rightPad);
    case 'right':
      return ' '.repeat(width - text.length) + text;
    default:
      return text + ' '.repeat(width - text.length);
  }
}

/**
 * Build border line with crossings
 */
function buildBorderLine(
  widths: number[],
  left: string,
  middle: string,
  right: string,
  separator: string
): string {
  const parts = widths.map((w) => BORDERS.horizontal.repeat(w + 2));
  return left + parts.join(separator) + right;
}

/**
 * Build data row with borders and aligned content
 */
function buildDataRow<T>(
  row: T,
  columns: Column<T>[],
  widths: number[],
  truncate: boolean
): string {
  const cells = columns.map((col, idx) => {
    const value = (row as any)[col.key];
    const strValue = formatValue(value);
    const cellWidth = widths[idx];
    const align = col.align || 'left';

    const content = truncate
      ? truncateText(strValue, cellWidth, align)
      : padText(strValue, cellWidth, align);

    return ` ${content} `;
  });

  return BORDERS.vertical + cells.join(BORDERS.vertical) + BORDERS.vertical;
}

/**
 * DataTable Component
 *
 * Renders a table with box drawing borders for CLI display.
 *
 * @example
 * ```tsx
 * <DataTable
 *   columns={[
 *     { key: 'name', label: 'Name', width: 20 },
 *     { key: 'count', label: 'Count', align: 'right' },
 *     { key: 'cost', label: 'Cost', align: 'right' }
 *   ]}
 *   data={[{ name: 'Project A', count: 100, cost: 5.50 }]}
 *   showBorders={true}
 * />
 * ```
 */
export function DataTable<T extends Record<string, unknown>>({
  columns,
  data,
  showBorders = true,
  emptyMessage = 'No data available',
  truncate = true,
  maxWidth = 80,
}: DataTableProps<T>) {
  const calculatedWidths = useMemo(
    () => calculateColumnWidths(columns, data, maxWidth),
    [columns, data, maxWidth]
  );

  // Empty state
  if (data.length === 0) {
    return (
      <Box flexDirection="column">
        {showBorders && (
          <>
            <Box>
              <Text dimColor>{buildEmptyTable(columns, emptyMessage)}</Text>
            </Box>
          </>
        )}
        {!showBorders && (
          <Box>
            <Text dimColor>{emptyMessage}</Text>
          </Box>
        )}
      </Box>
    );
  }

  // Render table with borders
  if (showBorders) {
    const topBorder = buildBorderLine(
      calculatedWidths,
      BORDERS.topLeft,
      BORDERS.topCross,
      BORDERS.topRight,
      BORDERS.horizontal
    );

    const headerBorder = buildBorderLine(
      calculatedWidths,
      BORDERS.leftCross,
      BORDERS.cross,
      BORDERS.rightCross,
      BORDERS.horizontal
    );

    const bottomBorder = buildBorderLine(
      calculatedWidths,
      BORDERS.bottomLeft,
      BORDERS.bottomCross,
      BORDERS.bottomRight,
      BORDERS.horizontal
    );

    // Build header row
    const headerCells = columns.map((col, idx) => {
      const content = padText(col.label, calculatedWidths[idx], col.align);
      return ` ${content} `;
    });
    const headerRow = BORDERS.vertical + headerCells.join(BORDERS.vertical) + BORDERS.vertical;

    return (
      <Box flexDirection="column">
        <Box>
          <Text dimColor>{topBorder}</Text>
        </Box>
        <Box>
          <Text bold color="#9ca3af">
            {headerRow}
          </Text>
        </Box>
        <Box>
          <Text dimColor>{headerBorder}</Text>
        </Box>
        {data.map((row, index) => (
          <Box key={index}>
            <Text color="#d1d5db">{buildDataRow(row, columns, calculatedWidths, truncate)}</Text>
          </Box>
        ))}
        <Box>
          <Text dimColor>{bottomBorder}</Text>
        </Box>
      </Box>
    );
  }

  // Render table without borders (simple aligned columns)
  return (
    <Box flexDirection="column">
      {data.map((row, index) => (
        <Box key={index}>
          {columns.map((col, idx) => {
            const value = (row as any)[col.key];
            const strValue = formatValue(value);
            const width = calculatedWidths[idx];
            const align = col.align || 'left';

            return (
              <Box
                key={col.key}
                width={width + 2}
                justifyContent={
                  align === 'right' ? 'flex-end' : align === 'center' ? 'center' : 'flex-start'
                }
              >
                <Text color="#d1d5db">{strValue}</Text>
              </Box>
            );
          })}
        </Box>
      ))}
    </Box>
  );
}

/**
 * Build empty table display with borders
 */
function buildEmptyTable<T>(columns: Column<T>[], emptyMessage: string): string {
  const maxColWidth = Math.max(...columns.map((c) => c.label.length));
  const totalWidth = maxColWidth * columns.length + columns.length * 3 + 1;

  const topBorder = BORDERS.topLeft + BORDERS.horizontal.repeat(totalWidth - 2) + BORDERS.topRight;
  const middleBorder =
    BORDERS.leftCross + BORDERS.horizontal.repeat(totalWidth - 2) + BORDERS.rightCross;
  const bottomBorder =
    BORDERS.bottomLeft + BORDERS.horizontal.repeat(totalWidth - 2) + BORDERS.bottomRight;

  // Header cells
  const headerCells = columns.map((col) => {
    const content = padText(col.label, maxColWidth, 'left');
    return ` ${content} `;
  });
  const headerRow = BORDERS.vertical + headerCells.join(BORDERS.vertical) + BORDERS.vertical;

  // Empty message row
  const emptyContent = padText(emptyMessage, totalWidth - 2, 'center');
  const emptyRow = BORDERS.vertical + ' ' + emptyContent + ' ' + BORDERS.vertical;

  return [topBorder, headerRow, middleBorder, emptyRow, bottomBorder].join('\n');
}
