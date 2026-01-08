/**
 * Status Indicator Component
 *
 * Displays status with color-coded indicators.
 * Useful for showing connection status, health checks, etc.
 */

import React from 'react';
import { Box, Text } from 'ink';

export type Status = 'success' | 'warning' | 'error' | 'info' | 'loading';

interface StatusIndicatorProps {
  status: Status;
  label?: string;
  showText?: boolean;
}

const STATUS_CONFIG: Record<
  Status,
  { symbol: string; color: string; label: string }
> = {
  success: { symbol: '●', color: '#4ade80', label: 'OK' },
  warning: { symbol: '●', color: '#fbbf24', label: 'Warning' },
  error: { symbol: '●', color: '#ef4444', label: 'Error' },
  info: { symbol: '○', color: '#60a5fa', label: 'Info' },
  loading: { symbol: '◐', color: '#fbbf24', label: 'Loading' },
};

export function StatusIndicator({
  status,
  label,
  showText = true,
}: StatusIndicatorProps) {
  const config = STATUS_CONFIG[status];

  return (
    <Box>
      <Text color={config.color}>{config.symbol}</Text>
      {showText && (
        <>
          {' '}
          <Text color={config.color}>{label || config.label}</Text>
        </>
      )}
    </Box>
  );
}

// Predefined status components for common use cases
export function ConnectedStatus({ label }: { label?: string }) {
  return <StatusIndicator status="success" label={label || 'Connected'} />;
}

export function DisconnectedStatus({ label }: { label?: string }) {
  return <StatusIndicator status="error" label={label || 'Disconnected'} />;
}

export function LoadingStatus({ label }: { label?: string }) {
  return <StatusIndicator status="loading" label={label || 'Loading'} />;
}
