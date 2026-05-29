/**
 * ClickHouse Sink
 *
 * Writes flat event rows to the single ccusage_events table.
 * Uses ReplacingMergeTree for automatic dedup by (ORDER BY key, updated_at).
 * Also does explicit DELETE for immediate consistency on re-import.
 */

import { CHClient } from '../database/client.js';
import { ClickHouseConfig } from '../config/clickhouse.js';
import { escapeSqlLiteral } from '../utils/sql.js';
import { CH_DELETE_BATCH } from '../constants.js';
import { clickHouseCreateSql, clickHouseAlterStatements } from './schema.js';
import type { DataSink, SinkResult, EventsSnapshotData } from '../pipeline/types.js';

export class ClickHouseSink implements DataSink {
  readonly name = 'clickhouse';
  private client!: CHClient;

  async connect(): Promise<void> {
    const config = ClickHouseConfig.fromEnv();
    this.client = new CHClient(config);
    await this.ensureTable();
  }

  async write(data: EventsSnapshotData): Promise<SinkResult> {
    const start = Date.now();
    const result: SinkResult = { sinkName: this.name, tablesWritten: [], rowsWritten: {}, durationMs: 0 };

    if (data.events.length === 0) {
      result.durationMs = Date.now() - start;
      return result;
    }

    // Group events by (date, record_type, source, machine_name) for scoped deletes
    const scopes = new Map<string, { date: string; record_type: string; source: string; machine_name: string }>();
    for (const row of data.events) {
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

    // Batch DELETE: combine scopes into fewer queries using OR
    const scopeArr = [...scopes.values()];
    for (let i = 0; i < scopeArr.length; i += CH_DELETE_BATCH) {
      const batch = scopeArr.slice(i, i + CH_DELETE_BATCH);
      const conditions = batch.map(s =>
        `(date = '${escapeSqlLiteral(s.date)}' AND record_type = '${escapeSqlLiteral(s.record_type)}' AND source = '${escapeSqlLiteral(s.source)}' AND machine_name = '${escapeSqlLiteral(s.machine_name)}')`
      );
      await this.client.command(`ALTER TABLE ccusage_events DELETE WHERE ${conditions.join(' OR ')}`);
    }

    // Insert all events
    await this.client.insert('ccusage_events', data.events);
    result.tablesWritten.push('ccusage_events');
    result.rowsWritten['ccusage_events'] = data.events.length;
    result.durationMs = Date.now() - start;
    return result;
  }

  async close(): Promise<void> {
    await this.client?.close();
  }

  private async ensureTable(): Promise<void> {
    // CH v26 parser bug: can't have two consecutive Nullable(Float64) in CREATE
    // TABLE. Deferred columns (projection, usage_limit_reset_time) are added via
    // ALTER. See src/sinks/schema.ts.
    await this.client.command(clickHouseCreateSql());
    for (const stmt of clickHouseAlterStatements()) {
      try { await this.client.command(stmt); } catch { /* already exists */ }
    }
  }
}
