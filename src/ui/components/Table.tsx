/**
 * Table Component
 *
 * Clean, minimal table component for displaying database records.
 * Supports custom column rendering and automatic width calculation.
 */

import React, { useMemo } from 'react';
import { Box, Text } from 'ink';

export interface Column<T> {
  key: string;
  header: string;
  width: number;
  align?: 'left' | 'right' | 'center';
  render?: (value: any, row: T) => React.ReactNode;
}

interface TableProps<T> {
  columns: Column<T>[];
  data: T[];
  emptyMessage?: string;
  maxHeight?: number;
}

export function Table<T>({
  columns,
  data,
  emptyMessage = 'No data available',
  maxHeight,
}: TableProps<T>) {
  // Render header
  const renderHeader = () => {
    return (
      <Box borderBottom={true} borderColor="#333333">
        {columns.map((col) => (
          <Box
            key={col.key}
            width={col.width}
            paddingRight={1}
            justifyContent={col.align === 'right' ? 'flex-end' : col.align === 'center' ? 'center' : 'flex-start'}
          >
            <Text bold color="#9ca3af">
              {col.header}
            </Text>
          </Box>
        ))}
      </Box>
    );
  };

  // Render row
  const renderRow = (row: T, index: number) => {
    return (
      <Box key={index} borderBottom={index < data.length - 1} borderColor="#1a1a1a">
        {columns.map((col) => {
          const value = (row as any)[col.key];
          const content = col.render ? col.render(value, row) : formatValue(value);

          return (
            <Box
              key={col.key}
              width={col.width}
              paddingRight={1}
              justifyContent={col.align === 'right' ? 'flex-end' : col.align === 'center' ? 'center' : 'flex-start'}
            >
              <Text color="#d1d5db">{content}</Text>
            </Box>
          );
        })}
      </Box>
    );
  };

  // Format value for display
  const formatValue = (value: any): string => {
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
  };

  // Empty state
  if (data.length === 0) {
    return (
      <Box flexDirection="column">
        {renderHeader()}
        <Box paddingY={1}>
          <Text dimColor>{emptyMessage}</Text>
        </Box>
      </Box>
    );
  }

  // Render with optional height limit
  const displayData = maxHeight ? data.slice(0, maxHeight) : data;
  const hasMore = maxHeight && data.length > maxHeight;

  return (
    <Box flexDirection="column">
      {renderHeader()}
      {displayData.map((row, index) => renderRow(row, index))}
      {hasMore && (
        <Box paddingY={1}>
          <Text dimColor>... and {data.length - maxHeight} more rows</Text>
        </Box>
      )}
    </Box>
  );
}
