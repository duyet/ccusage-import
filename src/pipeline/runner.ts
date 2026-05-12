/**
 * Import Runner
 *
 * Orchestrates sources → parse → parallel sinks.
 * Merges flat event rows from all sources into a single buffer.
 */

import type { DataSource, DataSink, EventsSnapshotData, SinkResult, PipelineResult } from './types.js';

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
    const totalStart = Date.now();

    // 1. Fetch all sources in parallel
    if (verbose) console.log(`Fetching ${this.sources.length} sources...`);
    const sourceResults = await Promise.all(
      this.sources.map(async (source) => {
        try {
          const result = await source.fetch();
          const rows = result.data.events.length;
          if (verbose) console.log(`  ${source.name}: ${rows} event rows`);
          return { name: source.name, rows, data: result.data, error: undefined as string | undefined };
        } catch (e) {
          const error = e instanceof Error ? e.message : String(e);
          if (verbose) console.error(`  ${source.name} failed: ${error}`);
          return { name: source.name, rows: 0, data: { events: [] } as EventsSnapshotData, error };
        }
      })
    );

    // 2. Merge all events into single buffer
    const merged: EventsSnapshotData = { events: [] };
    for (const { data } of sourceResults) {
      merged.events.push(...data.events);
    }

    if (verbose) {
      console.log(`\nMerged: ${merged.events.length} event rows`);
    }

    // 3. Connect all sinks in parallel
    if (verbose) console.log(`\nConnecting ${this.sinks.length} sinks...`);
    await Promise.all(this.sinks.map(s => s.connect().catch(() => {})));

    // 4. Fan out to all sinks in parallel
    if (verbose) console.log(`Writing to ${this.sinks.length} sinks...`);
    const sinkResults: SinkResult[] = await Promise.all(
      this.sinks.map(async (sink) => {
        try {
          const result = await sink.write(merged);
          if (verbose) {
            const totalRows = Object.values(result.rowsWritten).reduce((a, b) => a + b, 0);
            console.log(`  ${sink.name}: ${totalRows} rows in ${result.durationMs}ms`);
          }
          return result;
        } catch (e) {
          const error = e instanceof Error ? e.message : String(e);
          if (verbose) console.error(`  ${sink.name} failed: ${error}`);
          return { sinkName: sink.name, tablesWritten: [], rowsWritten: {}, durationMs: 0, error };
        }
      })
    );

    // 5. Close all sinks
    await Promise.all(this.sinks.map(s => s.close().catch(() => {})));

    return {
      sources: sourceResults.map(({ name, rows, error }) => ({ name, rows, error })),
      sinks: sinkResults,
      totalDurationMs: Date.now() - totalStart,
    };
  }
}
