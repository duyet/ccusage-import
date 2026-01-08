/**
 * Statistics Dashboard Component
 *
 * Displays comprehensive import statistics in a clean, data-dense layout.
 * Shows costs, token usage, model rankings, and table record counts.
 */

import React from 'react';
import { Box, Text } from 'ink';
import { formatNumber, formatCost } from '../utils/formatting.js';
import type { ImportStats } from '../types/index.js';

interface StatisticsDashboardProps {
  stats: ImportStats;
}

export function StatisticsDashboard({ stats }: StatisticsDashboardProps) {
  // Calculate totals across all sources
  const totalCost = Object.values(stats.costBySource).reduce((sum, val) => sum + val, 0);
  const totalTokens = stats.tokenConsumption.total || 0;

  return (
    <Box flexDirection="column" gap={1}>
      {/* Header */}
      <Box borderBottom={true} borderColor="#333333" paddingBottom={1} marginBottom={1}>
        <Text bold color="#e5e7eb">
          ═════════════════════════════════════════════════════════════
        </Text>
        <Box marginTop={1}>
          <Text bold color="#fbbf24" dimColor>
            📊 IMPORT STATISTICS
          </Text>
        </Box>
        <Box marginTop={1}>
          <Text bold color="#e5e7eb">
            ═════════════════════════════════════════════════════════════
          </Text>
        </Box>
      </Box>

      {/* Table Record Counts */}
      <Box flexDirection="column" gap={1} marginBottom={1}>
        <Box>
          <Text bold color="#9ca3af">
            📈 Table Record Counts
          </Text>
        </Box>
        {renderTableCounts(stats.tableCounts)}
      </Box>

      {/* Cost Breakdown */}
      <Box flexDirection="column" gap={1} marginBottom={1}>
        <Box>
          <Text bold color="#9ca3af">
            💰 Cost Breakdown
          </Text>
        </Box>
        <Box marginLeft={2} flexDirection="column" gap={1}>
          {Object.entries(stats.costBySource).map(([source, cost]) => (
            <Box key={source}>
              <Box width={15}>
                <Text color="#d1d5db">
                  {source.charAt(0).toUpperCase() + source.slice(1)}:
                </Text>
              </Box>
              <Text color="#4ade80">{formatCost(cost)}</Text>
            </Box>
          ))}
          <Box marginTop={1}>
            <Box width={15}>
              <Text bold>Total:</Text>
            </Box>
            <Text bold color="#4ade80">{formatCost(totalCost)}</Text>
          </Box>
        </Box>
      </Box>

      {/* Token Consumption */}
      <Box flexDirection="column" gap={1} marginBottom={1}>
        <Box>
          <Text bold color="#9ca3af">
            🔢 Token Consumption
          </Text>
        </Box>
        <Box marginLeft={2} flexDirection="column" gap={1}>
          <Box>
            <Box width={20}>
              <Text dimColor>Input tokens:</Text>
            </Box>
            <Text color="#60a5fa">{formatNumber(stats.tokenConsumption.input || 0)}</Text>
          </Box>
          <Box>
            <Box width={20}>
              <Text dimColor>Output tokens:</Text>
            </Box>
            <Text color="#f472b6">{formatNumber(stats.tokenConsumption.output || 0)}</Text>
          </Box>
          <Box>
            <Box width={20}>
              <Text dimColor>Cache read:</Text>
            </Box>
            <Text color="#a78bfa">{formatNumber(stats.tokenConsumption.cacheRead || 0)}</Text>
          </Box>
          <Box>
            <Box width={20}>
              <Text dimColor>Cache creation:</Text>
            </Box>
            <Text color="#c084fc">{formatNumber(stats.tokenConsumption.cacheCreation || 0)}</Text>
          </Box>
          <Box marginTop={1}>
            <Box width={20}>
              <Text bold>Total tokens:</Text>
            </Box>
            <Text bold>{formatNumber(totalTokens)}</Text>
          </Box>
        </Box>
      </Box>

      {/* Model Rankings */}
      {stats.modelRankings && stats.modelRankings.length > 0 && (
        <Box flexDirection="column" gap={1} marginBottom={1}>
          <Box>
            <Text bold color="#9ca3af">
              🤖 Model Rankings (by Cost)
            </Text>
          </Box>
          <Box marginLeft={2} flexDirection="column" gap={1}>
            {stats.modelRankings.slice(0, 10).map((model, index) => (
              <Box key={model.modelName}>
                <Box width={3}>
                  <Text dimColor>{index + 1}.</Text>
                </Box>
                <Box width={35}>
                  <Text color="#d1d5db">{model.modelName}</Text>
                </Box>
                <Box width={12}>
                  <Text color="#4ade80">{formatCost(model.cost)}</Text>
                </Box>
                <Text dimColor>({formatNumber(model.totalTokens)} tokens)</Text>
              </Box>
            ))}
          </Box>
        </Box>
      )}

      {/* Active Blocks */}
      {stats.activeBlocks && stats.activeBlocks.length > 0 && (
        <Box flexDirection="column" gap={1}>
          <Box>
            <Text bold color="#9ca3af">
              ⏰ Active Billing Blocks ({stats.activeBlocks.length})
            </Text>
          </Box>
          <Box marginLeft={2} flexDirection="column" gap={1}>
            {stats.activeBlocks.slice(0, 5).map((block, index) => (
              <Box key={index}>
                <Text color="#fbbf24">●</Text>
                <Text dimColor> Ends: {block.endTime} | </Text>
                <Text color="#4ade80">{formatCost(block.cost)}</Text>
              </Box>
            ))}
          </Box>
        </Box>
      )}

      {/* Footer */}
      <Box marginTop={1} borderTop={true} borderColor="#333333" paddingTop={1}>
        <Text bold color="#e5e7eb">
          ═════════════════════════════════════════════════════════════
        </Text>
      </Box>
    </Box>
  );
}

// Helper to render table counts
function renderTableCounts(counts: Record<string, number | Record<string, number>>) {
  const tableNames: Record<string, string> = {
    ccusage_usage_daily: 'Daily Usage',
    ccusage_usage_monthly: 'Monthly Usage',
    ccusage_usage_sessions: 'Sessions',
    ccusage_usage_blocks: 'Billing Blocks',
    ccusage_usage_projects_daily: 'Project Daily',
    ccusage_model_breakdowns: 'Model Breakdowns',
    ccusage_models_used: 'Models Used',
  };

  return (
    <Box marginLeft={2} flexDirection="column" gap={1}>
      {Object.entries(counts).map(([table, value]) => {
        const count = typeof value === 'number' ? value : Object.values(value).reduce((a, b) => a + b, 0);
        const displayName = tableNames[table] || table.replace('ccusage_', '');

        return (
          <Box key={table}>
            <Box width={20}>
              <Text color="#d1d5db">{displayName}:</Text>
            </Box>
            <Text color="#60a5fa">{formatNumber(count)}</Text>
          </Box>
        );
      })}
    </Box>
  );
}
