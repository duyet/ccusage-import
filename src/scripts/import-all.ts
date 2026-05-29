#!/usr/bin/env bun
/**
 * Full Import Script
 *
 * Plugin architecture: registers sources and sinks,
 * then runs the pipeline (fetch all → fanout to all sinks).
 *
 * Sources: ccusage (Claude Code) + every ccusage agent subcommand
 *   (codex, opencode, gemini, hermes, openclaw, amp, droid, codebuff,
 *   pi, goose, kilo, copilot, kimi, qwen). Agents with no data on this
 *   machine simply contribute 0 rows.
 * Sinks: ClickHouse, DuckDB (local or MotherDuck)
 */

import * as dotenv from 'dotenv';
dotenv.config();

import { hostname } from 'node:os';
import { ImportRunner } from '../pipeline/runner.js';
import { CcusageSource } from '../sources/ccusage.js';
import { CompanionDataSource } from '../sources/companion.js';
import { CCUSAGE_AGENT_SOURCES } from '../fetchers/companion.js';
import { ClickHouseSink } from '../sinks/clickhouse.js';
import { DuckDBSink } from '../sinks/duckdb.js';
import { TIMEOUTS } from '../constants.js';

const args = process.argv.slice(2);
const verbose = args.includes('--verbose') || args.includes('-v');
const skipCcusage = args.includes('--skip-ccusage');
const skipClickhouse = args.includes('--skip-clickhouse');
const duckdbPath = process.env.DUCKDB_PATH || args.find(a => a.startsWith('--duckdb-path='))?.split('=')[1];

const machineName = hostname();
const hashProjects = process.env.HASH_PROJECT_NAMES !== 'false';

console.log(`ccusage-import — machine: ${machineName}`);

const runner = new ImportRunner();

// Register sources
if (!skipCcusage) {
  runner.addSource(new CcusageSource({ machineName, hashProjects, timeout: TIMEOUTS.ccusage, verbose }));
}
for (const agent of CCUSAGE_AGENT_SOURCES) {
  if (args.includes(`--skip-${agent.id}`)) continue;
  runner.addSource(new CompanionDataSource({ type: agent.id, machineName, hashProjects, timeout: TIMEOUTS.companion, verbose }));
}

// Register sinks
if (!skipClickhouse) {
  runner.addSink(new ClickHouseSink());
}
if (duckdbPath) {
  runner.addSink(new DuckDBSink({ dbPath: duckdbPath }));
}

// Run pipeline
const result = await runner.run(verbose);

// Summary
console.log('\n=== Summary ===');
for (const s of result.sources) {
  console.log(`  source ${s.name}: ${s.rows} rows${s.error ? ` (error: ${s.error})` : ''}`);
}
for (const s of result.sinks) {
  const total = Object.values(s.rowsWritten).reduce((a, b) => a + b, 0);
  console.log(`  sink ${s.sinkName}: ${total} rows, ${s.durationMs}ms${s.error ? ` (error: ${s.error})` : ''}`);
}
console.log(`  total: ${result.totalDurationMs}ms`);

process.exit(result.sinks.some(s => s.error) ? 1 : 0);
