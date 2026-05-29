/**
 * Import Runner
 *
 * Orchestrates sources → parse → parallel sinks.
 * Merges flat event rows from all sources into a single buffer.
 */

import type { DataSource, DataSink, EventsSnapshotData, SinkResult, PipelineResult } from './types.js';
import { createLogger } from '../utils/logger.js';

export class ImportRunner {
  private sources: DataSource[] = [];
  private sinks: DataSink[] = [];

  addSource(source: DataSource): this {
    this.sources.push(source);
    return this;
  }

  addSink(sink: DataSink): this {
    this.sinks.push(sink);
    return this;
  }

  async run(verbose = false): Promise<PipelineResult> {
    const log = createLogger(verbose);
    const totalStart = Date.now();

    // 1. Fetch all sources in parallel
    log.info(`Fetching ${this.sources.length} sources...`);
    const sourceResults = await Promise.all(
      this.sources.map(async (source) => {
        try {
          const result = await source.fetch();
          const rows = result.data.events.length;
          log.info(`  ${source.name}: ${rows} event rows`);
          return { name: source.name, rows, data: result.data, error: undefined as string | undefined };
        } catch (e) {
          const error = e instanceof Error ? e.message : String(e);
          log.error(`  ${source.name} failed: ${error}`);
          return { name: source.name, rows: 0, data: { events: [] } as EventsSnapshotData, error };
        }
      })
    );

    // 2. Merge all events into single buffer
    const merged: EventsSnapshotData = { events: [] };
    for (const { data } of sourceResults) {
      merged.events.push(...data.events);
    }

    log.info(`\nMerged: ${merged.events.length} event rows`);

    // 3. Connect all sinks in parallel; remember which failed so the failure is
    // surfaced (not silently swallowed) and reflected in the sink's result.
    log.info(`\nConnecting ${this.sinks.length} sinks...`);
    const connections = await Promise.all(
      this.sinks.map(async (sink) => {
        try {
          await sink.connect();
          return { sink, connectError: undefined as string | undefined };
        } catch (e) {
          const connectError = e instanceof Error ? e.message : String(e);
          log.error(`  ${sink.name} connect failed: ${connectError}`);
          return { sink, connectError };
        }
      })
    );

    // 4. Fan out to all connected sinks in parallel. A sink that failed to
    // connect reports that error; others keep running (continue-on-failure).
    log.info(`Writing to ${this.sinks.length} sinks...`);
    const sinkResults: SinkResult[] = await Promise.all(
      connections.map(async ({ sink, connectError }) => {
        if (connectError) {
          return { sinkName: sink.name, tablesWritten: [], rowsWritten: {}, durationMs: 0, error: connectError };
        }
        try {
          const result = await sink.write(merged);
          const totalRows = Object.values(result.rowsWritten).reduce((a, b) => a + b, 0);
          log.info(`  ${sink.name}: ${totalRows} rows in ${result.durationMs}ms`);
          return result;
        } catch (e) {
          const error = e instanceof Error ? e.message : String(e);
          log.error(`  ${sink.name} failed: ${error}`);
          return { sinkName: sink.name, tablesWritten: [], rowsWritten: {}, durationMs: 0, error };
        }
      })
    );

    // 5. Close the sinks that connected; surface (don't swallow) close failures.
    await Promise.all(
      connections.map(async ({ sink, connectError }) => {
        if (connectError) return;
        try {
          await sink.close();
        } catch (e) {
          log.error(`  ${sink.name} close failed: ${e instanceof Error ? e.message : String(e)}`);
        }
      })
    );

    return {
      sources: sourceResults.map(({ name, rows, error }) => ({ name, rows, error })),
      sinks: sinkResults,
      totalDurationMs: Date.now() - totalStart,
    };
  }
}
