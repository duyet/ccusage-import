/**
 * Pipeline Types
 *
 * Plugin interfaces for sources and sinks.
 */

/** Flat event rows for the single ccusage_events table */
export interface EventsSnapshotData {
  events: Record<string, unknown>[];
}

/** Result from a source fetch */
export interface SourceResult {
  sourceName: string;
  data: EventsSnapshotData;
  fetchedAt: Date;
}

/** Result from a sink write */
export interface SinkResult {
  sinkName: string;
  tablesWritten: string[];
  rowsWritten: Record<string, number>;
  durationMs: number;
  error?: string;
}

/** Source: fetches raw data from an external provider */
export interface DataSource {
  readonly name: string;
  fetch(): Promise<SourceResult>;
}

/** Sink: writes processed rows to a destination */
export interface DataSink {
  readonly name: string;
  connect(): Promise<void>;
  write(data: EventsSnapshotData): Promise<SinkResult>;
  close(): Promise<void>;
}

/** Full pipeline result */
export interface PipelineResult {
  sources: Array<{ name: string; rows: number; error?: string }>;
  sinks: SinkResult[];
  totalDurationMs: number;
}
