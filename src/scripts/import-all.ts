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
import { randomUUID } from 'node:crypto';
import { ImportRunner } from '../pipeline/runner.js';
import { CcusageSource } from '../sources/ccusage.js';
import { CompanionDataSource } from '../sources/companion.js';
import { AntigravitySource } from '../sources/antigravity.js';
import { HermesSource } from '../sources/hermes.js';
import { CCUSAGE_AGENT_SOURCES } from '../fetchers/companion.js';
import { ClickHouseSink } from '../sinks/clickhouse.js';
import { DuckDBSink } from '../sinks/duckdb.js';
import { TIMEOUTS } from '../constants.js';

const args = process.argv.slice(2);
const verbose = args.includes('--verbose') || args.includes('-v');
const skipCcusage = args.includes('--skip-ccusage');
const skipAntigravity = args.includes('--skip-antigravity');
const skipHermes = args.includes('--skip-hermes');
const skipClickhouse = args.includes('--skip-clickhouse');
const duckdbPath = process.env.DUCKDB_PATH || args.find(a => a.startsWith('--duckdb-path='))?.split('=')[1];
// Time-window options (priority: explicit --since/--end-date > env vars > --days-back)
const daysBackArg = args.find(a => a.startsWith('--days-back='))?.split('=')[1];
const daysBack = daysBackArg ? parseInt(daysBackArg, 10) : (process.env.IMPORT_DAYS_BACK ? parseInt(process.env.IMPORT_DAYS_BACK, 10) : undefined);
const since = args.find(a => a.startsWith('--since='))?.split('=')[1] ?? process.env.IMPORT_SINCE ?? undefined;
const endDate = args.find(a => a.startsWith('--end-date='))?.split('=')[1] ?? process.env.IMPORT_END_DATE ?? undefined;

// Compute since from daysBack if no explicit since
let effectiveSince = since;
if (!effectiveSince && daysBack != null && daysBack > 0) {
  const d = new Date();
  d.setDate(d.getDate() - daysBack);
  effectiveSince = d.toISOString().split('T')[0];
}

const importId = randomUUID();

const machineName = hostname();
const hashProjects = process.env.HASH_PROJECT_NAMES !== 'false';

console.log(`ccusage-import — machine: ${machineName}${effectiveSince ? `, since: ${effectiveSince}` : ''}${endDate ? `, until: ${endDate}` : ''}, import: ${importId}`);

const runner = new ImportRunner();

// Register sources
if (!skipCcusage) {
  runner.addSource(new CcusageSource({ machineName, hashProjects, timeout: TIMEOUTS.ccusage, verbose, daysBack, since: effectiveSince, endDate, importId }));
}
if (!skipAntigravity) {
  runner.addSource(new AntigravitySource({ machineName, hashProjects, verbose, daysBack, since: effectiveSince, endDate, importId }));
}
if (!skipHermes) {
  runner.addSource(new HermesSource({ machineName, hashProjects, verbose, daysBack, since: effectiveSince, endDate, importId }));
}
for (const agent of CCUSAGE_AGENT_SOURCES) {
  if (args.includes(`--skip-${agent.id}`)) continue;
  runner.addSource(new CompanionDataSource({ type: agent.id, machineName, hashProjects, timeout: TIMEOUTS.companion, verbose, daysBack, since: effectiveSince, endDate, importId }));
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
