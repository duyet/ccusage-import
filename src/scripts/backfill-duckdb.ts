#!/usr/bin/env bun
/**
 * Backfill DuckDB/MotherDuck from ClickHouse
 *
 * Pulls ALL historical data from ClickHouse ccusage_events table
 * and writes to DuckDB (local or MotherDuck).
 */

import * as dotenv from 'dotenv';
dotenv.config();

import { CHClient } from '../database/client.js';
import { ClickHouseConfig } from '../config/clickhouse.js';
import { DuckDBSink } from '../sinks/duckdb.js';
import type { EventsSnapshotData } from '../pipeline/types.js';

const args = process.argv.slice(2);
const verbose = args.includes('--verbose') || args.includes('-v');
const duckdbPath = args.find(a => a.startsWith('--path='))?.split('=')[1] || process.env.DUCKDB_PATH || 'md:ccusage';

console.log(`Backfill: ClickHouse ccusage_events → ${duckdbPath}`);

const chConfig = ClickHouseConfig.fromEnv();
const client = new CHClient(chConfig);

// Read from ccusage_events table
const rows = await client.query<Record<string, unknown>>('SELECT * FROM ccusage_events');
await client.close();

console.log(`  ccusage_events: ${rows.length} rows`);

const data: EventsSnapshotData = { events: rows };

console.log(`\nWriting ${rows.length} rows to ${duckdbPath}...`);
const sink = new DuckDBSink({ dbPath: duckdbPath });
await sink.connect();
const result = await sink.write(data);
await sink.close();

console.log(`Done: ${Object.values(result.rowsWritten).reduce((a, b) => a + b, 0)} rows in ${result.durationMs}ms`);
for (const [table, count] of Object.entries(result.rowsWritten)) {
  console.log(`  ${table}: ${count}`);
}
