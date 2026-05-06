#!/usr/bin/env bun
/**
 * Migrate: Old 7 Tables → Single ccusage_events Table
 *
 * Reads from old ClickHouse tables, joins model_breakdowns,
 * writes flat event rows to ccusage_events in ClickHouse and DuckDB.
 */

import * as dotenv from 'dotenv';
dotenv.config();

import { CHClient } from '../database/client.js';
import { ClickHouseConfig } from '../config/clickhouse.js';
import { DuckDBSink } from '../sinks/duckdb.js';
import type { EventsSnapshotData } from '../pipeline/types.js';

const args = process.argv.slice(2);
const verbose = args.includes('--verbose') || args.includes('-v');
const skipDuckdb = args.includes('--skip-duckdb');
const duckdbPath = args.find(a => a.startsWith('--path='))?.split('=')[1] || process.env.DUCKDB_PATH || 'md:ccusage';

console.log('Migration: Old 7 tables → ccusage_events');

const chConfig = ClickHouseConfig.fromEnv();
const client = new CHClient(chConfig);

// Ensure ccusage_events table exists
await client.command(
  "CREATE TABLE IF NOT EXISTS ccusage_events (date Date, record_type String, record_key String, source String DEFAULT 'ccusage', machine_name String, model_name String DEFAULT '', session_id String DEFAULT '', project_path String DEFAULT '', input_tokens UInt64 DEFAULT 0, output_tokens UInt64 DEFAULT 0, cache_creation_tokens UInt64 DEFAULT 0, cache_read_tokens UInt64 DEFAULT 0, total_tokens UInt64 DEFAULT 0, cost Float64 DEFAULT 0, block_id String DEFAULT '', start_time Nullable(DateTime), end_time Nullable(DateTime), actual_end_time Nullable(DateTime), is_active UInt8 DEFAULT 0, is_gap UInt8 DEFAULT 0, entries UInt32 DEFAULT 0, burn_rate Nullable(Float64), created_at DateTime DEFAULT now(), updated_at DateTime DEFAULT now()) ENGINE = ReplacingMergeTree(updated_at) PARTITION BY toYYYYMM(date) ORDER BY (source, machine_name, record_type, date, model_name, record_key)"
);
try { await client.command('ALTER TABLE ccusage_events ADD COLUMN projection Nullable(Float64) AFTER burn_rate'); } catch {}
try { await client.command('ALTER TABLE ccusage_events ADD COLUMN usage_limit_reset_time Nullable(DateTime) AFTER projection'); } catch {}

const now = new Date().toISOString().replace('T', ' ').replace(/\.\d+Z$/, '');
const events: Record<string, unknown>[] = [];

// Helper: build event rows with model breakdowns from a joined query
function buildEventsWithModels(
  rows: any[],
  recordType: string,
  breakdowns: any[],
  extraFields: (row: any) => Record<string, unknown>
): void {
  // Build breakdown lookup: record_key → model breakdowns
  const bdMap = new Map<string, any[]>();
  for (const bd of breakdowns) {
    const key = bd.record_key;
    if (!bdMap.has(key)) bdMap.set(key, []);
    bdMap.get(key)!.push(bd);
  }

  for (const row of rows) {
    const recordKey = extraFields(row).record_key as string;
    const modelBDs = bdMap.get(recordKey) ?? [];

    if (modelBDs.length > 0) {
      for (const bd of modelBDs) {
        events.push({
          date: row.date ?? row.last_activity,
          record_type: recordType,
          record_key: recordKey,
          source: row.source ?? 'ccusage',
          machine_name: row.machine_name,
          model_name: bd.model_name ?? '',
          input_tokens: bd.input_tokens ?? 0,
          output_tokens: bd.output_tokens ?? 0,
          cache_creation_tokens: bd.cache_creation_tokens ?? 0,
          cache_read_tokens: bd.cache_read_tokens ?? 0,
          total_tokens: (bd.input_tokens ?? 0) + (bd.output_tokens ?? 0) + (bd.cache_creation_tokens ?? 0) + (bd.cache_read_tokens ?? 0),
          cost: bd.cost ?? 0,
          ...extraFields(row),
          created_at: now,
          updated_at: now,
        });
      }
    } else {
      // No model breakdown — emit single row
      events.push({
        date: row.date ?? row.last_activity,
        record_type: recordType,
        record_key: recordKey,
        source: row.source ?? 'ccusage',
        machine_name: row.machine_name,
        model_name: row.modelsUsed?.[0] ?? 'unknown',
        input_tokens: row.input_tokens ?? 0,
        output_tokens: row.output_tokens ?? 0,
        cache_creation_tokens: row.cache_creation_tokens ?? 0,
        cache_read_tokens: row.cache_read_tokens ?? 0,
        total_tokens: row.total_tokens ?? 0,
        cost: row.total_cost ?? row.cost_usd ?? 0,
        ...extraFields(row),
        created_at: now,
        updated_at: now,
      });
    }
  }
}

// 1. Daily + model breakdowns
if (verbose) console.log('Reading ccusage_usage_daily...');
const daily = await client.query<any>('SELECT * FROM ccusage_usage_daily');
const dailyBD = await client.query<any>("SELECT * FROM ccusage_model_breakdowns WHERE record_type = 'daily'");
buildEventsWithModels(daily, 'daily', dailyBD, (row) => ({
  record_key: row.date,
  session_id: '', project_path: '',
  block_id: '', start_time: null, end_time: null, actual_end_time: null,
  is_active: 0, is_gap: 0, entries: 0,
  burn_rate: null, projection: null, usage_limit_reset_time: null,
}));
if (verbose) console.log(`  daily: ${daily.length} records → ${events.length} events so far`);

// 2. Sessions + model breakdowns
// NOTE: old Python importer had inconsistent column swaps:
//   Some rows: machine_name = "34cfcaf1" (hashed project path), project_path = "duyet.local" (hostname) → SWAPPED
//   Some rows: machine_name = "duyet.local" (hostname), project_path = "34cfcaf1" (hashed project) → CORRECT
//   Bad rows: machine_name = "Unknown Project" → definitely swapped
// Heuristic: if machine_name is 8-char hex or "Unknown Project" → swap project_path and machine_name
if (verbose) console.log('Reading ccusage_usage_sessions...');
const sessionCountBefore = events.length;
const sessions = await client.query<any>('SELECT * FROM ccusage_usage_sessions');
const sessionBD = await client.query<any>("SELECT * FROM ccusage_model_breakdowns WHERE record_type = 'session'");
buildEventsWithModels(sessions, 'session', sessionBD, (row) => {
  // Fix swapped columns: if machine_name looks like a project path (hash or "Unknown Project"),
  // then project_path and machine_name were swapped
  const mn = String(row.machine_name ?? '');
  const isSwapped = (/^[0-9a-f]{8}$/.test(mn) || mn === 'Unknown Project');
  const realMachineName = isSwapped ? row.project_path : mn;
  const realProjectPath = isSwapped ? mn : row.project_path;
  return {
    record_key: row.session_id,
    date: row.last_activity,
    session_id: row.session_id,
    project_path: realProjectPath,
    machine_name: realMachineName,
    block_id: '', start_time: null, end_time: null, actual_end_time: null,
    is_active: 0, is_gap: 0, entries: 0,
    burn_rate: null, projection: null, usage_limit_reset_time: null,
  };
});
if (verbose) console.log(`  sessions: ${sessions.length} records → ${events.length - sessionCountBefore} events`);

// 3. Blocks (no model breakdowns)
if (verbose) console.log('Reading ccusage_usage_blocks...');
const blockCountBefore = events.length;
const blocks = await client.query<any>('SELECT * FROM ccusage_usage_blocks');
for (const row of blocks) {
  events.push({
    date: row.start_time?.toString().split(' ')[0] ?? row.date,
    record_type: 'block',
    record_key: row.block_id,
    source: row.source ?? 'ccusage',
    machine_name: row.machine_name,
    model_name: '',
    session_id: '', project_path: '',
    input_tokens: row.input_tokens ?? 0,
    output_tokens: row.output_tokens ?? 0,
    cache_creation_tokens: row.cache_creation_tokens ?? 0,
    cache_read_tokens: row.cache_read_tokens ?? 0,
    total_tokens: row.total_tokens ?? 0,
    cost: row.cost_usd ?? 0,
    block_id: row.block_id,
    start_time: row.start_time,
    end_time: row.end_time,
    actual_end_time: row.actual_end_time,
    is_active: row.is_active ?? 0,
    is_gap: row.is_gap ?? 0,
    entries: row.entries ?? 0,
    burn_rate: row.burn_rate,
    projection: row.projection,
    usage_limit_reset_time: row.usage_limit_reset_time,
    created_at: now,
    updated_at: now,
  });
}
if (verbose) console.log(`  blocks: ${blocks.length} records → ${events.length - blockCountBefore} events`);

// 4. Projects daily + model breakdowns
// NOTE: old Python importer had swapped columns:
//   project_id column → contains machine_name (hostname like "duyet.local")
//   machine_name column → contains project path (like "-Users-duet-project-...")
// model_breakdowns record_key format: "date_projectpath" (underscore separator)
if (verbose) console.log('Reading ccusage_usage_projects_daily...');
const projectCountBefore = events.length;
const projects = await client.query<any>('SELECT * FROM ccusage_usage_projects_daily');
const projectBD = await client.query<any>("SELECT * FROM ccusage_model_breakdowns WHERE record_type = 'project_daily'");
buildEventsWithModels(projects, 'project_daily', projectBD, (row) => ({
  record_key: `${row.date}_${row.machine_name}`,
  project_path: row.machine_name,
  session_id: '',
  block_id: '', start_time: null, end_time: null, actual_end_time: null,
  is_active: 0, is_gap: 0, entries: 0,
  burn_rate: null, projection: null, usage_limit_reset_time: null,
}));
if (verbose) console.log(`  projects_daily: ${projects.length} records → ${events.length - projectCountBefore} events`);

await client.close();

console.log(`\nTotal: ${events.length} event rows from migration`);

// Write to ClickHouse ccusage_events
console.log('\nWriting to ClickHouse ccusage_events...');
const chClient2 = new CHClient(chConfig);

// Delete all existing rows (full replacement)
await chClient2.command('ALTER TABLE ccusage_events DELETE WHERE 1=1');

// Insert in batches
const BATCH_SIZE = 10_000;
for (let i = 0; i < events.length; i += BATCH_SIZE) {
  const batch = events.slice(i, i + BATCH_SIZE);
  await chClient2.insert('ccusage_events', batch);
  if (verbose) console.log(`  inserted ${Math.min(i + BATCH_SIZE, events.length)} / ${events.length}`);
}
await chClient2.close();
console.log(`  ClickHouse: ${events.length} rows written`);

// Write to DuckDB/MotherDuck
if (!skipDuckdb && duckdbPath) {
  console.log(`\nWriting to ${duckdbPath}...`);
  const sink = new DuckDBSink({ dbPath: duckdbPath });
  await sink.connect();
  const data: EventsSnapshotData = { events };
  const result = await sink.write(data);
  await sink.close();
  console.log(`  ${duckdbPath}: ${Object.values(result.rowsWritten).reduce((a, b) => a + b, 0)} rows in ${result.durationMs}ms`);
}

console.log('\nMigration complete!');
