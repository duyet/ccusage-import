/**
 * DataTable Component Usage Examples
 *
 * This file demonstrates how to use the DataTable component
 * for various CLI table display scenarios.
 */

import React from 'react';
import { render } from 'ink';
import { DataTable } from './DataTable.js';
import type { Column } from './DataTable.js';

// Example 1: Simple table with automatic width calculation
interface ProjectData {
  name: string;
  status: string;
  cost: number;
  tokens: number;
}

const example1Columns: Column<ProjectData>[] = [
  { key: 'name', label: 'Project' },
  { key: 'status', label: 'Status', align: 'center' },
  { key: 'cost', label: 'Cost', align: 'right' },
  { key: 'tokens', label: 'Tokens', align: 'right' },
];

const example1Data: ProjectData[] = [
  { name: 'ccusage-import', status: 'Active', cost: 12.50, tokens: 1250000 },
  { name: 'my-app', status: 'Complete', cost: 8.25, tokens: 825000 },
  { name: 'api-service', status: 'Active', cost: 45.75, tokens: 4575000 },
];

// Example 2: Fixed-width columns with truncation
interface ModelUsage {
  model: string;
  usageCount: number;
  totalCost: number;
  avgCost: number;
}

const example2Columns: Column<ModelUsage>[] = [
  { key: 'model', label: 'Model', width: 30 },
  { key: 'usageCount', label: 'Count', width: 10, align: 'right' },
  { key: 'totalCost', label: 'Total Cost', width: 12, align: 'right' },
  { key: 'avgCost', label: 'Avg Cost', width: 10, align: 'right' },
];

const example2Data: ModelUsage[] = [
  {
    model: 'claude-3-5-sonnet-20241022',
    usageCount: 1234,
    totalCost: 123.45,
    avgCost: 0.10,
  },
  {
    model: 'claude-3-opus-20240229',
    usageCount: 567,
    totalCost: 234.56,
    avgCost: 0.41,
  },
];

// Example 3: Table without borders
interface QuickStat {
  metric: string;
  value: string;
}

const example3Columns: Column<QuickStat>[] = [
  { key: 'metric', label: 'Metric', width: 25 },
  { key: 'value', label: 'Value', width: 20, align: 'right' },
];

const example3Data: QuickStat[] = [
  { metric: 'Total Cost', value: '$234.56' },
  { metric: 'Total Tokens', value: '4.5M' },
  { metric: 'Active Sessions', value: '12' },
];

// Example 4: Empty table state
const example4Data: ProjectData[] = [];

/**
 * Demo Component showing all DataTable examples
 */
export function DataTableDemo() {
  return (
    <>
      {/* Example 1: Auto-width table with borders */}
      <DataTable columns={example1Columns} data={example1Data} showBorders={true} />

      {/* Example 2: Fixed-width with truncation */}
      <DataTable columns={example2Columns} data={example2Data} showBorders={true} truncate={true} />

      {/* Example 3: Without borders */}
      <DataTable columns={example3Columns} data={example3Data} showBorders={false} />

      {/* Example 4: Empty state */}
      <DataTable
        columns={example1Columns}
        data={example4Data}
        showBorders={true}
        emptyMessage="No projects found"
      />
    </>
  );
}

// Run demo if executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
  render(<DataTableDemo />);
}
