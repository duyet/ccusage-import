/**
 * DuckDB Sink
 *
 * Writes flat event rows to ccusage_events table in DuckDB or MotherDuck.
 * Uses COPY FROM for bulk inserts.
 */

import { Database as AsyncDatabase } from 'duckdb-async';
import { mkdirSync, writeFileSync, unlinkSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import type { DataSink, SinkResult, EventsSnapshotData } from '../pipeline/types.js';

const EVENTS_DDL = `CREATE TABLE IF NOT EXISTS ccusage_events (
  date DATE NOT NULL,
  record_type VARCHAR NOT NULL,
  record_key VARCHAR NOT NULL,
  source VARCHAR NOT NULL DEFAULT 'ccusage',
  machine_name VARCHAR NOT NULL,
  model_name VARCHAR DEFAULT '',
  session_id VARCHAR DEFAULT '',
  project_path VARCHAR DEFAULT '',
  input_tokens BIGINT DEFAULT 0,
  output_tokens BIGINT DEFAULT 0,
  cache_creation_tokens BIGINT DEFAULT 0,
  cache_read_tokens BIGINT DEFAULT 0,
  total_tokens BIGINT DEFAULT 0,
  cost DOUBLE DEFAULT 0,
  block_id VARCHAR DEFAULT '',
  start_time TIMESTAMP,
  end_time TIMESTAMP,
  actual_end_time TIMESTAMP,
  is_active SMALLINT DEFAULT 0,
  is_gap SMALLINT DEFAULT 0,
  entries INTEGER DEFAULT 0,
  burn_rate DOUBLE DEFAULT 0,
  projection DOUBLE DEFAULT 0,
  usage_limit_reset_time TIMESTAMP,
  created_at TIMESTAMP DEFAULT current_timestamp,
  updated_at TIMESTAMP DEFAULT current_timestamp
)`;

export interface DuckDBSinkOptions {
  dbPath: string;
  motherduckToken?: string;
}

export class DuckDBSink implements DataSink {
  readonly name: string;
  private db: AsyncDatabase | null = null;
  private tablesEnsured = false;
  private readonly dbPath: string;
  private readonly token: string | null;

  constructor(opts: DuckDBSinkOptions) {
    this.dbPath = opts.dbPath;
    this.token = opts.motherduckToken ?? process.env.MOTHERDUCK_TOKEN ?? null;
    this.name = this.dbPath.startsWith('md:') ? 'motherduck' : 'duckdb';
  }

  async connect(): Promise<void> {
    let connStr = this.dbPath;
    if (this.token && this.dbPath.startsWith('md:')) {
      const sep = connStr.includes('?') ? '&' : '?';
      connStr = `${connStr}${sep}motherduck_token=${this.token}`;
    } else if (!this.dbPath.startsWith('md:')) {
      mkdirSync(dirname(this.dbPath), { recursive: true });
    }
    this.db = await AsyncDatabase.create(connStr);
  }

  async write(data: EventsSnapshotData): Promise<SinkResult> {
    if (!this.db) throw new Error('DuckDB not connected');
    const start = Date.now();
    await this.ensureTables();

    const result: SinkResult = { sinkName: this.name, tablesWritten: [], rowsWritten: {}, durationMs: 0 };

    if (data.events.length === 0) {
      result.durationMs = Date.now() - start;
      return result;
    }

    const count = await this.writeEvents(data.events as Record<string, unknown>[]);
    result.tablesWritten.push('ccusage_events');
    result.rowsWritten['ccusage_events'] = count;

    result.durationMs = Date.now() - start;
    return result;
  }

  async close(): Promise<void> {
    if (this.db) {
      await this.db.close();
      this.db = null;
    }
  }

  private async ensureTables(): Promise<void> {
    if (!this.db || this.tablesEnsured) return;
    await this.db.exec(EVENTS_DDL);
    this.tablesEnsured = true;
  }

  private async writeEvents(rows: Record<string, unknown>[]): Promise<number> {
    if (!this.db || rows.length === 0) return 0;

    // Dedup: delete by scoped (date, record_type, source, machine_name) combinations
    const scopes = new Map<string, { date: string; record_type: string; source: string; machine_name: string }>();
    for (const row of rows) {
      const key = `${row.date}|${row.record_type}|${row.source}|${row.machine_name}`;
      if (!scopes.has(key)) {
        scopes.set(key, {
          date: String(row.date),
          record_type: String(row.record_type),
          source: String(row.source),
          machine_name: String(row.machine_name),
        });
      }
    }

    for (const scope of scopes.values()) {
      await this.db.exec(
        `DELETE FROM ccusage_events WHERE date = '${scope.date}' AND record_type = '${scope.record_type}' AND source = '${scope.source}' AND machine_name = '${scope.machine_name}'`
      );
    }

    // Build CSV and COPY FROM
    const columns = Object.keys(rows[0]);
    const csvLines: string[] = [columns.join(',')];

    for (const row of rows) {
      const values = columns.map(col => {
        const v = row[col];
        if (v === null || v === undefined) return '';
        if (typeof v === 'number' && !Number.isFinite(v)) return '0';
        if (v instanceof Date) return v.toISOString().replace('T', ' ').replace(/\.\d+Z$/, '');
        const s = String(v);
        if (s.includes(',') || s.includes('"') || s.includes('\n')) {
          return `"${s.replace(/"/g, '""')}"`;
        }
        return s;
      });
      csvLines.push(values.join(','));
    }

    const tmpPath = join(tmpdir(), `ccusage-events-${randomUUID()}.csv`);
    writeFileSync(tmpPath, csvLines.join('\n'), 'utf-8');

    try {
      const columnsList = columns.join(', ');
      await this.db.exec(
        `COPY ccusage_events (${columnsList}) FROM '${tmpPath}' (HEADER, DELIMITER ',', FORMAT csv)`
      );
    } finally {
      try { unlinkSync(tmpPath); } catch { /* ignore */ }
    }

    return rows.length;
  }
}
