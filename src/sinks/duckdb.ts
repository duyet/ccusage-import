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
import { escapeSqlLiteral } from '../utils/sql.js';
import { toCsvLine } from './csv.js';
import { duckDbCreateSql } from './schema.js';
import type { DataSink, SinkResult, EventsSnapshotData } from '../pipeline/types.js';

const EVENTS_DDL = duckDbCreateSql();

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

    const count = await this.writeEvents(data.events);
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
    await this.db.exec('ALTER TABLE ccusage_events ADD COLUMN IF NOT EXISTS reasoning_tokens BIGINT DEFAULT 0');
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
        `DELETE FROM ccusage_events WHERE date = '${escapeSqlLiteral(scope.date)}' AND record_type = '${escapeSqlLiteral(scope.record_type)}' AND source = '${escapeSqlLiteral(scope.source)}' AND machine_name = '${escapeSqlLiteral(scope.machine_name)}'`
      );
    }
    // Free scope map memory
    scopes.clear();

    // Build CSV and COPY FROM
    const columns = Object.keys(rows[0]);
    const csvLines: string[] = [columns.join(',')];

    for (const row of rows) {
      csvLines.push(toCsvLine(columns, row));
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
