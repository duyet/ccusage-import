/**
 * ClickHouse Sink
 *
 * Writes flat event rows to the single ccusage_events table.
 * Uses ReplacingMergeTree for automatic dedup by (ORDER BY key, updated_at).
 * Also does explicit DELETE for immediate consistency on re-import.
 */

import { CHClient } from '../database/client.js';
import { ClickHouseConfig } from '../config/clickhouse.js';
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

    // Delete existing rows in scope
    for (const scope of scopes.values()) {
      await this.client.command(
        `ALTER TABLE ccusage_events DELETE WHERE date = '${scope.date}' AND record_type = '${scope.record_type}' AND source = '${scope.source}' AND machine_name = '${scope.machine_name}'`
      );
    }

    // Insert all events
    await this.client.insert('ccusage_events', data.events as Record<string, any>[]);
    result.tablesWritten.push('ccusage_events');
    result.rowsWritten['ccusage_events'] = data.events.length;
    result.durationMs = Date.now() - start;
    return result;
  }

  async close(): Promise<void> {
    await this.client?.close();
  }

  private async ensureTable(): Promise<void> {
    // CH v26 parser bug: can't have two consecutive Nullable(Float64) in CREATE TABLE
    // Create without projection/usage_limit_reset_time, then ALTER ADD
    await this.client.command(
      "CREATE TABLE IF NOT EXISTS ccusage_events (date Date, record_type String, record_key String, source String DEFAULT 'ccusage', machine_name String, model_name String DEFAULT '', session_id String DEFAULT '', project_path String DEFAULT '', input_tokens UInt64 DEFAULT 0, output_tokens UInt64 DEFAULT 0, cache_creation_tokens UInt64 DEFAULT 0, cache_read_tokens UInt64 DEFAULT 0, total_tokens UInt64 DEFAULT 0, cost Float64 DEFAULT 0, block_id String DEFAULT '', start_time Nullable(DateTime), end_time Nullable(DateTime), actual_end_time Nullable(DateTime), is_active UInt8 DEFAULT 0, is_gap UInt8 DEFAULT 0, entries UInt32 DEFAULT 0, burn_rate Nullable(Float64), created_at DateTime DEFAULT now(), updated_at DateTime DEFAULT now()) ENGINE = ReplacingMergeTree(updated_at) PARTITION BY toYYYYMM(date) ORDER BY (source, machine_name, record_type, date, model_name, record_key)"
    );
    try { await this.client.command('ALTER TABLE ccusage_events ADD COLUMN projection Nullable(Float64) AFTER burn_rate'); } catch { /* already exists */ }
    try { await this.client.command('ALTER TABLE ccusage_events ADD COLUMN usage_limit_reset_time Nullable(DateTime) AFTER projection'); } catch { /* already exists */ }
  }
}
