/**
 * Ccusage Source
 *
 * Fetches all data types from ccusage CLI in parallel,
 * parses into flat event rows for the single ccusage_events table.
 */

import { fetchAllCcusageData } from '../fetchers/ccusage.js';
import { buildCcusageEventRows } from '../parsers/parsers.js';
import type { DataSource, SourceResult, EventsSnapshotData } from '../pipeline/types.js';

export interface CcusageSourceOptions {
  machineName: string;
  hashProjects?: boolean;
  timeout?: number;
  verbose?: boolean;
}

export class CcusageSource implements DataSource {
  readonly name = 'ccusage';
  private opts: CcusageSourceOptions;

  constructor(opts: CcusageSourceOptions) {
    this.opts = opts;
  }

  async fetch(): Promise<SourceResult> {
    const { machineName, hashProjects = true, timeout = 180_000, verbose } = this.opts;
    const raw = await fetchAllCcusageData({ verbose, timeout });
    const events = buildCcusageEventRows(raw, machineName, hashProjects);
    const data: EventsSnapshotData = { events };
    return { sourceName: this.name, data, fetchedAt: new Date() };
  }
}
